# -*- coding: utf-8 -*-
import uuid

from odoo import api, fields, models, _
from odoo.exceptions import ValidationError


class ProductPersonalizerHelp(models.Model):
    _name = "product.personalizer.help"
    _description = "Designer Help Content"
    _order = "sequence, id"

    name = fields.Char(string="Title", required=True, translate=True)
    body = fields.Html(
        string="Help Content",
        sanitize=True,
        translate=True,
        help="Rich help content shown in the designer help dialog (text, images, links).",
    )
    video_url = fields.Char(
        string="Video Embed URL",
        help="Optional YouTube or Vimeo embed/watch URL displayed above the help content.",
    )
    active = fields.Boolean(
        default=False,
        help="Only one help record can be active at a time. The active record is shown in the designer.",
    )
    sequence = fields.Integer(default=10)
    share_token = fields.Char(
        required=True,
        index=True,
        copy=False,
        default=lambda self: str(uuid.uuid4()),
    )
    share_url = fields.Char(
        string="Shareable Link",
        compute="_compute_share_url",
    )
    video_embed_url = fields.Char(
        string="Video Preview URL",
        compute="_compute_video_embed_url",
        help="Normalized embed URL used on the public help page and in the designer.",
    )

    _sql_constraints = [
        (
            "share_token_unique",
            "unique(share_token)",
            "Each help record must have a unique share token.",
        ),
    ]

    @api.depends("share_token")
    def _compute_share_url(self):
        base_url = self.env["ir.config_parameter"].sudo().get_param("web.base.url", "")
        for record in self:
            if record.share_token:
                record.share_url = f"{base_url.rstrip('/')}/personalizer/help/{record.share_token}"
            else:
                record.share_url = False

    @api.depends("video_url")
    def _compute_video_embed_url(self):
        for record in self:
            record.video_embed_url = record._normalize_video_embed_url(record.video_url)

    @staticmethod
    def _normalize_video_embed_url(url):
        url = (url or "").strip()
        if not url:
            return ""
        if "/embed/" in url or "player.vimeo.com" in url:
            return url
        if "youtu.be/" in url:
            video_id = url.rsplit("/", 1)[-1].split("?")[0].split("&")[0]
            return f"https://www.youtube.com/embed/{video_id}" if video_id else url
        if "youtube.com/watch" in url:
            from urllib.parse import parse_qs, urlparse
            video_id = (parse_qs(urlparse(url).query).get("v") or [""])[0]
            return f"https://www.youtube.com/embed/{video_id}" if video_id else url
        if "vimeo.com/" in url:
            video_id = url.rstrip("/").rsplit("/", 1)[-1].split("?")[0]
            return f"https://player.vimeo.com/video/{video_id}" if video_id.isdigit() else url
        return url

    @api.constrains("active")
    def _check_single_active(self):
        if self.search_count([("active", "=", True)]) > 1:
            raise ValidationError(_("Only one designer help record can be active at a time."))

    def _deactivate_other_active_records(self):
        """Keep only records in ``self`` active; deactivate every other active row."""
        others = self.search([("active", "=", True), ("id", "not in", self.ids)])
        if others:
            others.write({"active": False})

    def _ensure_single_active_globally(self):
        active = self.search([("active", "=", True)], order="sequence, id")
        if len(active) > 1:
            active[1:].write({"active": False})

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        if any(vals.get("active") for vals in vals_list):
            keepers = records.filtered("active").sorted(key=lambda r: (r.sequence, r.id))
            if keepers:
                keepers[:1]._deactivate_other_active_records()
            records._ensure_single_active_globally()
        return records

    def write(self, vals):
        res = super().write(vals)
        if vals.get("active"):
            self.filtered("active")._deactivate_other_active_records()
            self._ensure_single_active_globally()
        return res

    @api.model
    def get_active_for_designer(self):
        """Return the single active help entry for the storefront designer."""
        record = self.sudo().search([("active", "=", True)], limit=1, order="sequence, id")
        if not record:
            return {}
        return {
            "id": record.id,
            "name": record.name or "",
            "body": str(record.body or ""),
            "video_url": record.video_url or "",
            "share_url": record.share_url or "",
        }
