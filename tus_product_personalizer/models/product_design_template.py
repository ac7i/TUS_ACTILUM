# -*- coding: utf-8 -*-
import base64
import json

from odoo import api, fields, models, _
from odoo.exceptions import ValidationError


class ProductDesignTemplate(models.Model):
    _name = "product.design.template"
    _description = "Product Design Template"
    _order = "sequence, id"

    name = fields.Char(required=True, translate=True)
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)
    product_tmpl_id = fields.Many2one(
        "product.template",
        string="Product",
        required=True,
        ondelete="cascade",
        index=True,
    )
    preview_image = fields.Binary(string="Preview", attachment=True)
    design_format = fields.Selection(
        [
            ("fabric_json", "Fabric JSON Bundle"),
            ("svg", "SVG"),
        ],
        string="Format",
        required=True,
        default="svg",
    )
    design_data = fields.Binary(
        string="Design File",
        attachment=True,
        help="Fabric JSON design bundle or SVG source file.",
    )
    design_data_filename = fields.Char(string="Design Filename")
    layer_metadata = fields.Json(
        string="Layer Metadata",
        help="Optional layer definitions for the storefront editor.",
    )
    is_default = fields.Boolean(
        string="Default Template",
        help="Auto-apply when the designer opens (if no user design exists).",
    )

    @api.constrains("design_data")
    def _check_design_data(self):
        for template in self:
            if not template.design_data:
                raise ValidationError(_("Please upload a design file for the template."))

    @api.constrains("is_default", "product_tmpl_id")
    def _check_single_default(self):
        for template in self:
            if not template.is_default:
                continue
            others = self.search([
                ("id", "!=", template.id),
                ("product_tmpl_id", "=", template.product_tmpl_id.id),
                ("is_default", "=", True),
            ])
            if others:
                raise ValidationError(
                    _("Only one default template is allowed per product.")
                )

    def get_design_text(self):
        """Return raw design payload as text for the storefront editor."""
        self.ensure_one()
        if not self.design_data:
            return ""
        raw = base64.b64decode(self.design_data)
        return raw.decode("utf-8", errors="replace")

    def get_bundle_dict(self):
        self.ensure_one()
        if self.design_format != "fabric_json":
            return None
        text = self.get_design_text()
        if not text:
            return None
        try:
            return json.loads(text)
        except (TypeError, ValueError):
            return None
