/** @odoo-module **/

import {
    DEFAULT_DISPLACEMENT_BLUR,
    DEFAULT_FOIL_METAL,
    DEFAULT_NORMAL_STRENGTH,
    DEFAULT_RELIEF_MM,
    REFERENCE_RELIEF_MM,
    FINISH_DEBOSS,
    FINISH_EMBOSS,
    FINISH_GLOSS,
    FINISH_SATIN,
    FINISH_VARNISH_MATTE,
    VARNISH_GLOSS,
    VARNISH_NONE,
    VARNISH_SATIN,
    ensureObjectFinishDefaults,
    getFoilMetalPreset,
    isEmbossFinish,
    isFoilFinish,
    isVarnishFinish,
    restoreFinishPreviewColorsOnCanvas,
} from "./finish_effects";
import { ensureObjectFinishUploadDefaults } from "../fabric/finish_upload_mixin";

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

/** Draw a customer-uploaded image (data URL) scaled into a canvas region. */
async function drawDataUrlInRect(ctx, dataUrl, left, top, width, height) {
    if (!dataUrl || !ctx) {
        return;
    }
    try {
        const img = await loadImage(dataUrl);
        ctx.drawImage(img, left, top, width, height);
    } catch (err) {
        console.warn("Could not load finish upload image for 3D bake:", err);
    }
}

/** Draw a customer-uploaded image at the object's bounding box on a bake map. */
async function drawObjectTextureFile(ctx, fabricCanvas, obj, destLeft, destTop, destW, destH, dataUrl) {
    if (!dataUrl || !ctx || !fabricCanvas || !obj) {
        return;
    }
    const canvasW = fabricCanvas.getWidth();
    const canvasH = fabricCanvas.getHeight();
    const rect = obj.getBoundingRect(true, true);
    if (!rect || rect.width < 1 || rect.height < 1) {
        return;
    }
    const relCropLeft = rect.left / canvasW;
    const relCropTop = rect.top / canvasH;
    const relCropW = rect.width / canvasW;
    const relCropH = rect.height / canvasH;
    const x = destLeft + relCropLeft * destW;
    const y = destTop + relCropTop * destH;
    const w = Math.max(1, relCropW * destW);
    const h = Math.max(1, relCropH * destH);
    try {
        const img = await loadImage(dataUrl);
        ctx.save();
        ctx.globalCompositeOperation = "lighten";
        ctx.drawImage(img, x, y, w, h);
        ctx.restore();
    } catch (err) {
        console.warn("Could not draw texture file on bake map:", err);
    }
}

/**
 * Spot varnish: layer silhouette ∩ uploaded mask luminance.
 * White/light = varnish on; dark = no varnish. Never draws printable ink.
 */
async function drawObjectVarnishSpotMask(
    ctx, fabricCanvas, obj, destLeft, destTop, destW, destH, dataUrl
) {
    if (!dataUrl || !ctx || !fabricCanvas || !obj) {
        return;
    }
    const off = document.createElement("canvas");
    off.width = ctx.canvas.width;
    off.height = ctx.canvas.height;
    const offCtx = off.getContext("2d");
    if (!offCtx) {
        return;
    }
    await drawObjectMask(
        offCtx,
        fabricCanvas,
        obj,
        destLeft,
        destTop,
        destW,
        destH,
        "varnish",
        REFERENCE_RELIEF_MM
    );

    const canvasW = fabricCanvas.getWidth();
    const canvasH = fabricCanvas.getHeight();
    const rect = obj.getBoundingRect(true, true);
    if (!rect || rect.width < 1 || rect.height < 1) {
        return;
    }
    const relCropLeft = rect.left / canvasW;
    const relCropTop = rect.top / canvasH;
    const relCropW = rect.width / canvasW;
    const relCropH = rect.height / canvasH;
    const x = destLeft + relCropLeft * destW;
    const y = destTop + relCropTop * destH;
    const w = Math.max(1, Math.round(relCropW * destW));
    const h = Math.max(1, Math.round(relCropH * destH));

    try {
        const img = await loadImage(dataUrl);
        const maskCan = document.createElement("canvas");
        maskCan.width = w;
        maskCan.height = h;
        const mctx = maskCan.getContext("2d");
        if (!mctx) {
            return;
        }
        mctx.drawImage(img, 0, 0, w, h);
        const id = mctx.getImageData(0, 0, w, h);
        const data = id.data;
        for (let i = 0; i < data.length; i += 4) {
            const lum = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
            const srcA = data[i + 3] / 255;
            const a = Math.round(Math.min(1, lum * srcA) * 255);
            data[i] = 255;
            data[i + 1] = 255;
            data[i + 2] = 255;
            data[i + 3] = a;
        }
        mctx.putImageData(id, 0, 0);

        offCtx.save();
        offCtx.globalCompositeOperation = "destination-in";
        offCtx.drawImage(maskCan, x, y, w, h);
        offCtx.restore();

        ctx.save();
        ctx.globalCompositeOperation = "source-over";
        ctx.drawImage(off, 0, 0);
        ctx.restore();
    } catch (err) {
        console.warn("Could not apply varnish spot mask:", err);
        // Fallback: varnish the whole layer silhouette.
        await drawObjectMask(
            ctx, fabricCanvas, obj, destLeft, destTop, destW, destH, "varnish", REFERENCE_RELIEF_MM
        );
    }
}

/**
 * Ink masks must snapshot only object pixels. Empty canvas sets an opaque
 * fabric backgroundColor, which would otherwise fill the crop with alpha.
 */
