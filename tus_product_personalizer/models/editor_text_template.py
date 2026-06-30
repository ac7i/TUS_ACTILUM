# -*- coding: utf-8 -*-
import base64

from odoo import api, fields, models, _
from odoo.exceptions import ValidationError


class EditorTextTemplateGroup:
    """Lightweight container passed to QWeb for category-grouped templates."""

    __slots__ = ("key", "label", "templates")

    def __init__(self, key, label, templates):
        self.key = key
        self.label = label
        self.templates = templates


TEXT_TEMPLATE_CATEGORIES = [
    ("headlines", "Headlines"),
    ("quotes", "Quotes"),
    ("sports", "Sports"),
    ("events", "Events"),
    ("business", "Business"),
    ("script", "Script"),
]


class EditorTextTemplate(models.Model):
    _name = "editor.text.template"
    _description = "Editor Text Template"
    _order = "sequence, id"

    name = fields.Char(required=True, translate=True)
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)
    category = fields.Selection(
        TEXT_TEMPLATE_CATEGORIES,
        string="Category",
        default="quotes",
        required=True,
    )
    preview_image = fields.Binary(string="Preview", attachment=True)
    design_data = fields.Binary(
        string="SVG File",
        attachment=True,
        required=True,
        help="SVG with <text> elements; each text layer becomes editable on the canvas.",
    )
    design_data_filename = fields.Char(string="SVG Filename")

    @api.constrains("design_data", "design_data_filename")
    def _check_design_data(self):
        for template in self:
            if not template.design_data:
                raise ValidationError(_("Please upload an SVG file for the text template."))
            filename = (template.design_data_filename or "").lower()
            if filename and not filename.endswith(".svg"):
                raise ValidationError(_("Text templates must use an .svg file."))

    def get_design_text(self):
        """Return raw SVG payload as text for the storefront editor."""
        self.ensure_one()
        if not self.design_data:
            return ""
        raw = base64.b64decode(self.design_data)
        return raw.decode("utf-8", errors="replace")

    @api.model
    def get_grouped_for_designer(self):
        """Return active templates grouped by category for the designer sidebar."""
        templates = self.search([("active", "=", True)], order="sequence, id")
        category_labels = dict(TEXT_TEMPLATE_CATEGORIES)
        groups = []
        for key, label in TEXT_TEMPLATE_CATEGORIES:
            category_templates = templates.filtered(lambda t, k=key: t.category == k)
            if category_templates:
                groups.append(EditorTextTemplateGroup(
                    key=key,
                    label=category_labels.get(key, label),
                    templates=category_templates,
                ))
        return groups
