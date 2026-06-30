import json

from odoo import api, fields, models, _
from odoo.exceptions import ValidationError


class ProductProduct(models.Model):
    _inherit = "product.product"

    variant_view_ids = fields.One2many(
        "product.view", "product_id",
        string="Variant View Overrides",
        help="Custom views for this variant. When empty, the variant "
             "inherits views from the product template.",
    )
    is_views_customized = fields.Boolean(
        string="Views Customized",
        compute='_compute_is_views_customized',
        store=True,
        help="True when this variant has its own custom views "
             "instead of inheriting from the product template.",
    )

    @api.depends('variant_view_ids')
    def _compute_is_views_customized(self):
        for variant in self:
            variant.is_views_customized = bool(variant.variant_view_ids)

    def _get_effective_views(self):
        """Return the effective views for this variant.
        Order: Variant overrides -> Color attribute overrides -> Template masters.
        """
        self.ensure_one()
        if self.variant_view_ids:
            return self.variant_view_ids
        
        # Check for color-specific overrides
        color_val = self.product_template_attribute_value_ids.filtered(
            lambda v: v.attribute_id.display_type == 'color' or v.attribute_id.name.lower() in ['color', 'colour']
        )[:1]
        if color_val:
            color_views = self.env['product.view'].sudo().search([
                ('product_template_id', '=', self.product_tmpl_id.id),
                ('attribute_value_id', '=', color_val.id)
            ])
            if color_views:
                return color_views

        return self.product_tmpl_id.views

    def action_copy_views_from_template(self):
        """Copy all template master views into this variant as overrides.

        Typically used when the admin wants to customize only the
        thumbnail image — one click copies the full configuration,
        then they just swap the image on the desired row.
        """
        ProductView = self.env['product.view']
        for variant in self:
            if variant.variant_view_ids:
                continue
            template_views = variant.product_tmpl_id.views
            if not template_views:
                continue
            vals_list = []
            for tv in template_views:
                vals_list.append({
                    'product_id': variant.id,
                    'product_template_id': variant.product_tmpl_id.id,
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
        """Delete variant-level overrides, reverting to template views."""
        for variant in self:
            variant.variant_view_ids.unlink()


class ProductView(models.Model):
    _name = "product.view"
    _description = "Product View"

    title = fields.Selection(
        [("front", "Front"), ("back", "Back"), ('right', 'Right'), ('left', 'Left')],
        default="front", string="Title",
    )
    thumbnail = fields.Binary(string="Thumbnail", attachment=True)
    product_template_id = fields.Many2one(
        "product.template", string="Product Template",
        index=True,
    )
    product_id = fields.Many2one(
        "product.product", string="Variant Override",
        ondelete="cascade", index=True,
        help="If set, this view is a variant-level override. "
             "If empty, it belongs to the product template (master).",
    )
    design_areas_json = fields.Json(string="Design Area")
    stage_width = fields.Float(string="Stage Width")
    stage_height = fields.Float(string="Stage Height")
    image_width = fields.Float(string="Image Width")
    image_height = fields.Float(string="Image Height")
    attribute_value_id = fields.Many2one(
        "product.template.attribute.value",
        string="Attribute Value",
        ondelete="cascade",
        index=True,
        help="If set, this view belongs to a specific attribute value (e.g. Color)."
    )
    def write(self, vals):
        res = super(ProductView, self).write(vals)
        if 'design_areas_json' not in vals:
            return res
        master_views = self.filtered(
            lambda v: not v.product_id
            and not v.attribute_value_id
            and v.product_template_id
            and v.design_areas_json
        )
        if not master_views:
            return res
        for view in master_views:
            try:
                master_areas = (
                    json.loads(view.design_areas_json)
                    if isinstance(view.design_areas_json, str)
                    else view.design_areas_json
                )
            except (TypeError, ValueError):
                continue
            master_prices = {
                ma['id']: ma['meta']['price']
                for ma in master_areas
                if isinstance(ma, dict)
                and ma.get('id')
                and isinstance(ma.get('meta'), dict)
                and 'price' in ma['meta']
            }
            if not master_prices:
                continue
            child_views = self.env['product.view'].search([
                ('product_template_id', '=', view.product_template_id.id),
                ('title', '=', view.title),
                '|',
                ('product_id', '!=', False),
                ('attribute_value_id', '!=', False),
            ])
            for child in child_views:
                if not child.design_areas_json:
                    continue
                try:
                    child_areas = (
                        json.loads(child.design_areas_json)
                        if isinstance(child.design_areas_json, str)
                        else child.design_areas_json
                    )
                except (TypeError, ValueError):
                    continue
                modified = False
                for ca in child_areas:
                    if isinstance(ca, dict) and ca.get('id') in master_prices:
                        ca.setdefault('meta', {})
                        if ca['meta'].get('price') != master_prices[ca['id']]:
                            ca['meta']['price'] = master_prices[ca['id']]
                            modified = True
                if modified:
                    new_areas = (
                        json.dumps(child_areas)
                        if isinstance(child.design_areas_json, str)
                        else child_areas
                    )
                    super(ProductView, child).write({'design_areas_json': new_areas})
        return res

    @api.constrains("title", "product_template_id", "product_id", "attribute_value_id")
    def _check_unique_title(self):
        for rec in self:
            domain = [("title", "=", rec.title), ("id", "!=", rec.id)]
            if rec.product_id:
                domain.append(("product_id", "=", rec.product_id.id))
            elif rec.attribute_value_id:
                domain.append(("attribute_value_id", "=", rec.attribute_value_id.id))
            else:
                domain.append(("product_template_id", "=", rec.product_template_id.id))
                domain.append(("product_id", "=", False))
                domain.append(("attribute_value_id", "=", False))
            if self.search_count(domain):
                if rec.product_id:
                    owner = rec.product_id.display_name
                elif rec.attribute_value_id:
                    owner = rec.attribute_value_id.display_name
                else:
                    owner = rec.product_template_id.display_name
                
                raise ValidationError(
                    _("'%s' already has a '%s' view.") % (owner, rec.title)
                )

class ProductTemplate(models.Model):
    _inherit = "product.template"

    views = fields.One2many(
        "product.view", "product_template_id",
        string="Product Views",
        domain=[('product_id', '=', False), ('attribute_value_id', '=', False)],
    )
    title = fields.Char(string="Title", help="Title of the product template")
    thumbnail = fields.Binary(
        string="Thumbnail", help="Thumbnail image of the product template"
    )


class EditorColorPalette(models.Model):
    _name = "editor.color.palette"
    _description = "Editor Color Palette"
    _order = "sequence, id"

    name = fields.Char(string="Color Name", required=True)
    color_code = fields.Char(
        string="Hex Code (Screen RGB)",
        required=True,
        help="Screen preview color in hex format, e.g. #187983",
        default="#000000",
    )
    sequence = fields.Integer(string="Sequence")
    use_manual_cmyk = fields.Boolean(
        string="Manual CMYK",
        default=False,
        help="When enabled, enter CMYK values for print production. The hex "
             "color preview updates automatically from CMYK so you can verify "
             "the conversion before saving.",
    )
    c_cyan = fields.Float(string="Cyan %", default=0.0)
    c_magenta = fields.Float(string="Magenta %", default=0.0)
    c_yellow = fields.Float(string="Yellow %", default=0.0)
    c_key = fields.Float(string="Key (Black) %", default=100.0)
    cmyk_display = fields.Char(
        string="CMYK",
        compute="_compute_cmyk_display",
        store=True,
    )
    pantone_code = fields.Char(
        string="Pantone / Spot Color",
        help="Optional spot-color reference for the print shop (e.g. Pantone 186 C).",
    )
    is_out_of_gamut = fields.Boolean(
        string="Out of CMYK Gamut",
        compute="_compute_is_out_of_gamut",
        help="True when the screen RGB color differs noticeably from its CMYK round-trip.",
    )

    @api.depends("c_cyan", "c_magenta", "c_yellow", "c_key", "pantone_code")
    def _compute_cmyk_display(self):
        for record in self:
            if record.pantone_code:
                record.cmyk_display = record.pantone_code
            else:
                record.cmyk_display = record._format_cmyk_display()

    @api.depends("color_code", "c_cyan", "c_magenta", "c_yellow", "c_key", "use_manual_cmyk")
    def _compute_is_out_of_gamut(self):
        from odoo.addons.tus_product_personalizer.utils.color_conversion import (
            cmyk_percent_to_hex,
            hex_to_cmyk_percent,
            normalize_hex,
        )

        for record in self:
            record.is_out_of_gamut = False
            normalized = normalize_hex(record.color_code)
            if not normalized:
                continue
            if record.use_manual_cmyk:
                converted = cmyk_percent_to_hex(
                    record.c_cyan, record.c_magenta, record.c_yellow, record.c_key
                )
            else:
                c, m, y, k = hex_to_cmyk_percent(normalized)
                converted = cmyk_percent_to_hex(c, m, y, k)
            if converted.lower() != normalized.lower():
                record.is_out_of_gamut = True

    def _format_cmyk_display(self):
        self.ensure_one()
        from odoo.addons.tus_product_personalizer.utils.color_conversion import format_cmyk_display

        return format_cmyk_display(
            self.c_cyan, self.c_magenta, self.c_yellow, self.c_key
        )

    def get_cmyk_values(self):
        """Return CMYK percent tuple (c, m, y, k) for print export."""
        self.ensure_one()
        return (
            self.c_cyan or 0.0,
            self.c_magenta or 0.0,
            self.c_yellow or 0.0,
            self.c_key or 0.0,
        )

    def _sync_cmyk_from_hex(self):
        from odoo.addons.tus_product_personalizer.utils.color_conversion import hex_to_cmyk_percent

        for record in self.filtered(lambda p: not p.use_manual_cmyk and p.color_code):
            c, m, y, k = hex_to_cmyk_percent(record.color_code)
            super(EditorColorPalette, record).write({
                "c_cyan": c,
                "c_magenta": m,
                "c_yellow": y,
                "c_key": k,
            })

    def _sync_hex_from_cmyk(self):
        """Update screen hex preview from manual CMYK values."""
        from odoo.addons.tus_product_personalizer.utils.color_conversion import cmyk_percent_to_hex

        for record in self.filtered(lambda p: p.use_manual_cmyk):
            hex_color = cmyk_percent_to_hex(
                record.c_cyan or 0.0,
                record.c_magenta or 0.0,
                record.c_yellow or 0.0,
                record.c_key or 0.0,
            )
            if record.color_code != hex_color:
                super(EditorColorPalette, record).write({"color_code": hex_color})

    @api.onchange("use_manual_cmyk", "c_cyan", "c_magenta", "c_yellow", "c_key")
    def _onchange_manual_cmyk(self):
        from odoo.addons.tus_product_personalizer.utils.color_conversion import (
            cmyk_percent_to_hex,
            hex_to_cmyk_percent,
        )

        if self.use_manual_cmyk:
            self.color_code = cmyk_percent_to_hex(
                self.c_cyan or 0.0,
                self.c_magenta or 0.0,
                self.c_yellow or 0.0,
                self.c_key or 0.0,
            )
        elif self.color_code:
            c, m, y, k = hex_to_cmyk_percent(self.color_code)
            self.c_cyan, self.c_magenta, self.c_yellow, self.c_key = c, m, y, k

    @api.onchange("color_code")
    def _onchange_color_code(self):
        from odoo.addons.tus_product_personalizer.utils.color_conversion import hex_to_cmyk_percent

        if self.use_manual_cmyk:
            return
        if self.color_code:
            c, m, y, k = hex_to_cmyk_percent(self.color_code)
            self.c_cyan, self.c_magenta, self.c_yellow, self.c_key = c, m, y, k

    @api.constrains('color_code')
    def _check_color_code(self):
        """Validate hex color code format"""
        import re
        for record in self:
            if record.color_code and not re.match(r'^#[0-9A-Fa-f]{6}$', record.color_code):
                raise ValidationError('Color code must be in hex format (e.g., #187983)')

    @api.constrains("c_cyan", "c_magenta", "c_yellow", "c_key")
    def _check_cmyk_ranges(self):
        for record in self:
            for field_name in ("c_cyan", "c_magenta", "c_yellow", "c_key"):
                value = record[field_name]
                if value < 0.0 or value > 100.0:
                    raise ValidationError(
                        _("%(label)s must be between 0 and 100.", label=record._fields[field_name].string)
                    )

    @api.model_create_multi
    def create(self, vals_list):
        from odoo.addons.tus_product_personalizer.utils.color_conversion import (
            cmyk_percent_to_hex,
            hex_to_cmyk_percent,
        )

        prepared = []
        for vals in vals_list:
            vals = dict(vals)
            if vals.get('color_code') and not vals['color_code'].startswith('#'):
                vals['color_code'] = '#' + vals['color_code']
            if vals.get('use_manual_cmyk'):
                vals['color_code'] = cmyk_percent_to_hex(
                    vals.get('c_cyan', 0.0),
                    vals.get('c_magenta', 0.0),
                    vals.get('c_yellow', 0.0),
                    vals.get('c_key', 0.0),
                )
            elif vals.get('color_code'):
                c, m, y, k = hex_to_cmyk_percent(vals['color_code'])
                vals.setdefault('c_cyan', c)
                vals.setdefault('c_magenta', m)
                vals.setdefault('c_yellow', y)
                vals.setdefault('c_key', k)
            prepared.append(vals)
        return super().create(prepared)

    def write(self, vals):
        """Sync hex ↔ CMYK depending on manual mode."""
        if vals.get('color_code') and not vals['color_code'].startswith('#'):
            vals['color_code'] = '#' + vals['color_code']
        result = super().write(vals)
        cmyk_fields = {'c_cyan', 'c_magenta', 'c_yellow', 'c_key', 'use_manual_cmyk'}
        if cmyk_fields & set(vals.keys()):
            self.filtered(lambda p: p.use_manual_cmyk)._sync_hex_from_cmyk()
        if 'color_code' in vals:
            self.filtered(lambda p: not p.use_manual_cmyk)._sync_cmyk_from_hex()
        return result

