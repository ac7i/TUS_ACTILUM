import base64
import logging

from odoo import _, api, fields, models

_logger = logging.getLogger(__name__)


class SaleOrder(models.Model):
    _inherit = "sale.order"

    is_personalizer_order = fields.Boolean(
        string="Has Personalization",
        compute="_compute_is_personalizer_order",
    )

    @api.depends(
        "order_line.uploaded_design_ids",
        "order_line.empty_canvas_width",
    )
    def _compute_is_personalizer_order(self):
        for order in self:
            order.is_personalizer_order = bool(order._get_personalized_lines())

    def _get_personalized_lines(self):
        self.ensure_one()
        return self.order_line.filtered(lambda line: line._is_personalizer_line())

    def _get_production_sheet_lines_data(self):
        self.ensure_one()
        return [
            line._get_production_sheet_line_data()
            for line in self._get_personalized_lines()
        ]

    def _production_sheet_attachment_name(self):
        self.ensure_one()
        safe_name = (self.name or str(self.id)).replace("/", "-")
        return f"Production_Sheet_{safe_name}.pdf"

    def _generate_production_sheet(self):
        self.ensure_one()
        if not self._get_personalized_lines():
            return False

        try:
            for line in self._get_personalized_lines():
                for design in line.uploaded_design_ids:
                    design._ensure_print_files()

            report = self.env.ref(
                "tus_product_personalizer.action_report_production_sheet"
            )
            pdf_content, _report_format = report._render_qweb_pdf(
                report.report_name, res_ids=self.ids
            )

            attachment_name = self._production_sheet_attachment_name()
            attachment_vals = {
                "name": attachment_name,
                "type": "binary",
                "datas": base64.b64encode(pdf_content),
                "res_model": "sale.order",
                "res_id": self.id,
                "mimetype": "application/pdf",
            }
            existing = self.env["ir.attachment"].search([
                ("res_model", "=", "sale.order"),
                ("res_id", "=", self.id),
                ("name", "=", attachment_name),
            ], limit=1)
            if existing:
                existing.write(attachment_vals)
                attachment = existing
            else:
                attachment = self.env["ir.attachment"].create(attachment_vals)

            self.message_post(
                body=_("Production sheet generated."),
                attachment_ids=[attachment.id],
                subtype_xmlid="mail.mt_note",
            )
            return attachment
        except Exception:
            _logger.exception(
                "Failed to generate production sheet for sale order %s",
                self.name,
            )
            return False

    def action_print_production_sheet(self):
        self.ensure_one()
        return self.env.ref(
            "tus_product_personalizer.action_report_production_sheet"
        ).report_action(self)

    def action_regenerate_production_sheet(self):
        self.ensure_one()
        self._generate_production_sheet()
        return {
            "type": "ir.actions.client",
            "tag": "display_notification",
            "params": {
                "title": _("Production Sheet"),
                "message": _("Production sheet has been regenerated."),
                "type": "success",
                "sticky": False,
            },
        }

    def action_confirm(self):
        res = super().action_confirm()
        for order in self:
            order.order_line._generate_vdp_print_files()
            order._generate_production_sheet()
        return res
