/** @odoo-module */
import { Dialog } from "@web/core/dialog/dialog";
import { useService } from "@web/core/utils/hooks";
import { _t } from "@web/core/l10n/translation";
import {Component, onWillStart, useRef, onMounted, useState} from "@odoo/owl";
import { imageUrl } from "@web/core/utils/urls";
import { isBinarySize } from "@web/core/utils/binary";
import { FileUploader } from "@web/views/fields/file_handler";
import { loadJS } from "@web/core/assets";
import { fileTypeMagicWordMap } from "@web/views/fields/image/image_field";
import { areaBounds } from "./design_area_shapes";

export class BackendFabricDialog extends Component {
    static components = { Dialog, FileUploader };
    static template = "tus_product_personalizer.BackendFabricDialog";
    static props = {
        record: { type: Object, optional: true },
        close: { type: Function, optional: true },
        is_edit: { type: Boolean, optional: true },
    };

    setup() {
        this.orm = useService("orm");
        this.notification = useService("notification");
        this.previewWrapper = useRef("preview_wrapper");
        this.previewImage = useRef("preview_img");
        this.canvasContainer = useRef("canvas_design")
        this.state = useState({
            'image_url': this.getImageUrl("thumbnail"),
            'image_side': this.props?.record?.data?.title || 'front',
            'enableDesignPrice': false,
            'wizardMode': 'select', // select | draw_polygon
            'drawPointCount': 0,
            'activeAreaShape': 'rect',
        });
        // multiple areas
        this.designAreas = new Map();
        this.activeAreaId = null;
        this._polygonDrawPoints = [];
        this._polygonDrawPreview = null;
        this._polygonDrawMarkers = [];
        this._polygonVertexEditId = null;
        // Stage sizing (base coordinate system for design areas). Keep a stable default.
        this.DEFAULT_STAGE = { w: 394, h: 394 };
        this.stage = {
            width: this.props?.record?.data?.stage_width || this.DEFAULT_STAGE.w,
            height: this.props?.record?.data?.stage_height || this.DEFAULT_STAGE.h,
            image_width: this.props?.record?.data?.image_width || 0,
            image_height: this.props?.record?.data?.image_height || 0,
        };

        onWillStart(async () => {
            await loadJS("https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.1/fabric.js");
            const websites = await this.orm.searchRead("website", [], ["personalizer_enable_design_price"], { limit: 1 });
            if (websites && websites.length > 0) {
                this.state.enableDesignPrice = websites[0].personalizer_enable_design_price;
            }
        })
        onMounted(() => {
            this.createCanvas()
            this.canvas = new fabric.Canvas("CanvasDesign");

            fabric.Object.prototype.controls.mtr.visible = false;

            // Coherent calibration anchored on inches:
            const REF = { px: 112, inch: 0.75 }; // 112 px == 0.75 inch
            const pxPerInch = REF.px / REF.inch;            // ≈ 149.3333333
            this.CAL = {
                pxPerInch,
                pxPerMillimeter: pxPerInch / 25.4,         // derive from inch
                pxPerCentimeter: pxPerInch / 2.54,         // derive from inch
            };

            this.unit = "inch"; // default

            this._resizeCanvasToContainer();
            window.addEventListener("resize", () => this._resizeCanvasToContainer(), { passive: true });

            this.canvas.selection = false;
            fabric.Object.prototype.transparentCorners = false;
            fabric.Object.prototype.cornerStyle = "circle";
            fabric.Object.prototype.cornerColor = "#2b90ff";

            const syncIfDesignArea = (e) => {
                const t = e?.target;
                if (t && t.custom && t.custom.kind === "design_area") {
                    if (t.type === "polygon") {
                        this._clampShapeWithinCanvas(t);
                        const area = this.designAreas.get(t.custom.id);
                        if (area) {
                            area.storedPoints = this._polygonAbsolutePoints(t);
                        }
                    } else {
                        this._clampRectWithinCanvas(t);
                    }
                    if (this.activeAreaId === t.custom.id) {
                        this._syncInputsFromRect(t);
                    }
                }
            };
            this.canvas.on("object:moving", syncIfDesignArea);
            this.canvas.on("object:scaling", syncIfDesignArea);
            this.canvas.on("object:modified", syncIfDesignArea);

            this._onCanvasMouseDown = (opt) => this._handleCanvasMouseDown(opt);
            this.canvas.on("mouse:down", this._onCanvasMouseDown);

            this.canvas.on("selection:created", (e) => {
                const t = e?.selected?.[0];
                if (t && t.custom && t.custom.kind === "design_area") {
                    this._setActiveArea(t.custom.id);
                }
            });
            this.canvas.on("selection:updated", (e) => {
                const t = e?.selected?.[0];
                if (t && t.custom && t.custom.kind === "design_area") {
                    this._setActiveArea(t.custom.id);
                }
            });
            this.canvas.on("selection:cleared", () => {
                if (this.state.wizardMode === "draw_polygon") {
                    return;
                }
                if (this.activeAreaId) {
                    const area = this.designAreas.get(this.activeAreaId);
                    const shape = this._getShapeObject(area);
                    if (shape) {
                        this.canvas.setActiveObject(shape);
                    }
                }
            });

            const unitSel = document.getElementById("unit");
            unitSel && unitSel.addEventListener("change", (ev) => {
                this._setUnit(ev.target.value);
            });

            ["design_width", "design_height", "design_top", "design_left", "area_price"].forEach((id) => {
                const el = document.getElementById(id);
                el && el.addEventListener("input", () => this._syncRectFromInputs());
                el && el.addEventListener("change", () => this._syncRectFromInputs());
            });

            // NEW: listen to actual width/height inputs
            const aw = document.getElementById("actual_width");
            const ah = document.getElementById("actual_height");
            const onActualChange = () => this._syncActualFromInputs();
            aw && aw.addEventListener("input", onActualChange);
            aw && aw.addEventListener("change", onActualChange);
            ah && ah.addEventListener("input", onActualChange);
            ah && ah.addEventListener("change", onActualChange);

            this._updateUnitSuffix();

            // Load existing areas from the record and select the first one
            this._initFromRecord();
            // Apply stage sizing from record/image
            this._bindPreviewImageEvents();
            this._applyStageToDomAndCanvas();
        })
    }

