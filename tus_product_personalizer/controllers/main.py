import base64
import json
import logging
import os
import subprocess
import tempfile

from odoo import fields, http
from odoo.http import request
from odoo.tools.image import image_data_uri

from odoo.addons.tus_product_personalizer.models.finish_constants import (
    DEFAULT_FOIL_METAL,
    DEFAULT_RELIEF_MM,
)
from odoo.addons.tus_product_personalizer.models.empty_canvas_constants import (
    empty_canvas_line_vals_from_meta,
    empty_canvas_product_options_payload,
    normalize_empty_canvas_margin_mm,
    normalize_empty_canvas_margins_by_side,
    parse_empty_canvas_product_options,
)

_logger = logging.getLogger(__name__)

# Minimal 1x1 white PNG for empty-canvas QWeb placeholders.
_EMPTY_CANVAS_THUMB_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQ"
    "AAAABJRU5ErkJggg=="
)


class _DesignerCanvasProxy:
    """QWeb-friendly view stand-in for runtime empty-canvas payloads."""

    __slots__ = (
        'id', 'title', 'design_areas_json', 'stage_width', 'stage_height',
        'image_width', 'image_height', 'thumbnail',
    )

    def __init__(self, data):
        self.id = data.get('id')
        self.title = data.get('title')
        areas = data.get('design_areas_json')
        if isinstance(areas, str):
            try:
                areas = json.loads(areas)
            except (TypeError, ValueError):
                areas = []
        self.design_areas_json = areas or []
        self.stage_width = data.get('stage_width')
        self.stage_height = data.get('stage_height')
        self.image_width = data.get('image_width')
        self.image_height = data.get('image_height')
        thumb = data.get('thumbnail')
        if thumb:
            if isinstance(thumb, bytes):
                # Odoo Binary / image_data_uri expects base64 ascii bytes, not raw image bytes.
                self.thumbnail = thumb if thumb[:1] not in (b'\x89', b'\xff', b'GIF') else base64.b64encode(thumb)
            else:
                self.thumbnail = thumb
        else:
            self.thumbnail = _EMPTY_CANVAS_THUMB_B64.encode('ascii')

    def sudo(self):
        return self


def _safe_image_data_uri(binary_value=None):
    """Build a data URI for QWeb; empty binary fields are bool False in Odoo."""
    if binary_value:
        if isinstance(binary_value, str):
            binary_value = binary_value.encode('ascii')
        return image_data_uri(binary_value)
    return image_data_uri(_EMPTY_CANVAS_THUMB_B64.encode('ascii'))


def _get_product_image_uri(product, product_tmpl=None):
    if product and product.exists() and product.image_1920:
        return _safe_image_data_uri(product.image_1920)
    if product_tmpl and product_tmpl.exists() and product_tmpl.image_1920:
        return _safe_image_data_uri(product_tmpl.image_1920)
    return _safe_image_data_uri()


