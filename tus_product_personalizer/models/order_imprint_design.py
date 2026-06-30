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
            if record.imprint_design_attribute:
                try:
                    record.imprint_design_display = json.dumps(
                        record.imprint_design_attribute,
                        indent=2,
                        ensure_ascii=False
                    )
                except (TypeError, ValueError):
                    record.imprint_design_display = str(record.imprint_design_attribute)
            else:
                record.imprint_design_display = ""