function snapshotFabricCrop(fabricCanvas, crop) {
    // Ink masks must contain object pixels only. Besides the opaque empty-canvas
    // backgroundColor, the canvas may carry a background texture image (e.g. wood)
    // which would otherwise fill the crop and emboss as a solid block.
    const bgColorBackup = fabricCanvas.backgroundColor;
    const bgImageBackup = fabricCanvas.backgroundImage;
    const overlayImageBackup = fabricCanvas.overlayImage;
    fabricCanvas.backgroundColor = null;
    fabricCanvas.backgroundImage = null;
    fabricCanvas.overlayImage = null;
    fabricCanvas.renderAll();
    try {
        return fabricCanvas.toDataURL({
            format: "png",
            left: crop.left,
            top: crop.top,
            width: crop.width,
            height: crop.height,
            multiplier: crop.multiplier ?? 3,
            enableRetinaScaling: false,
        });
    } catch (_e) {
        return null;
    } finally {
        fabricCanvas.backgroundColor = bgColorBackup;
        fabricCanvas.backgroundImage = bgImageBackup;
        fabricCanvas.overlayImage = overlayImageBackup;
        fabricCanvas.renderAll();
    }
}

function blurCanvas(sourceCanvas, radius = 1) {
    if (!sourceCanvas || sourceCanvas.width < 1 || sourceCanvas.height < 1) {
        const out = document.createElement("canvas");
        out.width = 1;
        out.height = 1;
        return out;
    }
    if (radius <= 0) {
        return sourceCanvas;
    }
    const out = document.createElement("canvas");
    out.width = sourceCanvas.width;
    out.height = sourceCanvas.height;
    const ctx = out.getContext("2d");
    ctx.filter = `blur(${radius}px)`;
    ctx.drawImage(sourceCanvas, 0, 0);
    return out;
}

function generateNormalMapFromHeight(heightCanvas, strength = DEFAULT_NORMAL_STRENGTH) {
    const w = heightCanvas.width;
    const h = heightCanvas.height;
    const src = heightCanvas.getContext("2d").getImageData(0, 0, w, h);
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const dst = out.getContext("2d").createImageData(w, h);
    const s = Math.max(0.12, strength) * 1.6;
    const heightThreshold = 10;

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const di = (y * w + x) * 4;
            const center = src.data[di];
            if (center < heightThreshold) {
                dst.data[di] = 128;
                dst.data[di + 1] = 128;
                dst.data[di + 2] = 255;
                dst.data[di + 3] = 255;
                continue;
            }
            const l = x > 0 ? src.data[di - 4] : center;
            const r = x < w - 1 ? src.data[di + 4] : center;
            const u = y > 0 ? src.data[di - w * 4] : center;
            const d = y < h - 1 ? src.data[di + w * 4] : center;
            let nx = (l - r) / 255 / s;
            let ny = (u - d) / 255 / s;
            let nz = 1.0;
            const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
            nx = nx / len;
            ny = ny / len;
            nz = nz / len;
            dst.data[di] = Math.round((nx * 0.5 + 0.5) * 255);
            dst.data[di + 1] = Math.round((ny * 0.5 + 0.5) * 255);
            dst.data[di + 2] = Math.round((nz * 0.5 + 0.5) * 255);
            dst.data[di + 3] = 255;
        }
    }
    out.getContext("2d").putImageData(dst, 0, 0);
    return out;
}

function canvasHasBrightContent(canvas, threshold = 12) {
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < data.length; i += 4) {
        if (data[i] > threshold) {
            return true;
        }
    }
    return false;
}

/**
 * Build silhouette alpha for emboss/varnish maps only.
 * Preserves product fabric tones — only removes obvious flat white backdrop.
 */
function buildAlphaMaskFromColorCanvas(colorCanvas) {
    const w = colorCanvas.width;
    const h = colorCanvas.height;
    const src = colorCanvas.getContext("2d").getImageData(0, 0, w, h);
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const dst = out.getContext("2d").createImageData(w, h);

    for (let i = 0; i < src.data.length; i += 4) {
        const r = src.data[i];
        const g = src.data[i + 1];
        const b = src.data[i + 2];
        const a = src.data[i + 3];

        let alpha = a;
        if (a >= 250) {
            const maxC = Math.max(r, g, b);
            const minC = Math.min(r, g, b);
            const saturation = maxC - minC;
            const brightness = (r + g + b) / 3;
            // Strict backdrop-only threshold — avoid clipping light product colors.
            if (brightness > 254 && saturation < 4) {
                alpha = 0;
            } else {
                alpha = 255;
            }
        }
        dst.data[i] = 255;
        dst.data[i + 1] = 255;
        dst.data[i + 2] = 255;
        dst.data[i + 3] = alpha;
    }
    out.getContext("2d").putImageData(dst, 0, 0);
    return out;
}

/** Zero displacement/varnish outside product silhouette to avoid white-edge puffing. */
function applyAlphaMaskToMap(mapCanvas, alphaCanvas) {
    const w = mapCanvas.width;
    const h = mapCanvas.height;
    const mapData = mapCanvas.getContext("2d").getImageData(0, 0, w, h);
    const alphaData = alphaCanvas.getContext("2d").getImageData(0, 0, w, h);
    for (let i = 0; i < mapData.data.length; i += 4) {
        const mask = alphaData.data[i + 3] / 255;
        if (mask < 0.05) {
            mapData.data[i] = 0;
            mapData.data[i + 1] = 0;
            mapData.data[i + 2] = 0;
            mapData.data[i + 3] = 255;
        } else if (mask < 1) {
            const v = Math.round(mapData.data[i] * mask);
            mapData.data[i] = v;
            mapData.data[i + 1] = v;
            mapData.data[i + 2] = v;
        }
    }
    mapCanvas.getContext("2d").putImageData(mapData, 0, 0);
    return mapCanvas;
}

