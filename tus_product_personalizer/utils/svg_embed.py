# -*- coding: utf-8 -*-
"""Prepare designer uploads as SVG (photo layers or traced vector paths)."""

import base64
import io
import logging
import re

_logger = logging.getLogger(__name__)

RASTER_EXTENSIONS = frozenset({"jpg", "jpeg", "png", "gif", "webp", "bmp"})

MIME_BY_EXTENSION = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "gif": "image/gif",
    "webp": "image/webp",
    "bmp": "image/bmp",
}


def svg_filename(filename):
    """Return a .svg filename derived from the original upload name."""
    if not filename:
        return "image.svg"
    base = filename.rsplit(".", 1)[0] if "." in filename else filename
    return f"{base}.svg"


def mime_from_filename(filename):
    ext = filename.rsplit(".", 1)[-1].lower() if filename and "." in filename else ""
    return MIME_BY_EXTENSION.get(ext, "image/png")


def is_svg_content(data_bytes):
    if not data_bytes:
        return False
    try:
        start = data_bytes[:512].decode("utf-8", errors="ignore").strip()
    except Exception:
        return False
    return start.startswith("<svg") or start.startswith("<?xml")


def _maybe_resize_raster(file_bytes, max_size=2048):
    try:
        from odoo.tools.image import image_process

        return image_process(file_bytes, size=(max_size, max_size))
    except Exception as exc:
        _logger.debug("Raster resize skipped: %s", exc)
        return file_bytes


def raster_to_embedded_svg(file_bytes, mime=None, width=None, height=None):
    """Embed raster bytes in an SVG wrapper (photo layer — not vectorization)."""
    file_bytes = _maybe_resize_raster(file_bytes)
    mime = mime or "image/png"

    if width is None or height is None:
        try:
            from PIL import Image

            img = Image.open(io.BytesIO(file_bytes))
            width, height = img.size
        except Exception:
            width = width or 1
            height = height or 1

    b64 = base64.b64encode(file_bytes).decode("ascii")
    data_uri = f"data:{mime};base64,{b64}"
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'xmlns:xlink="http://www.w3.org/1999/xlink" '
        f'width="{width}" height="{height}" viewBox="0 0 {width} {height}">\n'
        f'  <image width="{width}" height="{height}" xlink:href="{data_uri}"/>\n'
        f"</svg>"
    )


def parse_embedded_raster_dimensions(svg_text):
    """Return natural pixel width/height of an embedded raster in an SVG wrapper."""
    raster_bytes = _extract_embedded_raster_bytes(svg_text)
    if not raster_bytes:
        return None
    try:
        from PIL import Image

        with Image.open(io.BytesIO(raster_bytes)) as im:
            return {"width": im.width, "height": im.height}
    except Exception as exc:
        _logger.debug("Could not read embedded raster dimensions: %s", exc)
        return None


def _extract_embedded_raster_bytes(svg_text):
    """Pull base64 raster out of an SVG that only wraps an <image> tag."""
    if not svg_text:
        return None
    match = re.search(
        r'(?:xlink:)?href\s*=\s*["\']data:image/[^;]+;base64,([A-Za-z0-9+/=\s]+)["\']',
        svg_text,
        re.IGNORECASE,
    )
    if not match:
        return None
    try:
        return base64.b64decode(match.group(1).replace("\n", "").replace(" ", ""))
    except Exception as exc:
        _logger.debug("Could not decode embedded SVG raster: %s", exc)
        return None


def raster_to_traced_svg(file_bytes):
    """Trace a raster upload to a true vector SVG (paths with fill colors)."""
    from odoo.addons.tus_product_personalizer.utils.print_vector import (
        is_native_vector_svg,
        prepare_raster,
        sanitize_print_svg,
        trace_raster_to_svg,
    )

    prepared = prepare_raster(file_bytes, crop=True)
    if not prepared:
        return None
    traced = trace_raster_to_svg(prepared)
    if not traced:
        return None
    traced = sanitize_print_svg(traced)
    if not is_native_vector_svg(traced):
        return None
    return traced


