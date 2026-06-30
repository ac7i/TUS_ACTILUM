/** @odoo-module **/

import { _t } from "@web/core/l10n/translation";
import {
    TUS_VDP_CHECKOUT_BODY_CLASS,
    TUS_VDP_PROCESSING_OVERLAY_CLASS,
} from "./constants";

const VDP_TEXT_TYPES = new Set(["i-text", "text", "textbox", "curved-text"]);
const VDP_SIDES = ["front", "back", "left", "right"];
const VDP_MAX_ROWS = 200;
const VDP_UPLOAD_BATCH_SIZE = 5;

export const fabricVdpMixin = {
    _initVdpState() {
        this.showVdp = $('input[name="show_vdp"]').val() === "1";
        this.vdpRecords = [];
        this.vdpPreviewIndex = 0;
        this._vdpSnapshot = null;
        this._vdpCheckoutOpen = false;
    },

    _isMatrixVdpMode() {
        return Boolean(this.showVdp && this.showMatrixTable);
    },

    /** True only when the user uploaded VDP data (optional feature). */
    _isVdpActive() {
        return Boolean(this.showVdp && this.vdpRecords?.length);
    },

    _vdpContextKey(productId, colorId) {
        const pid = parseInt(productId, 10) || 0;
        const cid = parseInt(colorId, 10) || 0;
        return `${pid}_${cid}`;
    },

    _cartHasMultipleColors(cartLines) {
        const colorIds = new Set();
        for (const { $el } of cartLines || []) {
            const colorId = $el?.attr?.("data-color-id");
            if (colorId) {
                colorIds.add(String(colorId));
            }
        }
        return colorIds.size > 1;
    },

    _mergeBuyNowDesignForLine($el, productId, cachedDesign, freshDesign, options = {}) {
        const { currentProductId, uniqueProductCount, multiColorCart } = options;
        if (!freshDesign?.length) {
            return cachedDesign || [];
        }
        const lineColorId = String($el.attr("data-color-id") || "");
        const currentColorId = String($('input[name="current_color_id"]').val() || "");
        const isCurrentVariant =
            parseInt(productId, 10) === parseInt(currentProductId, 10) &&
            (!lineColorId || !currentColorId || lineColorId === currentColorId);

        if (multiColorCart) {
            if (isCurrentVariant) {
                return this._mergeDesignExportData(cachedDesign, freshDesign, {
                    preserveSideComposite: true,
                });
            }
            return cachedDesign || [];
        }
        if (uniqueProductCount === 1) {
            return this._mergeDesignExportData(cachedDesign, freshDesign);
        }
        if (isCurrentVariant) {
            return this._mergeDesignExportData(cachedDesign, freshDesign, {
                preserveSideComposite: true,
            });
        }
        return cachedDesign || [];
    },

    _forEachVdpTextObject(callback) {
        for (const side of VDP_SIDES) {
            for (const view of this.canvasesBySide[side] || []) {
                if (!view?.canvas) {
                    continue;
                }
                for (const obj of view.canvas.getObjects()) {
                    if (!obj.center_line && obj.tusVdpKey) {
                        callback(obj, view);
                    }
                }
            }
        }
    },

    _getActiveFabricObject() {
        if (this.currentElement && VDP_TEXT_TYPES.has(this.currentElement.type)) {
            return this.currentElement;
        }
        if (this.canvas?.getActiveObject) {
            const active = this.canvas.getActiveObject();
            if (active && !active.center_line) {
                return active;
            }
        }
        const side = this.active_side || "front";
        for (const view of this.canvasesBySide[side] || []) {
            if (String(view.id) === String(this.active_area_id) && view.canvas) {
                const active = view.canvas.getActiveObject();
                if (active && !active.center_line) {
                    return active;
                }
            }
        }
        return null;
    },

    _humanVdpLabel(key) {
        return (key || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    },

    _isVdpBraceText(text, key) {
        const raw = (text || "").trim();
        const m = raw.match(/^\{\{\s*([a-zA-Z0-9_]+)\s*\}\}$/);
        return Boolean(m && (!key || m[1].toLowerCase() === key.toLowerCase()));
    },

    _vdpDisplayTextForObject(obj) {
        if (!obj) {
            return "";
        }
        if (obj.tusVdpSampleDisplay) {
            return obj.tusVdpSampleDisplay;
        }
        const text = (obj.text || "").trim();
        if (obj.tusVdpKey && this._isVdpBraceText(text, obj.tusVdpKey)) {
            return this._humanVdpLabel(obj.tusVdpKey);
        }
        return text;
    },

    _resetVdpCanvasToSampleDisplay() {
        this._forEachVdpTextObject((obj) => {
            const display = this._vdpDisplayTextForObject(obj);
            obj.set("text", display);
            if (!obj.tusVdpSampleDisplay) {
                obj.set("tusVdpSampleDisplay", display);
            }
            obj.canvas?.requestRenderAll?.();
        });
    },

    _suggestVdpKeyFromText(text) {
        const raw = (text || "").trim();
        const placeholder = raw.match(/^\{\{\s*([a-zA-Z0-9_]+)\s*\}\}$/);
        if (placeholder) {
            return placeholder[1].toLowerCase();
        }
        const slug = raw
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_|_$/g, "")
            .slice(0, 32);
        return slug || "name";
    },

    _getVdpFieldKeyFromUi(ev) {
        let $input = $();
        if (ev?.currentTarget) {
            $input = $(ev.currentTarget)
                .closest(".tus-vdp-panel, .tus-vdp-toolbar-panel, .section_tool_vdp, .section_vdp")
                .find(".tus-vdp-field-key")
                .first();
        }
        if (!$input.length) {
            $input = this.$(".section_tool_vdp:visible .tus-vdp-field-key").first();
        }
        if (!$input.length) {
            $input = this.$(".tus-vdp-field-key").first();
        }
        return ($input.val() || "").trim().toLowerCase().replace(/\s+/g, "_");
    },

    _syncVdpUiFromSelection(elem) {
        if (!this.showVdp) {
            return;
        }
        const isText = elem && VDP_TEXT_TYPES.has(elem.type);
        this.$(".vdp_text_tool").toggleClass("d-none", !isText);
        const key = isText ? (elem.tusVdpKey || this._suggestVdpKeyFromText(elem.text)) : "";
        this.$(".tus-vdp-field-key").val(key);
        const hint = isText
            ? elem.tusVdpKey
                ? _t('Selected text is marked as "%s". Upload CSV with a matching column.', elem.tusVdpKey)
                : _t('Selected text: "%s" — enter a column name and click Mark.', (elem.text || "").slice(0, 48))
            : _t("Click a text layer on the canvas, then use the Variable tab.");
        this.$(".tus-vdp-selection-hint").text(hint);
        if (isText) {
            const display = this._vdpDisplayTextForObject(elem);
            if (elem.tusVdpKey && this._isVdpBraceText(elem.text, elem.tusVdpKey)) {
                elem.set({
                    text: display,
                    tusVdpSampleDisplay: display,
                });
            }
            $(".edit_text").val(display);
        }
    },

    _collectVdpFieldKeysFromCanvas() {
        const keys = new Set();
        this._forEachVdpTextObject((obj) => keys.add(obj.tusVdpKey));
        return [...keys];
    },

    _collectVdpFieldKeysFromDesign(designData) {
        const keys = new Set();
        for (const sideObj of designData || []) {
            for (const cv of sideObj.canvas_vals || []) {
                if (cv.tus_vdp_key) {
                    keys.add(cv.tus_vdp_key);
                }
            }
        }
        return [...keys];
    },

    _markVdpOnObject(obj, key) {
        if (!obj || !VDP_TEXT_TYPES.has(obj.type) || !key) {
            return false;
        }
        let displayText = (obj.text || "").trim();
        if (this._isVdpBraceText(displayText, key)) {
            displayText = obj.tusVdpSampleDisplay || this._humanVdpLabel(key);
        } else if (!displayText) {
            displayText = this._humanVdpLabel(key);
        }
        obj.set({ tusVdpKey: key, tusVdpSampleDisplay: displayText, text: displayText });
        $(".edit_text").val(displayText);
        obj.canvas?.requestRenderAll?.();
        this._vdpSnapshot = null;
        this._syncVdpUiFromSelection(obj);
        this._refreshVdpFieldList();
        return true;
    },

    _onMarkVdpField(ev) {
        ev?.preventDefault?.();
        const obj = this._getActiveFabricObject();
        if (!obj || !VDP_TEXT_TYPES.has(obj.type)) {
            this.notification.add(
                _t("Select a text object on the canvas first."),
                { type: "warning" }
            );
            return;
        }
        const key = this._getVdpFieldKeyFromUi(ev) || this._suggestVdpKeyFromText(obj.text);
        if (!key) {
            this.notification.add(_t("Enter a column name (e.g. name)."), { type: "warning" });
            return;
        }
        if (this._markVdpOnObject(obj, key)) {
            this.notification.add(_t('Text marked as variable "%s".', key), { type: "success" });
        }
    },

    _onUnmarkVdpField(ev) {
        ev?.preventDefault?.();
        const obj = this._getActiveFabricObject();
        if (!obj?.tusVdpKey) {
            this.notification.add(_t("Select a text object marked as a variable."), { type: "warning" });
            return;
        }
        const display = obj.tusVdpSampleDisplay || this._vdpDisplayTextForObject(obj);
        obj.set({ tusVdpKey: null, tusVdpSampleDisplay: null, text: display });
        $(".edit_text").val(display);
        obj.canvas?.requestRenderAll?.();
        this._vdpSnapshot = null;
        this._syncVdpUiFromSelection(obj);
        this._refreshVdpFieldList();
    },

    _refreshVdpFieldList() {
        const keys = this._collectVdpFieldKeysFromCanvas();
        const html = keys.length
            ? keys.map((k) => `<li><code>${k}</code></li>`).join("")
            : `<li class="text-muted">${_t("No variable fields yet.")}</li>`;
        this.$(".tus-vdp-field-list").html(html);
    },

    async _onVdpFileChange(ev) {
        const file = ev.target.files?.[0];
        if (!file) {
            return;
        }
        const formData = new FormData();
        formData.append("file", file);
        this.$(".tus-vdp-upload-status").text(_t("Parsing file…"));
        try {
            const response = await fetch("/product/designer/vdp/parse", {
                method: "POST",
                body: formData,
                credentials: "same-origin",
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || _t("Failed to parse file."));
            }
            this.vdpRecords = data.records || [];
            this.vdpPreviewIndex = 0;
            this.$(".tus-vdp-row-count").text(this.vdpRecords.length);
            this.$(".tus-vdp-preview-index").attr("max", Math.max(0, this.vdpRecords.length - 1)).val(0);
            if (!this._validateVdp(this.vdpRecords)) {
                this.vdpRecords = [];
                this.$(".tus-vdp-row-count").text(0);
                this.$(".tus-vdp-upload-status").text(_t("Invalid data file"));
                return;
            }
            if (this._isMatrixVdpMode()) {
                const matrixResult = await this._prepareVdpMatrixAssignment?.();
                if (!matrixResult?.valid) {
                    this.vdpRecords = [];
                    this.$(".tus-vdp-row-count").text(0);
                    this.$(".tus-vdp-upload-status").text(_t("Mapping errors"));
                    return;
                }
            }
            this.$(".tus-vdp-upload-status").text(_t("%s rows loaded", this.vdpRecords.length));
            await this._applyVdpPreviewRow(0);
        } catch (err) {
            console.error(err);
            this.$(".tus-vdp-upload-status").text(err.message || _t("Upload failed"));
            this.notification.add(err.message || _t("Could not parse data file."), { type: "danger" });
        } finally {
            ev.target.value = "";
        }
    },

    async _onVdpPreviewChange(ev) {
        const idx = parseInt(ev.target.value, 10) || 0;
        this.vdpPreviewIndex = Math.max(0, Math.min(idx, this.vdpRecords.length - 1));
        await this._applyVdpPreviewRow(this.vdpPreviewIndex);
    },

    _snapshotVdpCanvasTexts() {
        const snapshot = [];
        this._forEachVdpTextObject((obj) => {
            snapshot.push({ obj, placeholder: this._vdpDisplayTextForObject(obj) });
        });
        return snapshot;
    },

    _getVdpRowValue(row, key) {
        if (!row || !key) {
            return "";
        }
        if (Object.prototype.hasOwnProperty.call(row, key)) {
            return row[key] ?? "";
        }
        const target = String(key).toLowerCase();
        for (const k of Object.keys(row)) {
            if (k.toLowerCase() === target) {
                return row[k] ?? "";
            }
        }
        return "";
    },

    _setFabricTextContent(obj, text) {
        if (!obj) {
            return;
        }
        obj.set("text", text ?? "");
        if (typeof obj.initDimensions === "function") {
            obj.initDimensions();
        }
        obj.dirty = true;
        obj.setCoords?.();
        obj.canvas?.requestRenderAll?.();
    },

    _syncVdpKeysFromMasterDesign(masterDesign) {
        const keys = this._collectVdpFieldKeysFromDesign(masterDesign);
        if (keys.length !== 1) {
            return;
        }
        const key = keys[0];
        for (const side of VDP_SIDES) {
            for (const view of this.canvasesBySide[side] || []) {
                if (!view?.canvas) {
                    continue;
                }
                for (const obj of view.canvas.getObjects()) {
                    if (!obj.center_line && VDP_TEXT_TYPES.has(obj.type) && !obj.tusVdpKey) {
                        obj.set("tusVdpKey", key);
                    }
                }
            }
        }
    },

    _applyVdpRowToCanvas(row, masterDesign) {
        if (masterDesign?.length) {
            this._syncVdpKeysFromMasterDesign(masterDesign);
        }
        const fields = masterDesign?.length
            ? this._collectVdpFieldKeysFromDesign(masterDesign)
            : this._collectVdpFieldKeysFromCanvas();
        if (!fields.length) {
            return false;
        }

        let applied = 0;
        this._forEachVdpTextObject((obj) => {
            const key = obj.tusVdpKey;
            if (!key) {
                return;
            }
            const value = this._getVdpRowValue(row, key);
            if (value !== "" || Object.keys(row || {}).some((k) => k.toLowerCase() === key.toLowerCase())) {
                this._setFabricTextContent(obj, value);
                applied += 1;
            }
        });

        if (!applied && fields.length === 1) {
            const value = this._getVdpRowValue(row, fields[0]);
            for (const side of VDP_SIDES) {
                for (const view of this.canvasesBySide[side] || []) {
                    if (!view?.canvas) {
                        continue;
                    }
                    for (const obj of view.canvas.getObjects()) {
                        if (obj.center_line || !VDP_TEXT_TYPES.has(obj.type)) {
                            continue;
                        }
                        this._setFabricTextContent(obj, value);
                        applied += 1;
                    }
                }
            }
        }

        // Force synchronous render on all canvases
        for (const side of VDP_SIDES) {
            for (const view of this.canvasesBySide[side] || []) {
                if (view?.canvas) {
                    view.canvas.renderAll();
                }
            }
        }

        return applied > 0;
    },

    _setVdpSnapshotTexts(snapshot, row) {
        for (const entry of snapshot) {
            const key = entry.obj.tusVdpKey;
            const value = row ? this._getVdpRowValue(row, key) : "";
            entry.obj.set("text", row ? (value || entry.placeholder) : entry.placeholder);
            entry.obj.canvas?.requestRenderAll?.();
        }
    },

    async _applyVdpPreviewRow(rowIndex) {
        if (!this.vdpRecords.length) {
            return;
        }
        const row = this.vdpRecords[rowIndex];
        if (!row) {
            return;
        }
        if (!this._vdpSnapshot) {
            this._vdpSnapshot = this._snapshotVdpCanvasTexts();
        }
        this._setVdpSnapshotTexts(this._vdpSnapshot, row);
        this.$(".tus-vdp-preview-label").text(
            _t("Preview row %s / %s", rowIndex + 1, this.vdpRecords.length)
        );
    },

    _restoreVdpPlaceholders() {
        if (this._vdpSnapshot?.length) {
            this._setVdpSnapshotTexts(this._vdpSnapshot, null);
        } else {
            this._resetVdpCanvasToSampleDisplay();
        }
        this._vdpSnapshot = null;
    },

    _validateVdp(records, fields) {
        const fieldList = fields || this._collectVdpFieldKeysFromCanvas();
        if (!fieldList.length) {
            this.notification.add(
                _t("Mark at least one text field as a variable (Variable tab → Mark as variable)."),
                { type: "danger" }
            );
            return false;
        }
        const rows = records || this.vdpRecords;
        if (!rows?.length) {
            this.notification.add(_t("Upload a CSV or Excel file in the VDP sidebar tab."), { type: "danger" });
            return false;
        }
        const missing = fieldList.filter(
            (k) => !rows.every((row) =>
                Object.keys(row || {}).some((rk) => rk.toLowerCase() === k.toLowerCase())
            )
        );
        if (missing.length) {
            this.notification.add(_t("Data file is missing columns: %s", missing.join(", ")), { type: "danger" });
            return false;
        }
        return true;
    },

    _validateVdpForCheckout() {
        if (!this._isVdpActive()) {
            return true;
        }
        return this._validateVdp();
    },

    _parseVdpCartMeta($el) {
        const vdpAttr = $el.attr("data-vdp");
        if (!vdpAttr) {
            return null;
        }
        try {
            return JSON.parse(vdpAttr.replace(/&#39;/g, "'"));
        } catch (e) {
            console.warn("Failed to parse VDP cart metadata", e);
            return null;
        }
    },

    _beginVdpCheckoutUi(message) {
        if (this._vdpCheckoutOpen) {
            this._updateVdpCheckoutUi(message);
            return;
        }
        this._vdpCheckoutOpen = true;
        document.body.classList.add(TUS_VDP_CHECKOUT_BODY_CLASS);
        const overlay = document.createElement("div");
        overlay.className = TUS_VDP_PROCESSING_OVERLAY_CLASS;
        overlay.innerHTML = `
            <div class="tus-vdp-processing-card">
                <i class="fa fa-spinner fa-spin fa-2x mb-3"></i>
                <p class="tus-vdp-processing-title mb-1 fw-semibold">${message || _t("Preparing your personalized order…")}</p>
                <p class="tus-vdp-processing-detail mb-0 text-muted small"></p>
            </div>`;
        document.body.appendChild(overlay);
    },

    _updateVdpCheckoutUi(title, detail) {
        const overlay = document.querySelector(`.${TUS_VDP_PROCESSING_OVERLAY_CLASS}`);
        if (!overlay) {
            return;
        }
        if (title) {
            const titleEl = overlay.querySelector(".tus-vdp-processing-title");
            if (titleEl) {
                titleEl.textContent = title;
            }
        }
        const detailEl = overlay.querySelector(".tus-vdp-processing-detail");
        if (detailEl) {
            detailEl.textContent = detail || "";
        }
    },

    _endVdpCheckoutUi() {
        if (!this._vdpCheckoutOpen) {
            return;
        }
        this._vdpCheckoutOpen = false;
        document.body.classList.remove(TUS_VDP_CHECKOUT_BODY_CLASS);
        document.querySelectorAll(`.${TUS_VDP_PROCESSING_OVERLAY_CLASS}`).forEach((el) => el.remove());
    },

    _captureMockupBackgrounds() {
        const backgrounds = {};
        for (const side of VDP_SIDES) {
            backgrounds[side] = $(`#${side}_canvas .main_canvas_img`).attr("src");
        }
        return backgrounds;
    },

    _restoreMockupBackgrounds(backgrounds) {
        if (!backgrounds) {
            return;
        }
        for (const side of VDP_SIDES) {
            if (backgrounds[side]) {
                $(`#${side}_canvas .main_canvas_img`).attr("src", backgrounds[side]);
            }
        }
    },

    async _swapMockupForColorId(colorId) {
        if (!colorId) {
            return;
        }
        const views = await this.rpc("/get_product_views", {
            product_tmpl_id: parseInt($('input[name="product_tmpl_id"]').val(), 10),
            product_id: null,
            color_id: colorId,
        });
        for (const side of VDP_SIDES) {
            const sideView = (views || []).find((v) => v.title === side);
            if (!sideView?.thumbnail) {
                continue;
            }
            const $img = $(`#${side}_canvas .main_canvas_img`);
            await new Promise((resolve) => {
                $img.one("load", resolve).one("error", resolve);
                $img.attr("src", sideView.thumbnail);
                setTimeout(resolve, 600);
            });
        }
    },

    _buildVdpMetadataForLine(records, masterDesign, options = {}) {
        if (!this._validateVdp(records)) {
            return null;
        }
        const master = masterDesign || [];
        const fields = master.length
            ? this._collectVdpFieldKeysFromDesign(master)
            : this._collectVdpFieldKeysFromCanvas();
        const omitMaster = options.omitMaster ?? (records.length > 10);
        return {
            fields,
            records: records || [],
            master_design: omitMaster ? [] : master,
            designs: [],
        };
    },

    async _prepareMockupUrlsForExport(mockupUrls) {
        if (!mockupUrls) {
            return;
        }
        this._restoreMockupBackgrounds(mockupUrls);
        const loaders = [];
        for (const side of VDP_SIDES) {
            const url = mockupUrls[side];
            if (!url) {
                continue;
            }
            const $img = $(`#${side}_canvas .main_canvas_img`);
            const imgEl = $img[0];
            if (!imgEl) {
                continue;
            }
            loaders.push(
                new Promise((resolve) => {
                    const done = () => {
                        $img.off("load error", done);
                        resolve();
                    };
                    $img.one("load", done).one("error", done);
                    if (imgEl.getAttribute("src") !== url) {
                        $img.attr("src", url);
                    } else if (imgEl.complete) {
                        setTimeout(done, 50);
                    }
                })
            );
        }
        await Promise.all(loaders);
        if (typeof this.restructureCanvas === "function") {
            this.restructureCanvas({ preserveSelection: true });
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }
    },

    async _uploadPendingVdpDesigns(uploadJobs, contextsByProductId) {
        if (!uploadJobs?.length) {
            return;
        }
        const contexts = contextsByProductId instanceof Map
            ? contextsByProductId
            : new Map(Object.entries(contextsByProductId || {}).map(([k, v]) => [k, v]));

        const savedBackgrounds = this._captureMockupBackgrounds();
        try {
            for (const job of uploadJobs) {
                const productId = parseInt(job.product_id, 10);
                const contextKey = this._vdpContextKey(productId, job.color_id);
                const ctx = contexts.get(contextKey) || contexts.get(productId);
                if (!ctx?.records?.length) {
                    throw new Error(_t("Missing VDP export context for product %s", productId));
                }
                const records = ctx.records;
                if (records.length > VDP_MAX_ROWS) {
                    throw new Error(_t("VDP supports up to %s rows per order.", VDP_MAX_ROWS));
                }

                if (ctx.mockupUrls) {
                    await this._prepareMockupUrlsForExport(ctx.mockupUrls);
                } else if (ctx.colorId) {
                    await this._swapMockupForColorId(ctx.colorId);
                }

                await this._runCanvasExportBatch(async () => {
                    try {
                        for (let start = 0; start < records.length; start += VDP_UPLOAD_BATCH_SIZE) {
                            const batchRecords = records.slice(start, start + VDP_UPLOAD_BATCH_SIZE);
                            const designs = [];
                            for (const row of batchRecords) {
                                if (!this._applyVdpRowToCanvas(row, ctx.masterDesign)) {
                                    throw new Error(
                                        _t("Could not apply CSV text — mark a variable field on the design.")
                                    );
                                }
                                await new Promise((resolve) => {
                                    requestAnimationFrame(resolve);
                                });
                                const exported = await this._collectDesignData({
                                    includeElementImages: true,
                                });
                                if (!exported?.length) {
                                    throw new Error(_t("VDP design export failed."));
                                }
                                designs.push(exported);
                            }
                            const endRow = start + batchRecords.length;
                            this._updateVdpCheckoutUi(
                                _t("Uploading personalized designs…"),
                                _t("Rows %s–%s of %s", start + 1, endRow, records.length)
                            );
                            const result = await this.rpc("/shop/vdp/upload-designs", {
                                line_id: job.line_id,
                                start_index: start,
                                designs,
                                master_design: start === 0 ? (ctx.masterDesign || null) : null,
                            });
                            if (result?.error) {
                                throw new Error(result.error);
                            }
                        }
                    } finally {
                        this._resetVdpCanvasToSampleDisplay();
                    }
                });
            }
        } finally {
            this._restoreMockupBackgrounds(savedBackgrounds);
        }
    },
};
