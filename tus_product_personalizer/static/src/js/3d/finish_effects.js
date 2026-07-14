/** @odoo-module **/

export const FINISH_NONE = "none";
export const FINISH_EMBOSS = "emboss";
export const FINISH_DEBOSS = "deboss";
export const FINISH_GLOSS = "gloss";
export const FINISH_SATIN = "satin";
export const FINISH_VARNISH_MATTE = "varnish_matte";
/** Flat hot-foil stamping (spot metallic foil). */
export const FINISH_FOIL = "foil";
/** Registered foil emboss — raised die + metallic foil (common on cards/packaging). */
export const FINISH_FOIL_EMBOSS = "foil_emboss";

export const VARNISH_NONE = "none";
export const VARNISH_GLOSS = "gloss";
export const VARNISH_SATIN = "satin";

/** Global 3D preview varnish choices (None / Gloss / Satin). */
export const VARNISH_OPTIONS = [
    { value: VARNISH_NONE, label: "None" },
    { value: VARNISH_GLOSS, label: "Gloss" },
    { value: VARNISH_SATIN, label: "Satin" },
];

export const FOIL_GOLD = "gold";
export const FOIL_SILVER = "silver";
export const FOIL_COPPER = "copper";
export const FOIL_ROSE_GOLD = "rose_gold";
export const FOIL_HOLOGRAPHIC = "holographic";
export const DEFAULT_FOIL_METAL = FOIL_GOLD;

/** 0 means no emboss selected; only persist a positive depth when emboss is on. */
export const DEFAULT_RELIEF_MM = 0;
/** Reference depth for 3D emboss preview normalization (must stay > 0). */
export const REFERENCE_RELIEF_MM = 0.6;
export const MAX_RELIEF_MM = 5;
export const DEFAULT_NORMAL_STRENGTH = 4.5;
export const DEFAULT_DISPLACEMENT_BLUR = 0.35;
/** Scene-units multiplier per mm of relief (tuned for visible emboss on flat products). */
export const RELIEF_DISPLACEMENT_FACTOR = 0.028;

/** Industry-standard hot foil stamp colors (Pantone-like targets for 3D preview). */
const FOIL_METAL_PRESETS = {
    [FOIL_GOLD]: { r: 212, g: 175, b: 55, roughness: 26, iridescent: false },
    [FOIL_SILVER]: { r: 198, g: 200, b: 205, roughness: 18, iridescent: false },
    [FOIL_COPPER]: { r: 184, g: 115, b: 51, roughness: 30, iridescent: false },
    [FOIL_ROSE_GOLD]: { r: 183, g: 110, b: 121, roughness: 28, iridescent: false },
    [FOIL_HOLOGRAPHIC]: { r: 195, g: 198, b: 210, roughness: 14, iridescent: true },
};

export function getFoilMetalPreset(metal) {
    return FOIL_METAL_PRESETS[metal] || FOIL_METAL_PRESETS[DEFAULT_FOIL_METAL];
}

export function ensureObjectFinishDefaults(obj) {
    if (!obj || obj.center_line || obj.extra_elem) {
        return;
    }
    if (obj.tusFinishEffect === undefined) {
        obj.tusFinishEffect = FINISH_NONE;
    }
    if (obj.tusReliefMm === undefined) {
        obj.tusReliefMm = DEFAULT_RELIEF_MM;
    }
    if (obj.tusVarnishType === undefined) {
        obj.tusVarnishType = VARNISH_NONE;
    }
}

export function isEmbossFinish(effect) {
    return (
        effect === FINISH_EMBOSS ||
        effect === FINISH_DEBOSS ||
        effect === FINISH_FOIL_EMBOSS
    );
}

export function isFoilFinish(effect) {
    return effect === FINISH_FOIL || effect === FINISH_FOIL_EMBOSS;
}

export function isVarnishFinish(effect) {
    return (
        effect === FINISH_GLOSS ||
        effect === FINISH_SATIN ||
        effect === FINISH_VARNISH_MATTE
    );
}

