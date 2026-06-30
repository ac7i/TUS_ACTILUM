# -*- coding: utf-8 -*-
from odoo import api, fields, models, _
from odoo.exceptions import ValidationError

CANVAS_UNIT_SELECTION = [
    ("in", "Inches"),
    ("mm", "Millimeters"),
    ("cm", "Centimeters"),
]


class EditorCanvasPreset(models.Model):
    _name = "editor.canvas.preset"
    _description = "Empty Canvas Size Preset"
    _order = "sequence, id"

    name = fields.Char(required=True, translate=True)
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)
    width = fields.Float(string="Width", required=True)
    height = fields.Float(string="Height", required=True)
    unit = fields.Selection(
        CANVAS_UNIT_SELECTION,
        string="Unit",
        default="in",
        required=True,
    )

    @api.constrains("width", "height")
    def _check_dimensions(self):
        for preset in self:
            if preset.width <= 0 or preset.height <= 0:
                raise ValidationError(_("Canvas width and height must be greater than zero."))

    def get_display_label(self):
        self.ensure_one()
        unit = dict(CANVAS_UNIT_SELECTION).get(self.unit, self.unit)
        return f"{self.name} ({self.width:g} × {self.height:g} {unit})"
