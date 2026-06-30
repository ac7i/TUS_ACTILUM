# -*- coding: utf-8 -*-
import base64

from odoo import fields, models, _
from odoo.exceptions import UserError

from ..utils.template_xlsx_import import (
    build_zip_file_index,
    generate_sample_xlsx_bytes,
    infer_design_format,
    parse_design_template_xlsx,
    read_zip_member,
)


class DesignTemplateSheetImportWizard(models.TransientModel):
    _name = "design.template.sheet.import.wizard"
    _description = "Import Design Templates from Excel"

    product_tmpl_id = fields.Many2one(
        "product.template",
        string="Product",
        required=True,
    )
    xlsx_file = fields.Binary(string="Excel Sheet (.xlsx)", required=True)
    xlsx_filename = fields.Char(string="Sheet Filename")
    assets_zip = fields.Binary(
        string="Assets ZIP (optional)",
        help="ZIP archive containing SVG/JSON design files and preview images "
        "referenced in the Excel sheet (e.g. designs/classic-blue.svg).",
    )
    assets_zip_filename = fields.Char(string="ZIP Filename")
    import_log = fields.Text(string="Import Log", readonly=True)

    def action_download_sample(self):
        self.ensure_one()
        try:
            content = generate_sample_xlsx_bytes()
        except ImportError as exc:
            raise UserError(
                _("The Python package openpyxl is required for Excel import. "
                  "Install it on the Odoo server: pip install openpyxl")
            ) from exc
        attachment = self.env["ir.attachment"].create({
            "name": "design_template_import_sample.xlsx",
            "type": "binary",
            "datas": base64.b64encode(content),
            "mimetype": (
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            ),
        })
        return {
            "type": "ir.actions.act_url",
            "url": f"/web/content/{attachment.id}?download=true",
            "target": "self",
        }

    def action_import(self):
        self.ensure_one()
        if not self.xlsx_file:
            raise UserError(_("Please upload an Excel (.xlsx) file."))
        try:
            rows = parse_design_template_xlsx(base64.b64decode(self.xlsx_file))
        except ImportError as exc:
            raise UserError(
                _("The Python package openpyxl is required for Excel import. "
                  "Install it on the Odoo server: pip install openpyxl")
            ) from exc
        except ValueError as exc:
            raise UserError(str(exc)) from exc
        except Exception as exc:
            raise UserError(_("Could not read the Excel file: %s") % exc) from exc

        if not rows:
            raise UserError(_("The Excel sheet has no template rows to import."))

        zip_index = {}
        if self.assets_zip:
            try:
                zip_index = build_zip_file_index(base64.b64decode(self.assets_zip))
            except Exception as exc:
                raise UserError(_("Invalid assets ZIP file: %s") % exc) from exc

        Template = self.env["product.design.template"]
        logs = []
        created = Template.browse()
        row_num = 1
        for row in rows:
            row_num += 1
            name = (row.get("name") or "").strip()
            design_path = (row.get("design_file") or "").strip()
            if not name:
                logs.append(_("Row %s: skipped — missing name.") % row_num)
                continue
            if not design_path:
                logs.append(_("Row %s (%s): skipped — missing design_file.") % (row_num, name))
                continue

            design_bytes = read_zip_member(zip_index, design_path)
            if not design_bytes:
                logs.append(
                    _("Row %s (%s): design file not found in ZIP: %s")
                    % (row_num, name, design_path)
                )
                continue

            preview_bytes = None
            preview_path = (row.get("preview_file") or "").strip()
            if preview_path:
                preview_bytes = read_zip_member(zip_index, preview_path)
                if not preview_bytes:
                    logs.append(
                        _("Row %s (%s): preview not found (%s), continuing without preview.")
                        % (row_num, name, preview_path)
                    )

            design_filename = design_path.replace("\\", "/").split("/")[-1]
            design_format = infer_design_format(design_filename, row.get("design_format"))

            if row.get("is_default"):
                Template.search([
                    ("product_tmpl_id", "=", self.product_tmpl_id.id),
                    ("is_default", "=", True),
                ]).write({"is_default": False})

            vals = {
                "name": name,
                "product_tmpl_id": self.product_tmpl_id.id,
                "sequence": row.get("sequence") or 10,
                "design_format": design_format,
                "design_data": base64.b64encode(design_bytes),
                "design_data_filename": design_filename,
                "is_default": bool(row.get("is_default")),
                "active": bool(row.get("active", True)),
            }
            if preview_bytes:
                vals["preview_image"] = base64.b64encode(preview_bytes)

            created |= Template.create(vals)
            logs.append(_("Row %s: created template '%s'.") % (row_num, name))

        if not created:
            self.import_log = "\n".join(logs)
            raise UserError(
                _("No templates were created.\n\n%s") % self.import_log
            )

        self.import_log = "\n".join(logs)
        return {
            "type": "ir.actions.client",
            "tag": "display_notification",
            "params": {
                "title": _("Import complete"),
                "message": _("%s template(s) imported.") % len(created),
                "type": "success",
                "sticky": False,
                "next": {"type": "ir.actions.act_window_close"},
            },
        }
