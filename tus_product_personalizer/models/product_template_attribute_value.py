from odoo import api, fields, models, _


class ProductTemplateAttributeValue(models.Model):
    _inherit = "product.template.attribute.value"

    image = fields.Binary(string="Image", help="Image for this attribute value (e.g. for color selection).")

    attribute_view_ids = fields.One2many(
        "product.view",
        "attribute_value_id",
        string="Attribute Views",
        help="Custom views for this specific color/attribute value."
    )
    is_views_customized = fields.Boolean(
        string="Views Customized",
        compute='_compute_is_views_customized',
        store=True,
    )

    @api.depends('attribute_view_ids')
    def _compute_is_views_customized(self):
        for rec in self:
            rec.is_views_customized = bool(rec.attribute_view_ids)

    def action_copy_views_from_template(self):
        """Copy all template master views into this attribute value as overrides."""
        ProductView = self.env['product.view']
        for rec in self:
            if rec.attribute_view_ids:
                continue
            template_views = rec.product_tmpl_id.views
            if not template_views:
                continue
            vals_list = []
            for tv in template_views:
                vals_list.append({
                    'attribute_value_id': rec.id,
                    'product_template_id': rec.product_tmpl_id.id,
                    'title': tv.title,
                    'thumbnail': tv.thumbnail,
                    'design_areas_json': tv.design_areas_json,
                    'stage_width': tv.stage_width,
                    'stage_height': tv.stage_height,
                    'image_width': tv.image_width,
                    'image_height': tv.image_height,
                })
            if vals_list:
                ProductView.create(vals_list)

    def action_reset_views_to_template(self):
        """Delete attribute-level overrides."""
        for rec in self:
            rec.attribute_view_ids.unlink()
