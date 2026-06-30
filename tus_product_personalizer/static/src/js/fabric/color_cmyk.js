/** @odoo-module **/

function normalizeHex(hexColor) {
    if (!hexColor || typeof hexColor !== "string") {
        return null;
    }
    let value = hexColor.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(value)) {
        return value.toLowerCase();
    }
    const short = value.match(/^#?([0-9a-fA-F]{3})$/);
    if (short) {
        const body = short[1].toLowerCase();
        return `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`;
    }
    return null;
}

export function rgbToCmykPercent(red, green, blue) {
    const r = red / 255;
    const g = green / 255;
    const b = blue / 255;
    const key = 1 - Math.max(r, g, b);
    if (key >= 1) {
        return { c: 0, m: 0, y: 0, k: 100 };
    }
    const c = ((1 - r - key) / (1 - key)) * 100;
    const m = ((1 - g - key) / (1 - key)) * 100;
    const y = ((1 - b - key) / (1 - key)) * 100;
    return {
        c: Math.round(c),
        m: Math.round(m),
        y: Math.round(y),
        k: Math.round(key * 100),
    };
}

export function hexToCmykDisplay(hexColor) {
    const normalized = normalizeHex(hexColor);
    if (!normalized) {
        return "";
    }
    const r = parseInt(normalized.slice(1, 3), 16);
    const g = parseInt(normalized.slice(3, 5), 16);
    const b = parseInt(normalized.slice(5, 7), 16);
    const { c, m, y, k } = rgbToCmykPercent(r, g, b);
    return `C${c} M${m} Y${y} K${k}`;
}

export function resolveCmykForColor(hexColor, paletteMap = {}) {
    const normalized = normalizeHex(hexColor);
    if (!normalized) {
        return "";
    }
    if (paletteMap[normalized]) {
        return paletteMap[normalized];
    }
    return hexToCmykDisplay(normalized);
}

export function buildPaletteCmykMap(rootEl) {
    const map = {};
    if (!rootEl) {
        return map;
    }
    rootEl.querySelectorAll("[data-color][data-cmyk]").forEach((node) => {
        const hex = normalizeHex(node.dataset.color);
        if (hex && node.dataset.cmyk) {
            map[hex] = node.dataset.cmyk;
        }
    });
    return map;
}

export function updateCmykReadout(hexColor, readoutEl, paletteMap = {}) {
    if (!readoutEl) {
        return resolveCmykForColor(hexColor, paletteMap);
    }
    const cmyk = resolveCmykForColor(hexColor, paletteMap);
    readoutEl.textContent = cmyk ? `Print: ${cmyk}` : "";
    readoutEl.style.display = cmyk ? "" : "none";
    return cmyk;
}