function foilColorAt(preset, x, y) {
    if (!preset.iridescent) {
        return { r: preset.r, g: preset.g, b: preset.b };
    }
    const t = (x * 0.045 + y * 0.032) % 1;
    return {
        r: Math.round(165 + 90 * Math.sin(t * Math.PI * 2)),
        g: Math.round(165 + 90 * Math.sin(t * Math.PI * 2 + 2.09)),
        b: Math.round(175 + 80 * Math.sin(t * Math.PI * 2 + 4.18)),
    };
}

/**
 * Apply hot-foil stamping to the color composite and build metalness/roughness maps.
 * Foil replaces ink in masked areas (standard print workflow).
 */
function applyFoilToComposite(sourceCanvas, foilEntries, width, height) {
    const colorCanvas = document.createElement("canvas");
    colorCanvas.width = width;
    colorCanvas.height = height;
    colorCanvas.getContext("2d").drawImage(sourceCanvas, 0, 0);
    const colorData = colorCanvas.getContext("2d").getImageData(0, 0, width, height);

    const metalnessCanvas = document.createElement("canvas");
    metalnessCanvas.width = width;
    metalnessCanvas.height = height;
    const metalData = metalnessCanvas.getContext("2d").createImageData(width, height);

    const foilRoughnessCanvas = document.createElement("canvas");
    foilRoughnessCanvas.width = width;
    foilRoughnessCanvas.height = height;
    const roughCtx = foilRoughnessCanvas.getContext("2d");
    roughCtx.fillStyle = "#d9d9d9";
    roughCtx.fillRect(0, 0, width, height);
    const roughData = roughCtx.getImageData(0, 0, width, height);

    for (const entry of foilEntries) {
        const maskData = entry.maskCanvas.getContext("2d").getImageData(0, 0, width, height);
        const preset = getFoilMetalPreset(entry.metal);

        for (let i = 0; i < maskData.data.length; i += 4) {
            const mask = maskData.data[i] / 255;
            if (mask <= 0.03) {
                continue;
            }

            const px = (i / 4) % width;
            const py = Math.floor(i / 4 / width);
            const foilRgb = foilColorAt(preset, px, py);
            const blend = Math.min(1, mask * 1.05);

            colorData.data[i] = Math.round(foilRgb.r * blend + colorData.data[i] * (1 - blend));
            colorData.data[i + 1] = Math.round(foilRgb.g * blend + colorData.data[i + 1] * (1 - blend));
            colorData.data[i + 2] = Math.round(foilRgb.b * blend + colorData.data[i + 2] * (1 - blend));

            const metalVal = Math.round(Math.min(255, blend * 255));
            metalData.data[i] = metalVal;
            metalData.data[i + 1] = metalVal;
            metalData.data[i + 2] = metalVal;
            metalData.data[i + 3] = 255;

            const roughVal = Math.round(217 + (preset.roughness - 217) * blend);
            roughData.data[i] = roughVal;
            roughData.data[i + 1] = roughVal;
            roughData.data[i + 2] = roughVal;
            roughData.data[i + 3] = 255;
        }
    }

    colorCanvas.getContext("2d").putImageData(colorData, 0, 0);
    metalnessCanvas.getContext("2d").putImageData(metalData, 0, 0);
    foilRoughnessCanvas.getContext("2d").putImageData(roughData, 0, 0);

    return { colorCanvas, metalnessCanvas, foilRoughnessCanvas };
}

function mergeRoughnessMaps(baseCanvas, foilRoughCanvas, metalnessCanvas, width, height) {
    if (!foilRoughCanvas || !metalnessCanvas) {
        return baseCanvas;
    }
    if (!baseCanvas) {
        return foilRoughCanvas;
    }

    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    const outCtx = out.getContext("2d");
    outCtx.drawImage(baseCanvas, 0, 0);

    const baseData = outCtx.getImageData(0, 0, width, height);
    const foilData = foilRoughCanvas.getContext("2d").getImageData(0, 0, width, height);
    const metalData = metalnessCanvas.getContext("2d").getImageData(0, 0, width, height);

    for (let i = 0; i < baseData.data.length; i += 4) {
        const metal = metalData.data[i] / 255;
        if (metal <= 0.05) {
            continue;
        }
        const foilRough = foilData.data[i];
        const baseRough = baseData.data[i];
        const v = Math.round(baseRough + (foilRough - baseRough) * metal);
        baseData.data[i] = v;
        baseData.data[i + 1] = v;
        baseData.data[i + 2] = v;
    }
    outCtx.putImageData(baseData, 0, 0);
    return out;
}

async function buildObjectFoilMask(fab, obj, dest, bakeWidth, bakeHeight, globalReliefMm) {
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = bakeWidth;
    maskCanvas.height = bakeHeight;
    await drawObjectMask(
        maskCanvas.getContext("2d"),
        fab,
        obj,
        dest.left,
        dest.top,
        dest.width,
        dest.height,
        "foil",
        globalReliefMm
    );
    return maskCanvas;
}

