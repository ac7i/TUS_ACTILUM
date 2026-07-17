from odoo import fields, models


class ResPartner(models.Model):
    _inherit = "res.partner"

    design_ids = fields.One2many("res.partner.design", "partner_id", string="Design(s)")


class CanvasImage(models.Model):
    _name = "canvas.image"
    _description = "Canvas Uploaded Images"

    name = fields.Char("Filename")
    file = fields.Binary("File", attachment=True, required=True)
    user_id = fields.Many2one("res.users", string="User", default=lambda self: self.env.user)
    original_attachment_id = fields.Many2one(
        "ir.attachment",
        string="Production Original",
        help="Unmodified TIFF/PDF/high-resolution source retained for production export.",
        ondelete="set null",
    )
    source_width = fields.Integer(string="Source Width (px)")
    source_height = fields.Integer(string="Source Height (px)")
    source_dpi = fields.Float(string="Source DPI")
    preview_scale = fields.Float(
        string="Preview Scale",
        help="Ratio of editor preview pixels to original source pixels (1.0 = full size).",
        default=1.0,
    )
