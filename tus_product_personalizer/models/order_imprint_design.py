import base64
import json

from odoo import _, api, fields, models
from odoo.exceptions import UserError

from .finish_constants import (
    DEFAULT_FINISH_EFFECT,
    DEFAULT_RELIEF_MM,
    DEFAULT_VARNISH_TYPE,
    FINISH_EFFECT_SELECTION,
    FOIL_METAL_SELECTION,
    VARNISH_TYPE_SELECTION,
)


_DISPLAY_OMIT_KEYS = frozenset({
    "src",
    "element_image",
    "data",
    "dataurl",
    "preview",
    "image",
    "elementimage",
})
_MAX_INLINE_STRING = 160


def _looks_like_embedded_binary(value):
    if not isinstance(value, str) or len(value) < 80:
        return False
    if value.startswith("data:"):
        return True
    sample = value[:256]
    if sample.startswith("/9j/") or sample.startswith("iVBOR"):
        return True
    allowed = set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=\n\r")
    return len(sample) > 120 and sum(ch in allowed for ch in sample) / len(sample) > 0.95


def _sanitize_imprint_attr_for_display(value, key=None):
    """Strip huge binary payloads so technical JSON stays readable."""
    if isinstance(value, dict):
        return {
            child_key: _sanitize_imprint_attr_for_display(child_value, child_key)
            for child_key, child_value in value.items()
        }
    if isinstance(value, list):
        return [_sanitize_imprint_attr_for_display(item) for item in value]
    if isinstance(value, str):
        key_name = (key or "").lower()
        if key_name in _DISPLAY_OMIT_KEYS or _looks_like_embedded_binary(value):
            return "<omitted (%s characters)>" % len(value)
        if len(value) > _MAX_INLINE_STRING:
            return "%s…" % value[:_MAX_INLINE_STRING]
    return value


