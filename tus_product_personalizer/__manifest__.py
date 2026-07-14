{
    "name": "Odoo Product Personalizer | Web-to-Print Studio | Product Editor, Designer & Customizer | Web2Print",
    "version": "19.0.0.0.24",
    "author": "TechUltra Solutions Private Limited",
    "category": "Ecommerce",
    "live_test_url": "https://youtu.be/9-0NuE8QIgY",
    "website": "www.techultrasolutions.com",
    "summary": """
        Product Designer Odoo
        TUS Product Personalizer
	product customizer, web to print, odoo product designer, print on demand, product personalization, t-shirt designer, mug printing, product preview, odoo web2print, customize product, online editor, product builder, odoo eCommerce addon

    """,
    "description": """
        Product Designer Odoo
        TUS Product Personalizer
	product customizer, web to print, odoo product designer, print on demand, product personalization, t-shirt designer, mug printing, product preview, odoo web2print, customize product, online editor, product builder, odoo eCommerce addon

    """,
    "depends": ["website_sale", "sale_management", "mrp", "sale_mrp"],
    "data": [
        "security/ir.model.access.csv",
        "data/data.xml",
        "data/text_template_data.xml",
        "data/canvas_preset_data.xml",
        "data/canvas_product_option_data.xml",
        "views/fancy_product_view.xml",
        "views/product_loader_snippet.xml",
        "views/product_view.xml",
        "views/res_partner_view.xml",
        "views/orderline_design_upload.xml",
        "views/sale_order_view.xml",
        "views/website_template.xml",
        "views/editor_color_palette.xml",
        "views/editor_text_template_views.xml",
        "views/editor_texture_views.xml",
        "views/editor_canvas_preset_views.xml",
        "views/editor_canvas_product_option_views.xml",
        "views/orderline_vdp_views.xml",
        "views/product_personalizer_help_views.xml",
        "data/help_content_data.xml",
        "views/personalizer_help_page.xml",
        "views/personalizer_menu_items.xml",
        "views/res_config_settings_views.xml",
        "views/product_attribute_view.xml",
        "views/product_printing_method_view.xml",
        "views/product_design_template_views.xml",
        "report/production_sheet_report.xml",
        "report/production_sheet_templates.xml",
    ],
    "assets": {
        "web.assets_backend": [
            "tus_product_personalizer/static/src/scss/designer_backend.scss",
            "tus_product_personalizer/static/src/xml/backend_fabric_dialog.xml",
            "tus_product_personalizer/static/src/js/editor_listrenderer.js",
            "tus_product_personalizer/static/src/js/editor_field.js",
            "tus_product_personalizer/static/src/js/design_area_shapes.js",
            "tus_product_personalizer/static/src/js/backend_fabric_dialog.js",
        ],
        "web.assets_frontend": [
            "https://code.iconify.design/3/3.1.1/iconify.min.js",
            "https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.1/fabric.min.js",
            "tus_product_personalizer/static/src/lib/js/vanilla-picker.min.js",
            "tus_product_personalizer/static/src/lib/js/tinycolor-min.js",
            "tus_product_personalizer/static/src/lib/js/areasortable.js",
            
            # Styles — single source of truth (base layout + premium UI layer)
            "tus_product_personalizer/static/src/scss/editor.scss",
            "tus_product_personalizer/static/src/scss/editor_ref_layout.scss",
            "tus_product_personalizer/static/src/scss/empty_canvas.scss",
            "tus_product_personalizer/static/src/scss/product_loader.scss",
            
            # Website Sale Extension (handles customize button click)
            ("after", "website_sale/static/src/interactions/website_sale.js", "tus_product_personalizer/static/src/interactions/website_sale.js"),
            
            # Background removal (browser AI)
            "tus_product_personalizer/static/src/js/background_removal.js",
            "tus_product_personalizer/static/src/js/design_area_shapes.js",
            "tus_product_personalizer/static/src/js/3d/finish_effects.js",
            "tus_product_personalizer/static/lib/three/three.min.js",
            "tus_product_personalizer/static/lib/three/OrbitControls.js",
            "tus_product_personalizer/static/src/js/3d/texture_baker.js",
            "tus_product_personalizer/static/src/js/3d/pbr_viewer.js",
            "tus_product_personalizer/static/src/js/3d/viewer_controls.js",
            # Fabric editor modules (split for maintainability)
            "tus_product_personalizer/static/src/js/fabric/constants.js",
            "tus_product_personalizer/static/src/js/fabric/fabric_props.js",
            "tus_product_personalizer/static/src/js/fabric/templates_mixin.js",
            "tus_product_personalizer/static/src/js/fabric/text_templates_mixin.js",
            "tus_product_personalizer/static/src/js/fabric/clipart_mixin.js",
            "tus_product_personalizer/static/src/js/fabric/matrix_mixin.js",
            "tus_product_personalizer/static/src/js/fabric/share_mixin.js",
            "tus_product_personalizer/static/src/js/fabric/print_dpi_mixin.js",
            "tus_product_personalizer/static/src/js/fabric/upload_mixin.js",
            "tus_product_personalizer/static/lib/js/qrcode.min.js",
            "tus_product_personalizer/static/src/js/fabric/qr_mixin.js",
            "tus_product_personalizer/static/src/js/fabric/vdp_mixin.js",
            "tus_product_personalizer/static/src/js/fabric/empty_canvas_mixin.js",
            "tus_product_personalizer/static/src/js/fabric/texture_mixin.js",
            "tus_product_personalizer/static/src/js/fabric/finish_upload_mixin.js",
            "tus_product_personalizer/static/src/js/fabric/help_mixin.js",
            "tus_product_personalizer/static/src/js/fabric/color_cmyk.js",
            "tus_product_personalizer/static/src/js/fabric_js.js",
            "tus_product_personalizer/static/src/js/fabric/ref_layout.js",
            "tus_product_personalizer/static/src/xml/matrix_templates.xml",
        ],
    },
    "price": 699,
    "currency": "USD",
    "images": ["static/description/image/tus_banner.gif"],
    "external_dependencies": {
        "python": [
            "rembg",
            "onnxruntime",
            "PIL",
            "vtracer",
            "openpyxl",
        ],
    },
    "installable": True,
    "auto_install": False,
    "license": "OPL-1",
}
