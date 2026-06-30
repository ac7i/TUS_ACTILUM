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