def _looks_like_logo_or_flat_art(file_bytes, filename):
    """Heuristic for simple artwork that benefits from auto vectorization."""
    ext = filename.rsplit(".", 1)[-1].lower() if filename and "." in filename else ""
    if ext in ("jpg", "jpeg", "webp"):
        return False

    try:
        from PIL import Image

        img = Image.open(io.BytesIO(file_bytes)).convert("RGBA")
        width, height = img.size
        if width * height > 4_000_000:
            return False

        sample = img
        max_side = max(width, height)
        if max_side > 256:
            ratio = 256 / max_side
            sample = img.resize(
                (max(1, int(width * ratio)), max(1, int(height * ratio))),
                Image.Resampling.LANCZOS,
            )

        pixels = list(sample.getdata())
        if not pixels:
            return False

        unique_colors = len({px[:3] for px in pixels})
        has_transparency = any(px[3] < 250 for px in pixels)

        if ext in ("png", "gif", "bmp") and unique_colors <= 48:
            return True
        if has_transparency and unique_colors <= 64 and max(width, height) <= 1200:
            return True
        if unique_colors <= 24 and max(width, height) <= 600:
            return True
    except Exception as exc:
        _logger.debug("Logo detection skipped for %s: %s", filename, exc)
    return False


def _resolve_raster_bytes_for_vectorize(file_bytes, filename=None):
    """Return raw raster bytes suitable for tracing."""
    if is_svg_content(file_bytes):
        svg_text = file_bytes.decode("utf-8", errors="replace")
        embedded = _extract_embedded_raster_bytes(svg_text)
        if embedded:
            return embedded
        return None
    return file_bytes


def prepare_canvas_image_storage(file_bytes, filename, vectorize=None, auto_detect=True):
    """Normalize upload bytes to SVG text and a .svg filename.

    Web-to-print behaviour (matches typical W2P platforms):
    - Photos / complex rasters → photo layer (embedded raster in SVG), fast upload.
    - Logos / flat art → optional auto vectorize when ``auto_detect`` is True.
    - ``vectorize=True`` → force trace (user-initiated "Convert to vector").
    - ``vectorize=False`` → always photo layer (AI images, background removal, etc.).
    """
    from odoo.addons.tus_product_personalizer.utils.print_vector import is_native_vector_svg

    is_vector = False

    if is_svg_content(file_bytes):
        svg_text = file_bytes.decode("utf-8", errors="replace")
        if is_native_vector_svg(svg_text):
            is_vector = True
        elif vectorize is True:
            embedded = _extract_embedded_raster_bytes(svg_text)
            source = embedded or file_bytes
            traced = raster_to_traced_svg(
                _resolve_raster_bytes_for_vectorize(source, filename) or source
            )
            if traced:
                svg_text = traced
                is_vector = True
        elif vectorize is not False:
            embedded = _extract_embedded_raster_bytes(svg_text)
            if embedded and auto_detect and _looks_like_logo_or_flat_art(
                embedded, filename
            ):
                traced = raster_to_traced_svg(embedded)
                if traced:
                    svg_text = traced
                    is_vector = True
    else:
        should_vectorize = vectorize is True
        if vectorize is None and auto_detect:
            should_vectorize = _looks_like_logo_or_flat_art(file_bytes, filename)

        if should_vectorize:
            traced = raster_to_traced_svg(file_bytes)
            if traced:
                svg_text = traced
                is_vector = True
            else:
                _logger.warning(
                    "Vector trace failed for %s; storing as photo layer",
                    filename,
                )
                svg_text = raster_to_embedded_svg(
                    file_bytes,
                    mime=mime_from_filename(filename),
                )
        else:
            svg_text = raster_to_embedded_svg(
                file_bytes,
                mime=mime_from_filename(filename),
            )

    return svg_text, svg_filename(filename), is_vector
