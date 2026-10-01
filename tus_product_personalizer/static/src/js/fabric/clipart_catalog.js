/** @odoo-module **/

/**
 * Local clipart catalog (primary source). Panel works with Iconify CDN blocked.
 * Paths are module-static URLs under tus_product_personalizer.
 */
const IMG = "/tus_product_personalizer/static/src/data/img";

function icon(id, file, label) {
    return {
        id,
        label: label || id,
        url: `${IMG}/${file}`,
    };
}

/** Curated local icons per panel category (never empty). */
export const LOCAL_CLIPART_CATALOG = {
    brand_logos: [
        icon("logo-01", "Icon-01.svg", "Mark"),
        icon("logo-02", "Icon-02.svg", "Badge"),
        icon("logo-03", "Icon-03.svg", "Crest"),
        icon("logo-04", "Icon-04.svg", "Seal"),
        icon("logo-05", "Icon-05.svg", "Emblem"),
        icon("logo-06", "Icon-06.svg", "Brand"),
    ],
    tech_apps: [
        icon("tech-07", "Icon-07.svg", "App"),
        icon("tech-08", "Icon-08.svg", "Device"),
        icon("tech-09", "Icon-09.svg", "Cloud"),
        icon("tech-10", "Icon-10.svg", "Code"),
        icon("tech-11", "Icon-11.svg", "Chip"),
        icon("tech-12", "Icon-12.svg", "Signal"),
    ],
    bold_clipart: [
        icon("bold-13", "Icon-13.svg", "Bold 1"),
        icon("bold-14", "Icon-14.svg", "Bold 2"),
        icon("bold-15", "Icon-15.svg", "Bold 3"),
        icon("bold-16", "Icon-16.svg", "Bold 4"),
        icon("bold-17", "Icon-17.svg", "Bold 5"),
        icon("bold-18", "Icon-18.svg", "Bold 6"),
        icon("bold-19", "Icon-19.svg", "Bold 7"),
        icon("bold-20", "Icon-20.svg", "Bold 8"),
    ],
    ui_icons: [
        icon("ui-21", "Icon-21.svg", "UI 1"),
        icon("ui-22", "Icon-22.svg", "UI 2"),
        icon("ui-23", "Icon-23.svg", "UI 3"),
        icon("ui-24", "Icon-24.svg", "UI 4"),
        icon("ui-25", "Icon-25.svg", "UI 5"),
        icon("ui-26", "Icon-26.svg", "UI 6"),
    ],
    modern_emojis: [
        icon("emo-27", "Icon-27.svg", "Emoji 1"),
        icon("emo-28", "Icon-28.svg", "Emoji 2"),
        icon("emo-29", "Icon-29.svg", "Emoji 3"),
        icon("emo-30", "Icon-30.svg", "Emoji 4"),
    ],
    classic_emojis: [
        icon("classic-31", "Icon-31.svg", "Classic 1"),
        icon("classic-32", "Icon-32.svg", "Classic 2"),
        icon("classic-33", "Icon-33.svg", "Classic 3"),
        icon("classic-34", "Icon-34.svg", "Classic 4"),
    ],
    flags: [
        icon("flag-35", "Icon-35.svg", "Flag 1"),
        icon("flag-36", "Icon-36.svg", "Flag 2"),
        icon("flag-37", "Icon-37.svg", "Flag 3"),
        icon("flag-38", "Icon-38.svg", "Flag 4"),
    ],
    food: [
        icon("food-01", "Icon-01.svg", "Food 1"),
        icon("food-05", "Icon-05.svg", "Food 2"),
        icon("food-09", "Icon-09.svg", "Food 3"),
        icon("food-13", "Icon-13.svg", "Food 4"),
        icon("food-17", "Icon-17.svg", "Food 5"),
        icon("food-21", "Icon-21.svg", "Food 6"),
    ],
    shapes: [
        icon("shape-circle", "circle_shape.svg", "Circle"),
        icon("shape-rect", "rect_shape.svg", "Rectangle"),
        icon("shape-triangle", "triangle_new.svg", "Triangle"),
        icon("shape-star", "star_new.svg", "Star"),
        icon("shape-pentagon", "pentagon_new.svg", "Pentagon"),
        icon("shape-line", "line_shape.svg", "Line"),
        icon("shape-heart", "Icon-01.svg", "Heart"),
    ],
    numbers: [
        icon("num-01", "Icon-01.svg", "1"),
        icon("num-02", "Icon-02.svg", "2"),
        icon("num-03", "Icon-03.svg", "3"),
        icon("num-04", "Icon-04.svg", "4"),
        icon("num-05", "Icon-05.svg", "5"),
        icon("num-06", "Icon-06.svg", "6"),
        icon("num-07", "Icon-07.svg", "7"),
        icon("num-08", "Icon-08.svg", "8"),
        icon("num-09", "Icon-09.svg", "9"),
        icon("num-10", "Icon-10.svg", "10"),
    ],
};

/** Lookup local entry by panel data-icon value (`local:category:id`). */
export function resolveLocalClipart(iconKey) {
    if (!iconKey || typeof iconKey !== "string") {
        return null;
    }
    if (!iconKey.startsWith("local:")) {
        return null;
    }
    const parts = iconKey.split(":");
    if (parts.length < 3) {
        return null;
    }
    const category = parts[1];
    const id = parts.slice(2).join(":");
    const list = LOCAL_CLIPART_CATALOG[category] || [];
    return list.find((item) => item.id === id) || null;
}
