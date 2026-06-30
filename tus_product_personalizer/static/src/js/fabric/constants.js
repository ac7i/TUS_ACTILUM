/** @odoo-module **/

const CLIPART_CATEGORIES = {
    brand_logos: {
        label: "Brand Logos",
        prefix: "logos",
        all_icons: [],
        loaded: false,
        expanded: false,
        offset: 0
    },
    tech_apps: {
        label: "Tech & Apps",
        prefix: "skill-icons",
        all_icons: [],
        loaded: false,
        expanded: false,
        offset: 0
    },
    bold_clipart: {
        label: "Bold Clipart",
        prefix: "game-icons",
        all_icons: [],
        loaded: false,
        expanded: false,
        offset: 0
    },
    ui_icons: {
        label: "UI Icons",
        prefix: "ph",
        all_icons: [],
        loaded: false,
        expanded: false,
        offset: 0
    },
    modern_emojis: {
        label: "Modern Emojis",
        prefix: "fluent-emoji",
        all_icons: [],
        loaded: false,
        expanded: false,
        offset: 0
    },
    classic_emojis: {
        label: "Classic Emojis",
        prefix: "noto",
        all_icons: [],
        loaded: false,
        expanded: false,
        offset: 0
    },
    flags: {
        label: "Flags",
        prefix: "circle-flags",
        all_icons: [],
        loaded: false,
        expanded: false,
        offset: 0
    },
    food: {
        label: "Food & Drink",
        prefix: "noto",
        // We'll filter to food-related icons by name
        filterKeywords: ["food", "fruit", "pizza", "burger", "cake", "coffee", "tea", "cookie", "bread", "egg", "meat", "sushi", "taco", "noodle", "rice", "soup", "salad", "cheese", "donut", "ice", "candy", "chocolate", "mango", "apple", "banana", "grape", "strawberry", "lemon", "peach", "pear", "cherry", "melon", "pineapple", "coconut", "avocado", "carrot", "broccoli", "corn", "potato", "tomato", "onion", "garlic", "pepper", "mushroom", "eggplant", "cucumber", "peanut", "chestnut", "wine", "beer", "cocktail", "juice", "milk", "honey"],
        all_icons: [],
        loaded: false,
        expanded: false,
        offset: 0
    },
    shapes: {
        label: "Shapes",
        prefix: "mdi",
        filterKeywords: ["circle", "square", "triangle", "rectangle", "hexagon", "pentagon", "octagon", "diamond", "heart", "star", "arrow", "oval", "rhombus", "trapezoid"],
        all_icons: [],
        loaded: false,
        expanded: false,
        offset: 0
    },
    numbers: {
        label: "Numbers",
        prefix: "mdi",
        filterKeywords: ["numeric", "number-"],
        all_icons: [],
        loaded: false,
        expanded: false,
        offset: 0
    },
};

const TUS_PANEL_TITLES = {
    swap: "Product",
    image: "Upload",
    text: "Add text",
    layers: "Layers",
    shapes: "Graphics",
    clipart: "Clipart",
    ai: "AI",
    templates: "Templates",
    vdp: "VDP",
};

const TUS_SKIP_INFO_KEY = "tus_personalizer_skip_product_info";

export { CLIPART_CATEGORIES, TUS_PANEL_TITLES, TUS_SKIP_INFO_KEY };

export const TUS_FABRIC_CUSTOM_PROPS = [
    "tusFinishEffect",
    "tusReliefMm",
    "tusVarnishType",
    "tusFoilMetal",
    "tusFinishColorBackup",
    "tusFinishPreviewActive",
    "tusCmyk",
    "backend_id",
    "isVectorSvgGroup",
    "isEmbeddedPhotoSvg",
    "tusArtworkTone",
    "tusVdpKey",
    "tusVdpSampleDisplay",
];

/** Minimum effective print resolution for uploaded raster images. */
export const MIN_UPLOAD_DPI = 150;

/** RPC routes blocked for view-only shared design guests. */
export const SHARE_WRITE_ROUTES = [
    "/custom/design/save",
    "/custom/design/upload",
    "/canvas/ai_generate",
    "/canvas/enhance_image",
    "/canvas/upload_image",
    "/canvas/vectorize_image",
    "/canvas/remove_background",
    "/canvas/update_image",
    "/delete/image",
    "/shop/buy/now",
    "/shop/vdp/upload-designs",
    "/save/orderline",
    "/custom/design/share/save",
];

/** Poll interval for live guest permission refresh (ms). */
export const GUEST_ACCESS_REFRESH_MS = 45000;

/** Full-page overlay while VDP checkout export runs. */
export const TUS_VDP_PROCESSING_OVERLAY_CLASS = "tus-vdp-processing-overlay";
/** Body class: hides the designer viewport while VDP checkout export runs. */
export const TUS_VDP_CHECKOUT_BODY_CLASS = "tus-vdp-checkout-active";
