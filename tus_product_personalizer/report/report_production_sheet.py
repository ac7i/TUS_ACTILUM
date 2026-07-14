from odoo import api, fields, models
from odoo.tools import format_datetime


class ReportProductionSheet(models.AbstractModel):
    _name = "report.tus_product_personalizer.report_production_sheet"
    _description = "Production Sheet Report"

    @api.model
    def _get_report_values(self, docids, data=None):
        docs = self.env["sale.order"].browse(docids)
        generation_date = fields.Datetime.now()
        return {
            "doc_ids": docids,
            "doc_model": "sale.order",
            "docs": docs,
            "sheet_lines": {
                order.id: order._get_production_sheet_lines_data()
                for order in docs
            },
            "generation_date_display": format_datetime(self.env, generation_date),
        }