function buildRoughnessMap(varnishCanvas, varnishType, width, height, alphaCanvas = null) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    // Matte substrate everywhere; only masked varnish regions become shiny.
    ctx.fillStyle = "#d9d9d9";
    ctx.fillRect(0, 0, width, height);

    if (!varnishCanvas || varnishType === VARNISH_NONE) {
        return canvas;
    }

    if (!canvasHasBrightContent(varnishCanvas)) {
        return canvas;
    }

    const temp = document.createElement("canvas");
    temp.width = width;
    temp.height = height;
    const tctx = temp.getContext("2d");
    tctx.drawImage(varnishCanvas, 0, 0, width, height);
    const data = tctx.getImageData(0, 0, width, height);

    let glossValue = 180;
    if (varnishType === VARNISH_GLOSS) {
        glossValue = 55;
    } else if (varnishType === VARNISH_SATIN) {
        glossValue = 110;
    }

    for (let i = 0; i < data.data.length; i += 4) {
        const mask = data.data[i] / 255;
        if (mask <= 0.01) {
            continue;
        }
        const base = 217;
        const v = Math.round(base + (glossValue - base) * mask);
        data.data[i] = v;
        data.data[i + 1] = v;
        data.data[i + 2] = v;
        data.data[i + 3] = 255;
    }
    ctx.putImageData(data, 0, 0);
    if (alphaCanvas) {
        applyAlphaMaskToMap(canvas, alphaCanvas);
    }
    return canvas;
}

/** White = clearcoat strength from varnish mask. */
function buildClearcoatCanvas(varnishCanvas, width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, width, height);
    if (!varnishCanvas || !canvasHasBrightContent(varnishCanvas)) {
        return canvas;
    }
    const src = varnishCanvas.getContext("2d").getImageData(0, 0, width, height);
    const dst = ctx.getImageData(0, 0, width, height);
    for (let i = 0; i < src.data.length; i += 4) {
        const v = Math.max(src.data[i], src.data[i + 1], src.data[i + 2]);
        dst.data[i] = v;
        dst.data[i + 1] = v;
        dst.data[i + 2] = v;
        dst.data[i + 3] = 255;
    }
    ctx.putImageData(dst, 0, 0);
    return canvas;
}

function resolveObjectVarnishType(obj) {
    ensureObjectFinishDefaults(obj);
    ensureObjectFinishUploadDefaults(obj);
    const printVarnish = obj.tusVarnishType;
    if (printVarnish && printVarnish !== VARNISH_NONE) {
        return printVarnish;
    }
    const effect = obj.tusFinishEffect;
    if (effect === FINISH_GLOSS) {
        return VARNISH_GLOSS;
    }
    if (effect === FINISH_SATIN || effect === FINISH_VARNISH_MATTE) {
        return VARNISH_SATIN;
    }
    if (isVarnishFinish(effect)) {
        return VARNISH_GLOSS;
    }
    return VARNISH_NONE;
}

function preferVarnishType(current, next) {
    if (!next || next === VARNISH_NONE) {
        return current;
    }
    if (!current || current === VARNISH_NONE) {
        return next;
    }
    if (current === VARNISH_GLOSS || next === VARNISH_GLOSS) {
        return VARNISH_GLOSS;
    }
    return next;
}

/** OR white varnish wherever the product alpha is opaque. */
function floodVarnishFromAlpha(varCtx, alphaCanvas) {
    if (!varCtx || !alphaCanvas) {
        return;
    }
    const w = alphaCanvas.width;
    const h = alphaCanvas.height;
    const src = alphaCanvas.getContext("2d").getImageData(0, 0, w, h);
    const dst = varCtx.getImageData(0, 0, w, h);
    for (let i = 0; i < src.data.length; i += 4) {
        if (src.data[i + 3] < 16) {
            continue;
        }
        dst.data[i] = 255;
        dst.data[i + 1] = 255;
        dst.data[i + 2] = 255;
        dst.data[i + 3] = 255;
    }
    varCtx.putImageData(dst, 0, 0);
}

/**
 * Estimate the dominant background color of a rasterised layer by averaging the
 * opaque pixels around the outer border of the crop. Returns null when the
 * border is mostly transparent (e.g. a clipart/vector shape) so callers keep
 * embossing by silhouette instead.
 */
function estimateBorderBackgroundColor(imgData) {
    const { width: w, height: h, data } = imgData;
    if (w < 3 || h < 3) {
        return null;
    }
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    let opaque = 0;
    let sampled = 0;
    const sample = (x, y) => {
        const idx = (y * w + x) * 4;
        sampled += 1;
        if (data[idx + 3] < 128) {
            return;
        }
        opaque += 1;
        rSum += data[idx];
        gSum += data[idx + 1];
        bSum += data[idx + 2];
    };
    for (let x = 0; x < w; x++) {
        sample(x, 0);
        sample(x, h - 1);
    }
    for (let y = 1; y < h - 1; y++) {
        sample(0, y);
        sample(w - 1, y);
    }
    // Border must be mostly opaque to be treated as a solid photo background.
    if (!sampled || opaque / sampled < 0.6) {
        return null;
    }
    return { r: rSum / opaque, g: gSum / opaque, b: bSum / opaque };
}

