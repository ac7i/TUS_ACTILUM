from odoo import _, api, fields, models


class SaleOrderLine(models.Model):
    _inherit = "sale.order.line"

    uploaded_design_ids = fields.One2many(
        "orderline.design.upload", "order_line", string="Uploaded Design", copy=True
    )
    is_personalizer_configured = fields.Boolean(
        string="Personalizer Configured",
        compute='_compute_is_personalizer_configured',
    )
    vdp_enabled = fields.Boolean(string="VDP Order", default=False, copy=True)
    vdp_master_design = fields.Text(
        string="VDP Master Design (JSON)",
        copy=True,
        help="Fabric export JSON for the master template (placeholders on variable fields).",
    )
    vdp_field_names = fields.Text(
        string="VDP Field Names (JSON)",
        copy=True,
        help="Ordered list of variable field keys expected in the dataset.",
    )
    vdp_record_ids = fields.One2many(
        "orderline.vdp.record",
        "order_line_id",
        string="VDP Records",
        copy=True,
    )
    vdp_record_count = fields.Integer(
        string="VDP Rows",
        compute="_compute_vdp_record_count",
    )
    empty_canvas_width = fields.Float(string="Canvas Width", copy=True)
    empty_canvas_height = fields.Float(string="Canvas Height", copy=True)
    empty_canvas_unit = fields.Char(string="Canvas Unit", copy=True)
    empty_canvas_sides = fields.Selection(
        [
            ("front", "Front"),
            ("back", "Back"),
            ("both", "Front & Back"),
        ],
        string="Canvas Sides",
        copy=True,
    )
    empty_canvas_preset_id = fields.Many2one(
        "editor.canvas.preset",
        string="Canvas Preset",
        copy=True,
        ondelete="set null",
    )

    @api.depends("vdp_record_ids")
    def _compute_vdp_record_count(self):
        for line in self:
            line.vdp_record_count = len(line.vdp_record_ids)

    @api.depends('product_template_id', 'product_template_id.views', 'product_template_id.empty_canvas')
    def _compute_is_personalizer_configured(self):
        for line in self:
            tmpl = line.product_template_id
            line.is_personalizer_configured = bool(tmpl.views) or bool(tmpl.empty_canvas)

    def view_uploaded_design(self):
        return {
            "name": _("Uploaded Design"),
            "type": "ir.actions.act_window",
            "view_mode": "list, form",
            'views': [(False, 'list'), (False, 'form')],
            "res_model": "orderline.design.upload",
            "domain": [("order_line", "=", self.id)],
            "context": {
                "create": True,
                "default_order_line": self.id,
                "default_order_id": self.order_id.id,
            },
        }

    def view_vdp_records(self):
        self.ensure_one()
        return {
            "name": _("VDP Records"),
            "type": "ir.actions.act_window",
            "view_mode": "list,form",
            "res_model": "orderline.vdp.record",
            "domain": [("order_line_id", "=", self.id)],
            "context": {"default_order_line_id": self.id},
        }

    def create_design(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_url',
            'url': '/backend/designer/%s/%s/%s' % (
                self.product_id.id,
                self.product_id.product_tmpl_id.id,
                self.id
            ),
            'target': 'new',
        }

    def _generate_vdp_print_files(self):
        """Create missing print uploads for VDP rows from stored master + row data."""
        for line in self:
            line._generate_vdp_print_files_single()

    def _generate_vdp_print_files_single(self):
        from odoo.addons.tus_product_personalizer.utils.vdp_merge import (
            design_data_from_json,
            merge_vdp_row_into_design,
        )

        self.ensure_one()
        pending = self.vdp_record_ids.filtered(
            lambda r: r.state != "generated" and not r.design_upload_id
        )
        if not pending or not self.vdp_master_design:
            return

        master = design_data_from_json(self.vdp_master_design)
        if not master:
            return

        for record in pending:
            row = record._get_row_dict()
            merged = merge_vdp_row_into_design(master, row)
            uploads_before = set(self.uploaded_design_ids.ids)
            self._create_personalizer_design_exports(merged)
            new_uploads = self.uploaded_design_ids.filtered(
                lambda u: u.id not in uploads_before
            )
            if new_uploads:
                record.write({
                    "design_upload_id": new_uploads[0].id,
                    "state": "generated",
                })
            else:
                record.state = "error"

    def _create_personalizer_design_exports(self, design_data):
        """Create orderline.design.upload rows from designer export payload."""
        self.ensure_one()
        from odoo.addons.tus_product_personalizer.controllers.main import ProductDesigner

        ProductDesigner()._create_line_designs(self, design_data or [])