export function getEffectiveVarnishType(obj, globalVarnish) {
    if (isFoilFinish(obj.tusFinishEffect)) {
        return VARNISH_NONE;
    }
    if (obj.tusVarnishType && obj.tusVarnishType !== VARNISH_NONE) {
        return obj.tusVarnishType;
    }
    const effect = obj.tusFinishEffect || FINISH_NONE;
    if (effect === FINISH_GLOSS) {
        return VARNISH_GLOSS;
    }
    if (effect === FINISH_SATIN) {
        return VARNISH_SATIN;
    }
    return globalVarnish || VARNISH_NONE;
}

export function serializeFinishFields(obj) {
    ensureObjectFinishDefaults(obj);
    const effect = obj.tusFinishEffect || FINISH_NONE;
    let reliefMm = 0;
    if (isEmbossFinish(effect)) {
        const stored = Number(obj.tusReliefMm);
        reliefMm = Number.isFinite(stored) && stored > 0 ? stored : REFERENCE_RELIEF_MM;
    }
    const payload = {
        tusFinishEffect: effect,
        tusReliefMm: reliefMm,
        tusVarnishType: obj.tusVarnishType || VARNISH_NONE,
    };
    if (isFoilFinish(effect)) {
        payload.tusFoilMetal = obj.tusFoilMetal || DEFAULT_FOIL_METAL;
    }
    return payload;
}

export function applyFinishFields(obj, data) {
    if (!obj || !data) {
        return;
    }
    if (data.tusFinishEffect !== undefined) {
        obj.tusFinishEffect = data.tusFinishEffect;
        if (!isFoilFinish(data.tusFinishEffect)) {
            delete obj.tusFoilMetal;
        }
    }
    if (data.tusReliefMm !== undefined) {
        obj.tusReliefMm = data.tusReliefMm;
    }
    if (data.tusVarnishType !== undefined) {
        obj.tusVarnishType = data.tusVarnishType;
    }
    if (data.tusFoilMetal !== undefined) {
        if (data.tusFoilMetal) {
            obj.tusFoilMetal = data.tusFoilMetal;
        } else {
            delete obj.tusFoilMetal;
        }
    }
    ensureObjectFinishDefaults(obj);
    const children = typeof obj.getObjects === "function" ? obj.getObjects() : null;
    if (children?.length) {
        for (const child of children) {
            applyFinishFields(child, data);
        }
    }
}

function _resolveFinishFromObject(obj) {
    let effect = obj.tusFinishEffect || FINISH_NONE;
    let reliefMm = obj.tusReliefMm;
    let varnishType = obj.tusVarnishType;
    let foilMetal = obj.tusFoilMetal;
    let parent = obj.group;
    while (parent && effect === FINISH_NONE) {
        if (parent.tusFinishEffect && parent.tusFinishEffect !== FINISH_NONE) {
            effect = parent.tusFinishEffect;
            reliefMm = reliefMm ?? parent.tusReliefMm;
            varnishType = varnishType || parent.tusVarnishType;
            foilMetal = foilMetal || parent.tusFoilMetal;
            break;
        }
        parent = parent.group;
    }
    return { effect, reliefMm, varnishType, foilMetal };
}

