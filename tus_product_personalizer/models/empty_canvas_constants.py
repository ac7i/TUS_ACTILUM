# Empty-canvas defaults used when no product-specific options are available.

DEFAULT_EMPTY_CANVAS_FINISH = "transparent"
DEFAULT_EMPTY_CANVAS_PRINT_QUALITY = "good_600x600"
DEFAULT_EMPTY_CANVAS_PRINT_MODE = "color_only"

EMPTY_CANVAS_MAX_MARGIN_MM = 30.0
EMPTY_CANVAS_MARGIN_SIDES = ("front", "back", "left", "right")

LEGACY_MACHINING_CODE_MAP = {
    "folding": "machining_folding",
    "cutting": "machining_cutting",
    "corner_drilling": "machining_corner_drilling",
}


def selection_or_default(value, allowed, default):
    """Return a validated selection key or the configured default."""
    if isinstance(value, str) and value in allowed:
        return value
    return default


def bool_from_param(value):
    """Coerce URL params, hidden inputs, and JSON booleans to bool."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.lower() in ("1", "true", "yes", "on")
    return bool(value)


def _fallback_allowed_keys():
    return {
        "finish": frozenset({DEFAULT_EMPTY_CANVAS_FINISH}),
        "print_quality": frozenset({DEFAULT_EMPTY_CANVAS_PRINT_QUALITY}),
        "print_mode": frozenset({DEFAULT_EMPTY_CANVAS_PRINT_MODE}),
        "machining": frozenset(LEGACY_MACHINING_CODE_MAP.keys()),
        "defaults": {
            "finish": DEFAULT_EMPTY_CANVAS_FINISH,
            "print_quality": DEFAULT_EMPTY_CANVAS_PRINT_QUALITY,
            "print_mode": DEFAULT_EMPTY_CANVAS_PRINT_MODE,
        },
    }


def empty_canvas_product_options_payload(product_tmpl=None, env=None):
    """Serializable option lists for the storefront product page."""
    if product_tmpl and env:
        return env["editor.canvas.product.option"]._payload_for_product(product_tmpl)
    return {
        "finish": {
            "default": DEFAULT_EMPTY_CANVAS_FINISH,
            "options": [],
        },
        "print_quality": {
            "default": DEFAULT_EMPTY_CANVAS_PRINT_QUALITY,
            "options": [],
        },
        "print_mode": {
            "default": DEFAULT_EMPTY_CANVAS_PRINT_MODE,
            "options": [],
        },
        "machining": [],
    }


def _allowed_keys_for_product(product_tmpl=None, env=None):
    if product_tmpl and env:
        return env["editor.canvas.product.option"]._allowed_keys_for_product(product_tmpl)
    if env:
        return env["editor.canvas.product.option"]._allowed_keys_all_active()
    return _fallback_allowed_keys()


def _parse_machining_selection(params, allowed_machining):
    selected = set()

    raw_selection = params.get("machining_selection")
    if isinstance(raw_selection, str):
        selected.update(
            code.strip()
            for code in raw_selection.split(",")
            if code.strip() in allowed_machining
        )
    elif isinstance(raw_selection, (list, tuple, set)):
        selected.update(
            code for code in raw_selection if code in allowed_machining
        )

    for code in allowed_machining:
        legacy_field = LEGACY_MACHINING_CODE_MAP.get(code)
        if legacy_field and bool_from_param(params.get(legacy_field)):
            selected.add(code)
        dynamic_field = f"machining_{code}"
        if bool_from_param(params.get(dynamic_field)):
            selected.add(code)

    return sorted(selected)


def parse_empty_canvas_product_options(params, product_tmpl=None, env=None):
    """Parse and validate product-page option params from URL or JSON meta."""
    params = params or {}
    allowed = _allowed_keys_for_product(product_tmpl, env)
    defaults = allowed["defaults"]

    machining_selection = _parse_machining_selection(params, allowed["machining"])
    machining_by_code = {code: code in machining_selection for code in allowed["machining"]}

    return {
        "finish": selection_or_default(
            params.get("canvas_finish") or params.get("finish"),
            allowed["finish"],
            defaults["finish"],
        ),
        "print_quality": selection_or_default(
            params.get("canvas_print_quality") or params.get("print_quality"),
            allowed["print_quality"],
            defaults["print_quality"],
        ),
        "print_mode": selection_or_default(
            params.get("canvas_print_mode") or params.get("print_mode"),
            allowed["print_mode"],
            defaults["print_mode"],
        ),
        "machining_selection": machining_selection,
        "machining_by_code": machining_by_code,
        "machining_folding": "folding" in machining_selection,
        "machining_cutting": "cutting" in machining_selection,
        "machining_corner_drilling": "corner_drilling" in machining_selection,
    }


def normalize_empty_canvas_margin_mm(value, max_mm=EMPTY_CANVAS_MAX_MARGIN_MM):
    """Clamp a single uniform margin (mm) to the allowed range."""
    try:
        margin = float(value or 0)
    except (TypeError, ValueError):
        margin = 0.0
    return max(0.0, min(float(max_mm), margin))


def normalize_empty_canvas_margins_by_side(margins, max_mm=EMPTY_CANVAS_MAX_MARGIN_MM):
    """Normalize per-side margin map from JSON meta or URL params."""
    result = {side: 0.0 for side in EMPTY_CANVAS_MARGIN_SIDES}
    if not isinstance(margins, dict):
        return result
    for side in EMPTY_CANVAS_MARGIN_SIDES:
        result[side] = normalize_empty_canvas_margin_mm(margins.get(side), max_mm=max_mm)
    return result


def empty_canvas_line_vals_from_meta(meta, product_tmpl=None, env=None):
    """Map client empty_canvas meta to sale.order.line write values."""
    if not meta:
        return {}

    vals = {}
    if meta.get("width") and meta.get("height"):
        vals.update({
            "empty_canvas_width": float(meta.get("width") or 0),
            "empty_canvas_height": float(meta.get("height") or 0),
            "empty_canvas_unit": meta.get("unit") or "in",
            "empty_canvas_sides": meta.get("sides") or False,
            "empty_canvas_preset_id": int(meta["preset_id"]) if meta.get("preset_id") else False,
        })

    options = parse_empty_canvas_product_options(meta, product_tmpl=product_tmpl, env=env)
    machining_selection = options.get("machining_selection") or []
    vals.update({
        "empty_canvas_finish": options["finish"],
        "empty_canvas_print_quality": options["print_quality"],
        "empty_canvas_print_mode": options["print_mode"],
        "empty_canvas_machining_codes": ",".join(machining_selection),
        "empty_canvas_machining_folding": options["machining_folding"],
        "empty_canvas_machining_cutting": options["machining_cutting"],
        "empty_canvas_machining_corner_drilling": options["machining_corner_drilling"],
    })
    return vals