class OrderImprintDesign(models.Model):
    _name = "orderline.imprint.design"
    _order = "id desc"
    _description = "Orderline Imprint Design"

    design_id = fields.Many2one('orderline.design.upload', string="Design", required=True)
    imprint_design_attribute = fields.Json("Imprint Design Attribute")
    imprint_image = fields.Binary(attachment=True, string="Design Image")
    imprint_svg = fields.Binary(attachment=True, string="Design SVG")
    imprint_width = fields.Float("Design Width")
    imprint_height = fields.Float("Design Height")
    imprint_colors = fields.Char(string="Screen Color (Hex)")
    imprint_cmyk = fields.Char(
        string="Print Color (CMYK)",
        help="CMYK values for print production, e.g. C100 M50 Y0 K0 or a Pantone code.",
    )
    imprint_width_uom = fields.Many2one('uom.uom', default=lambda self: self.env.ref('uom.product_uom_inch'))
    imprint_height_uom = fields.Many2one('uom.uom', default=lambda self: self.env.ref('uom.product_uom_inch'))
    printable_color_id = fields.Many2one('editor.color.palette')
    tus_finish_effect = fields.Selection(
        selection=FINISH_EFFECT_SELECTION,
        string="Finish",
        default=DEFAULT_FINISH_EFFECT,
    )
    tus_relief_mm = fields.Float(
        string="Relief (mm)",
        default=DEFAULT_RELIEF_MM,
    )
    tus_varnish_type = fields.Selection(
        selection=VARNISH_TYPE_SELECTION,
        string="Varnish",
        default=DEFAULT_VARNISH_TYPE,
    )
    tus_foil_metal = fields.Selection(
        selection=FOIL_METAL_SELECTION,
        string="Foil Metal",
    )
    imprint_design_display = fields.Text(
        string="Imprint Design",
        compute="_compute_imprint_design_display",
    )
    element_label = fields.Char(
        string="Element",
        compute="_compute_imprint_summary",
    )
    size_display = fields.Char(
        string="Size",
        compute="_compute_imprint_summary",
    )
    color_display = fields.Char(
        string="Colors",
        compute="_compute_imprint_summary",
    )

    @api.depends(
        "imprint_design_attribute",
        "imprint_width",
        "imprint_height",
        "imprint_width_uom",
        "imprint_colors",
        "imprint_cmyk",
        "printable_color_id",
        "imprint_image",
    )
    def _compute_imprint_summary(self):
        for record in self:
            attrs = record.imprint_design_attribute if isinstance(
                record.imprint_design_attribute, dict
            ) else {}
            el_type = attrs.get("type") or ""
            text = (attrs.get("text") or "").strip()
            if text:
                snippet = text[:48] + ("…" if len(text) > 48 else "")
                record.element_label = _("Text: %s") % snippet
            elif el_type in ("image", "group") or record.imprint_image:
                record.element_label = _("Image")
            elif el_type:
                record.element_label = el_type.replace("_", " ").title()
            else:
                record.element_label = _("Element")

            uom_name = record.imprint_width_uom.name if record.imprint_width_uom else ""
            if record.imprint_width and record.imprint_height:
                record.size_display = _(
                    "%(width)g × %(height)g %(unit)s",
                    width=record.imprint_width,
                    height=record.imprint_height,
                    unit=uom_name,
                ).strip()
            else:
                record.size_display = ""

            color_parts = []
            if record.imprint_colors:
                color_parts.append(record.imprint_colors)
            if record.imprint_cmyk:
                color_parts.append(record.imprint_cmyk)
            elif record.printable_color_id:
                color_parts.append(record.printable_color_id.display_name)
            record.color_display = " · ".join(color_parts)

    def _get_print_color_mode(self):
        """Return 'cmyk' or 'rgb' based on website print settings."""
        website = self.env['website'].get_current_website()
        return website.personalizer_print_color_mode or 'cmyk'

    def _get_print_color_map(self):
        """Build hex → CMYK map from imprint colors and the palette."""
        from odoo.addons.tus_product_personalizer.utils.color_conversion import build_print_color_map

        self.ensure_one()
        imprints = self.design_id.design_ids
        hex_colors = [
            value for value in imprints.mapped('imprint_colors') if value
        ]
        if self.imprint_colors:
            hex_colors.append(self.imprint_colors)
        palette_records = imprints.mapped('printable_color_id')
        if self.printable_color_id:
            palette_records |= self.printable_color_id
        all_palettes = self.env['editor.color.palette'].search([])
        return build_print_color_map(hex_colors, palette_records, all_palettes)

    def _get_imprint_svg_bytes(self, force=True):
        """Return imprint SVG bytes, always rebuilt from imprint_image.

        force=True (default) re-traces the source PNG every time so the latest
        tracer is used and a previously cached (low-quality) SVG is replaced.
        """
        from odoo.addons.tus_product_personalizer.utils.print_vector import (
            build_print_files,
            is_vector_svg_bytes,
        )

        self.ensure_one()
        if not force and self.imprint_svg:
            data = base64.b64decode(self.imprint_svg)
            if is_vector_svg_bytes(data):
                return data

        if not self.imprint_image:
            return None

        unit = self.imprint_width_uom.name if self.imprint_width_uom else "in"
        raster_bytes = base64.b64decode(self.imprint_image)
        files = build_print_files(
            raster_bytes=raster_bytes,
            width=self.imprint_width or None,
            height=self.imprint_height or None,
            unit=unit,
            color_map=self._get_print_color_map(),
            output_color_mode=self._get_print_color_mode(),
        )
        if not files.get("svg"):
            return None
        svg_bytes = files["svg"].encode("utf-8")
        self.sudo().write({
            "imprint_svg": base64.b64encode(svg_bytes),
        })
        return svg_bytes

    def action_download_imprint(self):
        self.ensure_one()
        if not self.imprint_image:
            raise UserError(_("No imprint image to download."))
        return {
            "type": "ir.actions.act_url",
            "url": (
                f"/web/content/{self._name}/{self.id}/imprint_image/"
                f"imprint_{self.id}.png?download=true"
            ),
            "target": "self",
        }

    def action_download_imprint_svg(self):
        self.ensure_one()
        svg_bytes = self._get_imprint_svg_bytes()
        if not svg_bytes:
            raise UserError(_("Could not generate imprint SVG."))
        attachment = self.env["ir.attachment"].sudo().create({
            "name": f"imprint_{self.id}.svg",
            "type": "binary",
            "datas": base64.b64encode(svg_bytes),
            "mimetype": "image/svg+xml",
            "res_model": self._name,
            "res_id": self.id,
        })
        return {
            "type": "ir.actions.act_url",
            "url": f"/web/content/{attachment.id}?download=true",
            "target": "self",
        }

    @api.depends('imprint_design_attribute')
    def _compute_imprint_design_display(self):
        for record in self:
            if not record.imprint_design_attribute:
                record.imprint_design_display = ""
                continue
            try:
                payload = _sanitize_imprint_attr_for_display(record.imprint_design_attribute)
                record.imprint_design_display = json.dumps(
                    payload,
                    indent=2,
                    ensure_ascii=False,
                    sort_keys=True,
                )
            except (TypeError, ValueError):
                record.imprint_design_display = str(record.imprint_design_attribute)
