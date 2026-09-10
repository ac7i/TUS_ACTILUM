# -*- coding: utf-8 -*-
"""Raster -> vector SVG and SVG -> AI (PDF-compatible) for print production.

Goal: print-ready, scalable vector art with a TRANSPARENT background and the
highest practical clarity. The professional tracer (vtracer) is used when
available; potracer / Pillow are fallbacks.
"""

import io
import logging
import os
import re
import shutil
import subprocess
import tempfile

try:
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = None
except ImportError:
    pass

_logger = logging.getLogger(__name__)


class ExactSizePdfError(Exception):
    """User-facing failure while building an exact-size print PDF."""

# Trace at print resolution. vtracer handles large images well; keeping this
# high is the single biggest factor for clarity. Only used to cap absurd sizes.
MAX_TRACE_PIXELS = 2600

# Memory-safe budget for exact-size print rasters (PDF/PNG export).
# Physical PDF MediaBox stays at the requested mm/in; only the embedded
# pixel count is capped so large-format × high-PPI jobs do not OOM.
PRINT_EXPORT_MAX_MEGAPIXELS = 100
PRINT_EXPORT_MAX_EDGE = 16384

# Pixels at/above this on every channel are treated as "white" background.
WHITE_THRESHOLD = 244
# Pixels with alpha below this are treated as already transparent.
ALPHA_THRESHOLD = 16


def _has_transparency(img):
    """True when the image already carries meaningful transparency."""
    if img.mode != "RGBA":
        return False
    extrema = img.getextrema()
    if not extrema or len(extrema) < 4:
        return False
    alpha_min, _alpha_max = extrema[3]
    return alpha_min < 250


