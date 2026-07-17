# -*- coding: utf-8 -*-
"""Shared area and finish pricing helpers for the personalizer."""

from __future__ import annotations

from odoo.addons.tus_product_personalizer.models.editor_texture import printed_area_m2
from odoo.addons.tus_product_personalizer.models.finish_constants import (
    DEFAULT_TEXTURE_INTENSITY,
    TEXTURE_INTENSITY_VALUES,
)

_UNIT_TO_MM = {
    "in": 25.4,
    "inch": 25.4,
    "mm": 1.0,
    "millimeter": 1.0,
    "cm": 10.0,
    "centimeter": 10.0,
    "ft": 304.8,
}


def canvas_area_m2(width: float, height: float, unit: str = "in", margin_mm: float = 0.0) -> float:
    """Return printable canvas area in m²."""
    return printed_area_m2(width, height, unit, margin_mm)


def object_footprint_m2(
    obj_width_px: float,
    obj_height_px: float,
    canvas_width_px: float,
    canvas_height_px: float,
    canvas_width: float,
    canvas_height: float,
    unit: str = "in",
) -> float:
    """Convert an object's axis-aligned canvas footprint to physical m².

    Rotation does not inflate the charged area: callers should pass the
    unrotated (or scale-only) width/height of the object in canvas pixels.
    """
    if (
        obj_width_px <= 0
        or obj_height_px <= 0
        or canvas_width_px <= 0
        or canvas_height_px <= 0
        or canvas_width <= 0
        or canvas_height <= 0
    ):
        return 0.0
    ratio_w = float(obj_width_px) / float(canvas_width_px)
    ratio_h = float(obj_height_px) / float(canvas_height_px)
    phys_w = float(canvas_width) * ratio_w
    phys_h = float(canvas_height) * ratio_h
    return printed_area_m2(phys_w, phys_h, unit, margin_mm=0.0)


def compute_area_base_price(area_m2: float, rate_per_m2: float, minimum_charge: float = 0.0) -> float:
    """Return max(minimum, area × rate)."""
    area_m2 = max(0.0, float(area_m2 or 0.0))
    rate = max(0.0, float(rate_per_m2 or 0.0))
    minimum = max(0.0, float(minimum_charge or 0.0))
    return max(minimum, area_m2 * rate)


def normalize_texture_intensity(value) -> str:
    intensity = str(value or "").strip()
    if intensity in TEXTURE_INTENSITY_VALUES:
        return intensity
    return DEFAULT_TEXTURE_INTENSITY


def emboss_rate_for_intensity(product_tmpl, intensity) -> float:
    """Look up the product €/m² emboss rate for a texture intensity key."""
    if not product_tmpl:
        return 0.0
    key = normalize_texture_intensity(intensity).replace(".", "_")
    field_name = f"personalizer_emboss_price_{key}"
    return max(0.0, float(getattr(product_tmpl, field_name, 0.0) or 0.0))


def varnish_rate_for_type(product_tmpl, varnish_type: str) -> float:
    """Look up the product €/m² varnish rate for gloss/satin."""
    if not product_tmpl:
        return 0.0
    varnish_type = (varnish_type or "none").strip().lower()
    if varnish_type == "gloss":
        return max(0.0, float(product_tmpl.personalizer_varnish_gloss_price_per_m2 or 0.0))
    if varnish_type == "satin":
        return max(0.0, float(product_tmpl.personalizer_varnish_satin_price_per_m2 or 0.0))
    return 0.0


def compute_finish_surcharge_from_objects(product_tmpl, finish_objects) -> dict:
    """Sum emboss/varnish surcharges for object footprint payloads.

    Each item in ``finish_objects`` should provide:
    - area_m2 (float)
    - tusTextureActive / emboss (bool)
    - tusTextureIntensityMm (str)
    - tusVarnishType (str)
    """
    emboss_total = 0.0
    varnish_total = 0.0
    details = []
    for item in finish_objects or []:
        if not isinstance(item, dict):
            continue
        area_m2 = max(0.0, float(item.get("area_m2") or 0.0))
        if area_m2 <= 0:
            continue
        texture_active = bool(item.get("tusTextureActive") or item.get("emboss"))
        intensity = normalize_texture_intensity(item.get("tusTextureIntensityMm"))
        varnish_type = str(item.get("tusVarnishType") or "none").strip().lower()
        emboss_price = 0.0
        varnish_price = 0.0
        if texture_active and product_tmpl and product_tmpl.personalizer_enable_finish_texture:
            rate = emboss_rate_for_intensity(product_tmpl, intensity)
            emboss_price = area_m2 * rate
            emboss_total += emboss_price
        if (
            varnish_type in ("gloss", "satin")
            and product_tmpl
            and product_tmpl.personalizer_enable_finish_varnish
        ):
            rate = varnish_rate_for_type(product_tmpl, varnish_type)
            varnish_price = area_m2 * rate
            varnish_total += varnish_price
        if emboss_price or varnish_price:
            details.append({
                "area_m2": area_m2,
                "intensity": intensity if texture_active else False,
                "varnish_type": varnish_type if varnish_type in ("gloss", "satin") else False,
                "emboss_price": emboss_price,
                "varnish_price": varnish_price,
            })
    return {
        "emboss_price": emboss_total,
        "varnish_price": varnish_total,
        "finish_price": emboss_total + varnish_total,
        "details": details,
    }


def quote_area_base_price(product_tmpl, width: float, height: float, unit: str = "in", margin_mm: float = 0.0) -> dict:
    """Build an authoritative area-pricing quote for a canvas size."""
    area_m2 = canvas_area_m2(width, height, unit, margin_mm)
    enabled = bool(product_tmpl and product_tmpl.personalizer_enable_area_pricing)
    rate = float(product_tmpl.personalizer_area_price_per_m2 or 0.0) if enabled and product_tmpl else 0.0
    minimum = float(product_tmpl.personalizer_area_min_charge or 0.0) if enabled and product_tmpl else 0.0
    amount = compute_area_base_price(area_m2, rate, minimum) if enabled else 0.0
    return {
        "enabled": enabled,
        "area_m2": area_m2,
        "rate_per_m2": rate,
        "minimum_charge": minimum,
        "amount": amount,
    }
