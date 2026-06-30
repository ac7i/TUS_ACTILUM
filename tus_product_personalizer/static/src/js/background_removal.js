/** @odoo-module **/

/**
 * Background removal via Odoo server (rembg). Reliable inside Odoo assets
 * without CDN / WASM / dynamic import issues.
 */

function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

async function imageSourceToBase64(imageSource) {
    if (!imageSource) {
        throw new Error("No image source.");
    }
    if (typeof imageSource === "string") {
        if (imageSource.startsWith("data:")) {
            const parts = imageSource.split(",");
            return parts.length > 1 ? parts[1] : "";
        }
        const response = await fetch(imageSource, { credentials: "same-origin" });
        if (!response.ok) {
            throw new Error(`Could not load image (${response.status}).`);
        }
        const blob = await response.blob();
        const dataUrl = await blobToDataURL(blob);
        return dataUrl.split(",")[1];
    }
    if (imageSource instanceof Blob) {
        const dataUrl = await blobToDataURL(imageSource);
        return dataUrl.split(",")[1];
    }
    throw new Error("Unsupported image source.");
}

/**
 * @param {string|Blob} imageSource
 * @param {Function} rpc Odoo rpc(url, params)
 * @returns {Promise<string>} PNG data URL
 */
export async function removeBackgroundFromImage(imageSource, rpc) {
    if (typeof rpc !== "function") {
        throw new Error("RPC is required for background removal.");
    }
    const filedata = await imageSourceToBase64(imageSource);
    const result = await rpc("/canvas/remove_background", { filedata });
    if (result.error) {
        throw new Error(result.error);
    }
    if (result.image_datas) {
        return result.image_datas;
    }
    if (result.filedata) {
        return `data:image/png;base64,${result.filedata}`;
    }
    throw new Error("Background removal returned no image.");
}

export function preloadBackgroundRemoval() {
    return Promise.resolve();
}