export function getPBRSettings(globalSettings = {}) {
    const varnish = globalSettings.varnishType || VARNISH_NONE;
    const reliefMm = globalSettings.reliefMm ?? DEFAULT_RELIEF_MM;
    const normalStrength = globalSettings.normalStrength ?? DEFAULT_NORMAL_STRENGTH;
    const settings = {
        reliefMm,
        normalStrength,
        displacementBlur: globalSettings.displacementBlur ?? DEFAULT_DISPLACEMENT_BLUR,
        baseRoughness: 1.0,
        clearcoat: 0,
        clearcoatRoughness: 0.2,
        /** r128 MeshPhysicalMaterial.sheen is a Color, not a float — flag only. */
        useSheenColor: false,
        hasFoil: !!globalSettings.hasFoil,
        foilMetalness: globalSettings.hasFoil ? 1.0 : 0.0,
        foilEmissiveIntensity: globalSettings.hasFoil ? 0.12 : 0.5,
    };
    if (varnish === VARNISH_GLOSS) {
        settings.baseRoughness = 0.45;
        settings.clearcoat = 0.9;
        settings.clearcoatRoughness = 0.06;
    } else if (varnish === VARNISH_SATIN) {
        settings.baseRoughness = 0.58;
        settings.clearcoat = 0.55;
        settings.clearcoatRoughness = 0.28;
        settings.useSheenColor = true;
    }
    return settings;
}

export function reliefMmToDisplacementScale(reliefMm) {
    return (reliefMm ?? DEFAULT_RELIEF_MM) * RELIEF_DISPLACEMENT_FACTOR;
}

export function getFoilCssColor(metal) {
    const preset = getFoilMetalPreset(metal);
    return `rgb(${preset.r}, ${preset.g}, ${preset.b})`;
}

function _getFabric() {
    return globalThis.fabric;
}

function _getFoilPreviewRoot(obj) {
    let root = obj;
    while (root?.group) {
        root = root.group;
    }
    return root;
}

function _usesFoilRasterPreview(obj) {
    if (!obj) {
        return false;
    }
    if (obj.type === "image") {
        return true;
    }
    return obj.type === "group" && !!obj.isEmbeddedPhotoSvg;
}

function _removeFoilRasterOverlaySync(obj) {
    if (!obj) {
        return;
    }
    const canvas = obj.canvas;
    const overlay = obj._tusFoilPreviewOverlay;
    if (overlay && canvas) {
        canvas.remove(overlay);
        delete obj._tusFoilPreviewOverlay;
    }
    if (obj._tusFoilHiddenForPreview) {
        obj.set({ opacity: obj._tusFoilOpacityBackup ?? 1 });
        delete obj._tusFoilHiddenForPreview;
        delete obj._tusFoilOpacityBackup;
    }
}

async function _applyFoilRasterOverlay(obj) {
    const canvas = obj?.canvas;
    if (!canvas) {
        return false;
    }
    const restoreOpacity = obj._tusFoilHiddenForPreview;
    if (restoreOpacity) {
        obj.set({ opacity: obj._tusFoilOpacityBackup ?? 1 });
        canvas.requestRenderAll();
    }
    const { buildInkFoilPreviewForObject } = await import("./texture_baker");
    const baked = await buildInkFoilPreviewForObject(
        canvas,
        obj,
        obj.tusFoilMetal || DEFAULT_FOIL_METAL
    );
    if (restoreOpacity) {
        obj.set({ opacity: 0 });
    }
    if (!baked?.canvas) {
        return false;
    }

    _removeFoilRasterOverlaySync(obj);

    const fabricRef = _getFabric();
    if (!fabricRef?.Image?.fromURL) {
        return false;
    }

    const dataUrl = baked.canvas.toDataURL("image/png");
    return new Promise((resolve) => {
        fabricRef.Image.fromURL(
            dataUrl,
            (img) => {
                if (!img) {
                    resolve(false);
                    return;
                }
                const rect = obj.getBoundingRect(true, true);
                img.set({
                    left: baked.left ?? rect.left,
                    top: baked.top ?? rect.top,
                    scaleX: (baked.width ?? rect.width) / img.width,
                    scaleY: (baked.height ?? rect.height) / img.height,
                    angle: obj.angle || 0,
                    originX: "left",
                    originY: "top",
                    selectable: false,
                    evented: false,
                    hasControls: false,
                    tusFoilPreviewOverlay: true,
                    tusFoilPreviewTargetId: obj.id,
                    excludeFromExport: true,
                });
                if (obj._tusFoilOpacityBackup === undefined) {
                    obj._tusFoilOpacityBackup = obj.opacity ?? 1;
                }
                obj.set({ opacity: 0 });
                obj._tusFoilHiddenForPreview = true;
                canvas.add(img);
                obj._tusFoilPreviewOverlay = img;
                obj.tusFinishPreviewActive = true;
                canvas.requestRenderAll();
                resolve(true);
            },
            { crossOrigin: "anonymous" }
        );
    });
}

