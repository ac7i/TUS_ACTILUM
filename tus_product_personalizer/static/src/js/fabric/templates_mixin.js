/** @odoo-module **/

import { _t } from "@web/core/l10n/translation";
export const fabricTemplatesMixin = {
_canvasHasUserArtwork: function () {
    for (const side of ["front", "back", "left", "right"]) {
        if (this._sideHasUserArtwork(side)) {
            return true;
        }
    }
    return false;
},

_sideHasUserArtwork: function (side) {
    if (this._sideHasTexture && this._sideHasTexture(side)) {
        return true;
    }
    for (const entry of this.canvasesBySide[side] || []) {
        if (this._getUserArtworkObjects(entry.canvas).length) {
            return true;
        }
    }
    return false;
},

_getUserArtworkObjects: function (canvas) {
    if (!canvas) {
        return [];
    }
    return canvas.getObjects().filter(
        (o) => !o.extra_elem
            && !o.center_line
            && !o.tusTextureLayer
            && o.custom?.kind !== "design_area"
            && !o.tusFoilPreviewOverlay
    );
},

_remapCanvasObjectsToSavedSize: function (fabricCanvas, sourceW, sourceH) {
    if (!fabricCanvas || sourceW <= 0 || sourceH <= 0) {
        return;
    }
    const cw = fabricCanvas.getWidth();
    const ch = fabricCanvas.getHeight();
    if (Math.abs(cw - sourceW) <= 1 && Math.abs(ch - sourceH) <= 1) {
        return;
    }
    const scaleX = cw / sourceW;
    const scaleY = ch / sourceH;
    const objects = fabricCanvas.getObjects().filter(
        (o) => !o.extra_elem && o.custom?.kind !== "design_area" && !o.tusFoilPreviewOverlay
    );
    objects.forEach((obj) => {
        obj.set({
            left: (obj.left || 0) * scaleX,
            top: (obj.top || 0) * scaleY,
            scaleX: (obj.scaleX || 1) * scaleX,
            scaleY: (obj.scaleY || 1) * scaleY,
        });
        obj.setCoords();
    });
    fabricCanvas.requestRenderAll();
},

_fitCanvasObjectsToFullArea: function (fabricCanvas, sourceW, sourceH, mode = "cover") {
    if (!fabricCanvas) {
        return;
    }
    const cw = fabricCanvas.getWidth();
    const ch = fabricCanvas.getHeight();
    const objects = fabricCanvas.getObjects().filter(
        (o) => !o.extra_elem && o.custom?.kind !== "design_area" && !o.tusFoilPreviewOverlay
    );
    if (!objects.length) {
        return;
    }

    if (sourceW > 0 && sourceH > 0) {
        const scaleX = cw / sourceW;
        const scaleY = ch / sourceH;
        const scale = mode === "cover" ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
        objects.forEach((obj) => {
            obj.set({
                left: (obj.left || 0) * scale,
                top: (obj.top || 0) * scale,
                scaleX: (obj.scaleX || 1) * scale,
                scaleY: (obj.scaleY || 1) * scale,
            });
            obj.setCoords();
        });
    } else {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        objects.forEach((obj) => {
            const rect = obj.getBoundingRect(true, true);
            minX = Math.min(minX, rect.left);
            minY = Math.min(minY, rect.top);
            maxX = Math.max(maxX, rect.left + rect.width);
            maxY = Math.max(maxY, rect.top + rect.height);
        });
        const bboxW = maxX - minX;
        const bboxH = maxY - minY;
        if (bboxW > 0 && bboxH > 0) {
            const scaleX = cw / bboxW;
            const scaleY = ch / bboxH;
            const scale = mode === "cover" ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
            objects.forEach((obj) => {
                obj.set({
                    left: ((obj.left || 0) - minX) * scale,
                    top: ((obj.top || 0) - minY) * scale,
                    scaleX: (obj.scaleX || 1) * scale,
                    scaleY: (obj.scaleY || 1) * scale,
                });
                obj.setCoords();
            });
        }
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    objects.forEach((obj) => {
        const rect = obj.getBoundingRect(true, true);
        minX = Math.min(minX, rect.left);
        minY = Math.min(minY, rect.top);
        maxX = Math.max(maxX, rect.left + rect.width);
        maxY = Math.max(maxY, rect.top + rect.height);
    });
    const bboxW = maxX - minX;
    const bboxH = maxY - minY;
    if (bboxW <= 0 || bboxH <= 0) {
        fabricCanvas.requestRenderAll();
        return;
    }
    const offsetX = (cw - bboxW) / 2 - minX;
    const offsetY = (ch - bboxH) / 2 - minY;
    objects.forEach((obj) => {
        obj.set({
            left: (obj.left || 0) + offsetX,
            top: (obj.top || 0) + offsetY,
        });
        obj.setCoords();
    });
    fabricCanvas.requestRenderAll();
},

_tagTemplateLayers: function (fabricCanvas) {
    if (!fabricCanvas) {
        return;
    }
    fabricCanvas.getObjects().forEach((obj, index) => {
        if (obj.extra_elem || obj.custom?.kind === "design_area") {
            return;
        }
        obj.custom = {
            ...(obj.custom || {}),
            kind: "template_layer",
            templateLayer: true,
            layerLabel: obj.text || obj.title || obj.type || `Layer ${index + 1}`,
        };
        obj.selectable = true;
        obj.evented = true;
        obj.hasControls = true;
    });
},

_fetchTemplateDesignText: async function (templateId) {
    const response = await fetch(`/product/designer/template/${templateId}/data`, {
        credentials: "same-origin",
    });
    if (!response.ok) {
        throw new Error(`Template request failed (${response.status})`);
    }
    return await response.text();
},

_safeChromaHex: function (color) {
    if (!color || typeof color === "object") {
        return color;
    }
    try {
        if (typeof chroma !== "undefined") {
            return chroma(color).hex();
        }
    } catch (_e) {
        // keep original color
    }
    return color;
},

_loadSvgOnCanvas: function (fabricCanvas, svgContent, options = {}) {
    const self = this;
    const fitToFullArea = options.fitToFullArea !== false;
    return new Promise((resolve) => {
        if (!fabricCanvas || !svgContent) {
            resolve();
            return;
        }
        const cw = fabricCanvas.getWidth();
        const ch = fabricCanvas.getHeight();
        if (cw < 1 || ch < 1) {
            console.warn("Template SVG skipped: design area canvas has no size yet.");
            resolve();
            return;
        }

        const removable = fabricCanvas.getObjects().filter(
            (o) => !o.extra_elem && o.custom?.kind !== "design_area"
        );
        removable.forEach((o) => fabricCanvas.remove(o));

        fabric.loadSVGFromString(svgContent, (objects, svgOptions) => {
            if (!objects || !objects.length) {
                console.warn("Template SVG produced no objects.");
                resolve();
                return;
            }
            const svgGroup = fabric.util.groupSVGElements(objects, svgOptions);
            let objscaleX = cw / Math.max(1, svgGroup.width || 1);
            let objscaleY = ch / Math.max(1, svgGroup.height || 1);
            if (fitToFullArea) {
                const coverScale = Math.max(objscaleX, objscaleY);
                objscaleX = coverScale;
                objscaleY = coverScale;
            } else {
                const containScale = Math.min(objscaleX, objscaleY);
                objscaleX = containScale;
                objscaleY = containScale;
            }

            svgGroup.set({
                left: 0,
                top: 0,
                scaleX: objscaleX,
                scaleY: objscaleY,
            });

            const svgObjects = svgGroup.getObjects();
            svgGroup._restoreObjectsState();
            svgObjects.forEach((obj, index) => {
                const fillColour = self._safeChromaHex(obj.fill);
                const strokeColour = self._safeChromaHex(obj.stroke);
                if (obj.type === "text") {
                    const editableText = new fabric.IText(obj.text, {
                        ...obj.toObject(),
                        editable: true,
                        selectable: true,
                        hasControls: true,
                        lockScalingFlip: true,
                        id: index,
                        fill: fillColour,
                        stroke: strokeColour,
                        centeredRotation: true,
                        centeredScaling: true,
                        locked: false,
                    });
                    fabricCanvas.add(editableText);
                } else {
                    obj.set({
                        selectable: true,
                        hasControls: true,
                        lockScalingFlip: true,
                        id: index,
                        title: obj.text || obj.type,
                        fill: fillColour,
                        stroke: strokeColour,
                        centeredRotation: true,
                        centeredScaling: true,
                        locked: false,
                    });
                    fabricCanvas.add(obj);
                }
            });
            self._fitCanvasObjectsToFullArea(fabricCanvas, null, null, "cover");
            self._tagTemplateLayers(fabricCanvas);
            fabricCanvas.requestRenderAll();
            resolve();
        });
    });
},

_applySvgTemplateToDesignAreas: async function (svgContent, options = {}) {
    await this.restructureCanvas({ preserveSelection: true });
    const side = options.side || this.active_side || "front";
    const entries = this.canvasesBySide[side] || [];
    if (!entries.length) {
        console.warn("No design areas found for template apply on side:", side);
        return;
    }
    const targetEntry =
        entries.find((e) => String(e.id) === String(this.active_area_id)) || entries[0];
    if (targetEntry?.canvas) {
        await this._loadSvgOnCanvas(targetEntry.canvas, svgContent, options);
    }
    this._setVisibleCanvasSide(side);
    if (targetEntry) {
        await this._setActiveArea(side, targetEntry.id);
        this.canvas = targetEntry.canvas;
        this._renderAreaSelectorForSide(side, targetEntry.id);
    }
    if (this.canvas) {
        this.managelayers();
        this.saveState();
        this.canvas.requestRenderAll();
    }
    this._updateDesignerPriceDisplay();
    this.restructureCanvas({ preserveSelection: true });
},

_applyProductTemplateById: async function (templateId, designFormat) {
    const text = await this._fetchTemplateDesignText(templateId);
    if (!text || !text.trim()) {
        throw new Error("Template design file is empty.");
    }
    const trimmed = text.trim();
    if (
        designFormat === "fabric_json" ||
        trimmed.startsWith("{") ||
        trimmed.startsWith("[")
    ) {
        const bundle = JSON.parse(trimmed);
        if (bundle && (Array.isArray(bundle.sides) || bundle.bundleVersion)) {
            await this._restoreDesignBundle(bundle, {
                fitToFullArea: true,
                skipVariantSwitch: true,
            });
            return;
        }
    }
    await this._applySvgTemplateToDesignAreas(text, { fitToFullArea: true });
},

_onSelectProductTemplate: async function (ev) {
    const $target = $(ev.currentTarget).closest(".template_option");
    const templateId = parseInt(
        $target.attr("data-template_id") || $target.data("template_id"),
        10
    );
    const designFormat =
        $target.attr("data-design_format") || $target.data("design_format") || "svg";
    if (!templateId) {
        return;
    }
    if (this._canvasHasUserArtwork()) {
        const confirmed = window.confirm(
            _t("Applying this template will replace your current design. Continue?")
        );
        if (!confirmed) {
            return;
        }
    }
    this.startLoader(_t("Applying template..."));
    try {
        await this._applyProductTemplateById(templateId, designFormat);
    } catch (e) {
        console.error("Failed to apply product template:", e);
        window.alert(
            _t("Could not apply this template. Please verify the design file is a valid SVG or Fabric JSON bundle.")
        );
    } finally {
        this.removeLoader();
    }
},
};
