/** @odoo-module **/

import { _t } from "@web/core/l10n/translation";
import { renderToFragment } from "@web/core/utils/render";
import { normalizeDesignAreas } from "../design_area_shapes";
import {
    ensureObjectFinishDefaults,
    serializeFinishFields,
    serializeGlobalFinishSettings,
} from "../3d/finish_effects";
import { serializeFinishUploadFields } from "./finish_upload_mixin";
import { resolveCmykForColor } from "./color_cmyk";

export const fabricMatrixMixin = {
    _getActiveColorId: function () {
        const $selected = $('.color-swap.selected-color');
        if ($selected.length) {
            const colorId = parseInt($selected.attr('data-color_attr_value_id'), 10);
            if (colorId) {
                return colorId;
            }
        }
        const fromInput = parseInt($('input[name="current_color_id"]').val(), 10);
        return fromInput || null;
    },

    _syncColorSelectionUi: function (colorId) {
        if (!colorId) {
            return;
        }
        $('input[name="current_color_id"]').val(colorId);
        $('.color-swap').removeClass('selected-color');
        const $swatch = $(`.color-swap[data-color_attr_value_id="${colorId}"]`);
        $swatch.addClass('selected-color');

        const colorName = $swatch.attr('title')
            || ($swatch.find('.small').text() || '').trim();
        const $badge = $('.tus-topbar-brand .tus-product-badge-name');
        if ($badge.length && colorName) {
            const base = $badge.data('base-name')
                || $badge.text().replace(/\s*\([^)]*\)\s*$/, '').trim();
            if (!$badge.data('base-name')) {
                $badge.data('base-name', base);
            }
            const newName = `${base} (${colorName})`;
            $badge.text(newName);
            $badge.attr('title', newName);
        }
    },

    _loadPrintingMethods: async function (productTmplId) {
        try {
            const methods = await this.rpc("/get_printing_methods", { product_tmpl_id: productTmplId });
            this.printingMethods = methods || [];
            const $wrapper = $('#printing-method-selector-wrapper');
            const $select = $('#printing-method-select');

            if (this.printingMethods.length > 0) {
                $select.empty();
                this.printingMethods.forEach(method => {
                    $select.append(`<option value="${method.id}" data-setup="${method.setup_cost}" data-unit="${method.unit_cost}">${method.name}</option>`);
                });
                this.selectedPrintingMethod = this.printingMethods[0];
                $wrapper.removeClass('d-none').addClass('d-flex');

                $select.off('change').on('change', (ev) => {
                    const selectedId = parseInt($(ev.currentTarget).val());
                    this.selectedPrintingMethod = this.printingMethods.find(m => m.id === selectedId) || null;
                    this._updateDesignerPriceDisplay();
                    this._updateTotals();
                    if ($('.tus-matrix-row').length > 0) {
                        this._updateMatrixTotal();
                    }
                });
            } else {
                this.selectedPrintingMethod = null;
                $wrapper.addClass('d-none').removeClass('d-flex');
            }
        } catch (err) {
            console.error("Error loading printing methods:", err);
        }
    },

    _loadViews: async function (viewsData, options = {}) {
        const shareToken = (this._getShareToken && this._getShareToken())
            || $('input[name="share_token"]').val()
            || "";

        // Allow matrix color swaps to reload views while re-applying the cached share bundle.
        if (shareToken && options.skipShareRestore && this._shareCachedBundle) {
            viewsData = viewsData || [];
        } else if (!viewsData && !shareToken) {
            return;
        } else if (!viewsData) {
            viewsData = [];
        }

        if (
            shareToken
            && !options.skipShareRestore
            && this.el?.dataset?.tusShareViewsLoaded === "1"
        ) {
            return;
        }
        if (shareToken && !options.skipShareRestore && this.el) {
            this.el.dataset.tusShareViewsLoading = "1";
        }

        let pendingShareBundle = null;
        if (shareToken && !options.skipShareRestore) {
            this._defaultTemplateApplied = true;
            try {
                const versionHint = $('input[name="share_bundle_version"]').val() || "0";
                const text = await this.http.get(
                    `/product/designer/share/${shareToken}/data?meta=1&v=${versionHint}&_=${Date.now()}`,
                    "text"
                );
                const metaResponse = JSON.parse(text);
                pendingShareBundle = metaResponse.bundle;
                this._shareCachedBundle = pendingShareBundle;
                this._shareBundleVersion = metaResponse.bundle_version || 1;
                this._updateShareStatusBar?.(
                    metaResponse.last_saved_by,
                    metaResponse.last_saved_at,
                    metaResponse.bundle_version
                );
                const showMatrix = $('input[name="show_matrix_table"]').val() === '1';
                const bundleProductId = pendingShareBundle.product_id
                    || parseInt($('input[name="product_id"]').val(), 10)
                    || null;
                const emptyCanvasRpc = this._buildEmptyCanvasRpcParams?.(
                    pendingShareBundle.empty_canvas
                ) || {};

                if (showMatrix) {
                    const colorId = pendingShareBundle.color_id
                        || parseInt($('input[name="current_color_id"]').val(), 10)
                        || null;
                    if (colorId) {
                        this._syncColorSelectionUi(colorId);
                        viewsData = await this.rpc("/get_product_views", {
                            product_tmpl_id: parseInt($('input[name="product_tmpl_id"]').val()),
                            product_id: null,
                            color_id: colorId,
                            ...emptyCanvasRpc,
                        });
                    }
                } else if (bundleProductId) {
                    $('input[name="product_id"]').val(bundleProductId);
                    if (this._syncVariantSelectionUi) {
                        this._syncVariantSelectionUi(bundleProductId);
                    }
                    viewsData = await this.rpc("/get_product_views", {
                        product_tmpl_id: parseInt($('input[name="product_tmpl_id"]').val()),
                        product_id: bundleProductId,
                        color_id: null,
                        ...emptyCanvasRpc,
                    });
                }
                if (!viewsData || !viewsData.length) {
                    viewsData = await this.rpc("/get_product_views", {
                        product_tmpl_id: parseInt($('input[name="product_tmpl_id"]').val()),
                        product_id: null,
                        color_id: null,
                        ...emptyCanvasRpc,
                    });
                }
            } catch (e) {
                console.error("Failed to prepare shared design views:", e);
            }
        } else if (shareToken && options.skipShareRestore && this._shareCachedBundle) {
            pendingShareBundle = this._shareCachedBundle;
            this._defaultTemplateApplied = true;
        }

        // Cleanup existing canvases
        for (const side in this.canvasesBySide) {
            this.canvasesBySide[side].forEach(entry => {
                entry.canvas.dispose();
                entry.wrapper.remove();
            });
        }
        this.canvasesBySide = { front: [], back: [], left: [], right: [] };
        this.fabricByAreaId = {};
        this.frontAreasData = [];
        this.backAreasData = [];
        this.leftAreasData = [];
        this.rightAreasData = [];

        viewsData.forEach((view) => {
            const stageW = view.stage_width || this.DEFAULT_STAGE.w;
            const stageH = view.stage_height || this.DEFAULT_STAGE.h;
            const stageInfo = {
                w: stageW,
                h: stageH,
                imageW: view.image_width || stageW,
                imageH: view.image_height || stageH,
            };

            // Update background image for this side
            const $sideContainer = $(`#${view.title}_canvas`);
            if ($sideContainer.length && view.thumbnail) {
                $sideContainer.find('img.main_canvas_img').attr('src', view.thumbnail);
                // Also update the side switcher (Front/Back) thumbnails
                $(`.canvas-tabs button[id="${view.title}-tab"] img.canvas-thumb`).attr('src', view.thumbnail);
            }

            const normalizedAreas = normalizeDesignAreas(view.design_areas_json);
            view.design_areas_json = normalizedAreas;

            if (view.title === 'front') {
                this.frontAreasData = normalizedAreas;
                this.stageBySide.front = stageInfo;
            } else if (view.title === 'back') {
                this.backAreasData = normalizedAreas;
                this.stageBySide.back = stageInfo;
            } else if (view.title === 'left') {
                this.leftAreasData = normalizedAreas;
                this.stageBySide.left = stageInfo;
            } else if (view.title === 'right') {
                this.rightAreasData = normalizedAreas;
                this.stageBySide.right = stageInfo;
            }
            this.createCanvas(view);
        });

        // Set initial active side and fabric canvas
        this.active_side = viewsData?.[0]?.title || 'front';
        const firstEntry = (this.canvasesBySide[this.active_side] || [])[0];
        if (firstEntry && firstEntry.canvas) {
            this.canvas = firstEntry.canvas;
            this.active_area_id = firstEntry.id;
        }
        this._renderAreaSelectorForSide(this.active_side, this.active_area_id);
        if (!pendingShareBundle) {
            this.restructureCanvas();
        }

        this.viewsData = viewsData;

        if (pendingShareBundle) {
            try {
                const showMatrix = $('input[name="show_matrix_table"]').val() === '1';
                await this._restoreDesignBundle(pendingShareBundle, {
                    fitToFullArea: true,
                    skipVariantSwitch: showMatrix,
                });
                this._shareDesignRestored = true;
                if (this.el) {
                    this.el.dataset.tusShareViewsLoaded = "1";
                }
            } catch (e) {
                console.error("Failed to load shared design:", e);
            }
            const shareCanWrite = $('input[name="share_can_write"]').val();
            if (this._applyShareGuestAccessState) {
                this._applyShareGuestAccessState(shareCanWrite === "1");
            } else if (shareCanWrite !== "1") {
                $(".fabric_container").addClass("tus-preview-mode tus-share-view-only");
                this._setTusPreviewMode(true);
            }
            this._bindGuestAccessRefresh?.();
            if (shareToken && !options.skipShareRestore && this.el) {
                delete this.el.dataset.tusShareViewsLoading;
            }
            return;
        }

        const defaultTemplateId = parseInt(
            $('input[name="default_product_template_id"]').val() || "0",
            10
        );
        const templatesEnabled = this.personalizerConfig?.enable_templates !== false;
        const emptyCanvasTemplatesEnabled =
            !this.emptyCanvasMode
            || this.personalizerConfig?.empty_canvas_enable_design_templates !== false
            || $('input[name="empty_canvas_enable_design_templates"]').val() === "1";
        if (
            defaultTemplateId
            && !this._defaultTemplateApplied
            && !shareToken
            && templatesEnabled
            && emptyCanvasTemplatesEnabled
        ) {
            this._defaultTemplateApplied = true;
            if (!this._canvasHasUserArtwork()) {
                try {
                    await this._applyProductTemplateById(defaultTemplateId);
                } catch (e) {
                    console.warn("Default template apply failed", e);
                }
            }
        }
        if (shareToken && !options.skipShareRestore && this.el) {
            delete this.el.dataset.tusShareViewsLoading;
        }
    },

    _onMatrixColorSwap: async function (ev) {
        const $target = $(ev.currentTarget);
        const colorId = parseInt($target.attr('data-color_attr_value_id'), 10);
        if (!colorId) return;

        $('.color-swap').removeClass('selected-color');
        $target.addClass('selected-color');
        $('input[name="current_color_id"]').val(colorId);

        this.startLoader("Loading Color Views...", { scope: "canvas" });
        try {
            const views = await this.rpc("/get_product_views", {
                product_tmpl_id: parseInt($('input[name="product_tmpl_id"]').val()),
                product_id: null,
                color_id: colorId
            });
            await this._loadViews(views, { skipShareRestore: true });

            // Premium topbar: reflect the active colour in the product badge
            // for matrix flow (where no variant change happens).
            const colorName = $target.attr('title') || ($target.find('.small').text() || '').trim();
            const $badge = $('.tus-topbar-brand .tus-product-badge-name');
            if ($badge.length && colorName) {
                const base = $badge.data('base-name') || $badge.text().replace(/\s*\([^)]*\)\s*$/, '').trim();
                if (!$badge.data('base-name')) {
                    $badge.data('base-name', base);
                }
                const newName = `${base} (${colorName})`;
                $badge.text(newName);
                $badge.attr('title', newName);
            }
        } finally {
            this.removeLoader();
        }
    },

    _showMatrixTable: async function () {
        const product_tmpl_id = parseInt($('input[name="product_tmpl_id"]').val());
        const matrix_data = await this.rpc('/tus_personalizer/matrix/data', { product_tmpl_id });
        this.matrixData = matrix_data;

        const $overlay = $('#tus-matrix-split-view');
        const $container = $overlay.find('.tus-matrix-container');
        const $loading = $overlay.find('.tus-matrix-loading');
        const $previewImg = $overlay.find('.tus-matrix-preview-image');

        // Take a snapshot of the current design for preview (composite including product background)
        // We MUST await this before hiding the UI, otherwise bounding boxes will be 0 and the design won't export!
        const self = this;
        this.startLoader("Preparing Matrix...");
        try {
            const dataURL = await this._exportSideComposite(this.active_side, { format: "png", quality: 0.8 });
            if (dataURL) {
                $previewImg.attr('src', dataURL);
            }
        } catch (err) {
            console.error("Matrix preview generation failed", err);
            // Fallback to simple canvas if composite fails
            if (self.canvas) {
                $previewImg.attr('src', self.canvas.toDataURL());
            }
        } finally {
            this.removeLoader();
        }

        $overlay.removeClass('d-none');
        $loading.removeClass('d-none');
        $container.addClass('d-none');

        // Hide designer chrome so the matrix overlay owns the viewport
        $('.fabric_container').addClass('tus-matrix-open');
        $('.fabric_container .editor_view > .action_bar, .fabric_container .editor_view > .tus-designer-body, .fabric_container .editor_view > .tus-designer-footer').addClass('d-none');
        $('.canvas-tabs, .design-area-tabs, .editor_options_wrapper').addClass('d-none');

        const matrix = {
            product_template_id: product_tmpl_id,
            colors: matrix_data.map(c => ({
                id: c.color_id,
                name: c.color_name,
                html_color: c.html_color,
                image: c.image
            }))
        };

        const fragment = renderToFragment('tus_product_personalizer.MatrixContent', {
            matrix: matrix
        });
        $container.empty().append(fragment).removeClass('d-none');
        $loading.addClass('d-none');

        // Pre-select current color from designer
        const $currentColorBtn = $('.color-swap.selected-color');
        if ($currentColorBtn.length) {
            const currentColorId = $currentColorBtn.data('color_attr_value_id');
            const $matrixOption = $container.find(`.tus-matrix-color-option[data-color-id="${currentColorId}"]`);
            if ($matrixOption.length) {
                $matrixOption.click();
            }
        }

        if (!this._isVdpActive?.()) {
            this._vdpMatrixAssignment = null;
        }

        if (this._isVdpActive?.()) {
            const matrixResult = await this._prepareVdpMatrixAssignment();
            if (matrixResult.valid && matrixResult.assignment) {
                this._selectMatrixColorsForAssignment(matrixResult.assignment, $container);
                this._syncMatrixFromVdpAssignment(matrixResult.assignment);
            }
        }
    },

    _vdpRowVal(row, ...keys) {
        for (const key of keys) {
            if (Object.prototype.hasOwnProperty.call(row, key)) {
                const value = row[key];
                if (value !== null && value !== undefined && String(value).trim() !== "") {
                    return String(value).trim();
                }
            }
        }
        return "";
    },

    _normMatrixLabel(value) {
        return (value || "").trim().toLowerCase().split("/")[0].trim();
    },

    _matrixVariantIndex() {
        const variants = [];
        for (const color of this.matrixData || []) {
            const colorKey = (color.color_name || "").trim().toLowerCase();
            for (const size of color.sizes || []) {
                variants.push({
                    product_id: size.product_id,
                    color_id: color.color_id,
                    color_key: colorKey,
                    size_label: size.size_label,
                    size_key: this._normMatrixLabel(size.size_label),
                });
            }
        }
        return variants;
    },

    _mapVdpRowsToMatrix(records) {
        const errors = [];
        const byProductId = {};
        const variants = this._matrixVariantIndex();
        const sizeLabels = [...new Set(variants.map((v) => v.size_label))];
        const hasColor = records.some((row) => this._vdpRowVal(row, "color", "colour", "Color"));

        if (!records.some((row) => this._vdpRowVal(row, "size", "Size"))) {
            return {
                valid: false,
                errors: [_t('Bulk matrix orders require a "size" column in your CSV.')],
                byProductId,
            };
        }

        records.forEach((row, idx) => {
            const rowNum = idx + 1;
            const sizeRef = this._vdpRowVal(row, "size", "Size");
            const colorRef = this._vdpRowVal(row, "color", "colour", "Color");
            if (!sizeRef) {
                errors.push(_t("Row %s: missing size.", rowNum));
                return;
            }
            const colorKey = hasColor ? colorRef.trim().toLowerCase() : null;
            const matches = variants.filter((variant) => {
                if (variant.size_key !== this._normMatrixLabel(sizeRef)) {
                    return false;
                }
                return !colorKey || variant.color_key === colorKey;
            });
            if (matches.length !== 1) {
                errors.push(
                    matches.length
                        ? _t('Row %s: size "%s" is ambiguous — add a color column.', rowNum, sizeRef)
                        : _t(
                            'Row %s: size "%s" is not available. Sizes: %s',
                            rowNum,
                            sizeRef,
                            sizeLabels.join(", ")
                        )
                );
                return;
            }
            const productId = matches[0].product_id;
            if (!byProductId[productId]) {
                byProductId[productId] = [];
            }
            byProductId[productId].push(row);
        });

        return { valid: !errors.length, errors, byProductId };
    },

    async _prepareVdpMatrixAssignment() {
        if (!this._isVdpActive() || !this.showMatrixTable) {
            this._vdpMatrixAssignment = null;
            return { valid: true, assignment: null };
        }
        if (!this.matrixData?.length) {
            const productTmplId = parseInt($('input[name="product_tmpl_id"]').val(), 10);
            this.matrixData = await this.rpc("/tus_personalizer/matrix/data", {
                product_tmpl_id: productTmplId,
            });
        }
        const assignment = this._mapVdpRowsToMatrix(this.vdpRecords);
        if (!assignment.valid) {
            this._vdpMatrixAssignment = null;
            const message = assignment.errors.slice(0, 5).join("\n");
            this.notification.add(message, { type: "danger" });
            return { valid: false, message, assignment };
        }
        this._vdpMatrixAssignment = assignment;
        return { valid: true, assignment };
    },

    _syncMatrixFromVdpAssignment(assignment) {
        if (!assignment?.byProductId) {
            return;
        }
        this.matrixQuantities = {};
        for (const variant of this._matrixVariantIndex()) {
            this.matrixQuantities[variant.product_id] =
                (assignment.byProductId[variant.product_id] || []).length;
        }
        const symbol = this._getCurrencySymbol();
        $(".tus-matrix-input").each((_, el) => {
            const $input = $(el);
            const productId = parseInt($input.data("product-id"), 10);
            const qty = this.matrixQuantities[productId] || 0;
            $input.val(qty);
            const price = parseFloat($input.data("price")) || 0;
            $input.closest(".tus-matrix-row")
                .find(".variant-subtotal")
                .text(`${symbol}${(qty * price).toFixed(2)}`);
        });
        this._updateMatrixTotal();
    },

    _selectMatrixColorsForAssignment(assignment, $container) {
        if (!assignment?.byProductId || !$container?.length) {
            return;
        }
        const colorIds = new Set();
        for (const variant of this._matrixVariantIndex()) {
            if ((assignment.byProductId[variant.product_id] || []).length) {
                colorIds.add(variant.color_id);
            }
        }
        if (!colorIds.size) {
            return;
        }
        this.selectedColorIds = [...colorIds];
        $container.find(".tus-matrix-color-option").removeClass("active");
        colorIds.forEach((colorId) => {
            $container.find(`.tus-matrix-color-option[data-color-id="${colorId}"]`).addClass("active");
        });
        this._renderMatrixTables();
    },

    _onMatrixColorSelect: function (ev) {
        const $target = $(ev.currentTarget);
        const colorId = parseInt($target.data('color-id'));
        if (!colorId) return;

        if (!this.selectedColorIds) this.selectedColorIds = [];

        if ($target.hasClass('active')) {
            $target.removeClass('active');
            this.selectedColorIds = this.selectedColorIds.filter(id => id !== colorId);
        } else {
            $target.addClass('active');
            this.selectedColorIds.push(colorId);
            // Update preview to show the newly selected color
            this._updateMatrixPreview(colorId);
        }

        this._renderMatrixTables();
    },

    _updateMatrixPreview: async function (colorId) {
        const colorData = this.matrixData.find(c => c.color_id === colorId);
        if (!colorData) return;

        const $overlay = $('#tus-matrix-split-view');
        const $previewImg = $overlay.find('.tus-matrix-preview-image');
        const $previewLoading = $overlay.find('.tus-matrix-preview-loading');

        $previewLoading.removeClass('d-none');

        try {
            // Fetch views for this color to get the correct side image (Front/Back etc)
            const views = await this.rpc("/get_product_views", {
                product_tmpl_id: parseInt($('input[name="product_tmpl_id"]').val()),
                product_id: null,
                color_id: colorId
            });

            const targetView = views.find(v => v.title === this.active_side);
            if (!targetView || !targetView.thumbnail) {
                // If specific side not found, fallback to variant image
                if (colorData.background_image) {
                    const dataURL = await this._generateCompositeWithImage(colorData.background_image);
                    $previewImg.attr('src', dataURL);
                }
                return;
            }

            const backgroundImage = targetView.thumbnail;

            // Temporarily swap background of the main canvas container to take composite snapshot
            const $mainImg = $(`#${this.active_side}_canvas .main_canvas_img`);
            const originalSrc = $mainImg.attr('src');

            // Wait for image to load before taking snapshot
            await new Promise((resolve, reject) => {
                $mainImg.one('load', resolve).one('error', reject).attr('src', backgroundImage);
                setTimeout(resolve, 2000);
            });

            // Temporarily unhide main_wrapper so bounding rects can be calculated for design overlay
            const $mainWrapper = $('.fabric_container .editor_view > .main_wrapper');
            $mainWrapper.removeClass('d-none');

            const dataURL = await this._exportSideComposite(this.active_side, { format: "png", quality: 0.8 });

            // Re-hide main_wrapper after snapshot is taken
            $mainWrapper.addClass('d-none');

            $previewImg.attr('src', dataURL);

            // Restore original background
            $mainImg.attr('src', originalSrc);
        } catch (e) {
            console.error("Matrix preview update failed", e);
        } finally {
            $previewLoading.addClass('d-none');
        }
    },

    _generateCompositeWithImage: async function (imgUrl) {
        // Fallback helper to generate composite with a generic image URL
        const $mainImg = $(`#${this.active_side}_canvas .main_canvas_img`);
        const originalSrc = $mainImg.attr('src');
        $mainImg.attr('src', imgUrl);
        await new Promise(r => setTimeout(r, 500));

        // Temporarily unhide main_wrapper so bounding rects can be calculated
        const $mainWrapper = $('.fabric_container .editor_view > .main_wrapper');
        const wasHidden = $mainWrapper.hasClass('d-none');
        if (wasHidden) $mainWrapper.removeClass('d-none');

        const dataURL = await this._exportSideComposite(this.active_side, { format: "png", quality: 0.8 });

        if (wasHidden) $mainWrapper.addClass('d-none');

        $mainImg.attr('src', originalSrc);
        return dataURL;
    },

    _renderMatrixTables: function () {
        const $container = $('.tus-matrix-size-tables');

        if (!this.selectedColorIds || this.selectedColorIds.length === 0) {
            $container.html('<div class="text-center text-muted py-4 tus-matrix-tables-placeholder">Select colors and other options to see size tables.</div>');
            return;
        }

        let html = '';
        this.selectedColorIds.forEach(colorId => {
            const colorData = this.matrixData.find(c => c.color_id === colorId);
            if (colorData) {
                html += this._buildColorTableHtml(colorData);
            }
        });

        $container.html(html);
        if (this._isVdpActive?.() && this._vdpMatrixAssignment?.byProductId) {
            this._syncMatrixFromVdpAssignment(this._vdpMatrixAssignment);
        } else {
            this._updateMatrixTotal();
        }
    },

    _buildColorTableHtml: function (colorData) {
        const symbol = this._getCurrencySymbol();
        const showDesignPrice = $('input[name="show_design_price"]').val() === '1';
        let html = `<div class="card mb-3 shadow-sm border-0" data-color-id="${colorData.color_id}">`;
        html += `<div class="card-header bg-light d-flex align-items-center justify-content-between border-bottom">`;
        html += `<div>`;
        if (colorData.html_color) {
            html += `<span class="me-2" style="background-color: ${colorData.html_color}; width: 18px; height: 18px; border-radius: 50%; display: inline-block; border: 1px solid #ddd; vertical-align: middle;"></span>`;
        }
        html += `<strong class="align-middle">${colorData.color_name}</strong>`;
        html += `</div>`;
        html += `<span class="badge bg-secondary text-white">Size Options</span>`;
        html += `</div>`;
        html += `<div class="card-body p-0">`;

        const designPriceHeaderCol = showDesignPrice ? `<div class="col-md-3 text-center">Design Areas</div>` : '';
        const sizeColClass = showDesignPrice ? 'col-md-2' : 'col-md-3';
        const priceColClass = showDesignPrice ? 'col-md-2' : 'col-md-3';

        html += `
        <div class="row g-0 align-items-center py-2 px-3 bg-light border-bottom d-none d-md-flex text-muted small fw-bold">
            <div class="${sizeColClass} ps-2">Size</div>
            <div class="${priceColClass} text-center">Price</div>
            ${designPriceHeaderCol}
            <div class="col-md-3 text-center">Quantity</div>
            <div class="col-md-2 text-end pe-2">Subtotal</div>
        </div>
    `;

        colorData.sizes.forEach(size => {
            const qty = (this.matrixQuantities && this.matrixQuantities[size.product_id]) || 0;
            const subtotal = qty * size.price;

            let designAreasHtml = '';
            if (showDesignPrice) {
                const activeAreas = this._getActiveDesignAreasInfo();
                const areasList = activeAreas.length > 0
                    ? activeAreas.map(a => `<div class="small text-muted">${a.name} (+${symbol}${a.price.toFixed(2)})</div>`).join('')
                    : '<span class="text-muted small">None</span>';
                designAreasHtml = `
                <div class="col-12 col-md-3 text-md-center mb-2 mb-md-0 order-3 order-md-3">
                    <span class="d-md-none text-muted small me-2">Design:</span>
                    ${areasList}
                </div>
            `;
            }

            html += `
            <div class="row g-0 align-items-center py-3 px-3 border-bottom tus-matrix-row" data-product-id="${size.product_id}" data-color-id="${colorData.color_id}">
                <div class="col-6 ${sizeColClass} mb-2 mb-md-0 fw-bold order-1 order-md-1 ps-md-2">
                    ${size.size_label}
                </div>
                <div class="col-6 ${priceColClass} text-end text-md-center mb-2 mb-md-0 text-muted order-2 order-md-2">
                    ${symbol}${size.price.toFixed(2)}
                </div>
                ${designAreasHtml}
                <div class="col-6 col-md-3 text-md-center mt-2 mt-md-0 order-4 order-md-4">
                    <span class="d-md-none text-muted small me-2">Qty:</span>
                    <input type="number" min="0" value="${qty}" class="form-control form-control-sm d-inline-block text-center tus-matrix-input" style="max-width: 80px;" data-product-id="${size.product_id}" data-price="${size.price}" data-color-name="${colorData.color_name}" data-size-label="${size.size_label}"/>
                </div>
                <div class="col-6 col-md-2 text-end fw-bold mt-2 mt-md-0 variant-subtotal order-5 order-md-5 pe-2">
                    ${symbol}${subtotal.toFixed(2)}
                </div>
            </div>
        `;
        });

        html += `</div></div>`;
        return html;
    },

    _onCancelMatrix: function () {
        $('#tus-matrix-split-view').addClass('d-none');
        this.selectedColorIds = [];
        this.matrixQuantities = {};
        $('.tus-matrix-color-option').removeClass('active');

        // Restore designer chrome
        $('.fabric_container').removeClass('tus-matrix-open');
        $('.fabric_container .editor_view > .action_bar, .fabric_container .editor_view > .tus-designer-body, .fabric_container .editor_view > .tus-designer-footer').removeClass('d-none');
        $('.canvas-tabs, .design-area-tabs, .editor_options_wrapper').removeClass('d-none');
    },

    _onMatrixQtyChange: function (ev) {
        const $input = $(ev.currentTarget);
        const productId = parseInt($input.data('product-id'));
        const qty = parseInt($input.val()) || 0;

        if (!this.matrixQuantities) this.matrixQuantities = {};
        this.matrixQuantities[productId] = qty;

        const price = parseFloat($input.data('price')) || 0;
        const subtotal = qty * price;

        const symbol = this._getCurrencySymbol();
        $input.closest('.tus-matrix-row').find('.variant-subtotal').text(`${symbol}${subtotal.toFixed(2)}`);
        this._updateMatrixTotal();
    },

    _updateMatrixTotal: function () {
        let productTotal = 0;
        let totalQty = 0;
        const designPricePerUnit = this._calculateDesignPrice();
        const texturePricePerUnit = this._calculateTexturePrice ? this._calculateTexturePrice() : 0;

        const $inputs = $('.tus-matrix-input');
        $inputs.each(function () {
            const qty = parseInt($(this).val()) || 0;
            const price = parseFloat($(this).data('price')) || 0;
            productTotal += qty * price;
            totalQty += qty;
        });

        const designTotal = totalQty * designPricePerUnit;
        const textureTotal = totalQty * texturePricePerUnit;

        let printingTotal = 0;
        if (this.selectedPrintingMethod) {
            const setupCost = parseFloat(this.selectedPrintingMethod.setup_cost || 0);
            const unitCost = parseFloat(this.selectedPrintingMethod.unit_cost || 0);
            printingTotal = setupCost + (unitCost * totalQty);
        }

        const grandTotal = productTotal + designTotal + textureTotal + printingTotal;

        const $designInput = $('input[name="show_design_price"]');
        const showDesignPrice = $designInput.val() === '1';

        const symbol = this._getCurrencySymbol();
        let breakdownHtml = '';
        if (showDesignPrice || printingTotal > 0) {
            breakdownHtml = `
            <div class="small text-muted">Product Total: ${symbol}${productTotal.toFixed(2)}</div>
            ${showDesignPrice ? `<div class="small text-muted">Design Total: ${symbol}${designTotal.toFixed(2)}</div>` : ''}
            ${printingTotal > 0 ? `<div class="small text-muted">Printing (${this.selectedPrintingMethod.name}): ${symbol}${printingTotal.toFixed(2)}</div>` : ''}
        `;
        }

        const showAddToCart = !this._isShareCollaborator?.();
        const matrixVdpHint = this._isVdpActive?.()
            ? `<div class="small text-info mb-1">${this.vdpRecords.length} personalized row(s)</div>`
            : "";
        const footerHtml = `
        <div class="d-flex flex-column align-items-end me-3">
            ${matrixVdpHint}
            ${breakdownHtml}
            <div class="fw-bold h5 mb-0 mt-1">Total: ${symbol}${grandTotal.toFixed(2)}</div>
        </div>
        <button class="btn btn-link tus-matrix-cancel">Cancel</button>
        ${showAddToCart ? `<button class="btn btn-primary tus-matrix-apply">
            <i class="fa fa-check me-1"></i>
            Add to Cart
        </button>` : ""}
    `;

        // Target both scoped and global just in case
        const $footer = $('#tus-matrix-split-view .tus-matrix-footer-totals');
        if ($footer.length) {
            $footer.html(footerHtml);
        } else {
            $('.tus-matrix-footer-totals').html(footerHtml);
        }

        // Update sidebar summary
        this.$totalQty.text(`Total Quantity (${totalQty})`);
        if (this.$itemsTotalPrice.length) this.$itemsTotalPrice.text(`${symbol}${productTotal.toFixed(2)}`);
        if (this.$designTotalPrice.length) this.$designTotalPrice.text(`${symbol}${designTotal.toFixed(2)}`);
        this.$totalPrice.html(`${symbol}${grandTotal.toFixed(2)}`);
    },

    _onApplyMatrix: async function (ev) {
        if (this._isShareCollaborator?.()) {
            return;
        }
        let $btn = null;
        let originalBtnHtml = '';
        if (ev && ev.currentTarget) {
            $btn = $(ev.currentTarget);
            originalBtnHtml = $btn.html();
            $btn.html('<i class="fa fa-spinner fa-spin me-2"></i> Processing...').prop('disabled', true);
        }

        const useMatrixVdp = this._isVdpActive?.() && this.showMatrixTable;
        if (useMatrixVdp && !this._validateVdpForCheckout()) {
            if ($btn) {
                $btn.html(originalBtnHtml).prop('disabled', false);
            }
            return;
        }

        const items = [];
        const designPrice = this._calculateDesignPrice();
        let totalQty = 0;
        $('.tus-matrix-input').each(function () {
            const qty = parseInt($(this).val()) || 0;
            if (qty > 0) {
                totalQty += qty;
                items.push({
                    product_id: parseInt($(this).data('product-id')),
                    qty: qty,
                    price: parseFloat($(this).data('price')) + designPrice,
                    color_name: $(this).data('color-name'),
                    size_label: $(this).data('size-label')
                });
            }
        });

        if (items.length === 0) {
            if ($btn) {
                $btn.html(originalBtnHtml).prop('disabled', false);
            }
            return alert("Please enter a quantity for at least one item.");
        }

        let vdpAssignment = null;
        if (useMatrixVdp) {
            const matrixResult = await this._prepareVdpMatrixAssignment();
            if (!matrixResult.valid) {
                if ($btn) {
                    $btn.html(originalBtnHtml).prop('disabled', false);
                }
                return;
            }
            vdpAssignment = matrixResult.assignment;
        }

        let vdpCheckoutActive = false;
        if (useMatrixVdp) {
            this._beginVdpCheckoutUi(_t("Preparing your bulk personalized order…"));
            vdpCheckoutActive = true;
        } else {
            this.startLoader("Processing designs for each variant...");
        }

        try {
            const designsByColor = {};
            const formattedItems = [];
            const originalBackgrounds = this._captureMockupBackgrounds?.() || {};
            const vdpUploadContexts = new Map();

            const itemsByColor = {};
            items.forEach(item => {
                const $input = this.$(`.tus-matrix-input[data-product-id="${item.product_id}"]`);
                const cid = $input.closest('.tus-matrix-row').data('color-id');
                item.color_id = cid;
                if (!itemsByColor[cid]) {
                    itemsByColor[cid] = [];
                }
                itemsByColor[cid].push(item);
            });

            for (const colorId in itemsByColor) {
                if (this._swapMockupForColorId) {
                    await this._swapMockupForColorId(colorId);
                }

                const masterDesign = await this._collectDesignData({ includeElementImages: true });
                designsByColor[colorId] = masterDesign;

                const printingUnitCost = this._getPrintingUnitCostForQty(totalQty);

                for (const item of itemsByColor[colorId]) {
                    const basePrice = parseFloat(item.price) || 0;
                    const designPricePerUnit = this._calculateDesignPrice();
                    const texturePricePerUnit = this._calculateTexturePrice ? this._calculateTexturePrice() : 0;
                    const finalPrice = basePrice + designPricePerUnit + texturePricePerUnit + printingUnitCost;
                    const formattedItem = {
                        product_id: item.product_id,
                        base_price: basePrice,
                        design_price: designPricePerUnit,
                        texture_price: texturePricePerUnit,
                        texture_by_side: this._getTexturePayloadForCart?.() || {},
                        qty: item.qty,
                        price: finalPrice,
                        color_id: item.color_id,
                        printing_method_id: this.selectedPrintingMethod ? this.selectedPrintingMethod.id : null,
                    };

                    if (useMatrixVdp) {
                        const rowRecords = vdpAssignment.byProductId[item.product_id] || [];
                        if (!rowRecords.length) {
                            continue;
                        }
                        const $matrixRow = this.$(`.tus-matrix-row[data-product-id="${item.product_id}"]`);
                        formattedItem.vdp = this._buildVdpMetadataForLine(rowRecords, masterDesign, {
                            omitMaster: true,
                        });
                        if (!formattedItem.vdp) {
                            throw new Error(_t("VDP export failed."));
                        }
                        formattedItem.qty = rowRecords.length;
                        vdpUploadContexts.set(this._vdpContextKey(item.product_id, item.color_id), {
                            records: rowRecords,
                            masterDesign,
                            mockupUrls: this._captureMockupBackgrounds(),
                            productId: item.product_id,
                            colorId: item.color_id,
                        });
                    }

                    formattedItems.push(formattedItem);
                }
            }

            this._restoreMockupBackgrounds?.(originalBackgrounds);

            if (useMatrixVdp) {
                this._updateVdpCheckoutUi(_t("Creating your order…"), "");
            }

            const result = await this.rpc("/shop/buy/now", {
                items: formattedItems,
                designs_by_color: useMatrixVdp ? {} : designsByColor,
            });
            if (result?.error) {
                console.error("Buy Now failed:", result.error);
                alert(result.error);
                return;
            }
            if (useMatrixVdp && result?.vdp_upload?.length) {
                this._updateVdpCheckoutUi(
                    _t("Uploading personalized designs…"),
                    _t("%s row(s) to process", result.vdp_upload.reduce((n, j) => n + (j.record_count || 0), 0))
                );
                await this._uploadPendingVdpDesigns(result.vdp_upload, vdpUploadContexts);
            }
            if (result && result.redirect_url) {
                window.location.href = result.redirect_url;
            }
        } catch (e) {
            console.error("Matrix Add to Cart failed", e);
            const serverMsg = e?.data?.message || e?.message || e?.event?.detail;
            alert(serverMsg || _t("Failed to process variant designs. Please try again."));
        } finally {
            this._restoreMockupBackgrounds?.(originalBackgrounds);
            if (vdpCheckoutActive) {
                this._endVdpCheckoutUi();
            } else {
                this.removeLoader();
            }
            if ($btn) {
                $btn.html(originalBtnHtml).prop('disabled', false);
            }
        }
    },

    _buildCanvasValEntry: function (canvas, obj, dim, actual, elemImage) {
        ensureObjectFinishDefaults(obj);
        const imprintCmyk = obj.tusCmyk || resolveCmykForColor(
            obj.fill,
            this._paletteCmykMap || {}
        );
        return Object.assign(
            {
                type: obj.type,
                text: obj.text || null,
                src: this._extractObjectSrc(obj),
                left: obj.left,
                top: obj.top,
                width: dim.w,
                height: dim.h,
                scaleX: obj.scaleX,
                scaleY: obj.scaleY,
                angle: obj.angle,
                fill: obj.fill || null,
                imprint_cmyk: imprintCmyk || null,
                element_image: elemImage,
            },
            serializeFinishFields(obj),
            serializeFinishUploadFields(obj),
            actual?.unit ? { unit: actual.unit } : {},
            obj.tusVdpKey ? { tus_vdp_key: obj.tusVdpKey } : {}
        );
    },

    _collectDesignData: async function (options = {}) {
        const self = this;
        const includeElementImages = options.includeElementImages !== false;
        const designData = [];
        const sides = ["front", "back", "left", "right"];

        const collectSide = async (side) => {
            const sideCanvases = self.canvasesBySide[side] || [];
            if (sideCanvases.length === 0) return;

            let allCanvasVals = [];
            let sideHasObjects = false;
            let masterActual = null;

            for (const view of sideCanvases) {
                const canvasObjects = view.canvas.getObjects().filter(
                    (element) => !element.center_line && !element.tusTextureLayer
                );
                if (!canvasObjects?.length && !self._sideHasTexture?.(side)) continue;

                if (canvasObjects.length) {
                    sideHasObjects = true;
                }
                const areaDef = self._findAreaDef(side, view.id);
                const actual = self._computeAreaActualForSave(
                    areaDef,
                    view.canvas.getWidth(),
                    view.canvas.getHeight()
                );
                if (!masterActual) masterActual = actual;

                for (const obj of canvasObjects) {
                    const dim = self._computeObjectDimensions(view.canvas, obj);
                    let elemImage = null;
                    if (includeElementImages) {
                        elemImage = await self._snapshotElement(view.canvas, obj, 6);
                    }
                    allCanvasVals.push(
                        self._buildCanvasValEntry(view.canvas, obj, dim, actual, elemImage)
                    );
                }
            }

            if (!sideHasObjects && !self._sideHasTexture?.(side)) return;
            if (!masterActual) {
                const firstView = sideCanvases[0];
                if (firstView?.canvas) {
                    const areaDef = self._findAreaDef(side, firstView.id);
                    masterActual = self._computeAreaActualForSave(
                        areaDef,
                        firstView.canvas.getWidth(),
                        firstView.canvas.getHeight()
                    );
                }
            }
            if (!masterActual) return;

            const dataUrl = await self._exportSideDuringBatch(side, {
                format: "png",
                quality: 1,
            });
            let printW = masterActual.width;
            let printH = masterActual.height;
            let printUnit = masterActual.unit;
            if (!self.emptyCanvasMode && allCanvasVals.length === 1) {
                printW = allCanvasVals[0].width;
                printH = allCanvasVals[0].height;
                printUnit = allCanvasVals[0].unit || printUnit;
            }

            const activeAreas = sideCanvases
                .filter((view) => {
                    const objs = view.canvas.getObjects().filter(
                        (obj) => !obj.center_line && !obj.tusTextureLayer
                    );
                    return objs.length > 0;
                })
                .map((view) => ({
                    id: view.id,
                    name: view.name,
                    product_id: view.product_id,
                    price: view.price,
                }));

            designData.push({
                side,
                data: dataUrl,
                canvas_vals: allCanvasVals,
                width: printW,
                height: printH,
                unit: printUnit,
                active_areas: activeAreas,
                finish_settings: self._getFinishSettingsForSide
                    ? self._getFinishSettingsForSide(side)
                    : serializeGlobalFinishSettings(self._3dPreviewSettings),
                empty_canvas: Boolean(self.emptyCanvasMode),
                empty_canvas_margin_mm: self._getEmptyCanvasMarginMm
                    ? self._getEmptyCanvasMarginMm(side)
                    : 0,
                canvas_background: self._getEmptyCanvasBackground
                    ? self._getEmptyCanvasBackground(side)
                    : "#ffffff",
            });
        };

        for (const side of sides) {
            await collectSide(side);
        }
        return designData;
    },
};