function _eachDrawableObject(obj, fn) {
    if (!obj || obj.center_line || obj.extra_elem) {
        return;
    }
    const children = typeof obj.getObjects === "function" ? obj.getObjects() : null;
    if (children && children.length) {
        children.forEach((child) => _eachDrawableObject(child, fn));
        return;
    }
    fn(obj);
}

function _backupCanvasColors(obj) {
    if (obj.tusFinishColorBackup) {
        return;
    }
    const backup = {};
    if (obj.fill !== undefined && obj.fill !== null) {
        backup.fill = obj.fill;
    }
    if (obj.stroke !== undefined && obj.stroke !== null) {
        backup.stroke = obj.stroke;
    }
    if (obj.opacity !== undefined) {
        backup.opacity = obj.opacity;
    }
    if (obj.shadow !== undefined) {
        backup.shadow = obj.shadow;
    }
    obj.tusFinishColorBackup = backup;
}

function _restoreCanvasColors(obj) {
    _clearFoilPreviewFilters(obj);
    const backup = obj.tusFinishColorBackup;
    if (!backup) {
        return;
    }
    const patch = {};
    if (backup.fill !== undefined) {
        patch.fill = backup.fill;
    }
    if (backup.stroke !== undefined) {
        patch.stroke = backup.stroke;
    }
    if (backup.opacity !== undefined) {
        patch.opacity = backup.opacity;
    }
    if (backup.shadow !== undefined) {
        patch.shadow = backup.shadow;
    } else {
        patch.shadow = null;
    }
    obj.set(patch);
    delete obj.tusFinishColorBackup;
    delete obj.tusFinishPreviewActive;
}

function _clearFoilPreviewFilters(obj) {
    _removeFoilRasterOverlaySync(obj);
}

function _applyFoilCanvasPreview(obj) {
    const foilColor = getFoilCssColor(obj.tusFoilMetal);
    const patch = { tusFinishPreviewActive: true };
    const foilTypes = [
        "text",
        "i-text",
        "textbox",
        "path",
        "line",
        "rect",
        "circle",
        "ellipse",
        "polygon",
        "polyline",
        "triangle",
    ];
    const hasFill = obj.fill && obj.fill !== "transparent" && obj.fill !== "none";
    if (foilTypes.includes(obj.type) || hasFill) {
        patch.fill = foilColor;
    }
    if (obj.stroke && obj.stroke !== "transparent" && obj.stroke !== "none") {
        patch.stroke = foilColor;
    }
    obj.set(patch);
}

function _applyVarnishCanvasPreview(obj, varnishType) {
    const shadow =
        varnishType === VARNISH_GLOSS
            ? { color: "rgba(255,255,255,0.45)", blur: 6, offsetX: 0, offsetY: 0 }
            : varnishType === VARNISH_SATIN
              ? { color: "rgba(255,255,255,0.25)", blur: 4, offsetX: 0, offsetY: 0 }
              : null;
    obj.set({ shadow, tusFinishPreviewActive: true });
}

function _applyEmbossCanvasPreview(obj, reliefMm) {
    const depth = Math.min(14, 4 + (reliefMm ?? DEFAULT_RELIEF_MM) * 2);
    obj.set({
        shadow: {
            color: "rgba(0,0,0,0.35)",
            blur: 2,
            offsetX: depth * 0.35,
            offsetY: depth * 0.35,
        },
        tusFinishPreviewActive: true,
    });
}

/**
 * Apply 2D canvas styling so finish choices (foil, varnish, emboss) are visible while editing.
 * Vector art uses fill/stroke; legacy photo-in-SVG layers use the 3D ink-mask bake overlay.
 */
