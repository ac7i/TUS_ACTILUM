/** @odoo-module **/

import { _t } from "@web/core/l10n/translation";
import { normalizeDesignArea } from "../design_area_shapes";

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
        this.emptyCanvasBgBySide = {
            front: "#ffffff",
            back: "#ffffff",
            left: "#ffffff",
            right: "#ffffff",
        };
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
        };
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
        if (box) {
            box.style.background = color;
        }
        for (const entry of this.canvasesBySide[key] || []) {
            const canvas = entry?.canvas;
            if (!canvas) {
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

    _formatEmptyCanvasSizeLabel() {
        const { width, height, unit } = this.emptyCanvasActual || {};
        if (!width || !height) {
            return "";
        }
        return `${width} × ${height} ${unit || "in"}`;
    },

    _computeEmptyCanvasDisplaySize(stageW, stageH) {
        const sw = stageW || 394;
        const sh = stageH || 394;
        const maxW = Math.min(720, Math.max(320, window.innerWidth * 0.72));
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

    _applyEmptyCanvasBoxLayout(box, container, stageW, stageH, side) {
        const { displayW, displayH } = this._computeEmptyCanvasDisplaySize(stageW, stageH);
        const bgColor = this._getEmptyCanvasBackground(side);
        box.style.boxSizing = "border-box";
        box.style.width = `${displayW}px`;
        box.style.height = `${displayH}px`;
        box.style.minWidth = `${displayW}px`;
        box.style.minHeight = `${displayH}px`;
        box.style.maxWidth = "100%";
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
    },

    _applyEmptyCanvasAreaLayout(wrapper, layout) {
        wrapper.style.left = "0";
        wrapper.style.top = "0";
        wrapper.style.right = "0";
        wrapper.style.bottom = "0";
        wrapper.style.width = "100%";
        wrapper.style.height = "100%";
        wrapper.style.inset = "0";
        wrapper.style.margin = "0";
        wrapper.style.padding = "0";
        const fabricContainer = wrapper.querySelector(".canvas-container");
        if (fabricContainer) {
            fabricContainer.style.width = "100%";
            fabricContainer.style.height = "100%";
        }
        const canvasEl = wrapper.querySelector("canvas.design-area-canvas");
        if (canvasEl) {
            canvasEl.style.width = "100%";
            canvasEl.style.height = "100%";
        }
        if (layout) {
            wrapper.dataset.layoutW = String(layout.canvasW);
            wrapper.dataset.layoutH = String(layout.canvasH);
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

        const layout = this._buildEmptyCanvasLayout(baseW, baseH);

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
        canvasEl.style.width = "100%";
        canvasEl.style.height = "100%";

        wrapper.appendChild(canvasEl);
        container.appendChild(wrapper);

        const fabricCanvas = new fabric.Canvas(canvasEl, {
            preserveObjectStacking: true,
            selection: true,
        });

        this._applyDesignAreaGeometry(fabricCanvas, wrapper, area, layout);
        this._applyEmptyCanvasAreaLayout(wrapper, layout);

        fabricCanvas._wrapperEl = wrapper;
        fabricCanvas._baseW = canvasEl.width;
        fabricCanvas._baseH = canvasEl.height;
        fabricCanvas._lastW = canvasEl.width;
        fabricCanvas._lastH = canvasEl.height;
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
        fabricCanvas.requestRenderAll();
    },

    _buildEmptyCanvasLayout(stageW, stageH) {
        const { displayW, displayH } = this._computeEmptyCanvasDisplaySize(stageW, stageH);
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
        const layout = this._buildEmptyCanvasLayout(stageW, stageH);
        const areas = this[`${side}AreasData`] || [];

        for (const area of areas) {
            const wrapper = element.querySelector(`.design-area[data-area-id="${area.id}"]`);
            const canvas = this.fabricByAreaId[area.id];
            if (!wrapper || !canvas) {
                continue;
            }
            this._applyEmptyCanvasAreaLayout(wrapper, layout);

            const activeObj = preserveSelection ? canvas.getActiveObject() : null;
            const oldW = canvas.getWidth();
            const oldH = canvas.getHeight();
            const newW = layout.canvasW;
            const newH = layout.canvasH;
            if (oldW > 0 && oldH > 0 && (oldW !== newW || oldH !== newH)) {
                const scaleX = newW / oldW;
                const scaleY = newH / oldH;
                canvas.getObjects().forEach((obj) => {
                    if (obj.center_line) {
                        return;
                    }
                    obj.scaleX = (obj.scaleX || 1) * scaleX;
                    obj.scaleY = (obj.scaleY || 1) * scaleY;
                    obj.left = (obj.left || 0) * scaleX;
                    obj.top = (obj.top || 0) * scaleY;
                    obj.setCoords();
                });
            }
            canvas.setWidth(newW);
            canvas.setHeight(newH);
            canvas.lowerCanvasEl.width = newW;
            canvas.lowerCanvasEl.height = newH;
            canvas.upperCanvasEl.width = newW;
            canvas.upperCanvasEl.height = newH;
            canvas._baseW = newW;
            canvas._baseH = newH;
            canvas._lastW = newW;
            canvas._lastH = newH;
            this._applyEmptyCanvasAreaLayout(wrapper, layout);
            canvas.calcOffset();
            if (activeObj) {
                canvas.setActiveObject(activeObj);
            }
            canvas.requestRenderAll();

            const entry = (this.canvasesBySide[side] || []).find((e) => String(e.id) === String(area.id));
            if (entry) {
                entry.layout = layout;
            }
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

        const sizeLabel = this._formatEmptyCanvasSizeLabel();
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

    /**
     * Flat composite canvas for 3D baking (stage pixels, no preview frame padding).
     */
    _exportEmptyCanvasCompositeCanvas(entries, layout, opts = {}) {
        const stageW = layout.stageW || layout.canvasW || 394;
        const stageH = layout.stageH || layout.canvasH || 394;
        const side = opts.side || this.active_side || "front";
        const canvasBg = this._getEmptyCanvasBackground(side);
        const maxSize = opts.maxSize || Math.max(stageW, stageH, 1024);

        let outW = stageW;
        let outH = stageH;
        const longest = Math.max(outW, outH);
        if (longest > maxSize) {
            const ratio = maxSize / longest;
            outW = Math.max(1, Math.round(outW * ratio));
            outH = Math.max(1, Math.round(outH * ratio));
        }

        const out = document.createElement("canvas");
        out.width = outW;
        out.height = outH;
        const ctx = out.getContext("2d");
        if (!ctx) {
            return null;
        }
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
            const layer = fab.lowerCanvasEl;
            if (layer && layer.width >= 1 && layer.height >= 1) {
                ctx.drawImage(layer, 0, 0, outW, outH);
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
        const label = this._formatEmptyCanvasSizeLabel();
        const bgColor = this._getEmptyCanvasBackground(side);
        const footer = document.createElement("div");
        footer.className = "tus-empty-canvas-stage-footer";
        footer.dataset.side = side;
        footer.innerHTML = `
            <div class="tus-empty-canvas-size-label">${label || ""}</div>
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
            stage.insertAdjacentElement("afterend", footer);
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
    },

    _syncEmptyCanvasChromeUi() {
        if (!this.emptyCanvasMode) {
            return;
        }
        const side = this.active_side || "front";
        const label = this._formatEmptyCanvasSizeLabel();
        $(`.tus-empty-canvas-stage-footer .tus-empty-canvas-size-label`).text(label);
        const $input = $(`.tus-empty-canvas-bg-input[data-side="${side}"]`);
        if ($input.length) {
            $input.val(this._getEmptyCanvasBackground(side));
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
        this._syncEmptyCanvasChromeUi();

        // Keep variant swap visible; only hide matrix/color-specific UI.
        $(".color-swap, .tus-matrix-overlay").addClass("d-none");

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                this._restructureEmptyCanvas({ preserveSelection: true });
            });
        });
    },
};
