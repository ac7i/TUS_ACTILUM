from odoo import api, fields, models, _
from odoo.exceptions import ValidationError

from .editor_canvas_preset import CANVAS_UNIT_SELECTION


class ProductTemplate(models.Model):
    _inherit = "product.template"

    design_template_ids = fields.One2many(
        "product.design.template",
        "product_tmpl_id",
        string="Design Templates",
    )

    def action_open_design_template_import(self):
        self.ensure_one()
        return {
            "type": "ir.actions.act_window",
            "name": _("Import Design Template"),
            "res_model": "design.template.import.wizard",
            "view_mode": "form",
            "target": "new",
            "context": {"default_product_tmpl_id": self.id},
        }

    def action_open_design_template_sheet_import(self):
        self.ensure_one()
        return {
            "type": "ir.actions.act_window",
            "name": _("Import Templates from Excel"),
            "res_model": "design.template.sheet.import.wizard",
            "view_mode": "form",
            "target": "new",
            "context": {"default_product_tmpl_id": self.id},
        }

    show_printing_method_config = fields.Boolean(
        compute='_compute_show_printing_method_config'
    )
    show_3d_preview_config = fields.Boolean(
        compute='_compute_show_3d_preview_config',
    )
    personalizer_enable_3d_preview = fields.Boolean(
        string="3D Preview",
        default=False,
        help="Enable PBR 3D preview for this product in the designer (requires 3D Preview in website settings)",
    )
    personalizer_enable_vdp = fields.Boolean(
        string="Variable Data Printing",
        default=False,
        help="Allow customers to upload a dataset and print unique text per item (e.g. names on mugs).",
    )
    show_vdp_config = fields.Boolean(compute="_compute_show_vdp_config")
    empty_canvas = fields.Boolean(
        string="Empty Canvas",
        default=False,
        help="Allow customers to design on a blank canvas with a chosen size. "
        "Print-to-Web views are not required.",
    )
    empty_canvas_allow_custom = fields.Boolean(
        string="Allow Custom Size",
        default=True,
        help="Let customers enter custom width and height on the product page.",
    )
    empty_canvas_preset_ids = fields.Many2many(
        "editor.canvas.preset",
        "product_template_empty_canvas_preset_rel",
        "product_tmpl_id",
        "preset_id",
        string="Canvas Size Presets",
        help="Presets offered for this product. Leave empty to offer all active presets.",
    )
    empty_canvas_option_ids = fields.Many2many(
        "editor.canvas.product.option",
        "product_template_empty_canvas_option_rel",
        "product_tmpl_id",
        "option_id",
        string="Canvas Product Options",
        help="Finish, print quality, print mode, and machining options for this product. "
        "Leave empty to offer all active options.",
    )
    empty_canvas_custom_min = fields.Float(string="Custom Min Size")
    empty_canvas_custom_max = fields.Float(string="Custom Max Size")
    empty_canvas_custom_unit = fields.Selection(
        CANVAS_UNIT_SELECTION,
        string="Custom Size Unit",
        default="in",
    )
    empty_canvas_enable_design_templates = fields.Boolean(
        string="Enable Design Templates",
        default=True,
        help="When Empty Canvas is enabled, allow applying product design templates "
        "and auto-load the default template when the designer opens.",
    )

    @api.constrains("empty_canvas", "views")
    def _check_empty_canvas_views_exclusive(self):
        for template in self:
            if template.empty_canvas and template.views:
                raise ValidationError(
                    _("Empty Canvas products cannot have Print-to-Web views. "
                      "Remove existing views or disable Empty Canvas.")
                )

    def _compute_show_vdp_config(self):
        website = self.env['website'].get_current_website(fallback=True)
        enable_vdp = website.personalizer_enable_vdp if website else False
        for template in self:
            template.show_vdp_config = enable_vdp

    def _compute_show_3d_preview_config(self):
        website = self.env['website'].get_current_website(fallback=True)
        enable_3d = website.personalizer_enable_3d_preview if website else False
        for template in self:
            template.show_3d_preview_config = enable_3d

    def _compute_show_printing_method_config(self):
        website = self.env['website'].get_current_website(fallback=True)
        enable_printing = website.personalizer_enable_printing if website else False
        printing_product_ids = website.personalizer_printing_product_ids.ids if (website and website.personalizer_printing_product_ids) else []
        for template in self:
            if not enable_printing:
                template.show_printing_method_config = False
            elif printing_product_ids:
                template.show_printing_method_config = template.id in printing_product_ids
            else:
                template.show_printing_method_config = True

    def _matrix_variant_unit_price(self, variant):
        """Pricelist-aware unit price for matrix rows (website context)."""
        website = self.env['website'].get_current_website(fallback=False)
        if website:
            pricelist = website._get_and_cache_current_pricelist()
            if pricelist:
                return pricelist._get_product_price(
                    variant, 1.0, uom=variant.uom_id
                )
        return variant.lst_price

    def _prepare_color_size_matrix_data(self):
        """Organizes product variants into a color-based matrix structure."""
        self.ensure_one()
        
        # Identify attributes
        color_attr = self.attribute_line_ids.filtered(
            lambda l: l.attribute_id.display_type == 'color' or l.attribute_id.name.lower() in ['color', 'colour']
        )
        # All other attributes are treated as 'size' or 'option' for the matrix columns
        size_attrs = self.attribute_line_ids - color_attr

        if not color_attr:
            return []

        matrix_data = []
        for color_val in color_attr.product_template_value_ids:
            # Find all variants for this color
            color_variants = self.product_variant_ids.filtered(
                lambda p: color_val in p.product_template_attribute_value_ids
            )
            
            size_data = []
            for variant in color_variants:
                # Identify the "size" part of this variant
                variant_size_vals = variant.product_template_attribute_value_ids.filtered(
                    lambda v: v.attribute_id in size_attrs.attribute_id
                )
                size_label = " / ".join(variant_size_vals.mapped('name')) or "Default"
                
                size_data.append({
                    'product_id': variant.id,
                    'size_label': size_label,
                    'price': self._matrix_variant_unit_price(variant),
                    'qty': 0,
                })
            
            matrix_data.append({
                'color_id': color_val.id,
                'color_name': color_val.name,
                'html_color': color_val.html_color,
                'image': f"/web/image/product.template.attribute.value/{color_val.id}/image" if color_val.image else (f"/web/image/product.product/{color_variants[0].id}/image_128" if color_variants and color_variants[0].image_128 else ""),
                'is_customized': color_val.is_views_customized,
                'background_image': f"/web/image/product.product/{color_variants[0].id}/image_1920" if color_variants else "",
                'sizes': size_data,
            })
            
        return matrix_data
