/** @odoo-module **/

import { _t } from "@web/core/l10n/translation";
import { MIN_UPLOAD_DPI } from "./constants";

export const fabricPrintDpiMixin = {
    _getMinPrintDpi: function () {
        const cfg = this.personalizerConfig || {};
        const fromCfg = Number(cfg.min_print_dpi);
        if (Number.isFinite(fromCfg) && fromCfg > 0) {
            return fromCfg;
        }
        const min = Number(MIN_UPLOAD_DPI);
        return Number.isFinite(min) && min > 0 ? min : 150;
    },

    _physicalUnitToInches: function (value, unit) {
        const v = Number(value);
        if (!Number.isFinite(v) || v <= 0) {
            return 0;
        }
        switch ((unit || "inch").toLowerCase()) {
            case "inch":
            case "in":
                return v;
            case "mm":
            case "millimeter":
                return v / 25.4;
            case "cm":
            case "centimeter":
                return v / 2.54;
            default:
                return 0;
        }
    },

    _getDesignAreaPhysicalInches: function (targetCanvas) {
        const canvas = targetCanvas || this.canvas;
        if (!canvas) {
            return null;
        }
        const info = this._findCanvasInfo?.(canvas);
        const side = info?.side || this.active_side;
        const areaId = info?.areaId || this.active_area_id;
        const areaDef = this._findAreaDef?.(side, areaId);
        const cw = Math.max(1, canvas.getWidth?.() || canvas.width || 1);
        const ch = Math.max(1, canvas.getHeight?.() || canvas.height || 1);
        const area = this._computeAreaActualForSave?.(areaDef, cw, ch);
        if (!area) {
            return null;
        }
        const widthIn = this._physicalUnitToInches(area.width, area.unit);
        const heightIn = this._physicalUnitToInches(area.height, area.unit);
        if (!widthIn || !heightIn) {
            return null;
        }
        return { widthIn, heightIn, unit: area.unit || "inch" };
    },

    _getObjectPrintSizeInches: function (canvas, obj) {
        const dims = this._computeObjectDimensions(canvas, obj);
        if (!dims || dims.unit === "px") {
            return null;
        }
        const wIn = this._physicalUnitToInches(dims.w, dims.unit);
        const hIn = this._physicalUnitToInches(dims.h, dims.unit);
        if (!wIn || !hIn) {
            return null;
        }
        return { wIn, hIn, w: dims.w, h: dims.h, unit: dims.unit };
    },

    _parseEmbeddedImagePixelsFromSvg: function (svgText) {
        if (!svgText) {
            return null;
        }
        const widthMatch = svgText.match(
            /<image[^>]*\bwidth=["']([\d.]+)/i
        );
        const heightMatch = svgText.match(
            /<image[^>]*\bheight=["']([\d.]+)/i
        );
        const w = widthMatch ? parseFloat(widthMatch[1]) : 0;
        const h = heightMatch ? parseFloat(heightMatch[1]) : 0;
        if (w > 0 && h > 0) {
            return { width: Math.round(w), height: Math.round(h) };
        }
        return this._parseSvgRasterDimensions?.(svgText) || null;
    },

    _readNaturalSizeFromFabricImage: function (fabricImage) {
        if (!fabricImage) {
            return null;
        }
        const el =
            fabricImage._originalElement ||
            fabricImage._element ||
            fabricImage._cacheCanvas;
        if (el && (el.naturalWidth || el.width)) {
            const width = el.naturalWidth || el.width;
            const height = el.naturalHeight || el.height;
            if (width > 0 && height > 0) {
                return { width, height };
            }
        }
        return null;
    },

    _extractRasterPixelsFromPhotoObject: function (obj) {
        if (!obj || !this._isPhotoArtworkLayer(obj)) {
            return null;
        }
        const storedW = Number(obj.sourcePixelWidth);
        const storedH = Number(obj.sourcePixelHeight);
        if (storedW > 0 && storedH > 0) {
            return { width: storedW, height: storedH };
        }
        if (obj.type === "image") {
            return this._readNaturalSizeFromFabricImage(obj);
        }
        if (obj.type === "group") {
            const objects =
                typeof obj.getObjects === "function" ? obj.getObjects() : [];
            for (const child of objects) {
                if (child && child.type === "image") {
                    const fromImage = this._readNaturalSizeFromFabricImage(child);
                    if (fromImage) {
                        return fromImage;
                    }
                }
            }
        }
        return null;
    },

    _syncPhotoSourcePixels: function (group, options) {
        options = options || {};
        if (!group || !this._isPhotoArtworkLayer(group)) {
            return group;
        }
        let width = Number(options.sourceWidth);
        let height = Number(options.sourceHeight);
        if (!(width > 0 && height > 0)) {
            const fromFile = options.filePixels;
            if (fromFile && fromFile.width > 0 && fromFile.height > 0) {
                width = fromFile.width;
                height = fromFile.height;
            }
        }
        if (!(width > 0 && height > 0) && options.svgText) {
            const fromSvg = this._parseEmbeddedImagePixelsFromSvg(options.svgText);
            if (fromSvg) {
                width = fromSvg.width;
                height = fromSvg.height;
            }
        }
        if (!(width > 0 && height > 0)) {
            const fromObj = this._extractRasterPixelsFromPhotoObject(group);
            if (fromObj) {
                width = fromObj.width;
                height = fromObj.height;
            }
        }
        if (width > 0 && height > 0) {
            group.sourcePixelWidth = width;
            group.sourcePixelHeight = height;
        }
        return group;
    },

    _classifyDpiQuality: function (dpi) {
        const minDpi = this._getMinPrintDpi();
        if (!Number.isFinite(dpi)) {
            return null;
        }
        if (dpi >= minDpi) {
            return "good";
        }
        if (dpi >= minDpi * 0.75) {
            return "warn";
        }
        return "bad";
    },

    _computeDpiForObject: function (obj, canvas) {
        const pixels = this._extractRasterPixelsFromPhotoObject(obj);
        const print = this._getObjectPrintSizeInches(canvas, obj);
        if (!pixels || !print) {
            return { dpi: null, quality: null, skipped: true };
        }
        const dpiW = pixels.width / print.wIn;
        const dpiH = pixels.height / print.hIn;
        const dpi = Math.round(Math.min(dpiW, dpiH) * 10) / 10;
        return {
            dpi,
            quality: this._classifyDpiQuality(dpi),
            skipped: false,
            minDpi: this._getMinPrintDpi(),
        };
    },

    _computeDpiAtDefaultPlacement: function (imagePxW, imagePxH, targetCanvas) {
        const canvas = targetCanvas || this.canvas;
        if (!canvas || !imagePxW || !imagePxH) {
            return { dpi: null, skipped: true };
        }
        const areaIn = this._getDesignAreaPhysicalInches(canvas);
        if (!areaIn) {
            return { dpi: null, skipped: true };
        }
        const { boxW, boxH, cw, ch } = this._getDefaultPlacementBox(canvas);
        const aspect = imagePxW / imagePxH;
        let fitW = boxW;
        let fitH = fitW / aspect;
        if (fitH > boxH) {
            fitH = boxH;
            fitW = fitH * aspect;
        }
        const printWIn = (fitW / cw) * areaIn.widthIn;
        const printHIn = (fitH / ch) * areaIn.heightIn;
        if (!printWIn || !printHIn) {
            return { dpi: null, skipped: true };
        }
        const dpi = Math.min(imagePxW / printWIn, imagePxH / printHIn);
        return {
            dpi: Math.round(dpi * 10) / 10,
            skipped: false,
        };
    },

    _buildLowDpiWarningMessage: function (dpi, source) {
        const minDpi = this._getMinPrintDpi();
        if (source === "file") {
            return (
                _t("Your image quality is low") +
                ` (${dpi} DPI in file metadata). ` +
                _t("Recommended minimum is") +
                ` ${minDpi} ` +
                _t("DPI — print results may look blurry or pixelated.")
            );
        }
        return (
            _t("Your image quality is low") +
            ` (${dpi} DPI at default print size). ` +
            _t("Recommended minimum is") +
            ` ${minDpi} ` +
            _t("DPI — print results may look blurry or pixelated.")
        );
    },

    _evaluateUploadDpiWarning: function (meta, targetCanvas) {
        const minDpi = this._getMinPrintDpi();
        const width = meta?.width;
        const height = meta?.height;
        const fileDpi = meta?.fileDpi;

        if (fileDpi && fileDpi < minDpi) {
            return {
                warning: true,
                dpi: fileDpi,
                message: this._buildLowDpiWarningMessage(fileDpi, "file"),
            };
        }
        const placement = this._computeDpiAtDefaultPlacement(
            width,
            height,
            targetCanvas
        );
        if (!placement.skipped && placement.dpi !== null && placement.dpi < minDpi) {
            return {
                warning: true,
                dpi: placement.dpi,
                message: this._buildLowDpiWarningMessage(placement.dpi, "area"),
            };
        }
        return { warning: false, dpi: placement.dpi };
    },

    _ensureDpiDialogRoot: function () {
        let root = document.getElementById("tus-dpi-dialog-root");
        if (root) {
            return root;
        }
        root = document.createElement("div");
        root.id = "tus-dpi-dialog-root";
        root.className = "tus-dpi-dialog-root";
        document.body.appendChild(root);
        return root;
    },

    _showLowDpiUploadDialog: function (message) {
        const self = this;
        return new Promise((resolve, reject) => {
            const root = self._ensureDpiDialogRoot();
            root.innerHTML = `
                <div class="tus-dpi-dialog-backdrop" role="presentation"></div>
                <div class="tus-dpi-dialog" role="dialog" aria-modal="true" aria-labelledby="tus-dpi-dialog-title">
                    <h3 id="tus-dpi-dialog-title" class="tus-dpi-dialog__title">${_t("Low print quality")}</h3>
                    <p class="tus-dpi-dialog__message"></p>
                    <div class="tus-dpi-dialog__actions">
                        <button type="button" class="btn btn-secondary tus-dpi-dialog__cancel">${_t("Cancel")}</button>
                        <button type="button" class="btn btn-primary tus-dpi-dialog__continue">${_t("Upload anyway")}</button>
                    </div>
                </div>
            `;
            root.querySelector(".tus-dpi-dialog__message").textContent = message;
            root.classList.add("is-open");

            const close = (accepted) => {
                root.classList.remove("is-open");
                root.innerHTML = "";
                if (accepted) {
                    resolve();
                } else {
                    reject(Object.assign(new Error("dpi_cancelled"), { dpiCancelled: true }));
                }
            };

            root.querySelector(".tus-dpi-dialog__continue").addEventListener(
                "click",
                () => close(true),
                { once: true }
            );
            root.querySelector(".tus-dpi-dialog__cancel").addEventListener(
                "click",
                () => close(false),
                { once: true }
            );
            root.querySelector(".tus-dpi-dialog-backdrop").addEventListener(
                "click",
                () => close(false),
                { once: true }
            );
        });
    },

    _confirmLowDpiUploadIfNeeded: async function (width, height, targetCanvas, fileDpi) {
        const check = this._evaluateUploadDpiWarning(
            { width, height, fileDpi },
            targetCanvas
        );
        if (!check.warning) {
            return;
        }
        this.removeLoader?.();
        try {
            await this._showLowDpiUploadDialog(check.message);
        } catch (err) {
            if (err && err.message === "dpi_cancelled") {
                throw err;
            }
            throw err;
        }
    },

    _formatDimOverlayContent: function (canvas, obj) {
        const { w, h, unit } = this._computeObjectDimensions(canvas, obj);
        const sizeText = `${w} × ${h} ${unit}`;

        if (!this._isPhotoArtworkLayer(obj)) {
            return { html: sizeText, multiline: false };
        }

        const report = this._computeDpiForObject(obj, canvas);
        if (report.skipped || report.dpi === null) {
            const hint =
                unit === "px"
                    ? _t("Configure print area size for DPI")
                    : _t("DPI unavailable");
            return {
                html: `${sizeText}<br><span class="tus-dpi-muted">${hint}</span>`,
                multiline: true,
            };
        }

        const quality = report.quality || "bad";
        const cls = `tus-dpi-${quality}`;
        const label =
            quality === "good"
                ? _t("Good")
                : quality === "warn"
                  ? _t("Fair")
                  : _t("Low quality");

        const dpiPart = `<span class="tus-dpi-num ${cls}">${report.dpi} DPI</span> <span class="tus-dpi-label ${cls}">— ${label}</span>`;
        return {
            html: `${sizeText} · ${dpiPart}`,
            multiline: false,
        };
    },
};