def _remove_background_flood(img, tolerance=110):
    """Remove the connected background (from the borders) for opaque images.

    Flood-fills from many points around the border so a non-uniform background
    (e.g. a checkerboard-style backdrop from a screenshot, or a light page) is
    fully cleared, while colours *inside* the artwork are preserved. Only used
    for flat images that arrive without an alpha channel (e.g. JPEG uploads).
    """
    try:
        from PIL import ImageDraw
    except ImportError:
        return img

    rgb = img.convert("RGB")
    width, height = rgb.size
    sentinel = (1, 254, 2)  # unlikely to occur in real artwork

    # Seed along all four edges so both colours of a checkerboard backdrop and
    # any irregular border are caught.
    seeds = []
    step_x = max(1, width // 12)
    step_y = max(1, height // 12)
    for x in range(0, width, step_x):
        seeds.append((x, 0))
        seeds.append((x, height - 1))
    for y in range(0, height, step_y):
        seeds.append((0, y))
        seeds.append((width - 1, y))

    filled = False
    for seed in seeds:
        try:
            ImageDraw.floodfill(rgb, seed, sentinel, thresh=tolerance)
            filled = True
        except Exception:
            continue
    if not filled:
        return img

    result = img.convert("RGBA")
    px_src = rgb.load()
    px_dst = result.load()
    for y in range(height):
        for x in range(width):
            if px_src[x, y] == sentinel:
                r, g, b, _a = px_dst[x, y]
                px_dst[x, y] = (r, g, b, 0)
    return result


def _clean_alpha_fringe(img):
    """Crisp up the alpha so colours stay vivid and edges are clean.

    - Fully transparent (sub-threshold) pixels are zeroed AND their colour
      cleared, so a viewer never shows a white halo and the crop is accurate.
    - Strongly visible pixels are pushed to fully opaque, which removes the
      washed-out / lightened look caused by anti-aliasing over white.
    """
    pixels = img.load()
    width, height = img.size
    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            if a < ALPHA_THRESHOLD:
                pixels[x, y] = (0, 0, 0, 0)
            elif a >= 160:
                pixels[x, y] = (r, g, b, 255)
    return img


def _crop_to_content(img):
    """Crop to the artwork using the ALPHA channel only.

    Canvas snapshots often store white RGB (255,255,255) on fully transparent
    pixels, which fools Image.getbbox() into keeping the whole canvas. Cropping
    on alpha alone gives a tight bounding box around the real artwork.
    """
    if img.mode != "RGBA":
        bbox = img.getbbox()
        return img.crop(bbox) if bbox else img
    alpha = img.getchannel("A")
    bbox = alpha.getbbox()
    if not bbox:
        return img
    return img.crop(bbox)


def _limit_trace_size(img, max_pixels=MAX_TRACE_PIXELS):
    from PIL import Image

    width, height = img.size
    longest = max(width, height)
    if longest <= max_pixels:
        return img
    scale = max_pixels / longest
    new_size = (max(1, int(width * scale)), max(1, int(height * scale)))
    return img.resize(new_size, Image.Resampling.LANCZOS)


def prepare_raster(raw_bytes, crop=True):
    """Return a clean, transparent-background PNG ready for tracing.

    - Honours existing transparency (snapshots from the designer).
    - For flat/opaque images, removes the connected border background.
    - Crops to the artwork and caps the size for tracing.
    """
    if not raw_bytes:
        return b""
    try:
        from PIL import Image
    except ImportError:
        return raw_bytes

    try:
        img = Image.open(io.BytesIO(raw_bytes)).convert("RGBA")
    except Exception:
        return raw_bytes

    if _has_transparency(img):
        # Designer snapshot: the background is already transparent. Trust the
        # alpha channel and preserve every opaque colour (incl. white artwork);
        # only clean faint anti-aliased fringe.
        img = _clean_alpha_fringe(img)
    else:
        # Flat image (e.g. JPEG): strip the surrounding (connected) background
        # only, so white *inside* the artwork is preserved.
        img = _remove_background_flood(img)
        img = _clean_alpha_fringe(img)

    if crop:
        img = _crop_to_content(img)
    img = _limit_trace_size(img)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def parse_print_quality_ppi(code, default=(300, 300)):
    """Parse product-page print quality codes like good_600x600 → (dpi_x, dpi_y)."""
    if not code or not isinstance(code, str):
        return default
    match = re.search(r"_(\d+)x(\d+)$", code.strip())
    if not match:
        return default
    dpi_x = max(1, int(match.group(1)))
    dpi_y = max(1, int(match.group(2)))
    return dpi_x, dpi_y


def _print_pixel_size(width, height, unit, dpi=300, dpi_y=None):
    """Convert physical print size to pixel size.

    ``dpi`` is used for width. ``dpi_y`` defaults to ``dpi`` (isotropic) and is
    used for height so anisotropic product-page qualities (600×1200) work.
    """
    if width is None or height is None:
        return None, None
    dpi_x = float(dpi or 300)
    dpi_h = float(dpi_y if dpi_y is not None else dpi_x)
    unit_key = str(unit or "in").lower()
    if unit_key == "mm":
        return (
            max(1, round(width * dpi_x / 25.4)),
            max(1, round(height * dpi_h / 25.4)),
        )
    if unit_key == "cm":
        return (
            max(1, round(width * dpi_x / 2.54)),
            max(1, round(height * dpi_h / 2.54)),
        )
    if unit_key == "px":
        return max(1, int(width)), max(1, int(height))
    return max(1, round(width * dpi_x)), max(1, round(height * dpi_h))


def _physical_size_to_inches(width, height, unit):
    """Convert physical print size to inches (for effective PPI)."""
    w = float(width)
    h = float(height)
    unit_key = str(unit or "in").lower()
    if unit_key == "mm":
        return w / 25.4, h / 25.4
    if unit_key == "cm":
        return w / 2.54, h / 2.54
    if unit_key == "px":
        # Treat px as 72 PPI so inches match PDF point mapping.
        return w / 72.0, h / 72.0
    return w, h


def resolve_print_raster_size(
    width,
    height,
    unit,
    dpi_x=300,
    dpi_y=None,
    source_size=None,
    max_megapixels=PRINT_EXPORT_MAX_MEGAPIXELS,
    max_edge=PRINT_EXPORT_MAX_EDGE,
):
    """Resolve embed pixel size for exact-size export (never hard-fails).

    Order:
    1. Ideal pixels from physical size × requested PPI.
    2. Do not upscale beyond ``source_size`` when provided.
    3. Scale down proportionally to fit ``max_megapixels`` and ``max_edge``.
    4. Effective PPI = final pixels ÷ physical inches (for DPI tags / logs).

    PDF MediaBox must still use the original physical ``width``/``height``.
    """
    dpi_w = float(dpi_x or 300)
    dpi_h = float(dpi_y if dpi_y is not None else dpi_w)
    ideal_w, ideal_h = _print_pixel_size(width, height, unit, dpi=dpi_w, dpi_y=dpi_h)
    if not ideal_w or not ideal_h:
        return None

    out_w = int(ideal_w)
    out_h = int(ideal_h)
    capped = False

    if source_size:
        src_w = max(1, int(source_size[0]))
        src_h = max(1, int(source_size[1]))
        if out_w > src_w or out_h > src_h:
            scale = min(src_w / out_w, src_h / out_h)
            out_w = max(1, int(round(out_w * scale)))
            out_h = max(1, int(round(out_h * scale)))
            capped = True

    max_px = int(max_megapixels or 0) * 1_000_000
    edge_cap = int(max_edge or 0)
    scale_budget = 1.0
    if edge_cap > 0:
        longest = max(out_w, out_h)
        if longest > edge_cap:
            scale_budget = min(scale_budget, edge_cap / float(longest))
    if max_px > 0 and (out_w * out_h) > max_px:
        scale_budget = min(scale_budget, (max_px / float(out_w * out_h)) ** 0.5)
    if scale_budget < 1.0:
        out_w = max(1, int(round(out_w * scale_budget)))
        out_h = max(1, int(round(out_h * scale_budget)))
        capped = True

    inches_w, inches_h = _physical_size_to_inches(width, height, unit)
    eff_dpi_x = float(out_w) / inches_w if inches_w > 0 else dpi_w
    eff_dpi_y = float(out_h) / inches_h if inches_h > 0 else dpi_h

    return out_w, out_h, eff_dpi_x, eff_dpi_y, capped


def preview_source_size(preview_bytes):
    """Return (width, height) of preview image bytes without full decode work."""
    from PIL import Image

    img = Image.open(io.BytesIO(preview_bytes))
    return img.size


def resize_preview_to_print_rgb(
    preview_bytes,
    output_width,
    output_height,
    flatten_alpha=True,
):
    """Resize preview to print pixels and return a PIL image.

    When ``flatten_alpha`` is True (PDF path), returns opaque RGB.
    When False (PNG path), preserves RGBA when present.
    """
    from PIL import Image

    target_w = max(1, int(output_width))
    target_h = max(1, int(output_height))
    img = Image.open(io.BytesIO(preview_bytes))
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA" if "A" in (img.mode or "") else "RGB")
    if img.size != (target_w, target_h):
        resample = getattr(Image, "Resampling", Image).LANCZOS
        img = img.resize((target_w, target_h), resample)
    if flatten_alpha:
        if img.mode == "RGBA":
            background = Image.new("RGB", img.size, (255, 255, 255))
            background.paste(img, mask=img.split()[3])
            return background
        if img.mode != "RGB":
            return img.convert("RGB")
        return img
    if img.mode not in ("RGB", "RGBA"):
        return img.convert("RGBA")
    return img


def resize_preview_to_print_png(preview_bytes, output_width, output_height, dpi_x=300, dpi_y=None):
    """Resize (or retag) a PNG to exact print pixel size with DPI metadata."""
    dpi_h = dpi_y if dpi_y is not None else dpi_x
    img = resize_preview_to_print_rgb(
        preview_bytes,
        output_width,
        output_height,
        flatten_alpha=False,
    )
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA")
    out = io.BytesIO()
    img.save(out, format="PNG", dpi=(float(dpi_x), float(dpi_h)))
    return out.getvalue()


def _physical_size_to_pdf_points(width, height, unit):
    """Convert physical print size to PDF page size in points (1 pt = 1/72 in)."""
    w = float(width)
    h = float(height)
    unit_key = str(unit or "in").lower()
    if unit_key == "mm":
        return w * 72.0 / 25.4, h * 72.0 / 25.4
    if unit_key == "cm":
        return w * 72.0 / 2.54, h * 72.0 / 2.54
    if unit_key == "px":
        # Treat pixels as 72 PPI so page size matches pixel count in points.
        return w, h
    return w * 72.0, h * 72.0


def _flatten_png_for_print_pdf(png_bytes):
    """Return an opaque RGB PIL image (alpha composited on white)."""
    from PIL import Image

    img = Image.open(io.BytesIO(png_bytes))
    if img.mode == "RGBA":
        background = Image.new("RGB", img.size, (255, 255, 255))
        background.paste(img, mask=img.split()[3])
        return background
    if img.mode != "RGB":
        return img.convert("RGB")
    return img


def _rgb_image_to_trim_pdf_bytes(img, page_w_pt, page_h_pt, jpeg_quality=95):
    """Embed RGB image on a PDF page whose MediaBox is the physical trim size.

    Pillow's ``Image.save(..., format="PDF", resolution=dpi)`` sets page size to
    ``pixels / dpi``. With anisotropic PPI (e.g. 600×1200) that makes an 8×10
    sheet become 8×20. Always use the physical MediaBox instead.
    """
    if img.mode != "RGB":
        img = img.convert("RGB")
    jpeg_buf = io.BytesIO()
    img.save(jpeg_buf, format="JPEG", quality=jpeg_quality)
    jpeg_data = jpeg_buf.getvalue()
    img_w, img_h = img.size
    page_w = max(1.0, float(page_w_pt))
    page_h = max(1.0, float(page_h_pt))

    objects = []

    def _add(payload):
        objects.append(payload)
        return len(objects)

    catalog_id = _add(None)
    pages_id = _add(None)
    page_id = _add(None)
    content_id = _add(None)
    image_id = _add(None)

    # Scale image to fill the physical page (full-bleed), independent of PPI.
    content_stream = f"q\n{page_w:.4f} 0 0 {page_h:.4f} 0 0 cm\n/Im0 Do\nQ\n".encode("ascii")

    objects[catalog_id - 1] = f"<< /Type /Catalog /Pages {pages_id} 0 R >>".encode("ascii")
    objects[pages_id - 1] = (
        f"<< /Type /Pages /Kids [{page_id} 0 R] /Count 1 >>".encode("ascii")
    )
    objects[page_id - 1] = (
        f"<< /Type /Page /Parent {pages_id} 0 R "
        f"/MediaBox [0 0 {page_w:.4f} {page_h:.4f}] "
        f"/Contents {content_id} 0 R "
        f"/Resources << /XObject << /Im0 {image_id} 0 R >> >> >>"
    ).encode("ascii")
    objects[content_id - 1] = (
        f"<< /Length {len(content_stream)} >>\nstream\n".encode("ascii")
        + content_stream
        + b"\nendstream"
    )
    objects[image_id - 1] = (
        (
            f"<< /Type /XObject /Subtype /Image /Width {img_w} /Height {img_h} "
            f"/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode "
            f"/Length {len(jpeg_data)} >>\nstream\n"
        ).encode("ascii")
        + jpeg_data
        + b"\nendstream"
    )

    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = [0]
    for idx, obj in enumerate(objects, start=1):
        offsets.append(out.tell())
        out.write(f"{idx} 0 obj\n".encode("ascii"))
        out.write(obj)
        out.write(b"\nendobj\n")
    xref_pos = out.tell()
    out.write(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    out.write(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        out.write(f"{offset:010d} 00000 n \n".encode("ascii"))
    out.write(
        (
            f"trailer\n<< /Size {len(objects) + 1} /Root {catalog_id} 0 R >>\n"
            f"startxref\n{xref_pos}\n%%EOF\n"
        ).encode("ascii")
    )
    return out.getvalue()


def build_exact_size_print_pdf(
    png_bytes=None,
    width=None,
    height=None,
    unit="in",
    dpi_x=300,
    dpi_y=None,
    color_mode="rgb",
    rgb_image=None,
):
    """Build a one-page print PDF at exact physical size from an RGB image.

    Flow:
    1. Accept either ``rgb_image`` (PIL RGB) or ``png_bytes`` (flattened).
    2. Write an RGB PDF whose MediaBox is the physical canvas size (not
       ``pixels / dpi`` — that breaks anisotropic 600×1200 PPI sheets).
    3. If ``color_mode`` is ``cmyk``, re-encode with Ghostscript to DeviceCMYK.
       RGB mode never calls Ghostscript.
    """
    if rgb_image is None and not png_bytes:
        raise ExactSizePdfError("No image data available for print PDF.")
    if width is None or height is None:
        raise ExactSizePdfError("Invalid print page size for PDF export.")

    dpi_h = float(dpi_y if dpi_y is not None else (dpi_x or 300))
    dpi_w = float(dpi_x or 300)
    page_w, page_h = _physical_size_to_pdf_points(width, height, unit)
    if page_w <= 0 or page_h <= 0:
        raise ExactSizePdfError("Invalid print page size for PDF export.")

    page_w_pt = max(1, round(page_w, 4))
    page_h_pt = max(1, round(page_h, 4))
    use_cmyk = str(color_mode or "rgb").lower() == "cmyk"

    if rgb_image is not None:
        img = rgb_image
        if getattr(img, "mode", None) != "RGB":
            img = img.convert("RGB")
    else:
        img = _flatten_png_for_print_pdf(png_bytes)
    rgb_pdf_bytes = _rgb_image_to_trim_pdf_bytes(img, page_w_pt, page_h_pt)

    if not use_cmyk:
        _logger.info(
            "Built exact-size PDF: %.2fx%.2f %s @ %sx%s dpi, mode=rgb (%s bytes)",
            width,
            height,
            unit,
            dpi_w,
            dpi_h,
            len(rgb_pdf_bytes),
        )
        return rgb_pdf_bytes

    gs = shutil.which("gs")
    if not gs:
        raise ExactSizePdfError(
            "Ghostscript (gs) is required for CMYK print PDF export. "
            "Install Ghostscript on the server, or set Print Export Color Mode to RGB."
        )

    pdf_bytes = rgb_pdf_bytes
    with tempfile.TemporaryDirectory(prefix="tus_exact_pdf_") as tmp:
        rgb_pdf_path = os.path.join(tmp, "sheet_rgb.pdf")
        out_pdf_path = os.path.join(tmp, "sheet.pdf")
        with open(rgb_pdf_path, "wb") as handle:
            handle.write(rgb_pdf_bytes)

        cmd = [
            gs,
            "-dSAFER",
            "-dBATCH",
            "-dNOPAUSE",
            "-dQUIET",
            "-sDEVICE=pdfwrite",
            "-dCompatibilityLevel=1.4",
            "-dAutoRotatePages=/None",
            f"-dDEVICEWIDTHPOINTS={page_w_pt}",
            f"-dDEVICEHEIGHTPOINTS={page_h_pt}",
            "-dFIXEDMEDIA",
            "-dPDFFitPage",
            "-sColorConversionStrategy=CMYK",
            "-dProcessColorModel=/DeviceCMYK",
            "-sColorConversionStrategyForImages=CMYK",
            f"-sOutputFile={out_pdf_path}",
            rgb_pdf_path,
        ]

        try:
            result = subprocess.run(
                cmd,
                check=False,
                capture_output=True,
                timeout=600,
            )
        except subprocess.TimeoutExpired as err:
            raise ExactSizePdfError(
                "Exact-size PDF generation timed out. Try a lower print quality."
            ) from err
        except OSError as err:
            raise ExactSizePdfError(
                "Could not run Ghostscript for CMYK export: %s" % err
            ) from err

        if result.returncode == 0 and os.path.exists(out_pdf_path):
            with open(out_pdf_path, "rb") as handle:
                pdf_bytes = handle.read()
        else:
            stderr = (result.stderr or b"").decode("utf-8", errors="replace")[:500]
            _logger.error(
                "Ghostscript exact-size CMYK PDF failed (code=%s): %s",
                result.returncode,
                stderr,
            )
            raise ExactSizePdfError(
                "Ghostscript failed to create a CMYK PDF. "
                "Check the server Ghostscript install, or use RGB export mode."
            )

    if not pdf_bytes or not pdf_bytes.startswith(b"%PDF"):
        raise ExactSizePdfError("Could not produce a valid exact-size PDF.")

    # Guard: never ship a page whose MediaBox drifted from physical size.
    try:
        boxes = re.findall(rb"/MediaBox\s*\[\s*([^\]]+)\]", pdf_bytes)
        if boxes:
            parts = [float(x) for x in boxes[0].split()]
            if len(parts) >= 4:
                box_w = abs(parts[2] - parts[0])
                box_h = abs(parts[3] - parts[1])
                if abs(box_w - page_w_pt) > 1.0 or abs(box_h - page_h_pt) > 1.0:
                    _logger.warning(
                        "CMYK PDF MediaBox %.2fx%.2f != trim %.2fx%.2f; "
                        "returning RGB trim PDF with correct page size.",
                        box_w,
                        box_h,
                        page_w_pt,
                        page_h_pt,
                    )
                    pdf_bytes = rgb_pdf_bytes
                    use_cmyk = False
    except Exception:
        _logger.debug("MediaBox validation skipped", exc_info=True)

    _logger.info(
        "Built exact-size PDF: %.2fx%.2f %s @ %sx%s dpi, mode=%s (%s bytes)",
        width,
        height,
        unit,
        dpi_w,
        dpi_h,
        "cmyk" if use_cmyk else "rgb",
        len(pdf_bytes),
    )
    return pdf_bytes


def is_native_vector_svg(svg_text):
    """Return True when SVG contains paths/shapes only (no embedded bitmap)."""
    if not svg_text or not isinstance(svg_text, str):
        return False
    lower = svg_text.lower()
    if "<svg" not in lower:
        return False
    if "data:image" in lower:
        return False
    if "<image" in lower and ("href=" in lower or "xlink:href=" in lower):
        return False
    return True


def is_vector_svg_bytes(data):
    """True when bytes look like SVG markup (not PNG/JPEG)."""
    if not data:
        return False
    start = data[:256].lstrip()
    return start.startswith(b"<?xml") or start.startswith(b"<svg") or start.startswith(b"<!DOCTYPE svg")


def _strip_background_paths(svg_text):
    """Remove only non-printing artefacts (fill="none").

    We deliberately DO NOT remove white fills: with a transparent input the
    tracer never emits a white backdrop, so any white path is genuine artwork
    (e.g. the white in a logo) and must be kept.
    """
    if not svg_text:
        return svg_text
    return re.sub(
        r'<(rect|path)\b[^>]*fill="none"[^>]*/>\s*',
        "",
        svg_text,
        flags=re.IGNORECASE,
    )


def sanitize_print_svg(svg_text):
    """Strip non-printing artefacts from SVG markup (keeps all real colours)."""
    if not svg_text or not isinstance(svg_text, str):
        return svg_text
    return _strip_background_paths(svg_text.strip())


def apply_print_dimensions(svg_text, width, height, unit, view_width=None, view_height=None):
    """Set root SVG width/height to the configured print area (keeps aspect)."""
    if not svg_text:
        return svg_text
    text = sanitize_print_svg(svg_text.strip())
    if width is None or height is None:
        return text

    unit_key = str(unit or "in").lower()
    suffix_map = {
        "inch": "in", "in": "in",
        "millimeter": "mm", "mm": "mm",
        "centimeter": "cm", "cm": "cm",
    }
    suffix = suffix_map.get(unit_key, "in")
    w_attr = f"{width}{suffix}" if suffix in ("in", "mm", "cm") else str(width)
    h_attr = f"{height}{suffix}" if suffix in ("in", "mm", "cm") else str(height)
    vb_w = view_width if view_width is not None else width
    vb_h = view_height if view_height is not None else height

    if 'width="' in text:
        text = re.sub(r'(<svg[^>]*\s)width="[^"]*"', rf'\1width="{w_attr}"', text, count=1)
    else:
        text = re.sub(r"(<svg)", rf'\1 width="{w_attr}"', text, count=1)
    if 'height="' in text:
        text = re.sub(r'(<svg[^>]*\s)height="[^"]*"', rf'\1height="{h_attr}"', text, count=1)
    else:
        text = re.sub(r"(<svg)", rf'\1 height="{h_attr}"', text, count=1)
    if 'viewBox="' in text:
        text = re.sub(r'viewBox="[^"]*"', f'viewBox="0 0 {vb_w} {vb_h}"', text, count=1)
    else:
        text = re.sub(r"(<svg)", rf'\1 viewBox="0 0 {vb_w} {vb_h}"', text, count=1)
    return text


def _trace_with_vtracer(raw_bytes):
    """High-quality colour spline trace via vtracer."""
    import vtracer

    return vtracer.convert_raw_image_to_svg(
        raw_bytes,
        img_format="png",
        colormode="color",
        hierarchical="stacked",
        mode="spline",
        filter_speckle=4,
        color_precision=8,
        layer_difference=16,
        corner_threshold=60,
        length_threshold=4.0,
        max_iterations=10,
        splice_threshold=45,
        path_precision=8,
    )


def _trace_with_potracer(raw_bytes):
    """Monochrome vector trace via potracer when installed (imports as 'potrace')."""
    from PIL import Image
    try:
        from potrace import Bitmap, POTRACE_TURNPOLICY_MINORITY
    except ImportError:
        from potracer import Bitmap, POTRACE_TURNPOLICY_MINORITY

    rgba = Image.open(io.BytesIO(raw_bytes)).convert("RGBA")
    width, height = rgba.size
    bw = Image.new("L", (width, height), 255)
    rgba_px = rgba.load()
    bw_px = bw.load()
    for y in range(height):
        for x in range(width):
            if rgba_px[x, y][3] >= 32:
                bw_px[x, y] = 0

    bitmap = Bitmap(bw, blacklevel=0.5)
    paths = bitmap.trace(
        turdsize=2,
        turnpolicy=POTRACE_TURNPOLICY_MINORITY,
        alphamax=1.0,
        opticurve=True,
        opttolerance=0.2,
    )

    parts = []
    for curve in paths:
        start = curve.start_point
        segments = [f"M{start.x},{start.y}"]
        for segment in curve.segments:
            if segment.is_corner:
                segments.append(f"L{segment.c.x},{segment.c.y}L{segment.end_point.x},{segment.end_point.y}")
            else:
                segments.append(
                    f"C{segment.c1.x},{segment.c1.y} "
                    f"{segment.c2.x},{segment.c2.y} "
                    f"{segment.end_point.x},{segment.end_point.y}"
                )
        segments.append("Z")
        parts.append(f'<path d="{" ".join(segments)}" fill="#000000"/>')

    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'width="{width}" height="{height}" viewBox="0 0 {width} {height}">\n'
        f'{"".join(parts)}\n</svg>'
    )


def _trace_with_pillow_layers(raw_bytes, max_colors=16):
    """Pure-Pillow colour layer trace - last-resort fallback."""
    from PIL import Image

    rgba = Image.open(io.BytesIO(raw_bytes)).convert("RGBA")
    width, height = rgba.size
    rgba_px = rgba.load()

    rgb_img = Image.new("RGB", (width, height), (255, 255, 255))
    rgb_px = rgb_img.load()
    has_pixels = False
    for y in range(height):
        for x in range(width):
            if rgba_px[x, y][3] >= 32:
                rgb_px[x, y] = rgba_px[x, y][:3]
                has_pixels = True
    if not has_pixels:
        return None

    quantized = rgb_img.quantize(colors=max_colors, method=2)
    palette = quantized.getpalette() or []
    q_px = quantized.load()

    color_spans = {}
    for y in range(height):
        for x in range(width):
            if rgba_px[x, y][3] < 32:
                continue
            color_idx = q_px[x, y]
            color_spans.setdefault(color_idx, {}).setdefault(y, []).append(x)

    shapes = []
    for color_idx, rows in color_spans.items():
        if color_idx * 3 + 2 >= len(palette):
            continue
        red, green, blue = palette[color_idx * 3: color_idx * 3 + 3]
        if red >= WHITE_THRESHOLD and green >= WHITE_THRESHOLD and blue >= WHITE_THRESHOLD:
            continue
        fill = f"#{red:02x}{green:02x}{blue:02x}"
        for y, xs in rows.items():
            xs.sort()
            span_start = xs[0]
            span_end = xs[0]
            for x in xs[1:]:
                if x == span_end + 1:
                    span_end = x
                else:
                    shapes.append(
                        f'<rect x="{span_start}" y="{y}" '
                        f'width="{span_end - span_start + 1}" height="1" fill="{fill}"/>'
                    )
                    span_start = span_end = x
            shapes.append(
                f'<rect x="{span_start}" y="{y}" '
                f'width="{span_end - span_start + 1}" height="1" fill="{fill}"/>'
            )

    if not shapes:
        return None

    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'width="{width}" height="{height}" viewBox="0 0 {width} {height}">\n'
        f'{"".join(shapes)}\n</svg>'
    )


def trace_raster_to_svg(raw_bytes):
    """Convert a prepared (transparent) PNG to a vector SVG, best engine first."""
    try:
        return _trace_with_vtracer(raw_bytes)
    except ImportError:
        _logger.info("vtracer not installed; falling back")
    except Exception as exc:
        _logger.warning("vtracer trace failed: %s", exc)

    try:
        return _trace_with_potracer(raw_bytes)
    except ImportError:
        _logger.info("potracer not installed; falling back")
    except Exception as exc:
        _logger.warning("potracer trace failed: %s", exc)

    return _trace_with_pillow_layers(raw_bytes)


def svg_to_ai_bytes(svg_text):
    """Convert vector SVG to Illustrator-compatible PDF bytes (.ai)."""
    import cairosvg

    return cairosvg.svg2pdf(bytestring=svg_text.encode("utf-8"))


def build_print_files(
    raster_bytes=None,
    svg_text=None,
    width=None,
    height=None,
    unit="in",
    color_map=None,
    output_color_mode="cmyk",
):
    """Build print-ready SVG text and AI (PDF-compatible) bytes.

    Priority:
    1. Native vector SVG text (text/shapes only, optional)
    2. Server-side trace from PNG (vtracer -> potracer -> Pillow)

    When output_color_mode is 'cmyk', hex/rgb fills are converted to
    device-cmyk() using color_map (palette CMYK values when available).
    """
    from odoo.addons.tus_product_personalizer.utils.color_conversion import (
        apply_cmyk_colors_to_svg,
    )

    result = {"svg": None, "ai": None}
    svg = None

    if svg_text and is_native_vector_svg(svg_text):
        svg = apply_print_dimensions(svg_text.strip(), width, height, unit)
    elif raster_bytes:
        prepared = prepare_raster(raster_bytes, crop=True)
        if not prepared:
            _logger.warning("No raster content to trace for print SVG")
            return result
        try:
            traced = trace_raster_to_svg(prepared)
        except Exception as exc:
            _logger.exception("Vector tracing failed: %s", exc)
            return result
        if traced:
            traced = sanitize_print_svg(traced)
            try:
                from PIL import Image
                img = Image.open(io.BytesIO(prepared))
                vb_w, vb_h = img.size
            except Exception:
                vb_w, vb_h = _print_pixel_size(width, height, unit)
            svg = apply_print_dimensions(traced, width, height, unit, vb_w, vb_h)

    if not svg:
        return result

    if output_color_mode == "cmyk":
        svg = apply_cmyk_colors_to_svg(svg, color_map=color_map or {})

    result["svg"] = svg
    try:
        result["ai"] = svg_to_ai_bytes(svg)
    except ImportError:
        _logger.warning("cairosvg not installed; AI export skipped")
    except Exception as exc:
        _logger.exception("SVG to AI conversion failed: %s", exc)

    return result
