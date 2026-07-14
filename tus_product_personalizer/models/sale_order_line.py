from odoo import _, api, fields, models
import json


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
    empty_canvas_finish = fields.Char(string="Canvas Finish", copy=True)
    empty_canvas_print_quality = fields.Char(string="Print Quality", copy=True)
    empty_canvas_print_mode = fields.Char(string="Print Mode", copy=True)
    empty_canvas_machining_codes = fields.Char(
        string="Machining Options",
        copy=True,
        help="Comma-separated machining option codes selected on the product page.",
    )
    empty_canvas_machining_folding = fields.Boolean(
        string="Machining: Folding",
        default=False,
        copy=True,
    )
    empty_canvas_machining_cutting = fields.Boolean(
        string="Machining: Cutting",
        default=False,
        copy=True,
    )
    empty_canvas_machining_corner_drilling = fields.Boolean(
        string="Machining: Corner Drilling",
        default=False,
        copy=True,
    )
    empty_canvas_size_label = fields.Char(
        string="Canvas Size",
        compute="_compute_empty_canvas_display_fields",
    )
    empty_canvas_finish_label = fields.Char(
        string="Finish Label",
        compute="_compute_empty_canvas_display_fields",
    )
    empty_canvas_print_quality_label = fields.Char(
        string="Print Quality Label",
        compute="_compute_empty_canvas_display_fields",
    )
    empty_canvas_print_mode_label = fields.Char(
        string="Print Mode Label",
        compute="_compute_empty_canvas_display_fields",
    )
    empty_canvas_machining_summary = fields.Char(
        string="Basic Machining",
        compute="_compute_empty_canvas_display_fields",
    )
    texture_by_side_json = fields.Text(
        string="Texture Selection (JSON)",
        copy=True,
        help="Per-side texture metadata selected in the designer.",
    )

    @api.depends(
        "empty_canvas_width",
        "empty_canvas_height",
        "empty_canvas_unit",
        "empty_canvas_sides",
        "empty_canvas_finish",
        "empty_canvas_print_quality",
        "empty_canvas_print_mode",
        "empty_canvas_machining_codes",
        "empty_canvas_machining_folding",
        "empty_canvas_machining_cutting",
        "empty_canvas_machining_corner_drilling",
    )
    def _compute_empty_canvas_display_fields(self):
        Option = self.env["editor.canvas.product.option"].sudo()
        sides_labels = dict(self._fields["empty_canvas_sides"].selection)
        for line in self:
            if line.empty_canvas_width and line.empty_canvas_height:
                side_label = sides_labels.get(line.empty_canvas_sides, line.empty_canvas_sides or "")
                line.empty_canvas_size_label = _(
                    "%(width)s × %(height)s %(unit)s (%(side)s)",
                    width=line.empty_canvas_width,
                    height=line.empty_canvas_height,
                    unit=line.empty_canvas_unit or "in",
                    side=side_label,
                )
            else:
                line.empty_canvas_size_label = False

            finish_map = Option.get_label_map("finish", [line.empty_canvas_finish])
            quality_map = Option.get_label_map("print_quality", [line.empty_canvas_print_quality])
            mode_map = Option.get_label_map("print_mode", [line.empty_canvas_print_mode])
            line.empty_canvas_finish_label = (
                finish_map.get(line.empty_canvas_finish)
                or line.empty_canvas_finish
                or False
            )
            line.empty_canvas_print_quality_label = (
                quality_map.get(line.empty_canvas_print_quality)
                or line.empty_canvas_print_quality
                or False
            )
            line.empty_canvas_print_mode_label = (
                mode_map.get(line.empty_canvas_print_mode)
                or line.empty_canvas_print_mode
                or False
            )

            machining_codes = [
                code.strip()
                for code in (line.empty_canvas_machining_codes or "").split(",")
                if code.strip()
            ]
            if not machining_codes:
                legacy_codes = []
                if line.empty_canvas_machining_folding:
                    legacy_codes.append("folding")
                if line.empty_canvas_machining_cutting:
                    legacy_codes.append("cutting")
                if line.empty_canvas_machining_corner_drilling:
                    legacy_codes.append("corner_drilling")
                machining_codes = legacy_codes
            machining_map = Option.get_label_map("machining", machining_codes)
            line.empty_canvas_machining_summary = ", ".join(
                machining_map.get(code, code) for code in machining_codes
            ) if machining_codes else False

    @api.depends("vdp_record_ids")
    def _compute_vdp_record_count(self):
        for line in self:
            line.vdp_record_count = len(line.vdp_record_ids)

    @api.depends('product_template_id', 'product_template_id.views', 'product_template_id.empty_canvas')
    def _compute_is_personalizer_configured(self):
        for line in self:
            tmpl = line.product_template_id
            line.is_personalizer_configured = bool(tmpl.views) or bool(tmpl.empty_canvas)

    def _is_personalizer_line(self):
        self.ensure_one()
        return bool(self.uploaded_design_ids or self.empty_canvas_width)

    def _get_production_sheet_line_data(self):
        self.ensure_one()
        side_order = {"front": 0, "back": 1, "left": 2, "right": 3}
        sides = [
            design._get_production_sheet_side_data()
            for design in self.uploaded_design_ids.sorted(
                key=lambda d: side_order.get(d.uploaded_type or "", 99)
            )
        ]

        vdp_data = None
        if self.vdp_enabled and self.vdp_record_ids:
            field_names = []
            if self.vdp_field_names:
                try:
                    parsed = json.loads(self.vdp_field_names)
                    if isinstance(parsed, list):
                        field_names = parsed
                except (TypeError, ValueError):
                    field_names = []
            rows = []
            for record in self.vdp_record_ids.sorted(key=lambda r: (r.sequence, r.id)):
                row_dict = record._get_row_dict()
                rows.append({
                    "name": record.name,
                    "state": record.state,
                    "values": row_dict,
                    "columns": [
                        row_dict.get(field_name, "")
                        for field_name in field_names
                    ] if field_names else [],
                    "values_display": ", ".join(
                        f"{key}: {value}"
                        for key, value in row_dict.items()
                        if value not in (None, "")
                    ),
                })
            vdp_data = {
                "field_names": field_names,
                "rows": rows,
                "count": len(rows),
            }

        variant_attrs = ", ".join(
            ptav.display_name
            for ptav in self.product_id.product_template_attribute_value_ids
        )
        return {
            "line_id": self.id,
            "product_name": self.product_id.display_name,
            "product_code": self.product_id.default_code or "",
            "quantity": self.product_uom_qty,
            "uom": self.product_uom_id.name,
            "printing_method": self.printing_method_id.name
            if self.printing_method_id
            else "",
            "canvas_size": self.empty_canvas_size_label or "",
            "canvas_finish": self.empty_canvas_finish_label or "",
            "print_quality": self.empty_canvas_print_quality_label or "",
            "print_mode": self.empty_canvas_print_mode_label or "",
            "machining": self.empty_canvas_machining_summary or "",
            "variant_attributes": variant_attrs,
            "sides": sides,
            "vdp": vdp_data,
        }

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