    getImageUrl(imageFieldName = "thumbnail") {
        try {
            const rec = this.props?.record;
            const placeholder = "/web/static/img/placeholder.png";
            if (!rec?.data) {
                return placeholder;
            }
            const value = rec.data[imageFieldName];
            if (!value) {
                return placeholder;
            }

            // If value is a binary size (stored on server), build /web/image/... URL
            if (isBinarySize(value) && rec.resModel && rec.resId) {
                const unique = rec.data.write_date;
                return imageUrl(rec.resModel, rec.resId, imageFieldName, { unique });
            }

            // Otherwise assume it's base64 data (in-memory), build a data URI
            const magic = fileTypeMagicWordMap[value?.[0]] || "png";
            return `data:image/${magic};base64,${value}`;
        } catch (e) {
            return "/web/static/img/placeholder.png";
        }
    }

    async onFileUploaded(info) {
        if(this.previewImage.el) {
            this.state.image_url = `data:${info.type};base64,${info.data}`
            this.imageField = info.data
            this._resizeCanvasToContainer();
        }
    }

    onAddDesignArea() {
        if (!this._hasBackgroundImage()) {
            this.notification?.add(_t("Please upload/select an image before adding a design area."), { type: "warning" });
            return;
        }
        this._exitPolygonDrawMode(false);
        const idx = this.designAreas.size + 1;
        const name = `Design Area ${idx}`;
        this.state.wizardMode = "select";
        this._createDesignRect({ name });
    }

    onStartDrawPolygon() {
        if (!this._hasBackgroundImage()) {
            this.notification?.add(_t("Please upload/select an image before drawing."), { type: "warning" });
            return;
        }
        this._exitPolygonVertexEdit();
        this.canvas.discardActiveObject();
        this._clearPolygonDrawPreview();
        this._polygonDrawPoints = [];
        this.state.wizardMode = "draw_polygon";
        this.state.drawPointCount = 0;
        this._setDesignAreasEvented(false);
        this.canvas.defaultCursor = "crosshair";
        this.canvas.hoverCursor = "crosshair";
        if (this.canvasContainer?.el) {
            this.canvasContainer.el.classList.add("tus-wizard-drawing-polygon");
        }
        this.notification?.add(
            _t("Click on the mockup to place corners. Click near the first point or press Complete shape to close."),
            { type: "info" }
        );
        this.canvas.requestRenderAll();
    }

    onCancelDrawPolygon() {
        this._exitPolygonDrawMode(false);
    }

    onFinishDrawPolygon() {
        this._completePolygonDraw();
    }

    onUndoDrawPoint() {
        if (!this._polygonDrawPoints.length) {
            return;
        }
        this._polygonDrawPoints.pop();
        const lastMarker = this._polygonDrawMarkers.pop();
        if (lastMarker) {
            this.canvas.remove(lastMarker);
        }
        this._refreshPolygonDrawPreview();
        this.state.drawPointCount = this._polygonDrawPoints.length;
        this.canvas.requestRenderAll();
    }

    onEditPolygonVertices() {
        const area = this.activeAreaId ? this.designAreas.get(this.activeAreaId) : null;
        if (!area?.poly) {
            return;
        }
        this._exitPolygonDrawMode(false);
        this._enterPolygonVertexEdit(area);
    }

    _getStageSize() {
        return {
            w: Math.max(1, this.stage.width || this.DEFAULT_STAGE.w),
            h: Math.max(1, this.stage.height || this.DEFAULT_STAGE.h),
        };
    }

    _stageToCanvasPoint(sx, sy) {
        const stage = this._getStageSize();
        const cw = Math.max(1, this.canvas?.getWidth() || stage.w);
        const ch = Math.max(1, this.canvas?.getHeight() || stage.h);
        return { x: (sx * cw) / stage.w, y: (sy * ch) / stage.h };
    }

    _canvasToStagePoint(cx, cy) {
        const stage = this._getStageSize();
        const cw = Math.max(1, this.canvas?.getWidth() || stage.w);
        const ch = Math.max(1, this.canvas?.getHeight() || stage.h);
        return { x: (cx * stage.w) / cw, y: (cy * stage.h) / ch };
    }

    _setDesignAreasEvented(enabled) {
        if (!this.canvas) {
            return;
        }
        this.canvas.getObjects().forEach((obj) => {
            if (obj?.custom?.kind === "design_area") {
                obj.evented = enabled;
                obj.selectable = enabled;
            }
        });
    }

    _handleCanvasMouseDown(opt) {
        if (this.state.wizardMode !== "draw_polygon" || !this.canvas) {
            return;
        }
        if (opt.target && opt.target !== this._polygonDrawPreview && !opt.target.custom?.drawMarker) {
            return;
        }
        const pointer = this.canvas.getPointer(opt.e);
        if (this._polygonDrawPoints.length >= 3) {
            const first = this._polygonDrawPoints[0];
            const dist = Math.hypot(pointer.x - first.x, pointer.y - first.y);
            if (dist < 12) {
                this._completePolygonDraw();
                return;
            }
        }
        this._polygonDrawPoints.push({ x: pointer.x, y: pointer.y });
        const marker = new fabric.Circle({
            left: pointer.x,
            top: pointer.y,
            radius: 5,
            fill: "#2b90ff",
            stroke: "#fff",
            strokeWidth: 2,
            originX: "center",
            originY: "center",
            selectable: false,
            evented: false,
            custom: { drawMarker: true },
        });
        this._polygonDrawMarkers.push(marker);
        this.canvas.add(marker);
        this._refreshPolygonDrawPreview();
        this.state.drawPointCount = this._polygonDrawPoints.length;
        this.canvas.requestRenderAll();
    }

    _refreshPolygonDrawPreview() {
        if (this._polygonDrawPreview) {
            this.canvas.remove(this._polygonDrawPreview);
            this._polygonDrawPreview = null;
        }
        if (this._polygonDrawPoints.length < 2) {
            return;
        }
        const pts = this._polygonDrawPoints.map((p) => ({ x: p.x, y: p.y }));
        this._polygonDrawPreview = new fabric.Polyline(pts, {
            fill: "rgba(43,144,255,0.08)",
            stroke: "#2b90ff",
            strokeWidth: 2,
            strokeDashArray: [6, 4],
            selectable: false,
            evented: false,
            objectCaching: false,
        });
        this.canvas.add(this._polygonDrawPreview);
        this._polygonDrawPreview.sendToBack();
        this._polygonDrawMarkers.forEach((m) => m.bringToFront());
    }

    _clearPolygonDrawPreview() {
        if (this._polygonDrawPreview) {
            this.canvas.remove(this._polygonDrawPreview);
            this._polygonDrawPreview = null;
        }
        this._polygonDrawMarkers.forEach((m) => this.canvas.remove(m));
        this._polygonDrawMarkers = [];
        this._polygonDrawPoints = [];
        this.state.drawPointCount = 0;
    }

