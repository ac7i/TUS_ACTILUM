from odoo import fields, models


class ResConfigSettings(models.TransientModel):
    _inherit = 'res.config.settings'

    personalizer_enable_swap = fields.Boolean(
        string="Swap Product",
        related='website_id.personalizer_enable_swap',
        readonly=False,
    )
    personalizer_enable_text = fields.Boolean(
        string="Add Text",
        related='website_id.personalizer_enable_text',
        readonly=False,
    )
    personalizer_enable_image = fields.Boolean(
        string="Add Image",
        related='website_id.personalizer_enable_image',
        readonly=False,
    )
    personalizer_enable_layers = fields.Boolean(
        string="Manage Layers",
        related='website_id.personalizer_enable_layers',
        readonly=False,
    )
    personalizer_enable_shape = fields.Boolean(
        string="Allow Default Shapes",
        related='website_id.personalizer_enable_shape',
        readonly=False,
    )
    personalizer_enable_templates = fields.Boolean(
        string="Saved Templates",
        related='website_id.personalizer_enable_templates',
        readonly=False,
    )
    personalizer_enable_text_templates = fields.Boolean(
        string="Text Templates",
        related='website_id.personalizer_enable_text_templates',
        readonly=False,
    )
    personalizer_enable_preview = fields.Boolean(
        string="Show Preview",
        related='website_id.personalizer_enable_preview',
        readonly=False,
    )
    personalizer_enable_3d_preview = fields.Boolean(
        string="3D Preview",
        related='website_id.personalizer_enable_3d_preview',
        readonly=False,
    )
    personalizer_enable_texture = fields.Boolean(
        string="Texture Library",
        related='website_id.personalizer_enable_texture',
        readonly=False,
    )
    personalizer_enable_download = fields.Boolean(
        string="Download",
        related='website_id.personalizer_enable_download',
        readonly=False,
    )
    personalizer_enable_share = fields.Boolean(
        string="Share Design",
        related='website_id.personalizer_enable_share',
        readonly=False,
    )
    personalizer_enable_help = fields.Boolean(
        string="Designer Help",
        related='website_id.personalizer_enable_help',
        readonly=False,
    )
    personalizer_enable_matrix = fields.Boolean(
        string="Enable Matrix Table",
        related='website_id.personalizer_enable_matrix',
        readonly=False,
    )
    personalizer_enable_vdp = fields.Boolean(
        string="Variable Data Printing (VDP)",
        related='website_id.personalizer_enable_vdp',
        readonly=False,
    )
    personalizer_vdp_product_ids = fields.Many2many(
        'product.template',
        string="VDP Products",
        related='website_id.personalizer_vdp_product_ids',
        readonly=False,
    )
    personalizer_matrix_product_ids = fields.Many2many(
        'product.template',
        string="Matrix Products",
        related='website_id.personalizer_matrix_product_ids',
        readonly=False,
    )
    personalizer_enable_design_price = fields.Boolean(
        string="Enable Design Area Price",
        related='website_id.personalizer_enable_design_price',
        readonly=False,
    )
    personalizer_design_price_product_ids = fields.Many2many(
        'product.template',
        string="Design Price Products",
        related='website_id.personalizer_design_price_product_ids',
        readonly=False,
    )
    personalizer_enable_ai = fields.Boolean(
        string="AI Image Generator",
        related='website_id.personalizer_enable_ai',
        readonly=False,
    )
    personalizer_ai_api_key = fields.Char(
        string="OpenAI API Key",
        related='website_id.personalizer_ai_api_key',
        readonly=False,
    )
    personalizer_ai_model = fields.Selection(
        related='website_id.personalizer_ai_model',
        readonly=False,
    )
    personalizer_ai_image_count = fields.Integer(
        string="Images per generation",
        related='website_id.personalizer_ai_image_count',
        readonly=False,
    )
    personalizer_ai_image_size = fields.Selection(
        related='website_id.personalizer_ai_image_size',
        readonly=False,
    )
    personalizer_ai_quality = fields.Selection(
        related='website_id.personalizer_ai_quality',
        readonly=False,
    )
    personalizer_enable_printing = fields.Boolean(
        string="Enable Printing Methods",
        related='website_id.personalizer_enable_printing',
        readonly=False,
    )
    personalizer_printing_product_ids = fields.Many2many(
        'product.template',
        string="Printing Method Products",
        related='website_id.personalizer_printing_product_ids',
        readonly=False,
    )
    personalizer_button_color = fields.Char(
        string="Button Color",
        related='website_id.personalizer_button_color',
        readonly=False,
    )
    personalizer_button_text_color = fields.Char(
        string="Button Text Color",
        related='website_id.personalizer_button_text_color',
        readonly=False,
    )
    personalizer_text_color = fields.Char(
        string="Text Color",
        related='website_id.personalizer_text_color',
        readonly=False,
    )
    personalizer_font_family = fields.Selection(
        related='website_id.personalizer_font_family',
        readonly=False,
    )
    personalizer_print_color_mode = fields.Selection(
        related='website_id.personalizer_print_color_mode',
        readonly=False,
    )
