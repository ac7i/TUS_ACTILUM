# -*- coding: utf-8 -*-
import base64
import uuid

from odoo import fields, models


class ProductDesignShare(models.Model):
    _name = "product.design.share"
    _description = "Shared Product Design Link"
    _order = "create_date desc"

    access_token = fields.Char(
        required=True,
        index=True,
        copy=False,
        default=lambda self: str(uuid.uuid4()),
    )
    share_mode = fields.Selection(
        [("edit", "Can customize"), ("view", "Can view only")],
        string="Access Mode",
        default="edit",
        required=True,
    )
    product_id = fields.Many2one(
        "product.product",
        string="Product",
        required=True,
        ondelete="cascade",
    )
    product_tmpl_id = fields.Many2one(
        related="product_id.product_tmpl_id",
        store=True,
        index=True,
    )
    design_bundle = fields.Binary(string="Design Bundle", attachment=True)
    preview_image = fields.Binary(string="Preview Image", attachment=True)
    color_attribute_value_id = fields.Many2one(
        "product.template.attribute.value",
        string="Color",
        ondelete="set null",
    )
    partner_id = fields.Many2one("res.partner", string="Shared By")
    active = fields.Boolean(default=True)
    restriction_type = fields.Selection(
        [("anyone", "Anyone with the link"), ("restricted", "Only people added")],
        string="Restriction Type",
        default="anyone",
        required=True,
    )
    access_ids = fields.One2many(
        "product.design.share.access",
        "share_id",
        string="Access List",
    )
    bundle_version = fields.Integer(
        string="Bundle Version",
        default=1,
        readonly=True,
    )
    last_saved_by = fields.Char(string="Last Saved By", readonly=True)
    last_saved_at = fields.Datetime(string="Last Saved At", readonly=True)

    def get_design_text(self):
        """Return raw design bundle JSON as text for the storefront editor."""
        self.ensure_one()
        if not self.design_bundle:
            return ""
        raw = base64.b64decode(self.design_bundle)
        return raw.decode("utf-8", errors="replace")

    def write_design_snapshot(self, design_bundle_b64, preview_image_b64=None, saved_by=None):
        """Persist canvas snapshot and bump version (last save wins)."""
        self.ensure_one()
        vals = {
            "design_bundle": design_bundle_b64,
            "bundle_version": (self.bundle_version or 0) + 1,
            "last_saved_at": fields.Datetime.now(),
            "last_saved_by": saved_by or "",
        }
        if preview_image_b64:
            vals["preview_image"] = preview_image_b64
        self.write(vals)
        return vals["bundle_version"]


class ProductDesignShareAccess(models.Model):
    _name = "product.design.share.access"
    _description = "Shared Design Partner Access"
    _order = "create_date desc"

    share_id = fields.Many2one(
        "product.design.share",
        string="Shared Design",
        required=True,
        ondelete="cascade",
    )
    email = fields.Char(string="Email Address", required=True, index=True)
    access_mode = fields.Selection(
        [("edit", "Can customize"), ("view", "Can view only")],
        string="Access Mode",
        default="edit",
        required=True,
    )
    url = fields.Char(
        string="URL",
    )

    def get_guest_link(self):
        """Stable guest URL; permission is resolved from DB via acc id."""
        self.ensure_one()
        base_url = (
            self.env["ir.config_parameter"].sudo().get_param("web.base.url") or ""
        ).rstrip("/")
        return "%s/product/designer/share/%s?acc=%s" % (
            base_url,
            self.share_id.access_token,
            self.id,
        )

    def action_send_invitation(self):
        """Send invitation email containing the private guest link."""
        self.ensure_one()
        if not self.url:
            return

        template = self.env.ref(
            "tus_product_personalizer.email_template_design_share_invite",
            raise_if_not_found=False,
        )
        if template:
            ctx = dict(self.env.context or {})
            ctx.update({
                "guest_link": self.url,
            })
            template.with_context(ctx).send_mail(self.id, force_send=True)
        else:
            mail_values = {
                "subject": "Shared Design Invitation: %s" % (self.share_id.product_id.name or "Product Design"),
                "email_to": self.email,
                "email_from": self.share_id.partner_id.email or self.env.user.email or "no-reply@localhost",
                "body_html": """
                    <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 8px; max-width: 600px; margin: auto;">
                        <h2 style="color: #0f172a; margin-top: 0;">You've been invited!</h2>
                        <p style="color: #475569; font-size: 14px; line-height: 1.5;">
                            You have been invited to view or customize a product design shared by
                            <strong>%s</strong>.
                        </p>
                        <p style="color: #475569; font-size: 14px; line-height: 1.5;">
                            Permission Level: <strong>%s</strong>
                        </p>
                        <div style="margin: 30px 0; text-align: center;">
                            <a href="%s" style="background-color: #4d5038; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 14px; display: inline-block;">
                                Open Shared Design
                            </a>
                        </div>
                        <p style="color: #64748b; font-size: 12px;">
                            If the button doesn't work, you can copy and paste the following link into your browser:<br/>
                            <a href="%s" style="color: #4d5038;">%s</a>
                        </p>
                        <p style="color: #64748b; font-size: 12px; margin-top: 16px;">
                            If the owner updates your permission later, use this same link and refresh the page.
                        </p>
                    </div>
                """ % (
                    self.share_id.partner_id.name or "a designer",
                    "Can customize" if self.access_mode == "edit" else "Can view only",
                    self.url,
                    self.url,
                    self.url,
                ),
            }
            mail = self.env["mail.mail"].sudo().create(mail_values)
            mail.send()

    _share_email_uniq = models.Constraint(
        "UNIQUE(share_id, email)",
        "This email already has access to this design.",
    )
