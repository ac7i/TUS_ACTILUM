# -*- coding: utf-8 -*-
"""Unused canvas upload cleanup (filestore originals for Download Source)."""

from __future__ import annotations

import json
import logging
import re
from datetime import timedelta

from odoo import api, fields, models

_logger = logging.getLogger(__name__)

_REF_KEY_CANVAS = frozenset({
    "backend_id",
    "backendId",
    "image_id",
    "imageId",
})
_REF_KEY_ATTACHMENT = frozenset({
    "original_attachment_id",
    "originalAttachmentId",
})
_BATCH_LIMIT = 100


def _as_int(value):
    try:
        if value is None or value is False:
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _collect_design_refs(node, canvas_ids, attachment_ids):
    """Walk Fabric/imprint JSON and collect canvas.image / ir.attachment ids."""
    if isinstance(node, dict):
        for key, value in node.items():
            if key in _REF_KEY_CANVAS:
                cid = _as_int(value)
                if cid:
                    canvas_ids.add(cid)
            elif key in _REF_KEY_ATTACHMENT:
                aid = _as_int(value)
                if aid:
                    attachment_ids.add(aid)
            else:
                _collect_design_refs(value, canvas_ids, attachment_ids)
    elif isinstance(node, list):
        for item in node:
            _collect_design_refs(item, canvas_ids, attachment_ids)


class CanvasImage(models.Model):
    _inherit = "canvas.image"

    @api.model
    def _get_upload_cleanup_policy(self):
        """Return (enabled, retention_days) from websites that opted in."""
        websites = self.env["website"].sudo().search([
            ("personalizer_upload_cleanup_enabled", "=", True),
        ])
        if not websites:
            return False, 90
        days = min(
            max(1, int(w.personalizer_upload_retention_days or 90))
            for w in websites
        )
        return True, days

    @api.model
    def _gather_protected_upload_refs(self):
        """Ids that must never be cleaned (orders / saved designs / Download Source)."""
        canvas_ids = set()
        attachment_ids = set()

        Imprint = self.env["orderline.imprint.design"].sudo()
        for attrs in Imprint.search([]).mapped("imprint_design_attribute"):
            if attrs:
                _collect_design_refs(attrs, canvas_ids, attachment_ids)

        Line = self.env["sale.order.line"].sudo()
        bundle_lines = Line.search([
            ("personalizer_design_bundle", "!=", False),
            ("personalizer_design_bundle", "!=", ""),
        ])
        for bundle in bundle_lines.mapped("personalizer_design_bundle"):
            if not bundle:
                continue
            try:
                payload = json.loads(bundle) if isinstance(bundle, str) else bundle
            except (TypeError, ValueError, json.JSONDecodeError):
                # Fallback: regex extract likely ids next to known keys
                for match in re.finditer(
                    r'"(?:backend_id|backendId|image_id|imageId|original_attachment_id|originalAttachmentId)"\s*:\s*(\d+)',
                    bundle,
                ):
                    num = _as_int(match.group(1))
                    if not num:
                        continue
                    key = match.group(0)
                    if "original" in key.lower():
                        attachment_ids.add(num)
                    else:
                        canvas_ids.add(num)
                continue
            _collect_design_refs(payload, canvas_ids, attachment_ids)

        PartnerDesign = self.env["res.partner.design"].sudo()
        for design in PartnerDesign.search([("attachment_id", "!=", False)]):
            if design.attachment_id:
                attachment_ids.add(design.attachment_id.id)

        # Any canvas.image already pointed at by a protected attachment
        if attachment_ids:
            linked = self.sudo().search([
                ("original_attachment_id", "in", list(attachment_ids)),
            ])
            canvas_ids.update(linked.ids)

        return canvas_ids, attachment_ids

    def _is_upload_protected(self, protected_canvas_ids=None, protected_attachment_ids=None):
        self.ensure_one()
        if protected_canvas_ids is None or protected_attachment_ids is None:
            protected_canvas_ids, protected_attachment_ids = self._gather_protected_upload_refs()
        if self.id in protected_canvas_ids:
            return True
        if self.original_attachment_id and self.original_attachment_id.id in protected_attachment_ids:
            return True
        return False

    @api.model
    def cron_cleanup_unused_uploads(self) -> None:
        """Scheduled: remove unused library uploads older than retention days.

        Large originals live on filestore (ir.attachment). This job only deletes
        orphans not linked to any order imprint / design bundle / saved design,
        so admin Download Source on orders remains intact.
        """
        enabled, days = self._get_upload_cleanup_policy()
        if not enabled:
            _logger.info("Personalizer upload cleanup skipped (disabled on all websites).")
            return

        cutoff = fields.Datetime.now() - timedelta(days=days)
        candidates = self.sudo().search(
            [("create_date", "<", cutoff)],
            order="create_date asc",
            limit=_BATCH_LIMIT,
        )
        if not candidates:
            _logger.info(
                "Personalizer upload cleanup: no candidates older than %s days.",
                days,
            )
            return

        protected_canvas_ids, protected_attachment_ids = self._gather_protected_upload_refs()
        to_unlink = candidates.filtered(
            lambda rec: not rec._is_upload_protected(
                protected_canvas_ids, protected_attachment_ids
            )
        )
        _logger.info(
            "Personalizer upload cleanup: cutoff=%s candidates=%s protected_skip=%s unlink=%s",
            cutoff,
            len(candidates),
            len(candidates) - len(to_unlink),
            len(to_unlink),
        )
        self._safe_batch_unlink_unused(to_unlink, protected_attachment_ids)

    @api.model
    def _safe_batch_unlink_unused(self, records, protected_attachment_ids=None):
        protected_attachment_ids = protected_attachment_ids or set()
        deleted = 0
        for record in records:
            try:
                with self.env.cr.savepoint():
                    original = record.original_attachment_id
                    original_id = original.id if original else False
                    record.unlink()
                    if original_id and original_id not in protected_attachment_ids:
                        att = self.env["ir.attachment"].sudo().browse(original_id)
                        if att.exists():
                            # Only remove if nothing else points at it
                            still_linked = self.sudo().search_count([
                                ("original_attachment_id", "=", original_id),
                            ])
                            if not still_linked:
                                att.unlink()
                    deleted += 1
            except Exception:
                _logger.exception(
                    "Personalizer upload cleanup failed for canvas.image id=%s",
                    record.id,
                )
        _logger.info("Personalizer upload cleanup deleted=%s", deleted)
        return deleted
