import json
import logging

from odoo import api, fields, models

_logger = logging.getLogger(__name__)


class OrderlineVdpRecord(models.Model):
    _name = "orderline.vdp.record"
    _description = "Order Line VDP Record"
    _order = "sequence, id"

    sequence = fields.Integer(default=10)
    order_line_id = fields.Many2one(
        "sale.order.line",
        string="Sale Order Line",
        required=True,
        ondelete="cascade",
        index=True,
    )
    order_id = fields.Many2one(
        related="order_line_id.order_id",
        store=True,
        readonly=True,
    )
    name = fields.Char(string="Label", compute="_compute_name", store=True)
    row_data = fields.Text(
        string="Row Data (JSON)",
        help="Key/value pairs for this VDP row.",
    )
    design_upload_id = fields.Many2one(
        "orderline.design.upload",
        string="Generated Design",
        ondelete="set null",
    )
    state = fields.Selection(
        selection=[
            ("pending", "Pending"),
            ("generated", "Generated"),
            ("error", "Error"),
        ],
        string="Status",
        default="pending",
    )

    def _get_row_dict(self):
        self.ensure_one()
        if not self.row_data:
            return {}
        try:
            data = json.loads(self.row_data)
            return data if isinstance(data, dict) else {}
        except (TypeError, ValueError):
            return {}

    @api.depends("row_data", "sequence")
    def _compute_name(self):
        for rec in self:
            row = rec._get_row_dict()
            if not row:
                rec.name = f"VDP #{rec.sequence}"
                continue
            parts = [str(v) for v in row.values() if v][:2]
            rec.name = " / ".join(parts) if parts else f"VDP #{rec.sequence}"
