/** @odoo-module **/

import { _t } from "@web/core/l10n/translation";
import { normalizeDesignArea } from "../design_area_shapes";

const DEFAULT_EMPTY_CANVAS_FINISH = "transparent";
const DEFAULT_EMPTY_CANVAS_PRINT_QUALITY = "good_600x600";
const DEFAULT_EMPTY_CANVAS_PRINT_MODE = "color_only";
const EMPTY_CANVAS_MAX_MARGIN_MM = 30;
const EMPTY_CANVAS_MARGIN_SIDES = ["front", "back", "left", "right"];

export const fabricEmptyCanvasMixin = {
    _initEmptyCanvasState() {
        this.emptyCanvasMode = $('input[name="empty_canvas_mode"]').val() === "1";
        this.emptyCanvasActual = {
            width: parseFloat($('input[name="empty_canvas_width"]').val()) || 0,
            height: parseFloat($('input[name="empty_canvas_height"]').val()) || 0,
            unit: $('input[name="empty_canvas_unit"]').val() || "in",
        };
        this.emptyCanvasSides = $('input[name="empty_canvas_sides"]').val() || "front";
        this.emptyCanvasPresetId = parseInt($('input[name="empty_canvas_preset_id"]').val(), 10) || null;
        this.emptyCanvasFinish = $('input[name="empty_canvas_finish"]').val() || DEFAULT_EMPTY_CANVAS_FINISH;
        this.emptyCanvasPrintQuality =
            $('input[name="empty_canvas_print_quality"]').val() || DEFAULT_EMPTY_CANVAS_PRINT_QUALITY;
        this.emptyCanvasPrintMode =
            $('input[name="empty_canvas_print_mode"]').val() || DEFAULT_EMPTY_CANVAS_PRINT_MODE;
        this.emptyCanvasMachiningFolding =
            $('input[name="empty_canvas_machining_folding"]').val() === "1";
        this.emptyCanvasMachiningCutting =
            $('input[name="empty_canvas_machining_cutting"]').val() === "1";
        this.emptyCanvasMachiningCornerDrilling =
            $('input[name="empty_canvas_machining_corner_drilling"]').val() === "1";
        this.emptyCanvasMachiningSelection = [];
        try {
            const machiningRaw = $('input[name="empty_canvas_machining_selection"]').val();
            if (machiningRaw) {
                const parsed = JSON.parse(machiningRaw);
                if (Array.isArray(parsed)) {
                    this.emptyCanvasMachiningSelection = parsed.filter(Boolean);
                }
            }
        } catch (_err) {
            this.emptyCanvasMachiningSelection = [];
        }
        if (!this.emptyCanvasMachiningSelection.length) {
            const legacySelection = [];
            if (this.emptyCanvasMachiningFolding) {
                legacySelection.push("folding");
            }
            if (this.emptyCanvasMachiningCutting) {
                legacySelection.push("cutting");
            }
            if (this.emptyCanvasMachiningCornerDrilling) {
                legacySelection.push("corner_drilling");
            }
            this.emptyCanvasMachiningSelection = legacySelection;
        }
        this.emptyCanvasMachiningFolding = this.emptyCanvasMachiningSelection.includes("folding");
        this.emptyCanvasMachiningCutting = this.emptyCanvasMachiningSelection.includes("cutting");
        this.emptyCanvasMachiningCornerDrilling = this.emptyCanvasMachiningSelection.includes(
            "corner_drilling"
        );
        this.emptyCanvasBgBySide = {
            front: "#ffffff",
            back: "#ffffff",
            left: "#ffffff",
            right: "#ffffff",
        };
        this.emptyCanvasMarginBySide = {
            front: 0,
            back: 0,
            left: 0,
            right: 0,
        };
        try {
            const marginsRaw = $('input[name="empty_canvas_margins_json"]').val();
            if (marginsRaw) {
                const parsed = JSON.parse(marginsRaw);
                if (parsed && typeof parsed === "object") {
                    for (const side of EMPTY_CANVAS_MARGIN_SIDES) {
                        const value = parseFloat(parsed[side]);
                        if (!Number.isNaN(value)) {
                            this.emptyCanvasMarginBySide[side] = value;
                        }
                    }
                }
            }
        } catch (_err) {
            // Keep default zero margins when hidden input is missing or invalid.
        }
        for (const side of EMPTY_CANVAS_MARGIN_SIDES) {
            this.emptyCanvasMarginBySide[side] = this._clampEmptyCanvasMarginMm(
                this.emptyCanvasMarginBySide[side],
                side
            );
        }
        if (this.emptyCanvasMode) {
            this.showMatrixTable = false;
            this.showVdp = false;
            $(".fabric_container.tus-ref-layout").addClass("tus-empty-canvas-mode");
        }
    },

    _getEmptyCanvasRpcParams() {
        if (!this.emptyCanvasMode) {
            return {};
        }
        return this._buildEmptyCanvasRpcParams(this._getEmptyCanvasMeta());
    },

    _buildEmptyCanvasRpcParams(meta) {
        if (!meta?.width || !meta?.height) {
            return {};
        }
        const params = {
            canvas_w: meta.width,
            canvas_h: meta.height,
            canvas_unit: meta.unit || "in",
            sides: meta.sides || "front",
        };
        if (meta.preset_id) {
            params.canvas_preset_id = meta.preset_id;
        }
        if (meta.finish) {
            params.canvas_finish = meta.finish;
        }
        if (meta.print_quality) {
            params.canvas_print_quality = meta.print_quality;
        }
        if (meta.print_mode) {
            params.canvas_print_mode = meta.print_mode;
        }
        params.machining_folding = meta.machining_folding ? "1" : "0";
        params.machining_cutting = meta.machining_cutting ? "1" : "0";
        params.machining_corner_drilling = meta.machining_corner_drilling ? "1" : "0";
        if (meta.machining_selection?.length) {
            params.machining_selection = meta.machining_selection.join(",");
        }
        return params;
    },

    _getEmptyCanvasMeta() {
        if (!this.emptyCanvasMode) {
            return null;
        }
        return {
            width: this.emptyCanvasActual.width,
            height: this.emptyCanvasActual.height,
            unit: this.emptyCanvasActual.unit,
            sides: this.emptyCanvasSides,
            preset_id: this.emptyCanvasPresetId || null,
            background_by_side: { ...(this.emptyCanvasBgBySide || {}) },
            finish: this.emptyCanvasFinish,
            print_quality: this.emptyCanvasPrintQuality,
            print_mode: this.emptyCanvasPrintMode,
            machining_folding: this.emptyCanvasMachiningFolding,
            machining_cutting: this.emptyCanvasMachiningCutting,
            machining_corner_drilling: this.emptyCanvasMachiningCornerDrilling,
            machining_selection: [...(this.emptyCanvasMachiningSelection || [])],
            margins_by_side: { ...(this.emptyCanvasMarginBySide || {}) },
        };
    },

    _convertSheetDimensionToMm(value, unit) {
        const amount = parseFloat(value) || 0;
        const normalizedUnit = String(unit || "in").toLowerCase();
        if (normalizedUnit === "mm") {
            return amount;
        }
        if (normalizedUnit === "cm") {
            return amount * 10;
        }
        if (normalizedUnit === "ft") {
            return amount * 304.8;
        }
        return amount * 25.4;
    },

    _convertMmToSheetDimension(mm, unit) {
        const value = parseFloat(mm) || 0;
        const normalizedUnit = String(unit || "in").toLowerCase();
        if (normalizedUnit === "mm") {
            return value;
        }
        if (normalizedUnit === "cm") {
            return value / 10;
        }
        if (normalizedUnit === "ft") {
            return value / 304.8;
        }
        return value / 25.4;
    },

    _getMaxAllowedEmptyCanvasMarginMm() {
        const { width, height, unit } = this.emptyCanvasActual || {};
        if (!width || !height) {
            return EMPTY_CANVAS_MAX_MARGIN_MM;
        }
        const widthMm = this._convertSheetDimensionToMm(width, unit);
        const heightMm = this._convertSheetDimensionToMm(height, unit);
        const maxFromSheet = Math.min(widthMm, heightMm) / 2 - 0.5;
        return Math.min(EMPTY_CANVAS_MAX_MARGIN_MM, Math.max(0, maxFromSheet));
    },

    _clampEmptyCanvasMarginMm(value, side) {
        const maxAllowed = this._getMaxAllowedEmptyCanvasMarginMm();
        const margin = Math.max(0, parseFloat(value) || 0);
        return Math.min(maxAllowed, Math.min(EMPTY_CANVAS_MAX_MARGIN_MM, margin));
    },

    _getEmptyCanvasMarginMm(side) {
        const key = side || this.active_side || "front";
        return this._clampEmptyCanvasMarginMm(this.emptyCanvasMarginBySide?.[key] ?? 0, key);
    },

    _getEmptyCanvasMarginInsets(fabricCanvas, side) {
        const marginMm = this._getEmptyCanvasMarginMm(side);
        if (marginMm <= 0 || !fabricCanvas) {
            return null;
        }
        const { width, height, unit } = this.emptyCanvasActual || {};
        const widthMm = this._convertSheetDimensionToMm(width, unit);
        const heightMm = this._convertSheetDimensionToMm(height, unit);
        if (widthMm <= 0 || heightMm <= 0) {
            return null;
        }
        const canvasW = fabricCanvas.getWidth();
        const canvasH = fabricCanvas.getHeight();
        const marginPxX = marginMm * (canvasW / widthMm);
        const marginPxY = marginMm * (canvasH / heightMm);
        return {
            left: marginPxX,
            top: marginPxY,
            right: marginPxX,
            bottom: marginPxY,
            width: Math.max(1, canvasW - marginPxX * 2),
            height: Math.max(1, canvasH - marginPxY * 2),
        };
    },

    _getEmptyCanvasPrintableInset(fabricCanvas, side) {
        const insets = this._getEmptyCanvasMarginInsets(fabricCanvas, side);
        if (!insets) {
            return null;
        }
        return {
            left: insets.left,
            top: insets.top,
            width: insets.width,
            height: insets.height,
            right: insets.right,
            bottom: insets.bottom,
        };
    },

    _updateEmptyCanvasPrintableGuide(wrapper, inset) {
        if (!wrapper) {
            return;
        }
        let guide = wrapper.querySelector(".tus-empty-canvas-printable-guide");
        if (!inset) {
            guide?.remove();
            return;
        }
        if (!guide) {
            guide = document.createElement("div");
            guide.className = "tus-empty-canvas-printable-guide";
            wrapper.appendChild(guide);
        }
        guide.style.left = `${inset.left}px`;
        guide.style.top = `${inset.top}px`;
        guide.style.right = `${inset.right}px`;
        guide.style.bottom = `${inset.bottom}px`;
        guide.style.width = "auto";
        guide.style.height = "auto";
    },

    _applyEmptyCanvasMarginsForCanvas(fabricCanvas, side) {
        if (!fabricCanvas) {
            return;
        }
        const inset = this._getEmptyCanvasPrintableInset(fabricCanvas, side);
        if (!inset) {
            fabricCanvas.clipPath = null;
            fabricCanvas._tusPrintableInset = null;
            this._updateEmptyCanvasPrintableGuide(fabricCanvas._wrapperEl, null);
            fabricCanvas.requestRenderAll();
            return;
        }
        fabricCanvas._tusPrintableInset = inset;
        fabricCanvas.clipPath = new fabric.Rect({
            left: inset.left,
            top: inset.top,
            width: inset.width,
            height: inset.height,
            absolutePositioned: true,
        });
        this._updateEmptyCanvasPrintableGuide(fabricCanvas._wrapperEl, inset);
        fabricCanvas.requestRenderAll();
    },

    _applyEmptyCanvasMarginsForSide(side) {
        const key = side || this.active_side || "front";
        for (const entry of this.canvasesBySide[key] || []) {
            this._applyEmptyCanvasMarginsForCanvas(entry.canvas, key);
            if (entry.canvas) {
                entry.canvas.getObjects().forEach((obj) => {
                    if (obj.center_line) {
                        return;
                    }
                    this._clampObjectToDesignArea?.(entry.canvas, obj);
                });
            }
        }
    },

    _setEmptyCanvasMargin(side, marginMm) {
        const key = side || this.active_side || "front";
        this.emptyCanvasMarginBySide = this.emptyCanvasMarginBySide || {};
        this.emptyCanvasMarginBySide[key] = this._clampEmptyCanvasMarginMm(marginMm, key);
        this._syncEmptyCanvasMarginsHiddenInput();
        this._applyEmptyCanvasMarginsForSide(key);
        this._syncEmptyCanvasFooterForSide(key);
        this._rescaleAllTextures?.();
        this._syncTexturePanelUi?.(key);
        this._updateDesignerPriceDisplay?.();
        return this.emptyCanvasMarginBySide[key];
    },

    _syncEmptyCanvasMarginsHiddenInput() {
        const $input = $('input[name="empty_canvas_margins_json"]');
        if ($input.length) {
            $input.val(JSON.stringify(this.emptyCanvasMarginBySide || {}));
        }
    },

    _formatEmptyCanvasPrintableSizeLabel(side) {
        const marginMm = this._getEmptyCanvasMarginMm(side);
        if (marginMm <= 0) {
            return "";
        }
        const { width, height, unit } = this.emptyCanvasActual || {};
        if (!width || !height) {
            return "";
        }
        const printableW = this._convertMmToSheetDimension(
            Math.max(0, this._convertSheetDimensionToMm(width, unit) - 2 * marginMm),
            unit
        );
        const printableH = this._convertMmToSheetDimension(
            Math.max(0, this._convertSheetDimensionToMm(height, unit) - 2 * marginMm),
            unit
        );
        const precision = unit === "mm" ? 0 : 2;
        const format = (value) => {
            const rounded = Number(value.toFixed(precision));
            return Number.isInteger(rounded) ? String(rounded) : String(rounded);
        };
        return _t("Printable: %(w)s × %(h)s %(u)s", {
            w: format(printableW),
            h: format(printableH),
            u: unit || "in",
        });
    },

    _normalizeEmptyCanvasColor(color, fallback = "#ffffff") {
        const value = String(color || "").trim();
        if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) {
            if (value.length === 4) {
                return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
            }
            return value.toLowerCase();
        }
        return fallback;
    },

    _getEmptyCanvasBackground(side) {
        const key = side || this.active_side || "front";
        return this._normalizeEmptyCanvasColor(this.emptyCanvasBgBySide?.[key], "#ffffff");
    },

    _setEmptyCanvasBackground(side, color) {
        const key = side || this.active_side || "front";
        const normalized = this._normalizeEmptyCanvasColor(color, "#ffffff");
        this.emptyCanvasBgBySide = this.emptyCanvasBgBySide || {};
        this.emptyCanvasBgBySide[key] = normalized;
        this._applyEmptyCanvasBackground(key);
        return normalized;
    },

    _applyEmptyCanvasBackground(side) {
        const key = side || this.active_side || "front";
        const color = this._getEmptyCanvasBackground(key);
        const pane = document.getElementById(`${key}_canvas`);
        const box = pane?.querySelector(".image_preview_box.tus-empty-canvas-stage");
        if (box && !this._sideHasTexture?.(key)) {
            box.style.background = color;
        }
        for (const entry of this.canvasesBySide[key] || []) {
            const canvas = entry?.canvas;
            if (!canvas) {
                continue;
            }
            if (this._sideHasTexture?.(key)) {
                continue;
            }
            canvas.backgroundColor = color;
            canvas.requestRenderAll();
        }
        const $input = $(`.tus-empty-canvas-bg-input[data-side="${key}"]`);
        if ($input.length) {
            $input.val(color);
        }
    },

    _formatEmptyCanvasSizeLabel(side) {
        const { width, height, unit } = this.emptyCanvasActual || {};
        if (!width || !height) {
            return "";
        }
        const sheetLabel = `${width} × ${height} ${unit || "in"}`;
        const printableLabel = this._formatEmptyCanvasPrintableSizeLabel(side);
        return printableLabel ? `${sheetLabel} · ${printableLabel}` : sheetLabel;
    },

    _computeEmptyCanvasDisplaySize(stageW, stageH, box) {
        const sw = stageW || 394;
        const sh = stageH || 394;
        // Prefer the stage's actual parent width so Fabric logical size matches on-screen
        // CSS pixels (critical on 4K when sidebars shrink the preview column).
        const parent = box?.parentElement;
        const parentW = parent?.clientWidth || 0;
        const availableW = parentW > 0
            ? Math.max(280, parentW - 16)
            : Math.max(320, window.innerWidth * 0.72);
        const maxW = Math.min(720, availableW);
        const maxH = Math.max(280, window.innerHeight * 0.52);
        let displayW = maxW;
        let displayH = (sh / sw) * displayW;
        if (displayH > maxH) {
            displayH = maxH;
            displayW = (sw / sh) * displayH;
        }
        return {
            displayW: Math.round(displayW),
            displayH: Math.round(displayH),
            stageW: sw,
            stageH: sh,
        };
    },

    /**
     * Keep Fabric lower/upper canvases + wrapper on identical explicit CSS pixel sizes.
     * Stretching only the lower canvas to 100% while the upper (handles) stays at Fabric's
     * absolute px size is the 4K selection-handle offset bug.
     */
    _syncEmptyCanvasFabricSurface(canvas, width, height) {
        if (!canvas) {
            return;
        }
        const w = Math.max(1, Math.round(width));
        const h = Math.max(1, Math.round(height));
        if (typeof canvas.setDimensions === "function") {
            canvas.setDimensions({ width: w, height: h });
        } else {
            canvas.setWidth?.(w);
            canvas.setHeight?.(h);
        }
        const pxW = `${w}px`;
        const pxH = `${h}px`;
        if (canvas.wrapperEl) {
            canvas.wrapperEl.style.width = pxW;
            canvas.wrapperEl.style.height = pxH;
            canvas.wrapperEl.style.overflow = "hidden";
        }
        [canvas.lowerCanvasEl, canvas.upperCanvasEl].forEach((el) => {
            if (!el) {
                return;
            }
            el.style.width = pxW;
            el.style.height = pxH;
            el.style.left = "0px";
            el.style.top = "0px";
        });
        canvas.calcOffset?.();
    },

    _applyEmptyCanvasBoxLayout(box, container, stageW, stageH, side) {
        const { displayW, displayH } = this._computeEmptyCanvasDisplaySize(stageW, stageH, box);
        const bgColor = this._getEmptyCanvasBackground(side);
        box.style.boxSizing = "border-box";
        // Beat SCSS `width/height: auto !important` so stage CSS size === Fabric logical size.
        box.style.setProperty("width", `${displayW}px`, "important");
        box.style.setProperty("height", `${displayH}px`, "important");
        box.style.minWidth = `${displayW}px`;
        box.style.minHeight = `${displayH}px`;
        box.style.maxWidth = "none";
        box.style.maxHeight = "none";
        box.style.flex = "0 0 auto";
        box.style.background = bgColor;
        box.style.lineHeight = "0";
        box.style.overflow = "hidden";
        container.style.position = "absolute";
        container.style.inset = "0";
        container.style.width = "100%";
        container.style.height = "100%";
        container.style.margin = "0";
        container.style.padding = "0";
        const img = box.querySelector("img.main_canvas_img");
        if (img) {
            img.style.setProperty("display", "none", "important");
            img.style.setProperty("width", "0", "important");
            img.style.setProperty("height", "0", "important");
            img.style.setProperty("max-height", "0", "important");
        }
        return { displayW, displayH };
    },

    _applyEmptyCanvasAreaLayout(wrapper, layout) {
        const w = Math.max(1, Math.round(layout?.canvasW || layout?.width || 0));
        const h = Math.max(1, Math.round(layout?.canvasH || layout?.height || 0));
        const pxW = `${w}px`;
        const pxH = `${h}px`;
        wrapper.style.left = "0";
        wrapper.style.top = "0";
        wrapper.style.right = "auto";
        wrapper.style.bottom = "auto";
        wrapper.style.inset = "auto";
        wrapper.style.width = pxW;
        wrapper.style.height = pxH;
        wrapper.style.margin = "0";
        wrapper.style.padding = "0";
        const fabricContainer = wrapper.querySelector(".canvas-container");
        if (fabricContainer) {
            fabricContainer.style.width = pxW;
            fabricContainer.style.height = pxH;
        }
        // Sync every Fabric layer (lower artwork + upper controls), not just the design canvas.
        wrapper.querySelectorAll("canvas").forEach((el) => {
            el.style.width = pxW;
            el.style.height = pxH;
            el.style.left = "0px";
            el.style.top = "0px";
        });
        if (layout) {
            wrapper.dataset.layoutW = String(w);
            wrapper.dataset.layoutH = String(h);
        }
    },

    _addEmptyCanvasArea(element, area, side, stage) {
        area = normalizeDesignArea(area);
        const box = element.querySelector(".image_preview_box");
        const container = element.querySelector(".canvas_container");
        if (!box || !container) {
            return;
        }

        const baseW = (stage && stage.w) || this.DEFAULT_STAGE?.w || 394;
        const baseH = (stage && stage.h) || this.DEFAULT_STAGE?.h || 394;
        this._applyEmptyCanvasBoxLayout(box, container, baseW, baseH, side);

        const layout = this._buildEmptyCanvasLayout(baseW, baseH, box);

        const wrapper = document.createElement("div");
        wrapper.classList.add("design-area", "tus-empty-canvas-area");
        wrapper.dataset.areaId = area.id;
        wrapper.dataset.side = side;
        wrapper.dataset.areaShape = layout.mode;
        wrapper.style.position = "absolute";
        wrapper.style.boxSizing = "border-box";

        const canvasEl = document.createElement("canvas");
        canvasEl.classList.add("design-area-canvas");
        canvasEl.width = layout.canvasW;
        canvasEl.height = layout.canvasH;
        canvasEl.style.position = "absolute";
        canvasEl.style.left = "0px";
        canvasEl.style.top = "0px";
        canvasEl.style.width = `${layout.canvasW}px`;
        canvasEl.style.height = `${layout.canvasH}px`;

        wrapper.appendChild(canvasEl);
        container.appendChild(wrapper);

        const fabricCanvas = new fabric.Canvas(canvasEl, {
            preserveObjectStacking: true,
            selection: true,
            allowTouchScrolling: true,
            // 4K/HiDPI FIX: Disable Fabric's built-in retina scaling.
            // On DPR=2 screens, Fabric doubles the canvas backing store by default,
            // but pointer events stay in CSS-pixel space — causing all object handles
            // and click targets to appear at 2× the correct position.
            enableRetinaScaling: false,
        });

        this._applyDesignAreaGeometry(fabricCanvas, wrapper, area, layout);
        this._syncEmptyCanvasFabricSurface(fabricCanvas, layout.canvasW, layout.canvasH);
        this._applyEmptyCanvasAreaLayout(wrapper, layout);
        fabricCanvas.calcOffset();

        fabricCanvas._wrapperEl = wrapper;
        fabricCanvas._baseW = layout.canvasW;
        fabricCanvas._baseH = layout.canvasH;
        fabricCanvas._lastW = layout.canvasW;
        fabricCanvas._lastH = layout.canvasH;
        this.fabricByAreaId[area.id] = fabricCanvas;
        this.canvasesBySide[side] = this.canvasesBySide[side] || [];
        this.canvasesBySide[side].push({
            id: area.id,
            name: area.name,
            canvas: fabricCanvas,
            dom: canvasEl,
            wrapper,
            layout,
            shape: layout.mode,
            product_id: null,
            price: 0,
        });

        if (!this.canvas) {
            this.canvas = fabricCanvas;
        }
        this.add_canvas_events(fabricCanvas);
        if (fabricCanvas.wrapperEl) {
            fabricCanvas.wrapperEl.style.overflow = "hidden";
        }
        this._ensureDimOverlay(fabricCanvas);
        this._initCenterGuides(fabricCanvas);
        this._addDropListeners(wrapper, fabricCanvas, area.id, side);
        this._applyEmptyCanvasBackground(side);
        this._applyEmptyCanvasMarginsForCanvas(fabricCanvas, side);
        const textureMeta = this.textureBySide?.[side];
        if (textureMeta) {
            fabricCanvas._tusSide = side;
            this._applyTextureToCanvas(fabricCanvas, textureMeta);
        }
        fabricCanvas.requestRenderAll();
    },

    _buildEmptyCanvasLayout(stageW, stageH, box) {
        const { displayW, displayH } = this._computeEmptyCanvasDisplaySize(stageW, stageH, box);
        return {
            mode: "rect",
            left: 0,
            top: 0,
            width: displayW,
            height: displayH,
            // Match on-screen pixels so Fabric fills the preview box (stage dims stay in stageW/H).
            canvasW: displayW,
            canvasH: displayH,
            widthRatio: displayW / stageW,
            heightRatio: displayH / stageH,
            stageW,
            stageH,
            imgDisplayW: displayW,
            imgDisplayH: displayH,
            offsetX: 0,
            offsetY: 0,
        };
    },

    _syncEmptyCanvasSide(element, side, options = {}) {
        const preserveSelection = options.preserveSelection !== false;
        const box = element?.querySelector(".image_preview_box");
        const container = element?.querySelector(".canvas_container");
        if (!box || !container) {
            return;
        }
        const stage = (this.stageBySide && this.stageBySide[side]) || this.DEFAULT_STAGE || { w: 394, h: 394 };
        const stageW = stage.w || 394;
        const stageH = stage.h || 394;
        this._applyEmptyCanvasBoxLayout(box, container, stageW, stageH, side);
        const layout = this._buildEmptyCanvasLayout(stageW, stageH, box);
        const areas = this[`${side}AreasData`] || [];

        for (const area of areas) {
            const wrapper = element.querySelector(`.design-area[data-area-id="${area.id}"]`);
            const canvas = this.fabricByAreaId[area.id];
            if (!wrapper || !canvas) {
                continue;
            }

            const activeObj = preserveSelection ? canvas.getActiveObject() : null;
            const oldW = canvas.getWidth();
            const oldH = canvas.getHeight();
            const newW = layout.canvasW;
            const newH = layout.canvasH;
            if (oldW > 0 && oldH > 0 && (oldW !== newW || oldH !== newH)) {
                const scaleX = newW / oldW;
                const scaleY = newH / oldH;
                canvas.getObjects().forEach((obj) => {
                    if (obj.center_line || obj.tusTextureLayer) {
                        return;
                    }
                    obj.scaleX = (obj.scaleX || 1) * scaleX;
                    obj.scaleY = (obj.scaleY || 1) * scaleY;
                    obj.left = (obj.left || 0) * scaleX;
                    obj.top = (obj.top || 0) * scaleY;
                    obj.setCoords();
                });
            }
            // Do NOT write lowerCanvasEl.width / upperCanvasEl.width directly — that resets
            // the 2D context and desyncs Fabric's CSS sizing from the backing store (handles offset).
            this._syncEmptyCanvasFabricSurface(canvas, newW, newH);
            this._applyEmptyCanvasAreaLayout(wrapper, layout);
            canvas._baseW = newW;
            canvas._baseH = newH;
            canvas._lastW = newW;
            canvas._lastH = newH;
            canvas.getObjects().forEach((obj) => obj.setCoords?.());
            if (activeObj) {
                canvas.setActiveObject(activeObj);
                activeObj.setCoords?.();
            }
            canvas.calcOffset();
            canvas.requestRenderAll();

            const entry = (this.canvasesBySide[side] || []).find((e) => String(e.id) === String(area.id));
            if (entry) {
                entry.layout = layout;
            }
            this._applyEmptyCanvasMarginsForCanvas(canvas, side);
        }
        this._applyEmptyCanvasBackground(side);
    },

    _restructureEmptyCanvas(options = {}) {
        this._restructuringCanvas = true;
        try {
            for (const side of ["front", "back", "left", "right"]) {
                const element = document.getElementById(`${side}_canvas`);
                if (!element || !(this.canvasesBySide[side] || []).length) {
                    continue;
                }
                this._syncEmptyCanvasSide(element, side, options);
            }
        } finally {
            this._restructuringCanvas = false;
            this._rescaleAllTextures?.();
        }
    },

    /**
     * Compose a framed empty-canvas preview PNG: gray surround, white canvas,
     * design content, and a visible border so previews read as a physical sheet.
     */
    _exportEmptyCanvasPreviewDataUrl(entries, layout, opts = {}) {
        const stageW = layout.stageW || layout.canvasW || 394;
        const stageH = layout.stageH || layout.canvasH || 394;
        const side = opts.side || this.active_side || "front";
        const canvasBg = this._getEmptyCanvasBackground(side);
        const pad = Math.max(14, Math.round(Math.min(stageW, stageH) * 0.045));
        const border = Math.max(1, Math.round(Math.min(stageW, stageH) / 180));
        const outW = stageW + pad * 2;
        const outH = stageH + pad * 2;

        const out = document.createElement("canvas");
        out.width = outW;
        out.height = outH;
        const ctx = out.getContext("2d");
        if (!ctx) {
            return null;
        }

        ctx.fillStyle = "#eef0f3";
        ctx.fillRect(0, 0, outW, outH);

        ctx.fillStyle = canvasBg;
        ctx.fillRect(pad, pad, stageW, stageH);

        ctx.save();
        ctx.beginPath();
        ctx.rect(pad, pad, stageW, stageH);
        ctx.clip();
        ctx.translate(pad, pad);
        for (const entry of entries || []) {
            const fab = entry.canvas;
            if (!fab) {
                continue;
            }
            fab.discardActiveObject();
            fab.renderAll();
            ctx.drawImage(fab.lowerCanvasEl, 0, 0, stageW, stageH);
        }
        ctx.restore();

        ctx.strokeStyle = "#6b7280";
        ctx.lineWidth = border;
        ctx.strokeRect(
            pad + border / 2,
            pad + border / 2,
            stageW - border,
            stageH - border
        );

        const sizeLabel = this._formatEmptyCanvasSizeLabel(side);
        if (sizeLabel) {
            const fontSize = Math.max(11, Math.round(Math.min(stageW, stageH) / 28));
            ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
            ctx.fillStyle = "#4b5563";
            ctx.textAlign = "center";
            ctx.textBaseline = "bottom";
            ctx.fillText(sizeLabel, outW / 2, outH - Math.max(4, Math.round(pad * 0.35)));
        }

        const format = (opts.format || "png").toLowerCase();
        const quality = typeof opts.quality === "number" ? opts.quality : 1;
        return out.toDataURL(format === "jpeg" ? "image/jpeg" : "image/png", quality);
    },

    _parsePrintQualityPpi(code) {
        const match = String(code || "").trim().match(/_(\d+)x(\d+)$/);
        if (!match) {
            return [300, 300];
        }
        return [Math.max(1, parseInt(match[1], 10)), Math.max(1, parseInt(match[2], 10))];
    },

    _physicalSizeToPrintPixels(width, height, unit, dpiX = 300, dpiY = null) {
        const w = Number(width) || 0;
        const h = Number(height) || 0;
        if (w <= 0 || h <= 0) {
            return null;
        }
        const dx = Number(dpiX) || 300;
        const dy = Number(dpiY != null ? dpiY : dx) || dx;
        const unitKey = String(unit || "in").toLowerCase();
        let pxW;
        let pxH;
        if (unitKey === "mm") {
            pxW = Math.round((w * dx) / 25.4);
            pxH = Math.round((h * dy) / 25.4);
        } else if (unitKey === "cm") {
            pxW = Math.round((w * dx) / 2.54);
            pxH = Math.round((h * dy) / 2.54);
        } else if (unitKey === "px") {
            pxW = Math.round(w);
            pxH = Math.round(h);
        } else {
            pxW = Math.round(w * dx);
            pxH = Math.round(h * dy);
        }
        // Match server exact-size limit (do not crush 8x10 @ 600x1200 ≈ 12000px).
        const maxEdge = 20000;
        if (pxW > maxEdge || pxH > maxEdge) {
            const scale = maxEdge / Math.max(pxW, pxH);
            pxW = Math.max(1, Math.round(pxW * scale));
            pxH = Math.max(1, Math.round(pxH * scale));
        }
        return { width: Math.max(1, pxW), height: Math.max(1, pxH), dpiX: dx, dpiY: dy };
    },

    /**
     * Clean print sheet at exact product-page size × PPI (no grey frame / size label).
     */
    _exportEmptyCanvasExactPrintDataUrl(entries, layout, opts = {}) {
        const stageW = layout.stageW || layout.canvasW || 394;
        const stageH = layout.stageH || layout.canvasH || 394;
        const outW = Math.max(1, Math.round(opts.outputWidth || stageW));
        const outH = Math.max(1, Math.round(opts.outputHeight || stageH));
        const side = opts.side || this.active_side || "front";
        const canvasBg = this._getEmptyCanvasBackground(side);

        // Use per-axis scale so the physical card fills edge-to-edge without letterbox padding.
        const scaleX = outW / Math.max(stageW, 1);
        const scaleY = outH / Math.max(stageH, 1);

        const out = document.createElement("canvas");
        out.width = outW;
        out.height = outH;
        const ctx = out.getContext("2d");
        if (!ctx) {
            return null;
        }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.fillStyle = canvasBg;
        ctx.fillRect(0, 0, outW, outH);

        for (const entry of entries || []) {
            const fab = entry.canvas;
            if (!fab) {
                continue;
            }
            const activeBefore = fab.getActiveObject();
            if (activeBefore) {
                fab.discardActiveObject();
                fab.requestRenderAll();
            }

            // Render fabric canvas at the correct per-axis scale.
            // We render at scaleX, then stretch vertically by scaleY/scaleX when drawing.
            const renderScale = scaleX;
            let drawn = false;
            if (typeof fab.toCanvasElement === "function") {
                try {
                    const layer = fab.toCanvasElement(renderScale);
                    if (layer && layer.width >= 1 && layer.height >= 1) {
                        // Draw stretched to exact output size to remove letterbox padding.
                        ctx.drawImage(layer, 0, 0, outW, outH);
                        drawn = true;
                    }
                } catch (_err) {
                    drawn = false;
                }
            }
            if (!drawn && fab.lowerCanvasEl) {
                ctx.drawImage(fab.lowerCanvasEl, 0, 0, outW, outH);
            }
            if (activeBefore) {
                fab.setActiveObject(activeBefore);
                fab.requestRenderAll();
            }
        }
        const format = (opts.format || "png").toLowerCase();
        const quality = typeof opts.quality === "number" ? opts.quality : 1;
        return out.toDataURL(format === "jpeg" ? "image/jpeg" : "image/png", quality);
    },

    /**
     * Flat composite canvas for 3D baking (stage pixels, no preview frame padding).
     */
    _exportEmptyCanvasCompositeCanvas(entries, layout, opts = {}) {
        const stageW = layout.stageW || layout.canvasW || 394;
        const stageH = layout.stageH || layout.canvasH || 394;
        const side = opts.side || this.active_side || "front";
        const canvasBg = this._getEmptyCanvasBackground(side);

        // Scale bake canvas by device pixel ratio so 4K monitors get a full-res texture (up to 4096px)
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const baseTarget = Math.max(opts.maxSize || 3072, 3072);
        const targetLongest = Math.min(baseTarget * dpr, 4096);
        const stageLongest = Math.max(stageW, stageH, 1);
        const scale = Math.max(3, targetLongest / stageLongest);
        const outW = Math.max(1, Math.round(stageW * scale));
        const outH = Math.max(1, Math.round(stageH * scale));

        const out = document.createElement("canvas");
        out.width = outW;
        out.height = outH;
        const ctx = out.getContext("2d");
        if (!ctx) {
            return null;
        }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.fillStyle = canvasBg;
        ctx.fillRect(0, 0, outW, outH);

        for (const entry of entries || []) {
            const fab = entry.canvas;
            if (!fab) {
                continue;
            }
            const activeBefore = fab.getActiveObject();
            if (activeBefore) {
                fab.discardActiveObject();
            }
            fab.renderAll();
            let layer = null;
            if (typeof fab.toCanvasElement === "function") {
                try {
                    layer = fab.toCanvasElement(scale);
                } catch (err) {
                    layer = null;
                }
            }
            if (layer && layer.width >= 1 && layer.height >= 1) {
                ctx.drawImage(layer, 0, 0, outW, outH);
            } else if (fab.lowerCanvasEl) {
                ctx.drawImage(fab.lowerCanvasEl, 0, 0, outW, outH);
            }
            if (activeBefore) {
                fab.setActiveObject(activeBefore);
                fab.requestRenderAll();
            }
        }
        return out;
    },

    _ensureEmptyCanvasStageFooter(side) {
        const pane = document.getElementById(`${side}_canvas`);
        if (!pane || pane.querySelector(".tus-empty-canvas-stage-footer")) {
            return;
        }
        const label = this._formatEmptyCanvasSizeLabel(side);
        const bgColor = this._getEmptyCanvasBackground(side);
        const marginMm = this._getEmptyCanvasMarginMm(side);
        const maxMarginMm = this._getMaxAllowedEmptyCanvasMarginMm();
        const footer = document.createElement("div");
        footer.className = "tus-empty-canvas-stage-footer";
        footer.dataset.side = side;
        footer.innerHTML = `
            <div class="tus-empty-canvas-size-label">${label || ""}</div>
            <label class="tus-empty-canvas-margin-control">
                <span class="tus-empty-canvas-margin-label">${_t("Margin")} (mm)</span>
                <input type="number"
                       class="tus-empty-canvas-margin-input"
                       data-side="${side}"
                       min="0"
                       max="${maxMarginMm}"
                       step="0.5"
                       value="${marginMm}"
                       title="${_t("Uniform margin on all sides")}"/>
                <span class="tus-empty-canvas-margin-hint">${_t("All sides")}</span>
            </label>
            <label class="tus-empty-canvas-bg-control">
                <span class="tus-empty-canvas-bg-label">${_t("Canvas color")}</span>
                <input type="color"
                       class="tus-empty-canvas-bg-input"
                       data-side="${side}"
                       value="${bgColor}"
                       title="${_t("Canvas background color")}"/>
            </label>
        `;
        const stage = pane.querySelector(".product-stage");
        if (stage) {
            // Place chrome above canvas so mobile can stack full-width stage below.
            stage.insertAdjacentElement("beforebegin", footer);
        } else {
            pane.appendChild(footer);
        }
    },

    _bindEmptyCanvasChromeEvents() {
        if (this._emptyCanvasChromeBound) {
            return;
        }
        this._emptyCanvasChromeBound = true;
        $(document).on(
            "input change",
            ".tus-empty-canvas-bg-input",
            (ev) => {
                if (!this.emptyCanvasMode) {
                    return;
                }
                const side = ev.currentTarget.dataset.side || this.active_side;
                this._setEmptyCanvasBackground(side, ev.currentTarget.value);
                if (typeof this.saveState === "function") {
                    this.saveState();
                }
            }
        );
        $(document).on(
            "input change",
            ".tus-empty-canvas-margin-input",
            (ev) => {
                if (!this.emptyCanvasMode) {
                    return;
                }
                const side = ev.currentTarget.dataset.side || this.active_side;
                const margin = this._setEmptyCanvasMargin(side, ev.currentTarget.value);
                ev.currentTarget.value = String(margin);
                if (typeof this.saveState === "function") {
                    this.saveState();
                }
            }
        );
    },

    _syncEmptyCanvasChromeUi() {
        if (!this.emptyCanvasMode) {
            return;
        }
        const side = this.active_side || "front";
        const label = this._formatEmptyCanvasSizeLabel(side);
        $(`.tus-empty-canvas-stage-footer[data-side="${side}"] .tus-empty-canvas-size-label`).text(label);
        const $margin = $(`.tus-empty-canvas-margin-input[data-side="${side}"]`);
        if ($margin.length) {
            $margin.attr("max", String(this._getMaxAllowedEmptyCanvasMarginMm()));
            $margin.val(this._getEmptyCanvasMarginMm(side));
        }
        const $input = $(`.tus-empty-canvas-bg-input[data-side="${side}"]`);
        if ($input.length) {
            $input.val(this._getEmptyCanvasBackground(side));
        }
    },

    _syncEmptyCanvasFooterForSide(side) {
        const key = side || this.active_side || "front";
        const label = this._formatEmptyCanvasSizeLabel(key);
        $(`.tus-empty-canvas-stage-footer[data-side="${key}"] .tus-empty-canvas-size-label`).text(label);
        const $margin = $(`.tus-empty-canvas-margin-input[data-side="${key}"]`);
        if ($margin.length) {
            $margin.attr("max", String(this._getMaxAllowedEmptyCanvasMarginMm()));
            $margin.val(this._getEmptyCanvasMarginMm(key));
        }
    },

    _setupEmptyCanvasChrome() {
        if (!this.emptyCanvasMode) {
            return;
        }
        const $container = $(".fabric_container.tus-ref-layout");
        $container.addClass("tus-empty-canvas-mode");
        $(".tus-empty-canvas-size-badge").remove();

        const allowedSides = this.emptyCanvasSides === "both"
            ? ["front", "back"]
            : [this.emptyCanvasSides];
        for (const side of allowedSides) {
            this._ensureEmptyCanvasStageFooter(side);
        }
        for (const side of ["front", "back", "left", "right"]) {
            if (!allowedSides.includes(side)) {
                $(`#${side}-tab, .canvas-item[data-side="${side}"]`).closest("li, .canvas-item").addClass("d-none");
                $(`#${side}_canvas`).addClass("d-none");
            }
        }
        this._bindEmptyCanvasChromeEvents();
        this._syncEmptyCanvasMarginsHiddenInput();
        this._syncEmptyCanvasChromeUi();

        // Keep variant swap visible; only hide matrix/color-specific UI.
        $(".color-swap, .tus-matrix-overlay").addClass("d-none");

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                this._restructureEmptyCanvas({ preserveSelection: true });
                for (const allowedSide of allowedSides) {
                    this._applyEmptyCanvasMarginsForSide(allowedSide);
                }
            });
        });
    },
};
