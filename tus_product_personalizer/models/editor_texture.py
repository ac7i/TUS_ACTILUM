# -*- coding: utf-8 -*-
from odoo import api, fields, models, _
from odoo.exceptions import ValidationError

_UNIT_TO_MM = {
    "in": 25.4, "inch": 25.4, "mm": 1.0, "millimeter": 1.0,
    "cm": 10.0, "centimeter": 10.0, "ft": 304.8,
}
ALLOWED_TEXTURE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp")


def printed_area_m2(width, height, unit, margin_mm=0.0):
    """Printable area in m² after uniform margins."""
    factor = _UNIT_TO_MM.get((unit or "in").lower(), 25.4)
    w_mm = max(0.0, float(width or 0) * factor - 2.0 * float(margin_mm or 0))
    h_mm = max(0.0, float(height or 0) * factor - 2.0 * float(margin_mm or 0))
    return (w_mm / 1000.0) * (h_mm / 1000.0)


class EditorTextureGroup:
    __slots__ = ("key", "label", "textures")

    def __init__(self, key, label, textures):
        self.key = key
        self.label = label
        self.textures = textures


TEXTURE_CATEGORIES = [
    ("wood", "Wood"),
    ("stone", "Stone"),
    ("fabric", "Fabric"),
    ("metal", "Metal"),
    ("other", "Other"),
]


class EditorTexture(models.Model):
    _name = "editor.texture"
    _description = "Editor Texture"
    _order = "sequence, id"

    name = fields.Char(required=True, translate=True)
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)
    category = fields.Selection(TEXTURE_CATEGORIES, default="other", required=True)
    preview_image = fields.Binary(string="Preview", attachment=True)
    texture_file = fields.Binary(string="Texture Image", attachment=True)
    texture_file_filename = fields.Char(string="Texture Filename")
    price_per_sqm = fields.Float(string="Price per m²", digits="Product Price", default=0.0)

    def compute_price_for_area(self, width, height, unit="in", margin_mm=0.0):
        area_m2 = printed_area_m2(width, height, unit, margin_mm)
        return (self.price_per_sqm or 0.0) * area_m2, area_m2

    @api.model
    def _prepare_texture_vals(self, vals):
        texture_data, preview_data = vals.get("texture_file"), vals.get("preview_image")
        if texture_data and not preview_data:
            vals["preview_image"] = texture_data
        elif preview_data and not texture_data:
            vals["texture_file"] = preview_data
        if vals.get("texture_file") and not vals.get("texture_file_filename"):
            vals["texture_file_filename"] = "texture.png"
        return vals

    def _has_texture_data(self):
        self.ensure_one()
        if self.texture_file or self.preview_image:
            return True
        if not self.id:
            return False
        return bool(self.env["ir.attachment"].sudo().search_count([
            ("res_model", "=", self._name),
            ("res_field", "in", ("texture_file", "preview_image")),
            ("res_id", "=", self.id),
        ]))

    def _validate_texture_assets(self):
        for texture in self:
            if not texture._has_texture_data():
                raise ValidationError(_("Please upload a texture image file."))
            filename = (texture.texture_file_filename or "").strip().lower()
            if not filename and texture.id:
                att = self.env["ir.attachment"].sudo().search([
                    ("res_model", "=", texture._name),
                    ("res_field", "in", ("texture_file", "preview_image")),
                    ("res_id", "=", texture.id),
                ], limit=1)
                filename = (att.name or "").lower()
            if filename and not filename.endswith(ALLOWED_TEXTURE_EXTENSIONS):
                raise ValidationError(_("Texture images must be PNG, JPG, or WebP."))
            if texture.price_per_sqm < 0:
                raise ValidationError(_("Price per m² cannot be negative."))

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            self._prepare_texture_vals(vals)
        records = super().create(vals_list)
        records._validate_texture_assets()
        return records

    def write(self, vals):
        res = super().write(self._prepare_texture_vals(dict(vals)))
        if {"preview_image", "texture_file", "texture_file_filename", "price_per_sqm"} & set(vals):
            self._validate_texture_assets()
        return res

    @api.model
    def get_grouped_for_designer(self):
        textures = self.search([("active", "=", True)], order="sequence, id")
        labels = dict(TEXTURE_CATEGORIES)
        by_category = {key: textures.filtered(lambda t, k=key: t.category == k) for key, _ in TEXTURE_CATEGORIES}
        return [
            EditorTextureGroup(key, labels.get(key, key), by_category[key])
            for key, _ in TEXTURE_CATEGORIES if by_category[key]
        ]