export async function applyCanvasFinishPreview(obj) {
    if (!obj) {
        return;
    }

    const root = _getFoilPreviewRoot(obj);
    const rootResolved = _resolveFinishFromObject(root);
    const rootEffect = rootResolved.effect;

    if (_usesFoilRasterPreview(root) && (root._tusFoilPreviewOverlay || root._tusFoilHiddenForPreview)) {
        if (!isFoilFinish(rootEffect)) {
            _removeFoilRasterOverlaySync(root);
            _eachDrawableObject(root, (leaf) => _restoreCanvasColors(leaf));
        }
    }

    if (isFoilFinish(rootEffect) && _usesFoilRasterPreview(root)) {
        if (rootResolved.foilMetal) {
            root.tusFoilMetal = rootResolved.foilMetal;
        }
        root.tusFinishEffect = rootEffect;
        await _applyFoilRasterOverlay(root);
        return;
    }

    _eachDrawableObject(obj, (leaf) => {
        const leafRoot = _getFoilPreviewRoot(leaf);
        if (_usesFoilRasterPreview(leafRoot) && isFoilFinish(_resolveFinishFromObject(leafRoot).effect)) {
            return;
        }

        ensureObjectFinishDefaults(leaf);
        _restoreCanvasColors(leaf);

        const resolved = _resolveFinishFromObject(leaf);
        const effect = resolved.effect;
        const previewLeaf = { tusFinishEffect: effect };
        if (resolved.foilMetal) {
            previewLeaf.tusFoilMetal = resolved.foilMetal;
        }
        if (resolved.reliefMm !== undefined) {
            previewLeaf.tusReliefMm = resolved.reliefMm;
        }
        if (resolved.varnishType) {
            previewLeaf.tusVarnishType = resolved.varnishType;
        }
        const varnish = getEffectiveVarnishType(previewLeaf, VARNISH_NONE);

        if (isFoilFinish(effect)) {
            _backupCanvasColors(leaf);
            _applyFoilCanvasPreview(
                Object.assign(leaf, {
                    tusFinishEffect: effect,
                    tusFoilMetal: previewLeaf.tusFoilMetal || leaf.tusFoilMetal,
                })
            );
            return;
        }

        if (isEmbossFinish(effect)) {
            _backupCanvasColors(leaf);
            _applyEmbossCanvasPreview(leaf, previewLeaf.tusReliefMm);
            return;
        }

        if (isVarnishFinish(effect) || (varnish && varnish !== VARNISH_NONE)) {
            _backupCanvasColors(leaf);
            _applyVarnishCanvasPreview(leaf, varnish);
        }
    });

    if (obj.type === "group") {
        obj.dirty = true;
        if (typeof obj.addWithUpdate === "function") {
            obj.addWithUpdate();
        } else {
            obj.setCoords();
        }
    }
}

export async function applyCanvasFinishPreviewToCanvas(canvas) {
    if (!canvas) {
        return;
    }
    const objects = canvas
        .getObjects()
        .filter((o) => !o.tusFoilPreviewOverlay && !o.extra_elem && !o.center_line);
    await Promise.all(objects.map((o) => applyCanvasFinishPreview(o)));
    canvas.requestRenderAll();
}

/** Strip 2D finish styling before 3D texture bake (restores original ink colors). */
export function restoreFinishPreviewColorsOnCanvas(canvas) {
    if (!canvas) {
        return;
    }
    canvas
        .getObjects()
        .filter((o) => !o.tusFoilPreviewOverlay && !o.extra_elem && !o.center_line)
        .forEach((obj) => _eachDrawableObject(obj, _restoreCanvasColors));
    canvas.requestRenderAll();
}

export function serializeGlobalFinishSettings(settings = {}) {
    return {
        varnishType: settings.varnishType || VARNISH_NONE,
        reliefMm: settings.reliefMm ?? DEFAULT_RELIEF_MM,
    };
}
