# -*- coding: utf-8 -*-
import base64

from odoo import fields, models, _
from odoo.exceptions import UserError


class DesignTemplateImportWizard(models.TransientModel):
    _name = "design.template.import.wizard"
    _description = "Import Product Design Template"

    product_tmpl_id = fields.Many2one(
        "product.template",
        string="Product",
        required=True,
    )
    name = fields.Char(required=True)
    design_format = fields.Selection(
        [
            ("fabric_json", "Fabric JSON Bundle"),
            ("svg", "SVG"),
        ],
        required=True,
        default="svg",
    )
    preview_image = fields.Binary(string="Preview Thumbnail", required=True)
    design_data = fields.Binary(string="Design File", required=True)
    design_data_filename = fields.Char(string="Filename")
    is_default = fields.Boolean(string="Default Template")

    def action_import(self):
        self.ensure_one()
        if not self.design_data:
            raise UserError(_("Please upload a design file."))
        filename = (self.design_data_filename or "").lower()
        design_format = self.design_format
        if not filename and design_format == "svg":
            raise UserError(_("Please use an .svg file for SVG templates."))
        if filename.endswith(".json") or filename.endswith(".txt"):
            design_format = "fabric_json"
        elif filename.endswith(".svg"):
            design_format = "svg"

        self.env["product.design.template"].create({
            "name": self.name,
            "product_tmpl_id": self.product_tmpl_id.id,
            "preview_image": self.preview_image,
            "design_format": design_format,
            "design_data": self.design_data,
            "design_data_filename": self.design_data_filename,
            "is_default": self.is_default,
        })
        return {"type": "ir.actions.act_window_close"}
