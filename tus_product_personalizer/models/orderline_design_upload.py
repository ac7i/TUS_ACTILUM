import base64
import logging

from odoo import _, fields, models
from odoo.exceptions import UserError

from .finish_constants import (
    DEFAULT_RELIEF_MM,
    DEFAULT_VARNISH_TYPE,
    VARNISH_TYPE_SELECTION,
)

_logger = logging.getLogger(__name__)


class OrderlineDesignUpload(models.Model):
    _name = "orderline.design.upload"
    _inherit = ["mail.thread", "mail.activity.mixin"]
    _rec_name = "name"
    _description = "OrderLine Design Upload"

    order_id = fields.Many2one("sale.order", string="Order")
    name = fields.Char("Name", required=True)
    order_line = fields.Many2one("sale.order.line", string="Order Line")
    uploaded_type = fields.Selection(
        selection=[("front", "Front"), ("back", "Back"), ("left", "Left"), ("right", "Right")],
        string="Design Type",
        default="front",
    )
    uploaded_attachment = fields.Binary("Preview", attachment=True)
    uploaded_attachment_rel = fields.Binary(related="uploaded_attachment")
    design_svg = fields.Binary("Print SVG", attachment=True)
    design_ai = fields.Binary("Print AI", attachment=True)
    print_width = fields.Float("Print Width")
    print_height = fields.Float("Print Height")
    print_unit = fields.Char("Print Unit", default="in")
    canvas_background_color = fields.Char(
        string="Canvas Background",
        default="#ffffff",
        help="Background color of the empty canvas sheet for this print side.",
    )
    design_ids = fields.One2many("orderline.imprint.design", "design_id", string="Imprint Designs")
    finish_varnish_type = fields.Selection(
        selection=VARNISH_TYPE_SELECTION,
        string="Side Varnish",
        default=DEFAULT_VARNISH_TYPE,
    )
    finish_relief_mm = fields.Float(
        string="Side Relief (mm)",
        default=DEFAULT_RELIEF_MM,
        help="Global emboss relief depth for this print side (3D preview / production notes).",
    )

    def _get_print_color_mode(self):
        website = self.env['website'].get_current_website()
        return website.personalizer_print_color_mode or 'cmyk'

    def _get_print_color_map(self):
        from odoo.addons.tus_product_personalizer.utils.color_conversion import build_print_color_map

        self.ensure_one()
        hex_colors = [
            value for value in self.design_ids.mapped('imprint_colors') if value
        ]
        palette_records = self.design_ids.mapped('printable_color_id')
        all_palettes = self.env['editor.color.palette'].search([])
        return build_print_color_map(hex_colors, palette_records, all_palettes)

    def _download_filename(self, extension):
        self.ensure_one()
        side = self.uploaded_type or "design"
        safe_name = (self.name or str(self.id)).replace("/", "-")
        return f"{side}_{safe_name}.{extension}"

    def _get_svg_bytes(self):
        from odoo.addons.tus_product_personalizer.utils.print_vector import is_vector_svg_bytes

        self.ensure_one()
        if not self.design_svg:
            return None
        data = base64.b64decode(self.design_svg)
        if not is_vector_svg_bytes(data):
            _logger.error("design_svg for record %s is not SVG markup", self.id)
            return None
        return data

    def _ensure_print_files(self, force=False):
        """Generate SVG/AI on demand from imprint_image (PNG).

        With force=True the files are always rebuilt from the source artwork,
        so improvements to the tracer take effect even when a (stale) SVG was
        cached by an earlier download.
        """
        self.ensure_one()
        if not force and self._get_svg_bytes():
            return

        from odoo.addons.tus_product_personalizer.utils.print_vector import build_print_files

        # Only the transparent artwork snapshot (imprint_image) is ever traced.
        # The uploaded_attachment is the product mockup composite and must never
        # be used as a print source.
        imprint = self.design_ids.filtered(lambda d: d.imprint_image)[:1]
        if not imprint:
            return
        raster_bytes = base64.b64decode(imprint.imprint_image)
        width = imprint.imprint_width or self.print_width or None
        height = imprint.imprint_height or self.print_height or None
        unit = imprint.imprint_width_uom.name if imprint.imprint_width_uom else (self.print_unit or "in")

        if not raster_bytes:
            return

        color_map = self._get_print_color_map()
        output_color_mode = self._get_print_color_mode()
        files = build_print_files(
            raster_bytes=raster_bytes,
            width=width,
            height=height,
            unit=unit,
            color_map=color_map,
            output_color_mode=output_color_mode,
        )
        vals = {}
        if files.get("svg"):
            vals["design_svg"] = base64.b64encode(files["svg"].encode("utf-8"))
        if files.get("ai"):
            vals["design_ai"] = base64.b64encode(files["ai"])
        if vals:
            self.sudo().write(vals)

    def _download_attachment_action(self, raw_bytes, filename, mimetype):
        attachment = self.env["ir.attachment"].sudo().create({
            "name": filename,
            "type": "binary",
            "datas": base64.b64encode(raw_bytes),
            "mimetype": mimetype,
            "res_model": self._name,
            "res_id": self.id,
        })
        return {
            "type": "ir.actions.act_url",
            "url": f"/web/content/{attachment.id}?download=true",
            "target": "self",
        }

    def action_download_design(self):
        """Download shop preview PNG."""
        self.ensure_one()
        if not self.uploaded_attachment:
            raise UserError(_("No preview image to download."))
        return {
            "type": "ir.actions.act_url",
            "url": (
                f"/web/content/{self._name}/{self.id}/uploaded_attachment/"
                f"{self._download_filename('png')}?download=true"
            ),
            "target": "self",
        }

    def action_download_svg(self):
        self.ensure_one()
        self._ensure_print_files(force=True)
        svg_bytes = self._get_svg_bytes()
        if not svg_bytes:
            raise UserError(_("Could not generate vector SVG for this design. Place a new order after upgrading the module."))
        return self._download_attachment_action(
            svg_bytes,
            self._download_filename("svg"),
            "image/svg+xml",
        )

    def action_download_ai(self):
        self.ensure_one()
        self._ensure_print_files(force=True)
        if not self.design_ai:
            raise UserError(_("Could not generate AI file. Install cairosvg in the Odoo Python environment."))
        return self._download_attachment_action(
            base64.b64decode(self.design_ai),
            self._download_filename("ai"),
            "application/pdf",
        )
