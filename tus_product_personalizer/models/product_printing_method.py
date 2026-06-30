from odoo import api, fields, models, _

class ProductPrintingMethod(models.Model):
    _name = "product.printing.method"
    _description = "Product Printing Method"
    _order = "sequence, id"

    name = fields.Char(string="Name", required=True)
    code = fields.Char(string="Code", required=True)
    sequence = fields.Integer(string="Sequence", default=10)
    setup_cost = fields.Float(string="Setup Cost", default=0.0)
    unit_cost = fields.Float(string="Unit Cost", default=0.0)
    work_center_id = fields.Many2one('mrp.workcenter', string="Work Center")


class ProductTemplate(models.Model):
    _inherit = "product.template"

    allowed_printing_method_ids = fields.Many2many(
        "product.printing.method",
        string="Allowed Printing Methods",
        help="Select which printing methods are allowed for this product in the personalizer.",
    )


class SaleOrderLine(models.Model):
    _inherit = "sale.order.line"

    printing_method_id = fields.Many2one(
        "product.printing.method",
        string="Printing Method",
        help="The printing method selected by the user for this customizable order line.",
    )


class MrpProduction(models.Model):
    _inherit = "mrp.production"

    printing_method_id = fields.Many2one(
        "product.printing.method",
        string="Printing Method",
        help="The printing method designated for this manufacturing order.",
        readonly=True,
    )

    @api.model_create_multi
    def create(self, vals_list):
        productions = super(MrpProduction, self).create(vals_list)
        for prod in productions:
            # Step 1: Find the originating sale order line
            lines = prod.move_dest_ids.sale_line_id
            if not lines and prod.origin:
                sale_order = self.env['sale.order'].sudo().search([('name', '=', prod.origin)], limit=1)
                if sale_order:
                    lines = sale_order.order_line.filtered(lambda l: l.product_id == prod.product_id)
            
            # Step 2: Copy Printing Method and Attachments if found
            line = lines[:1]
            if line:
                if line.printing_method_id:
                    prod.write({'printing_method_id': line.printing_method_id.id})
                    
                    # Custom Routing: If printing method has a configured Work Center, update the Work Orders
                    if line.printing_method_id.work_center_id and prod.workorder_ids:
                        for wo in prod.workorder_ids:
                            wo.write({'workcenter_id': line.printing_method_id.work_center_id.id})
                
                if line.uploaded_design_ids:
                    attachment_vals = [
                        {
                            'name': f"Print_File_{prod.name}_{design.uploaded_type or 'custom'}.png",
                            'type': 'binary',
                            'datas': design.uploaded_attachment,
                            'res_model': 'mrp.production',
                            'res_id': prod.id,
                        }
                        for design in line.uploaded_design_ids
                        if design.uploaded_attachment
                    ]
                    if attachment_vals:
                        self.env['ir.attachment'].sudo().create(attachment_vals)
        return productions