function buildInkMaskImageData(imgData, obj, mode, reliefFactor = 1) {
    const scratch = document.createElement("canvas");
    scratch.width = imgData.width;
    scratch.height = imgData.height;
    const out = scratch.getContext("2d").createImageData(imgData.width, imgData.height);
    const isImageLike = obj.type === "image" || obj.type === "group";
    // For opaque photos, treat a near-uniform border color as the background so
    // only the meaningful subject is raised (no rectangular relief block).
    const bgColor =
        isImageLike && mode !== "foil" ? estimateBorderBackgroundColor(imgData) : null;
    const BG_DISTANCE = 46;

    for (let i = 0; i < imgData.data.length; i += 4) {
        const r = imgData.data[i];
        const g = imgData.data[i + 1];
        const b = imgData.data[i + 2];
        const a = imgData.data[i + 3];
        let alpha = a / 255;
        if (alpha <= 0.02) {
            continue;
        }

        let shape = alpha;
        if (isImageLike) {
            const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
            const maxC = Math.max(r, g, b);
            const minC = Math.min(r, g, b);
            const sat = (maxC - minC) / 255;
            if (lum > 0.92 && sat < 0.1) {
                continue;
            }
            if (bgColor) {
                const dr = r - bgColor.r;
                const dg = g - bgColor.g;
                const db = b - bgColor.b;
                if (Math.sqrt(dr * dr + dg * dg + db * db) < BG_DISTANCE) {
                    continue;
                }
            }
            shape = alpha;
        } else if (
            obj.type === "i-text" ||
            obj.type === "text" ||
            obj.type === "textbox" ||
            obj.type === "path"
        ) {
            shape = Math.min(1, alpha * 1.25);
        }

        let value;
        if (mode === "deboss") {
            value = Math.round((1 - shape * 0.92) * 255);
        } else if (mode === "emboss") {
            value = Math.round(Math.min(255, shape * 255 * reliefFactor));
        } else {
            value = Math.round(shape * 255);
        }
        out.data[i] = value;
        out.data[i + 1] = value;
        out.data[i + 2] = value;
        out.data[i + 3] = 255;
    }
    return out;
}

/**
 * Snapshot a single Fabric object and build a 2D foil preview (same ink mask as 3D baker).
 */
export async function buildInkFoilPreviewForObject(fabricCanvas, obj, metal = DEFAULT_FOIL_METAL) {
    ensureObjectFinishDefaults(obj);
    if (typeof fabric === "undefined" || !fabricCanvas || !obj) {
        return null;
    }

    const canvasW = fabricCanvas.getWidth();
    const canvasH = fabricCanvas.getHeight();
    const rect = obj.getBoundingRect(true, true);
    if (!rect || !isFinite(rect.width) || rect.width < 1 || rect.height < 1) {
        return null;
    }

    const pad = 6;
    const cropLeft = Math.max(0, rect.left - pad);
    const cropTop = Math.max(0, rect.top - pad);
    const cropW = Math.min(canvasW - cropLeft, rect.width + pad * 2);
    const cropH = Math.min(canvasH - cropTop, rect.height + pad * 2);
    if (cropW < 1 || cropH < 1) {
        return null;
    }

    const visibility = new Map();
    fabricCanvas.getObjects().forEach((o) => {
        visibility.set(o, o.visible);
        o.set("visible", o === obj || (o._tusFoilPreviewOverlay && o.tusFoilPreviewTargetId === obj.id));
    });
    fabricCanvas.discardActiveObject();
    fabricCanvas.renderAll();

    let snapshot = null;
    try {
        snapshot = snapshotFabricCrop(fabricCanvas, {
            left: cropLeft,
            top: cropTop,
            width: cropW,
            height: cropH,
            multiplier: 3,
        });
    } finally {
        visibility.forEach((vis, o) => o.set("visible", vis));
        fabricCanvas.requestRenderAll();
    }
    if (!snapshot) {
        return null;
    }

    const snapImg = await loadImage(snapshot);
    const colorCanvas = document.createElement("canvas");
    colorCanvas.width = snapImg.width;
    colorCanvas.height = snapImg.height;
    colorCanvas.getContext("2d").drawImage(snapImg, 0, 0);
    const imgData = colorCanvas.getContext("2d").getImageData(0, 0, colorCanvas.width, colorCanvas.height);

    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = colorCanvas.width;
    maskCanvas.height = colorCanvas.height;
    maskCanvas
        .getContext("2d")
        .putImageData(buildInkMaskImageData(imgData, obj, "foil"), 0, 0);

    const foilMaps = applyFoilToComposite(
        colorCanvas,
        [{ maskCanvas, metal: metal || DEFAULT_FOIL_METAL }],
        colorCanvas.width,
        colorCanvas.height
    );

    return {
        canvas: foilMaps.colorCanvas,
        left: cropLeft,
        top: cropTop,
        width: cropW,
        height: cropH,
    };
}

