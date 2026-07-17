import re

from odoo import _, api, fields, models
from odoo.exceptions import ValidationError

_HEX_COLOR_RE = re.compile(r'^#[0-9A-Fa-f]{6}$')

PERSONALIZER_FONT_FAMILIES = {
    'system': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    'inter': '"Inter", sans-serif',
    'roboto': '"Roboto", sans-serif',
    'open_sans': '"Open Sans", sans-serif',
    'lato': '"Lato", sans-serif',
    'poppins': '"Poppins", sans-serif',
    'montserrat': '"Montserrat", sans-serif',
}

PERSONALIZER_FONT_GOOGLE_URLS = {
    'inter': 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
    'roboto': 'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap',
    'open_sans': 'https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap',
    'lato': 'https://fonts.googleapis.com/css2?family=Lato:wght@400;700&display=swap',
    'poppins': 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap',
    'montserrat': 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap',
}


class Website(models.Model):
    _inherit = 'website'

    personalizer_enable_swap = fields.Boolean(
        string="Swap Product",
        default=True,
        help="Allow users to swap between product variants in the editor"
    )
    personalizer_enable_text = fields.Boolean(
        string="Add Text",
        default=True,
        help="Allow users to add and edit text elements in the editor"
    )
    personalizer_enable_image = fields.Boolean(
        string="Add Image",
        default=True,
        help="Allow users to upload and add images in the editor"
    )
    personalizer_enable_layers = fields.Boolean(
        string="Manage Layers",
        default=True,
        help="Allow users to manage layer ordering in the editor"
    )
    personalizer_enable_shape = fields.Boolean(
        string="Allow Default Shapes",
        default=True,
        help="Allow users to add from default shapes in the editor"
    )
    personalizer_enable_templates = fields.Boolean(
        string="Saved Templates",
        default=True,
        help="Allow users to save and load design templates. "
             "The Save button in the editor depends on this setting."
    )
    personalizer_enable_text_templates = fields.Boolean(
        string="Text Templates",
        default=True,
        help="Show ready-to-use SVG text templates in the Text panel of the designer.",
    )
    personalizer_enable_preview = fields.Boolean(
        string="Show Preview",
        default=True,
        help="Show preview button in the editor header"
    )
    personalizer_enable_3d_preview = fields.Boolean(
        string="3D Preview",
        default=False,
        help="Enable PBR 3D preview mode in the product designer (per-product opt-in required)",
    )
    personalizer_enable_texture = fields.Boolean(
        string="Texture Library",
        default=False,
        help="Enable the admin texture library in the product designer (per-product opt-in required)",
    )
    personalizer_enable_download = fields.Boolean(
        string="Download",
        default=True,
        help="Show download button in the editor header"
    )
    personalizer_enable_share = fields.Boolean(
        string="Share Design",
        default=True,
        help="Show share button in the editor header to create shareable design links"
    )
    personalizer_enable_help = fields.Boolean(
        string="Designer Help",
        default=True,
        help="Show the help button at the bottom of the designer sidebar",
    )
    personalizer_enable_matrix = fields.Boolean(
        string="Enable Matrix Table",
        default=False,
        help="Enable bulk order matrix selection in the designer"
    )
    personalizer_enable_vdp = fields.Boolean(
        string="Variable Data Printing (VDP)",
        default=False,
        help="Enable bulk personalization from CSV/Excel datasets in the designer",
    )
    personalizer_vdp_product_ids = fields.Many2many(
        'product.template',
        'website_personalizer_vdp_product_rel',
        'website_id',
        'product_tmpl_id',
        string="VDP Products",
        help="Products that support variable data printing (empty = all personalizer products)",
    )
    personalizer_matrix_product_ids = fields.Many2many(
        'product.template',
        'website_personalizer_matrix_product_rel',
        'website_id',
        'product_tmpl_id',
        string="Matrix Products",
        help="Products that will use the matrix selection flow"
    )
    personalizer_enable_design_price = fields.Boolean(
        string="Enable Design Area Price",
        default=False,
        help="Enable additional pricing based on used design areas"
    )
    personalizer_design_price_product_ids = fields.Many2many(
        'product.template',
        'website_personalizer_design_price_product_rel',
        'website_id',
        'product_tmpl_id',
        string="Design Price Products",
        help="Products that will use per-design-area pricing"
    )
    personalizer_enable_ai = fields.Boolean(
        string="AI Image Generator",
        default=False,
        help="Allow users to generate images from text prompts in the product designer",
    )
    personalizer_ai_api_key = fields.Char(
        string="OpenAI API Key",
        help="Server-side API key for OpenAI image generation (never exposed to the browser)",
    )
    personalizer_ai_model = fields.Selection(
        selection=[
            ('gpt-image-1', 'GPT Image 1'),
            ('dall-e-3', 'DALL·E 3'),
            ('dall-e-2', 'DALL·E 2'),
        ],
        string="AI Image Model",
        default='gpt-image-1',
        required=True,
    )
    personalizer_ai_image_count = fields.Integer(
        string="Images per generation",
        default=4,
        help="Number of images returned on each Generate click (1–10)",
    )
    personalizer_ai_image_size = fields.Selection(
        selection=[
            ('1024x1024', '1024 × 1024'),
            ('1536x1024', '1536 × 1024 (landscape)'),
            ('1024x1536', '1024 × 1536 (portrait)'),
            ('1792x1024', '1792 × 1024 (DALL·E 3 landscape)'),
            ('1024x1792', '1024 × 1792 (DALL·E 3 portrait)'),
        ],
        string="AI Image Size",
        default='1024x1024',
        required=True,
    )
    personalizer_ai_quality = fields.Selection(
        selection=[
            ('low', 'Low'),
            ('medium', 'Medium'),
            ('high', 'High'),
            ('auto', 'Auto'),
            ('standard', 'Standard (DALL·E)'),
            ('hd', 'HD (DALL·E 3)'),
        ],
        string="AI Image Quality",
        default='medium',
        required=True,
    )
    personalizer_enable_printing = fields.Boolean(
        string="Enable Printing Methods",
        default=False,
        help="Enable custom printing method configuration and automatic MO integration"
    )
    personalizer_printing_product_ids = fields.Many2many(
        'product.template',
        'website_personalizer_printing_product_rel',
        'website_id',
        'product_tmpl_id',
        string="Printing Method Products",
        help="Products that will allow the custom printing methods"
    )
    personalizer_button_color = fields.Char(
        string="Designer Button Color",
        default='#4d5038',
        help="Background color for primary buttons in the product designer (Save, active tabs, etc.)",
    )
    personalizer_button_text_color = fields.Char(
        string="Designer Button Text Color",
        default='#ffffff',
        help="Text color on primary buttons in the product designer",
    )
    personalizer_text_color = fields.Char(
        string="Designer Text Color",
        default='#111827',
        help="Default text color for labels and content in the product designer",
    )
    personalizer_font_family = fields.Selection(
        selection=[
            ('system', 'System default'),
            ('inter', 'Inter'),
            ('roboto', 'Roboto'),
            ('open_sans', 'Open Sans'),
            ('lato', 'Lato'),
            ('poppins', 'Poppins'),
            ('montserrat', 'Montserrat'),
        ],
        string="Designer Font",
        default='system',
        help="Font family used across the product designer interface",
    )
    personalizer_print_color_mode = fields.Selection(
        selection=[
            ('cmyk', 'CMYK (Print Production)'),
            ('rgb', 'RGB (Screen Preview)'),
        ],
        string="Print Export Color Mode",
        default='cmyk',
        help="CMYK converts exported SVG/AI files to device-cmyk() colors for "
             "print shops. RGB keeps screen colors in export files.",
    )
    personalizer_upload_max_mb = fields.Integer(
        string="Max Upload Size (MB)",
        default=40,
        help="Maximum artwork file size accepted by the product designer.",
    )
    personalizer_upload_max_pixels = fields.Integer(
        string="Max Upload Pixels",
        default=80000000,
        help="Maximum width×height for source artwork. Larger files should use a "
             "production original with a downsampled editor preview.",
    )
    personalizer_preview_max_side = fields.Integer(
        string="Editor Preview Max Side (px)",
        default=2048,
        help="Longest side of the browser-safe preview generated from TIFF/PDF/"
             "high-resolution uploads.",
    )

    @api.constrains(
        'personalizer_upload_max_mb',
        'personalizer_upload_max_pixels',
        'personalizer_preview_max_side',
    )
    def _check_personalizer_upload_limits(self):
        for website in self:
            if (website.personalizer_upload_max_mb or 0) < 1:
                raise ValidationError(_('Max upload size must be at least 1 MB.'))
            if (website.personalizer_upload_max_pixels or 0) < 1_000_000:
                raise ValidationError(_('Max upload pixels must be at least 1,000,000.'))
            if (website.personalizer_preview_max_side or 0) < 512:
                raise ValidationError(_('Editor preview max side must be at least 512 px.'))

    def get_personalizer_upload_limits(self):
        self.ensure_one()
        return {
            "max_bytes": int((self.personalizer_upload_max_mb or 40) * 1024 * 1024),
            "max_pixels": int(self.personalizer_upload_max_pixels or 80_000_000),
            "preview_max_side": int(self.personalizer_preview_max_side or 2048),
        }

    @api.constrains('personalizer_ai_image_count')
    def _check_personalizer_ai_image_count(self):
        for website in self:
            count = website.personalizer_ai_image_count or 0
            if count < 1 or count > 10:
                raise ValidationError(
                    _('Images per generation must be between 1 and 10.')
                )

    @api.constrains(
        'personalizer_button_color',
        'personalizer_button_text_color',
        'personalizer_text_color',
    )
    def _check_personalizer_colors(self):
        for website in self:
            for field_name in (
                'personalizer_button_color',
                'personalizer_button_text_color',
                'personalizer_text_color',
            ):
                value = website[field_name]
                if value and not _HEX_COLOR_RE.match(value):
                    raise ValidationError(
                        _(
                            '%(label)s must be a valid hex color (e.g. #4d5038).',
                            label=website._fields[field_name].string,
                        )
                    )

    def _personalizer_darken_hex(self, hex_color, factor=0.88):
        hex_color = (hex_color or '#4d5038').lstrip('#')
        if len(hex_color) != 6:
            return '#3d4030'
        r = int(int(hex_color[0:2], 16) * factor)
        g = int(int(hex_color[2:4], 16) * factor)
        b = int(int(hex_color[4:6], 16) * factor)
        return f'#{r:02x}{g:02x}{b:02x}'

    def _personalizer_font_family_css(self):
        self.ensure_one()
        return PERSONALIZER_FONT_FAMILIES.get(
            self.personalizer_font_family or 'system',
            PERSONALIZER_FONT_FAMILIES['system'],
        )

    def _personalizer_font_google_url(self):
        self.ensure_one()
        return PERSONALIZER_FONT_GOOGLE_URLS.get(self.personalizer_font_family or '')

    def get_personalizer_theme_values(self):
        """Theme tokens for the storefront designer (CSS variables)."""
        self.ensure_one()
        button = self.personalizer_button_color or '#4d5038'
        button_text = self.personalizer_button_text_color or '#ffffff'
        text = self.personalizer_text_color or '#111827'
        font_key = self.personalizer_font_family or 'system'
        return {
            'button_color': button,
            'button_text_color': button_text,
            'text_color': text,
            'button_hover_color': self._personalizer_darken_hex(button),
            'font_family': font_key,
            'font_family_css': self._personalizer_font_family_css(),
            'font_google_url': self._personalizer_font_google_url() or '',
        }
