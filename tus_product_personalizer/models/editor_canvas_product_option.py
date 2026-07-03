# -*- coding: utf-8 -*-
from odoo import api, fields, models, _
from odoo.exceptions import ValidationError

OPTION_CATEGORY_SELECTION = [
    ("finish", "Finish"),
    ("print_quality", "Print Quality"),
    ("print_mode", "Print Mode"),
    ("machining", "Basic Machining"),
]


class EditorCanvasProductOption(models.Model):
    _name = "editor.canvas.product.option"
    _description = "Empty Canvas Product Option"
    _order = "category, sequence, id"

    name = fields.Char(required=True, translate=True)
    code = fields.Char(
        required=True,
        help="Stable technical key stored on sale orders and passed in designer URLs.",
    )
    category = fields.Selection(
        OPTION_CATEGORY_SELECTION,
        required=True,
        index=True,
    )
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)
    is_default = fields.Boolean(
        string="Default",
        help="Pre-selected on the product page when this option is available.",
    )
    description = fields.Text(translate=True)

    _sql_constraints = [
        (
            "code_category_uniq",
            "unique(code, category)",
            "The technical code must be unique within each option category.",
        ),
    ]

    @api.constrains("is_default", "category", "active")
    def _check_single_default_per_category(self):
        for option in self.filtered(lambda rec: rec.is_default and rec.active):
            duplicate = self.search([
                ("id", "!=", option.id),
                ("category", "=", option.category),
                ("is_default", "=", True),
                ("active", "=", True),
            ], limit=1)
            if duplicate:
                raise ValidationError(
                    _(
                        "Only one active default is allowed per category. "
                        "'%(name)s' is already the default for %(category)s.",
                        name=duplicate.name,
                        category=dict(OPTION_CATEGORY_SELECTION).get(option.category, option.category),
                    )
                )

    @api.model
    def _get_options_for_product(self, product_tmpl, category):
        linked = product_tmpl.empty_canvas_option_ids.filtered(
            lambda option: option.category == category and option.active
        )
        if linked:
            return linked.sorted(lambda option: (option.sequence, option.id))
        return self.sudo().search([
            ("category", "=", category),
            ("active", "=", True),
        ]).sorted(lambda option: (option.sequence, option.id))

    @api.model
    def _default_code_for_category(self, product_tmpl, category):
        options = self._get_options_for_product(product_tmpl, category)
        default_option = options.filtered("is_default")[:1] or options[:1]
        return default_option.code if default_option else False

    @api.model
    def _allowed_keys_for_product(self, product_tmpl):
        payload = self._payload_for_product(product_tmpl)
        return {
            "finish": frozenset(
                option["value"] for option in payload["finish"]["options"]
            ),
            "print_quality": frozenset(
                option["value"] for option in payload["print_quality"]["options"]
            ),
            "print_mode": frozenset(
                option["value"] for option in payload["print_mode"]["options"]
            ),
            "machining": frozenset(option["key"] for option in payload["machining"]),
            "defaults": {
                "finish": payload["finish"]["default"],
                "print_quality": payload["print_quality"]["default"],
                "print_mode": payload["print_mode"]["default"],
            },
        }

    @api.model
    def _allowed_keys_all_active(self):
        payload = {
            "finish": self._payload_for_category("finish"),
            "print_quality": self._payload_for_category("print_quality"),
            "print_mode": self._payload_for_category("print_mode"),
            "machining": self._machining_payload(),
        }
        return {
            "finish": frozenset(option["value"] for option in payload["finish"]["options"]),
            "print_quality": frozenset(
                option["value"] for option in payload["print_quality"]["options"]
            ),
            "print_mode": frozenset(option["value"] for option in payload["print_mode"]["options"]),
            "machining": frozenset(option["key"] for option in payload["machining"]),
            "defaults": {
                "finish": payload["finish"]["default"],
                "print_quality": payload["print_quality"]["default"],
                "print_mode": payload["print_mode"]["default"],
            },
        }

    @api.model
    def _payload_for_category(self, category):
        options = self.sudo().search([
            ("category", "=", category),
            ("active", "=", True),
        ]).sorted(lambda option: (option.sequence, option.id))
        default_option = options.filtered("is_default")[:1] or options[:1]
        return {
            "default": default_option.code if default_option else False,
            "options": [
                {"id": option.id, "value": option.code, "label": option.name}
                for option in options
            ],
        }

    @api.model
    def _machining_payload(self):
        options = self.sudo().search([
            ("category", "=", "machining"),
            ("active", "=", True),
        ]).sorted(lambda option: (option.sequence, option.id))
        return [
            {"id": option.id, "key": option.code, "label": option.name}
            for option in options
        ]

    @api.model
    def _payload_for_product(self, product_tmpl):
        def _select_payload(category):
            options = self._get_options_for_product(product_tmpl, category)
            default_option = options.filtered("is_default")[:1] or options[:1]
            return {
                "default": default_option.code if default_option else False,
                "options": [
                    {
                        "id": option.id,
                        "value": option.code,
                        "label": option.name,
                    }
                    for option in options
                ],
            }

        machining_options = self._get_options_for_product(product_tmpl, "machining")
        return {
            "finish": _select_payload("finish"),
            "print_quality": _select_payload("print_quality"),
            "print_mode": _select_payload("print_mode"),
            "machining": [
                {
                    "id": option.id,
                    "key": option.code,
                    "label": option.name,
                }
                for option in machining_options
            ],
        }

    @api.model
    def get_label_map(self, category, codes):
        codes = [code for code in (codes or []) if code]
        if not codes:
            return {}
        options = self.sudo().search([
            ("category", "=", category),
            ("code", "in", codes),
        ])
        return {option.code: option.name for option in options}