async function drawObjectMask(ctx, fabricCanvas, obj, destLeft, destTop, destW, destH, mode, globalReliefMm) {
    ensureObjectFinishDefaults(obj);
    if (typeof fabric === "undefined") {
        return;
    }

    const reliefFactor = Math.min(
        5,
        Math.max(0.5, (obj.tusReliefMm || REFERENCE_RELIEF_MM) / REFERENCE_RELIEF_MM)
            * Math.min(2.5, (globalReliefMm || REFERENCE_RELIEF_MM) / REFERENCE_RELIEF_MM)
    );

    const canvasW = fabricCanvas.getWidth();
    const canvasH = fabricCanvas.getHeight();
    const rect = obj.getBoundingRect(true, true);
    if (!rect || !isFinite(rect.width) || rect.width < 1 || rect.height < 1) {
        return;
    }

    const pad = 6;
    const cropLeft = Math.max(0, rect.left - pad);
    const cropTop = Math.max(0, rect.top - pad);
    const cropW = Math.min(canvasW - cropLeft, rect.width + pad * 2);
    const cropH = Math.min(canvasH - cropTop, rect.height + pad * 2);
    if (cropW < 1 || cropH < 1) {
        return;
    }

    const visibility = new Map();
    fabricCanvas.getObjects().forEach((o) => {
        visibility.set(o, { visible: o.visible, opacity: o.opacity });
        if (o === obj) {
            o.set("visible", true);
            if (o._tusFoilHiddenForPreview) {
                o.set({ opacity: o._tusFoilOpacityBackup ?? 1 });
            }
        } else {
            o.set("visible", false);
        }
    });
    fabricCanvas.discardActiveObject();
    fabricCanvas.renderAll();

    let snapshot = null;
    try {
        snapshot = snapshotFabricCrop(fabricCanvas, {
            left: cropLeft,
            top: cropTop,
            width: cropW,
            height: cropH,
            multiplier: 3,
        });
    } finally {
        visibility.forEach((state, o) => {
            o.set({ visible: state.visible, opacity: state.opacity });
        });
        fabricCanvas.requestRenderAll();
    }
    if (!snapshot) {
        return;
    }

    const snapImg = await loadImage(snapshot);
    const tmp = document.createElement("canvas");
    tmp.width = snapImg.width;
    tmp.height = snapImg.height;
    tmp.getContext("2d").drawImage(snapImg, 0, 0);
    const imgData = tmp.getContext("2d").getImageData(0, 0, tmp.width, tmp.height);

    const relCropLeft = cropLeft / canvasW;
    const relCropTop = cropTop / canvasH;
    const relCropW = cropW / canvasW;
    const relCropH = cropH / canvasH;
    const x = destLeft + relCropLeft * destW;
    const y = destTop + relCropTop * destH;
    const w = Math.max(1, relCropW * destW);
    const h = Math.max(1, relCropH * destH);

    const mask = document.createElement("canvas");
    mask.width = tmp.width;
    mask.height = tmp.height;
    mask.getContext("2d").putImageData(buildInkMaskImageData(imgData, obj, mode, reliefFactor), 0, 0);

    ctx.save();
    ctx.globalCompositeOperation = mode === "emboss" ? "lighten" : "source-over";
    ctx.drawImage(mask, x, y, w, h);
    ctx.restore();
}

function computeEntryDest(entry, img, imgRect, naturalWidth, naturalHeight, cachedLayout) {
    const fab = entry.canvas;
    const wrapper = entry.wrapper;
    if (!fab || !wrapper) {
        return null;
    }
    const displayWidth = imgRect.width || cachedLayout?.imgDisplayW || naturalWidth;
    const displayHeight = imgRect.height || cachedLayout?.imgDisplayH || naturalHeight;
    if (displayWidth < 1 || displayHeight < 1) {
        return null;
    }
    const scaleX = naturalWidth / displayWidth;
    const scaleY = naturalHeight / displayHeight;
    const wRect = wrapper.getBoundingClientRect();
    if (wRect.width >= 1 && wRect.height >= 1 && imgRect.width >= 1) {
        return {
            left: (wRect.left - imgRect.left) * scaleX,
            top: (wRect.top - imgRect.top) * scaleY,
            width: wRect.width * scaleX,
            height: wRect.height * scaleY,
        };
    }
    const layout = entry.layout || cachedLayout;
    if (!layout || layout.imgDisplayW <= 0) {
        return null;
    }
    const leftCSS = parseFloat(wrapper.style.left);
    const topCSS = parseFloat(wrapper.style.top);
    const widthCSS = parseFloat(wrapper.style.width) || wrapper.offsetWidth;
    const heightCSS = parseFloat(wrapper.style.height) || wrapper.offsetHeight;
    if (!Number.isFinite(leftCSS) || !Number.isFinite(topCSS)) {
        return null;
    }
    const relLeft = leftCSS - (layout.offsetX || 0);
    const relTop = topCSS - (layout.offsetY || 0);
    const cachedScaleX = naturalWidth / layout.imgDisplayW;
    const cachedScaleY = naturalHeight / layout.imgDisplayH;
    return {
        left: relLeft * cachedScaleX,
        top: relTop * cachedScaleY,
        width: widthCSS * cachedScaleX,
        height: heightCSS * cachedScaleY,
    };
}

