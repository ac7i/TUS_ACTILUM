# -*- coding: utf-8 -*-
"""RGB/hex ↔ CMYK conversion for print production."""

import re

_HEX6_RE = re.compile(r"^#?([0-9a-fA-F]{6})$")
_HEX3_RE = re.compile(r"^#?([0-9a-fA-F]{3})$")
_HEX_ATTR_RE = re.compile(
    r'((?:fill|stroke)=(["\']))#([0-9a-fA-F]{3,8})\2',
    re.IGNORECASE,
)
_RGB_ATTR_RE = re.compile(
    r'((?:fill|stroke)=(["\']))rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)\2',
    re.IGNORECASE,
)
_STYLE_HEX_RE = re.compile(
    r"((?:fill|stroke)\s*:\s*)#([0-9a-fA-F]{3,8})\b",
    re.IGNORECASE,
)


def normalize_hex(hex_color):
    """Return lowercase #RRGGBB or None."""
    if not hex_color or not isinstance(hex_color, str):
        return None
    value = hex_color.strip()
    match6 = _HEX6_RE.match(value)
    if match6:
        return f"#{match6.group(1).lower()}"
    match3 = _HEX3_RE.match(value)
    if match3:
        short = match3.group(1).lower()
        return f"#{short[0]}{short[0]}{short[1]}{short[1]}{short[2]}{short[2]}"
    return None


def hex_to_rgb_bytes(hex_color):
    """Return (r, g, b) as 0–255 ints."""
    normalized = normalize_hex(hex_color)
    if not normalized:
        return None
    body = normalized.lstrip("#")
    return int(body[0:2], 16), int(body[2:4], 16), int(body[4:6], 16)


def rgb_bytes_to_cmyk_percent(red, green, blue):
    """Standard RGB (0–255) to CMYK percent (0–100)."""
    r, g, b = red / 255.0, green / 255.0, blue / 255.0
    key = 1.0 - max(r, g, b)
    if key >= 1.0 - 1e-9:
        return 0.0, 0.0, 0.0, 100.0
    cyan = (1.0 - r - key) / (1.0 - key)
    magenta = (1.0 - g - key) / (1.0 - key)
    yellow = (1.0 - b - key) / (1.0 - key)
    return (
        round(cyan * 100.0, 2),
        round(magenta * 100.0, 2),
        round(yellow * 100.0, 2),
        round(key * 100.0, 2),
    )


def hex_to_cmyk_percent(hex_color):
    """Return (c, m, y, k) percent tuple from a hex color."""
    rgb = hex_to_rgb_bytes(hex_color)
    if not rgb:
        return 0.0, 0.0, 0.0, 100.0
    return rgb_bytes_to_cmyk_percent(*rgb)


def cmyk_percent_to_rgb_bytes(cyan, magenta, yellow, key):
    """Return (r, g, b) 0–255 from CMYK percent."""
    c, m, y, k = cyan / 100.0, magenta / 100.0, yellow / 100.0, key / 100.0
    r = round(255.0 * (1.0 - c) * (1.0 - k))
    g = round(255.0 * (1.0 - m) * (1.0 - k))
    b = round(255.0 * (1.0 - y) * (1.0 - k))
    return max(0, min(255, r)), max(0, min(255, g)), max(0, min(255, b))


def cmyk_percent_to_hex(cyan, magenta, yellow, key):
    r, g, b = cmyk_percent_to_rgb_bytes(cyan, magenta, yellow, key)
    return f"#{r:02x}{g:02x}{b:02x}"


def format_cmyk_display(cyan, magenta, yellow, key):
    """Human-readable CMYK string for production notes."""
    return (
        f"C{round(cyan):d} M{round(magenta):d} "
        f"Y{round(yellow):d} K{round(key):d}"
    )


def cmyk_tuple_from_palette(palette):
    """Extract CMYK percent tuple from an editor.color.palette record."""
    if not palette:
        return None
    return (
        palette.c_cyan or 0.0,
        palette.c_magenta or 0.0,
        palette.c_yellow or 0.0,
        palette.c_key or 0.0,
    )


