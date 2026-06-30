# -*- coding: utf-8 -*-
"""Raster -> vector SVG and SVG -> AI (PDF-compatible) for print production.

Goal: print-ready, scalable vector art with a TRANSPARENT background and the
highest practical clarity. The professional tracer (vtracer) is used when
available; potracer / Pillow are fallbacks.
"""

import io
import logging
import re

_logger = logging.getLogger(__name__)

# Trace at print resolution. vtracer handles large images well; keeping this
# high is the single biggest factor for clarity. Only used to cap absurd sizes.
MAX_TRACE_PIXELS = 2600

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


def _print_pixel_size(width, height, unit, dpi=300):
    if width is None or height is None:
        return None, None
    unit_key = str(unit or "in").lower()
    if unit_key == "mm":
        return max(1, round(width * dpi / 25.4)), max(1, round(height * dpi / 25.4))
    if unit_key == "cm":
        return max(1, round(width * dpi / 2.54)), max(1, round(height * dpi / 2.54))
    if unit_key == "px":
        return max(1, int(width)), max(1, int(height))
    return max(1, round(width * dpi)), max(1, round(height * dpi))


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