export async function bakeMapsForSide(editor, side, options = {}) {
    // Legacy option: only used if something still passes a true global coat.
    // Layer varnish is never promoted via globalVarnish from the 3D refresh path.
    const globalVarnish = options.globalVarnish || VARNISH_NONE;
    const globalReliefMm = options.reliefMm ?? DEFAULT_RELIEF_MM;
    const displacementBlur = options.displacementBlur ?? DEFAULT_DISPLACEMENT_BLUR;
    const normalStrength = options.normalStrength ?? DEFAULT_NORMAL_STRENGTH;

    const root = document.getElementById(`${side}_canvas`);
    if (!root) {
        return null;
    }

    const entries = (editor.canvasesBySide[side] || []).slice();
    if (!entries.length) {
        return null;
    }

    const isEmptyCanvas = Boolean(editor.emptyCanvasMode);
    const cachedLayout = entries.find((e) => e.layout?.imgDisplayW > 0)?.layout || entries[0]?.layout;
    let img = null;
    let naturalWidth;
    let naturalHeight;
    let imgRect = { left: 0, top: 0, width: 0, height: 0 };

    if (isEmptyCanvas) {
        naturalWidth = cachedLayout?.stageW || cachedLayout?.canvasW || 394;
        naturalHeight = cachedLayout?.stageH || cachedLayout?.canvasH || 394;
    } else {
        img = root.querySelector("img.main_canvas_img") || root.querySelector("img.thumbnail_img");
        if (!img) {
            return null;
        }
        await editor._ensureImageLoaded(img);
        naturalWidth = img.naturalWidth || img.width || 1024;
        naturalHeight = img.naturalHeight || img.height || 1024;
        imgRect = img.getBoundingClientRect();
    }

    const exportMaxSize = options.maxSize || Math.max(naturalWidth, naturalHeight, 2048);
    const fabricCanvases = entries.map((e) => e.canvas).filter(Boolean);

    for (const fab of fabricCanvases) {
        restoreFinishPreviewColorsOnCanvas(fab);
    }

    try {
        const colorCanvas = await editor._exportSideCompositeCore(side, {
            format: "png",
            quality: 1,
            returnCanvas: true,
            maxSize: exportMaxSize,
        });
        if (!colorCanvas || colorCanvas.width < 1 || colorCanvas.height < 1) {
            return null;
        }

        const bakeWidth = colorCanvas.width;
        const bakeHeight = colorCanvas.height;
        const emptyCanvasDest = {
            left: 0,
            top: 0,
            width: bakeWidth,
            height: bakeHeight,
        };

        const displacementCanvas = document.createElement("canvas");
    displacementCanvas.width = bakeWidth;
    displacementCanvas.height = bakeHeight;
    const dispCtx = displacementCanvas.getContext("2d");
    dispCtx.fillStyle = "#000000";
    dispCtx.fillRect(0, 0, bakeWidth, bakeHeight);

    const varnishCanvas = document.createElement("canvas");
    varnishCanvas.width = bakeWidth;
    varnishCanvas.height = bakeHeight;
    const varCtx = varnishCanvas.getContext("2d");
    varCtx.fillStyle = "#000000";
    varCtx.fillRect(0, 0, bakeWidth, bakeHeight);

    const foilMaskEntries = [];
    let primaryVarnishType = VARNISH_NONE;
    let maxReliefMm = 0;

    for (const entry of entries) {
        const fab = entry.canvas;
        if (!fab) {
            continue;
        }
        const dest = isEmptyCanvas
            ? emptyCanvasDest
            : computeEntryDest(entry, img, imgRect, bakeWidth, bakeHeight, cachedLayout);
        if (!dest) {
            continue;
        }
        const objects = fab.getObjects().filter((obj) => !obj.center_line && !obj.extra_elem);
        for (const obj of objects) {
            ensureObjectFinishDefaults(obj);
            ensureObjectFinishUploadDefaults(obj);

            if (obj.tusTextureActive) {
                const textureRelief =
                    parseFloat(obj.tusTextureIntensityMm) > 0
                        ? parseFloat(obj.tusTextureIntensityMm)
                        : REFERENCE_RELIEF_MM;
                maxReliefMm = Math.max(maxReliefMm, textureRelief);
                if (obj.tusTextureFile) {
                    await drawObjectTextureFile(
                        dispCtx,
                        fab,
                        obj,
                        dest.left,
                        dest.top,
                        dest.width,
                        dest.height,
                        obj.tusTextureFile
                    );
                } else {
                    await drawObjectMask(
                        dispCtx,
                        fab,
                        obj,
                        dest.left,
                        dest.top,
                        dest.width,
                        dest.height,
                        "emboss",
                        textureRelief
                    );
                }
            }

            const effect = obj.tusFinishEffect;
            if (isEmbossFinish(effect)) {
                const embossRelief =
                    Number(obj.tusReliefMm) > 0 ? Number(obj.tusReliefMm) : REFERENCE_RELIEF_MM;
                maxReliefMm = Math.max(maxReliefMm, embossRelief);
                await drawObjectMask(
                    dispCtx,
                    fab,
                    obj,
                    dest.left,
                    dest.top,
                    dest.width,
                    dest.height,
                    effect === FINISH_DEBOSS ? "deboss" : "emboss",
                    embossRelief
                );
            }
            if (isFoilFinish(effect)) {
                const maskCanvas = await buildObjectFoilMask(
                    fab,
                    obj,
                    dest,
                    bakeWidth,
                    bakeHeight,
                    maxReliefMm || REFERENCE_RELIEF_MM
                );
                foilMaskEntries.push({
                    maskCanvas,
                    metal: obj.tusFoilMetal || DEFAULT_FOIL_METAL,
                });
            }

            // Only coat objects that explicitly have print varnish / gloss|satin finish.
            // Do NOT apply options.globalVarnish to every object (that flooded the sheet).
            const varnishType = resolveObjectVarnishType(obj);
            primaryVarnishType = preferVarnishType(primaryVarnishType, varnishType);
            if (varnishType !== VARNISH_NONE) {
                const cover = obj.tusVarnishCoverMode || "all";
                if (cover === "by_file" && obj.tusVarnishAreaFile) {
                    await drawObjectVarnishSpotMask(
                        varCtx, fab, obj, dest.left, dest.top, dest.width, dest.height, obj.tusVarnishAreaFile
                    );
                } else {
                    // "all" and "zones" (production note): varnish the layer silhouette.
                    await drawObjectMask(
                        varCtx,
                        fab,
                        obj,
                        dest.left,
                        dest.top,
                        dest.width,
                        dest.height,
                        "varnish",
                        REFERENCE_RELIEF_MM
                    );
                }
            }
        }
    }

    const blurredDisp =
        displacementBlur > 0 ? blurCanvas(displacementCanvas, displacementBlur) : displacementCanvas;

    const alphaCanvas = buildAlphaMaskFromColorCanvas(colorCanvas);
    applyAlphaMaskToMap(blurredDisp, alphaCanvas);

    // Legacy full-sheet coat only when an explicit globalVarnish is passed.
    // Empty-canvas sheets are the printable area themselves — flood the full bake.
    if (globalVarnish && globalVarnish !== VARNISH_NONE) {
        varCtx.globalCompositeOperation = "source-over";
        varCtx.fillStyle = "#ffffff";
        if (isEmptyCanvas) {
            varCtx.fillRect(0, 0, bakeWidth, bakeHeight);
        } else {
            floodVarnishFromAlpha(varCtx, alphaCanvas);
        }
        primaryVarnishType = preferVarnishType(primaryVarnishType, globalVarnish);
    }

    applyAlphaMaskToMap(varnishCanvas, alphaCanvas);

    const hasFoil = foilMaskEntries.length > 0;
    let bakedColorCanvas = colorCanvas;
    let foilMetalnessCanvas = null;
    let foilRoughnessCanvas = null;

    if (hasFoil) {
        const foilMaps = applyFoilToComposite(colorCanvas, foilMaskEntries, bakeWidth, bakeHeight);
        bakedColorCanvas = foilMaps.colorCanvas;
        foilMetalnessCanvas = foilMaps.metalnessCanvas;
        foilRoughnessCanvas = foilMaps.foilRoughnessCanvas;
        applyAlphaMaskToMap(foilMetalnessCanvas, alphaCanvas);
        applyAlphaMaskToMap(foilRoughnessCanvas, alphaCanvas);
    }

    const hasEmboss = canvasHasBrightContent(blurredDisp);
    const hasVarnish = canvasHasBrightContent(varnishCanvas);
    if (!hasVarnish) {
        primaryVarnishType = VARNISH_NONE;
    }
    if (hasEmboss && !(maxReliefMm > 0)) {
        maxReliefMm = REFERENCE_RELIEF_MM;
    }
    if (!hasEmboss) {
        maxReliefMm = 0;
    }

    const clearcoatCanvas = hasVarnish
        ? buildClearcoatCanvas(varnishCanvas, bakeWidth, bakeHeight)
        : null;

    const normalCanvas = hasEmboss
        ? generateNormalMapFromHeight(blurredDisp, normalStrength)
        : null;
    let roughnessCanvas = hasVarnish
        ? buildRoughnessMap(varnishCanvas, primaryVarnishType, bakeWidth, bakeHeight, alphaCanvas)
        : null;
    if (hasFoil) {
        roughnessCanvas = mergeRoughnessMaps(
            roughnessCanvas,
            foilRoughnessCanvas,
            foilMetalnessCanvas,
            bakeWidth,
            bakeHeight
        );
        if (roughnessCanvas) {
            applyAlphaMaskToMap(roughnessCanvas, alphaCanvas);
        }
    } else if (roughnessCanvas) {
        applyAlphaMaskToMap(roughnessCanvas, alphaCanvas);
    }

    let widthMm = options.widthMm || bakeWidth / 10;
    let heightMm = options.heightMm || bakeHeight / 10;
    const sideCanvases = editor.canvasesBySide[side] || [];
    if (sideCanvases.length) {
        const areaDef = editor._findAreaDef(side, sideCanvases[0].id);
        if (areaDef) {
            const actual = editor._computeAreaActualForSave(
                areaDef,
                sideCanvases[0].canvas.getWidth(),
                sideCanvases[0].canvas.getHeight()
            );
            if (actual?.width) {
                widthMm = actual.width;
            }
            if (actual?.height) {
                heightMm = actual.height;
            }
        }
    }

    const maps = {
        colorDataUrl: bakedColorCanvas.toDataURL("image/png"),
        colorCanvas: bakedColorCanvas,
        alphaCanvas,
        displacementCanvas: blurredDisp,
        varnishCanvas,
        clearcoatCanvas,
        foilMetalnessCanvas,
        normalCanvas: normalCanvas || blurredDisp,
        roughnessCanvas: roughnessCanvas || foilRoughnessCanvas || blurredDisp,
        hasEmboss,
        hasVarnish,
        hasFoil,
        primaryVarnishType,
        maxReliefMm,
        widthMm,
        heightMm,
        aspect: bakeWidth / bakeHeight,
    };

        return maps;
    } finally {
        for (const fab of fabricCanvases) {
            fab.requestRenderAll();
        }
    }
}

export async function dataUrlToTexture(THREE, dataUrl, renderer) {
    const img = await loadImage(dataUrl);
    const tex = new THREE.Texture(img);
    tex.encoding = THREE.sRGBEncoding;
    tex.flipY = true;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    if (renderer?.capabilities) {
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    }
    tex.needsUpdate = true;
    return tex;
}

export function canvasToTexture(THREE, canvas, options = {}) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.flipY = options.flipY !== false;
    tex.generateMipmaps = options.generateMipmaps !== false;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = options.anisotropy || 1;
    if (options.colorSpace === "srgb" && THREE.sRGBEncoding !== undefined) {
        tex.encoding = THREE.sRGBEncoding;
    } else if (options.colorSpace === "linear" && THREE.LinearEncoding !== undefined) {
        tex.encoding = THREE.LinearEncoding;
    }
    tex.needsUpdate = true;
    return tex;
}

