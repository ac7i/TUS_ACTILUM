/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { patchDynamicContent } from "@web/public/utils";
import { WebsiteSale } from "@website_sale/interactions/website_sale";
import { rpc } from "@web/core/network/rpc";
import { _t } from "@web/core/l10n/translation";

const EMPTY_CANVAS_SIDES = new Set(["front", "back", "both"]);

patch(WebsiteSale.prototype, {
    setup() {
        super.setup();
        patchDynamicContent(this.dynamicContent, {
            ".customize_design": {
                "t-on-click.prevent": this.onClickCustomizeDesign.bind(this),
            },
            ".tus-empty-canvas-preset-select": {
                "t-on-change": this.onEmptyCanvasPresetChange.bind(this),
            },
            ".tus-empty-canvas-custom-fields input, .tus-empty-canvas-custom-fields select": {
                "t-on-change": this.onEmptyCanvasCustomChange.bind(this),
            },
        });
    },

    start() {
        super.start();
        this.waitFor(this._initEmptyCanvasPicker());
    },

    async _initEmptyCanvasPicker() {
        const picker = this.el.querySelector(".tus-empty-canvas-picker");
        if (!picker) {
            return;
        }
        const productTmplInput = this.el.querySelector(".product_template_id");
        const productTmplId = parseInt(productTmplInput?.value, 10);
        if (!productTmplId) {
            return;
        }
        try {
            const data = await rpc("/tus_personalizer/empty_canvas/presets", {
                product_tmpl_id: productTmplId,
            });
            this._emptyCanvasConfig = data || {};
            this._renderEmptyCanvasPresets(data.presets || []);
            this._syncEmptyCanvasCustomVisibility();
        } catch (err) {
            console.warn("Could not load canvas presets:", err);
        }
    },

    _renderEmptyCanvasPresets(presets) {
        const select = this.el.querySelector(".tus-empty-canvas-preset-select");
        if (!select) {
            return;
        }
        select.replaceChildren();
        const defaultOption = document.createElement("option");
        defaultOption.value = "";
        defaultOption.textContent = _t("Select a size...");
        select.appendChild(defaultOption);
        for (const preset of presets) {
            const option = document.createElement("option");
            option.value = String(preset.id);
            option.dataset.width = String(preset.width);
            option.dataset.height = String(preset.height);
            option.dataset.unit = preset.unit;
            option.textContent = preset.label;
            select.appendChild(option);
        }
        if (this._emptyCanvasConfig?.allow_custom) {
            const customOption = document.createElement("option");
            customOption.value = "custom";
            customOption.textContent = _t("Custom size");
            select.appendChild(customOption);
        }
    },

    onEmptyCanvasPresetChange(ev) {
        const select = ev.currentTarget;
        const value = select.value;
        const customFields = this.el.querySelector(".tus-empty-canvas-custom-fields");
        if (value === "custom") {
            customFields?.classList.remove("d-none");
            return;
        }
        customFields?.classList.add("d-none");
        const selectedOption = select.selectedOptions[0];
        const widthInput = this.el.querySelector("#tusEmptyCanvasWidth");
        const heightInput = this.el.querySelector("#tusEmptyCanvasHeight");
        const unitInput = this.el.querySelector("#tusEmptyCanvasUnit");
        if (widthInput) {
            widthInput.value = selectedOption?.dataset.width || "";
        }
        if (heightInput) {
            heightInput.value = selectedOption?.dataset.height || "";
        }
        if (unitInput) {
            unitInput.value = selectedOption?.dataset.unit || "in";
        }
    },

    onEmptyCanvasCustomChange() {
        const select = this.el.querySelector(".tus-empty-canvas-preset-select");
        if (select) {
            select.value = "custom";
        }
        this.el.querySelector(".tus-empty-canvas-custom-fields")?.classList.remove("d-none");
    },

    _syncEmptyCanvasCustomVisibility() {
        if (!this._emptyCanvasConfig?.allow_custom) {
            this.el.querySelector(".tus-empty-canvas-custom-fields")?.classList.add("d-none");
        }
    },

    _getEmptyCanvasSelection() {
        const picker = this.el.querySelector(".tus-empty-canvas-picker");
        if (!picker) {
            return null;
        }
        const presetSelect = this.el.querySelector(".tus-empty-canvas-preset-select");
        const presetVal = presetSelect?.value;
        const sidesInput = this.el.querySelector(".tus-empty-canvas-side-input:checked");
        const sides = sidesInput?.value || "front";
        let width;
        let height;
        let unit;
        let presetId = null;

        if (presetVal && presetVal !== "custom") {
            const selectedOption = presetSelect.selectedOptions[0];
            width = parseFloat(selectedOption?.dataset.width);
            height = parseFloat(selectedOption?.dataset.height);
            unit = selectedOption?.dataset.unit || "in";
            presetId = parseInt(presetVal, 10);
        } else {
            width = parseFloat(this.el.querySelector("#tusEmptyCanvasWidth")?.value);
            height = parseFloat(this.el.querySelector("#tusEmptyCanvasHeight")?.value);
            unit = this.el.querySelector("#tusEmptyCanvasUnit")?.value || "in";
        }

        return { width, height, unit, sides, presetId };
    },

    _validateEmptyCanvasSelection(selection) {
        if (!selection) {
            return true;
        }
        if (!selection.width || !selection.height || selection.width <= 0 || selection.height <= 0) {
            return _t("Please select or enter a valid canvas size.");
        }
        if (!EMPTY_CANVAS_SIDES.has(selection.sides)) {
            return _t("Please choose a print side.");
        }
        const cfg = this._emptyCanvasConfig || {};
        const longest = Math.max(selection.width, selection.height);
        if (cfg.custom_min && longest < cfg.custom_min) {
            return _t("Canvas size is below the minimum allowed.");
        }
        if (cfg.custom_max && longest > cfg.custom_max) {
            return _t("Canvas size exceeds the maximum allowed.");
        }
        return null;
    },

    onClickCustomizeDesign(ev) {
        ev.preventDefault();
        const productTmplId = this.el.querySelector(".product_template_id")?.value;
        const productId = this.el.querySelector(".product_id")?.value;
        const selection = this._getEmptyCanvasSelection();
        if (selection) {
            const error = this._validateEmptyCanvasSelection(selection);
            if (error) {
                window.alert(error);
                return;
            }
            const params = new URLSearchParams({
                product_id: productId || "",
                empty_canvas: "1",
                canvas_w: String(selection.width),
                canvas_h: String(selection.height),
                canvas_unit: selection.unit,
                sides: selection.sides,
            });
            if (selection.presetId) {
                params.set("canvas_preset_id", String(selection.presetId));
            }
            location.href = `/product/designer/${productTmplId}?${params.toString()}`;
            return;
        }
        location.href = `/product/designer/${productTmplId}?product_id=${productId}`;
    },
});
