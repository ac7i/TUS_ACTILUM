from odoo import fields, models


class ResPartnerDesign(models.Model):
    _name = "res.partner.design"

    name = fields.Char("Name")
    partner_id = fields.Many2one("res.partner", string="Customer")
    product_id = fields.Many2one("product.product", string="Product")
    sale_line_id = fields.Many2one("sale.order.line", string="Sale Order Line")
    uploaded_attachment = fields.Binary("Attachment", attachment=True)
    attachment_id = fields.Many2one("ir.attachment", "Attachment")
    view_image = fields.Binary("View Image", attachment=True)
