/** @odoo-module **/

import { _t } from "@web/core/l10n/translation";

export const fabricTextTemplatesMixin = {
    _fetchTextTemplateDesignText: async function (templateId) {
        const response = await fetch(`/product/designer/text-template/${templateId}/data`, {
            credentials: "same-origin",
        });
        if (!response.ok) {
            throw new Error(`Text template request failed (${response.status})`);
        }
        return await response.text();
    },

    _safeChromaHexForTextTemplate: function (color) {
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

    /**
     * Insert SVG text template onto the active canvas without replacing existing artwork.
     * SVG <text> nodes become editable fabric.IText objects.
     */
    _insertTextTemplateOnCanvas: function (fabricCanvas, svgContent) {
        const self = this;
        return new Promise((resolve, reject) => {
            if (!fabricCanvas || !svgContent) {
                resolve([]);
                return;
            }
            const cw = fabricCanvas.getWidth();
            const ch = fabricCanvas.getHeight();
            if (cw < 1 || ch < 1) {
                console.warn("Text template skipped: design area canvas has no size yet.");
                resolve([]);
                return;
            }

            fabric.loadSVGFromString(svgContent, (objects, svgOptions) => {
                if (!objects || !objects.length) {
                    console.warn("Text template SVG produced no objects.");
                    resolve([]);
                    return;
                }

                const svgGroup = fabric.util.groupSVGElements(objects, svgOptions);
                const groupW = Math.max(1, svgGroup.width || 1);
                const groupH = Math.max(1, svgGroup.height || 1);
                const maxW = cw * 0.85;
                const maxH = ch * 0.85;
                const scale = Math.min(maxW / groupW, maxH / groupH, 1);

                svgGroup.set({
                    left: 0,
                    top: 0,
                    scaleX: scale,
                    scaleY: scale,
                });

                const svgObjects = svgGroup.getObjects();
                svgGroup._restoreObjectsState();
                const added = [];
                let index = self.elem_index || 0;

                svgObjects.forEach((obj) => {
                    const fillColour = self._safeChromaHexForTextTemplate(obj.fill);
                    const strokeColour = self._safeChromaHexForTextTemplate(obj.stroke);
                    const commonCustom = {
                        kind: "text_template_layer",
                        textTemplateLayer: true,
                    };

                    if (obj.type === "text" || obj.type === "i-text" || obj.type === "textbox") {
                        const editableText = new fabric.IText(obj.text || "", {
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
                            custom: {
                                ...commonCustom,
                                layerLabel: obj.text || "Text",
                            },
                        });
                        fabricCanvas.add(editableText);
                        added.push(editableText);
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
                            custom: {
                                ...commonCustom,
                                layerLabel: obj.type || "Shape",
                            },
                        });
                        fabricCanvas.add(obj);
                        added.push(obj);
                    }
                    index += 1;
                });

                self.elem_index = index;

                if (added.length) {
                    let minX = Infinity;
                    let minY = Infinity;
                    let maxX = -Infinity;
                    let maxY = -Infinity;
                    added.forEach((obj) => {
                        const rect = obj.getBoundingRect(true, true);
                        minX = Math.min(minX, rect.left);
                        minY = Math.min(minY, rect.top);
                        maxX = Math.max(maxX, rect.left + rect.width);
                        maxY = Math.max(maxY, rect.top + rect.height);
                    });
                    const bboxW = maxX - minX;
                    const bboxH = maxY - minY;
                    if (bboxW > 0 && bboxH > 0) {
                        const offsetX = (cw - bboxW) / 2 - minX;
                        const offsetY = (ch - bboxH) / 2 - minY;
                        added.forEach((obj) => {
                            obj.set({
                                left: (obj.left || 0) + offsetX,
                                top: (obj.top || 0) + offsetY,
                            });
                            if (typeof self._clampObjectToDesignArea === "function") {
                                self._clampObjectToDesignArea(fabricCanvas, obj);
                            }
                            obj.setCoords();
                        });
                    }
                }

                fabricCanvas.requestRenderAll();
                resolve(added);
            });
        });
    },

    _applyTextTemplateById: async function (templateId) {
        const text = await this._fetchTextTemplateDesignText(templateId);
        if (!text || !text.trim()) {
            throw new Error("Text template SVG is empty.");
        }
        if (!this.canvas) {
            throw new Error("No active design canvas.");
        }
        const added = await this._insertTextTemplateOnCanvas(this.canvas, text);
        if (added.length) {
            const last = added[added.length - 1];
            this.canvas.setActiveObject(last);
            if (typeof this._showObjectToolbar === "function") {
                this._showObjectToolbar(last);
            }
        }
        if (typeof this.managelayers === "function") {
            this.managelayers();
        }
        if (typeof this.saveState === "function") {
            this.saveState();
        }
        this.canvas.requestRenderAll();
        if (typeof this._updateDesignerPriceDisplay === "function") {
            this._updateDesignerPriceDisplay();
        }
    },

    _onSelectTextTemplate: async function (ev) {
        const $target = $(ev.currentTarget).closest(".text_template_option");
        const templateId = parseInt(
            $target.attr("data-template_id") || $target.data("template_id"),
            10
        );
        if (!templateId) {
            return;
        }
        this._activeSidebarOption = "text";
        this._highlightSidebarOption?.("text", { showPanel: true });
        this.startLoader(_t("Adding text template..."), { light: true });
        try {
            await this._applyTextTemplateById(templateId);
        } catch (e) {
            console.error("Failed to apply text template:", e);
            this.notification?.add(
                _t("Could not add this text template. Please verify the SVG file is valid."),
                { type: "danger" }
            );
        } finally {
            this.removeLoader();
        }
    },

    _onTextTemplateCategoryClick: function (ev) {
        ev.preventDefault();
        const $btn = $(ev.currentTarget);
        const category = $btn.attr("data-category") || $btn.data("category");
        if (!category) {
            return;
        }
        const $root = $btn.closest(".default_texts");
        $root.find(".fab_text_template_category_btn").removeClass("active");
        $btn.addClass("active");
        $root.find(".fab_text_template_category_panel").addClass("d-none");
        $root.find(`.fab_text_template_category_panel[data-category="${category}"]`).removeClass("d-none");
    },
};