class ProductDesigner(http.Controller):

    @staticmethod
    def _strip_data_uri(value):
        """Return bare base64 payload from a possible data-URI string."""
        if not value:
            return False
        if isinstance(value, bytes):
            value = value.decode("utf-8", "ignore")
        if "," in value and value.strip().startswith("data:"):
            value = value.split(",", 1)[1]
        return value or False

    VALID_TEXTURE_INTENSITY = {"0.2", "0.3", "0.4", "0.5"}
    VALID_VARNISH_COVER_MODE = {"by_file", "all", "zones"}

    EMBOSS_FINISH_EFFECTS = frozenset({"emboss", "deboss", "foil_emboss"})

    def _apply_pricing_config(self, personalizer_config, product_tmpl_id):
        """Attach per-product area/finish pricing rates for designer live totals."""
        product_tmpl = request.env['product.template'].sudo().browse(int(product_tmpl_id))
        if product_tmpl.exists():
            personalizer_config['pricing'] = product_tmpl.get_personalizer_pricing_config()
        else:
            personalizer_config['pricing'] = {
                'enable_area_pricing': False,
                'area_price_per_m2': 0.0,
                'area_min_charge': 0.0,
                'emboss_prices': {},
                'varnish_prices': {},
            }
        return personalizer_config

    def _compute_area_base_quote(self, product_tmpl, empty_canvas_meta=None):
        from odoo.addons.tus_product_personalizer.utils.area_pricing import quote_area_base_price

        meta = empty_canvas_meta if isinstance(empty_canvas_meta, dict) else {}
        width = float(meta.get('width') or 0.0)
        height = float(meta.get('height') or 0.0)
        unit = meta.get('unit') or 'in'
        margins = meta.get('margins_by_side') or {}
        margin_mm = 0.0
        if margins:
            try:
                from odoo.addons.tus_product_personalizer.models.empty_canvas_constants import (
                    normalize_empty_canvas_margin_mm,
                )
                first_side = next(iter(margins.values()), None)
                margin_mm = normalize_empty_canvas_margin_mm(first_side)
            except Exception:
                margin_mm = float(meta.get('margin_mm') or 0.0)
        return quote_area_base_price(product_tmpl, width, height, unit, margin_mm)

    def _extract_finish_objects_from_design(self, design, empty_canvas_meta=None):
        """Build object finish footprints for surcharge calculation."""
        from odoo.addons.tus_product_personalizer.utils.area_pricing import object_footprint_m2

        meta = empty_canvas_meta if isinstance(empty_canvas_meta, dict) else {}
        canvas_w = float(meta.get('width') or 0.0)
        canvas_h = float(meta.get('height') or 0.0)
        unit = meta.get('unit') or 'in'
        finish_objects = []
        for side_obj in design or []:
            stage_w = float(side_obj.get('stage_width') or side_obj.get('canvas_width') or 0.0)
            stage_h = float(side_obj.get('stage_height') or side_obj.get('canvas_height') or 0.0)
            side_meta = side_obj.get('empty_canvas') or meta
            side_w = float(side_meta.get('width') or canvas_w or 0.0)
            side_h = float(side_meta.get('height') or canvas_h or 0.0)
            side_unit = side_meta.get('unit') or unit
            for area in side_obj.get('active_areas') or []:
                area_stage_w = float(area.get('width') or stage_w or 0.0)
                area_stage_h = float(area.get('height') or stage_h or 0.0)
                for canvas_val in area.get('canvas_vals') or []:
                    if not isinstance(canvas_val, dict):
                        continue
                    texture_active = bool(canvas_val.get('tusTextureActive'))
                    varnish_type = str(canvas_val.get('tusVarnishType') or 'none').lower()
                    if not texture_active and varnish_type in ('none', '', 'false'):
                        continue
                    obj_w = float(
                        canvas_val.get('footprint_width')
                        or canvas_val.get('width')
                        or 0.0
                    )
                    obj_h = float(
                        canvas_val.get('footprint_height')
                        or canvas_val.get('height')
                        or 0.0
                    )
                    scale_x = abs(float(canvas_val.get('scaleX') or 1.0))
                    scale_y = abs(float(canvas_val.get('scaleY') or 1.0))
                    if not canvas_val.get('footprint_width'):
                        obj_w *= scale_x
                        obj_h *= scale_y
                    area_m2 = float(canvas_val.get('area_m2') or 0.0)
                    if area_m2 <= 0 and area_stage_w > 0 and area_stage_h > 0 and side_w > 0 and side_h > 0:
                        area_m2 = object_footprint_m2(
                            obj_w, obj_h, area_stage_w, area_stage_h, side_w, side_h, side_unit,
                        )
                    finish_objects.append({
                        'area_m2': area_m2,
                        'tusTextureActive': texture_active,
                        'tusTextureIntensityMm': canvas_val.get('tusTextureIntensityMm'),
                        'tusVarnishType': varnish_type,
                    })
        return finish_objects

    def _compute_finish_price_sum(self, product_tmpl, design, empty_canvas_meta=None, finish_objects=None):
        from odoo.addons.tus_product_personalizer.utils.area_pricing import (
            compute_finish_surcharge_from_objects,
        )

        objects = finish_objects
        if objects is None:
            objects = self._extract_finish_objects_from_design(design, empty_canvas_meta=empty_canvas_meta)
        return compute_finish_surcharge_from_objects(product_tmpl, objects)

    @classmethod
    def _finish_vals_from_side(cls, side_obj, enable_texture=True, enable_varnish=True):
        """Map client finish_settings (per print side) to orderline.design.upload fields.

        Product-level flags gate which groups are persisted so a manipulated
        client cannot store disabled finish data.
        """
        fs = side_obj.get("finish_settings") or {}
        vals = {
            "finish_varnish_type": "none",
            "finish_relief_mm": DEFAULT_RELIEF_MM,
        }

        if enable_texture:
            texture_active = bool(fs.get("textureActive"))
            texture_file = cls._strip_data_uri(fs.get("textureFile")) if texture_active else False
            intensity = str(fs.get("textureIntensityMm") or "").strip() if texture_active else ""
            intensity_ok = intensity in cls.VALID_TEXTURE_INTENSITY
            vals.update({
                "texture_process_file": texture_file,
                "texture_process_filename": (
                    fs.get("textureFileName") or False
                ) if texture_active else False,
                "texture_intensity_mm": intensity if intensity_ok else False,
            })
            if texture_active and intensity_ok:
                vals["finish_relief_mm"] = float(intensity)
            elif texture_active and fs.get("reliefMm") is not None:
                try:
                    vals["finish_relief_mm"] = float(fs.get("reliefMm"))
                except (TypeError, ValueError):
                    vals["finish_relief_mm"] = DEFAULT_RELIEF_MM

        if enable_varnish:
            cover_mode = fs.get("varnishCoverMode") or "all"
            if cover_mode not in cls.VALID_VARNISH_COVER_MODE:
                cover_mode = "all"
            varnish_type = fs.get("varnishType") or "none"
            vals.update({
                "finish_varnish_type": varnish_type if varnish_type in ("none", "gloss", "satin") else "none",
                "varnish_cover_mode": cover_mode,
                "varnish_area_file": cls._strip_data_uri(fs.get("varnishAreaFile"))
                if cover_mode == "by_file" else False,
                "varnish_area_filename": fs.get("varnishAreaFileName") or False
                if cover_mode == "by_file" else False,
                "varnish_zones_description": fs.get("varnishZonesDescription") or False
                if cover_mode == "zones" else False,
            })

        return vals

    @staticmethod
    def _finish_vals_from_canvas_val(canvas_val):
        """Map per-element finish keys from the designer to imprint design fields."""
        if not canvas_val:
            return {}
        effect = canvas_val.get("tusFinishEffect") or "none"
        varnish_type = canvas_val.get("tusVarnishType") or "none"
        texture_active = bool(canvas_val.get("tusTextureActive"))
        emboss_active = texture_active or effect in ProductDesigner.EMBOSS_FINISH_EFFECTS
        intensity = str(canvas_val.get("tusTextureIntensityMm") or "").strip()
        if emboss_active:
            if intensity in ProductDesigner.VALID_TEXTURE_INTENSITY:
                relief_mm = float(intensity)
            elif canvas_val.get("tusReliefMm") is not None:
                try:
                    relief_mm = float(canvas_val.get("tusReliefMm"))
                except (TypeError, ValueError):
                    relief_mm = DEFAULT_RELIEF_MM
            else:
                relief_mm = DEFAULT_RELIEF_MM
        else:
            relief_mm = DEFAULT_RELIEF_MM
        vals = {
            "tus_finish_effect": effect,
            "tus_relief_mm": relief_mm,
            "tus_varnish_type": varnish_type if varnish_type in ("none", "gloss", "satin") else "none",
        }
        if effect in ("foil", "foil_emboss"):
            vals["tus_foil_metal"] = canvas_val.get("tusFoilMetal") or DEFAULT_FOIL_METAL
        else:
            vals["tus_foil_metal"] = False
        return vals

    @staticmethod
    def _get_text_template_groups():
        return request.env["editor.text.template"].sudo().get_grouped_for_designer()

    @staticmethod
    def _get_texture_groups():
        return request.env["editor.texture"].sudo().get_grouped_for_designer()

    @staticmethod
    def _normalize_video_embed_url(url):
        """Convert common YouTube/Vimeo URLs to an embeddable iframe src."""
        url = (url or "").strip()
        if not url:
            return ""
        if "/embed/" in url or "player.vimeo.com" in url:
            return url
        if "youtu.be/" in url:
            video_id = url.rsplit("/", 1)[-1].split("?")[0]
            return f"https://www.youtube.com/embed/{video_id}" if video_id else url
        if "youtube.com/watch" in url:
            from urllib.parse import parse_qs, urlparse
            query = parse_qs(urlparse(url).query)
            video_id = (query.get("v") or [""])[0]
            return f"https://www.youtube.com/embed/{video_id}" if video_id else url
        if "vimeo.com/" in url and "player.vimeo.com" not in url:
            video_id = url.rstrip("/").rsplit("/", 1)[-1].split("?")[0]
            return f"https://player.vimeo.com/video/{video_id}" if video_id.isdigit() else url
        return url

    def _get_help_context_payload(self):
        help_content = request.env["product.personalizer.help"].sudo().get_active_for_designer()
        return {
            "help_content": help_content,
            "help_content_json": json.dumps(help_content, ensure_ascii=False),
        }

    def _get_personalizer_config(self):
        """Read feature toggles and theme from the current website for the editor UI"""
        website = request.env['website'].get_current_website()
        config = {
            'enable_swap': website.personalizer_enable_swap,
            'enable_text': website.personalizer_enable_text,
            'enable_image': website.personalizer_enable_image,
            'enable_layers': website.personalizer_enable_layers,
            'enable_templates': website.personalizer_enable_templates,
            'enable_text_templates': website.personalizer_enable_text_templates,
            'enable_preview': website.personalizer_enable_preview,
            'enable_3d_preview': website.personalizer_enable_3d_preview,
            'enable_texture': website.personalizer_enable_texture,
            'enable_download': website.personalizer_enable_download,
            'enable_share': website.personalizer_enable_share,
            'enable_help': website.personalizer_enable_help,
            'enable_shape': website.personalizer_enable_shape,
            'enable_matrix': website.personalizer_enable_matrix,
            'matrix_product_ids': website.personalizer_matrix_product_ids.ids,
            'enable_vdp': website.personalizer_enable_vdp,
            'vdp_product_ids': website.personalizer_vdp_product_ids.ids,
            'enable_design_price': website.personalizer_enable_design_price,
            'design_price_product_ids': website.personalizer_design_price_product_ids.ids,
            'enable_printing': website.personalizer_enable_printing,
            'printing_product_ids': website.personalizer_printing_product_ids.ids,
            'enable_ai': website.personalizer_enable_ai,
            'ai_image_count': website.personalizer_ai_image_count or 4,
            'print_color_mode': website.personalizer_print_color_mode or 'cmyk',
        }
        config.update(website.get_personalizer_theme_values())
        return config

    def _apply_show_3d_preview(self, personalizer_config, product_tmpl_id):
        """Merge global + per-product 3D flags into runtime config for the designer."""
        product_tmpl = request.env['product.template'].sudo().browse(int(product_tmpl_id))
        personalizer_config['show_3d_preview'] = bool(
            personalizer_config.get('enable_3d_preview')
            and product_tmpl.exists()
            and product_tmpl.personalizer_enable_3d_preview
        )
        return personalizer_config

    def _apply_show_texture(self, personalizer_config, product_tmpl_id):
        """Merge global + per-product texture flags into runtime config for the designer."""
        product_tmpl = request.env['product.template'].sudo().browse(int(product_tmpl_id))
        personalizer_config['show_texture'] = bool(
            personalizer_config.get('enable_texture')
            and product_tmpl.exists()
            and product_tmpl.personalizer_enable_texture
        )
        return personalizer_config

    def _apply_show_finish_effects(self, personalizer_config, product_tmpl_id):
        """Merge per-product texture/varnish finish flags into runtime config.

        These drive the designer Print Finish panel (customer file uploads +
        emboss intensity + varnish coverage). They are independent of the admin
        Texture Library (canvas background) feature.
        """
        product_tmpl = request.env['product.template'].sudo().browse(int(product_tmpl_id))
        show_texture = bool(product_tmpl.exists() and product_tmpl.personalizer_enable_finish_texture)
        show_varnish = bool(product_tmpl.exists() and product_tmpl.personalizer_enable_finish_varnish)
        personalizer_config['show_finish_texture'] = show_texture
        personalizer_config['show_finish_varnish'] = show_varnish
        personalizer_config['show_finish_tool'] = show_texture or show_varnish
        return personalizer_config

    EMPTY_CANVAS_STAGE_MAX = 394
    EMPTY_CANVAS_ALLOWED_UNITS = {'in', 'mm', 'cm', 'inch', 'millimeter', 'centimeter'}
    EMPTY_CANVAS_SIDES_MAP = {
        'front': ['front'],
        'back': ['back'],
        'both': ['front', 'back'],
    }

    @staticmethod
    def _normalize_canvas_unit(unit):
        unit = (unit or 'in').lower()
        if unit in ('inch', 'in'):
            return 'in'
        if unit in ('millimeter', 'mm'):
            return 'mm'
        if unit in ('centimeter', 'cm'):
            return 'cm'
        return unit

    def _compute_empty_canvas_stage(self, width, height):
        width = float(width)
        height = float(height)
        if width <= 0 or height <= 0:
            return 394, 394
        max_edge = max(width, height)
        scale = self.EMPTY_CANVAS_STAGE_MAX / max_edge
        return round(width * scale), round(height * scale)

    def _resolve_empty_canvas_dimensions(self, product_tmpl, canvas_w, canvas_h, canvas_unit,
                                         preset_id=None):
        """Validate and return physical canvas dimensions for empty-canvas mode."""
        Preset = request.env['editor.canvas.preset'].sudo()
        width = height = None
        unit = self._normalize_canvas_unit(canvas_unit)
        preset = Preset.browse(int(preset_id)) if preset_id else Preset

        if preset_id and preset.exists():
            if product_tmpl.empty_canvas_preset_ids and preset not in product_tmpl.empty_canvas_preset_ids:
                return {'error': 'invalid_preset'}
            width = preset.width
            height = preset.height
            unit = preset.unit
        else:
            try:
                width = float(canvas_w)
                height = float(canvas_h)
            except (TypeError, ValueError):
                return {'error': 'invalid_dimensions'}
            if not product_tmpl.empty_canvas_allow_custom:
                return {'error': 'custom_not_allowed'}
            min_size = product_tmpl.empty_canvas_custom_min or 0
            max_size = product_tmpl.empty_canvas_custom_max or 0
            longest = max(width, height)
            if min_size and longest < min_size:
                return {'error': 'below_min_size'}
            if max_size and longest > max_size:
                return {'error': 'above_max_size'}

        if unit not in ('in', 'mm', 'cm'):
            return {'error': 'invalid_unit'}
        if not width or not height or width <= 0 or height <= 0:
            return {'error': 'invalid_dimensions'}
        return {
            'width': width,
            'height': height,
            'unit': unit,
            'preset_id': preset.id if preset_id and preset.exists() else False,
        }

    def _build_empty_canvas_views(self, width, height, unit, sides):
        stage_w, stage_h = self._compute_empty_canvas_stage(width, height)
        area = {
            'id': 'full',
            'name': 'Canvas',
            'shape': 'rect',
            'left': 0,
            'top': 0,
            'width': stage_w,
            'height': stage_h,
            'meta': {
                'actual': {
                    'width': float(width),
                    'height': float(height),
                    'unit': self._normalize_canvas_unit(unit),
                },
            },
        }
        views = []
        for side in self.EMPTY_CANVAS_SIDES_MAP.get(sides, ['front']):
            views.append({
                'id': f'empty_{side}',
                'title': side,
                'design_areas_json': [area],
                'stage_width': stage_w,
                'stage_height': stage_h,
                'image_width': stage_w,
                'image_height': stage_h,
                'thumbnail': None,
            })
        return views

    def _wrap_designer_canvas_views(self, views):
        """Normalize dict payloads for QWeb (empty canvas) while leaving records as-is."""
        wrapped = []
        for view in views or []:
            if isinstance(view, dict):
                wrapped.append(_DesignerCanvasProxy(view))
            else:
                wrapped.append(view)
        return wrapped

    def _get_empty_canvas_presets_payload(self, product_tmpl):
        Preset = request.env['editor.canvas.preset'].sudo()
        presets = product_tmpl.empty_canvas_preset_ids or Preset.search([('active', '=', True)])
        presets = presets.filtered('active').sorted(lambda p: (p.sequence, p.id))
        return [{
            'id': preset.id,
            'name': preset.name,
            'width': preset.width,
            'height': preset.height,
            'unit': preset.unit,
            'label': preset.get_display_label(),
        } for preset in presets]

    def _get_product_unit_price(self, product, order=None):
        """Unit price for one item using the website / cart / partner pricelist."""
        product = product.sudo()
        pricelist = False
        if order and order.pricelist_id:
            pricelist = order.pricelist_id
        if not pricelist:
            website = request.env['website'].get_current_website()
            if website:
                pricelist = website._get_and_cache_current_pricelist()
        if not pricelist and request.env.user and not request.env.user._is_public():
            pricelist = request.env.user.partner_id.property_product_pricelist
        if pricelist:
            return pricelist._get_product_price(product, 1.0, uom=product.uom_id)
        return product.lst_price

    def _show_design_price_for_template(self, product_tmpl_id, personalizer_config=None):
        if personalizer_config is None:
            personalizer_config = self._get_personalizer_config()
        config_price_ids = personalizer_config.get('design_price_product_ids') or []
        return personalizer_config.get('enable_design_price') and (
            not config_price_ids or int(product_tmpl_id) in config_price_ids
        )

    def _compute_design_price_sum(self, design, product_tmpl_id, personalizer_config=None):
        if not design or not self._show_design_price_for_template(
            product_tmpl_id, personalizer_config=personalizer_config
        ):
            return 0.0
        seen_areas = set()
        design_price_sum = 0.0
        for side_obj in design:
            for area in side_obj.get('active_areas', []):
                area_key = f"{side_obj.get('side')}_{area.get('id')}"
                if area_key not in seen_areas:
                    design_price_sum += float(area.get('price') or 0.0)
                    seen_areas.add(area_key)
        return design_price_sum

    def _show_texture_for_template(self, product_tmpl_id, personalizer_config=None):
        if personalizer_config is None:
            personalizer_config = self._get_personalizer_config()
        product_tmpl = request.env['product.template'].sudo().browse(int(product_tmpl_id))
        return bool(
            personalizer_config.get('enable_texture')
            and product_tmpl.exists()
            and product_tmpl.personalizer_enable_texture
        )

    def _texture_dimensions_for_side(self, side, product_tmpl, empty_canvas_meta=None):
        meta = empty_canvas_meta if isinstance(empty_canvas_meta, dict) else {}
        if meta.get('width') and meta.get('height'):
            margins = meta.get('margins_by_side') or {}
            margin_mm = normalize_empty_canvas_margin_mm(margins.get(side))
            return (
                float(meta['width']),
                float(meta['height']),
                meta.get('unit') or 'in',
                margin_mm,
            )
        view = request.env['product.view'].sudo().search([
            ('product_template_id', '=', product_tmpl.id),
            ('title', '=', side),
            ('product_id', '=', False),
            ('attribute_value_id', '=', False),
        ], limit=1)
        if view and view.image_width and view.image_height:
            return float(view.image_width), float(view.image_height), 'in', 0.0
        return 0.0, 0.0, 'in', 0.0

    def _compute_texture_price_sum(
        self, texture_by_side, product_tmpl, empty_canvas_meta=None, personalizer_config=None,
    ):
        if not texture_by_side or not self._show_texture_for_template(
            product_tmpl.id, personalizer_config=personalizer_config,
        ):
            return 0.0
        Texture = request.env['editor.texture'].sudo()
        total = 0.0
        for side, payload in texture_by_side.items():
            if not payload or not payload.get('texture_id'):
                continue
            texture = Texture.browse(int(payload['texture_id']))
            if not texture.exists() or not texture.active:
                continue
            width, height, unit, margin_mm = self._texture_dimensions_for_side(
                side, product_tmpl, empty_canvas_meta=empty_canvas_meta,
            )
            if width <= 0 or height <= 0:
                continue
            price, _area = texture.compute_price_for_area(width, height, unit, margin_mm)
            total += price
        return total

    def _compute_printing_unit_cost(self, printing_method, total_order_qty):
        if not printing_method or not printing_method.exists() or total_order_qty <= 0:
            return 0.0
        total_order_qty = max(1, int(total_order_qty))
        return printing_method.unit_cost + (printing_method.setup_cost / total_order_qty)

    def _compute_printing_order_total(self, printing_method, total_order_qty):
        """Total printing for the whole order: setup once + unit × total qty."""
        if not printing_method or not printing_method.exists() or total_order_qty <= 0:
            return 0.0
        total_order_qty = max(1, int(total_order_qty))
        return printing_method.setup_cost + (printing_method.unit_cost * total_order_qty)

    def _resolve_line_base_price(self, product, order=None, **kwargs):
        """Garment/base unit price: area quote when enabled, otherwise pricelist."""
        empty_canvas_meta = kwargs.get('empty_canvas_meta') or {}
        product_tmpl = product.product_tmpl_id
        if product_tmpl.personalizer_enable_area_pricing and empty_canvas_meta.get('width') and empty_canvas_meta.get('height'):
            quote = self._compute_area_base_quote(product_tmpl, empty_canvas_meta=empty_canvas_meta)
            if quote.get('enabled'):
                return float(quote.get('amount') or 0.0)
        return self._get_product_unit_price(product, order=order)

    def _get_charge_product(self, xml_id, fallback_name):
        product = request.env.ref(xml_id, raise_if_not_found=False)
        if not product:
            product = request.env['product.product'].sudo().search(
                [('name', '=', fallback_name)], limit=1
            )
        return product

    def _create_custom_sale_line(self, vals):
        """Create SO line with a fixed unit price (Odoo 18 sale recomputation-safe)."""
        vals = dict(vals)
        price = vals.get('price_unit')
        if price is not None:
            vals['technical_price_unit'] = vals.get('technical_price_unit', price)
        line = request.env['sale.order.line'].sudo().create(vals)
        if price is not None and not line.currency_id.is_zero(line.price_unit - price):
            line.write({
                'price_unit': price,
                'technical_price_unit': price,
            })
        return line

    def _get_imprint_lookup_maps(self):
        """Cache palette and UoM lookups for batch design/imprint creation."""
        env = request.env
        palettes = env['editor.color.palette'].sudo().search([])
        palette_by_code = {p.color_code: p.id for p in palettes if p.color_code}
        cmyk_by_code = {}
        from odoo.addons.tus_product_personalizer.utils.color_conversion import normalize_hex
        for palette in palettes:
            normalized = normalize_hex(palette.color_code)
            if normalized:
                cmyk_by_code[normalized] = palette.cmyk_display or palette._format_cmyk_display()
                if palette.color_code and palette.color_code not in cmyk_by_code:
                    cmyk_by_code[palette.color_code] = cmyk_by_code[normalized]
        uom_by_name = {}
        for uom in env['uom.uom'].sudo().search([]):
            key = (uom.name or '').lower()
            if key and key not in uom_by_name:
                uom_by_name[key] = uom.id
        return palette_by_code, uom_by_name, cmyk_by_code

    def _resolve_imprint_cmyk(self, fill, imprint_cmyk=None, cmyk_by_code=None):
        """Return CMYK display string for an imprint color."""
        if imprint_cmyk:
            return imprint_cmyk
        if fill and cmyk_by_code and fill in cmyk_by_code:
            return cmyk_by_code[fill]
        if fill:
            from odoo.addons.tus_product_personalizer.utils.color_conversion import (
                format_cmyk_display,
                hex_to_cmyk_percent,
                normalize_hex,
            )
            normalized = normalize_hex(fill)
            if normalized and cmyk_by_code and normalized in cmyk_by_code:
                return cmyk_by_code[normalized]
            c, m, y, k = hex_to_cmyk_percent(fill)
            return format_cmyk_display(c, m, y, k)
        return False

    def _create_line_designs(
        self, line, design_data, palette_by_code=None, uom_by_name=None, cmyk_by_code=None,
        texture_by_side=None,
    ):
        """Create orderline design uploads and imprint rows for one sale line."""
        if palette_by_code is None or uom_by_name is None or cmyk_by_code is None:
            palette_by_code, uom_by_name, cmyk_by_code = self._get_imprint_lookup_maps()
        texture_by_side = texture_by_side or {}
        product_tmpl = line.product_id.product_tmpl_id
        enable_finish_texture = bool(product_tmpl.personalizer_enable_finish_texture)
        enable_finish_varnish = bool(product_tmpl.personalizer_enable_finish_varnish)
        Texture = request.env['editor.texture'].sudo()
        ImprintDesign = request.env['orderline.imprint.design'].sudo()
        for obj in design_data:
            canvas_vals_list = obj.get('canvas_vals') or []
            print_w = obj.get('width') or 0.0
            print_h = obj.get('height') or 0.0
            print_unit = obj.get('unit') or 'in'
            if not obj.get('empty_canvas') and len(canvas_vals_list) == 1:
                print_w = canvas_vals_list[0].get('width') or print_w
                print_h = canvas_vals_list[0].get('height') or print_h
                print_unit = canvas_vals_list[0].get('unit') or print_unit

            side = obj.get('side', False)
            side_texture = texture_by_side.get(side) or {}
            texture_vals = {}
            if side_texture.get('texture_id'):
                texture = Texture.browse(int(side_texture['texture_id']))
                if texture.exists():
                    texture_vals = {
                        'texture_id': texture.id,
                        'texture_name': texture.name,
                        'texture_area_m2': float(side_texture.get('area_m2') or 0.0),
                        'texture_price': float(side_texture.get('price') or 0.0),
                    }

            design_rec = request.env['orderline.design.upload'].sudo().create({
                'order_line': line.id,
                'order_id': line.order_id.id,
                'name': f"{obj.get('side', '')}_{line.name}",
                'uploaded_type': side,
                'uploaded_attachment': self._prepare_design_attachment(obj.get('data'))
                if obj.get('data') else False,
                'print_width': print_w,
                'print_height': print_h,
                'print_unit': print_unit,
                'canvas_background_color': obj.get('canvas_background') or '#ffffff',
                'empty_canvas_margin_mm': normalize_empty_canvas_margin_mm(
                    obj.get('empty_canvas_margin_mm')
                ),
                **self._finish_vals_from_side(
                    obj,
                    enable_texture=enable_finish_texture,
                    enable_varnish=enable_finish_varnish,
                ),
                **texture_vals,
            })

            unit = print_unit
            imprint_vals_list = []
            for d in canvas_vals_list:
                d['unit'] = unit
                imprint_attr = {k: v for k, v in d.items() if k != 'element_image'}
                vals = {
                    'design_id': design_rec.id,
                    'imprint_design_attribute': imprint_attr,
                    'imprint_colors': d.get('fill'),
                    'imprint_cmyk': self._resolve_imprint_cmyk(
                        d.get('fill'),
                        d.get('imprint_cmyk'),
                        cmyk_by_code,
                    ),
                    'imprint_image': base64.b64encode(
                        self.convert_odoo_compitable(d.get('element_image'))
                    ) if d.get('element_image') else False,
                    'imprint_width': d.get('width', 0.0),
                    'imprint_height': d.get('height', 0.0),
                    **self._finish_vals_from_canvas_val(d),
                }
                fill = d.get('fill')
                if fill and fill in palette_by_code:
                    vals['printable_color_id'] = palette_by_code[fill]
                if unit:
                    uom_id = uom_by_name.get(unit.lower())
                    if uom_id:
                        vals['imprint_width_uom'] = uom_id
                        vals['imprint_height_uom'] = uom_id
                imprint_vals_list.append(vals)
            if imprint_vals_list:
                ImprintDesign.create(imprint_vals_list)

    def _get_designer_context(self, product_tmpl_id, product_id=False, **extra):
        """Build QWeb context for the storefront product designer page."""
        forced_color_id = extra.pop("forced_color_id", None)
        canvas_w = extra.pop("canvas_w", None)
        canvas_h = extra.pop("canvas_h", None)
        canvas_unit = extra.pop("canvas_unit", None)
        canvas_sides = extra.pop("sides", None) or extra.pop("canvas_sides", None)
        canvas_preset_id = extra.pop("canvas_preset_id", None) or extra.pop("preset_id", None)
        margins_raw = extra.pop("empty_canvas_margins_json", None) or extra.pop("margins_by_side", None)
        product_tmpl = request.env['product.template'].sudo().browse(int(product_tmpl_id))
        product_options = parse_empty_canvas_product_options(
            extra,
            product_tmpl=product_tmpl,
            env=request.env,
        )
        if isinstance(margins_raw, str):
            try:
                margins_by_side = json.loads(margins_raw)
            except (TypeError, ValueError, json.JSONDecodeError):
                margins_by_side = {}
        elif isinstance(margins_raw, dict):
            margins_by_side = margins_raw
        else:
            margins_by_side = {}
        margins_by_side = normalize_empty_canvas_margins_by_side(margins_by_side)
        product = request.env["product.product"].sudo()
        resolved_product_id = product_id
        if product_id:
            product = product.browse(int(product_id))
            DesignerCanvas = product._get_effective_views()
        else:
            DesignerCanvas = request.env["product.view"].sudo().search([
                ("product_template_id", "=", product_tmpl_id),
                ("product_id", "=", False),
            ])
            product = product_tmpl.product_variant_id or product.search(
                [('product_tmpl_id', '=', product_tmpl_id)], limit=1,
            )
            resolved_product_id = product.id if product else False

        personalizer_config = self._get_personalizer_config()

        config_matrix_ids = personalizer_config.get('matrix_product_ids') or []
        show_matrix_table = (
            personalizer_config.get('enable_matrix')
            and (not config_matrix_ids or int(product_tmpl_id) in config_matrix_ids)
            and not product_tmpl.empty_canvas
        )

        config_price_ids = personalizer_config.get('design_price_product_ids') or []
        show_design_price = personalizer_config.get('enable_design_price') and (
            not config_price_ids or int(product_tmpl_id) in config_price_ids
        )

        config_printing_ids = personalizer_config.get('printing_product_ids') or []
        show_printing_methods = personalizer_config.get('enable_printing') and (
            not config_printing_ids or int(product_tmpl_id) in config_printing_ids
        )

        config_vdp_ids = personalizer_config.get('vdp_product_ids') or []
        show_vdp = bool(
            personalizer_config.get('enable_vdp')
            and product_tmpl.exists()
            and product_tmpl.personalizer_enable_vdp
            and not product_tmpl.empty_canvas
            and (not config_vdp_ids or int(product_tmpl_id) in config_vdp_ids)
        )

        empty_canvas_mode = bool(product_tmpl.empty_canvas)
        empty_canvas_dims = {}
        empty_canvas_views = []
        if empty_canvas_mode:
            empty_canvas_dims = self._resolve_empty_canvas_dimensions(
                product_tmpl, canvas_w, canvas_h, canvas_unit, canvas_preset_id,
            )
            if empty_canvas_dims.get('error'):
                empty_canvas_mode = False
            else:
                sides = canvas_sides if canvas_sides in self.EMPTY_CANVAS_SIDES_MAP else 'front'
                empty_canvas_views = self._build_empty_canvas_views(
                    empty_canvas_dims['width'],
                    empty_canvas_dims['height'],
                    empty_canvas_dims['unit'],
                    sides,
                )
                DesignerCanvas = self._wrap_designer_canvas_views(empty_canvas_views)
                show_matrix_table = False
                show_vdp = False
                show_printing_methods = False
                personalizer_config['enable_swap'] = True
                personalizer_config['empty_canvas_enable_design_templates'] = bool(
                    product_tmpl.empty_canvas_enable_design_templates
                )

        current_color_id = False
        if show_matrix_table:
            if forced_color_id:
                current_color_id = int(forced_color_id)
            elif product:
                color_val = product.product_template_attribute_value_ids.filtered(
                    lambda v: v.attribute_id.display_type == 'color'
                    or v.attribute_id.name.lower() in ['color', 'colour']
                )[:1]
                if color_val:
                    current_color_id = color_val.id

            if not current_color_id:
                color_line = request.env['product.template.attribute.line'].sudo().search([
                    ('product_tmpl_id', '=', product_tmpl_id),
                    '|', ('attribute_id.display_type', '=', 'color'), ('attribute_id.name', 'ilike', 'color')
                ], limit=1)
                if color_line:
                    val_ids = color_line.product_template_value_ids.ids
                    views_with_color = {
                        row['attribute_value_id'][0]
                        for row in request.env['product.view'].sudo().search_read(
                            [
                                ('product_template_id', '=', product_tmpl_id),
                                ('attribute_value_id', 'in', val_ids),
                            ],
                            ['attribute_value_id'],
                        )
                        if row.get('attribute_value_id')
                    }
                    for val in color_line.product_template_value_ids:
                        if val.id in views_with_color:
                            current_color_id = val.id
                            break
                    if not current_color_id and color_line.product_template_value_ids:
                        current_color_id = color_line.product_template_value_ids[0].id

        if show_matrix_table and current_color_id:
            color_views = request.env['product.view'].sudo().search([
                ('product_template_id', '=', product_tmpl_id),
                ('attribute_value_id', '=', current_color_id)
            ])
            if color_views:
                covered_titles = set(color_views.mapped('title'))
                template_views = request.env['product.view'].sudo().search([
                    ('product_template_id', '=', product_tmpl_id),
                    ('product_id', '=', False),
                    ('attribute_value_id', '=', False),
                ])
                for template_view in template_views:
                    if template_view.title not in covered_titles:
                        color_views |= template_view
                DesignerCanvas = color_views

        product_unit_price = (
            self._get_product_unit_price(product)
            if product and product.exists()
            else 0.0
        )
        if empty_canvas_mode and empty_canvas_dims.get('width') and empty_canvas_dims.get('height'):
            area_quote = self._compute_area_base_quote(
                product_tmpl,
                empty_canvas_meta={
                    'width': empty_canvas_dims.get('width'),
                    'height': empty_canvas_dims.get('height'),
                    'unit': empty_canvas_dims.get('unit'),
                    'margins_by_side': margins_by_side,
                },
            )
            if area_quote.get('enabled'):
                product_unit_price = float(area_quote.get('amount') or 0.0)

        personalizer_config = self._apply_show_3d_preview(personalizer_config, product_tmpl_id)
        personalizer_config = self._apply_show_texture(personalizer_config, product_tmpl_id)
        personalizer_config = self._apply_show_finish_effects(personalizer_config, product_tmpl_id)
        personalizer_config = self._apply_pricing_config(personalizer_config, product_tmpl_id)
        show_texture = personalizer_config.get('show_texture')

        product_template_ids = request.env["product.design.template"].sudo().search([
            ("product_tmpl_id", "=", product_tmpl_id),
            ("active", "=", True),
        ], order="sequence, id")
        default_product_template = product_template_ids.filtered("is_default")[:1]

        text_template_groups = self._get_text_template_groups()
        texture_groups = self._get_texture_groups() if show_texture else []

        context = {
            "share_is_owner": False,
            "product_tmpl_id": product_tmpl_id,
            "product_id": resolved_product_id,
            "product": product,
            "product_display_name": (
                product.display_name if product and product.exists()
                else product_tmpl.display_name
            ),
            "product_image_uri": _get_product_image_uri(product, product_tmpl),
            "product_unit_price": product_unit_price,
            "DesignerCanvas": DesignerCanvas,
            "product_template_ids": product_template_ids,
            "default_product_template_id": default_product_template.id if default_product_template else False,
            "text_template_groups": text_template_groups,
            "text_template_ids": [
                tpl for group in text_template_groups for tpl in group.templates
            ],
            "texture_groups": texture_groups,
            "texture_ids": [
                tex for group in texture_groups for tex in group.textures
            ],
            "design_ids": request.env["res.partner.design"].sudo().search([
                ("partner_id", "=", request.env.user.partner_id.id),
                ("product_id.product_tmpl_id", "=", product_tmpl_id)
            ]) if request.env.user.partner_id else [],
            "personalizer_config": personalizer_config,
            "personalizer_config_json": json.dumps(personalizer_config),
            "show_matrix_table": show_matrix_table,
            "show_vdp": show_vdp,
            "show_design_price": show_design_price,
            "show_texture": show_texture,
            "show_printing_methods": show_printing_methods,
            "current_color_id": current_color_id,
            "empty_canvas_mode": empty_canvas_mode,
            "empty_canvas_error": empty_canvas_dims.get('error') if product_tmpl.empty_canvas else False,
            "empty_canvas_width": empty_canvas_dims.get('width'),
            "empty_canvas_height": empty_canvas_dims.get('height'),
            "empty_canvas_unit": empty_canvas_dims.get('unit'),
            "empty_canvas_sides": canvas_sides if canvas_sides in self.EMPTY_CANVAS_SIDES_MAP else 'front',
            "empty_canvas_preset_id": empty_canvas_dims.get('preset_id'),
            "empty_canvas_finish": product_options["finish"],
            "empty_canvas_print_quality": product_options["print_quality"],
            "empty_canvas_print_mode": product_options["print_mode"],
            "empty_canvas_machining_folding": product_options["machining_folding"],
            "empty_canvas_machining_cutting": product_options["machining_cutting"],
            "empty_canvas_machining_corner_drilling": product_options["machining_corner_drilling"],
            "empty_canvas_machining_selection": json.dumps(product_options["machining_selection"]),
            "empty_canvas_enable_design_templates": bool(
                product_tmpl.empty_canvas_enable_design_templates
            ) if empty_canvas_mode else False,
            "empty_canvas_margins_json": json.dumps(margins_by_side),
            "custom_width": empty_canvas_dims.get('width'),
            "custom_height": empty_canvas_dims.get('height'),
        }
        context.update(self._get_help_context_payload())
        context.update(extra)
        return context

    # -------------------------------------------------------------------------
    # Share design helpers
    # -------------------------------------------------------------------------

    def _empty_canvas_kwargs_from_bundle(self, bundle, product_tmpl=None):
        """Extract empty-canvas sizing params stored in a design bundle."""
        if not isinstance(bundle, dict):
            return {}
        meta = bundle.get("empty_canvas") or {}
        if not meta.get("width") or not meta.get("height"):
            return {}
        params = {
            "canvas_w": meta.get("width"),
            "canvas_h": meta.get("height"),
            "canvas_unit": meta.get("unit") or "in",
            "canvas_sides": meta.get("sides") or "front",
        }
        if meta.get("preset_id"):
            params["canvas_preset_id"] = meta.get("preset_id")
        options = parse_empty_canvas_product_options(
            meta,
            product_tmpl=product_tmpl,
            env=request.env,
        )
        params.update({
            "canvas_finish": options["finish"],
            "canvas_print_quality": options["print_quality"],
            "canvas_print_mode": options["print_mode"],
            "machining_folding": "1" if options["machining_folding"] else "0",
            "machining_cutting": "1" if options["machining_cutting"] else "0",
            "machining_corner_drilling": "1" if options["machining_corner_drilling"] else "0",
            "machining_selection": ",".join(options["machining_selection"]),
        })
        margins = normalize_empty_canvas_margins_by_side(meta.get("margins_by_side") or {})
        params["empty_canvas_margins_json"] = json.dumps(margins)
        return params

    def _empty_canvas_kwargs_from_share(self, share):
        if not share or not share.design_bundle:
            return {}
        try:
            raw = base64.b64decode(share.design_bundle)
            bundle = json.loads(raw.decode("utf-8"))
        except (TypeError, ValueError, UnicodeDecodeError):
            return {}
        return self._empty_canvas_kwargs_from_bundle(bundle, product_tmpl=share.product_tmpl_id)

    def _get_active_share(self, token):
        if not token:
            return request.env["product.design.share"]
        return request.env["product.design.share"].sudo().search([
            ("access_token", "=", token),
            ("active", "=", True),
        ], limit=1)

    def _share_is_owner(self, share):
        user = request.env.user
        if not share or not share.partner_id or user._is_public():
            return False
        return share.partner_id == user.partner_id

    def _require_share_owner(self, share):
        if not share:
            return {"error": "not_found"}
        if not self._share_is_owner(share):
            return {"error": "unauthorized"}
        return None

    def _get_guest_acc_id(self, kw=None):
        kw = kw or {}
        acc_id = kw.get("acc") or request.session.get("share_guest_acc_id")
        try:
            return int(acc_id) if acc_id else False
        except (TypeError, ValueError):
            return False

    def _resolve_guest_access(self, share, acc_id):
        """Resolve guest access from acc id; permission always comes from DB."""
        if not acc_id:
            return None
        access_rec = request.env["product.design.share.access"].sudo().browse(acc_id)
        if not access_rec.exists() or access_rec.share_id.id != share.id:
            return None
        return {
            "can_read": True,
            "can_write": access_rec.access_mode == "edit",
            "resolved_mode": access_rec.access_mode,
            "is_owner": False,
            "guest_acc_id": acc_id,
        }

    def _set_guest_share_session(self, share, acc_id):
        access_rec = request.env["product.design.share.access"].sudo().browse(int(acc_id))
        if access_rec.exists() and access_rec.share_id.id == share.id:
            request.session["share_guest_acc_id"] = str(acc_id)
            request.session["share_guest_mode"] = access_rec.access_mode

    def _resolve_share_access(self, share, kw=None):
        """Resolve effective read/write access for the current request."""
        user = request.env.user
        is_owner = self._share_is_owner(share)
        kw = kw or {}
        acc_id = self._get_guest_acc_id(kw)

        if is_owner and not acc_id:
            return {
                "can_read": True,
                "can_write": True,
                "resolved_mode": "edit",
                "is_owner": True,
                "guest_acc_id": False,
            }

        if acc_id:
            guest = self._resolve_guest_access(share, acc_id)
            if guest:
                guest["is_owner"] = is_owner
                return guest

        resolved_mode = share.share_mode
        if share.restriction_type == "restricted":
            if user._is_public():
                return {
                    "can_read": False,
                    "can_write": False,
                    "resolved_mode": "view",
                    "is_owner": is_owner,
                    "guest_acc_id": False,
                }
            if not is_owner:
                user_email = (user.partner_id.email or user.email or "").strip().lower()
                access_entry = share.access_ids.filtered(
                    lambda a: (a.email or "").strip().lower() == user_email
                )
                if not access_entry:
                    return {
                        "can_read": False,
                        "can_write": False,
                        "resolved_mode": "view",
                        "is_owner": is_owner,
                        "guest_acc_id": False,
                    }
                resolved_mode = access_entry[0].access_mode
        elif not user._is_public() and is_owner:
            resolved_mode = "edit"

        return {
            "can_read": True,
            "can_write": resolved_mode == "edit",
            "resolved_mode": resolved_mode,
            "is_owner": is_owner,
            "guest_acc_id": False,
        }

    def _set_share_session(self, token, resolved_mode):
        request.session["active_share_token"] = token
        request.session["active_share_resolved_mode"] = resolved_mode

    def _clear_share_session(self):
        request.session.pop("active_share_token", None)
        request.session.pop("active_share_resolved_mode", None)
        request.session.pop("share_guest_mode", None)
        request.session.pop("share_guest_acc_id", None)

    def _require_share_write(self):
        token = request.session.get("active_share_token")
        if not token:
            return None
        share = self._get_active_share(token)
        if not share:
            self._clear_share_session()
            return {"error": "not_found"}
        access = self._resolve_share_access(share)
        if not access["can_write"]:
            return {"error": "read_only"}
        return None

    def _resolve_share_editor_name(self, share, access=None):
        """Human-readable name for last_saved_by on share snapshots."""
        access = access or self._resolve_share_access(share)
        acc_id = access.get("guest_acc_id")
        if acc_id:
            access_rec = request.env["product.design.share.access"].sudo().browse(int(acc_id))
            if access_rec.exists() and access_rec.share_id.id == share.id:
                return access_rec.email or "Guest"
        user = request.env.user
        if not user._is_public():
            return (
                user.partner_id.name
                or user.partner_id.email
                or user.email
                or "User"
            )
        return "Anonymous"

    def _share_meta_payload(self, share):
        """Version metadata for share data endpoints and page context."""
        saved_at = share.last_saved_at or share.write_date
        return {
            "bundle_version": share.bundle_version or 1,
            "last_saved_by": share.last_saved_by or "",
            "last_saved_at": fields.Datetime.to_string(saved_at) if saved_at else "",
        }

    @http.route(
        ["/product/designer/<int:product_tmpl_id>"],
        type="http",
        auth="public",
        website=True,
        csrf=False
    )
    def openProductTemplateDesigner(self, product_tmpl_id, **kw):
        '''
        Open product designer for product template.
        Uses effective views: variant overrides if the variant is
        customized, otherwise falls back to template master views.
        '''
        self._clear_share_session()
        raw_product_id = kw.pop("product_id", None)
        product_id = int(raw_product_id) if raw_product_id else False
        return request.render(
            "tus_product_personalizer.product_design_customize",
            self._get_designer_context(product_tmpl_id, product_id, **kw),
        )

    @http.route(
        ["/product/designer/edit/<int:sale_order_line_id>"],
        type="http",
        auth="public",
        website=True,
        csrf=False,
    )
    def open_cart_design_editor(self, sale_order_line_id, **kw):
        """Reopen the designer for a personalized line that belongs to the current cart."""
        order = request.cart
        line = request.env["sale.order.line"].sudo().browse(int(sale_order_line_id))
        if (
            not order
            or not line.exists()
            or line.order_id.id != order.id
            or not line._is_personalizer_line()
        ):
            return request.redirect("/shop/cart")

        product = line.product_id
        product_tmpl = product.product_tmpl_id
        bundle = {}
        if line.personalizer_design_bundle:
            try:
                bundle = json.loads(line.personalizer_design_bundle)
            except (TypeError, ValueError, json.JSONDecodeError):
                bundle = {}

        extra = self._empty_canvas_kwargs_from_bundle(bundle, product_tmpl=product_tmpl)
        if line.empty_canvas_width and line.empty_canvas_height:
            extra.setdefault("canvas_w", line.empty_canvas_width)
            extra.setdefault("canvas_h", line.empty_canvas_height)
            extra.setdefault("canvas_unit", line.empty_canvas_unit or "mm")
            extra.setdefault("canvas_sides", line.empty_canvas_sides or "front")
            if line.empty_canvas_preset_id:
                extra.setdefault("canvas_preset_id", line.empty_canvas_preset_id.id)

        context = self._get_designer_context(product_tmpl.id, product.id, **extra)
        context.update({
            "from_cart_edit": True,
            "sale_order_line": line,
            "cart_edit_line_id": line.id,
            "cart_design_bundle_json": line.personalizer_design_bundle or "",
        })
        return request.render(
            "tus_product_personalizer.product_design_customize",
            context,
        )

    @http.route(
        ["/custom/design/save"],
        type="json",
        auth="public",
        methods=["POST"],
        website=True,
        csrf=False,
    )
    def custom_design_save(self, **post):
        write_err = self._require_share_write()
        if write_err:
            return write_err
        product_id = (
            request.env["product.product"].sudo().browse(int(post.get("product_id")))
        )
        design_name = (
                product_id.name
                + "_"
                + request.env["ir.sequence"].sudo().next_by_code("design.upload.sequence")
        )

        base64_encoded = base64.b64encode(
            post.get("uploaded_attachment").encode("utf-8")
        ).decode("utf-8")
        contact_design_id = (
            request.env["res.partner.design"]
            .sudo()
            .create(
                {
                    "partner_id": request.env.user.partner_id.id
                    if request.env.user.partner_id
                    else False,
                    "product_id": product_id.id,
                    "uploaded_attachment": base64_encoded,
                    "view_image": base64.b64encode(
                        self.convert_odoo_compitable(post.get("view_image"))
                    ).decode()
                    if post.get("view_image", False)
                    else False,
                    "name": design_name,
                }
            )
        )

        product_design_image = request.env["ir.ui.view"]._render_template(
            "tus_product_personalizer.product_design_image",
            {"design_id": contact_design_id},
        )
        return {"product_design_image": product_design_image}

    @http.route(
        ["/custom/design/share"],
        type="json",
        auth="public",
        methods=["POST"],
        website=True,
        csrf=False,
    )
    def custom_design_share(self, **post):
        user = request.env.user
        if user._is_public():
            return {"error": "login_required"}

        session_token = request.session.get("active_share_token")
        if session_token:
            session_share = self._get_active_share(session_token)
            if session_share and not self._share_is_owner(session_share):
                return {"error": "unauthorized"}

        product = request.env["product.product"].sudo().browse(int(post.get("product_id") or 0))
        if not product.exists():
            return {"error": "invalid_product"}

        design_bundle = post.get("design_bundle") or ""
        if not design_bundle.strip():
            return {"error": "empty_design"}

        color_id = post.get("color_id")
        use_matrix = post.get("use_matrix")
        if not color_id and use_matrix:
            try:
                color_id = json.loads(design_bundle).get("color_id")
            except (TypeError, ValueError):
                color_id = False
        elif not use_matrix:
            color_id = False

        views = request.env["product.view"].sudo().search([
            ("product_template_id", "=", product.product_tmpl_id.id),
        ], limit=1)
        if not product.product_tmpl_id.empty_canvas and not views:
            return {"error": "no_designer_views"}

        share_mode = post.get("share_mode") or "edit"
        bundle_b64 = base64.b64encode(design_bundle.encode("utf-8")).decode("utf-8")
        preview_b64 = (
            base64.b64encode(
                self.convert_odoo_compitable(post.get("preview_image"))
            ).decode("utf-8") if post.get("preview_image") else False
        )
        share_vals = {
            "product_id": product.id,
            "color_attribute_value_id": int(color_id) if color_id else False,
            "share_mode": share_mode,
        }

        token = post.get("token")
        share = self._get_active_share(token) if token else request.env["product.design.share"]

        if share:
            owner_err = self._require_share_owner(share)
            if owner_err:
                return owner_err
            share.write(share_vals)
            saved_by = self._resolve_share_editor_name(share)
            bundle_version = share.write_design_snapshot(
                bundle_b64, preview_b64, saved_by=saved_by
            )
        else:
            editor_name = (
                user.partner_id.name
                or user.partner_id.email
                or user.email
                or "Owner"
            )
            share_vals.update({
                "partner_id": user.partner_id.id,
                "design_bundle": bundle_b64,
                "preview_image": preview_b64,
                "bundle_version": 1,
                "last_saved_at": fields.Datetime.now(),
                "last_saved_by": editor_name,
            })
            share = request.env["product.design.share"].sudo().create(share_vals)
            bundle_version = share.bundle_version

        base_url = request.httprequest.url_root.rstrip("/")
        share_url = f"{base_url}/product/designer/share/{share.access_token}"
        meta = self._share_meta_payload(share)
        return {
            "share_url": share_url,
            "token": share.access_token,
            "bundle_version": bundle_version,
            "saved_at": meta["last_saved_at"],
            "saved_by": meta["last_saved_by"],
        }

    @http.route(
        ["/custom/design/share/save"],
        type="json",
        auth="public",
        methods=["POST"],
        website=True,
        csrf=False,
    )
    def custom_design_share_save(self, **post):
        """Persist canvas edits to the shared design link (collaborators + owner)."""
        token = post.get("token") or request.session.get("active_share_token")
        share = self._get_active_share(token)
        if not share:
            return {"error": "not_found"}

        access = self._resolve_share_access(share)
        if not access["can_write"]:
            return {"error": "read_only"}

        design_bundle = post.get("design_bundle") or ""
        if not design_bundle.strip():
            return {"error": "empty_design"}

        bundle_b64 = base64.b64encode(design_bundle.encode("utf-8")).decode("utf-8")
        preview_b64 = (
            base64.b64encode(
                self.convert_odoo_compitable(post.get("preview_image"))
            ).decode("utf-8") if post.get("preview_image") else False
        )
        saved_by = self._resolve_share_editor_name(share, access=access)
        try:
            bundle_json = json.loads(design_bundle)
            share_vals = {}
            bundle_product_id = bundle_json.get("product_id")
            bundle_color_id = bundle_json.get("color_id")
            if bundle_product_id:
                product = request.env["product.product"].sudo().browse(int(bundle_product_id))
                if product.exists() and product.product_tmpl_id == share.product_tmpl_id:
                    share_vals["product_id"] = product.id
            if bundle_color_id:
                share_vals["color_attribute_value_id"] = int(bundle_color_id)
            if share_vals:
                share.write(share_vals)
        except (TypeError, ValueError):
            pass
        bundle_version = share.write_design_snapshot(
            bundle_b64, preview_b64, saved_by=saved_by
        )
        meta = self._share_meta_payload(share)
        return {
            "success": True,
            "bundle_version": bundle_version,
            "saved_at": meta["last_saved_at"],
            "saved_by": meta["last_saved_by"],
        }

    @http.route(
        ["/custom/design/share/update_mode"],
        type="json",
        auth="public",
        methods=["POST"],
        website=True,
        csrf=False,
    )
    def custom_design_share_update_mode(self, token, share_mode, **post):
        share = self._get_active_share(token)
        owner_err = self._require_share_owner(share)
        if owner_err:
            return owner_err
        if share_mode not in ("edit", "view"):
            return {"error": "invalid_mode"}
        share.write({"share_mode": share_mode})
        return {"success": True}

    @http.route(
        ["/custom/design/share/get_info"],
        type="json",
        auth="public",
        methods=["POST"],
        website=True,
        csrf=False,
    )
    def custom_design_share_get_info(self, token, **post):
        share = self._get_active_share(token)
        if not share:
            return {"error": "not_found"}
        user = request.env.user
        access = self._resolve_share_access(share)
        is_owner = access["is_owner"]

        access_list = []
        if is_owner:
            for acc in share.access_ids:
                guest_link = acc.get_guest_link()
                access_list.append({
                    "id": acc.id,
                    "email": acc.email,
                    "access_mode": acc.access_mode,
                    "url": guest_link,
                    "guest_link": guest_link,
                })

        if is_owner:
            owner_email = share.partner_id.email or share.partner_id.name or "Owner"
        else:
            owner_email = share.partner_id.name or "Owner" if share.partner_id else "Owner"

        return {
            "restriction_type": share.restriction_type,
            "share_mode": share.share_mode,
            "owner_email": owner_email,
            "access_list": access_list,
            "current_user_email": user.partner_id.email or user.email or "",
            "is_owner": is_owner,
            "can_write": access["can_write"],
        }

    @http.route(
        ["/custom/design/share/guest_access"],
        type="json",
        auth="public",
        methods=["POST"],
        website=True,
        csrf=False,
    )
    def custom_design_share_guest_access(self, **post):
        """Return current guest permission for a stable acc link (no login)."""
        token = post.get("token")
        acc_id = post.get("acc")
        share = self._get_active_share(token)
        if not share:
            return {"error": "not_found"}
        try:
            acc_id = int(acc_id)
        except (TypeError, ValueError):
            return {"error": "invalid_acc"}

        guest = self._resolve_guest_access(share, acc_id)
        if not guest:
            return {"error": "access_denied"}

        request.session["active_share_token"] = token
        self._set_guest_share_session(share, acc_id)
        return {
            "success": True,
            "access_mode": guest["resolved_mode"],
            "can_write": guest["can_write"],
            "can_read": guest["can_read"],
        }

    @http.route(
        ["/custom/design/share/update_restriction"],
        type="json",
        auth="public",
        methods=["POST"],
        website=True,
        csrf=False,
    )
    def custom_design_share_update_restriction(self, token, restriction_type, **post):
        share = self._get_active_share(token)
        owner_err = self._require_share_owner(share)
        if owner_err:
            return owner_err
        if restriction_type not in ("anyone", "restricted"):
            return {"error": "invalid_restriction"}
        share.write({"restriction_type": restriction_type})
        return {"success": True}

    @http.route(
        ["/custom/design/share/add_access"],
        type="json",
        auth="public",
        methods=["POST"],
        website=True,
        csrf=False,
    )
    def custom_design_share_add_access(self, token, email, access_mode, **post):
        share = self._get_active_share(token)
        owner_err = self._require_share_owner(share)
        if owner_err:
            return owner_err
        
        email = (email or "").strip().lower()
        if not email or "@" not in email:
            return {"error": "invalid_email"}
        if access_mode not in ("edit", "view"):
            return {"error": "invalid_mode"}

        existing = share.access_ids.filtered(lambda a: a.email.strip().lower() == email)
        if existing:
            existing.write({"access_mode": access_mode})
            guest_url = existing.get_guest_link()
            existing.write({"url": guest_url})
            existing.action_send_invitation()
        else:
            new_access = request.env["product.design.share.access"].sudo().create({
                "share_id": share.id,
                "email": email,
                "access_mode": access_mode,
            })
            guest_url = new_access.get_guest_link()
            new_access.write({"url": guest_url})
            new_access.action_send_invitation()
        return {"success": True}

    @http.route(
        ["/custom/design/share/remove_access"],
        type="json",
        auth="public",
        methods=["POST"],
        website=True,
        csrf=False,
    )
    def custom_design_share_remove_access(self, token, access_id, **post):
        share = self._get_active_share(token)
        owner_err = self._require_share_owner(share)
        if owner_err:
            return owner_err
        
        access_rec = request.env["product.design.share.access"].sudo().browse(int(access_id))
        if access_rec.exists() and access_rec.share_id.id == share.id:
            access_rec.unlink()
            return {"success": True}
        return {"error": "not_found"}

    def _resolve_share_color_id(self, share):
        """Resolve matrix color from share record or embedded design bundle."""
        if share.color_attribute_value_id:
            return share.color_attribute_value_id.id
        payload = share.get_design_text()
        if payload:
            try:
                bundle = json.loads(payload)
                color_id = bundle.get("color_id")
                if color_id:
                    return int(color_id)
            except (TypeError, ValueError):
                pass
        return False

    @http.route(
        ["/product/designer/share/<string:token>"],
        type="http",
        auth="public",
        website=True,
        csrf=False,
    )
    def open_shared_design(self, token, **kw):
        share = self._get_active_share(token)
        if not share or not share.product_id.exists():
            return request.not_found()

        acc_id = kw.get("acc")
        if acc_id:
            try:
                self._set_guest_share_session(share, int(acc_id))
            except (TypeError, ValueError):
                pass

        access = self._resolve_share_access(share, kw=kw)
        if not access["can_read"]:
            user = request.env.user
            if user._is_public():
                from urllib.parse import quote
                return request.redirect("/web/login?redirect=" + quote(request.httprequest.fullpath))
            return request.render(
                "tus_product_personalizer.share_access_restricted",
                {"share": share},
            )

        resolved_share_mode = access["resolved_mode"]
        share_is_owner = access["is_owner"]
        self._set_share_session(token, resolved_share_mode)

        product = share.product_id
        personalizer_config = self._get_personalizer_config()
        config_matrix_ids = personalizer_config.get('matrix_product_ids') or []
        show_matrix_table = personalizer_config.get('enable_matrix') and (
            not config_matrix_ids or product.product_tmpl_id.id in config_matrix_ids
        )
        forced_color_id = (
            self._resolve_share_color_id(share) if show_matrix_table else False
        )
        empty_canvas_kwargs = self._empty_canvas_kwargs_from_share(share)

        context = self._get_designer_context(
            product.product_tmpl_id.id,
            product.id,
            share_token=token,
            share_record=share,
            forced_color_id=forced_color_id,
            **empty_canvas_kwargs,
        )
        context["resolved_share_mode"] = resolved_share_mode
        context["share_is_owner"] = share_is_owner
        context["share_can_write"] = access["can_write"]
        context["share_guest_acc"] = access.get("guest_acc_id") or self._get_guest_acc_id(kw) or 0
        share_meta = self._share_meta_payload(share)
        context["share_bundle_version"] = share_meta["bundle_version"]
        context["share_last_saved_by"] = share_meta["last_saved_by"]
        context["share_last_saved_at"] = share_meta["last_saved_at"]

        return request.render(
            "tus_product_personalizer.product_design_customize",
            context,
        )

    @http.route(
        ["/product/designer/share/<string:token>/preview"],
        type="http",
        auth="public",
        website=True,
        csrf=False,
    )
    def shared_design_preview(self, token, **kw):
        share = self._get_active_share(token)
        if not share or not share.preview_image:
            return request.not_found()
        data = base64.b64decode(share.preview_image)
        return request.make_response(
            data,
            headers=[
                ("Content-Type", "image/png"),
                ("Cache-Control", "public, max-age=3600"),
            ],
        )

    @http.route(
        ["/product/designer/share/<string:token>/data"],
        type="http",
        auth="public",
        website=True,
        csrf=False,
    )
    def shared_design_data(self, token, **kw):
        share = self._get_active_share(token)
        if not share:
            return request.not_found()

        access = self._resolve_share_access(share, kw=kw)
        if not access["can_read"]:
            user = request.env.user
            if user._is_public():
                return request.make_response(
                    json.dumps({"error": "login_required"}),
                    status=401,
                    headers=[("Content-Type", "application/json; charset=utf-8")],
                )
            return request.make_response(
                json.dumps({"error": "access_denied"}),
                status=403,
                headers=[("Content-Type", "application/json; charset=utf-8")],
            )

        payload = share.get_design_text()
        if not payload:
            return request.not_found()

        if kw.get("meta") in ("1", "true", "True"):
            try:
                bundle = json.loads(payload)
            except (TypeError, ValueError):
                bundle = payload
            meta = self._share_meta_payload(share)
            return request.make_response(
                json.dumps({
                    "bundle": bundle,
                    "bundle_version": meta["bundle_version"],
                    "last_saved_at": meta["last_saved_at"],
                    "last_saved_by": meta["last_saved_by"],
                }),
                headers=[
                    ("Content-Type", "application/json; charset=utf-8"),
                    ("Cache-Control", "no-store, no-cache, must-revalidate"),
                    ("Pragma", "no-cache"),
                ],
            )

        return request.make_response(
            payload,
            headers=[
                ("Content-Type", "application/json; charset=utf-8"),
                ("Cache-Control", "no-store, no-cache, must-revalidate"),
                ("Pragma", "no-cache"),
            ],
        )

    @http.route(
        ["/product/designer/template/<int:template_id>/data"],
        type="http",
        auth="public",
        website=True,
        csrf=False,
    )
    def product_design_template_data(self, template_id, **kw):
        template = request.env["product.design.template"].sudo().browse(template_id)
        if not template.exists() or not template.active:
            return request.not_found()
        payload = template.get_design_text()
        content_type = "application/json; charset=utf-8"
        if template.design_format == "svg" or (payload and payload.lstrip().startswith("<")):
            content_type = "image/svg+xml; charset=utf-8"
        return request.make_response(
            payload,
            headers=[("Content-Type", content_type)],
        )

    @http.route(
        ["/product/designer/text-template/<int:template_id>/data"],
        type="http",
        auth="public",
        website=True,
        csrf=False,
    )
    def editor_text_template_data(self, template_id, **kw):
        template = request.env["editor.text.template"].sudo().browse(template_id)
        if not template.exists() or not template.active:
            return request.not_found()
        payload = template.get_design_text()
        return request.make_response(
            payload,
            headers=[("Content-Type", "image/svg+xml; charset=utf-8")],
        )

    @http.route(
        ["/product/designer/texture/<int:texture_id>/image"],
        type="http",
        auth="public",
        website=True,
        csrf=False,
    )
    def editor_texture_image(self, texture_id, **kw):
        texture = request.env["editor.texture"].sudo().browse(texture_id)
        if not texture.exists() or not texture.active or not texture.texture_file:
            return request.not_found()
        filename = (texture.texture_file_filename or "texture.png").lower()
        if filename.endswith(".jpg") or filename.endswith(".jpeg"):
            content_type = "image/jpeg"
        elif filename.endswith(".webp"):
            content_type = "image/webp"
        else:
            content_type = "image/png"
        return request.make_response(
            base64.b64decode(texture.texture_file),
            headers=[("Content-Type", content_type), ("Cache-Control", "public, max-age=3600")],
        )

    @http.route(
        ["/backend/designer/<int:product_id>/<int:product_tmpl_id>/<int:sale_order_line_id>"],
        type="http",
        auth="user",  # since it’s backend usage
        website=True,
        csrf=False
    )
    def openSaleOrderLineDesigner(self, product_id, product_tmpl_id, sale_order_line_id):
        product = request.env["product.product"].sudo().browse(int(product_id))
        DesignerCanvas = product._get_effective_views() if product.exists() else \
            request.env["product.view"].sudo().search([
                ("product_template_id", "=", product_tmpl_id),
                ("product_id", "=", False),
            ])

        web_base_url = request.env["ir.config_parameter"].sudo().get_param("web.base.url")

        sale_order_line = request.env["sale.order.line"].sudo().browse(sale_order_line_id)

        personalizer_config = self._get_personalizer_config()
        
        config_matrix_ids = personalizer_config.get('matrix_product_ids') or []
        show_matrix_table = personalizer_config.get('enable_matrix') and (not config_matrix_ids or int(product_tmpl_id) in config_matrix_ids)
        
        config_price_ids = personalizer_config.get('design_price_product_ids') or []
        show_design_price = personalizer_config.get('enable_design_price') and (not config_price_ids or int(product_tmpl_id) in config_price_ids)

        product_unit_price = (
            self._get_product_unit_price(product)
            if product.exists()
            else 0.0
        )

        personalizer_config = self._apply_show_3d_preview(personalizer_config, product_tmpl_id)
        personalizer_config = self._apply_show_texture(personalizer_config, product_tmpl_id)
        personalizer_config = self._apply_show_finish_effects(personalizer_config, product_tmpl_id)
        personalizer_config = self._apply_pricing_config(personalizer_config, product_tmpl_id)
        show_texture = personalizer_config.get('show_texture')

        text_template_groups = self._get_text_template_groups()
        texture_groups = self._get_texture_groups() if show_texture else []

        return request.render(
            "tus_product_personalizer.product_design_customize",
            {
                "product_tmpl_id": product_tmpl_id,
                "product_id": product_id,
                "product": product if product.exists()
                else request.env["product.product"].sudo(),
                "product_display_name": product.display_name if product.exists() else "",
                "product_image_uri": _get_product_image_uri(
                    product if product.exists() else None,
                    product.product_tmpl_id if product.exists() else None,
                ),
                "product_unit_price": product_unit_price,
                "DesignerCanvas": DesignerCanvas,
                "sale_order_line": sale_order_line,
                "from_backend": True,
                "base_url": web_base_url,
                "show_matrix_table": show_matrix_table,
                "show_design_price": show_design_price,
                "show_texture": show_texture,
                "text_template_groups": text_template_groups,
                "text_template_ids": [
                    tpl for group in text_template_groups for tpl in group.templates
                ],
                "texture_groups": texture_groups,
                "texture_ids": [
                    tex for group in texture_groups for tex in group.textures
                ],
                "personalizer_config": personalizer_config,
                "personalizer_config_json": json.dumps(personalizer_config),
                **self._get_help_context_payload(),
            },
        )

    @http.route(
        ["/personalizer/help/<string:token>"],
        type="http",
        auth="public",
        website=True,
        csrf=False,
    )
    def personalizer_help_page(self, token, **kw):
        """Public shareable page for a designer help record."""
        record = request.env["product.personalizer.help"].sudo().search([
            ("share_token", "=", token),
        ], limit=1)
        if not record:
            return request.not_found()
        return request.render(
            "tus_product_personalizer.personalizer_help_page",
            {
                "help_record": record,
                "help_video_embed_url": record.video_embed_url,
            },
        )

    @http.route(
        ["/custom/design/upload"],
        type="json",
        auth="public",
        methods=["POST"],
        website=True,
        csrf=False,
    )
    def custom_design_upload(self, **post):
        write_err = self._require_share_write()
        if write_err:
            return write_err
        order_line = (
            request.env["sale.order.line"].sudo().browse(int(post.get("order_line")))
        )
        exist_design = (
            request.env["orderline.design.upload"]
            .sudo()
            .search(
                [
                    ("order_line", "=", post.get("order_line")),
                    ("uploaded_type", "=", post.get("uploaded_type")),
                ]
            )
        )
        exist_design.unlink()
        design_name = (
            order_line.name
            + "_"
            + request.env["ir.sequence"].sudo().next_by_code("design.upload.sequence")
            + ".svg"
        )
        base64_encoded = base64.b64encode(
            post.get("uploaded_attachment").encode("utf-8")
        ).decode("utf-8")
        post.update({"name": design_name, "uploaded_attachment": base64_encoded})
        design = (
            request.env["orderline.design.upload"]
            .sudo()
            .with_context(default_mimetype="image/svg+xml")
            .create(post)
        )

        request.env["res.partner.design"].sudo().with_context(
            default_mimetype="image/svg+xml"
        ).create(
            {
                "partner_id": order_line.order_id.partner_id.id,
                "product_id": order_line.product_id.id,
                "sale_line_id": order_line.id,
                "uploaded_attachment": base64_encoded,
                "name": design_name,
            }
        )
        return True

    def _personalizer_upload_limits(self):
        website = request.env['website'].get_current_website().sudo()
        if hasattr(website, 'get_personalizer_upload_limits'):
            return website.get_personalizer_upload_limits()
        return {
            "max_bytes": 40 * 1024 * 1024,
            "max_pixels": 80_000_000,
            "preview_max_side": 2048,
        }

    def _store_production_original_attachment(self, file_bytes, filename, mime):
        """Keep the unmodified production file as ir.attachment."""
        if not file_bytes:
            return False
        return request.env['ir.attachment'].sudo().create({
            'name': filename or 'production_original',
            'type': 'binary',
            'datas': base64.b64encode(file_bytes),
            'mimetype': mime or 'application/octet-stream',
            'res_model': 'canvas.image',
            'public': False,
        })

    def _create_canvas_image_from_svg(
        self,
        svg_text,
        filename,
        is_vector=False,
        *,
        original_attachment=None,
        source_width=None,
        source_height=None,
        source_dpi=None,
        preview_scale=1.0,
    ):
        """Persist SVG text on canvas.image and return a standard payload."""
        from odoo.addons.tus_product_personalizer.utils.svg_embed import (
            parse_embedded_raster_dimensions,
        )

        svg_filename = filename if filename.endswith(".svg") else f"{filename.rsplit('.', 1)[0]}.svg"
        file_b64 = base64.b64encode(svg_text.encode("utf-8"))
        vals = {
            "name": svg_filename,
            "file": file_b64,
            "user_id": request.env.user.id,
            "preview_scale": float(preview_scale or 1.0),
        }
        if original_attachment:
            vals["original_attachment_id"] = original_attachment.id
        if source_width:
            vals["source_width"] = int(source_width)
        if source_height:
            vals["source_height"] = int(source_height)
        if source_dpi:
            vals["source_dpi"] = float(source_dpi)

        record = request.env["canvas.image"].sudo().create(vals)
        if original_attachment and not original_attachment.res_id:
            original_attachment.sudo().write({
                "res_model": "canvas.image",
                "res_id": record.id,
            })

        payload = {
            "id": record.id,
            "name": record.name,
            "svg": svg_text,
            "is_vector": bool(is_vector),
            "image_datas": image_data_uri(record.file),
            "original_attachment_id": record.original_attachment_id.id or False,
            "preview_scale": float(record.preview_scale or 1.0),
            "source_dpi": float(record.source_dpi or 0.0) or False,
        }
        if not is_vector:
            dims = parse_embedded_raster_dimensions(svg_text)
            if dims:
                payload["source_width"] = record.source_width or dims["width"]
                payload["source_height"] = record.source_height or dims["height"]
            elif record.source_width and record.source_height:
                payload["source_width"] = record.source_width
                payload["source_height"] = record.source_height
        elif record.source_width and record.source_height:
            payload["source_width"] = record.source_width
            payload["source_height"] = record.source_height
        return payload

    def _process_canvas_artwork_upload(
        self,
        file_bytes,
        filename,
        *,
        vectorize=None,
        auto_detect=True,
    ):
        """Normalize TIFF/PDF/high-res uploads, store original, build editor SVG."""
        from odoo.addons.tus_product_personalizer.utils.production_upload import (
            ProductionUploadError,
            normalize_production_upload,
        )
        from odoo.addons.tus_product_personalizer.utils.svg_embed import (
            prepare_canvas_image_storage,
        )

        limits = self._personalizer_upload_limits()
        try:
            normalized = normalize_production_upload(
                file_bytes,
                filename,
                max_bytes=limits["max_bytes"],
                max_pixels=limits["max_pixels"],
                preview_max_side=limits["preview_max_side"],
            )
        except ProductionUploadError as exc:
            return {"error": str(exc)}

        meta = normalized.get("meta") or {}
        editor_bytes = normalized["preview_bytes"]
        editor_name = normalized.get("working_filename") or filename or "upload.png"
        if meta.get("is_svg"):
            editor_bytes = normalized["working_bytes"]
            editor_name = normalized.get("working_filename") or filename

        try:
            svg_text, svg_filename, is_vector = prepare_canvas_image_storage(
                editor_bytes,
                editor_name,
                vectorize=vectorize,
                auto_detect=auto_detect,
            )
        except Exception as exc:
            _logger.exception("Canvas image prepare failed")
            return {"error": str(exc)}

        original_attachment = None
        keep_original = (
            (normalized.get("original_mime") in ("image/tiff", "application/pdf"))
            or float(meta.get("preview_scale") or 1.0) < 0.999
            or (normalized["original_bytes"] != normalized["preview_bytes"])
        )
        if keep_original and not meta.get("is_svg"):
            original_attachment = self._store_production_original_attachment(
                normalized["original_bytes"],
                filename or "production_original",
                normalized.get("original_mime"),
            )

        return self._create_canvas_image_from_svg(
            svg_text,
            svg_filename,
            is_vector=is_vector,
            original_attachment=original_attachment,
            source_width=meta.get("source_width"),
            source_height=meta.get("source_height"),
            source_dpi=meta.get("dpi"),
            preview_scale=meta.get("preview_scale") or 1.0,
        )

    @http.route('/convert_to_svg', type='http', auth='public', methods=['POST'], csrf=False)
    def convert_to_svg(self, **kwargs):
        write_err = self._require_share_write()
        if write_err:
            return request.make_response(write_err.get("error", "read_only"), status=403)
        from odoo.addons.tus_product_personalizer.utils.svg_embed import (
            RASTER_EXTENSIONS,
        )
        from odoo.addons.tus_product_personalizer.utils.production_upload import (
            PRODUCTION_EXTENSIONS,
        )

        upload = request.httprequest.files.get('file')
        if not upload:
            return request.make_response("No file uploaded", status=400)

        filename = upload.filename or "upload"
        ext = filename.split(".")[-1].lower()
        file_bytes = upload.read()

        if ext in RASTER_EXTENSIONS or ext == "svg" or ext in PRODUCTION_EXTENSIONS:
            try:
                payload = self._process_canvas_artwork_upload(file_bytes, filename)
                if payload.get("error"):
                    return request.make_response(payload["error"], status=400)
                return request.make_json_response(payload)
            except Exception as exc:
                _logger.exception("Raster/SVG upload conversion failed")
                return request.make_response(str(exc), status=500)

        input_fd, input_path = tempfile.mkstemp(suffix="." + ext)
        output_fd, output_path = tempfile.mkstemp(suffix=".svg")
        os.close(input_fd)
        os.close(output_fd)

        try:
            with open(input_path, "wb") as f:
                f.write(file_bytes)

            subprocess.run([
                "inkscape", input_path, "--export-plain-svg=" + output_path
            ], check=True)

            with open(output_path, "r", encoding="utf-8") as f:
                svg_text = f.read()

            from odoo.addons.tus_product_personalizer.utils.print_vector import (
                is_native_vector_svg,
            )

            payload = self._create_canvas_image_from_svg(
                svg_text,
                filename,
                is_vector=is_native_vector_svg(svg_text),
            )
            return request.make_json_response(payload)

        finally:
            for path in [input_path, output_path]:
                if os.path.exists(path):
                    os.remove(path)

    def _openai_generate_images(self, website, prompt, count):
        """Call OpenAI Images API; return list of data:image/png;base64,... URIs."""
        import requests

        api_key = (website.personalizer_ai_api_key or '').strip()
        model = website.personalizer_ai_model or 'gpt-image-1'
        size = website.personalizer_ai_image_size or '1024x1024'
        quality = website.personalizer_ai_quality or 'medium'

        headers = {
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json',
        }
        url = 'https://api.openai.com/v1/images/generations'
        timeout = 120

        def _parse_response(resp):
            if resp.status_code >= 400:
                try:
                    err_body = resp.json()
                    msg = err_body.get('error', {}).get('message') or resp.text
                except Exception:
                    msg = resp.text or resp.reason
                return None, msg
            data = resp.json().get('data') or []
            images = []
            for item in data:
                b64 = item.get('b64_json')
                if b64:
                    images.append(f'data:image/png;base64,{b64}')
            if not images:
                return None, 'OpenAI returned no image data.'
            return images, None

        images_out = []

        if model == 'dall-e-3':
            payload_base = {
                'model': model,
                'prompt': prompt,
                'n': 1,
                'size': size,
                'response_format': 'b64_json',
                'quality': 'hd' if quality == 'hd' else 'standard',
            }
            for _i in range(count):
                resp = requests.post(
                    url, headers=headers, json=payload_base, timeout=timeout
                )
                batch, err = _parse_response(resp)
                if err:
                    return None, err
                images_out.extend(batch)
            return images_out, None

        payload = {
            'model': model,
            'prompt': prompt,
            'n': count,
            'size': size,
        }
        if model == 'gpt-image-1':
            if quality in ('low', 'medium', 'high', 'auto'):
                payload['quality'] = quality
            else:
                payload['quality'] = 'medium'
        elif model == 'dall-e-2':
            payload['response_format'] = 'b64_json'
            if quality in ('standard', 'hd'):
                pass

        resp = requests.post(url, headers=headers, json=payload, timeout=timeout)
        return _parse_response(resp)

    @http.route('/canvas/ai_generate', type='json', auth='public', website=True, csrf=False)
    def ai_generate(self, prompt=None, count=None):
        """Generate images from a text prompt via OpenAI (server-side API key)."""
        write_err = self._require_share_write()
        if write_err:
            return write_err
        website = request.env['website'].get_current_website().sudo()
        if not website.personalizer_enable_ai:
            return {'error': 'AI image generation is disabled on this website.'}

        api_key = (website.personalizer_ai_api_key or '').strip()
        if not api_key:
            return {
                'error': (
                    'OpenAI API key is not configured. '
                    'Set it under Website → Settings → Product Personalizer.'
                ),
            }

        prompt = (prompt or '').strip()
        if not prompt:
            return {'error': 'Please enter a description for the image.'}

        try:
            count = int(count) if count is not None else website.personalizer_ai_image_count
        except (TypeError, ValueError):
            count = website.personalizer_ai_image_count or 4
        count = max(1, min(10, count or 4))

        try:
            images, err = self._openai_generate_images(website, prompt, count)
            if err:
                return {'error': err}
            return {'images': images}
        except Exception as exc:
            _logger.exception('AI image generation failed')
            return {'error': str(exc)}

    @http.route('/canvas/upload_image', type='json', auth='public', website=True, csrf=False)
    def upload_image(self, filename, filedata, vectorize=None, auto_detect=True):
        """
        filename: string (original file name)
        filedata: base64 string (without the data:image/png;base64, prefix)
        vectorize: True=force trace, False=photo layer, None=auto (default)

        Prefer /canvas/upload_image_multipart for large TIFF/PDF/high-res files.
        """
        write_err = self._require_share_write()
        if write_err:
            return write_err

        try:
            file_bytes = base64.b64decode(filedata)
        except Exception as e:
            return {'error': f'Invalid file data: {str(e)}'}

        if vectorize is not None:
            vectorize = bool(vectorize)
        if auto_detect is not None:
            auto_detect = bool(auto_detect)

        try:
            return self._process_canvas_artwork_upload(
                file_bytes,
                filename,
                vectorize=vectorize,
                auto_detect=auto_detect,
            )
        except Exception as exc:
            _logger.exception("Canvas image upload failed")
            return {'error': str(exc)}

    @http.route(
        '/canvas/upload_image_multipart',
        type='http',
        auth='public',
        methods=['POST'],
        website=True,
        csrf=False,
    )
    def upload_image_multipart(self, **kwargs):
        """Multipart upload for large TIFF/PDF/high-resolution artwork."""
        write_err = self._require_share_write()
        if write_err:
            return request.make_json_response(write_err, status=403)

        upload = request.httprequest.files.get('file')
        if not upload:
            return request.make_json_response({'error': 'No file uploaded'}, status=400)

        filename = upload.filename or kwargs.get('filename') or 'upload'
        file_bytes = upload.read()
        vectorize = kwargs.get('vectorize')
        auto_detect = kwargs.get('auto_detect', '1')
        if vectorize in (None, '', 'null'):
            vectorize = None
        elif str(vectorize).lower() in ('1', 'true', 'yes'):
            vectorize = True
        else:
            vectorize = False
        auto_detect = str(auto_detect).lower() not in ('0', 'false', 'no')

        try:
            payload = self._process_canvas_artwork_upload(
                file_bytes,
                filename,
                vectorize=vectorize,
                auto_detect=auto_detect,
            )
            status = 400 if payload.get('error') else 200
            return request.make_json_response(payload, status=status)
        except Exception as exc:
            _logger.exception("Multipart canvas upload failed")
            return request.make_json_response({'error': str(exc)}, status=500)

    @http.route('/canvas/vectorize_image', type='json', auth='public', website=True, csrf=False)
    def vectorize_canvas_image(self, image_id=None, filedata=None, filename=None):
        """Force vector trace for a library image or raw upload bytes."""
        write_err = self._require_share_write()
        if write_err:
            return write_err
        from odoo.addons.tus_product_personalizer.utils.print_vector import (
            is_native_vector_svg,
        )
        from odoo.addons.tus_product_personalizer.utils.svg_embed import (
            is_svg_content,
            prepare_canvas_image_storage,
            _resolve_raster_bytes_for_vectorize,
        )

        try:
            record = None
            if image_id:
                record = request.env['canvas.image'].sudo().browse(int(image_id))
                if not record.exists():
                    return {'error': 'Image not found'}
                file_bytes = base64.b64decode(record.file)
                filename = filename or record.name or "image.png"
            elif filedata:
                file_bytes = base64.b64decode(filedata)
                filename = filename or "image.png"
            else:
                return {'error': 'No image provided'}

            if is_svg_content(file_bytes):
                svg_text = file_bytes.decode("utf-8", errors="replace")
                if is_native_vector_svg(svg_text):
                    payload = self._create_canvas_image_from_svg(
                        svg_text,
                        filename if filename.endswith(".svg") else f"{filename}.svg",
                        is_vector=True,
                    )
                    if record:
                        payload["id"] = record.id
                    return payload
                raster_bytes = _resolve_raster_bytes_for_vectorize(file_bytes, filename)
                if not raster_bytes:
                    return {'error': 'Could not extract raster data for vectorization.'}
                file_bytes = raster_bytes

            svg_text, svg_name, is_vector = prepare_canvas_image_storage(
                file_bytes,
                filename,
                vectorize=True,
                auto_detect=False,
            )
            if not is_vector:
                return {
                    'error': (
                        'Could not convert to vector. Use a simple logo with solid '
                        'colors, or ensure vtracer is installed on the server.'
                    ),
                }

            if record:
                record.write({
                    'file': base64.b64encode(svg_text.encode("utf-8")),
                    'name': svg_name,
                })
                return {
                    'id': record.id,
                    'name': record.name,
                    'svg': svg_text,
                    'is_vector': True,
                    'image_datas': image_data_uri(record.file),
                }

            return self._create_canvas_image_from_svg(
                svg_text, svg_name, is_vector=True
            )
        except Exception as exc:
            _logger.exception("Vectorize image failed")
            return {'error': str(exc)}

    @http.route('/canvas/remove_background', type='json', auth='public', website=True, csrf=False)
    def remove_background(self, filedata):
        """Remove image background server-side using rembg (u2netp, memory-safe)."""
        write_err = self._require_share_write()
        if write_err:
            return write_err
        try:
            from odoo.addons.tus_product_personalizer.utils.background_removal import (
                remove_image_background_safe,
            )
        except ImportError:
            return {
                'error': (
                    'Background removal is not installed on the server. '
                    'Install: pip install -r tus_product_personalizer/requirements.txt'
                ),
            }

        try:
            payload = filedata or ''
            if isinstance(payload, str) and ',' in payload:
                payload = payload.split(',', 1)[1]
            raw = base64.b64decode(payload)
            if not raw:
                return {'error': 'Empty image data.'}

            output = remove_image_background_safe(raw)
            if isinstance(output, str):
                output = output.encode("utf-8")
            output_b64 = base64.b64encode(output)
            return {
                'success': True,
                'filedata': output_b64.decode('ascii'),
                'image_datas': image_data_uri(output_b64),
            }
        except Exception as exc:
            _logger.exception('Background removal failed')
            msg = str(exc)
            if 'Failed to allocate memory' in msg or 'RUNTIME_EXCEPTION' in msg:
                msg = (
                    'Background removal ran out of memory. '
                    'Try a smaller image or increase server RAM.'
                )
            return {'error': msg}

    @http.route('/canvas/update_image', type='json', auth='public', website=True, csrf=False)
    def update_canvas_image(self, image_id, filedata, filename=None):
        """Replace a library image with a processed version (e.g. background removed)."""
        write_err = self._require_share_write()
        if write_err:
            return write_err
        from odoo.addons.tus_product_personalizer.utils.svg_embed import (
            prepare_canvas_image_storage,
        )

        try:
            record = request.env['canvas.image'].sudo().browse(int(image_id))
            if not record.exists():
                return {'error': 'Image not found'}

            file_bytes = base64.b64decode(filedata)
            svg_text, svg_name, is_vector = prepare_canvas_image_storage(
                file_bytes,
                filename or record.name or "image.png",
                vectorize=False,
                auto_detect=False,
            )

            record.write({
                'file': base64.b64encode(svg_text.encode("utf-8")),
                'name': svg_name,
            })
            return {
                'id': record.id,
                'name': record.name,
                'svg': svg_text,
                'is_vector': bool(is_vector),
                'image_datas': image_data_uri(record.file),
            }
        except Exception as e:
            return {'error': str(e)}

    @http.route('/delete/image', type="json",auth='public',website=True,csrf=False,)
    def delete_images(self, canvas_image):
        write_err = self._require_share_write()
        if write_err:
            return write_err
        record = request.env['canvas.image'].sudo().browse(canvas_image)
        if record.exists():
            record.unlink()
            return {'success': True}
        return {'success': False, 'error': 'Image not found'}

    @http.route('/shop/buy/now', type='json', auth='public', website=True,csrf=False)
    def buy_now_custom_multi(self, items, designs_by_color=None, **kw):
        write_err = self._require_share_write()
        if write_err:
            return write_err
        try:
            return self._buy_now_custom_multi_impl(items, designs_by_color=designs_by_color, **kw)
        except Exception as exc:
            _logger.exception("Buy Now failed")
            return {'error': str(exc)}

    def _buy_now_custom_multi_impl(self, items, designs_by_color=None, **kw):
        order = request.cart or request.website._create_cart()
        designs_by_color = designs_by_color or {}
        items_list = [it for it in (items or []) if it.get('product_id')]

        def _item_qty(item):
            vdp = item.get('vdp') or {}
            if vdp.get('records'):
                return len(vdp['records'])
            return max(1, int(item.get('qty') or 1))

        total_order_qty = sum(_item_qty(it) for it in items_list) or 1
        personalizer_config = self._get_personalizer_config()
        palette_by_code, uom_by_name, cmyk_by_code = self._get_imprint_lookup_maps()
        PrintingMethod = request.env['product.printing.method'].sudo()
        order_printing_method = PrintingMethod
        order_printing_method_id = None

        vdp_upload_jobs = []

        for it in items_list:
            pid = int(it.get('product_id'))
            qty = max(1, int(it.get('qty') or 1))

            # Use color-specific design if provided, otherwise fallback to item-level
            color_id = str(it.get('color_id'))
            design = designs_by_color.get(color_id) or it.get('design') or []
            vdp_payload = it.get('vdp') or None
            if vdp_payload and vdp_payload.get('records'):
                qty = len(vdp_payload['records'])

            product = request.env['product.product'].sudo().browse(pid)
            if not product.exists():
                continue

            design_for_pricing = design
            if vdp_payload:
                design_for_pricing = (
                    vdp_payload.get('master_design')
                    or (vdp_payload.get('designs') or [None])[0]
                    or design
                )
            design_price_sum = self._compute_design_price_sum(
                design_for_pricing, product.product_tmpl_id.id,
                personalizer_config=personalizer_config,
            )
            client_design_price = float(it.get('design_price') or 0.0)
            if design_price_sum <= 0 and client_design_price > 0:
                design_price_sum = client_design_price
            empty_canvas_meta = it.get('empty_canvas') or {}
            texture_by_side = it.get('texture_by_side') or {}
            texture_price_sum = self._compute_texture_price_sum(
                texture_by_side,
                product.product_tmpl_id,
                empty_canvas_meta=empty_canvas_meta,
                personalizer_config=personalizer_config,
            )
            client_texture_price = float(it.get('texture_price') or 0.0)
            if texture_price_sum <= 0 and client_texture_price > 0:
                texture_price_sum = client_texture_price
            finish_objects = it.get('finish_objects') or None
            finish_quote = self._compute_finish_price_sum(
                product.product_tmpl_id,
                design_for_pricing,
                empty_canvas_meta=empty_canvas_meta,
                finish_objects=finish_objects,
            )
            finish_price_sum = float(finish_quote.get('finish_price') or 0.0)
            client_finish_price = float(it.get('finish_price') or 0.0)
            if finish_price_sum <= 0 and client_finish_price > 0:
                finish_price_sum = client_finish_price
            printing_method = PrintingMethod.browse(int(it['printing_method_id'])) \
                if it.get('printing_method_id') else PrintingMethod
            if not printing_method.exists():
                printing_method = PrintingMethod
            if it.get('printing_method_id') and not order_printing_method_id:
                pm = PrintingMethod.browse(int(it['printing_method_id']))
                if pm.exists():
                    order_printing_method = pm
                    order_printing_method_id = pm.id
            printing_unit = self._compute_printing_unit_cost(
                printing_method, total_order_qty
            )
            area_quote = self._compute_area_base_quote(
                product.product_tmpl_id, empty_canvas_meta=empty_canvas_meta,
            )
            base_unit = self._resolve_line_base_price(
                product, order=order, empty_canvas_meta=empty_canvas_meta,
            )

            client_price = float(it.get('price') or 0.0)
            if client_price:
                expected = base_unit + design_price_sum + texture_price_sum + finish_price_sum + printing_unit
                if abs(client_price - expected) > 0.05:
                    _logger.info(
                        'Buy now price adjusted for %s: client=%.2f server=%.2f',
                        product.display_name, client_price, expected,
                    )

            line_vals = {
                'order_id': order.id,
                'product_id': product.id,
                'product_uom_qty': qty,
                'price_unit': base_unit,
                'name': "Custom Design - " + product.display_name,
                'personalizer_area_m2': area_quote.get('area_m2') or 0.0,
                'personalizer_area_rate': area_quote.get('rate_per_m2') or 0.0,
                'personalizer_area_amount': area_quote.get('amount') or 0.0,
                'personalizer_finish_amount': finish_price_sum,
            }
            printing_method_id = it.get('printing_method_id')
            if printing_method_id and printing_method.exists():
                line_vals['printing_method_id'] = int(printing_method_id)

            line = self._create_custom_sale_line(line_vals)

            empty_canvas_meta = it.get('empty_canvas') or {}
            canvas_vals = empty_canvas_line_vals_from_meta(
                empty_canvas_meta,
                product_tmpl=product.product_tmpl_id,
                env=request.env,
            )
            if canvas_vals:
                line.write(canvas_vals)
            if texture_by_side:
                line.write({'texture_by_side_json': json.dumps(texture_by_side)})
            design_bundle = it.get('design_bundle')
            if design_bundle:
                if not isinstance(design_bundle, str):
                    design_bundle = json.dumps(design_bundle)
                line.write({'personalizer_design_bundle': design_bundle})

            if design_price_sum > 0:
                charge_product = self._get_charge_product(
                    'tus_product_personalizer.product_design_area_charge',
                    'Design Area Charge',
                )
                if charge_product:
                    self._create_custom_sale_line({
                        'order_id': order.id,
                        'product_id': charge_product.id,
                        'product_uom_qty': qty,
                        'price_unit': design_price_sum,
                        'name': f"Design Area Charges - {product.name}",
                        'personalizer_parent_line_id': line.id,
                        'personalizer_charge_type': 'design_area',
                    })
                else:
                    _logger.warning(
                        'Design area charge product missing; design surcharge %.2f not billed for %s',
                        design_price_sum, product.display_name,
                    )

            if texture_price_sum > 0:
                texture_charge_product = self._get_charge_product(
                    'tus_product_personalizer.product_texture_charge',
                    'Texture Charge',
                )
                if texture_charge_product:
                    self._create_custom_sale_line({
                        'order_id': order.id,
                        'product_id': texture_charge_product.id,
                        'product_uom_qty': qty,
                        'price_unit': texture_price_sum,
                        'name': f"Texture Charges - {product.name}",
                        'personalizer_parent_line_id': line.id,
                        'personalizer_charge_type': 'texture',
                    })
                else:
                    _logger.warning(
                        'Texture charge product missing; texture surcharge %.2f not billed for %s',
                        texture_price_sum, product.display_name,
                    )

            if finish_price_sum > 0:
                finish_charge_product = self._get_charge_product(
                    'tus_product_personalizer.product_finish_charge',
                    'Print Finish Charge',
                )
                if finish_charge_product:
                    self._create_custom_sale_line({
                        'order_id': order.id,
                        'product_id': finish_charge_product.id,
                        'product_uom_qty': qty,
                        'price_unit': finish_price_sum,
                        'name': f"Print Finish Charges - {product.name}",
                        'personalizer_parent_line_id': line.id,
                        'personalizer_charge_type': 'finish',
                    })
                else:
                    _logger.warning(
                        'Finish charge product missing; finish surcharge %.2f not billed for %s',
                        finish_price_sum, product.display_name,
                    )

            if vdp_payload:
                self._store_vdp_on_line(line, vdp_payload)
                records = vdp_payload.get('records') or []
                designs = vdp_payload.get('designs') or []
                if records and not (designs and any(designs)):
                    vdp_upload_jobs.append({
                        'line_id': line.id,
                        'product_id': product.id,
                        'color_id': it.get('color_id'),
                        'record_count': len(records),
                    })
            else:
                self._create_line_designs(
                    line, design,
                    palette_by_code=palette_by_code,
                    uom_by_name=uom_by_name,
                    cmyk_by_code=cmyk_by_code,
                    texture_by_side=texture_by_side,
                )

        if order_printing_method_id and order_printing_method.exists():
            printing_total = self._compute_printing_order_total(
                order_printing_method, total_order_qty
            )
            if printing_total > 0:
                printing_product = self._get_charge_product(
                    'tus_product_personalizer.product_printing_charge',
                    'Printing Charge',
                )
                if printing_product:
                    self._create_custom_sale_line({
                        'order_id': order.id,
                        'product_id': printing_product.id,
                        'product_uom_qty': 1,
                        'price_unit': printing_total,
                        'name': f"Printing ({order_printing_method.name})",
                    })
                else:
                    _logger.warning(
                        'Printing charge product missing; order printing %.2f not billed',
                        printing_total,
                    )

        result = {'redirect_url': '/shop/checkout'}
        if vdp_upload_jobs:
            result['vdp_upload'] = vdp_upload_jobs
        return result

    @http.route('/shop/vdp/upload-designs', type='json', auth='public', website=True, csrf=False)
    def upload_vdp_designs_batch(self, line_id, start_index, designs, master_design=None, **kw):
        """Attach exported canvas designs to pending VDP rows in batches."""
        write_err = self._require_share_write()
        if write_err:
            return write_err
        try:
            import json as json_lib

            line = request.env['sale.order.line'].sudo().browse(int(line_id))
            if not line.exists() or not line.vdp_enabled:
                return {'success': False, 'error': 'Invalid VDP order line.'}

            cart = request.cart
            if not cart or line.order_id.id != cart.id:
                return {'success': False, 'error': 'Order mismatch.'}

            start_index = int(start_index or 0)
            if start_index == 0 and master_design:
                line.write({
                    'vdp_master_design': json_lib.dumps(master_design, ensure_ascii=False),
                })
            design_list = designs or []
            vdp_records = line.vdp_record_ids.sorted('sequence')
            palette_by_code, uom_by_name, cmyk_by_code = self._get_imprint_lookup_maps()
            uploaded = 0

            for offset, design in enumerate(design_list):
                idx = start_index + offset
                if idx >= len(vdp_records) or not design:
                    continue
                rec = vdp_records[idx]
                row = rec._get_row_dict()
                row_label = ' / '.join(
                    str(value) for value in row.values() if value
                )[:80] or f'Row {idx + 1}'
                uploads_before = set(line.uploaded_design_ids.ids)
                self._create_line_designs(
                    line, design,
                    palette_by_code=palette_by_code,
                    uom_by_name=uom_by_name,
                    cmyk_by_code=cmyk_by_code,
                )
                new_upload = line.uploaded_design_ids.filtered(
                    lambda u, before=uploads_before: u.id not in before
                )[:1]
                if new_upload:
                    new_upload.name = f"{new_upload.name} - {row_label}"
                    rec.write({
                        'design_upload_id': new_upload.id,
                        'state': 'generated',
                    })
                    uploaded += 1
                else:
                    rec.state = 'error'

            return {'success': True, 'uploaded': uploaded}
        except Exception as exc:
            _logger.exception("VDP batch upload failed")
            return {'success': False, 'error': str(exc)}

    @http.route(
        '/product/designer/vdp/parse',
        type='http',
        auth='public',
        methods=['POST'],
        website=True,
        csrf=False,
    )
    def parse_vdp_dataset(self, **post):
        """Parse uploaded CSV/XLSX and return field headers + row records."""
        upload = request.httprequest.files.get('file')
        if not upload:
            return request.make_json_response(
                {'error': 'No file uploaded.', 'fields': [], 'records': []},
                status=400,
            )
        file_bytes = upload.read()
        filename = upload.filename or ''
        from odoo.addons.tus_product_personalizer.utils.vdp_parse import parse_vdp_spreadsheet

        result = parse_vdp_spreadsheet(file_bytes, filename)
        if result.get('error'):
            return request.make_json_response(result, status=400)
        if not result.get('records'):
            return request.make_json_response(
                {'error': 'No data rows found in file.', 'fields': result.get('fields', []), 'records': []},
                status=400,
            )
        return request.make_json_response({
            'fields': result.get('fields', []),
            'records': result.get('records', []),
            'count': len(result.get('records', [])),
        })

    def _store_vdp_on_line(self, line, vdp_payload):
        """Persist VDP master template, field list, and row records on a sale line."""
        import json as json_lib

        if not vdp_payload:
            return
        import copy as copy_lib

        records = vdp_payload.get('records') or []
        fields_list = vdp_payload.get('fields') or []
        master = vdp_payload.get('master_design') or []
        designs = vdp_payload.get('designs') or []

        line.write({
            'vdp_enabled': True,
            'vdp_master_design': json_lib.dumps(master, ensure_ascii=False),
            'vdp_field_names': json_lib.dumps(fields_list, ensure_ascii=False),
        })
        VdpRecord = request.env['orderline.vdp.record'].sudo()
        line.vdp_record_ids.unlink()
        master_template = copy_lib.deepcopy(master if isinstance(master, list) else [])
        has_client_designs = bool(designs) and any(designs)
        palette_by_code, uom_by_name, cmyk_by_code = self._get_imprint_lookup_maps()
        for idx, row in enumerate(records):
            row_label = ' / '.join(
                str(value) for value in row.values() if value
            )[:80] or f'Row {idx + 1}'
            rec = VdpRecord.create({
                'order_line_id': line.id,
                'sequence': (idx + 1) * 10,
                'row_data': json_lib.dumps(row, ensure_ascii=False),
            })
            if not has_client_designs:
                continue
            row_design = designs[idx] if idx < len(designs) and designs[idx] else None
            if not row_design and master_template:
                from odoo.addons.tus_product_personalizer.utils.vdp_merge import (
                    merge_vdp_row_into_design,
                )
                row_design = merge_vdp_row_into_design(master_template, row)
            if row_design:
                uploads_before = set(line.uploaded_design_ids.ids)
                self._create_line_designs(
                    line, row_design,
                    palette_by_code=palette_by_code,
                    uom_by_name=uom_by_name,
                    cmyk_by_code=cmyk_by_code,
                )
                new_upload = line.uploaded_design_ids.filtered(
                    lambda u: u.id not in uploads_before
                )[:1]
                if new_upload:
                    new_upload.name = f"{new_upload.name} - {row_label}"
                    rec.write({
                        'design_upload_id': new_upload.id,
                        'state': 'generated',
                    })

    @http.route('/save/orderline', type='json', auth='public', website=True,csrf=False)
    def save_sale_order_line(self, items, **kw):
        write_err = self._require_share_write()
        if write_err:
            return write_err
        if not items:
            return {'error': 'No items provided.', 'success': False}
        try:
            palette_by_code, uom_by_name, cmyk_by_code = self._get_imprint_lookup_maps()
            last_line = None
            cart = request.cart
            for it in items:
                sid = int(it.get('sale_order_line_id'))
                pid = int(it.get('product_id')) if it.get('product_id') else False
                design_data = it.get('design') or []

                line = request.env['sale.order.line'].sudo().browse(sid)
                if not line.exists():
                    continue
                # Website cart edits must belong to the current draft cart.
                from_cart = bool(it.get('from_cart_edit'))
                if from_cart:
                    if not cart or line.order_id.id != cart.id:
                        return {'error': 'unauthorized', 'success': False}
                if pid:
                    line.product_id = pid
                line.uploaded_design_ids.unlink()
                texture_by_side = it.get('texture_by_side') or {}
                self._create_line_designs(
                    line, design_data,
                    palette_by_code=palette_by_code,
                    uom_by_name=uom_by_name,
                    cmyk_by_code=cmyk_by_code,
                    texture_by_side=texture_by_side,
                )
                vals = {}
                design_bundle = it.get('design_bundle')
                if design_bundle:
                    vals['personalizer_design_bundle'] = (
                        design_bundle
                        if isinstance(design_bundle, str)
                        else json.dumps(design_bundle)
                    )
                empty_canvas_meta = it.get('empty_canvas') or {}
                if empty_canvas_meta:
                    area_quote = self._compute_area_base_quote(
                        line.product_id.product_tmpl_id,
                        empty_canvas_meta=empty_canvas_meta,
                    )
                    if area_quote.get('enabled'):
                        vals.update({
                            'price_unit': area_quote.get('amount') or 0.0,
                            'technical_price_unit': area_quote.get('amount') or 0.0,
                            'personalizer_area_m2': area_quote.get('area_m2') or 0.0,
                            'personalizer_area_rate': area_quote.get('rate_per_m2') or 0.0,
                            'personalizer_area_amount': area_quote.get('amount') or 0.0,
                        })
                finish_quote = self._compute_finish_price_sum(
                    line.product_id.product_tmpl_id,
                    design_data,
                    empty_canvas_meta=empty_canvas_meta,
                    finish_objects=it.get('finish_objects'),
                )
                finish_price = float(finish_quote.get('finish_price') or 0.0)
                vals['personalizer_finish_amount'] = finish_price
                if vals:
                    line.write(vals)
                if from_cart:
                    design_price = self._compute_design_price_sum(
                        design_data, line.product_id.product_tmpl_id.id,
                    )
                    texture_price = self._compute_texture_price_sum(
                        texture_by_side,
                        line.product_id.product_tmpl_id,
                        empty_canvas_meta=empty_canvas_meta,
                    )
                    line._reconcile_personalizer_charge_lines({
                        'design_area': design_price,
                        'texture': texture_price,
                        'finish': finish_price,
                    })
                last_line = line
            if last_line and last_line.exists():
                if any(it.get('from_cart_edit') for it in items):
                    return {
                        'redirect_url': '/shop/cart',
                        'success': True,
                    }
                return {
                    'redirect_url': f'/odoo/sales/{last_line.order_id.id}',
                    'success': True,
                }
            return {'error': 'No valid order lines found.', 'success': False}
        except Exception as e:
            return {'error': str(e), 'success': False}

    def convert_odoo_compitable(self, data_uri):
        if not data_uri:
            return b''
        if isinstance(data_uri, bytes):
            return data_uri
        if data_uri.startswith("data:image"):
            data_uri = data_uri.split(",")[1]

        # decode
        binary_data = base64.b64decode(data_uri)
        return binary_data

    def _prepare_design_attachment(self, data_uri, max_size=1024):
        """Store composite previews at a bounded size (not full product image resolution)."""
        binary = self.convert_odoo_compitable(data_uri)
        if not binary:
            return False
        try:
            from odoo.tools.image import image_process
            binary = image_process(binary, size=(max_size, max_size))
        except Exception as err:
            _logger.warning('Could not resize design attachment: %s', err)
        return base64.b64encode(binary)

    @http.route('/tus_personalizer/empty_canvas/presets', type='json', auth='public', website=True, csrf=False)
    def empty_canvas_presets(self, product_tmpl_id, **kw):
        product_tmpl = request.env['product.template'].sudo().browse(int(product_tmpl_id))
        if not product_tmpl.exists() or not product_tmpl.empty_canvas:
            return {'presets': [], 'allow_custom': False}
        return {
            'presets': self._get_empty_canvas_presets_payload(product_tmpl),
            'allow_custom': product_tmpl.empty_canvas_allow_custom,
            'custom_min': product_tmpl.empty_canvas_custom_min or 0,
            'custom_max': product_tmpl.empty_canvas_custom_max or 0,
            'custom_unit': product_tmpl.empty_canvas_custom_unit or 'in',
            'product_options': empty_canvas_product_options_payload(
                product_tmpl=product_tmpl,
                env=request.env,
            ),
            'pricing': product_tmpl.get_personalizer_pricing_config(),
        }

    @http.route('/tus_personalizer/empty_canvas/quote', type='json', auth='public', website=True, csrf=False)
    def empty_canvas_quote(self, product_tmpl_id, width=None, height=None, unit='mm', **kw):
        """Return the authoritative area-based base price for a canvas size."""
        product_tmpl = request.env['product.template'].sudo().browse(int(product_tmpl_id))
        if not product_tmpl.exists():
            return {'error': 'invalid_product'}
        try:
            width = float(width)
            height = float(height)
        except (TypeError, ValueError):
            return {'error': 'invalid_dimensions'}
        quote = self._compute_area_base_quote(
            product_tmpl,
            empty_canvas_meta={'width': width, 'height': height, 'unit': unit or 'mm'},
        )
        return quote

    @http.route('/get_product_views', type='json', auth='public', website=True, csrf=False)
    def get_product_views(self, product_tmpl_id, product_id=None, color_id=None, **kw):
        """Get effective product views (variant overrides, color overrides, or template masters)."""
        product_tmpl = request.env['product.template'].sudo().browse(int(product_tmpl_id))
        if product_tmpl.empty_canvas:
            dims = self._resolve_empty_canvas_dimensions(
                product_tmpl,
                kw.get('canvas_w'),
                kw.get('canvas_h'),
                kw.get('canvas_unit'),
                kw.get('canvas_preset_id') or kw.get('preset_id'),
            )
            if dims.get('error'):
                return {'error': dims['error']}
            sides = kw.get('sides') or kw.get('canvas_sides') or 'front'
            if sides not in self.EMPTY_CANVAS_SIDES_MAP:
                sides = 'front'
            return self._build_empty_canvas_views(
                dims['width'], dims['height'], dims['unit'], sides,
            )

        def _format_views(views):
            return [{
                'id': v.id,
                'title': v.title,
                'design_areas_json': v.design_areas_json,
                'stage_width': v.stage_width,
                'stage_height': v.stage_height,
                'image_width': v.image_width,
                'image_height': v.image_height,
                'thumbnail': image_data_uri(v.thumbnail) if v.thumbnail else None,
            } for v in views]

        try:
            if product_id:
                product = request.env['product.product'].sudo().browse(int(product_id))
                if product.exists():
                    views = product._get_effective_views()
                    return _format_views(views)

            if color_id:
                color_views = request.env['product.view'].sudo().search([
                    ('product_template_id', '=', int(product_tmpl_id)),
                    ('attribute_value_id', '=', int(color_id))
                ])
                if color_views:
                    covered_titles = set(color_views.mapped('title'))
                    template_views = request.env['product.view'].sudo().search([
                        ('product_template_id', '=', int(product_tmpl_id)),
                        ('product_id', '=', False),
                        ('attribute_value_id', '=', False),
                    ])
                    for template_view in template_views:
                        if template_view.title not in covered_titles:
                            color_views |= template_view
                    return _format_views(color_views)

            views = request.env['product.view'].sudo().search(
                [['product_template_id', '=', int(product_tmpl_id)], ['product_id', '=', False], ['attribute_value_id', '=', False]]
            )
            return _format_views(views)
        except Exception as e:
            return {
                'error': str(e)
            }

    @http.route('/get_design_charge_products', type='json', auth='user', website=True, csrf=False)
    def get_design_charge_products(self, **kw):
        """Fetch products that can be used as design area charges."""
        products = request.env['product.product'].sudo().search_read(
            [('sale_ok', '=', True), ('type', '=', 'service')],
            ['id', 'display_name', 'lst_price']
        )
        return products

    @http.route('/get_printing_methods', type='json', auth='public', website=True, csrf=False)
    def get_printing_methods(self, product_tmpl_id, **kw):
        """Fetch all printing methods allowed on this product template"""
        template = request.env['product.template'].sudo().browse(int(product_tmpl_id))
        if not template.exists():
            return []
        
        methods = template.allowed_printing_method_ids
        return [{
            'id': m.id,
            'name': m.name,
            'code': m.code,
            'setup_cost': m.setup_cost,
            'unit_cost': m.unit_cost,
        } for m in methods]

    @http.route('/get_product_data', type='json', auth='public', website=True, csrf=False)
    def get_product_data(self, product_id):
        product = request.env['product.product'].sudo().browse(product_id)
        if not product.exists():
            return {}

        website = request.env['website'].get_current_website()
        price = self._get_product_unit_price(product)

        effective_views = product._get_effective_views()
        thumbnail_data = [{
            "id": v.id,
            "title": v.title,
            "thumbnails_image": image_data_uri(v.thumbnail) if v.thumbnail else None,
        } for v in effective_views]

        config_matrix_ids = website.personalizer_matrix_product_ids.ids
        show_matrix_table = website.personalizer_enable_matrix and (
            not config_matrix_ids or product.product_tmpl_id.id in config_matrix_ids
        )

        return {
            "id": product.id,
            "product_tmpl_id": product.product_tmpl_id.id,
            "display_name": product.display_name,
            "list_price": product.lst_price,
            "final_price": price,
            "currency": website.currency_id.symbol if website else product.currency_id.symbol,
            "image_1920": image_data_uri(product.image_1920) if product.image_1920 else None,
            "product_thumbnail_views": thumbnail_data,
            "show_matrix_table": show_matrix_table,
        }

    @http.route('/get_product_image_views', type='json', auth='public')
    def get_product_image_views(self, product_id):
        """Return effective thumbnail views for a product variant."""
        product = request.env['product.product'].sudo().browse(int(product_id))
        if not product.exists():
            return []
        effective = product._get_effective_views()
        return [{
            "id": v.id,
            "title": v.title,
            "thumbnails_image": image_data_uri(v.thumbnail) if v.thumbnail else None,
        } for v in effective]

    @http.route('/tus_personalizer/matrix/data', type='json', auth='public', website=True)
    def get_matrix_data(self, product_tmpl_id):
        template = request.env['product.template'].sudo().browse(product_tmpl_id)
        if not template.exists():
            return []
        return template._prepare_color_size_matrix_data()

    @http.route('/tus_personalizer/matrix/get_prices', type='json', auth='public', website=True)
    def get_matrix_prices(self, product_ids):
        products = request.env['product.product'].sudo().browse(product_ids)
        return {
            product.id: self._get_product_unit_price(product)
            for product in products if product.exists()
        }

    @http.route('/tus_personalizer/matrix/get_size_matrix', type='json', auth='public', website=True)
    def get_size_matrix(self, product_tmpl_id):
        template = request.env['product.template'].sudo().browse(product_tmpl_id)
        if not template.exists():
            return []
        
        # All attributes except color
        size_attrs = template.attribute_line_ids.filtered(
            lambda l: l.attribute_id.display_type != 'color' and l.attribute_id.name.lower() not in ['color', 'colour']
        )
        
        res = []
        for line in size_attrs:
            res.append({
                'attribute_id': line.attribute_id.id,
                'attribute_name': line.attribute_id.name,
                'values': [{
                    'id': v.id,
                    'name': v.name
                } for v in line.value_ids]
            })
        return res
        return res