def cmyk_display_from_palette(palette):
    if not palette:
        return ""
    if palette.pantone_code:
        return palette.pantone_code
    return palette.cmyk_display or format_cmyk_display(
        palette.c_cyan, palette.c_magenta, palette.c_yellow, palette.c_key
    )


def build_print_color_map(hex_colors=None, palette_records=None, all_palettes=None):
    """Build normalized hex → (c, m, y, k) percent map for print export."""
    color_map = {}
    palette_by_hex = {}
    for palette in (all_palettes or palette_records or []):
        normalized = normalize_hex(palette.color_code)
        if normalized:
            palette_by_hex[normalized] = palette

    for palette in (palette_records or []):
        normalized = normalize_hex(palette.color_code)
        if normalized:
            color_map[normalized] = cmyk_tuple_from_palette(palette)

    for palette in (all_palettes or []):
        normalized = normalize_hex(palette.color_code)
        if normalized and normalized not in color_map:
            color_map[normalized] = cmyk_tuple_from_palette(palette)

    for raw_hex in (hex_colors or []):
        normalized = normalize_hex(raw_hex)
        if not normalized or normalized in color_map:
            continue
        palette = palette_by_hex.get(normalized)
        if palette:
            color_map[normalized] = cmyk_tuple_from_palette(palette)
        else:
            color_map[normalized] = hex_to_cmyk_percent(normalized)

    return color_map


def cmyk_to_device_cmyk_css(cyan, magenta, yellow, key):
    """SVG/CSS device-cmyk() value (components 0–1)."""
    return (
        f"device-cmyk({cyan / 100.0:.4f} {magenta / 100.0:.4f} "
        f"{yellow / 100.0:.4f} {key / 100.0:.4f})"
    )


def _lookup_cmyk(normalized_hex, color_map):
    if normalized_hex in color_map:
        return color_map[normalized_hex]
    return hex_to_cmyk_percent(normalized_hex)


def _replace_hex_attr(match, color_map):
    attr, hex_value = match.group(1), match.group(3)
    normalized = normalize_hex(f"#{hex_value}")
    if not normalized:
        return match.group(0)
    c, m, y, k = _lookup_cmyk(normalized, color_map)
    return f'{attr}{cmyk_to_device_cmyk_css(c, m, y, k)}"'


def _replace_rgb_attr(match, color_map):
    attr = match.group(1)
    r, g, b = int(match.group(3)), int(match.group(4)), int(match.group(5))
    c, m, y, k = rgb_bytes_to_cmyk_percent(r, g, b)
    if color_map:
        approx_hex = normalize_hex(f"#{r:02x}{g:02x}{b:02x}")
        if approx_hex and approx_hex in color_map:
            c, m, y, k = color_map[approx_hex]
    return f'{attr}{cmyk_to_device_cmyk_css(c, m, y, k)}"'


def _replace_style_hex(match, color_map):
    prefix, hex_value = match.group(1), match.group(2)
    normalized = normalize_hex(f"#{hex_value}")
    if not normalized:
        return match.group(0)
    c, m, y, k = _lookup_cmyk(normalized, color_map)
    return f"{prefix}{cmyk_to_device_cmyk_css(c, m, y, k)}"


def apply_cmyk_colors_to_svg(svg_text, color_map=None):
    """Replace hex/rgb fill and stroke values with device-cmyk() for print."""
    if not svg_text:
        return svg_text
    color_map = color_map or {}
    text = svg_text
    text = _HEX_ATTR_RE.sub(lambda m: _replace_hex_attr(m, color_map), text)
    text = _RGB_ATTR_RE.sub(lambda m: _replace_rgb_attr(m, color_map), text)
    text = _STYLE_HEX_RE.sub(lambda m: _replace_style_hex(m, color_map), text)
    if 'color-profile' not in text.lower() and '<svg' in text:
        text = text.replace(
            "<svg",
            '<svg color-profile="CMYK"\n',
            1,
        )
    return text