    _exitPolygonDrawMode(complete = false) {
        if (!complete) {
            this._clearPolygonDrawPreview();
        }
        this.state.wizardMode = "select";
        this._setDesignAreasEvented(true);
        if (this.canvas) {
            this.canvas.defaultCursor = "default";
            this.canvas.hoverCursor = "move";
        }
        if (this.canvasContainer?.el) {
            this.canvasContainer.el.classList.remove("tus-wizard-drawing-polygon");
        }
    }

    _completePolygonDraw() {
        if (this._polygonDrawPoints.length < 3) {
            this.notification?.add(_t("Add at least 3 points to create a shape."), { type: "warning" });
            return;
        }
        const stagePoints = this._polygonDrawPoints.map((p) => {
            const s = this._canvasToStagePoint(p.x, p.y);
            return [Math.round(s.x * 10) / 10, Math.round(s.y * 10) / 10];
        });
        const idx = this.designAreas.size + 1;
        this._clearPolygonDrawPreview();
        this._exitPolygonDrawMode(true);
        this._createDesignPolygonFromData({
            id: `area_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
            name: `Custom shape ${idx}`,
            points: stagePoints,
            color: this._colorForIndex(this.designAreas.size),
            meta: { actual: { unit: this.unit, width: 0, height: 0 }, price: 0 },
        });
    }

    _enterPolygonVertexEdit(area) {
        this._exitPolygonVertexEdit();
        const poly = area.poly;
        if (!poly) {
            return;
        }
        this._polygonVertexEditId = area.id;
        poly.selectable = false;
        poly.evented = false;
        area.vertexHandles = [];
        const stagePts = this._polygonAbsolutePoints(poly);
        stagePts.forEach(([sx, sy], index) => {
            const c = this._stageToCanvasPoint(sx, sy);
            const handle = new fabric.Circle({
                left: c.x,
                top: c.y,
                radius: 6,
                fill: "#fff",
                stroke: poly.stroke || "#2b90ff",
                strokeWidth: 2,
                originX: "center",
                originY: "center",
                hasControls: false,
                hasBorders: false,
                custom: { vertexHandle: true, areaId: area.id, vertexIndex: index },
            });
            handle.on("moving", () => {
                const s = this._canvasToStagePoint(handle.left, handle.top);
                stagePts[index] = [s.x, s.y];
                this._rebuildPolygonFromStagePoints(area, stagePts);
            });
            handle.on("modified", () => {
                const s = this._canvasToStagePoint(handle.left, handle.top);
                stagePts[index] = [s.x, s.y];
                this._rebuildPolygonFromStagePoints(area, stagePts);
                this._syncInputsFromRect(area.poly);
            });
            area.vertexHandles.push(handle);
            this.canvas.add(handle);
        });
        this.state.wizardMode = "edit_vertices";
        this.canvas.requestRenderAll();
    }

    _rebuildPolygonFromStagePoints(area, stagePoints) {
        const canvasPoints = stagePoints.map(([sx, sy]) => this._stageToCanvasPoint(sx, sy));
        const poly = area.poly;
        if (!poly) {
            return;
        }
        const { left, top, points } = this._normalizeCanvasPolygonPoints(canvasPoints);
        poly.set({ left, top, points, scaleX: 1, scaleY: 1 });
        poly.setCoords();
        area.storedPoints = stagePoints.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
        this.canvas.requestRenderAll();
    }

    _exitPolygonVertexEdit() {
        if (!this._polygonVertexEditId) {
            return;
        }
        const area = this.designAreas.get(this._polygonVertexEditId);
        if (area?.vertexHandles) {
            area.vertexHandles.forEach((h) => this.canvas.remove(h));
            area.vertexHandles = [];
        }
        if (area?.poly) {
            area.poly.selectable = true;
            area.poly.evented = true;
        }
        this._polygonVertexEditId = null;
        if (this.state.wizardMode === "edit_vertices") {
            this.state.wizardMode = "select";
        }
        this.canvas?.requestRenderAll();
    }

    createCanvas() {
        var canvas = document.createElement("canvas");
        canvas.id = "CanvasDesign";
        canvas.style.position = "absolute";
        canvas.style.top = "0";
        canvas.style.left = "0";
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.style.pointerEvents = "auto";
        this.canvasContainer.el.appendChild(canvas);
    }

    _bindPreviewImageEvents() {
        const img = this.previewImage?.el;
        if (!img || img._tusBound) return;
        img._tusBound = true;
        img.addEventListener("load", () => {
            this._syncStageFromImage();
            this._applyStageToDomAndCanvas();
        });
        img.addEventListener("error", () => {
            // Fallback to default stage so UI remains usable
            this.stage.width = this.DEFAULT_STAGE.w;
            this.stage.height = this.DEFAULT_STAGE.h;
            this.stage.image_width = 0;
            this.stage.image_height = 0;
            this._applyStageToDomAndCanvas();
        });
    }

    _syncStageFromImage() {
        const img = this.previewImage?.el;
        if (!img) return;
        const nw = img.naturalWidth || 0;
        const nh = img.naturalHeight || 0;
        this.stage.image_width = nw;
        this.stage.image_height = nh;

        // Keep coordinate system stable-ish: max dimension 394, other dimension follows aspect ratio.
        if (nw > 0 && nh > 0) {
            const aspect = nw / nh;
            if (aspect >= 1) {
                // landscape or square
                this.stage.width = this.DEFAULT_STAGE.w;
                this.stage.height = Math.max(1, Math.round(this.DEFAULT_STAGE.w / aspect));
            } else {
                // portrait
                this.stage.height = this.DEFAULT_STAGE.h;
                this.stage.width = Math.max(1, Math.round(this.DEFAULT_STAGE.h * aspect));
            }
        } else {
            this.stage.width = this.stage.width || this.DEFAULT_STAGE.w;
            this.stage.height = this.stage.height || this.DEFAULT_STAGE.h;
        }
    }

    _applyStageToDomAndCanvas() {
        const w = Math.max(1, Math.round(this.stage.width || this.DEFAULT_STAGE.w));
        const h = Math.max(1, Math.round(this.stage.height || this.DEFAULT_STAGE.h));

        if (this.previewWrapper?.el) {
            this.previewWrapper.el.style.width = `${w}px`;
            this.previewWrapper.el.style.height = `${h}px`;
        }
        if (this.canvasContainer?.el) {
            this.canvasContainer.el.style.width = `${w}px`;
            this.canvasContainer.el.style.height = `${h}px`;
        }
        this._resizeCanvasToContainer();
    }

    // --- Unit helpers ---
    _setUnit(newUnit) {
        const supported = new Set(["px", "inch", "millimeter", "centimeter"]);
        if (!supported.has(newUnit)) return;
        const prevUnit = this.unit;
        if (prevUnit === newUnit) {
            this._updateUnitSuffix();
            const rect = this._getActiveRect();
            if (rect) {
                this._syncInputsFromRect(rect);
                this._syncActualInputsFromArea();
            }
            return;
        }

        this.unit = newUnit;

        // Convert all existing areas' meta.actual values from prevUnit -> newUnit
        this._convertAllActualMetaUnits(prevUnit, newUnit);

        this._updateUnitSuffix();

        // Reflect selection in the <select id="unit">
        const unitSel = document.getElementById("unit");
        if (unitSel && unitSel.value !== newUnit) {
            unitSel.value = newUnit;
        }

        const rect = this._getActiveRect();
        if (rect) {
            this._syncInputsFromRect(rect);
            this._syncActualInputsFromArea();
        }
    }

    _updateUnitSuffix() {
        const suffixMap = {
            px: "px",
            inch: "in",
            millimeter: "mm",
            centimeter: "cm",
        };
        const suffix = suffixMap[this.unit] || "";

        const spans = document.querySelectorAll(".input-group-text");
        spans.forEach((s) => {
            const prev = s.previousElementSibling;
            if (!prev) return;
            const id = prev.id;
            if (["design_width", "design_height"].includes(id)) {
                s.textContent = suffix;
            }
            if (["actual_width", "actual_height"].includes(id)) {
                s.textContent = suffix;
            }
        });
    }

    _pxToUnit(px) {
        switch (this.unit) {
            case "px": return px;
            case "inch": return px / this.CAL.pxPerInch;
            case "millimeter": return px / this.CAL.pxPerMillimeter;
            case "centimeter": return px / this.CAL.pxPerCentimeter;
            default: return px;
        }
    }

    _unitToPx(val) {
        switch (this.unit) {
            case "px": return val;
            case "inch": return val * this.CAL.pxPerInch;
            case "millimeter": return val * this.CAL.pxPerMillimeter;
            case "centimeter": return val * this.CAL.pxPerCentimeter;
            default: return val;
        }
    }

    // --- Helpers for design area box ---
    _resizeCanvasToContainer() {
        if (!this.canvas || !this.canvasContainer?.el) return;
        const rect = this.canvasContainer.el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
            // Last-resort fallback (should rarely happen due to _applyStageToDomAndCanvas)
            this.canvasContainer.el.style.width = this.canvasContainer.el.style.width || `${this.DEFAULT_STAGE.w}px`;
            this.canvasContainer.el.style.height = this.canvasContainer.el.style.height || `${this.DEFAULT_STAGE.h}px`;
        }
        const r = this.canvasContainer.el.getBoundingClientRect();
        this.canvas.setWidth(r.width);
        this.canvas.setHeight(r.height);
        this.canvas.renderAll();
        for (const area of this.designAreas.values()) {
            const shape = this._getShapeObject(area);
            if (!shape) {
                continue;
            }
            if (area.shape === "polygon" && area.storedPoints) {
                this._rebuildPolygonFromStagePoints(area, area.storedPoints);
                this._clampShapeWithinCanvas(shape);
            } else if (area.rect) {
                this._clampRectWithinCanvas(area.rect);
            }
        }
        this.canvas.requestRenderAll();
    }

    _createDesignRect({ name = null, color = null } = {}) {
        if (!this.canvas) return;
        const cw = this.canvas.getWidth();
        const ch = this.canvas.getHeight();

        const w = Math.max(50, cw * 0.5);
        const h = Math.max(50, ch * 0.5);
        const left = (cw - w) / 2;
        const top = (ch - h) / 2;

        const id = `area_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
        const strokeColor = color || this._colorForIndex(this.designAreas.size);

        const rect = new fabric.Rect({
            left,
            top,
            width: w,
            height: h,
            fill: "rgba(0,0,0,0)",
            stroke: strokeColor,
            strokeWidth: 2,
            strokeDashArray: [6, 6],
            selectable: true,
            hasControls: true,
            hasBorders: true,
            lockRotation: true,
            lockScalingX: false,
            lockScalingY: false,
            objectCaching: false,
            cornerSize: 12,
            transparentCorners: false,
            hoverCursor: "move",
            name: name || id,
            originX: "left",
            originY: "top",
        });
        rect.setControlsVisibility({ mtr: false });
        rect.custom = { kind: "design_area", id };

        this._addDeleteControl(rect);

        this.canvas.add(rect);
        this.canvas.setActiveObject(rect);
        this._clampRectWithinCanvas(rect);

        // Initialize meta.actual in the CURRENT UI unit (not forced "inch")
        this.designAreas.set(id, {
            id,
            rect,
            name: name || id,
            color: strokeColor,
            meta: {
                actual: {
                    unit: this.unit,
                    width: 0,
                    height: 0,
                },
                price: 0,
            },
        });

        this._setActiveArea(id);
        this._syncInputsFromRect(rect);
        this.canvas.requestRenderAll();
    }

    _createDesignRectFromData(areaData) {
        if (!this.canvas) return;
        const id = areaData.id || `area_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
        const name = areaData.name || id;
        const strokeColor = areaData.color || this._colorForIndex(this.designAreas.size);

        let left = areaData.left;
        let top = areaData.top;
        let width = areaData.width;
        let height = areaData.height;

        if ((left == null || top == null || width == null || height == null) && areaData.in_units) {
            const u = areaData.in_units.unit || "inch";
            left = left ?? this._toPxFromUnit(u, areaData.in_units.left ?? 0);
            top = top ?? this._toPxFromUnit(u, areaData.in_units.top ?? 0);
            width = width ?? this._toPxFromUnit(u, areaData.in_units.width ?? 0);
            height = height ?? this._toPxFromUnit(u, areaData.in_units.height ?? 0);
        }

        const cw = this.canvas.getWidth();
        const ch = this.canvas.getHeight();

        // Backward compat: records saved during stage-space experiment
        if (areaData.coord_space === "stage") {
            const stageSize = this._getStageSize();
            left = (left / stageSize.w) * cw;
            top = (top / stageSize.h) * ch;
            width = (width / stageSize.w) * cw;
            height = (height / stageSize.h) * ch;
        }

        width = Math.max(30, Math.min(width ?? cw * 0.4, cw));
        height = Math.max(30, Math.min(height ?? ch * 0.4, ch));
        left = Math.max(0, Math.min(left ?? (cw - width) / 2, Math.max(0, cw - width)));
        top = Math.max(0, Math.min(top ?? (ch - height) / 2, Math.max(0, ch - height)));

        const rect = new fabric.Rect({
            left,
            top,
            width,
            height,
            fill: "rgba(0,0,0,0)",
            stroke: strokeColor,
            strokeWidth: 2,
            strokeDashArray: [6, 6],
            selectable: true,
            hasControls: true,
            hasBorders: true,
            lockRotation: true,
            lockScalingX: false,
            lockScalingY: false,
            objectCaching: false,
            cornerSize: 12,
            transparentCorners: false,
            hoverCursor: "move",
            name,
            originX: "left",
            originY: "top",
        });
        rect.setControlsVisibility({ mtr: false });
        rect.custom = { kind: "design_area", id };

        this._addDeleteControl(rect);

        this.canvas.add(rect);
        this._clampRectWithinCanvas(rect);

        // Preserve saved meta.actual if present
        const meta = areaData.meta || {};
        if (!meta.actual) {
            meta.actual = { unit: this.unit, width: 0, height: 0 };
        }
        if (meta.price == null) {
            meta.price = 0;
        }

        this.designAreas.set(id, {
            id,
            rect,
            shape: "rect",
            name,
            color: strokeColor,
            meta,
        });
    }

    _normalizeCanvasPolygonPoints(canvasPoints) {
        if (!canvasPoints.length) {
            return { left: 0, top: 0, points: [] };
        }
        const xs = canvasPoints.map((p) => p.x);
        const ys = canvasPoints.map((p) => p.y);
        const left = Math.min(...xs);
        const top = Math.min(...ys);
        const points = canvasPoints.map((p) => ({ x: p.x - left, y: p.y - top }));
        return { left, top, points };
    }

    _createDesignPolygonFromData(areaData) {
        if (!this.canvas) return;
        const id = areaData.id || `area_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
        const name = areaData.name || id;
        const strokeColor = areaData.color || this._colorForIndex(this.designAreas.size);
        const canvasPoints = (areaData.points || []).map(([sx, sy]) => {
            const c = this._stageToCanvasPoint(sx, sy);
            return { x: c.x, y: c.y };
        });
        const { left, top, points } = this._normalizeCanvasPolygonPoints(canvasPoints);

        const poly = new fabric.Polygon(points, {
            left,
            top,
            fill: "rgba(0,0,0,0)",
            stroke: strokeColor,
            strokeWidth: 2,
            strokeDashArray: [6, 6],
            selectable: true,
            hasControls: true,
            hasBorders: true,
            objectCaching: false,
            cornerSize: 12,
            transparentCorners: false,
            hoverCursor: "move",
            name,
            originX: "left",
            originY: "top",
        });
        poly.setControlsVisibility({ mtr: false });
        poly.custom = { kind: "design_area", id };

        this._addDeleteControl(poly);
        this.canvas.add(poly);
        this._clampShapeWithinCanvas(poly);

        const meta = areaData.meta || {};
        if (!meta.actual) {
            meta.actual = { unit: this.unit, width: 0, height: 0 };
        }
        if (meta.price == null) {
            meta.price = 0;
        }
        const storedPoints = (areaData.points || []).map(([x, y]) => [
            Math.round(x * 10) / 10,
            Math.round(y * 10) / 10,
        ]);
        this.designAreas.set(id, {
            id,
            poly,
            shape: "polygon",
            name,
            color: strokeColor,
            meta,
            storedPoints,
        });
        this._setActiveArea(id);
    }

    _clampShapeWithinCanvas(shapeObj) {
        const cw = this.canvas.getWidth();
        const ch = this.canvas.getHeight();
        shapeObj.setCoords();
        const br = shapeObj.getBoundingRect(true, true);
        let dx = 0;
        let dy = 0;
        if (br.left < 0) dx = -br.left;
        if (br.top < 0) dy = -br.top;
        if (br.left + br.width > cw) dx = cw - (br.left + br.width);
        if (br.top + br.height > ch) dy = ch - (br.top + br.height);
        if (dx || dy) {
            shapeObj.left = (shapeObj.left || 0) + dx;
            shapeObj.top = (shapeObj.top || 0) + dy;
            shapeObj.setCoords();
        }
    }

    _getShapeObject(area) {
        return area?.rect || area?.poly || null;
    }

    _polygonAbsolutePoints(poly) {
        if (!poly || !poly.points) {
            return [];
        }
        poly.setCoords();
        const scaleX = poly.scaleX || 1;
        const scaleY = poly.scaleY || 1;
        const baseLeft = poly.left || 0;
        const baseTop = poly.top || 0;
        return poly.points.map((p) => {
            const absX = baseLeft + p.x * scaleX;
            const absY = baseTop + p.y * scaleY;
            const stage = this._canvasToStagePoint(absX, absY);
            return [Math.round(stage.x * 10) / 10, Math.round(stage.y * 10) / 10];
        });
    }

    _setActiveArea(id) {
        if (!id || !this.designAreas.has(id)) return;
        this._exitPolygonDrawMode(false);
        this._exitPolygonVertexEdit();
        this.activeAreaId = id;
        const area = this.designAreas.get(id);
        this.state.activeAreaShape = area.shape || "rect";
        const shape = this._getShapeObject(area);
        if (shape) {
            this.canvas.setActiveObject(shape);
            if (area.rect) {
                this._syncInputsFromRect(area.rect);
            } else if (area.poly) {
                this._syncInputsFromRect(area.poly);
            }
            this._syncActualInputsFromArea();
            this.canvas.requestRenderAll();
        }
    }

    _getActiveRect() {
        if (!this.activeAreaId) return null;
        const area = this.designAreas.get(this.activeAreaId);
        return this._getShapeObject(area);
    }

    _colorForIndex(i) {
        const palette = ["#2b90ff", "#ff6b6b", "#51cf66", "#845ef7", "#ffa94d", "#15aabf"];
        return palette[i % palette.length];
    }

    _clampRectWithinCanvas(rectObj) {
        const cw = this.canvas.getWidth();
        const ch = this.canvas.getHeight();

        const w = rectObj.width * rectObj.scaleX;
        const h = rectObj.height * rectObj.scaleY;

        rectObj.left = Math.min(Math.max(0, rectObj.left), Math.max(0, cw - w));
        rectObj.top = Math.min(Math.max(0, rectObj.top), Math.max(0, ch - h));

        if (rectObj.left + w > cw) {
            rectObj.scaleX = (cw - rectObj.left) / rectObj.width;
        }
        if (rectObj.top + h > ch) {
            rectObj.scaleY = (ch - rectObj.top) / rectObj.height;
        }

        rectObj.setCoords();
    }

    // Convert a provided unit value into px (for restoring from saved data)
    _toPxFromUnit(unit, val) {
        switch (unit) {
            case "px": return val;
            case "inch": return val * this.CAL.pxPerInch;
            case "millimeter": return val * this.CAL.pxPerMillimeter;
            case "centimeter": return val * this.CAL.pxPerCentimeter;
            default: return val;
        }
    }

    _syncInputsFromRect(rectObj) {
        const widthPx = rectObj.width * rectObj.scaleX;
        const heightPx = rectObj.height * rectObj.scaleY;
        const topPx = rectObj.top;
        const leftPx = rectObj.left;

        const toUnit = (px) => {
            const val = this._pxToUnit(px);
            if (this.unit === "px") return Math.round(val);
            return Math.round(val * 100) / 100;
        };

        const $w = document.getElementById("design_width");
        const $h = document.getElementById("design_height");
        const $t = document.getElementById("design_top");
        const $l = document.getElementById("design_left");
        const $priceInput = document.getElementById("area_price");
        
        if ($w) $w.value = toUnit(widthPx);
        if ($h) $h.value = toUnit(heightPx);
        if ($t) $t.value = toUnit(topPx);
        if ($l) $l.value = toUnit(leftPx);
        
        const area = this.activeAreaId ? this.designAreas.get(this.activeAreaId) : null;
        if ($priceInput) $priceInput.value = area?.meta?.price || 0;
    }

    _syncRectFromInputs() {
        const area = this.activeAreaId ? this.designAreas.get(this.activeAreaId) : null;
        if (area?.shape === "polygon") {
            return;
        }
        const rect = this._getActiveRect();
        if (!rect || !this.activeAreaId) return;

        const $w = document.getElementById("design_width");
        const $h = document.getElementById("design_height");
        const $t = document.getElementById("design_top");
        const $l = document.getElementById("design_left");
        
        const parseNum = (el) => {
            const v = parseFloat(el?.value);
            return Number.isFinite(v) ? v : null;
        };

        const wUnit = parseNum($w);
        const hUnit = parseNum($h);
        const tUnit = parseNum($t);
        const lUnit = parseNum($l);

        if (wUnit !== null) {
            const wPx = Math.max(1, this._unitToPx(wUnit));
            rect.set({ scaleX: wPx / rect.width });
        }
        if (hUnit !== null) {
            const hPx = Math.max(1, this._unitToPx(hUnit));
            rect.set({ scaleY: hPx / rect.height });
        }
        if (tUnit !== null) {
            rect.top = Math.max(0, this._unitToPx(tUnit));
        }
        if (lUnit !== null) {
            rect.left = Math.max(0, this._unitToPx(lUnit));
        }

        const $priceInput = document.getElementById("area_price");
        const price = parseFloat($priceInput?.value) || 0;
        if (area) {
            if (!area.meta) {
                area.meta = {};
            }
            area.meta.price = price;
        }

        this._clampRectWithinCanvas(rect);
        rect.setCoords();
        this.canvas.requestRenderAll();
    }

    _syncActualInputsFromArea() {
        const area = this.activeAreaId ? this.designAreas.get(this.activeAreaId) : null;
        const aw = document.getElementById("actual_width");
        const ah = document.getElementById("actual_height");
        if (!area || !aw || !ah) return;

        const a = area.meta?.actual || { unit: this.unit, width: 0, height: 0 };
        // convert from stored unit to current UI unit if needed
        const widthInCurrentUnit = this._convertUnitValue(a.width, a.unit || this.unit, this.unit);
        const heightInCurrentUnit = this._convertUnitValue(a.height, a.unit || this.unit, this.unit);
        aw.value = Number.isFinite(widthInCurrentUnit) ? Math.round(widthInCurrentUnit * 100) / 100 : 0;
        ah.value = Number.isFinite(heightInCurrentUnit) ? Math.round(heightInCurrentUnit * 100) / 100 : 0;
    }

    _syncActualFromInputs() {
        const area = this.activeAreaId ? this.designAreas.get(this.activeAreaId) : null;
        if (!area) return;
        const aw = document.getElementById("actual_width");
        const ah = document.getElementById("actual_height");
        const w = parseFloat(aw?.value);
        const h = parseFloat(ah?.value);
        if (!area.meta) area.meta = {};
        if (!area.meta.actual) area.meta.actual = { unit: this.unit, width: 0, height: 0 };

        // Store in CURRENT UI unit
        if (Number.isFinite(w)) {
            area.meta.actual.width = w;
            area.meta.actual.unit = this.unit;
        }
        if (Number.isFinite(h)) {
            area.meta.actual.height = h;
            area.meta.actual.unit = this.unit;
        }
    }

    _serializeDesignAreas() {
        return Array.from(this.designAreas.values()).map((area) => {
            const { id, name, rect, poly, color, meta, shape } = area;
            if (shape === "polygon" && poly) {
                const points = area.storedPoints?.length
                    ? area.storedPoints
                    : this._polygonAbsolutePoints(poly);
                const bounds = areaBounds({ shape: "polygon", points }, this._getStageSize());
                const a = meta?.actual || { unit: this.unit, width: 0, height: 0 };
                const aWidthInCurrent = this._convertUnitValue(a.width || 0, a.unit || this.unit, this.unit);
                const aHeightInCurrent = this._convertUnitValue(a.height || 0, a.unit || this.unit, this.unit);
                return {
                    id,
                    name,
                    color,
                    shape: "polygon",
                    points,
                    left: bounds.left,
                    top: bounds.top,
                    width: bounds.width,
                    height: bounds.height,
                    meta: {
                        ...meta,
                        actual: {
                            unit: this.unit,
                            width: Math.round(aWidthInCurrent * 100) / 100,
                            height: Math.round(aHeightInCurrent * 100) / 100,
                        },
                    },
                };
            }
            const widthPx = rect.width * rect.scaleX;
            const heightPx = rect.height * rect.scaleY;

            // Ensure meta.actual is in CURRENT UI unit at save time
            const a = meta?.actual || { unit: this.unit, width: 0, height: 0 };
            const aWidthInCurrent = this._convertUnitValue(a.width || 0, a.unit || this.unit, this.unit);
            const aHeightInCurrent = this._convertUnitValue(a.height || 0, a.unit || this.unit, this.unit);
            const actualMeta = {
                unit: this.unit,
                width: Math.round(aWidthInCurrent * 100) / 100,
                height: Math.round(aHeightInCurrent * 100) / 100,
            };

            return {
                id,
                name,
                color,
                shape: "rect",
                meta: {
                    ...meta,
                    actual: actualMeta,
                },
                left: rect.left,
                top: rect.top,
                width: widthPx,
                height: heightPx,
                in_units: {
                    unit: this.unit,
                    left: this._pxToUnit(rect.left),
                    top: this._pxToUnit(rect.top),
                    width: this._pxToUnit(widthPx),
                    height: this._pxToUnit(heightPx),
                },
            };
        });
    }

    // Convert a numeric value between units using px as pivot
    _convertUnitValue(value, fromUnit, toUnit) {
        if (!Number.isFinite(value)) return 0;
        if (fromUnit === toUnit) return value;
        const px = this._toPxFromUnit(fromUnit || "inch", value);
        switch (toUnit) {
            case "px": return px;
            case "inch": return px / this.CAL.pxPerInch;
            case "millimeter": return px / this.CAL.pxPerMillimeter;
            case "centimeter": return px / this.CAL.pxPerCentimeter;
            default: return value;
        }
    }

    _convertAllActualMetaUnits(prevUnit, newUnit) {
        // Iterate through all areas and convert meta.actual values in place
        for (const { meta } of this.designAreas.values()) {
            if (!meta || !meta.actual) continue;
            const a = meta.actual;
            if (!Number.isFinite(a.width) && !Number.isFinite(a.height)) {
                a.unit = newUnit;
                continue;
            }
            const w = Number.isFinite(a.width) ? this._convertUnitValue(a.width, a.unit || prevUnit, newUnit) : 0;
            const h = Number.isFinite(a.height) ? this._convertUnitValue(a.height, a.unit || prevUnit, newUnit) : 0;
            a.width = Math.round(w * 100) / 100;
            a.height = Math.round(h * 100) / 100;
            a.unit = newUnit;
        }
    }

    _initFromRecord() {
        const raw = this.props?.record?.data?.design_areas_json;
        if (!raw) return;

        let areas = [];
        try {
            if (Array.isArray(raw)) {
                areas = raw;
            } else if (typeof raw === "string") {
                areas = JSON.parse(raw);
            } else if (raw && typeof raw === "object") {
                areas = Array.isArray(raw.areas) ? raw.areas : [];
            }
        } catch (_e) {
            areas = [];
        }
        if (!Array.isArray(areas)) return;

        areas.forEach((a) => {
            if (a.shape === "polygon" && Array.isArray(a.points) && a.points.length >= 3) {
                this._createDesignPolygonFromData(a);
            } else {
                this._createDesignRectFromData(a);
            }
        });

        // Detect preferred UI unit from the first area:
        // 1) prefer meta.actual.unit if present
        // 2) else use in_units.unit
        const firstArea = areas[0];
        let detectedUnit = firstArea?.meta?.actual?.unit || firstArea?.in_units?.unit || "inch";
        const supported = new Set(["px", "inch", "millimeter", "centimeter"]);
        if (!supported.has(detectedUnit)) detectedUnit = "inch";

        // Set unit before syncing inputs
        this.unit = detectedUnit;
        const unitSel = document.getElementById("unit");
        if (unitSel) unitSel.value = detectedUnit;
        this._updateUnitSuffix();

        // Select the first area by default (also syncs inputs)
        const firstId = firstArea?.id || (this.designAreas.size ? Array.from(this.designAreas.keys())[0] : null);
        if (firstId) {
            this._setActiveArea(firstId);
        } else {
            const ids = Array.from(this.designAreas.keys());
            if (ids.length) this._setActiveArea(ids[0]);
        }
    }

    changeSide(ev) {
        this.state.image_side = ev.target.value
    }

    _addDeleteControl(rect) {
        const size = 26; // visual diameter of the red badge
        const dpr = window.devicePixelRatio || 1;

        const renderDeleteButton = (ctx, left, top, styleOverride, fabricObject) => {
            if (this.canvas.getActiveObject() !== fabricObject) return;

            ctx.save();
            // Improve sharpness on HiDPI screens
            ctx.scale(1 / dpr, 1 / dpr);
            const cx = left * dpr;
            const cy = top * dpr;
            const R = (size * dpr) / 2;

            // Red circle badge with subtle white rim
            ctx.beginPath();
            ctx.arc(cx, cy, R, 0, Math.PI * 2);
            ctx.fillStyle = "#E03131";
            ctx.fill();
            ctx.lineWidth = Math.max(1, 1.25 * dpr);
            ctx.strokeStyle = "rgba(255,255,255,0.85)";
            ctx.stroke();

            // Icon drawing space (normalized 24x24 inside the circle)
            const pad = 4 * dpr; // keep icon well inside the circle
            const box = {
                x: cx - (R - pad),
                y: cy - (R - pad),
                w: (R - pad) * 2,
                h: (R - pad) * 2,
            };

            // Map helper: from a 24x24 design grid to the padded box
            const mapX = (x) => box.x + (x / 24) * box.w;
            const mapY = (y) => box.y + (y / 24) * box.h;

            // Draw a clean "bin" similar to reference:
            // - lid with handle
            // - rounded body
            // - 3 vertical slots
            ctx.fillStyle = "#FFFFFF";
            ctx.strokeStyle = "#FFFFFF";
            ctx.lineWidth = Math.max(1.8 * dpr, 1.5);
            ctx.lineCap = "round";
            ctx.lineJoin = "round";

            // Handle (rounded)
            {
                const w = 6, h = 2, x = 12 - w / 2, y = 5.2;
                const rx = 1.2, ry = 1.2;
                const x1 = mapX(x), y1 = mapY(y), w1 = (w / 24) * box.w, h1 = (h / 24) * box.h;
                const r1x = (rx / 24) * box.w, r1y = (ry / 24) * box.h;
                ctx.beginPath();
                // rounded rect by path
                ctx.moveTo(x1 + r1x, y1);
                ctx.lineTo(x1 + w1 - r1x, y1);
                ctx.quadraticCurveTo(x1 + w1, y1, x1 + w1, y1 + r1y);
                ctx.lineTo(x1 + w1, y1 + h1 - r1y);
                ctx.quadraticCurveTo(x1 + w1, y1 + h1, x1 + w1 - r1x, y1 + h1);
                ctx.lineTo(x1 + r1x, y1 + h1);
                ctx.quadraticCurveTo(x1, y1 + h1, x1, y1 + r1y);
                ctx.lineTo(x1, y1 + r1y);
                ctx.quadraticCurveTo(x1, y1, x1 + r1x, y1);
                ctx.fill();
            }

            // Lid (rounded)
            {
                const w = 12, h = 2.8, x = 12 - w / 2, y = 7.2;
                const rx = 1.4, ry = 1.4;
                const x1 = mapX(x), y1 = mapY(y), w1 = (w / 24) * box.w, h1 = (h / 24) * box.h;
                const r1x = (rx / 24) * box.w, r1y = (ry / 24) * box.h;
                ctx.beginPath();
                ctx.moveTo(x1 + r1x, y1);
                ctx.lineTo(x1 + w1 - r1x, y1);
                ctx.quadraticCurveTo(x1 + w1, y1, x1 + w1, y1 + r1y);
                ctx.lineTo(x1 + w1, y1 + h1 - r1y);
                ctx.quadraticCurveTo(x1 + w1, y1 + h1, x1 + w1 - r1x, y1 + h1);
                ctx.lineTo(x1 + r1x, y1 + h1);
                ctx.quadraticCurveTo(x1, y1 + h1, x1, y1 + r1y);
                ctx.lineTo(x1, y1 + r1y);
                ctx.quadraticCurveTo(x1, y1, x1 + r1x, y1);
                ctx.fill();
            }

            // Body outline (rounded)
            let body;
            {
                const w = 12, h = 11, x = 12 - w / 2, y = 10;
                const r = 2.2;
                const x1 = mapX(x), y1 = mapY(y), w1 = (w / 24) * box.w, h1 = (h / 24) * box.h;
                const rrX = (r / 24) * box.w, rrY = (r / 24) * box.h;
                body = { x1, y1, w1, h1 };
                ctx.beginPath();
                ctx.moveTo(x1 + rrX, y1);
                ctx.lineTo(x1 + w1 - rrX, y1);
                ctx.quadraticCurveTo(x1 + w1, y1, x1 + w1, y1 + rrY);
                ctx.lineTo(x1 + w1, y1 + h1 - rrY);
                ctx.quadraticCurveTo(x1 + w1, y1 + h1, x1 + w1 - rrX, y1 + h1);
                ctx.lineTo(x1 + rrX, y1 + h1);
                ctx.quadraticCurveTo(x1, y1 + h1, x1, y1 + rrY);
                ctx.lineTo(x1, y1 + rrY);
                ctx.quadraticCurveTo(x1, y1, x1 + rrX, y1);
                ctx.stroke();
            }

            // Slots (3 vertical, centered)
            {
                const slots = 3;
                const inset = Math.max(1.6 * dpr, body.w1 * 0.10);
                const top = body.y1 + inset;
                const bottom = body.y1 + body.h1 - inset;
                const step = body.w1 / (slots + 1);
                for (let i = 1; i <= slots; i++) {
                    const x = body.x1 + step * i;
                    ctx.beginPath();
                    ctx.moveTo(x, top);
                    ctx.lineTo(x, bottom);
                    ctx.stroke();
                }
            }

            ctx.restore();
        };

        rect.controls.delete = new fabric.Control({
            x: 0.5,
            y: -0.5,
            // Place slightly inside so it's clearly visible and not clipped
            offsetX: 14,
            offsetY: -14,
            cursorStyle: "pointer",
            render: renderDeleteButton,
            mouseUpHandler: (_event, transform) => {
                const target = transform?.target;
                if (target?.custom?.kind === "design_area") {
                    this._deleteRect(target);
                }
                return true;
            },
            sizeX: size,
            sizeY: size,
        });
    }

    _deleteRect(rect) {
        const id = rect?.custom?.id;
        if (rect) {
            this.canvas.remove(rect);
        }
        if (id && this.designAreas.has(id)) {
            this.designAreas.delete(id);
        }
        this.activeAreaId = null;

        // Select another area if available
        const ids = Array.from(this.designAreas.keys());
        if (ids.length) {
            this._setActiveArea(ids[0]);
        } else {
            // Clear inputs
            this._syncInputsFromRect({ width: 0, height: 0, left: 0, top: 0, scaleX: 1, scaleY: 1 });
            this.canvas.discardActiveObject();
            this.canvas.requestRenderAll();
        }
    }

    _resetAllDesignAreas() {
        if (!this.canvas) return;
        // Remove all design-area objects from canvas
        const toRemove = [];
        this.canvas.getObjects().forEach((obj) => {
            if (obj?.custom?.kind === "design_area") {
                toRemove.push(obj);
            }
        });
        toRemove.forEach((obj) => this.canvas.remove(obj));

        // Clear state
        this.designAreas = new Map();
        this.activeAreaId = null;
        this.canvas.discardActiveObject();
        this.canvas.requestRenderAll();

        // Clear inputs
        this._syncInputsFromRect({ width: 0, height: 0, left: 0, top: 0, scaleX: 1, scaleY: 1 });
        const aw = document.getElementById("actual_width");
        const ah = document.getElementById("actual_height");
        if (aw) aw.value = 0;
        if (ah) ah.value = 0;
    }

    _hasBackgroundImage() {
        const url = this.state?.image_url;
        if (!url) return false;
        if (url.includes(this.PLACEHOLDER_URL)) return false;
        return true;
    }

    onAdd() {
        this._exitPolygonDrawMode(false);
        this._exitPolygonVertexEdit();
        const areas = this._serializeDesignAreas();

        // Build values to update/create; pass plain JS for JSON field (do NOT JSON.stringify)
        const vals = {
            title: document.getElementById("image_side")?.value,
            design_areas_json: areas,
        };
        if (this.imageField) {
            vals.thumbnail = this.imageField;
        }
        // Save stage and image dimensions for correct frontend scaling (fallback-safe)
        vals.stage_width = Math.max(1, Math.round(this.stage.width || this.DEFAULT_STAGE.w));
        vals.stage_height = Math.max(1, Math.round(this.stage.height || this.DEFAULT_STAGE.h));
        vals.image_width = Math.max(0, Math.round(this.stage.image_width || 0));
        vals.image_height = Math.max(0, Math.round(this.stage.image_height || 0));

        if (this.props.is_edit) {
            this.props.record.update(vals);
        } else {
            const recordList = this.props.record.data["views"];
            recordList.addNewRecord({ position: "bottom" }).then((record) => {
                record.update(vals);
            });
        }
        this.props.close();
    }

}
