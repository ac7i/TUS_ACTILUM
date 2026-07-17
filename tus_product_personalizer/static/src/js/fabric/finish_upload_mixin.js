/** @odoo-module **/

import { _t } from "@web/core/l10n/translation";
import { ensureObjectFinishDefaults } from "../3d/finish_effects";

const VALID_INTENSITY = ["0.2", "0.3", "0.4", "0.5"];
const DEFAULT_INTENSITY = "0.3";
const VALID_COVER_MODE = ["by_file", "all", "zones"];
const GRAYSCALE_TOLERANCE = 8;

export function ensureObjectFinishUploadDefaults(obj) {
    if (!obj || obj.center_line || obj.extra_elem || obj.tusFoilPreviewOverlay) {
        return;
    }
    if (obj.tusTextureIntensityMm === undefined) {
        obj.tusTextureIntensityMm = DEFAULT_INTENSITY;
    }
    if (obj.tusVarnishType === undefined) {
        obj.tusVarnishType = "none";
    }
    if (obj.tusVarnishCoverMode === undefined) {
        obj.tusVarnishCoverMode = "all";
    }
}

export function serializeFinishUploadFields(obj) {
    ensureObjectFinishUploadDefaults(obj);
    const textureActive = Boolean(obj.tusTextureActive);
    const payload = {
        tusTextureActive: textureActive,
        tusVarnishType: obj.tusVarnishType || "none",
        tusVarnishCoverMode: obj.tusVarnishCoverMode || "all",
    };
    if (textureActive) {
        payload.tusTextureIntensityMm = obj.tusTextureIntensityMm || DEFAULT_INTENSITY;
    }
    if (obj.tusTextureFile) {
        payload.tusTextureFile = obj.tusTextureFile;
        payload.tusTextureFileName = obj.tusTextureFileName || "";
    }
    if (obj.tusVarnishAreaFile) {
        payload.tusVarnishAreaFile = obj.tusVarnishAreaFile;
        payload.tusVarnishAreaFileName = obj.tusVarnishAreaFileName || "";
    }
    if (obj.tusVarnishZonesDescription) {
        payload.tusVarnishZonesDescription = obj.tusVarnishZonesDescription;
    }
    if (obj.footprint_width != null) {
        payload.footprint_width = obj.footprint_width;
    }
    if (obj.footprint_height != null) {
        payload.footprint_height = obj.footprint_height;
    }
    if (obj.area_m2 != null) {
        payload.area_m2 = obj.area_m2;
    }
    return payload;
}

