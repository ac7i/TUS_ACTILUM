import base64
import logging

from odoo import _, fields, models
from odoo.exceptions import UserError

from .finish_constants import (
    DEFAULT_RELIEF_MM,
    DEFAULT_VARNISH_TYPE,
    TEXTURE_INTENSITY_SELECTION,
    VARNISH_COVER_MODE_SELECTION,
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
    empty_canvas_margin_mm = fields.Float(
        string="Print Margin (mm)",
        default=0.0,
        help="Uniform print margin applied on all sides of the empty canvas sheet.",
    )
    texture_id = fields.Many2one(
        "editor.texture",
        string="Background Texture",
        ondelete="set null",
        copy=True,
    )
    texture_name = fields.Char(string="Texture Name", copy=True)
    texture_area_m2 = fields.Float(string="Texture Area (m²)", copy=True)
    texture_price = fields.Float(string="Texture Price", copy=True)

    # Customer-uploaded texture (emboss) processing file for this print side.
    texture_process_file = fields.Binary(
        string="Texture File", attachment=True, copy=True,
        help="Customer-uploaded file used for texture / emboss processing on this side.",
    )
    texture_process_filename = fields.Char(string="Texture File Name", copy=True)
    texture_intensity_mm = fields.Selection(
        selection=TEXTURE_INTENSITY_SELECTION,
        string="Texture Intensity",
        copy=True,
        help="Emboss relief depth selected by the customer for the texture file.",
    )

    # Customer varnish coverage settings for this print side.
    varnish_cover_mode = fields.Selection(
        selection=VARNISH_COVER_MODE_SELECTION,
        string="Varnish Area",
        copy=True,
        help="How the varnish should be applied: by an uploaded mask file, over "
             "the whole design, or over described zones.",
    )
    varnish_area_file = fields.Binary(
        string="Varnish Area File", attachment=True, copy=True,
        help="Customer-uploaded mask file describing the varnish coverage area.",
    )
    varnish_area_filename = fields.Char(string="Varnish Area File Name", copy=True)
    varnish_zones_description = fields.Text(
        string="Varnish Zones",
        copy=True,
        help="Free-text description of the areas the customer wants varnished.",
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

    def _get_selection_label(self, field_name):
        self.ensure_one()
        field = self._fields[field_name]
        value = self[field_name]
        if not value:
            return ""
        if callable(field.selection):
            selection = dict(field.selection(self))
        else:
            selection = dict(field.selection or [])
        return selection.get(value, value)

    def _get_production_sheet_side_data(self):
        self.ensure_one()
        imprints = []
        for imprint in self.design_ids:
            imprints.append({
                "label": imprint.element_label or "",
                "size": imprint.size_display or "",
                "colors": imprint.color_display or "",
                "finish": imprint._get_selection_label("tus_finish_effect"),
                "varnish": imprint._get_selection_label("tus_varnish_type"),
                "foil": imprint._get_selection_label("tus_foil_metal")
                if imprint.tus_foil_metal
                else "",
                "relief_mm": imprint.tus_relief_mm or 0.0,
            })

        files = []
        if self.uploaded_attachment:
            files.append({
                "name": self._download_filename("png"),
                "type": _("Preview"),
            })
        if self.design_svg:
            files.append({
                "name": self._download_filename("svg"),
                "type": _("Print SVG"),
            })
        if self.design_ai:
            files.append({
                "name": self._download_filename("ai"),
                "type": _("Print AI"),
            })
        if self.texture_process_file and self.texture_process_filename:
            files.append({
                "name": self.texture_process_filename,
                "type": _("Texture mask"),
            })
        if self.varnish_area_file and self.varnish_area_filename:
            files.append({
                "name": self.varnish_area_filename,
                "type": _("Varnish mask"),
            })

        side_type_labels = dict(self._fields["uploaded_type"].selection)
        return {
            "name": self.name,
            "side": side_type_labels.get(self.uploaded_type, self.uploaded_type or ""),
            "preview": self.uploaded_attachment,
            "print_width": self.print_width,
            "print_height": self.print_height,
            "print_unit": self.print_unit or "in",
            "margin_mm": self.empty_canvas_margin_mm,
            "background_color": self.canvas_background_color or "",
            "texture_name": self.texture_name or (
                self.texture_id.name if self.texture_id else ""
            ),
            "texture_area_m2": self.texture_area_m2,
            "texture_intensity": self._get_selection_label("texture_intensity_mm"),
            "texture_filename": self.texture_process_filename or "",
            "varnish_type": self._get_selection_label("finish_varnish_type"),
            "varnish_cover_mode": self._get_selection_label("varnish_cover_mode"),
            "varnish_zones": self.varnish_zones_description or "",
            "varnish_filename": self.varnish_area_filename or "",
            "finish_relief_mm": self.finish_relief_mm,
            "imprints": imprints,
            "files": files,
        }

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