export const fabricFinishUploadMixin = {
    _initFinishUploadState() {
        this.showFinishTexture = $('input[name="show_finish_texture"]').val() === "1";
        this.showFinishVarnish = $('input[name="show_finish_varnish"]').val() === "1";
        this.showFinishTool = this.showFinishTexture || this.showFinishVarnish;
    },

    _isFinishToolEnabled() {
        return Boolean(this.showFinishTool);
    },

    _getFinishTargetObject() {
        const active = this.currentElement?.object || this.canvas?.getActiveObject();
        if (!active || active.center_line || active.extra_elem || active.tusFoilPreviewOverlay) {
            return null;
        }
        if (active.type === "activeSelection" && typeof active.getObjects === "function") {
            const objects = active.getObjects().filter(
                (o) => !o.center_line && !o.extra_elem && !o.tusFoilPreviewOverlay
            );
            return objects[0] || null;
        }
        return active;
    },

    _readFileAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (ev) => resolve(ev.target.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    },

    _getObjectSourcePixelSize(obj) {
        if (!obj) {
            return null;
        }
        const width = Number(obj.sourcePixelWidth || obj._tusSourceWidth || 0);
        const height = Number(obj.sourcePixelHeight || obj._tusSourceHeight || 0);
        if (width > 0 && height > 0) {
            return { width, height, dpi: obj.sourceFileDpi || null };
        }
        if (obj.type === "image") {
            const el = obj._element || obj.getElement?.();
            const w = el?.naturalWidth || el?.width || obj.width || 0;
            const h = el?.naturalHeight || el?.height || obj.height || 0;
            if (w > 0 && h > 0) {
                return { width: w, height: h, dpi: obj.sourceFileDpi || null };
            }
        }
        if (obj.type === "group" && typeof obj.getObjects === "function") {
            for (const child of obj.getObjects()) {
                const nested = this._getObjectSourcePixelSize(child);
                if (nested) {
                    return nested;
                }
            }
        }
        return null;
    },

    _loadImageElementFromDataUrl(dataUrl) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error(_t("Could not read the uploaded mask image.")));
            img.src = dataUrl;
        });
    },

    _isGrayscaleImageData(imageData, tolerance = GRAYSCALE_TOLERANCE) {
        if (!imageData?.data?.length) {
            return false;
        }
        const { data } = imageData;
        let opaque = 0;
        for (let i = 0; i < data.length; i += 4) {
            const alpha = data[i + 3];
            if (alpha < 8) {
                continue;
            }
            opaque += 1;
            const max = Math.max(data[i], data[i + 1], data[i + 2]);
            const min = Math.min(data[i], data[i + 1], data[i + 2]);
            if (max - min > tolerance) {
                return false;
            }
        }
        return opaque > 0;
    },

    async _validateFinishMaskFile(file, targetObj, { requireGrayscale = true } = {}) {
        const dataUrl = await this._readFileAsDataURL(file);
        const img = await this._loadImageElementFromDataUrl(dataUrl);
        const width = img.naturalWidth || img.width;
        const height = img.naturalHeight || img.height;
        const source = this._getObjectSourcePixelSize(targetObj);
        if (source && (width !== source.width || height !== source.height)) {
            throw new Error(
                _t("The uploaded mask must match the original image dimensions (%s × %s px).", source.width, source.height)
            );
        }
        if (requireGrayscale) {
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            ctx.drawImage(img, 0, 0);
            const imageData = ctx.getImageData(0, 0, width, height);
            if (!this._isGrayscaleImageData(imageData)) {
                throw new Error(_t("The uploaded emboss/varnish mask must be a grayscale image."));
            }
        }
        let fileDpi = null;
        try {
            fileDpi = await this._parseRasterFileDpi?.(file);
        } catch (_err) {
            fileDpi = null;
        }
        if (source?.dpi && fileDpi && Math.abs(source.dpi - fileDpi) > 1) {
            throw new Error(
                _t("The uploaded mask resolution (%s DPI) must match the original image (%s DPI).", fileDpi, source.dpi)
            );
        }
        return {
            dataUrl,
            width,
            height,
            fileDpi,
            fileName: file.name,
        };
    },

    _getObjectFootprintPx(obj) {
        if (!obj) {
            return { width: 0, height: 0 };
        }
        const width = Math.abs((obj.width || 0) * (obj.scaleX || 1));
        const height = Math.abs((obj.height || 0) * (obj.scaleY || 1));
        return { width, height };
    },

    _getCanvasPhysicalMeta() {
        if (this.emptyCanvasMode) {
            return {
                width: parseFloat(this.emptyCanvasActual?.width) || 0,
                height: parseFloat(this.emptyCanvasActual?.height) || 0,
                unit: this.emptyCanvasActual?.unit || "in",
                stageWidth: this.canvas?.getWidth?.() || 0,
                stageHeight: this.canvas?.getHeight?.() || 0,
            };
        }
        const side = this.active_side || "front";
        const entry = (this.canvasesBySide?.[side] || [])[0];
        const stage = this.stageBySide?.[side] || {};
        return {
            width: parseFloat(stage.imageW || stage.w) || 0,
            height: parseFloat(stage.imageH || stage.h) || 0,
            unit: "in",
            stageWidth: entry?.canvas?.getWidth?.() || this.canvas?.getWidth?.() || 0,
            stageHeight: entry?.canvas?.getHeight?.() || this.canvas?.getHeight?.() || 0,
        };
    },

    _objectFootprintM2(obj) {
        const footprint = this._getObjectFootprintPx(obj);
        const meta = this._getCanvasPhysicalMeta();
        if (
            !footprint.width ||
            !footprint.height ||
            !meta.width ||
            !meta.height ||
            !meta.stageWidth ||
            !meta.stageHeight
        ) {
            return 0;
        }
        const physW = meta.width * (footprint.width / meta.stageWidth);
        const physH = meta.height * (footprint.height / meta.stageHeight);
        const toMm = (value, unit) => {
            const u = (unit || "in").toLowerCase();
            if (u === "mm" || u === "millimeter") {
                return value;
            }
            if (u === "cm" || u === "centimeter") {
                return value * 10;
            }
            return value * 25.4;
        };
        const wMm = Math.max(0, toMm(physW, meta.unit));
        const hMm = Math.max(0, toMm(physH, meta.unit));
        return (wMm / 1000) * (hMm / 1000);
    },

    _annotateObjectFootprint(obj) {
        if (!obj) {
            return;
        }
        const footprint = this._getObjectFootprintPx(obj);
        obj.footprint_width = footprint.width;
        obj.footprint_height = footprint.height;
        obj.area_m2 = this._objectFootprintM2(obj);
    },

    _getPricingConfig() {
        return this.personalizerConfig?.pricing || {};
    },

    _calculateFinishPrice() {
        const pricing = this._getPricingConfig();
        const embossPrices = pricing.emboss_prices || {};
        const varnishPrices = pricing.varnish_prices || {};
        let total = 0;
        for (const side of Object.keys(this.canvasesBySide || {})) {
            for (const entry of this.canvasesBySide[side] || []) {
                const canvas = entry.canvas;
                if (!canvas) {
                    continue;
                }
                for (const obj of canvas.getObjects()) {
                    if (obj.center_line || obj.extra_elem || obj.tusFoilPreviewOverlay) {
                        continue;
                    }
                    this._annotateObjectFootprint(obj);
                    const area = Number(obj.area_m2) || 0;
                    if (area <= 0) {
                        continue;
                    }
                    if (this.showFinishTexture && obj.tusTextureActive) {
                        const intensity = String(obj.tusTextureIntensityMm || DEFAULT_INTENSITY);
                        total += area * (Number(embossPrices[intensity]) || 0);
                    }
                    if (this.showFinishVarnish) {
                        const varnishType = obj.tusVarnishType || "none";
                        if (varnishType === "gloss" || varnishType === "satin") {
                            total += area * (Number(varnishPrices[varnishType]) || 0);
                        }
                    }
                }
            }
        }
        return total;
    },

    _getFinishObjectsPayload() {
        const payload = [];
        for (const side of Object.keys(this.canvasesBySide || {})) {
            for (const entry of this.canvasesBySide[side] || []) {
                const canvas = entry.canvas;
                if (!canvas) {
                    continue;
                }
                for (const obj of canvas.getObjects()) {
                    if (obj.center_line || obj.extra_elem || obj.tusFoilPreviewOverlay) {
                        continue;
                    }
                    const textureActive = Boolean(obj.tusTextureActive);
                    const varnishType = obj.tusVarnishType || "none";
                    if (!textureActive && varnishType === "none") {
                        continue;
                    }
                    this._annotateObjectFootprint(obj);
                    payload.push({
                        area_m2: Number(obj.area_m2) || 0,
                        tusTextureActive: textureActive,
                        tusTextureIntensityMm: obj.tusTextureIntensityMm || DEFAULT_INTENSITY,
                        tusVarnishType: varnishType,
                        footprint_width: obj.footprint_width,
                        footprint_height: obj.footprint_height,
                    });
                }
            }
        }
        return payload;
    },

    _isImageLikeFinishTarget(obj) {
        if (!obj) {
            return false;
        }
        if (obj.type === "image" || obj.isEmbeddedPhotoSvg) {
            return true;
        }
        const kind = this._getElementKind?.(obj);
        return kind === "artwork" || kind === "image" || kind === "photo";
    },

    _onFinishTextureFileBtn(ev) {
        ev.preventDefault();
        const obj = this._getFinishTargetObject();
        if (!obj || !this._isImageLikeFinishTarget(obj)) {
            this.notification?.add?.(
                _t("Select an image layer before uploading an emboss mask."),
                { type: "warning" }
            );
            return;
        }
        $(this.el).find(".section_tool_finish .tus-texture-file-input").trigger("click");
    },

    async _onFinishTextureFileChange(ev) {
        const file = ev.currentTarget.files && ev.currentTarget.files[0];
        const obj = this._getFinishTargetObject();
        if (!file || !obj) {
            return;
        }
        try {
            // Mask only — never create a new visible design layer.
            const mask = await this._validateFinishMaskFile(file, obj, { requireGrayscale: true });
            obj.tusTextureFile = mask.dataUrl;
            obj.tusTextureFileName = mask.fileName;
            obj.tusTextureActive = true;
            if (!obj.tusTextureIntensityMm) {
                obj.tusTextureIntensityMm = DEFAULT_INTENSITY;
            }
            this.canvas?.setActiveObject(obj);
            this._showObjectToolbar?.(obj);
            this._syncFinishPanelFromObject(obj);
            this._schedule3DPreviewRefresh?.();
            this._updateDesignerPriceDisplay?.();
            this.saveState?.();
        } catch (err) {
            this.notification?.add?.(err.message || _t("Emboss mask upload failed."), {
                type: "warning",
            });
            console.warn("Texture mask upload failed:", err);
        } finally {
            ev.currentTarget.value = "";
        }
    },

    _onFinishTextureFileClear(ev) {
        ev.preventDefault();
        const obj = this._getFinishTargetObject();
        if (!obj) {
            return;
        }
        delete obj.tusTextureFile;
        delete obj.tusTextureFileName;
        obj.tusTextureActive = false;
        this._syncFinishPanelFromObject(obj);
        this._schedule3DPreviewRefresh?.();
        this._updateDesignerPriceDisplay?.();
        this.saveState?.();
    },



    _onFinishTextureIntensityChange(ev) {
        const obj = this._getFinishTargetObject();
        if (!obj) {
            return;
        }
        const value = String(ev.currentTarget.value);
        if (value === "none") {
            obj.tusTextureActive = false;
        } else {
            obj.tusTextureActive = true;
            obj.tusTextureIntensityMm = VALID_INTENSITY.includes(value) ? value : DEFAULT_INTENSITY;
        }
        this._syncFinishPanelFromObject(obj);
        this._schedule3DPreviewRefresh?.();
        this._updateDesignerPriceDisplay?.();
        this.saveState?.();
    },

    _onFinishVarnishTypeChange(ev) {
        const obj = this._getFinishTargetObject();
        if (!obj) {
            return;
        }
        const value = String(ev.currentTarget.value);
        obj.tusVarnishType = ["none", "gloss", "satin"].includes(value) ? value : "none";
        if (obj.tusVarnishType === "none") {
            // Keep mask/notes stored so re-enabling gloss restores the previous area choice.
        } else if (!VALID_COVER_MODE.includes(obj.tusVarnishCoverMode)) {
            obj.tusVarnishCoverMode = "all";
        }
        this._syncFinishPanelFromObject(obj);
        this._schedule3DPreviewRefresh?.();
        this._updateDesignerPriceDisplay?.();
        this.saveState?.();
    },

    _onFinishVarnishCoverChange(ev) {
        const obj = this._getFinishTargetObject();
        if (!obj) {
            return;
        }
        const mode = String(ev.currentTarget.value);
        if (!ev.currentTarget.checked || !VALID_COVER_MODE.includes(mode)) {
            return;
        }
        obj.tusVarnishCoverMode = mode;
        this._syncFinishPanelFromObject(obj);
        this._schedule3DPreviewRefresh?.();
        this.saveState?.();
    },

    _onFinishVarnishFileBtn(ev) {
        ev.preventDefault();
        const obj = this._getFinishTargetObject();
        if (!obj || (obj.tusVarnishType || "none") === "none") {
            this.notification?.add?.(
                _t("Select Gloss or Satin before uploading a varnish mask."),
                { type: "warning" }
            );
            return;
        }
        if (!this._isImageLikeFinishTarget(obj)) {
            this.notification?.add?.(
                _t("Spot varnish masks are only available for image layers."),
                { type: "warning" }
            );
            return;
        }
        $(this.el).find(".section_tool_finish .tus-varnish-file-input").trigger("click");
    },

    async _onFinishVarnishFileChange(ev) {
        const file = ev.currentTarget.files && ev.currentTarget.files[0];
        const obj = this._getFinishTargetObject();
        if (!file || !obj) {
            return;
        }
        try {
            // Mask only — never add a visible design layer (unlike Texture upload).
            if ((obj.tusVarnishType || "none") === "none") {
                obj.tusVarnishType = "gloss";
            }
            const mask = await this._validateFinishMaskFile(file, obj, { requireGrayscale: true });
            obj.tusVarnishAreaFile = mask.dataUrl;
            obj.tusVarnishAreaFileName = mask.fileName;
            obj.tusVarnishCoverMode = "by_file";
            this._syncFinishPanelFromObject(obj);
            this._schedule3DPreviewRefresh?.();
            this._updateDesignerPriceDisplay?.();
            this.saveState?.();
        } catch (err) {
            this.notification?.add?.(err.message || _t("Varnish mask upload failed."), {
                type: "warning",
            });
            console.warn("Varnish file read failed:", err);
        } finally {
            ev.currentTarget.value = "";
        }
    },

    _onFinishVarnishFileClear(ev) {
        ev.preventDefault();
        const obj = this._getFinishTargetObject();
        if (!obj) {
            return;
        }
        delete obj.tusVarnishAreaFile;
        delete obj.tusVarnishAreaFileName;
        if (obj.tusVarnishCoverMode === "by_file") {
            obj.tusVarnishCoverMode = "all";
        }
        this._syncFinishPanelFromObject(obj);
        this._schedule3DPreviewRefresh?.();
        this.saveState?.();
    },

    _onFinishVarnishZonesInput(ev) {
        const obj = this._getFinishTargetObject();
        if (!obj) {
            return;
        }
        obj.tusVarnishZonesDescription = ev.currentTarget.value || "";
        this.saveState?.();
    },

    _syncFinishPanelFromObject(obj) {
        const $root = $(this.el);
        const $panel = $root.find(".section_tool_finish");
        if (!$panel.length) {
            return;
        }
        if (!obj) {
            return;
        }
        ensureObjectFinishUploadDefaults(obj);
        const isImageLike = this._isImageLikeFinishTarget(obj);
        $panel.find(".tus-finish-image-only").toggleClass("d-none", !isImageLike);
        $panel.find(".tus-varnish-cover-group").toggleClass("d-none", !isImageLike);

        if (this.showFinishTexture) {
            $panel.find(".tus-texture-file-name").text(obj.tusTextureFileName || "");
            $panel.find(".tus-texture-file-clear").toggleClass(
                "d-none",
                !obj.tusTextureFileName && !obj.tusTextureFile
            );
            if (obj.tusTextureActive) {
                $panel.find(".tus-texture-intensity").val(obj.tusTextureIntensityMm || DEFAULT_INTENSITY);
            } else {
                $panel.find(".tus-texture-intensity").val("none");
            }
        }

        if (this.showFinishVarnish) {
            const varnishType = obj?.tusVarnishType || "none";
            $panel.find(".tus-varnish-type").each((i, el) => {
                el.checked = el.value === varnishType;
            });
            const varnishActive = varnishType !== "none";
            const coverMode = VALID_COVER_MODE.includes(obj?.tusVarnishCoverMode)
                ? obj.tusVarnishCoverMode
                : "all";
            $panel.find(".tus-varnish-area-block").toggleClass("tus-disabled", !varnishActive || !isImageLike);
            $panel.find(".tus-varnish-cover").each((i, el) => {
                el.checked = el.value === coverMode;
                el.disabled = !varnishActive || !isImageLike;
            });
            const hasMask = Boolean(obj?.tusVarnishAreaFileName || obj?.tusVarnishAreaFile);
            $panel.find(".tus-varnish-file-name").text(obj?.tusVarnishAreaFileName || "");
            $panel.find(".tus-varnish-file-clear").toggleClass("d-none", !hasMask || !varnishActive || !isImageLike);
            $panel.find(".tus-varnish-file-btn").prop("disabled", !varnishActive || !isImageLike);
            $panel.find(".tus-varnish-file-row").toggleClass(
                "tus-varnish-file-row--active",
                coverMode === "by_file"
            );
            $panel.find(".tus-varnish-zones")
                .toggleClass("d-none", coverMode !== "zones" || !isImageLike)
                .prop("disabled", !varnishActive || !isImageLike)
                .val(obj?.tusVarnishZonesDescription || "");
        }

        this._sync3DControlsFromObject(obj);
    },

    _sync3DControlsFromObject(obj) {
        if (!this._viewerControls || !obj) {
            return;
        }
        const settings = this._getFinishSettingsFromObject(obj);
        this._3dPreviewSettings = {
            ...this._3dPreviewSettings,
            varnishType: settings.varnishType,
            reliefMm: settings.reliefMm,
        };
        this._viewerControls.setSettings(this._3dPreviewSettings);
    },

    _getFinishSettingsFromObject(obj) {
        ensureObjectFinishUploadDefaults(obj);
        const settings = {
            varnishType: "none",
            reliefMm: 0,
            textureActive: false,
        };
        if (this.showFinishTexture && obj) {
            const textureActive = Boolean(obj.tusTextureActive);
            settings.textureActive = textureActive;
            if (textureActive) {
                const intensity = parseFloat(obj.tusTextureIntensityMm || DEFAULT_INTENSITY);
                settings.reliefMm = Number.isNaN(intensity) ? 0 : intensity;
                settings.textureIntensityMm = obj.tusTextureIntensityMm || DEFAULT_INTENSITY;
                settings.textureFileData = obj.tusTextureFile || null;
                settings.textureFileName = obj.tusTextureFileName || "";
            }
        }
        if (this.showFinishVarnish && obj) {
            settings.varnishType = obj.tusVarnishType || "none";
            if (settings.varnishType !== "none") {
                settings.varnishCoverMode = obj.tusVarnishCoverMode || "all";
                settings.varnishAreaFile = obj.tusVarnishAreaFile || null;
                settings.varnishAreaFileName = obj.tusVarnishAreaFileName || "";
                settings.varnishZonesDescription = obj.tusVarnishZonesDescription || "";
            }
        }
        return settings;
    },

    _getFinishSettingsForSide(side) {
        const entries = this.canvasesBySide?.[side] || [];
        const aggregated = {
            varnishType: "none",
            reliefMm: 0,
            textureActive: false,
            varnishCoverMode: "all",
            varnishAreaFile: null,
            varnishAreaFileName: "",
            varnishZonesDescription: "",
        };
        const preferVarnish = (current, next) => {
            if (!next || next === "none") {
                return current;
            }
            if (!current || current === "none") {
                return next;
            }
            if (current === "gloss" || next === "gloss") {
                return "gloss";
            }
            return next;
        };

        for (const entry of entries) {
            const canvas = entry.canvas;
            if (!canvas) {
                continue;
            }
            const objects = canvas.getObjects().filter(
                (o) => !o.center_line && !o.extra_elem && !o.tusFoilPreviewOverlay
            );
            for (const obj of objects) {
                const objSettings = this._getFinishSettingsFromObject(obj);
                if (objSettings.textureActive) {
                    aggregated.textureActive = true;
                    aggregated.reliefMm = Math.max(
                        aggregated.reliefMm,
                        Number(objSettings.reliefMm) || 0
                    );
                }
                // Finish-effect emboss / deboss also carries relief independent of varnish.
                ensureObjectFinishDefaults(obj);
                if (
                    obj.tusFinishEffect === "emboss" ||
                    obj.tusFinishEffect === "deboss" ||
                    obj.tusFinishEffect === "foil_emboss"
                ) {
                    const embossRelief =
                        Number(obj.tusReliefMm) > 0 ? Number(obj.tusReliefMm) : 0.6;
                    aggregated.reliefMm = Math.max(aggregated.reliefMm, embossRelief);
                }
                aggregated.varnishType = preferVarnish(
                    aggregated.varnishType,
                    objSettings.varnishType
                );
                if (objSettings.varnishType && objSettings.varnishType !== "none") {
                    aggregated.varnishCoverMode = objSettings.varnishCoverMode || aggregated.varnishCoverMode;
                    aggregated.varnishAreaFile =
                        objSettings.varnishAreaFile || aggregated.varnishAreaFile;
                    aggregated.varnishAreaFileName =
                        objSettings.varnishAreaFileName || aggregated.varnishAreaFileName;
                    aggregated.varnishZonesDescription =
                        objSettings.varnishZonesDescription || aggregated.varnishZonesDescription;
                }
            }
        }
        return aggregated;
    },

    _get3DFinishForSide(side) {
        const settings = this._getFinishSettingsForSide(side);
        return {
            varnishType: settings.varnishType || "none",
            reliefMm: settings.reliefMm ?? 0,
            varnishAreaFileData: settings.varnishAreaFile || null,
            varnishCoverMode: settings.varnishCoverMode || "all",
            textureFileData: settings.textureFileData || null,
        };
    },
};
