/** @odoo-module */

import publicWidget from "@web/legacy/js/public/public_widget";
import { debounce } from "@web/core/utils/timing";
import { loadJS } from "@web/core/assets";
import { rpc } from "@web/core/network/rpc";
import { _t } from "@web/core/l10n/translation";
import { removeBackgroundFromImage } from "./background_removal";
import {
    applyAreaGeometryStyles,
    buildFabricClipPath,
    ensureBoundarySvg,
    getAreaDisplayLayout,
    normalizeDesignArea,
    normalizeDesignAreas,
    pointInPolygon,
    stagePointsToCanvas,
} from "./design_area_shapes";
import {
    DEFAULT_RELIEF_MM,
    ensureObjectFinishDefaults,
    serializeGlobalFinishSettings,
} from "./3d/finish_effects";
import { registerFabricFinishProperties } from "./fabric/fabric_props";
import { fabricTemplatesMixin } from "./fabric/templates_mixin";
import { fabricTextTemplatesMixin } from "./fabric/text_templates_mixin";
import { fabricClipartMixin } from "./fabric/clipart_mixin";
import { fabricMatrixMixin } from "./fabric/matrix_mixin";
import { fabricShareMixin } from "./fabric/share_mixin";
import { fabricPrintDpiMixin } from "./fabric/print_dpi_mixin";
import { fabricUploadMixin } from "./fabric/upload_mixin";
import { fabricQrMixin } from "./fabric/qr_mixin";
import { fabricVdpMixin } from "./fabric/vdp_mixin";
import { fabricEmptyCanvasMixin } from "./fabric/empty_canvas_mixin";
import { fabricTextureMixin } from "./fabric/texture_mixin";
import { fabricFinishUploadMixin } from "./fabric/finish_upload_mixin";
import { fabricHelpMixin } from "./fabric/help_mixin";
import { registerFabricRefLayout } from "./fabric/ref_layout";
import {
    buildPaletteCmykMap,
    resolveCmykForColor,
    updateCmykReadout,
} from "./fabric/color_cmyk";

publicWidget.registry.Fabric = publicWidget.Widget.extend({
    ...fabricTemplatesMixin,
    ...fabricTextTemplatesMixin,
    ...fabricClipartMixin,
    ...fabricMatrixMixin,
    ...fabricShareMixin,
    ...fabricPrintDpiMixin,
    ...fabricUploadMixin,
    ...fabricQrMixin,
    ...fabricVdpMixin,
    ...fabricEmptyCanvasMixin,
    ...fabricTextureMixin,
    ...fabricFinishUploadMixin,
    ...fabricHelpMixin,
    selector: ".fabric_container",
    events: {
        "click .fab_item": "_onChangeOption",
        "click #tus-help-btn": "_onHelpButtonClick",
        "click .tus-panel-help-btn": "_onPanelHelpButtonClick",
        "click .tus-help-dialog-close": "_onHelpDialogClose",
        "click .tus-help-backdrop": "_onHelpBackdropClick",
        "click .tus-help-copy-link": "_onHelpCopyLink",
        "click .ai-generate-btn": "_onGenerateAiImages",
        "click .ai-generate-more-btn": "_onGenerateAiImages",
        "click .ai-result-item": "_onAddAiImageToCanvas",
        "click .tool ": "_onChangeToolOption",
        "click .close-sub-panel ": "_CloseToolBar",
        "click .new_toolbar_container .close": "_CloseToolBar",
        "change .fab-upload-input": "_onAddImage",
        "click .upload-module-tab": "_onUploadModuleTabClick",
        "click .qr-color-swatch": "_onQrColorSwatchClick",
        "click .add_qr_code": "_onAddQrCode",
        "click .delete-btn": "_onDeleteImage",
        'click .default_images .image-item': '_onAddDefaultImage',
        "click .add_new_text": "_onAddText",
        "keyup .edit_text": "_onEditText",
        "input #colorPicker": "_onColorPick",
        "click .font-item": "_onSelectFontSize",
        "change .font_input": "_onFontChange",
        "click .add_font_size": "_onFontIncrease",
        "click .deduct_font_size": "_onFontDecrease",
        "click .duplicate_element": "_onDuplicateElement",
        "click .font_opt": "_onFontOptionChange",
        "click .font-align": "_onSetFontAlign",
        "input .line-height": "_onChangeLineHeight",
        "input .height-text": "_onTextChangeLineHeight",
        "input .letter-spacing": "_onLetterSpace",
        "input .space-text": "_onTextLetterSpace",
        "input .elem_opacity": "_onChangeOpacity",
        "input .elem_shadow": "_onChangeShadow",
        "input .text_bend_radius": "_onChangeTextBend",
        "input .text_bend_spacing": "_onBendLetterSpacing",
        "input .elem_stroke": "_onChangeStroke",
        "input .opacity-text": "_onTextChangeOpacity",
        "input .elem_rotate": "_onRotateElem",
        "input .rotate-text": "_onTextonRotateElem",
        "click .flipx": "_onFlipElemX",
        "click .area-tab-btn": "_onAreaTabClick",
        "click .flipy": "_onFlipElemY",
        "change .font_family": "_onChangeFontFamily",
        "change .exchange-img": "_onReplaceImg",
        "click .undo_btn": "_onUndo",
        "click .redo_btn": "_onRedo",
        "input .elem_brightness": "_onBrightnessChange",
        "input .elem_contrast": "_onContrastChange",
        "input .elem_saturation": "_onSaturation",
        "input .elem_huerotation": "_onHueRotation",
        "input .elem_border": "_onChangeBorderWidth",
        "input .border-text": "_onTextChangeBorderWidth",
        "change .border-text, .elem_border, .elem_huerotation, .elem_brightness, .elem_contrast, .elem_saturation":
            "saveState",
        "change .rotate-text, .elem_rotate, .opacity-text, .elem_opacity, .space-text, .letter-spacing":
            "saveState",
        "change .height-text, .line-height": "saveState",
        "click .border_type": "_borderType",
        "click .elem_remove": "_onRemoveElement",
        "click .elem_lock": "_onLockElement",
        "click .elem_visibility": "_onVisibilityElement",
        "click .add_shape": "_onAddShape",
        "click .add_clipart_icon": "_onAddClipartIcon",
        "click .load_more_clipart": "_onLoadMoreClipart",
        "click .toggle_clipart_view": "_onToggleClipartView",
        "input #clipart-search-input": "_onSearchClipartInput",
        "click .fab_texture_option": "_onSelectTexture",
        "click .fab_texture_remove_btn": "_onRemoveTexture",
        "click .fab_texture_category_btn": "_onTextureCategory",
        'click .add-to-custom-cart': '_onAddToCart',
        'click .btn-buy': '_onBuyNow',
        'click .close-cart': '_onCloseCart',
        'click .qty-plus': '_onIncreaseQty',
        'click .qty-minus': '_onDecreaseQty',
        "click .download_btn": "_onDownloadCanvas",
        "click .share_btn": "_onShareDesign",
        "click .add_to_save": "_onSaveCanvasOrShare",
        "click .share_save_btn": "_onSaveSharedDesign",
        "click .template_option": "_onSelectTemplate",
        "click .text_template_option": "_onSelectTextTemplate",
        "click .fab_text_template_category_btn": "_onTextTemplateCategoryClick",
        "click .exit_designer": "_onExitDesigner",
        "click .canvas-item": "_onCanvasSwitch",
        "click .fab_swap_container": "_onSwapImageVarinatImage",
        "click .color-chooser-btn": "_onClickPickerOpen",
        "click #save-btn": "_onClickSaveOrderLine",
        "click .exit_designer_backend": "_onExitToSaleOrder",
        "click .options-close-btn": "_onCloseOptions",
        "click .preview_mobile_btn, .preview_btn": "_onClickPreview",
        "click .tus-matrix-cancel": "_onCancelMatrix",
        "click .tus-matrix-color-option": "_onMatrixColorSelect",
        "input .tus-matrix-input": "_onMatrixQtyChange",
        "click .tus-matrix-apply": "_onApplyMatrix",
        "click .color-swap": "_onMatrixColorSwap",
        "click .tus-remove-bg-btn": "_onRemoveImageBackground",
        "click .tus-remove-bg-thumb-btn": "_onRemoveBackgroundFromLibraryThumb",
        "click .tus-vectorize-btn": "_onVectorizeImage",
        "click .tus-vdp-mark-btn": "_onMarkVdpField",
        "click .tus-vdp-unmark-btn": "_onUnmarkVdpField",
        "change .tus-vdp-file-input": "_onVdpFileChange",
        "input .tus-vdp-preview-index": "_onVdpPreviewChange",
    },

    init: function () {
        this._super.apply(this, arguments);
        this.notification = this.bindService("notification");
        this.orm = this.bindService("orm");
        this.http = this.bindService("http");
        this.ui = this.bindService("ui");
        this.undoStack = [];
        this.redoStack = [];
        this._bindKeyboardShortcuts();
        this._currentSearchQuery = "";
        this._onSearchClipartInput = debounce(this._onSearchClipartInput.bind(this), 500);
        this._onColorPick = debounce(this._onColorPick, 500);
        this._onChangeStrokeColor = debounce(this._onChangeStrokeColor, 500);
        this.fabricByAreaId = {};
        this.canvasesBySide = { front: [], back: [], left: [], right: [] };
        this.active_side = 'front';
        this.active_area_id = null;
        this._lastSession = { active_side: null, active_area_id: null };

        // Matrix State
        this.showMatrixTable = $('input[name="show_matrix_table"]').val() === '1';
        this._initVdpState?.();
        this._initEmptyCanvasState?.();
        this._initTextureState?.();
        this._normalizeUploadLibraryLayout?.();
        this._initFinishUploadState?.();
        this.matrixData = [];
        this.selectedMatrixColor = null;
        this.selectedMatrixProducts = []; // Array of product IDs selected in Step 2
        this._clipboard = null;
        this._installShareReadOnlyRpcGuard();
    },

    start: async function () {
        registerFabricFinishProperties();
        this._super(...arguments);
        var self = this;
        this.$sidebar = $('#custom-cart-sidebar');
        this.$items = this.$sidebar.find('.cart-items');
        this.$totalQty = this.$sidebar.find('.total-qty');
        this.$totalPrice = this.$sidebar.find('.total-price');
        this.$itemsTotalPrice = this.$sidebar.find('.items-total-price');
        this.$designTotalPrice = this.$sidebar.find('.design-total-price');
        self._initializeColorPickers();
        this._paletteCmykMap = buildPaletteCmykMap(this.el);
        this._cmykReadoutEl = this.el.querySelector("#tusCmykReadout");
        this._initShareSaveState?.();
        // load custom libs
        await loadJS(
            "https://cdnjs.cloudflare.com/ajax/libs/webfont/1.6.28/webfontloader.js"
        );
        await loadJS(
            "https://cdnjs.cloudflare.com/ajax/libs/chroma-js/2.1.0/chroma.min.js"
        );
        // load font families
        await WebFont.load({
            google: {
                families: ['Roboto', 'Poppins', 'Open Sans', 'Lato', 'Montserrat', 'Nunito', 'Source Sans Pro',
                    'Inter', 'Raleway', 'Ubuntu', 'Playfair Display', 'Merriweather', 'Lora', 'PT Serif', 'Crimson Text',
                    'Libre Baskerville', 'Noto Serif', 'Lobster', 'Pacifico', 'Courgette', 'Dancing Script', 'Great Vibes',
                    'Amatic SC', 'Bangers', 'Righteous', 'Fredoka One', 'Creepster', 'Chewy', 'Roboto Mono', 'Inconsolata',
                    'Source Code Pro', 'Kaushan Script', 'Caveat', 'Satisfy', 'Shadows Into Light', 'Permanent Marker',
                    'Oswald', 'Anton', 'Bebas Neue', 'Titan One', 'Alfa Slab One', 'Fugaz One', 'Cinzel', 'Cormorant Garamond',
                    'Abril Fatface', 'Josefin Sans'
                ]
            },
        })
        const alignContent = `<div class="d-flex align-items-center justify-content-center gap-3 font-popover">
            <i class="d-flex align-items-center justify-content-center font-align-opt fa fa-align-left" data-option="left"></i>
            <i class="d-flex align-items-center justify-content-center font-align-opt fa fa-align-center" data-option="center"></i>
            <i class="d-flex align-items-center justify-content-center font-align-opt fa fa-align-right" data-option="right"></i>
        </div>`;
        // Standard Calculation - Reference as per Seesun project
        const REF = { px: 112, inch: 0.75 }; // 112 px == 0.75 inch
        const pxPerInch = REF.px / REF.inch;            // ≈ 149.3333333
        this.CAL = {
            pxPerInch,
            pxPerMillimeter: pxPerInch / 25.4,         // derive from inch
            pxPerCentimeter: pxPerInch / 2.54,         // derive from inch
        };
        this.fontPopover = $(".font-align").popover({
            content: alignContent,
            placement: "bottom",
            container: $(".new_toolbar_container"),
            html: true,
            trigger: "focus",
            animation: true,
        });
        $(".new_toolbar_container").on("click", ".font-align-opt", (ev) => {
            self._changeFontAlignment($(ev.currentTarget).data("option"));
        });

        this._bindFontList();

        this.showPrintingMethods = $('input[name="show_printing_methods"]').val() === '1';
        if ($('input[name="product_tmpl_id"]').val()) {
            const shareToken = $('input[name="share_token"]').val();
            if (!shareToken) {
                const showMatrix = $('input[name="show_matrix_table"]').val() === '1';
                const colorId = showMatrix
                    ? (parseInt($('input[name="current_color_id"]').val(), 10) || null)
                    : null;
                const productId = showMatrix && colorId
                    ? null
                    : (parseInt($('input[name="product_id"]').val(), 10) || null);
                this.viewsData = await this.rpc("/get_product_views", {
                    product_tmpl_id: parseInt($('input[name="product_tmpl_id"]').val(), 10),
                    product_id: productId,
                    color_id: colorId,
                    ...this._getEmptyCanvasRpcParams?.(),
                });
            } else {
                this.viewsData = [];
            }
            if (this.showPrintingMethods) {
                await this._loadPrintingMethods(parseInt($('input[name="product_tmpl_id"]').val()));
            }
        }

        // Store per-side stage dimensions
        this.DEFAULT_STAGE = { w: 394, h: 394 };
        this.stageBySide = { front: null, back: null, left: null, right: null };

        await this._loadViews(this.viewsData);

        if (this.emptyCanvasMode) {
            this._setupEmptyCanvasChrome?.();
            const firstEntry = (this.canvasesBySide[this.active_side] || [])[0];
            if (firstEntry?.canvas) {
                this.canvas = firstEntry.canvas;
                this.active_area_id = firstEntry.id;
            }
        } else if ($('input[name="empty_canvas_error"]').val()) {
            this.notification.add(
                _t("Please choose a canvas size on the product page before customizing."),
                { type: "danger" }
            );
        }

        if (!this._shareDesignRestored) {
            this.active_side = this.viewsData?.[0]?.title || 'front';
            const firstEntry = (this.canvasesBySide[this.active_side] || [])[0];
            if (firstEntry && firstEntry.canvas) {
                this.canvas = firstEntry.canvas;
                this.active_area_id = firstEntry.id;
            }
            this._renderAreaSelectorForSide(this.active_side, this.active_area_id);
        }

        // Setup global drag detection for all design areas
        this._setupGlobalDragDetection();
        this._initFabricSelectionControls();

        this._onWindowResize = debounce(() => {
            this.restructureCanvas({ preserveSelection: true });
        }, 150);
        window.addEventListener("resize", this._onWindowResize);
        if (this._shareDesignRestored) {
            requestAnimationFrame(() => {
                this._initCanvasLayoutObservers();
            });
        } else {
            this._initCanvasLayoutObservers();
        }
        this._layoutColorPickers();
        this._activeSidebarOption = null;

        this._bindGuestAccessRefresh();
        if (this.showVdp) {
            this._refreshVdpFieldList();
        }
        if (typeof this._syncPanelHelpButton === "function") {
            this._syncPanelHelpButton();
        }
        this.removeLoader();
    },

    _getFabricImageSource: function (fabricImage) {
        if (!fabricImage) {
            return null;
        }
        if (typeof fabricImage.getSrc === "function") {
            const src = fabricImage.getSrc();
            if (src) {
                return src;
            }
        }
        if (fabricImage._originalElement && fabricImage._originalElement.src) {
            return fabricImage._originalElement.src;
        }
        if (fabricImage._element && fabricImage._element.src) {
            return fabricImage._element.src;
        }
        try {
            return fabricImage.toDataURL({ format: "png" });
        } catch (_e) {
            return null;
        }
    },

    _replaceFabricImageWithDataUrl: function (fabricImage, dataUrl) {
        const canvas = fabricImage.canvas || this.canvas;
        if (!canvas) {
            return Promise.resolve(null);
        }
        const props = {
            left: fabricImage.left,
            top: fabricImage.top,
            scaleX: fabricImage.scaleX,
            scaleY: fabricImage.scaleY,
            angle: fabricImage.angle,
            flipX: fabricImage.flipX,
            flipY: fabricImage.flipY,
            opacity: fabricImage.opacity,
            originX: fabricImage.originX,
            originY: fabricImage.originY,
            id: fabricImage.id,
            backend_id: fabricImage.backend_id,
            locked: fabricImage.locked,
            filters: fabricImage.filters ? [...fabricImage.filters] : [],
        };
        const index = canvas.getObjects().indexOf(fabricImage);
        return new Promise((resolve, reject) => {
            fabric.Image.fromURL(
                dataUrl,
                (newImg) => {
                    if (!newImg) {
                        reject(new Error("Failed to load processed image."));
                        return;
                    }
                    newImg.set(props);
                    if (newImg.filters && newImg.filters.length) {
                        newImg.applyFilters();
                    }
                    canvas.remove(fabricImage);
                    if (index >= 0) {
                        canvas.insertAt(newImg, index);
                    } else {
                        canvas.add(newImg);
                    }
                    canvas.setActiveObject(newImg);
                    this.currentElement = newImg;
                    canvas.requestRenderAll();
                    this.saveState();
                    resolve(newImg);
                },
                { crossOrigin: "anonymous" }
            );
        });
    },

    _runBackgroundRemoval: async function (imageSource, { loaderMessage } = {}) {
        if (!imageSource) {
            throw new Error(_t("No image source available."));
        }
        this.startLoader(loaderMessage || _t("Removing background…"), { scope: "canvas" });
        try {
            return await removeBackgroundFromImage(imageSource, this.rpc.bind(this));
        } finally {
            this.removeLoader();
        }
    },

    _onRemoveImageBackground: async function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        const obj = this.currentElement;
        if (!obj) {
            this.notification.add(_t("Select an image on the canvas first."), { type: "warning" });
            return;
        }

        let src = null;
        const backendId = obj.backend_id;
        const canvas = obj.canvas || this.canvas;

        if (obj.type === "image") {
            src = this._getFabricImageSource(obj);
        } else if (obj.type === "group" && obj.isEmbeddedPhotoSvg) {
            src = this._getEmbeddedPhotoRasterSource(obj);
        } else {
            this.notification.add(_t("Select an image on the canvas first."), { type: "warning" });
            return;
        }

        if (!src) {
            this.notification.add(_t("Could not read the selected image."), { type: "danger" });
            return;
        }

        try {
            const dataUrl = await this._runBackgroundRemoval(src, {
                loaderMessage: _t("Removing background…"),
            });
            const base64 = dataUrl.split(",")[1];

            if (backendId) {
                const result = await this.rpc("/canvas/update_image", {
                    image_id: backendId,
                    filedata: base64,
                    filename: "transparent.svg",
                });
                if (result.error) {
                    throw new Error(result.error);
                }
                await this._replaceCanvasObjectWithSvgGroup(canvas, obj, result.svg, {
                    backendId: backendId,
                    isEmbeddedPhotoSvg: this._isEmbeddedPhotoSvgFromUpload(
                        result,
                        result.svg
                    ),
                });
                if (result.image_datas) {
                    const $thumb = $(`.image-item[data-id="${backendId}"] img`);
                    if ($thumb.length) {
                        $thumb.attr("src", result.image_datas);
                    }
                }
            } else if (obj.type === "image") {
                await this._replaceFabricImageWithDataUrl(obj, dataUrl);
            } else {
                const result = await this.rpc("/canvas/upload_image", {
                    filename: "transparent.png",
                    filedata: base64,
                    vectorize: false,
                    auto_detect: false,
                });
                if (result.error) {
                    throw new Error(result.error);
                }
                await this._replaceCanvasObjectWithSvgGroup(canvas, obj, result.svg, {
                    backendId: result.id,
                    isEmbeddedPhotoSvg: this._isEmbeddedPhotoSvgFromUpload(
                        result,
                        result.svg
                    ),
                });
            }
            this.notification.add(_t("Background removed."), { type: "success" });
        } catch (error) {
            console.error("Background removal failed:", error);
            const detail = error && error.message ? error.message : "";
            this.notification.add(
                detail || _t("Could not remove background. Please try again."),
                { type: "danger" }
            );
        }
    },

    _onRemoveBackgroundFromLibraryThumb: async function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        const $item = $(ev.currentTarget).closest(".image-item");
        const $img = $item.find("img.default-canvas-img");
        const imageId = $item.data("id");
        // Always use the full library file for rembg — thumbs are resized for layout only.
        const src = imageId
            ? `/web/image/canvas.image/${imageId}/file`
            : $img.attr("src");
        if (!src) {
            return;
        }
        const $btn = $(ev.currentTarget);
        $btn.prop("disabled", true);
        try {
            const dataUrl = await this._runBackgroundRemoval(src, {
                loaderMessage: _t("Removing background…"),
            });
            const base64 = dataUrl.split(",")[1];
            if (imageId) {
                const result = await this.rpc("/canvas/update_image", {
                    image_id: imageId,
                    filedata: base64,
                    filename: "transparent.svg",
                });
                if (result.error) {
                    throw new Error(result.error);
                }
                if (result.image_datas) {
                    $img.attr(
                        "src",
                        imageId
                            ? `/web/image/canvas.image/${imageId}/file/256x256?unique=${Date.now()}`
                            : result.image_datas
                    );
                }
            } else {
                $img.attr("src", dataUrl);
            }
            this.notification.add(_t("Background removed from image."), { type: "success" });
        } catch (error) {
            console.error("Background removal failed:", error);
            const detail = error && error.message ? error.message : "";
            this.notification.add(
                detail || _t("Could not remove background. Please try again."),
                { type: "danger" }
            );
        } finally {
            $btn.prop("disabled", false);
        }
    },

    _onGenerateAiImages: async function (ev) {
        ev.preventDefault();
        const self = this;
        const $section = $(ev.currentTarget).closest(".section_ai");
        const prompt = ($section.find(".ai-prompt-input").val() || "").trim();
        if (!prompt) {
            this.notification.add(_t("Please describe the image you want to generate."), {
                type: "warning",
            });
            return;
        }

        const append = $(ev.currentTarget).hasClass("ai-generate-more-btn");
        const count =
            (this.personalizerConfig && this.personalizerConfig.ai_image_count) || 4;

        self.startLoader(_t("Generating images…"), { scope: "canvas" });
        try {
            const result = await this.rpc("/canvas/ai_generate", { prompt, count });
            if (result.error) {
                throw new Error(result.error);
            }
            const images = result.images || [];
            if (!images.length) {
                throw new Error(_t("No images were returned."));
            }

            const $grid = $section.find(".ai-results-grid");
            if (!append) {
                $grid.empty();
            }
            images.forEach((dataUrl) => {
                const $item = $(`
                    <div class="ai-result-item image-item" role="button" tabindex="0" title="${_t("Add to design")}">
                        <img src="" class="img img-fluid rounded" alt="${_t("AI generated")}"/>
                    </div>
                `);
                $item.find("img").attr("src", dataUrl);
                $grid.append($item);
            });
            $grid.removeClass("d-none");
            $section.find(".ai-generate-more-btn").removeClass("d-none");
        } catch (error) {
            console.error("AI image generation failed:", error);
            const msg =
                (error && error.message) ||
                (typeof error === "string" ? error : _t("Image generation failed. Please try again."));
            this.notification.add(msg, { type: "danger" });
        } finally {
            self.removeLoader();
        }
    },

    _onAddAiImageToCanvas: async function (ev) {
        ev.preventDefault();
        const self = this;
        const $item = $(ev.currentTarget).closest(".ai-result-item");
        const src = $item.find("img").attr("src");
        if (!src || !src.startsWith("data:")) {
            this.notification.add(_t("Invalid generated image."), { type: "danger" });
            return;
        }

        const base64 = src.split(",")[1];
        if (!base64) {
            this.notification.add(_t("Invalid generated image."), { type: "danger" });
            return;
        }

        self.startLoader(_t("Adding image…"), { light: true });
        try {
            const result = await this.rpc("/canvas/upload_image", {
                filename: "ai-generated.png",
                filedata: base64,
                vectorize: false,
                auto_detect: false,
            });
            if (result.error) {
                throw new Error(result.error);
            }
            await self._loadSvgGroupOnCanvas(result.svg, {
                backendId: result.id,
                filename: result.name,
                targetCanvas: self.canvas,
                isEmbeddedPhotoSvg: self._isEmbeddedPhotoSvgFromUpload(result, result.svg),
            });
            self._appendUploadLibraryItem(result);
            self._activeSidebarOption = "image";
            self._highlightSidebarOption("image", { showPanel: false });
        } catch (error) {
            console.error("Add AI image failed:", error);
            const msg =
                (error && error.message) ||
                _t("Could not add the image to the canvas.");
            this.notification.add(msg, { type: "danger" });
        } finally {
            self.removeLoader();
        }
    },

    /**
     * Premium resize/rotate handles aligned with TUS brand (indigo ring, white grips).
     */
    _initFabricSelectionControls: function () {
        const BRAND = "#4f46e5";
        const BRAND_LIGHT = "#818cf8";
        const HANDLE_FILL = "#ffffff";
        const EDGE_KEYS = new Set(["ml", "mr", "mt", "mb"]);

        fabric.Object.prototype.set({
            transparentCorners: false,
            cornerStyle: "circle",
            cornerColor: HANDLE_FILL,
            cornerStrokeColor: BRAND,
            cornerSize: 12,
            borderColor: BRAND,
            borderScaleFactor: 1.25,
            borderDashArray: null,
            padding: 0,
            rotatingPointOffset: 36,
        });

        const renderResizeHandle = function (ctx, left, top, styleOverride, fabricObject) {
            const key = this.corner || this.key;
            const isEdge = EDGE_KEYS.has(key);
            const size = isEdge ? 9 : 11;
            const r = size / 2;

            ctx.save();
            ctx.translate(left, top);
            ctx.beginPath();
            ctx.arc(0, 0, r + 1.5, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(79, 70, 229, 0.12)";
            ctx.fill();
            ctx.beginPath();
            ctx.arc(0, 0, r, 0, Math.PI * 2);
            ctx.fillStyle = HANDLE_FILL;
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = BRAND;
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(0, 0, r - 3, 0, Math.PI * 2);
            ctx.fillStyle = BRAND_LIGHT;
            ctx.globalAlpha = 0.35;
            ctx.fill();
            ctx.restore();
        };

        Object.keys(fabric.Object.prototype.controls).forEach((key) => {
            if (key === "mtr") {
                return;
            }
            const ctrl = fabric.Object.prototype.controls[key];
            if (!ctrl) {
                return;
            }
            ctrl.render = renderResizeHandle;
            ctrl.corner = key;
            const hit = EDGE_KEYS.has(key) ? 12 : 14;
            ctrl.sizeX = hit;
            ctrl.sizeY = hit;
        });

        const drawRotateGlyph = (ctx, cx, cy) => {
            const iconR = 5.5;
            const arcStart = -Math.PI * 0.78;
            const arcEnd = Math.PI * 0.95;
            const headLen = 3.4;

            ctx.save();
            ctx.translate(cx, cy);
            ctx.strokeStyle = BRAND;
            ctx.fillStyle = BRAND;
            ctx.lineWidth = 1.75;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";

            ctx.beginPath();
            ctx.arc(0, 0, iconR, arcStart, arcEnd);
            ctx.stroke();

            const ex = iconR * Math.cos(arcEnd);
            const ey = iconR * Math.sin(arcEnd);
            const tangent = arcEnd + Math.PI / 2;
            ctx.beginPath();
            ctx.moveTo(ex, ey);
            ctx.lineTo(
                ex - headLen * Math.cos(tangent - 0.45),
                ey - headLen * Math.sin(tangent - 0.45)
            );
            ctx.lineTo(
                ex - headLen * Math.cos(tangent + 0.45),
                ey - headLen * Math.sin(tangent + 0.45)
            );
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        };

        fabric.Object.prototype.controls.mtr = new fabric.Control({
            x: 0,
            y: -0.5,
            offsetY: -36,
            cursorStyle: "grab",
            actionHandler: fabric.controlsUtils.rotationWithSnapping,
            render: function (ctx, left, top, _styleOverride, fabricObject) {
                const btnR = 12;
                const mt = fabricObject.oCoords?.mt;
                if (!mt) {
                    return;
                }

                ctx.save();
                ctx.beginPath();
                ctx.moveTo(mt.x, mt.y);
                ctx.lineTo(left, top);
                ctx.strokeStyle = BRAND;
                ctx.lineWidth = 1.5;
                ctx.setLineDash([]);
                ctx.stroke();

                ctx.beginPath();
                ctx.arc(left, top, btnR + 2, 0, Math.PI * 2);
                ctx.fillStyle = "rgba(79, 70, 229, 0.14)";
                ctx.fill();

                ctx.beginPath();
                ctx.arc(left, top, btnR, 0, Math.PI * 2);
                ctx.fillStyle = HANDLE_FILL;
                ctx.fill();
                ctx.lineWidth = 2;
                ctx.strokeStyle = BRAND;
                ctx.stroke();

                drawRotateGlyph(ctx, left, top);
                ctx.restore();
            },
            sizeX: 26,
            sizeY: 26,
        });
    },

    _initializeColorPickers: function () {
        this._initializeTextColorPicker();
        this._initializeStrokeColorPicker();
        this._initializeShadowColorPicker();
    },

    _setObjectPrintColor: function (obj, hexColor) {
        if (!obj) {
            return "";
        }
        const cmyk = resolveCmykForColor(hexColor, this._paletteCmykMap || {});
        obj.set("tusCmyk", cmyk);
        return cmyk;
    },

    _updateFillCmykReadout: function (hexColor) {
        return updateCmykReadout(hexColor, this._cmykReadoutEl, this._paletteCmykMap || {});
    },

    _initializeTextColorPicker: function () {
        const self = this;

        const picker = this.el.querySelector("#colorPicker");
        const input = this.el.querySelector("#colorInput");
        const swatches = this.el.querySelectorAll(".color-swatch");

        // Sync: when color changes in picker, update input value
        picker.addEventListener("color-changed", (event) => {
            const color = event.detail.value;
            input.value = color;
            if (self.currentElement) {
                self._applyFillDeep(self.currentElement, color);
                self._setObjectPrintColor(self.currentElement, color);
                self._updateFillCmykReadout(color);
                $(".color-tool .color-icon").css("background-color", color);
                self.currentElement.canvas.renderAll();
                self.saveState();
            }
        });

        // Sync: when typing manually in input, update picker
        input.addEventListener("change", (event) => {
            const val = event.target.value;
            if (/^#([0-9A-F]{3}){1,2}$/i.test(val)) { // simple hex check
                picker.color = val;

                if (self.currentElement) {
                    self._applyFillDeep(self.currentElement, val);
                    self._setObjectPrintColor(self.currentElement, val);
                    self._updateFillCmykReadout(val);
                    $(".color-tool .color-icon").css("background-color", val);
                    self.currentElement.canvas.renderAll();
                    self.saveState();
                }
            }
        });

        // NEW: when clicking a fixed color swatch
        swatches.forEach((swatch) => {
            swatch.addEventListener("click", () => {
                const color = swatch.dataset.color;
                input.value = color;
                picker.color = color;

                if (self.currentElement) {
                    self._applyFillDeep(self.currentElement, color);
                    self._setObjectPrintColor(self.currentElement, color);
                    self._updateFillCmykReadout(color);
                    $(".color-tool .color-icon").css("background-color", color);
                    self.currentElement.canvas.renderAll();
                    self.saveState();
                }
            });
        });
    },

    _initializeStrokeColorPicker: function () {
        const strokeColorPicker = document.getElementById('strokeColorPicker');
        const strokeColorInput = document.getElementById('strokeColorInput');
        const strokeColorSwatches = document.querySelectorAll('.stroke-color-swatch');
        const strokeColorButton = document.querySelector('.stroke-color-chooser-btn');

        if (strokeColorPicker && strokeColorInput) {
            // Stroke color picker change event
            strokeColorPicker.addEventListener('color-changed', (ev) => {
                const color = ev.detail.value;
                strokeColorInput.value = color;
                this._onChangeStrokeColor(color);
            });

            // Stroke color input change event
            strokeColorInput.addEventListener('input', (ev) => {
                const color = ev.target.value;
                if (this._isValidHexColor(color)) {
                    strokeColorPicker.color = color;
                    this._onChangeStrokeColor(color);
                }
            });

            // Stroke color swatch click events
            strokeColorSwatches.forEach(swatch => {
                swatch.addEventListener('click', (ev) => {
                    const color = ev.target.getAttribute('data-color');
                    strokeColorPicker.color = color;
                    strokeColorInput.value = color;
                    this._onChangeStrokeColor(color);
                });
            });

            if (strokeColorButton) {
                strokeColorButton.addEventListener('click', () => {
                    var self = this
                    if (window.EyeDropper !== undefined) {
                        const eyeDropper = new EyeDropper();
                        eyeDropper.open().then((result) => {
                            strokeColorPicker.color = result.sRGBHex;
                            strokeColorInput.value = result.sRGBHex;
                            self._onChangeStrokeColor(result.sRGBHex);
                        })
                            .catch(() => {
                                // User cancelled EyeDropper.
                            });
                    }
                });
            }
        }
    },

    _initializeShadowColorPicker: function () {
        const shadowColorPicker = document.getElementById('shadowColorPicker');
        const shadowColorInput = document.getElementById('shadowColorInput');
        const shadowColorSwatches = document.querySelectorAll('.shadow-color-swatch');
        const shadowColorButton = document.querySelector('.shadow-color-chooser-btn');

        if (shadowColorPicker && shadowColorInput) {
            // Shadow color picker change event
            shadowColorPicker.addEventListener('color-changed', (ev) => {
                const color = ev.detail.value;
                shadowColorInput.value = color;
                // Trigger existing shadow change method (assuming you have _onChangeShadow)
                this._onChangeShadow({ currentTarget: shadowColorInput });
            });

            // Shadow color input change event
            shadowColorInput.addEventListener('input', (ev) => {
                const color = ev.target.value;
                if (this._isValidHexColor(color)) {
                    shadowColorPicker.color = color;
                    // Trigger existing shadow change method
                    this._onChangeShadow(ev);
                }
            });

            // Shadow color swatch click events
            shadowColorSwatches.forEach(swatch => {
                swatch.addEventListener('click', (ev) => {
                    const color = ev.target.getAttribute('data-color');
                    shadowColorPicker.color = color;
                    shadowColorInput.value = color;

                    // Create a synthetic event to trigger _onChangeShadow
                    const syntheticEvent = {
                        currentTarget: shadowColorInput
                    };
                    this._onChangeShadow(syntheticEvent);
                });
            });

            // Shadow color button click (optional functionality)
            if (shadowColorButton) {
                shadowColorButton.addEventListener('click', () => {
                    var self = this
                    if (window.EyeDropper !== undefined) {
                        const eyeDropper = new EyeDropper();
                        eyeDropper.open().then((result) => {
                            shadowColorPicker.color = result.sRGBHex;
                            shadowColorInput.value = result.sRGBHex;
                            const syntheticEvent = {
                                currentTarget: shadowColorInput
                            };
                            self._onChangeShadow(syntheticEvent);
                        })
                            .catch(() => {
                                // User cancelled EyeDropper.
                            });
                    }
                });
            }
        }
    },

    _selectFirstVariantOnLoad: function () {
        var self = this;
        var $firstVariant = $('.variant-swap').first();

        if ($firstVariant.length) {
            // Create a mock event object to trigger existing function
            var mockEvent = {
                preventDefault: function () { },
                target: $firstVariant[0]
            };

            // Call your existing function
            this._onSwapImageVarinatImage(mockEvent);

            // Add visual indication that this variant is selected
            $('.variant-swap').removeClass('selected-variant');
            $firstVariant.addClass('selected-variant');
        }
    },

    _syncVariantSelectionUi: function (productId) {
        if (!productId) {
            return;
        }
        $('input[name="product_id"]').val(productId);
        $('.variant-swap').removeClass('selected-variant');
        $(`.variant-swap[data-variant_id="${productId}"]`).addClass('selected-variant');
    },

    _onSwapImageVarinatImage: async function (ev) {
        ev.preventDefault();
        var $target = $(ev.target).closest('.variant-swap');
        var variantId = $target.data('variant_id');
        if (!variantId) return;

        // Use the shared variant switching logic
        await this._switchToVariant(variantId, { updateUI: true });
    },

    _isValidHexColor: function (color) {
        return /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(color);
    },

    createCanvas: function (view) {
        const side = view.title;
        this._ensureEditorSidePane(side, this.emptyCanvasMode ? null : view.thumbnail);
        const element = document.getElementById(side + '_canvas');
        if (!element) return;
        const stage = this.stageBySide[side] || this.DEFAULT_STAGE;
        const areas = normalizeDesignAreas(view.design_areas_json);
        areas.forEach((area) => {
            this.AddCanvas(element, area, side, stage);
        });
    },

    _ensureEditorSidePane: function (side, thumbnail) {
        let pane = document.getElementById(`${side}_canvas`);
        const tabContent = document.querySelector(".tab-content");
        if (!pane && tabContent) {
            const templatePane = document.querySelector(".editor_side.tab-pane");
            if (templatePane) {
                pane = templatePane.cloneNode(true);
                pane.id = `${side}_canvas`;
                pane.classList.remove("show", "active");
                tabContent.appendChild(pane);
            }
        }
        if (pane && thumbnail) {
            const img = pane.querySelector("img.main_canvas_img");
            if (img) {
                img.src = thumbnail;
            }
        }
        const $tabs = $(".canvas-tabs");
        if ($tabs.length && !document.getElementById(`${side}-tab`)) {
            const $templateTab = $tabs.find("[data-side]").first();
            if ($templateTab.length) {
                const $newTab = $templateTab.closest("li").clone();
                const $btn = $newTab.find("button");
                $btn.attr("id", `${side}-tab`);
                $btn.attr("data-side", side);
                $btn.attr("data-bs-target", `#${side}_canvas`);
                $btn.attr("aria-controls", `${side}_canvas`);
                $btn.removeClass("active");
                if (thumbnail) {
                    $btn.find("img.canvas-thumb").attr("src", thumbnail);
                }
                $tabs.append($newTab);
            }
        }
        return pane;
    },

    _resolveCanvasEntryForAreaSave: function (list, areaSave, sideAreasDef, areaIdx) {
        if (!list.length) {
            return null;
        }
        let entry = list.find((e) => String(e.id) === String(areaSave.area_id));
        if (!entry && areaSave.area_index != null && list[areaSave.area_index]) {
            entry = list[areaSave.area_index];
        }
        if (!entry) {
            const defIdx = sideAreasDef.findIndex(
                (area) => String(area.id) === String(areaSave.area_id)
            );
            if (defIdx >= 0 && list[defIdx]) {
                entry = list[defIdx];
            }
        }
        if (!entry && areaIdx >= 0 && list[areaIdx]) {
            entry = list[areaIdx];
        }
        if (!entry && list.length === 1 && (sideAreasDef.length <= 1)) {
            entry = list[0];
        }
        return entry || null;
    },

    _setVisibleCanvasSide: function (side) {
        if (!side) {
            return;
        }
        $(".editor_side.tab-pane").removeClass("active show");
        $(".canvas-item").removeClass("active");
        const pane = document.getElementById(`${side}_canvas`);
        if (pane) {
            pane.classList.add("active", "show");
        }
        $(`#${side}-tab`).addClass("active");
        $(".image_preview_box").removeClass("active");
        $(pane).find(".image_preview_box").addClass("active");
    },

    _onCanvasSwitch: async function (ev) {
        let side = $(ev.currentTarget).data("side");
        $(ev.currentTarget).parents('.canvas_switcher').find('button').first().text(side);
        this._setVisibleCanvasSide(side);

        // Switch active side and active Fabric canvas
        this.active_side = side;
        const list = this.canvasesBySide[side] || [];
        if (list.length && list[0].canvas) {
            // pick previously chosen area for this side if possible; else fall back to first
            const desiredId = this._getRememberedAreaForSide(side) || list[0].id;
            await this.canvas.discardActiveObject();
            this._setActiveArea(side, desiredId);
        }
        // remember
        this._lastSession = { active_side: this.active_side, active_area_id: this.active_area_id };

        // refresh area selector for the chosen side
        this._renderAreaSelectorForSide(side, this.active_area_id);
        this._syncEmptyCanvasChromeUi?.();
        this._syncTexturePanelUi?.(side);

        clearTimeout(this._resizeTimeout);
        this._resizeTimeout = setTimeout(() => {
            this.restructureCanvas({
                preserveSelection: true,
                onlySide: side,
            });
            if (this._tusEditorMode === "3d-preview") {
                this._refresh3DPreview();
            }
        }, 0);
    },

    _applyDesignAreaGeometry: function (fabricCanvas, wrapper, area, layout) {
        applyAreaGeometryStyles(wrapper, area, layout, area.color);
        ensureBoundarySvg(wrapper, area, layout, area.color);
        const clip = buildFabricClipPath(area, layout);
        if (clip) {
            fabricCanvas.clipPath = clip;
        } else {
            fabricCanvas.clipPath = null;
        }
        fabricCanvas._tusClipPoints =
            layout.mode === "polygon"
                ? stagePointsToCanvas(area.points, layout.widthRatio, layout.heightRatio)
                : null;
        fabricCanvas._tusAreaShape = layout.mode;
        fabricCanvas._tusLayout = layout;
    },

    AddCanvas: function (element, area, side, stage) {
        if (this.emptyCanvasMode) {
            return this._addEmptyCanvasArea(element, area, side, stage);
        }
        area = normalizeDesignArea(area);
        let image_el = element.querySelector("img");
        if (!image_el) return;
        const ensureLayout = (img) => {
            const imgRect = img.getBoundingClientRect();
            const container = element.querySelector("div.canvas_container");
            if (!container) return;
            const containerRect = container.getBoundingClientRect();

            const baseW = (stage && stage.w) || this.DEFAULT_STAGE.w;
            const baseH = (stage && stage.h) || this.DEFAULT_STAGE.h;
            const width_ratio = imgRect.width / (baseW || 1);
            const height_ratio = imgRect.height / (baseH || 1);

            // Offset between image and container (handles flex centering, padding, etc.)
            const offsetX = imgRect.left - containerRect.left;
            const offsetY = imgRect.top - containerRect.top;

            const layout = getAreaDisplayLayout(
                area,
                { w: baseW, h: baseH },
                imgRect,
                offsetX,
                offsetY
            );

            const wrapper = document.createElement('div');
            wrapper.classList.add('design-area');
            wrapper.dataset.areaId = area.id;
            wrapper.dataset.side = side;
            wrapper.dataset.areaShape = layout.mode;
            wrapper.style.position = 'absolute';
            wrapper.style.left = `${layout.left}px`;
            wrapper.style.top = `${layout.top}px`;
            wrapper.style.width = `${layout.width}px`;
            wrapper.style.height = `${layout.height}px`;
            wrapper.style.boxSizing = 'border-box';

            const canvas = document.createElement('canvas');
            canvas.classList.add("design-area-canvas");
            const canvasW = layout.canvasW;
            const canvasH = layout.canvasH;
            canvas.width = canvasW;
            canvas.height = canvasH;
            canvas.style.position = 'absolute';
            canvas.style.left = '0px';
            canvas.style.top = '0px';
            canvas.style.width = '100%';
            canvas.style.height = '100%';

            wrapper.appendChild(canvas);
            container.appendChild(wrapper);

            const fabricCanvas = new fabric.Canvas(canvas, {
                preserveObjectStacking: true,
                selection: true,
            });

            this._applyDesignAreaGeometry(fabricCanvas, wrapper, area, layout);

            // Keep references for overlay usage
            fabricCanvas._wrapperEl = wrapper;
            // Cache stable size hints for correct dimension math even when side is hidden
            fabricCanvas._baseW = canvas.width;
            fabricCanvas._baseH = canvas.height;
            fabricCanvas._lastW = canvas.width;
            fabricCanvas._lastH = canvas.height;
            this.fabricByAreaId[area.id] = fabricCanvas;
            this.canvasesBySide[side] = this.canvasesBySide[side] || [];
            this.canvasesBySide[side].push({
                id: area.id,
                name: area.name,
                canvas: fabricCanvas,
                dom: canvas,
                wrapper: wrapper,
                layout,
                shape: layout.mode,
                product_id: area?.meta?.product_id || null,
                price: parseFloat(area?.meta?.price || 0),
            });

            // Events
            if (!this.canvas) {
                this.canvas = fabricCanvas;
            }
            this.add_canvas_events(fabricCanvas);

            if (fabricCanvas.wrapperEl) {
                fabricCanvas.wrapperEl.style.overflow = "hidden";
            }

            // Prepare DOM overlay (hidden by default)
            this._ensureDimOverlay(fabricCanvas);

            // Initialize center alignment guides
            this._initCenterGuides(fabricCanvas);

            // Add drag and drop support for images
            this._addDropListeners(wrapper, fabricCanvas, area.id, side);

            const textureMeta = this.textureBySide?.[side];
            if (textureMeta) {
                fabricCanvas._tusSide = side;
                this._applyTextureToCanvas(fabricCanvas, textureMeta);
            }

        };
        ensureLayout(image_el);
    },

    // ✅ Recalculate positions and sizes on resize/side change
    restructureCanvas: function (options = {}) {
        if (this.emptyCanvasMode) {
            return this._restructureEmptyCanvas(options);
        }
        const preserveSelection = options.preserveSelection !== false;
        const clearSelection = options.clearSelection === true;
        this._restructuringCanvas = true;
        try {
            const updateSide = (element, areas, side, retry = 0) => {
                if (!element || !areas || !areas.length) return;

                const img = element.querySelector("img");
                if (!img) return;
                const container = element.querySelector("div.canvas_container");
                if (!container) return;

                const imgRect = img.getBoundingClientRect();
                const containerRect = container.getBoundingClientRect();

                if ((imgRect.width === 0 || imgRect.height === 0) && retry < 10) {
                    return setTimeout(() => updateSide(element, areas, side, retry + 1), 30);
                }

                if (imgRect.width === 0 || imgRect.height === 0) {
                    console.warn('Skipping canvas restructure - image has no dimensions:', element.id);
                    return;
                }

                const stage = (this.stageBySide && this.stageBySide[side]) || this.DEFAULT_STAGE;
                const baseW = (stage && stage.w) || 394;
                const baseH = (stage && stage.h) || 394;

                const width_ratio = imgRect.width / baseW;
                const height_ratio = imgRect.height / baseH;

                // Offset between image and container (handles flex centering, padding, etc.)
                const offsetX = imgRect.left - containerRect.left;
                const offsetY = imgRect.top - containerRect.top;

                normalizeDesignAreas(areas).forEach((area) => {
                    const wrapper = element.querySelector(`.design-area[data-area-id="${area.id}"]`);
                    if (!wrapper) return;

                    const layout = getAreaDisplayLayout(
                        area,
                        stage,
                        imgRect,
                        offsetX,
                        offsetY
                    );
                    const newW = layout.canvasW;
                    const newH = layout.canvasH;

                    wrapper.style.left = `${layout.left}px`;
                    wrapper.style.top = `${layout.top}px`;
                    wrapper.style.width = `${layout.width}px`;
                    wrapper.style.height = `${layout.height}px`;

                    const canvas = this.fabricByAreaId[area.id];
                    if (canvas) {
                        const activeObj = preserveSelection && !clearSelection
                            ? canvas.getActiveObject()
                            : null;

                        if (clearSelection) {
                            canvas.discardActiveObject();
                        }
                        canvas.selection = true;

                        // 2️⃣ Store old dimensions and scale all objects before changing canvas size
                        const oldW = canvas.getWidth();
                        const oldH = canvas.getHeight();
                        const scaleX = oldW > 0 ? newW / oldW : 1;
                        const scaleY = oldH > 0 ? newH / oldH : 1;
                        const sizeUnchanged =
                            Math.abs(newW - oldW) <= 1 && Math.abs(newH - oldH) <= 1;

                        // Toolbar open/close often shifts layout by sub-pixel amounts — skip
                        // fabric resize + full re-render to avoid all objects blinking.
                        if (sizeUnchanged) {
                            if (newW > 1 && newH > 1) {
                                canvas._lastW = newW;
                                canvas._lastH = newH;
                            }
                        } else {
                            this._applyDesignAreaGeometry(canvas, wrapper, area, layout);

                            // CRITICAL FIX: Only scale if new dimensions are valid and scale ratios are reasonable
                            // This prevents destroying objects when canvas gets wrong dimensions
                            const shouldScale = oldW > 0 && oldH > 0 && newW > 1 && newH > 1 &&
                                scaleX > 0.01 && scaleX < 100 &&
                                scaleY > 0.01 && scaleY < 100 &&
                                (scaleX !== 1 || scaleY !== 1);

                            // Scale all objects' positions and sizes to maintain relative positions
                            if (shouldScale) {
                                const objects = canvas.getObjects();
                                objects.forEach(function (obj) {
                                    if (obj.tusTextureLayer) {
                                        return;
                                    }
                                    // Scale position
                                    if (obj.left !== undefined) {
                                        obj.left = obj.left * scaleX;
                                    }
                                    if (obj.top !== undefined) {
                                        obj.top = obj.top * scaleY;
                                    }
                                    // Scale dimensions (for objects that have width/height)
                                    if (obj.width !== undefined && obj.scaleX !== undefined) {
                                        obj.scaleX = obj.scaleX * scaleX;
                                    }
                                    if (obj.height !== undefined && obj.scaleY !== undefined) {
                                        obj.scaleY = obj.scaleY * scaleY;
                                    }
                                    // Update coordinates for proper rendering
                                    obj.setCoords();
                                });
                            }

                            // 3️⃣ Update dimensions
                            canvas.setDimensions({ width: newW, height: newH });

                            // 3.5️⃣ Update center guide positions after canvas resize
                            if (canvas._updateCenterGuidePositions) {
                                canvas._updateCenterGuidePositions();
                            }

                            // 4️⃣ Reset viewport transform to avoid thin blue line
                            canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);

                            // 5️⃣ Reset canvas element positioning
                            canvas.lowerCanvasEl.style.left = "0px";
                            canvas.lowerCanvasEl.style.top = "0px";
                            canvas.upperCanvasEl.style.left = "0px";
                            canvas.upperCanvasEl.style.top = "0px";
                            if (canvas.wrapperEl) {
                                canvas.wrapperEl.style.overflow = "hidden";
                            }

                            // 6️⃣ Update stored sizes
                            if (newW > 1 && newH > 1) {
                                canvas._lastW = newW;
                                canvas._lastH = newH;
                            }

                            // 7️⃣ Keep all artwork inside the design area after resize
                            canvas.getObjects().forEach((o) => {
                                this._clampObjectToDesignArea(canvas, o);
                            });
                            this._rescaleTextureBackground?.(canvas);

                            // 8️⃣ Restore selection after resize (must stay selectable for toolbar)
                            if (activeObj) {
                                canvas.setActiveObject(activeObj);
                            }
                            canvas.requestRenderAll();
                        }
                    }

                    // highlight active area wrapper
                    const isActive =
                        String(this.active_area_id) === String(area.id) &&
                        (this.active_side === (wrapper.dataset.side || this.active_side));

                    wrapper.classList.toggle("active-area", !!isActive);

                    const sideEntries = this.canvasesBySide[side] || [];
                    const canvasEntry = sideEntries.find((e) => String(e.id) === String(area.id));
                    if (canvasEntry) {
                        canvasEntry.layout = {
                            offsetX,
                            offsetY,
                            imgDisplayW: imgRect.width,
                            imgDisplayH: imgRect.height,
                        };
                    }
                });

            };

            const sideJobs = [
                { side: "front", el: document.getElementById("front_canvas"), areas: this.frontAreasData },
                { side: "back", el: document.getElementById("back_canvas"), areas: this.backAreasData },
                { side: "left", el: document.getElementById("left_canvas"), areas: this.leftAreasData },
                { side: "right", el: document.getElementById("right_canvas"), areas: this.rightAreasData },
            ];
            const onlySide = options.onlySide;
            const jobs = onlySide
                ? sideJobs.filter((job) => job.side === onlySide)
                : sideJobs;

            jobs.forEach((job) => updateSide(job.el, job.areas, job.side));

            const syncSides = onlySide
                ? [onlySide]
                : ["front", "back", "left", "right"];
            syncSides.forEach((sideName) => {
                const root = document.getElementById(`${sideName}_canvas`);
                if (this._isPreviewPaneMeasurable(root)) {
                    this._syncPreviewBoxToImage(root);
                }
            });
            this._rescaleAllTextures?.();
        } finally {
            this._restructuringCanvas = false;
        }
    },

    /**
     * True when the pane is laid out and the mockup image has real dimensions.
     * Hidden tab panes (display:none) must not be measured — that corrupts inline sizes.
     */
    _isPreviewPaneMeasurable: function (rootEl) {
        if (!rootEl) {
            return false;
        }
        if (
            !rootEl.classList.contains("active") &&
            !rootEl.classList.contains("tus-hidden-render")
        ) {
            return false;
        }
        const img = rootEl.querySelector("img.main_canvas_img");
        if (!img) {
            return false;
        }
        return img.offsetWidth >= 2 && img.offsetHeight >= 2;
    },

    /**
     * Clip the mockup stage to the visible product image (prevents bleed outside the white card).
     */
    _syncPreviewBoxToImage: function (rootEl) {
        if (this.emptyCanvasMode) {
            return;
        }
        if (!rootEl || !this._isPreviewPaneMeasurable(rootEl)) {
            return;
        }
        const img = rootEl.querySelector("img.main_canvas_img");
        const box = rootEl.querySelector(".image_preview_box");
        const container = rootEl.querySelector(".canvas_container");
        if (!img || !box || !container) {
            return;
        }
        const w = img.offsetWidth;
        const h = img.offsetHeight;
        if (w < 2 || h < 2) {
            return;
        }
        box.style.width = `${w}px`;
        box.style.height = `${h}px`;
        container.style.width = `${w}px`;
        container.style.height = `${h}px`;
    },

    /**
     * Re-align design-area overlays after layout/CSS changes (toolbar, dock, resize).
     * Double rAF waits for the browser to apply flex/size updates first.
     */
    _syncCanvasLayoutAfterUI: function () {
        if (this._isLayoutSyncSuppressed()) {
            return;
        }
        if (this._canvasLayoutSyncRaf) {
            cancelAnimationFrame(this._canvasLayoutSyncRaf);
        }
        this._canvasLayoutSyncRaf = requestAnimationFrame(() => {
            this._canvasLayoutSyncRaf = requestAnimationFrame(() => {
                this._canvasLayoutSyncRaf = null;
                if (!this._isLayoutSyncSuppressed()) {
                    this.restructureCanvas({ preserveSelection: true });
                }
            });
        });
    },

    /**
     * Run cart/preview/download export without visible editor flicker.
     * Hides selection handles, suppresses Fabric auto-renders, and blocks
     * layout observers for the duration of `fn`.
     */
    _runCanvasExportBatch: async function (fn) {
        this._exportBatchDepth = (this._exportBatchDepth || 0) + 1;
        this._suppressLayoutSyncUntil = Date.now() + 800;
        this.el?.classList?.add("tus-exporting");

        const fabrics = Object.values(this.fabricByAreaId || {}).filter(Boolean);
        const saved = fabrics.map((fab) => ({
            fab,
            renderOnAddRemove: fab.renderOnAddRemove,
        }));

        fabrics.forEach((fab) => {
            fab.renderOnAddRemove = false;
        });

        try {
            return await fn();
        } finally {
            saved.forEach(({ fab, renderOnAddRemove }) => {
                fab.renderOnAddRemove = renderOnAddRemove !== false;
            });
            this.el?.classList?.remove("tus-exporting");
            this._exportBatchDepth = Math.max(0, (this._exportBatchDepth || 1) - 1);
        }
    },

    _isLayoutSyncSuppressed: function () {
        return this._exportBatchDepth > 0 || (this._suppressLayoutSyncUntil || 0) > Date.now();
    },

    _initCanvasLayoutObservers: function () {
        if (this._canvasLayoutObservers?.length) {
            return;
        }
        if (typeof ResizeObserver === "undefined") {
            return;
        }
        const sync = debounce(() => {
            if (this._isLayoutSyncSuppressed()) {
                return;
            }
            this.restructureCanvas({ preserveSelection: true });
        }, 80);
        this._canvasLayoutObservers = [];
        const observeTargets = this.emptyCanvasMode
            ? this.el.querySelectorAll(".image_preview_box.tus-empty-canvas-stage")
            : this.el.querySelectorAll(".main_canvas_img");
        observeTargets.forEach((el) => {
            const ro = new ResizeObserver(() => sync());
            ro.observe(el);
            this._canvasLayoutObservers.push(ro);
        });
    },

    _setActiveArea: async function (side, areaId, options = {}) {
        // switch fabric canvas to the requested area on the given side
        const list = this.canvasesBySide[side] || [];
        const entry = list.find(e => String(e.id) === String(areaId)) || list[0];
        if (!entry) {
            console.warn('No canvas entry found for area:', areaId);
            return;
        }


        this.active_side = side;
        this.active_area_id = entry.id;

        // CRITICAL: Update the main canvas reference
        this.canvas = entry.canvas;

        // Make sure the canvas is interactive
        if (this.canvas) {
            this.canvas.selection = true;
            this.canvas.defaultCursor = 'default';
            this.canvas.hoverCursor = 'move';

            if (!options.keepSelection) {
                this.canvas.discardActiveObject();
            }

            this.canvas.requestRenderAll();
        }

        // update wrapper highlighting
        list.forEach(e => {
            if (e.wrapper) {
                e.wrapper.classList.toggle('active-area', String(e.id) === String(this.active_area_id));
            }
        });

        // ensure overlays and UI are in sync
        this._ensureDimOverlay(this.canvas);

        // Update current element reference
        this.currentElement = {
            canvas: this.canvas,
            object: null
        };

        // remember
        this._lastSession = { active_side: this.active_side, active_area_id: this.active_area_id };
    },

    _getRememberedAreaForSide: function (side) {
        // currently a single active_area_id; this helper lets us return it when switching back to same side
        // in future you could persist per-side remembered ids in a map
        return (this.active_side === side) ? this.active_area_id : null;
    },

    _renderAreaSelectorForSide: function (side, selectedAreaId = null) {
        // NEW APPROACH: Tabs are pre-rendered in XML, just show/hide the correct one
        // Hide all area selectors
        document.querySelectorAll('.canvas_switcher').forEach(el => {
            el.style.display = 'none';
        });

        // Show selector for active side
        const selector = document.querySelector(`.canvas_switcher[data-side="${side}"]`);
        if (selector) {
            selector.style.display = 'block';
            // Update active state on tabs if selectedAreaId provided
            if (selectedAreaId !== null) {
                selector.querySelectorAll('.area-tab-btn').forEach(btn => {
                    const btnAreaId = btn.dataset.areaId;
                    if (String(btnAreaId) === String(selectedAreaId)) {
                        btn.classList.add('active');
                    } else {
                        btn.classList.remove('active');
                    }
                });
            }
        } else {
            console.warn('No selector found for side:', side);
        }

        // Update wrapper highlighting
        const list = this.canvasesBySide[side] || [];
        list.forEach(e => {
            if (e.wrapper) {
                e.wrapper.classList.toggle('active-area', String(e.id) === String(selectedAreaId));
            }
        });
    },

    _onAreaTabClick: async function (ev) {
        // Handle click on design area tab (pre-rendered in XML)
        ev.stopPropagation();
        ev.preventDefault();

        const btn = ev.currentTarget;
        const areaId = btn.dataset.areaId;
        const side = btn.dataset.side;

        // Don't switch if already active
        if (String(this.active_area_id) === String(areaId)) {
            return;
        }

        try {
            // Clear any active selections
            if (this.canvas) {
                this.canvas.discardActiveObject();
                this.canvas.requestRenderAll();
            }

            // Switch to new area
            await this._setActiveArea(side, areaId);

            // Update active state on tabs
            const selector = btn.closest('.canvas_switcher');
            selector.querySelectorAll('.area-tab-btn').forEach(t => {
                t.classList.remove('active');
            });
            btn.classList.add('active');

        } catch (error) {
            console.error('Error switching design area:', error);
        }
    },

    _bindFontList: function () {
        const self = this;

        this.$('.font-list li').on('click', function () {
            const fontName = $(this).data('font');

            // Load font dynamically
            WebFont.load({
                google: { families: [fontName] },
                active: () => {
                    const activeObj = self.canvas.getActiveObject();
                    if (activeObj && activeObj.type === "i-text") {
                        activeObj.set("fontFamily", fontName);
                        self.canvas.requestRenderAll();
                    }
                }
            });
        });
    },

    loadSvg: async function (svgContent) {
        var self = this;
        this.historyProcessing = true;
        let extra_elem = await this.get_canvas_extra_elements();
        await this.canvas.clear();
        extra_elem.forEach((elem) => {
            this.canvas.add(elem);
        });
        fabric.loadSVGFromString(svgContent, async function (objects, options) {
            var svgGroup = fabric.util.groupSVGElements(objects, options);
            //            FOR ZOOMING
            let objectMaxWidth = self.canvasWidth - 2 * self.safe - 40;
            let objectMaxHeight = self.canvasHeight - 2 * self.safe - 40;

            let objscaleX = objectMaxWidth / svgGroup.width;
            let objscaleY = objectMaxHeight / svgGroup.height;

            self.groupscaleX = objscaleX;
            self.groupscaleY = objscaleY;
            self.groupwidth = svgGroup.width;
            self.groupheight = svgGroup.height;
            self.groupLeft = self.safe + 20;
            self.groupRight = self.safe + 20;

            svgGroup.set({
                left: self.safe + 20,
                top: self.safe + 20,
                scaleX: objscaleX,
                scaleY: objscaleY,
            });

            var objects = svgGroup.getObjects();
            svgGroup._restoreObjectsState();
            self.canvas.remove(svgGroup);

            objects.forEach(function (obj, index) {
                let fillColour =
                    Boolean(obj.fill) && typeof obj.fill != "object"
                        ? chroma(obj.fill).hex()
                        : obj.fill;
                let strokeColour =
                    Boolean(obj.stroke) && typeof obj.fill != "object"
                        ? chroma(obj.stroke).hex()
                        : obj.stroke;

                if (obj.type == "text") {
                    var ObjProperties = {
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
                    };
                    var editableText = new fabric.IText(obj.text, ObjProperties);
                    self.canvas.add(editableText);
                } else {
                    obj.set({
                        selectable: true, // Make it selectable
                        hasControls: true, // Show controls for resizing, rotating
                        lockScalingFlip: true, // Prevent flipping when scaling
                        id: index,
                        title: obj.text || obj.type,
                        fill: fillColour,
                        stroke: strokeColour,
                        centeredRotation: true,
                        centeredScaling: true,
                        locked: false,
                    });
                    self.canvas.add(obj); // Add each element to the canvas
                }
            });
            await self.canvas.renderAll();
            const json = self.canvas.toJSON(); // Get canvas as JSON
            self.undoStack.push(json);
            self.historyProcessing = false;
            self._syncHistoryButtons();
            self._updateDesignerPriceDisplay();
        });
    },

    add_canvas_events: function (fabricCanvas) {
        var self = this;
        const c = fabricCanvas || this.canvas;
        if (!c) return;

        if (c._fabHandlersBound) return;
        c._fabHandlersBound = true;

        c.on({
            "object:added": (event) => {
                const obj = event.target;
                if (obj?.tusTextureLayer) {
                    return;
                }
                if (obj && obj.type == "image") {
                    if (!obj.filters) {
                        obj.filters = [];
                    }
                    const brightnessFilter = new fabric.Image.filters.Brightness({ brightness: 0 });
                    const contrastFilter = new fabric.Image.filters.Contrast({ contrast: 0 });
                    const saturationFilter = new fabric.Image.filters.Saturation({ saturation: 0 });
                    const hueRotationFilter = new fabric.Image.filters.HueRotation({ rotation: 0 });
                    obj.filters.push(brightnessFilter, contrastFilter, saturationFilter, hueRotationFilter);
                    obj.applyFilters();
                }
                if (obj) {
                    ensureObjectFinishDefaults(obj);
                    self._clampObjectToDesignArea(c, obj);
                }
                if (!self.historyProcessing) {
                    self.saveState();
                }
                self._schedule3DPreviewRefresh();
            },
            "object:modified": (event) => {
                const obj = event?.target || c.getActiveObject();
                if (obj) {
                    self._clampObjectToDesignArea(c, obj);
                }
                self._updateDimOverlay(c, obj);
                self._hideAlignmentGuides(c);
                if (!self.historyProcessing) {
                    self.saveState();
                }
                self._schedule3DPreviewRefresh();
            },
            "object:removed": () => {
                self._layersNeedRefresh = true;
                self._skipLayersRefreshOnce = false;
                self._hideDimOverlay(c);
                self._hideAlignmentGuides(c);
                if (!self.historyProcessing) {
                    self.saveState();
                }
            },
            "selection:created": ({ selected }) => {
                if (selected.length == 1) {
                    const obj = selected[0];
                    const canvasForObj = obj.canvas;

                    // Auto-activate the design area if not already active
                    if (canvasForObj && canvasForObj !== self.canvas) {
                        const info = self._findCanvasInfo(canvasForObj);
                        if (info) {
                            self._setActiveArea(info.side, info.areaId, { keepSelection: true });
                            // Re-render the area selector to show the new active area
                            self._renderAreaSelectorForSide(info.side, info.areaId);
                        }
                    }

                    self._onElementSelected(obj);
                    self._updateDimOverlay(c, obj);
                } else {
                    self._onElementMultiSelected(selected);
                    self._hideDimOverlay(c);
                }
            },
            "selection:updated": ({ selected }) => {
                if (selected.length == 1) {
                    const obj = selected[0];
                    const canvasForObj = obj.canvas;

                    // Auto-activate the design area if not already active
                    if (canvasForObj && canvasForObj !== self.canvas) {
                        const info = self._findCanvasInfo(canvasForObj);
                        if (info) {
                            self._setActiveArea(info.side, info.areaId, { keepSelection: true });
                            // Re-render the area selector to show the new active area
                            self._renderAreaSelectorForSide(info.side, info.areaId);
                        }
                    }

                    self._onElementSelected(obj);
                    self._updateDimOverlay(c, obj);
                } else {
                    self._onElementMultiSelected(selected);
                    self._hideDimOverlay(c);
                }
            },
            "after:render": async () => {
                if (self._layersNeedRefresh || !self._skipLayersRefreshOnce) {
                    await self.managelayers();
                }
                self._layersNeedRefresh = false;
                self._skipLayersRefreshOnce = false;
                self.removeLoader();
            },
            "object:rotating": async (event) => {
                const obj = event.target;
                self._clampObjectToDesignArea(c, obj, { transform: event.transform });
                $(".elem_rotate").val(parseFloat(obj.angle).toFixed(2));
                $(".rotate-text").val(parseFloat(obj.angle).toFixed(2));
                self._inputProgress($(".elem_rotate"), (obj.angle / 360) * 100);
                self._updateDimOverlay(c, obj);
            },
            "selection:cleared": () => {
                if (self._restructuringCanvas) {
                    return;
                }
                self._onElemSelectRemove();
                $(".color-tool .color-icon").css("background-color", "#000");
                self._hideDimOverlay(c);
                self._hideAlignmentGuides(c);
            },
            "object:scaling": function (e) {
                const obj = e.target;
                self._clampObjectToDesignArea(c, obj, { transform: e.transform });
                self._updateDimOverlay(c, obj);
                self._updateAlignmentGuides(c, obj);
            },
            "object:moving": function (e) {
                const obj = e.target;
                self._clampObjectToDesignArea(c, obj);
                self._updateDimOverlay(c, obj);
                self._updateAlignmentGuides(c, obj);
            },
        });
    },

    _ensureDimOverlay: function (canvas) {
        if (canvas._dimOverlayEl) return;
        const wrapper = canvas._wrapperEl;
        if (!wrapper) return;

        // Ensure wrapper is positioning context
        if (getComputedStyle(wrapper).position === 'static') {
            wrapper.style.position = 'relative';
        }

        const el = document.createElement('div');
        el.className = 'dim-overlay';
        el.style.position = 'absolute';
        el.style.pointerEvents = 'none';
        el.style.background = 'rgba(0,0,0,0.7)';
        el.style.color = '#fff';
        el.style.padding = '4px 8px';
        el.style.borderRadius = '4px';
        el.style.fontSize = '12px';
        el.style.lineHeight = '1.35';
        el.style.whiteSpace = 'nowrap';
        el.style.transform = 'translate(0, 0)'; // align using absolute left/top directly
        el.style.display = 'none';
        el.style.zIndex = '2';
        // optional: subtle shadow for visibility
        el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.25)';

        wrapper.appendChild(el);
        canvas._dimOverlayEl = el;
    },

    _computeObjectDimensions: function (canvas, obj) {
        // Try to get the related design area data by area id on wrapper
        const wrapper = canvas._wrapperEl;
        const areaId = wrapper?.dataset?.areaId;
        // pick the correct side's areas list
        const side = wrapper?.dataset?.side || this.active_side;
        const listName = (side ? side : this.active_side) + 'AreasData';
        const areas = this[listName] || [];
        const matched = areas.find(a => String(a.id) === String(areaId));
        // Use effective canvas size even when the side is hidden (getWidth/getHeight might be ~1)
        const cwRaw = Number(canvas.getWidth()) || 0;
        const chRaw = Number(canvas.getHeight()) || 0;
        const cw = cwRaw > 1 ? cwRaw : (canvas._lastW || canvas._baseW || 1);
        const ch = chRaw > 1 ? chRaw : (canvas._lastH || canvas._baseH || 1);

        const objw = obj.getScaledWidth ? obj.getScaledWidth() : (obj.width * (obj.scaleX || 1) || 0);
        const objh = obj.getScaledHeight ? obj.getScaledHeight() : (obj.height * (obj.scaleY || 1) || 0);

        // If actual dimensions are provided, compute directly in that unit
        const actual = matched?.meta?.actual;

        if (actual && Number.isFinite(actual.width) && Number.isFinite(actual.height) && actual.width > 0 && actual.height > 0) {
            let unit = actual.unit || 'inch';
            const realW = (objw / cw) * actual.width;
            const realH = (objh / ch) * actual.height;
            if (unit == 'millimeter') {
                unit = 'mm'
            } else if (unit == 'centimeter') {
                unit = 'cm'
            }
            return {
                w: Math.round(realW * 100) / 100,
                h: Math.round(realH * 100) / 100,
                unit,
            };
        }

        // Fallback to in_units if provided
        const iu = matched?.in_units;
        if (iu && Number.isFinite(iu.width) && Number.isFinite(iu.height) && iu.width > 0 && iu.height > 0) {
            const unit = iu.unit || 'inch';
            const realW = (objw / cw) * iu.width;
            const realH = (objh / ch) * iu.height;
            return {
                w: Math.round(realW * 100) / 100,
                h: Math.round(realH * 100) / 100,
                unit,
            };
        }

        // Final fallback to canvas pixels as "px"
        return {
            w: Math.round(objw),
            h: Math.round(objh),
            unit: 'px',
        };
    },

    _updateDimOverlay: function (canvas, obj) {
        if (!canvas) return;
        this._ensureDimOverlay(canvas);
        if (!obj) {
            this._hideDimOverlay(canvas);
            return;
        }
        const overlay = canvas._dimOverlayEl;
        if (!overlay) return;

        const content = this._formatDimOverlayContent
            ? this._formatDimOverlayContent(canvas, obj)
            : null;
        if (content) {
            overlay.innerHTML = content.html;
            overlay.style.whiteSpace = content.multiline ? "normal" : "nowrap";
        } else {
            const { w, h, unit } = this._computeObjectDimensions(canvas, obj);
            overlay.textContent = `${w} × ${h} ${unit}`;
            overlay.style.whiteSpace = "nowrap";
        }

        // Compute bottom-right of the object's bounding rect with a gap
        const rect = obj.getBoundingRect(true, true); // include transforms
        const cw = canvas.getWidth();
        const ch = canvas.getHeight();
        const gap = 8; // distance from the object for clarity

        // Make sure we can measure overlay size for clamping
        const prevDisplay = overlay.style.display;
        const prevVisibility = overlay.style.visibility;
        overlay.style.display = 'block';
        overlay.style.visibility = 'hidden';
        const ow = overlay.offsetWidth || 0;
        const oh = overlay.offsetHeight || 0;

        // Desired bottom-right alignment (overlay's top-left corner offset by gap)
        let x = rect.left + rect.width + gap;
        let y = rect.top + rect.height + gap;

        // Clamp within design area bounds
        const pad = 2;
        x = Math.min(Math.max(pad, x), cw - ow - pad);
        y = Math.min(Math.max(pad, y), ch - oh - pad);

        overlay.style.left = `${x}px`;
        overlay.style.top = `${y}px`;
        overlay.style.visibility = 'visible';
        // restore display if it was hidden previously by caller
        if (prevDisplay === 'none') {
            // keep it visible now
        }

        // Ensure shown
        overlay.style.display = 'block';
    },

    _hideDimOverlay: function (canvas) {
        if (canvas && canvas._dimOverlayEl) {
            canvas._dimOverlayEl.style.display = 'none';
        }
    },

    _shouldClampToDesignArea: function (obj) {
        return (
            obj &&
            !obj.center_line &&
            !obj.extra_elem &&
            !obj.tusTextureLayer &&
            !obj.locked
        );
    },

    /**
     * Keep user objects fully inside the printable design-area canvas.
     * Uses axis-aligned bounding box (works with move, scale, and rotate).
     * Scales each axis independently so adjusting width does not shrink height
     * (and vice versa) when the other dimension hits the canvas edge.
     */
    _clampObjectToDesignArea: function (canvas, obj, options) {
        if (!canvas || !this._shouldClampToDesignArea(obj)) {
            return false;
        }

        options = options || {};

        const cw = canvas.getWidth();
        const ch = canvas.getHeight();
        if (cw <= 1 || ch <= 1) {
            return false;
        }

        const poly = canvas._tusClipPoints;
        if (poly && poly.length >= 3) {
            obj.setCoords();
            const br = obj.getBoundingRect(true, true);
            const cx = br.left + br.width / 2;
            const cy = br.top + br.height / 2;
            if (!pointInPolygon(cx, cy, poly)) {
                const centroid = poly.reduce(
                    (acc, p) => ({ x: acc.x + p.x / poly.length, y: acc.y + p.y / poly.length }),
                    { x: 0, y: 0 }
                );
                obj.set({
                    left: obj.left + (centroid.x - cx),
                    top: obj.top + (centroid.y - cy),
                });
                obj.setCoords();
                return true;
            }
        }

        const corner = options.transform?.corner || "";
        const horizOnly = corner === "ml" || corner === "mr";
        const vertOnly = corner === "mt" || corner === "mb";

        obj.setCoords();
        let br = obj.getBoundingRect(true, true);
        let changed = false;

        const maxW = canvas._tusPrintableInset ? canvas._tusPrintableInset.width : cw;
        const maxH = canvas._tusPrintableInset ? canvas._tusPrintableInset.height : ch;

        if (!vertOnly && br.width > maxW) {
            const factorX = maxW / br.width;
            if (factorX < 1) {
                obj.scaleX = (obj.scaleX || 1) * factorX;
                obj.setCoords();
                br = obj.getBoundingRect(true, true);
                changed = true;
            }
        }
        if (!horizOnly && br.height > maxH) {
            const factorY = maxH / br.height;
            if (factorY < 1) {
                obj.scaleY = (obj.scaleY || 1) * factorY;
                obj.setCoords();
                br = obj.getBoundingRect(true, true);
                changed = true;
            }
        }

        let left = obj.left;
        let top = obj.top;

        const boundsLeft = canvas._tusPrintableInset?.left ?? 0;
        const boundsTop = canvas._tusPrintableInset?.top ?? 0;
        const boundsRight = boundsLeft + (canvas._tusPrintableInset?.width ?? cw);
        const boundsBottom = boundsTop + (canvas._tusPrintableInset?.height ?? ch);

        if (br.left < boundsLeft) {
            left -= br.left - boundsLeft;
            changed = true;
        }
        if (br.top < boundsTop) {
            top -= br.top - boundsTop;
            changed = true;
        }
        if (br.left + br.width > boundsRight) {
            left -= br.left + br.width - boundsRight;
            changed = true;
        }
        if (br.top + br.height > boundsBottom) {
            top -= br.top + br.height - boundsBottom;
            changed = true;
        }

        if (changed) {
            obj.set({ left, top });
            obj.setCoords();
        }
        return changed;
    },

    _clampActiveObjectToDesignArea: function (canvas) {
        const obj = canvas?.getActiveObject?.();
        if (!obj) {
            return false;
        }
        return this._clampObjectToDesignArea(canvas, obj);
    },

    _getDesignAreaSize: function (fabricCanvas) {
        const canvas = fabricCanvas || this.canvas;
        if (!canvas) {
            return { width: 200, height: 200 };
        }
        return {
            width: Math.max(1, canvas.getWidth?.() || canvas.width || 200),
            height: Math.max(1, canvas.getHeight?.() || canvas.height || 200),
        };
    },

    /**
     * Default box for newly added artwork (~45% of printable area).
     * User can resize after placement.
     */
    _getDefaultPlacementBox: function (fabricCanvas) {
        const { width: cw, height: ch } = this._getDesignAreaSize(fabricCanvas);
        const fillRatio = 0.45;
        const minDim = Math.max(48, Math.min(cw, ch) * 0.22);
        const boxW = Math.max(minDim, Math.min(cw - 8, cw * fillRatio));
        const boxH = Math.max(minDim, Math.min(ch - 8, ch * fillRatio));
        return { boxW, boxH, cw, ch };
    },

    _fitFabricObjectToPlacementBox: function (obj, fabricCanvas) {
        const canvas = fabricCanvas || obj.canvas || this.canvas;
        if (!obj || !canvas) {
            return obj;
        }
        const { boxW, boxH, cw, ch } = this._getDefaultPlacementBox(canvas);
        const baseW = Math.max(1, obj.width || 1);
        const baseH = Math.max(1, obj.height || 1);
        const sx0 = obj.scaleX ?? 1;
        const sy0 = obj.scaleY ?? 1;
        const scale = Math.min(boxW / (baseW * sx0), boxH / (baseH * sy0));
        const sx = sx0 * scale;
        const sy = sy0 * scale;

        obj.set({
            scaleX: sx,
            scaleY: sy,
            left: (cw - baseW * sx) / 2,
            top: (ch - baseH * sy) / 2,
            originX: "left",
            originY: "top",
        });
        obj.setCoords();
        return obj;
    },

    _createDefaultCanvasText: function (fabricCanvas, textValue) {
        const canvas = fabricCanvas || this.canvas;
        const { boxW, boxH, cw, ch } = this._getDefaultPlacementBox(canvas);
        let fontSize = Math.round(
            Math.min(boxH * 0.5, boxW / Math.max(2, textValue.length) * 1.2, ch * 0.14)
        );
        fontSize = Math.max(18, Math.min(44, fontSize));

        const itext = new fabric.IText(textValue, {
            left: cw / 2,
            top: ch / 2,
            originX: "center",
            originY: "center",
            fontSize,
            fill: "#000000",
            editable: true,
            locked: false,
            centeredRotation: true,
            centeredScaling: true,
        });
        itext.setCoords();
        const rect = itext.getBoundingRect(true, true);
        if (rect.width > boxW || rect.height > boxH) {
            const shrink = Math.min(boxW / rect.width, boxH / rect.height);
            itext.set({
                scaleX: shrink,
                scaleY: shrink,
                left: cw / 2,
                top: ch / 2,
                originX: "center",
                originY: "center",
            });
            itext.setCoords();
        }
        return itext;
    },

    /**
     * Initialize center alignment guide lines for a canvas
     * Creates two reusable fabric.Line objects (vertical and horizontal)
     */
    _initCenterGuides: function (canvas) {
        if (!canvas || canvas._centerGuides) return;

        const cw = canvas.getWidth();
        const ch = canvas.getHeight();
        const centerX = cw / 2;
        const centerY = ch / 2;

        // Create vertical center line
        const verticalLine = new fabric.Line([centerX, 0, centerX, ch], {
            stroke: '#00D9FF',
            strokeWidth: 1.5,
            strokeDashArray: [8, 4],
            selectable: false,
            evented: false,
            excludeFromExport: true,
            visible: false,
            center_line: true,
            extra_elem: true,
            opacity: 0.9,
        });

        // Create horizontal center line
        const horizontalLine = new fabric.Line([0, centerY, cw, centerY], {
            stroke: '#00D9FF',
            strokeWidth: 1.5,
            strokeDashArray: [8, 4],
            selectable: false,
            evented: false,
            excludeFromExport: true,
            visible: false,
            center_line: true,
            extra_elem: true,
            opacity: 0.9,
        });

        // Add to canvas
        canvas.add(verticalLine);
        canvas.add(horizontalLine);

        // Store references
        canvas._centerGuides = {
            vertical: verticalLine,
            horizontal: horizontalLine,
        };

        // Update guide positions when canvas is resized
        const updateGuidePositions = () => {
            const w = canvas.getWidth();
            const h = canvas.getHeight();
            const cx = w / 2;
            const cy = h / 2;

            verticalLine.set({ x1: cx, y1: 0, x2: cx, y2: h });
            horizontalLine.set({ x1: 0, y1: cy, x2: w, y2: cy });
            verticalLine.setCoords();
            horizontalLine.setCoords();
        };

        // Store the update function for later use
        canvas._updateCenterGuidePositions = updateGuidePositions;
    },

    /**
     * Check if an object's center is near the canvas center
     * @param {fabric.Canvas} canvas - The fabric canvas
     * @param {fabric.Object} obj - The object to check
     * @returns {Object} { showVertical: boolean, showHorizontal: boolean }
     */
    _checkCenterAlignment: function (canvas, obj) {
        if (!canvas || !obj) return { showVertical: false, showHorizontal: false };

        const threshold = 15; // pixels
        const cw = canvas.getWidth();
        const ch = canvas.getHeight();
        const canvasCenterX = cw / 2;
        const canvasCenterY = ch / 2;

        // Get object's center point (considering transforms)
        const objCenter = obj.getCenterPoint();

        // Check horizontal alignment (vertical line should show)
        const horizontalDistance = Math.abs(objCenter.x - canvasCenterX);
        const showVertical = horizontalDistance <= threshold;

        // Check vertical alignment (horizontal line should show)
        const verticalDistance = Math.abs(objCenter.y - canvasCenterY);
        const showHorizontal = verticalDistance <= threshold;

        return { showVertical, showHorizontal };
    },

    /**
     * Update center alignment guide visibility based on object position
     * @param {fabric.Canvas} canvas - The fabric canvas
     * @param {fabric.Object} obj - The object being moved/scaled
     */
    _updateAlignmentGuides: function (canvas, obj) {
        if (!canvas || !canvas._centerGuides) return;

        const guides = canvas._centerGuides;
        const { showVertical, showHorizontal } = this._checkCenterAlignment(canvas, obj);

        // Track previous visibility to avoid unnecessary renders
        const prevVertical = guides.vertical.visible;
        const prevHorizontal = guides.horizontal.visible;

        // Update visibility
        guides.vertical.visible = showVertical;
        guides.horizontal.visible = showHorizontal;

        // Only render if visibility changed
        if (prevVertical !== showVertical || prevHorizontal !== showHorizontal) {
            canvas.requestRenderAll();
        }
    },

    /**
     * Hide all center alignment guides
     * @param {fabric.Canvas} canvas - The fabric canvas
     */
    _hideAlignmentGuides: function (canvas) {
        if (!canvas || !canvas._centerGuides) return;

        const guides = canvas._centerGuides;
        const needsRender = guides.vertical.visible || guides.horizontal.visible;

        guides.vertical.visible = false;
        guides.horizontal.visible = false;

        if (needsRender) {
            canvas.requestRenderAll();
        }
    },

    /**
     * Setup global drag detection to show all design areas as droppable
     * when files are dragged anywhere in the editor
     */
    _setupGlobalDragDetection: function () {
        const self = this;
        const editorContainer = this.el; // The main fabric_container element

        if (!editorContainer) return;

        let dragCounter = 0; // Track nested drag enter/leave events

        // Create backdrop overlay element
        const backdrop = document.createElement('div');
        backdrop.className = 'drag-drop-backdrop';
        backdrop.style.display = 'none';
        const dpiHint = document.createElement('div');
        dpiHint.className = 'drag-drop-dpi-hint';
        dpiHint.textContent = _t("Recommended file quality: 150 DPI for sharp print");
        backdrop.appendChild(dpiHint);
        editorContainer.appendChild(backdrop);
        this._dragDropBackdrop = backdrop;

        // When drag enters anywhere in the editor
        editorContainer.addEventListener('dragenter', function (e) {
            // Only handle file drags
            if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
                dragCounter++;

                if (dragCounter === 1) {
                    // Show backdrop and all design areas as droppable
                    self._showAllAreasAsDroppable();
                }
            }
        });

        // When drag leaves the editor
        editorContainer.addEventListener('dragleave', function (e) {
            if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
                dragCounter--;

                if (dragCounter === 0) {
                    // Hide droppable indicators
                    self._hideAllAreasAsDroppable();
                }
            }
        });

        // Prevent default drop on backdrop (allow only on design areas)
        backdrop.addEventListener('dragover', function (e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'none';
        });

        backdrop.addEventListener('drop', function (e) {
            e.preventDefault();
            e.stopPropagation();
            dragCounter = 0;
            self._hideAllAreasAsDroppable();
        });

        // Also handle at document level to catch drops outside
        document.addEventListener('dragover', function (e) {
            // Allow default for design areas, prevent elsewhere
            const isDesignArea = e.target.closest('.design-area');
            if (!isDesignArea && dragCounter > 0) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'none';
            }
        });

        document.addEventListener('drop', function (e) {
            // If dropping outside design areas, clean up
            const isDesignArea = e.target.closest('.design-area');
            if (!isDesignArea && dragCounter > 0) {
                e.preventDefault();
                dragCounter = 0;
                self._hideAllAreasAsDroppable();
            }
        });

        document.addEventListener('dragend', function (e) {
            dragCounter = 0;
            self._hideAllAreasAsDroppable();
        });
    },

    /**
     * Show all design areas on the active side as droppable
     */
    _showAllAreasAsDroppable: function () {
        // Show backdrop
        if (this._dragDropBackdrop) {
            this._dragDropBackdrop.style.display = 'block';
        }

        // Add class to editor container for backdrop blur effect
        if (this.el) {
            this.el.classList.add('drag-active');
        }

        // Show droppable state on all active areas
        const activeList = this.canvasesBySide[this.active_side] || [];
        activeList.forEach(entry => {
            if (entry.wrapper) {
                entry.wrapper.classList.add('drag-in-editor');
            }
        });
    },

    /**
     * Hide droppable indicators from all design areas
     */
    _hideAllAreasAsDroppable: function () {
        // Hide backdrop
        if (this._dragDropBackdrop) {
            this._dragDropBackdrop.style.display = 'none';
        }

        // Remove class from editor container
        if (this.el) {
            this.el.classList.remove('drag-active');
        }

        // Remove droppable states from all areas
        for (const [side, canvasList] of Object.entries(this.canvasesBySide)) {
            canvasList.forEach(entry => {
                if (entry.wrapper) {
                    entry.wrapper.classList.remove('drag-in-editor');
                    entry.wrapper.classList.remove('drag-over');
                }
            });
        }
    },

    /**
     * Add drag and drop event listeners to a design area wrapper
     * @param {HTMLElement} wrapper - The design area wrapper element
     * @param {fabric.Canvas} fabricCanvas - The fabric canvas
     * @param {string} areaId - The area ID
     * @param {string} side - The side name
     */
    _addDropListeners: function (wrapper, fabricCanvas, areaId, side) {
        const self = this;

        // When drag enters this specific area
        wrapper.addEventListener('dragover', function (e) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'copy';

            // Add specific area highlight (on top of general drag-in-editor)
            if (!wrapper.classList.contains('drag-over')) {
                wrapper.classList.add('drag-over');
            }
        });

        // When drag leaves this specific area
        wrapper.addEventListener('dragleave', function (e) {
            e.preventDefault();
            e.stopPropagation();

            // Only remove highlight if we're actually leaving the wrapper
            const rect = wrapper.getBoundingClientRect();
            if (e.clientX < rect.left || e.clientX >= rect.right ||
                e.clientY < rect.top || e.clientY >= rect.bottom) {
                wrapper.classList.remove('drag-over');
            }
        });

        // When file is dropped on this specific area
        wrapper.addEventListener('drop', function (e) {
            e.preventDefault();
            e.stopPropagation();

            // Remove visual feedback from all areas and backdrop
            self._hideAllAreasAsDroppable();

            // Handle the dropped files
            self._onImageDropped(e, fabricCanvas, areaId, side);
        });
    },

    /**
     * Find canvas information (side and area ID) for a given fabric canvas
     * @param {fabric.Canvas} canvas - The fabric canvas to find
     * @returns {Object|null} { side, areaId, entry } or null if not found
     */
    _findCanvasInfo: function (canvas) {
        if (!canvas) return null;

        // Search through all sides and areas
        for (const [side, canvasList] of Object.entries(this.canvasesBySide)) {
            for (const entry of canvasList) {
                if (entry.canvas === canvas) {
                    return {
                        side: side,
                        areaId: entry.id,
                        entry: entry
                    };
                }
            }
        }

        return null;
    },

    /**
     * Handle image files dropped onto a design area
     * @param {DragEvent} event - The drop event
     * @param {fabric.Canvas} canvas - The target fabric canvas
     * @param {string} areaId - The area ID
     * @param {string} side - The side name
     */
    _onImageDropped: function (event, canvas, areaId, side) {
        const self = this;
        const files = event.dataTransfer.files;

        if (!files || files.length === 0) {
            return;
        }

        // Make sure this area is active before adding images
        if (this.active_side !== side || this.active_area_id !== areaId) {
            this._setActiveArea(side, areaId);
        }

        this._activeSidebarOption = "image";
        this.startLoader("Adding Image...", { light: true });

        const pending = [];
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const ext = file.name.split(".").pop().toLowerCase();
            const validImageTypes = ["jpg", "jpeg", "png", "gif", "svg", "webp", "bmp", "ai", "eps"];

            if (!validImageTypes.includes(ext)) {
                console.warn("Invalid file type:", ext);
                continue;
            }

            pending.push(
                self._processUploadedImageFile(file, canvas).catch(function (err) {
                    if (self._isShareReadOnlyError?.(err)) {
                        return;
                    }
                    console.error("Drop upload failed:", err);
                    self.notification.add(
                        err.message || _t("Failed to add dropped image."),
                        { type: "danger" }
                    );
                })
            );
        }

        Promise.all(pending).finally(function () {
            self.removeLoader();
        });
    },

    get_canvas_elements: function () {
        return this.canvas.getObjects().filter((element) => !element.center_line);
    },

    get_canvas_extra_elements: function () {
        //        .filter((element) => !element.safety_line)
        return this.canvas.getObjects().filter((elem) => elem.extra_elem);
    },

    getElementByID: function (id) {
        const objects = this.get_canvas_elements();

        for (var i = 0; i < objects.length; ++i) {
            if (objects[i].id == id) {
                return objects[i];
            }
        }

        return false;
    },

    managelayers: function () {
        this.listElem = $(".layers_list");
        this.listElem.empty();
        var elements = this.get_canvas_elements();
        elements.forEach((element, index) => {
            element.id = index;
            this.elem_index = index;
            if (!element.extra_elem) {
                this.appendToLayers(element);
                this.makeAreaSortable();
            }
        });
    },

    appendToLayers: function (element) {
        var self = this;
        const rowElem = $(`<div id=${element.id} class="row-list"></div>`);
        const colorWrapper = $(`<div class="cell-0"></div>`);
        rowElem.append(colorWrapper);
        let sourceContent = element.custom?.layerLabel || element.text || element.title || element.type;
        const textWrapper = $(`<div class="cell-1"></div>`);
        textWrapper.append(sourceContent);
        rowElem.append(textWrapper);
        const actionsWrapper = $(`<div class="cell-2"></div>`);
        rowElem.append(actionsWrapper);
        const sortIcon = $(`<span class="fa fa-list"></span>`);
        colorWrapper.append(sortIcon);

        //        lock- unlock
        const lockClass = element.locked ? "fa fa-lock" : "fa fa-unlock";
        const lockIcon = $(
            `<span class="lock-element"><span class="${lockClass}"></span></span>`
        );
        actionsWrapper.append(lockIcon);

        lockIcon.click((ev) => {
            ev.stopPropagation();
            let activeElement = element.canvas.getActiveObject();
            //            element.evented = !element.evented;
            element.locked = !element.locked;
            //            element.selectable = !element.selectable;
            element.hasControls = !element.hasControls;
            element.lockRotation = !element.lockRotation;
            element.lockMovementX = !element.lockMovementX;
            element.lockMovementY = !element.lockMovementY;
            if (activeElement && element.id == activeElement.id && element.locked) {
                element.canvas.discardActiveObject();
            }
            if (element.locked) {
                $(ev.currentTarget).find("span").addClass("fa-lock");
                $(ev.currentTarget).find("span").removeClass("fa-unlock");
            } else {
                $(ev.currentTarget).find("span").addClass("fa-unlock");
                $(ev.currentTarget).find("span").removeClass("fa-lock");
                element.canvas.setActiveObject(element);
            }
            element.canvas.renderAll();
        });

        //        visibility

        const visibleClass = element.visible ? "fa fa-eye-slash" : "fa fa-eye";
        const visibleElem = $(
            `<span class="visible-element"><span class="${visibleClass}"></span></span>`
        );
        actionsWrapper.append(visibleElem);

        visibleElem.click((ev) => {
            if (element.visible) {
                $(ev.currentTarget).find("span").addClass("fa-eye");
                $(ev.currentTarget).find("span").removeClass("fa-eye-slash");
            } else {
                $(ev.currentTarget).find("span").addClass("fa-eye-slash");
                $(ev.currentTarget).find("span").removeClass("fa-eye");
            }
            element.set("visible", !element.visible);
            element.canvas.renderAll();
        });

        //        remove Element
        const removeIcon = $(
            `<span class="remove-element"><span class="fa fa-trash"></span></span>`
        );
        actionsWrapper.append(removeIcon);
        removeIcon.click((ev) => {
            ev.stopPropagation();
            element.canvas.discardActiveObject();
            element.canvas.remove(element);
            element.canvas.requestRenderAll();
        });

        //        Select Element

        this.listElem.prepend(rowElem);
        rowElem.find(".cell-1").click((ev) => {
            if (element.locked) {
                return;
            }
            element.canvas.setActiveObject(element);
            element.canvas.renderAll();
        });
    },

    makeAreaSortable: function () {
        if (this.areaSortable) {
            this.areaSortable.dispose();
        }
        var self = this;
        this.areaSortable = AreaSortable("vertical", {
            container: "layers_list",
            handle: "fa-list",
            item: "row-list",
            placeholder: "sortable-placeholder",
            activeItem: "sortable-dragged",
            closestItem: "sortable-closest",
            autoscroll: true,
            animationMs: 0,
            onStart: (item) => {
                const scrollTop =
                    window.pageYOffset || document.documentElement.scrollTop || 0;
                window.onscroll = () => {
                    window.scrollTo({ top: scrollTop });
                };
            },
            onEnd: (item) => {
                const targetElement = self.getElementByID($(item).attr("id"));
                let index;
                if ($(item).attr("id") && $(item).prev().length > 0) {
                    if (
                        parseInt($(item).attr("id")) >
                        parseInt($(item).prev().attr("id"))
                    ) {
                        index = parseInt($(item).prev().attr("id"));
                    } else {
                        index = parseInt($(item).next().attr("id"));
                    }
                } else {
                    index = parseInt($(item).next().attr("id"));
                }
                targetElement.moveTo(index);
                window.onscroll = () => { };
            },
        });
    },

    startLoader: function (text, options = {}) {
        const scope = options.scope === "canvas" ? "canvas" : "page";
        const $wrapper =
            scope === "canvas"
                ? this.$(".main_wrapper .tus-canvas-loader")
                : this.$(".fab_loader_wrapper");
        if (!$wrapper.length) {
            return;
        }
        $wrapper.find(".fab-loader-text").text(text || "");
        $wrapper.toggleClass("loader_overlay--light", !!options.light);
        $wrapper.removeClass("loader_hide").attr("aria-hidden", "false");
        this._loaderScope = scope;
        this._loaderWrapper = $wrapper;
    },

    removeLoader: function () {
        const $wrapper = this._loaderWrapper || this.$(".fab_loader_wrapper");
        $wrapper.addClass("loader_hide").removeClass("loader_overlay--light");
        $wrapper.find(".fab-loader-text").text("");
        $wrapper.attr("aria-hidden", "true");
        this._loaderScope = null;
        this._loaderWrapper = null;
    },

    saveState: function () {
        if (this.historyProcessing) {
            return;
        }
        if (!this._debouncedSaveState) {
            this._debouncedSaveState = debounce(this._saveStateNow.bind(this), 200);
        }
        this._debouncedSaveState();
    },

    _cancelPendingHistorySave: function () {
        if (this._debouncedSaveState && this._debouncedSaveState.cancel) {
            this._debouncedSaveState.cancel();
        }
    },

    _beginHistoryRestore: function () {
        this._cancelPendingHistorySave();
        this.historyProcessing = true;
    },

    _endHistoryRestore: function () {
        const self = this;
        // Outlast debounced saveState so loadFromJSON events do not clear redo.
        setTimeout(function () {
            self.historyProcessing = false;
        }, 300);
    },

    _syncHistoryButtons: function () {
        const canUndo = this.undoStack && this.undoStack.length > 1;
        const canRedo = this.redoStack && this.redoStack.length > 0;
        $(".undo_btn").toggleClass("disabled", !canUndo);
        $(".redo_btn").toggleClass("disabled", !canRedo);
    },

    _saveStateNow: function () {
        if (this.historyProcessing || !this.canvas) {
            return;
        }

        this.redoStack = [];

        const json = this.canvas.toJSON();
        const jsonKey = JSON.stringify(json);

        if (this.undoStack.length > 0) {
            const lastKey = JSON.stringify(this.undoStack[this.undoStack.length - 1]);
            if (lastKey === jsonKey) {
                return;
            }
        }

        this.undoStack.push(json);
        this._syncHistoryButtons();
        this._updateDesignerPriceDisplay();
    },


    _onUndo: function () {
        var self = this;

        if (!this.undoStack || this.undoStack.length <= 1) {
            this.notification.add(_t("No more undo steps available"), { type: 'danger' });
            this.removeLoader();
            return;
        }

        this._beginHistoryRestore();
        this.startLoader("Loading...");

        const currentState = this.undoStack.pop();
        this.redoStack.push(currentState);

        const previousState = this.undoStack[this.undoStack.length - 1];
        this._syncHistoryButtons();

        self.canvas.loadFromJSON(previousState, async () => {
            await self.canvas.renderAll();
            self._endHistoryRestore();
            self._updateDesignerPriceDisplay();
            self.removeLoader();
        });
    },


    _onRedo: function () {
        var self = this;

        if (!this.redoStack || this.redoStack.length === 0) {
            this.notification.add(_t("No more redo steps available"), { type: 'danger' });
            this.removeLoader();
            return;
        }

        this._beginHistoryRestore();
        this.startLoader("Loading...");

        const nextState = this.redoStack.pop();
        this.undoStack.push(nextState);
        this._syncHistoryButtons();

        this.canvas.loadFromJSON(nextState, async () => {
            await self.canvas.renderAll();
            self._endHistoryRestore();
            self._updateDesignerPriceDisplay();
            self.removeLoader();
        });
    },

    _bindKeyboardShortcuts: function () {
        const self = this;
        document.addEventListener("keydown", function (e) {
            // Ctrl+Z (Undo)
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
                e.preventDefault();
                self._onUndo();
            }

            // Ctrl+Y (Redo)
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
                e.preventDefault();
                self._onRedo();
            }

            // Ctrl+Shift+Z (Redo alternative)
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "z") {
                e.preventDefault();
                self._onRedo();
            }

            // Ctrl+C (Copy)
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
                // Only copy if not in an input field
                if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
                    self._onCopy();
                }
            }

            // Ctrl+V (Paste)
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
                // Only paste if not in an input field
                if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
                    self._onPaste();
                }
            }

            // Esc (Remove Active Object)
            if (e.key === "Escape") {
                if (self.canvas) {
                    const activeObject = self.canvas.getActiveObject();
                    if (activeObject && !activeObject.isEditing) {
                        if (activeObject.type === 'activeSelection') {
                            activeObject.forEachObject(obj => self.canvas.remove(obj));
                        } else {
                            self.canvas.remove(activeObject);
                        }
                        self.canvas.discardActiveObject();
                        self.canvas.requestRenderAll();
                        self.saveState();
                    }
                }
            }
        });
    },

    _onCopy: function () {
        const self = this;
        if (!this.canvas) return;
        const activeObject = this.canvas.getActiveObject();
        if (!activeObject) return;

        activeObject.clone(function (cloned) {
            self._clipboard = cloned;
        });
    },

    _onPaste: function () {
        const self = this;
        if (!this.canvas || !this._clipboard) return;

        this._clipboard.clone(function (clonedObj) {
            self.canvas.discardActiveObject();
            clonedObj.set({
                left: clonedObj.left + 10,
                top: clonedObj.top + 10,
                evented: true,
            });

            if (clonedObj.type === 'activeSelection') {
                // active selection needs a reference to the canvas.
                clonedObj.canvas = self.canvas;
                clonedObj.forEachObject(function (obj) {
                    self.canvas.add(obj);
                });
                // this spcl case needs to be handled to properly highlights the objects
                clonedObj.setCoords();
            } else {
                self.canvas.add(clonedObj);
            }

            self._clipboard.top += 10;
            self._clipboard.left += 10;
            self.canvas.setActiveObject(clonedObj);
            self.canvas.requestRenderAll();
            self.saveState();
        });
    },

    _onCloseOptions: function () {
        $(".fab_item").removeClass("active");
        $(".section_options").removeClass("active");
        $(".options_content").hide();
        $(".options_content").removeClass("tus-panel-visible");
        if (typeof this._syncMobilePanelState === "function") {
            this._syncMobilePanelState();
        }
    },

    _onClickPreview: async function (ev) {
        ev.preventDefault();
        try {
            await this._onPreviewCurrentSide();
        } catch (error) {
            console.error("Preview failed:", error);
            this.notification.add(_t("Preview failed. Please try again."), { type: "danger" });
        }
    },

    _sidebarOptionFromElement: function (elem) {
        if (!elem) {
            return null;
        }
        if (["text", "i-text", "textbox"].includes(elem.type)) {
            return "text";
        }
        if (elem._curvedMeta?.isCurved) {
            return "text";
        }
        if (elem.type === "image" || this._getElementKind(elem) === "artwork") {
            return "image";
        }
        return null;
    },

    /** @returns {"text"|"artwork"|"shape"|"curved"|null} */
    _getElementKind: function (elem) {
        if (!elem || elem.center_line || elem.extra_elem) {
            return null;
        }
        if (elem._curvedMeta?.isCurved) {
            return "curved";
        }
        if (["text", "i-text", "textbox"].includes(elem.type)) {
            return "text";
        }
        if (elem.type === "image") {
            return "artwork";
        }
        if (elem.type === "group") {
            if (elem.backend_id || elem.isVectorSvgGroup || elem.isEmbeddedPhotoSvg) {
                return "artwork";
            }
            if (this._groupLooksLikeVectorArtwork(elem)) {
                return "artwork";
            }
        }
        return "shape";
    },

    _groupLooksLikeVectorArtwork: function (group) {
        if (!group || group.type !== "group" || typeof group.getObjects !== "function") {
            return false;
        }
        const vectorTypes = new Set([
            "path", "polygon", "polyline", "circle", "rect", "ellipse", "line", "group",
        ]);
        const objects = group.getObjects();
        if (!objects.length) {
            return false;
        }
        const hasTracedPath = objects.some((o) =>
            ["path", "polyline", "polygon"].includes(o.type)
        );
        if (!hasTracedPath) {
            return false;
        }
        return objects.every(
            (o) => vectorTypes.has(o.type) && !["text", "i-text", "textbox", "image"].includes(o.type)
        );
    },

    _rehydrateArtworkGroupFlags: function (canvas) {
        if (!canvas) {
            return;
        }
        for (const obj of canvas.getObjects()) {
            if (
                obj.type === "group" &&
                !obj.isVectorSvgGroup &&
                !obj.isEmbeddedPhotoSvg &&
                this._groupLooksLikeVectorArtwork(obj)
            ) {
                obj.isVectorSvgGroup = true;
            }
        }
    },

    _getArtworkFilterTarget: function (elem) {
        if (this._getElementKind(elem) !== "artwork") {
            return null;
        }
        if (elem.type === "image") {
            return elem;
        }
        if (typeof elem.getObjects === "function") {
            return elem.getObjects().find((o) => o.type === "image") || null;
        }
        return null;
    },

    _getImageEffectTarget: function (elem) {
        elem = elem || this.currentElement;
        if (!elem) {
            return null;
        }
        if (elem.type === "image") {
            return elem;
        }
        return this._getArtworkFilterTarget(elem);
    },

    _usesVectorArtworkEffects: function (elem) {
        return (
            this._getElementKind(elem) === "artwork" &&
            elem?.type === "group" &&
            !this._getArtworkFilterTarget(elem)
        );
    },

    _getArtworkTone: function (group) {
        if (!group._tusArtworkTone) {
            group._tusArtworkTone = { brightness: 0, contrast: 0, saturation: 0, hue: 0 };
        }
        return group._tusArtworkTone;
    },

    _eachArtworkDrawable: function (obj, fn) {
        if (!obj || obj.center_line || obj.extra_elem || obj.tusFoilPreviewOverlay) {
            return;
        }
        if (obj.type === "group" && typeof obj.getObjects === "function") {
            for (const child of obj.getObjects()) {
                this._eachArtworkDrawable(child, fn);
            }
            return;
        }
        const drawableTypes = [
            "path", "polygon", "polyline", "circle", "rect", "ellipse", "line",
        ];
        if (drawableTypes.includes(obj.type)) {
            fn(obj);
        }
    },

    _ensureVectorArtworkToneBackup: function (group) {
        if (group._tusToneBackupReady) {
            return;
        }
        this._eachArtworkDrawable(group, (obj) => {
            if (obj._tusOriginalFill === undefined && obj.fill !== undefined) {
                obj._tusOriginalFill = obj.fill;
            }
            if (obj._tusOriginalStroke === undefined && obj.stroke !== undefined) {
                obj._tusOriginalStroke = obj.stroke;
            }
        });
        group._tusToneBackupReady = true;
    },

    _toneAdjustColor: function (colorStr, tone) {
        if (!colorStr || typeof colorStr !== "string") {
            return colorStr;
        }
        if (colorStr === "transparent" || colorStr === "none") {
            return colorStr;
        }
        try {
            let c = chroma(colorStr);
            const b = tone.brightness ?? 0;
            const ct = tone.contrast ?? 0;
            const s = tone.saturation ?? 0;
            const h = tone.hue ?? 0;
            if (b) {
                const lab = c.lab();
                c = chroma.lab(
                    Math.max(0, Math.min(100, lab[0] + b * 50)),
                    lab[1],
                    lab[2]
                );
            }
            if (ct) {
                c = c.set("lab.l", `*${1 + ct}`);
            }
            if (s) {
                c = c.saturate(s);
            }
            if (h) {
                c = c.set("hsl.h", `+${h * 360}`);
            }
            return c.hex();
        } catch (_e) {
            return colorStr;
        }
    },

    _applyVectorArtworkTone: function (group) {
        const tone = this._getArtworkTone(group);
        this._ensureVectorArtworkToneBackup(group);
        this._eachArtworkDrawable(group, (obj) => {
            if (obj._tusOriginalFill !== undefined) {
                const fill = this._toneAdjustColor(obj._tusOriginalFill, tone);
                if (fill) {
                    obj.set("fill", fill);
                }
            }
            if (obj._tusOriginalStroke !== undefined) {
                const stroke = this._toneAdjustColor(obj._tusOriginalStroke, tone);
                if (stroke) {
                    obj.set("stroke", stroke);
                }
            }
        });
        group.dirty = true;
        if (typeof group.addWithUpdate === "function") {
            group.addWithUpdate();
        } else {
            group.setCoords();
        }
    },

    _applyElementToneEffect: function (kind, value) {
        const elem = this.currentElement;
        if (!elem) {
            return false;
        }
        const imageTarget = this._getImageEffectTarget(elem);
        if (imageTarget) {
            this._ensureImageEffectFilters(imageTarget);
            const propMap = {
                brightness: "brightness",
                contrast: "contrast",
                saturation: "saturation",
                hue: "rotation",
            };
            const prop = propMap[kind];
            const filter = imageTarget.filters?.find((f) => f[prop] !== undefined);
            if (!filter) {
                return false;
            }
            filter[prop] = value;
            imageTarget.applyFilters();
            return true;
        }
        if (this._usesVectorArtworkEffects(elem)) {
            const tone = this._getArtworkTone(elem);
            tone[kind] = value;
            this._applyVectorArtworkTone(elem);
            return true;
        }
        return false;
    },

    _activateObjectToolPanel: function (panel) {
        if (!panel || panel === "duplicate" || panel === "remove") {
            return;
        }
        $(".tool").removeClass("active");
        $(".section_tools_options").removeClass("active");
        $(`.tool[data-panel="${panel}"]`).addClass("active");
        $(`.section_tool_${panel}`).addClass("active");
        if (panel === "color" || panel === "effects") {
            this._layoutColorPickers();
        }
        const section = this.el?.querySelector(`.section_tool_${panel}`);
        if (section) {
            section.offsetHeight;
        }
        if (typeof this._syncPanelHelpButton === "function") {
            this._syncPanelHelpButton();
        }
    },

    _getColorTargetFromElement: function (elem) {
        if (!elem) {
            return null;
        }
        const fill = elem.fill;
        if (fill && typeof fill === "string" && fill !== "transparent" && fill !== "none") {
            return elem;
        }
        if (typeof elem.getObjects === "function") {
            for (const child of elem.getObjects()) {
                const nested = this._getColorTargetFromElement(child);
                if (
                    nested?.fill &&
                    typeof nested.fill === "string" &&
                    nested.fill !== "transparent" &&
                    nested.fill !== "none"
                ) {
                    return nested;
                }
            }
        }
        return elem;
    },

    _setupArtworkObjectToolbar: function (elem) {
        $(".image_options").removeClass("d-none");
        $(".text_options").addClass("d-none");
        $(".curved_text_tool").addClass("d-none");
        $(".color-tool").toggleClass("d-none", this._isPhotoArtworkLayer(elem));
        if (elem.type !== "image" && !this._isPhotoArtworkLayer(elem)) {
            const colorTarget = this._getColorTargetFromElement(elem);
            if (colorTarget?.fill) {
                $(".color-tool .color-icon").css("background-color", colorTarget.fill);
            }
        }
        this._syncArtworkToolbarTools(elem);
        this._activateObjectToolPanel("effects");
        this._syncArtworkEffectControls(elem);
    },

    _ensureImageEffectFilters: function (target) {
        if (!target || target.type !== "image") {
            return;
        }
        if (!target.filters) {
            target.filters = [];
        }
        if (!target.filters.some((f) => f.brightness !== undefined)) {
            target.filters.push(
                new fabric.Image.filters.Brightness({ brightness: 0 }),
                new fabric.Image.filters.Contrast({ contrast: 0 }),
                new fabric.Image.filters.Saturation({ saturation: 0 }),
                new fabric.Image.filters.HueRotation({ rotation: 0 })
            );
            target.applyFilters();
        }
    },

    _syncArtworkEffectControls: function (elem) {
        const mapSym = (v) => ((v + 1) / 2) * 100;
        const imageTarget = this._getImageEffectTarget(elem);
        if (imageTarget?.filters) {
            this._ensureImageEffectFilters(imageTarget);
            const b = imageTarget.filters.find((f) => f.brightness !== undefined);
            const c = imageTarget.filters.find((f) => f.contrast !== undefined);
            const s = imageTarget.filters.find((f) => f.saturation !== undefined);
            const h = imageTarget.filters.find((f) => f.rotation !== undefined);
            if (b) {
                $(".elem_brightness").val(b.brightness);
                this._inputProgress($(".elem_brightness"), mapSym(b.brightness));
            }
            if (c) {
                $(".elem_contrast").val(c.contrast);
                this._inputProgress($(".elem_contrast"), mapSym(c.contrast));
            }
            if (s) {
                $(".elem_saturation").val(s.saturation);
                this._inputProgress($(".elem_saturation"), mapSym(s.saturation));
            }
            if (h) {
                $(".elem_huerotation").val(h.rotation);
                this._inputProgress($(".elem_huerotation"), h.rotation * 100);
            }
            return;
        }
        if (this._usesVectorArtworkEffects(elem)) {
            const tone = this._getArtworkTone(elem);
            $(".elem_brightness").val(tone.brightness);
            this._inputProgress($(".elem_brightness"), mapSym(tone.brightness));
            $(".elem_contrast").val(tone.contrast);
            this._inputProgress($(".elem_contrast"), mapSym(tone.contrast));
            $(".elem_saturation").val(tone.saturation);
            this._inputProgress($(".elem_saturation"), mapSym(tone.saturation));
            $(".elem_huerotation").val(tone.hue);
            this._inputProgress($(".elem_huerotation"), tone.hue * 100);
        }
    },

    _highlightSidebarOption: function (option, { showPanel = true } = {}) {
        if (!option) {
            return;
        }
        $(".fab_item").removeClass("active");
        $(".section_options").removeClass("active");
        $(`.sidebar_options .fab_item[data-option="${option}"]`).addClass("active");
        $(`.section_${option}`).addClass("active");
        if (showPanel) {
            $(".options_content").show();
        }
        if (typeof this._syncPanelHelpButton === "function") {
            this._syncPanelHelpButton();
        }
    },

    _restoreSidebarPanel: function () {
        this._highlightSidebarOption(this._activeSidebarOption, { showPanel: true });
    },

    _onChangeOption: function (ev) {
        ev.preventDefault();
        let option = $(ev.currentTarget).data("option");
        this._activeSidebarOption = option;
        $(".fab_item").removeClass("active");
        $(".section_options").removeClass("active");
        $(ev.currentTarget).addClass("active");
        $(`.section_${option}`).addClass("active");
        // Re-show the panel: _onCloseOptions sets inline display:none, so a
        // subsequent click on a sidebar icon must re-reveal it for the mobile
        // slide-up sheet to work. On desktop this is a no-op (already visible).
        $(".options_content").show();

        if (option === "clipart") {
            this._renderClipartCategories();
        }
        if (option === "textures") {
            this._syncTexturePanelUi?.(this.active_side);
        }
        if (typeof this._syncOptionsPanelTitle === "function") {
            this._syncOptionsPanelTitle();
        }
        $(".options_content").addClass("tus-panel-visible").css("display", "flex");
        if (typeof this._syncMobilePanelState === "function") {
            this._syncMobilePanelState();
        }
        if (typeof this._syncPanelHelpButton === "function") {
            this._syncPanelHelpButton();
        }
    },

    _onChangeToolOption: function (ev) {
        ev.preventDefault();
        const panel = $(ev.currentTarget).data("panel");
        if (panel === "duplicate") {
            this._activateObjectToolPanel("color");
        } else if (panel === "remove") {
            if (this.currentElement) {
                const canvas = this.currentElement.canvas || this.canvas;
                canvas.remove(this.currentElement);
                canvas.discardActiveObject();
                canvas.requestRenderAll();
            }
        } else {
            this._activateObjectToolPanel(panel);
        }
    },

    _CloseToolBar: function (ev) {
        $('.new_toolbar_container').addClass("d-none");
        $('.fabric_container').removeClass('tus-toolbar-open');
        const canvas = this.currentElement?.canvas || this.canvas;
        if (canvas) {
            canvas.discardActiveObject();
            canvas.requestRenderAll();
        }
    },

    _onAddDefaultImage: function (ev) {
        var self = this;
        if (
            $(ev.target).closest(
                ".upload-thumb-card__actions button, .delete-btn, .tus-remove-bg-thumb-btn"
            ).length
        ) {
            return;
        }
        var $item = $(ev.currentTarget).closest(".image-item");
        var imageId = $item.data("id");

        if (!imageId) {
            return;
        }
        ev.preventDefault();
        ev.stopPropagation();

        const $img = $item.find("img.default-canvas-img");
        const src = ($img.attr("src") || "").trim();

        self.startLoader("Adding Image...", { light: true });

        const loadSvgText = function () {
            if (src.startsWith("data:")) {
                const payload = src.split(",")[1] || "";
                if (!payload) {
                    return Promise.reject(new Error("Empty image data."));
                }
                try {
                    const decoded = atob(payload);
                    if (decoded.trim().startsWith("<")) {
                        return Promise.resolve(decoded);
                    }
                } catch (_) {
                    // fall through to fetch
                }
            }
            return fetch("/web/content/canvas.image/" + imageId + "/file")
                .then(function (response) {
                    if (!response.ok) {
                        throw new Error("Could not load image from library.");
                    }
                    return response.text();
                });
        };

        loadSvgText()
            .then(function (svgText) {
                const isPhoto = self._isEmbeddedPhotoSvgFromUpload(null, svgText);
                if (isPhoto) {
                    let dims =
                        self._parseEmbeddedImagePixelsFromSvg(svgText) ||
                        self._parseSvgRasterDimensions(svgText);
                    const dimPromise = dims
                        ? Promise.resolve(dims)
                        : src
                            ? self._readImageElementDimensions(src).catch(function () {
                                return null;
                            })
                            : Promise.resolve(null);
                    return dimPromise
                        .then(function (resolvedDims) {
                            if (!resolvedDims) {
                                return null;
                            }
                            return self
                                ._confirmLowDpiUploadIfNeeded(
                                    resolvedDims.width,
                                    resolvedDims.height,
                                    self.canvas,
                                    null
                                )
                                .then(function () {
                                    return resolvedDims;
                                });
                        })
                        .then(function (resolvedDims) {
                            return self._loadSvgGroupOnCanvas(svgText, {
                                backendId: imageId,
                                targetCanvas: self.canvas,
                                isEmbeddedPhotoSvg: true,
                                sourceWidth: resolvedDims?.width,
                                sourceHeight: resolvedDims?.height,
                                filePixels: resolvedDims,
                            });
                        })
                        .catch(function (err) {
                            if (err && (err.dpiCancelled || err.message === "dpi_cancelled")) {
                                return Promise.reject(err);
                            }
                            throw err;
                        });
                }
                return self._loadSvgGroupOnCanvas(svgText, {
                    backendId: imageId,
                    targetCanvas: self.canvas,
                    isEmbeddedPhotoSvg: false,
                });
            })
            .catch(function (err) {
                if (err && (err.dpiCancelled || err.message === "dpi_cancelled")) {
                    return;
                }
                console.error("Failed to add library image:", err);
                self.notification.add(
                    err.message || _t("Could not add image from library."),
                    { type: "danger" }
                );
            })
            .finally(function () {
                self.removeLoader();
            });
    },

    _onDeleteImage: async function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        const self = this;
        const $item = $(ev.currentTarget).closest(".image-item");
        const imageId = $item.data("id");
        this.rpc("/delete/image", { canvas_image: imageId }).then(function (res) {
            if (res.success) {
                $item.remove();
                self._syncUploadLibraryEmptyState();
            } else {
                self.notification.add(
                    _t("Failed to delete image: ") + (res.error || "Unknown error"),
                    { type: "danger" }
                );
            }
        });
    },

    _onAddImage: function (ev) {
        var self = this;
        if (!this.canvas) {
            this.notification.add(_t("Canvas is not ready. Please reload the designer."), { type: "danger" });
            return;
        }
        var files = ev.target.files;
        if (!files || !files.length) {
            return;
        }

        this._activeSidebarOption = "image";
        this._highlightSidebarOption("image", { showPanel: true });
        this.startLoader("Adding Image...", { light: true });

        var pending = [];
        for (var i = 0; i < files.length; i++) {
            pending.push(
                self._processUploadedImageFile(files[i], self.canvas).catch(function (err) {
                    if (self._isShareReadOnlyError?.(err)) {
                        return;
                    }
                    if (err && (err.dpiCancelled || err.message === "dpi_cancelled")) {
                        return;
                    }
                    console.error("Upload failed:", err);
                    self.notification.add(
                        err.message || _t("Failed to upload image."),
                        { type: "danger" }
                    );
                })
            );
        }

        Promise.all(pending).finally(function () {
            self.removeLoader();
            ev.target.value = "";
        });
    },

    _onAddText: function (ev) {
        var self = this;
        if (!this.canvas) {
            this.notification.add(_t("Canvas is not ready. Please reload the designer."), { type: "danger" });
            return;
        }
        this._activeSidebarOption = "text";
        this._highlightSidebarOption("text", { showPanel: true });
        this.startLoader("Adding Text...", { light: true });
        const textarea = $(ev.currentTarget).siblings("textarea");
        const textValue = textarea.val().trim();

        if (!textValue) {
            this.removeLoader();
            this.notification.add(_t("Please enter text before adding."), { type: 'danger' });
            return;
        }

        const itext = this._createDefaultCanvasText(this.canvas, textValue);
        this._clampObjectToDesignArea(this.canvas, itext);

        this.canvas.add(itext);
        this.elem_index += 1;
        this.canvas.setActiveObject(itext);
        this.canvas.requestRenderAll();
        this._showObjectToolbar(itext);

        textarea.val(""); // clear input after adding
        this.removeLoader();
    },


    _onEditText: function (ev) {
        var self = this;
        const textarea = $(ev.currentTarget);
        const newText = textarea.val();

        let activeObj = self.canvas.getActiveObject();

        if (activeObj && activeObj.type === "i-text") {
            activeObj.text = newText || "";   // allow empty string
            self.canvas.renderAll();
        }
    },

    /**
     * Show the object property toolbar (color, effects, transform, …).
     * Called from Fabric selection handlers and after programmatic setActiveObject.
     */
    _showObjectToolbar: function (elem) {
        if (!elem) {
            return;
        }
        this._onElementSelected(elem);
    },

    _onElementSelected: function (elem) {
        this._suppressLayoutSyncUntil = Date.now() + 300;
        this.currentElement = elem;
        this._updateColorPickers(elem);
        //        $(".toolbar_container").children().not(".left_tool").addClass("d-none");
        $(".new_toolbar_container").removeClass("d-none");
        $('.fabric_container').addClass('tus-toolbar-open');
        const sidebarOption = this._sidebarOptionFromElement(elem);
        if (sidebarOption) {
            this._activeSidebarOption = sidebarOption;
            // Keep the main tool panel visible alongside the object editor column
            this._highlightSidebarOption(sidebarOption, { showPanel: true });
            $(".options_content").addClass("tus-panel-visible");
        }
        this._layoutColorPickers();
        if (elem.locked) {
            $(".right_tool").addClass("d-none");
        } else {
            $(".right_tool").removeClass("d-none");
        }
        if (["text", "i-text"].includes(elem.type)) {
            $(".text_options").removeClass("d-none")
            $(".image_options").addClass("d-none")
            $(".curved_text_tool").removeClass("d-none")
            $(".color-tool").removeClass("d-none")
            $(".tool").removeClass("active");
            $(".section_tools_options").removeClass("active");
            $('.color-tool').addClass("active");
            $('.section_tool_color').addClass("active");
            if (!elem.locked) {
                $(".font_family_selector").removeClass("d-none");
                $(".font_picker").removeClass("d-none");
                $(".font-styles").removeClass("d-none");
            }
            $(".font_input").val(elem.fontSize);

            if (elem.fill) {
                $(".color-tool .color-icon").css("background-color", elem.fill);
            }
            if (elem.fontWeight == "bold") {
                $(".font-bold").addClass("active");
            }
            else {
                $(".font-bold").removeClass("active");
            }
            if (elem.fontWeight == "italic") {
                $(".font-italic").addClass("active");
            }
            else {
                $(".font-italic").removeClass("active");
            }
            if (elem.underline) {
                $(".font-underline").addClass("active");
            }
            else {
                $(".font-underline").removeClass("active");
            }
            if (elem.linethrough) {
                $(".font-cut").addClass("active");
            }
            else {
                $(".font-cut").removeClass("active");
            }

            let text_align = elem.textAlign;
            $(".font-align").empty();
            $(".font-align").append(`<i class="fa fa-align-${text_align} m-auto"></i>`);

            $(".line-height").val(elem.lineHeight);
            $(".letter-spacing").val(elem.charSpacing / 1000);
            $(".space-text").val(elem.charSpacing / 1000);
            $(".height-text").val(elem.lineHeight);
            $(".elem_stroke").val(elem.strokeWidth);
            if (elem.shadow) {
                $(".shadow_x").val(elem.shadow.offsetX);
                $(".shadow_y").val(elem.shadow.offsetY);
                $(".shadow_blur").val(elem.shadow.blur);
                this._inputProgress($(".shadow_x_progress"), elem.shadow.offsetX);
                this._inputProgress($(".shadow_y_progress"), elem.shadow.offsetX);
                this._inputProgress($(".blur_progress"), elem.shadow.offsetX);
            }
            this._inputProgress($(".elem_stroke_progress"), elem.strokeWidth);

            this._inputProgress(
                $(".letter-spacing"),
                ((elem.charSpacing / 1000 + 0.2) / 1.7) * 100
            );
            this._inputProgress($(".line-height"), (elem.lineHeight / 3) * 100);
            $("select.font_family").val(elem.fontFamily).trigger("change");
            this._syncVdpUiFromSelection?.(elem);
        }
        else if (this._getElementKind(elem) === "artwork") {
            this._setupArtworkObjectToolbar(elem);
            this._syncVdpUiFromSelection?.(null);
        }
        else {
            if (elem.fill) {
                $(".color-tool .color-icon").css("background-color", elem.fill);
            }
            $(".image_options").addClass("d-none")
            $(".text_options").addClass("d-none")
            $(".curved_text_tool").removeClass("d-none")
            $(".color-tool").removeClass("d-none")
            this._activateObjectToolPanel("color");
        }

        $(".elem_rotate").val(elem.angle);
        $(".rotate-text").val(elem.angle);

        this._inputProgress($(".elem_rotate"), (elem.angle / 360) * 100);

        if (elem.flipX) {
            $(".flipx").addClass("active");
        } else {
            $(".flipx").removeClass("active");
        }
        if (elem.flipY) {
            $(".flipy").addClass("active");
        } else {
            $(".flipy").removeClass("active");
        }
        if (elem.strokeWidth) {
            $(".elem_border").val(elem.strokeWidth);
            $(".border-text").val(elem.strokeWidth);
            this._inputProgress($(".elem_border"), (elem.strokeWidth / 50) * 100);
        } else {
            $(".elem_border").val(0);
            $(".border-text").val(0);
            this._inputProgress($(".elem_border"), 0);
        }
        if (elem.stroke) {
            $("#borderColorPicker").val(elem.stroke);
        } else {
            $("#borderColorPicker").val("#fff");
        }
        if (elem.strokeDashArray) {
            $(".solid").removeClass("active");
            $(".dashed").addClass("active");
        } else {
            $(".solid").addClass("active");
            $(".dashed").removeClass("active");
        }
        if (elem.locked) {
            $(".elem_lock").find(".fa-lock").removeClass("d-none");
            $(".elem_lock").find(".fa-unlock").addClass("d-none");
        } else {
            $(".elem_lock").find(".fa-unlock").removeClass("d-none");
            $(".elem_lock").find(".fa-lock").addClass("d-none");
        }
        if (elem.visible) {
            $(".elem_visibility").find(".fa-eye").addClass("d-none");
            $(".elem_visibility").find(".fa-eye-slash").removeClass("d-none");
        } else {
            $(".elem_visibility").find(".fa-eye").removeClass("d-none");
            $(".elem_visibility").find(".fa-eye-slash").addClass("d-none");
        }
        $(".elem_opacity").val(elem.opacity * 100);
        $(".opacity-text").val(elem.opacity * 100);
        this._inputProgress($(".elem_opacity"), elem.opacity * 100);
        if (this._getElementKind(elem) === "artwork") {
            this._syncArtworkToolbarTools(elem);
        } else {
            $(".vectorize-tool").addClass("d-none");
        }
        if (this._isFinishToolEnabled?.()) {
            $(".finish-tool").removeClass("d-none");
            this._syncFinishPanelFromObject?.(elem);
        } else {
            $(".finish-tool").addClass("d-none");
        }
        $(".toolbar").css("transform", "translateY(0%)");
        requestAnimationFrame(() => {
            const panel = $(".tool.active").data("panel");
            if (panel) {
                this._activateObjectToolPanel(panel);
            }
        });
        if (typeof this._syncMobilePanelState === "function") {
            this._syncMobilePanelState();
        }
    },

    /**
     * vanilla-colorful uses :host { display:flex; height:200px }. Forcing display:block
     * in CSS collapses the saturation square — only the hue strip remains visible.
     */
    _layoutColorPickers: function () {
        const apply = () => {
            this.el.querySelectorAll("hex-color-picker").forEach((picker) => {
                picker.style.setProperty("display", "flex");
                picker.style.setProperty("flex-direction", "column");
                picker.style.setProperty("width", "100%");
                picker.style.setProperty("height", "200px");
                picker.style.setProperty("min-height", "200px");
                picker.style.setProperty("box-sizing", "border-box");
            });
        };
        apply();
        requestAnimationFrame(apply);
    },

    _updateColorPickers: function (element) {
        if (!element) return;
        const colorTarget = this._getColorTargetFromElement(element) || element;
        const textColorPicker = document.getElementById('colorPicker');
        const textColorInput = document.getElementById('colorInput');
        if (textColorPicker && colorTarget.fill) {
            textColorPicker.color = colorTarget.fill;
            if (textColorInput) textColorInput.value = colorTarget.fill;
        }

        // Update stroke color picker
        const strokeColorPicker = document.getElementById('strokeColorPicker');
        const strokeColorInput = document.getElementById('strokeColorInput');
        if (strokeColorPicker && element.stroke) {
            strokeColorPicker.color = element.stroke;
            if (strokeColorInput) strokeColorInput.value = element.stroke;
        }

        const shadowColorPicker = document.getElementById('shadowColorPicker');
        const shadowColorInput = document.getElementById('shadowColorInput');

        if (element.shadow) {
            let shadowColor = '#000000';

            // Extract color from shadow (different approaches based on shadow format)
            if (typeof element.shadow === 'object' && element.shadow.color) {
                shadowColor = element.shadow.color;
            } else if (typeof element.shadow === 'string') {
                // Parse color from shadow string (e.g., "5px 5px 10px #000000")
                const colorMatch = element.shadow.match(/#[0-9A-Fa-f]{6}/);
                if (colorMatch) {
                    shadowColor = colorMatch[0];
                }
            }

            if (shadowColorPicker) shadowColorPicker.color = shadowColor;
            if (shadowColorInput) shadowColorInput.value = shadowColor;
        }
    },

    _onElementMultiSelected: function (_elems) {
        // Multi-select toolbar not implemented; selection events still fire for layers sync.
    },

    _onElemSelectRemove: function () {
        this.currentElement = null;
        // Block ResizeObserver → restructureCanvas while sidebar/toolbar layout settles
        this._suppressLayoutSyncUntil = Date.now() + 450;
        this._skipLayersRefreshOnce = true;
        $(".toolbar").find(".collapse").removeClass("show");
        $(".toolbar").css("transform", "translateY(-400%)");
        $(".new_toolbar_container").addClass("d-none");
        $(".vectorize-tool").addClass("d-none");
        $(".finish-tool").addClass("d-none");
        $(".fabric_container").removeClass("tus-toolbar-open");
        this.$(".vdp_text_tool").addClass("d-none");
        this._syncVdpUiFromSelection?.(null);
        this._restoreSidebarPanel();
    },

    _onColorPick: function (ev) {
        var self = this;
        if (this.currentElement) {
            this.startLoader("Updating Canvas...");

            // accept both event and direct color strings
            const color = (typeof ev === "string")
                ? ev
                : ($(ev.currentTarget).val?.() || ev?.target?.value || "#000");

            // Apply fill to single objects or groups
            this._applyFillDeep(this.currentElement, color);

            this.canvas.renderAll();
            this.saveState();
            $(".color-tool .color-icon").css("background-color", color);
        }
    },

    _onSelectFontSize: function (ev) {
        $(ev.currentTarget)
            .parents("#font_dropdown")
            .siblings(".font_input")
            .val($(ev.currentTarget).data("font"));
        $(".dropdown-menu").hide();
        $(".font_input").change();
    },

    _onFontChange: function (ev) {
        if (this.currentElement) {
            this.startLoader("Updating Canvas...");
            let target = $(ev.currentTarget);
            let fontSize = parseInt(target.val()) < 1 ? 1 : parseInt(target.val());
            if (fontSize < 2) {
                target.val(1);
            }
            $('.font_text').val(target.val())
            $('.font-progress').val(target.val())
            let percent = ((target.val() + 0.2) / 1.7) * 100;
            this._inputProgress($('.font-progress'), percent);
            this.currentElement.set("fontSize", fontSize);
            this.canvas.renderAll();
            this.saveState();
        }
    },

    _onFontIncrease: function (ev) {
        $(".font_input").val(parseInt($(".font_input").val()) + 1);
        $(".font_input").change();
    },

    _onFontDecrease: function (ev) {
        if (parseInt($(".font_input").val()) > 1) {
            $(".font_input").val(parseInt($(".font_input").val()) - 1);
            $(".font_input").change();
        }
    },

    _onDuplicateElement: function (ev) {
        var self = this;
        if (this.currentElement) {
            this.startLoader("Duplicating...");
            this.currentElement.clone(function (clonedObj) {
                clonedObj.set({
                    left: self.currentElement.left + 20,
                    top: self.currentElement.top + 20,
                    centeredRotation: true,
                    centeredScaling: true,
                });
                self.canvas.add(clonedObj);
                self.canvas.setActiveObject(clonedObj);
                self.canvas.renderAll();
            });
        }
    },

    _onFontOptionChange: function (ev) {
        if (this.currentElement) {
            this.startLoader("Updating Canvas...");
            if ($(ev.currentTarget).hasClass("active")) {
                $(ev.currentTarget).removeClass("active");
                const value = ["fontWeight", "fontStyle"].includes(
                    $(ev.currentTarget).data("option")
                )
                    ? "normal"
                    : false;
                this.currentElement.set($(ev.currentTarget).data("option"), value);
            } else {
                $(ev.currentTarget).addClass("active");
                const value = ["fontWeight", "fontStyle"].includes(
                    $(ev.currentTarget).data("option")
                )
                    ? $(ev.currentTarget).data("value")
                    : true;
                this.currentElement.set($(ev.currentTarget).data("option"), value);
            }
            this.canvas.renderAll();
            this.saveState();
        }
    },

    _onSetFontAlign: function (ev) {
        if (this.currentElement) {
            this.fontPopover.popover("toggle");
            $(".font-popover").find("i").removeClass("active");
            $(".font-popover")
                .find(`.fa-align-${this.currentElement.textAlign}`)
                .addClass("active");
        }
    },

    _changeFontAlignment: function (align) {
        if (this.currentElement) {
            this.startLoader("Updating Canvas...");
            this.currentElement.set("textAlign", align);
            this.canvas.renderAll();
            this.saveState();
            $(".font-align").empty();
            $(".font-align").append(`<i class="fa fa-align-${align} m-auto"></i>`);
            this.fontPopover.popover("hide");
        }
    },

    _onChangeLineHeight: function (ev) {
        if (this.currentElement) {
            this.startLoader("Updating Canvas...");
            const value = parseFloat($(ev.currentTarget).val());
            $(".height-text").val(value);
            let percent = (value / 3) * 100;
            this._inputProgress($(ev.currentTarget), percent);
            this.currentElement.set("lineHeight", value);
            this.canvas.renderAll();
        }
    },

    _onTextChangeLineHeight: function (ev) {
        if (this.currentElement) {
            this.startLoader("Updating Canvas...");
            let value = $(ev.currentTarget).val()
                ? parseFloat($(ev.currentTarget).val())
                : 0;
            if (value < 0) {
                value = 0;
            }
            if (value > 3) {
                value = 3;
            }
            $(ev.currentTarget).val(value);
            let percent = (value / 3) * 100;
            $(".line-height").val(value);
            this.currentElement.set("lineHeight", value);
            this.canvas.renderAll();
            this._inputProgress($(".line-height"), percent);
        }
    },

    _inputProgress: function ($target, value) {
        $target.css({
            background: `linear-gradient(to right, #000 0%, #000 ${value}%, #fff ${value}%, white 100%)`,
        });
    },

    _onLetterSpace: function (ev) {
        if (this.currentElement) {
            this.startLoader("Updating Canvas...");
            const value = parseFloat($(ev.currentTarget).val());
            $(".space-text").val(value);
            let percent = ((value + 0.2) / 1.7) * 100;
            this.currentElement.set("charSpacing", value * 1000);
            this.canvas.renderAll();
            this._inputProgress($(ev.currentTarget), percent);
        }
    },

    _onTextLetterSpace: function (ev) {
        if (this.currentElement) {
            this.startLoader("Updating Canvas...");
            let value = $(ev.currentTarget).val()
                ? parseFloat($(ev.currentTarget).val())
                : 0;
            if (value < -0.2) {
                value = -0.2;
            }
            if (value > 1.5) {
                value = 1.5;
            }
            $(ev.currentTarget).val(value);
            let percent = ((value + 0.2) / 1.7) * 100;
            $(".letter-spacing").val(value);
            this.currentElement.set("charSpacing", value * 1000);
            this.canvas.renderAll();
            this._inputProgress($(".letter-spacing"), percent);
        }
    },

    _onChangeOpacity: function (ev) {
        if (this.currentElement) {
            this.startLoader("Updating Canvas...");
            const value = parseFloat($(ev.currentTarget).val());
            $(".opacity-text").val(value);
            this._inputProgress($(ev.currentTarget), value);
            this.currentElement.set("opacity", value / 100);
            this.canvas.renderAll();
        }
    },

    _onChangeShadow: function (ev) {
        if (this.currentElement) {
            this.startLoader("Updating Canvas...");

            const input = $(ev.currentTarget);

            // Get all shadow values
            let offsetX = parseFloat($(".shadow_x").val()) || 0;
            let offsetY = parseFloat($(".shadow_y").val()) || 0;
            let blur = parseFloat($(".shadow_blur").val()) || 0;
            let color = $("#shadowColorInput").val() || "#000000";

            // Update the specific value that changed
            if (input.hasClass("shadow_x")) {
                offsetX = parseFloat(input.val()) || 0;
                // Sync both number and range inputs
                $(".shadow_x").val(offsetX);
            } else if (input.hasClass("shadow_y")) {
                offsetY = parseFloat(input.val()) || 0;
                // Sync both number and range inputs
                $(".shadow_y").val(offsetY);
            } else if (input.hasClass("shadow_blur")) {
                blur = parseFloat(input.val()) || 0;
                // Sync both number and range inputs
                $(".shadow_blur").val(blur);
            }

            // Apply shadow to the current element
            const shadow = `${offsetX}px ${offsetY}px ${blur}px ${color}`;

            // For text elements
            if (this.currentElement.type === 'text' || this.currentElement.type === 'i-text') {
                this.currentElement.set({
                    shadow: {
                        color: color,
                        blur: blur,
                        offsetX: offsetX,
                        offsetY: offsetY
                    }
                });
            }
            this.canvas.renderAll();
            this.saveState();
        }
    },

    _onChangeTextBend: function (ev) {
        const active = this.canvas.getActiveObject();
        if (!active) return;

        const raw = parseFloat(ev.currentTarget.value);
        if (!Number.isFinite(raw)) return;

        const amount = raw; // signed radius in px
        const EPS = 0.0001;

        if (Math.abs(amount) < EPS) {
            // Return to straight text if currently curved
            if (active?._curvedMeta?.isCurved) {
                const absCenter = active.getCenterPoint();
                const angle = active.angle || 0;
                const scaleX = active.scaleX || 1;
                const scaleY = active.scaleY || 1;

                const props = this._extractTextCommonProps(active);
                const itext = new fabric.IText(active._curvedMeta.rawText || "", props);
                // Preserve letter spacing from curved tracking (tracking px -> Fabric charSpacing ≈ px * 10)
                itext.set("charSpacing", Math.round((active._curvedMeta?.tracking || 0) * 10));

                this._replaceObject(active, itext);
                // Restore absolute center and transforms
                itext.set({
                    angle,
                    scaleX,
                    scaleY,
                });
                itext.setPositionByOrigin(absCenter, "center", "center");
                itext.setCoords();
                this.canvas.requestRenderAll();
            }
            return;
        }

        let target = active;
        if (!active._curvedMeta?.isCurved) {
            if (!(active.type === "i-text" || active.type === "text")) return;
            // Convert straight text to curved and preserve absolute center inside
            target = this._createCurvedFromText(active, Math.abs(amount), amount < 0);
        } else {
            // Already curved: rebuild with new radius/direction, preserving absolute center inside
            this._rebuildCurvedGroup(active, Math.abs(amount), amount < 0);
        }

        this.canvas.requestRenderAll();
        // saveState will be triggered on 'change' of the range to avoid history spam
    },

    _createCurvedFromText: function (textObj, radius, reverse) {
        const props = this._extractTextCommonProps(textObj);
        const rawText = textObj.text || "";

        // Preserve absolute center and transforms from the original text
        const absCenter = textObj.getCenterPoint();
        const angle = textObj.angle || 0;
        const scaleX = textObj.scaleX || 1;
        const scaleY = textObj.scaleY || 1;

        const group = new fabric.Group([], {
            left: absCenter.x,
            top: absCenter.y,
            originX: "center",
            originY: "center",
            angle,
            scaleX,
            scaleY,
            selectable: true,
            hasControls: true,
            centeredRotation: true,
            centeredScaling: true,
        });

        group._curvedMeta = {
            isCurved: true,
            rawText,
            baseProps: props,
            radius: Math.max(1, radius),
            reverse: !!reverse,
            // tracking in pixels between glyphs; approximate from Fabric's charSpacing (1/1000 em)
            tracking: (textObj.charSpacing || 0) / 10,
        };

        // Insert group at the same z-order as original, then remove original
        const index = this.canvas.getObjects().indexOf(textObj);
        this.canvas.remove(textObj);
        this.canvas.insertAt(group, Math.max(0, index), true);

        // Build characters and restore absolute center after layout
        this._rebuildCurvedGroup(group, group._curvedMeta.radius, group._curvedMeta.reverse);
        group.setPositionByOrigin(absCenter, "center", "center");
        group.setCoords();

        this.canvas.setActiveObject(group);
        return group;
    },

    _rebuildCurvedGroup: function (group, radius, reverse) {
        if (!group?._curvedMeta?.isCurved) return;
        const meta = group._curvedMeta;

        // Preserve absolute center and transforms before changing children/bounds
        const absCenter = group.getCenterPoint();
        const prevAngle = group.angle || 0;
        const prevScaleX = group.scaleX || 1;
        const prevScaleY = group.scaleY || 1;

        meta.radius = Math.max(1, radius);
        meta.reverse = !!reverse;

        // Remove previous chars
        const toRemove = group.getObjects().slice();
        toRemove.forEach((o) => group.remove(o));

        const text = meta.rawText;
        const props = meta.baseProps;
        const cx = 0, cy = 0;

        const chars = [];
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            const t = new fabric.Text(ch, {
                fontFamily: props.fontFamily,
                fontSize: props.fontSize,
                fontWeight: props.fontWeight,
                fontStyle: props.fontStyle,
                fill: props.fill,
                stroke: props.stroke,
                strokeWidth: props.strokeWidth,
                opacity: props.opacity,
                originX: "center",
                originY: "baseline",
                selectable: false,
                evented: false,
            });
            chars.push(t);
        }

        // widths in px, add tracking (px) between glyphs
        const widths = chars.map((t) => (t.width || (props.fontSize * 0.6)) + meta.tracking);
        const arc = widths.reduce((a, b) => a + b, 0) / meta.radius;
        const dir = meta.reverse ? -1 : 1;
        let theta = -arc / 2;

        for (let i = 0; i < chars.length; i++) {
            const t = chars[i];
            const w = widths[i] / meta.radius;
            const mid = theta + w / 2;

            const x = cx + dir * meta.radius * Math.sin(mid);
            const y = cy - dir * meta.radius * Math.cos(mid);
            const angleDeg = (mid * 180) / Math.PI * dir;

            t.set({ left: x, top: y, angle: angleDeg });
            group.addWithUpdate(t);
            theta += w;
        }

        group._calcBounds();
        group.set({
            angle: prevAngle,
            scaleX: prevScaleX,
            scaleY: prevScaleY,
        });
        group.setPositionByOrigin(absCenter, "center", "center");
        group.setCoords();
    },

    _extractTextCommonProps: function (obj) {
        const center = obj.getCenterPoint ? obj.getCenterPoint() : { x: obj.left, y: obj.top };
        return {
            left: center.x,
            top: center.y,
            originX: "center",
            originY: "center",
            angle: obj.angle || 0,
            fill: obj.fill || "#000",
            opacity: obj.opacity ?? 1,
            stroke: obj.stroke || null,
            strokeWidth: obj.strokeWidth || 0,
            fontFamily: obj.fontFamily || "Arial",
            fontSize: obj.fontSize || 32,
            fontWeight: obj.fontWeight || "normal",
            fontStyle: obj.fontStyle || "normal",
            underline: obj.underline || false,
            textAlign: obj.textAlign || "left",
            shadow: obj.shadow || null,
        };
    },

    _replaceObject: function (oldObj, newObj) {
        const index = this.canvas.getObjects().indexOf(oldObj);
        const wasActive = this.canvas.getActiveObject() === oldObj;
        this.canvas.remove(oldObj);
        this.canvas.insertAt(newObj, Math.max(0, index), true);
        newObj.setCoords();
        if (wasActive) this.canvas.setActiveObject(newObj);
        this.canvas.requestRenderAll();
    },

    _onBendLetterSpacing: function (ev) {
        const active = this.canvas.getActiveObject();
        if (!active) return;
        const val = parseFloat(ev.currentTarget.value); // pixels between glyphs
        if (!Number.isFinite(val)) return;

        if (active._curvedMeta?.isCurved) {
            // Update tracking and rebuild while preserving absolute center inside rebuild
            active._curvedMeta.tracking = val;
            this._rebuildCurvedGroup(active, active._curvedMeta.radius, active._curvedMeta.reverse);
            this.canvas.requestRenderAll();
            return;
        }

        // Straight text
        if (active.type === "i-text" || active.type === "text") {
            active.set("charSpacing", Math.round(val * 10));
            active.setCoords();
            this.canvas.requestRenderAll();
        }
    },

    _onChangeStroke: function (ev) {
        if (this.currentElement) {
            this.startLoader("Updating Canvas...");

            const input = $(ev.currentTarget);

            let strength = parseFloat($(".elem_stroke").val()) || 0;
            let color = $(".stroke_color_picker_input").val?.() || $("#strokeColorInput").val?.() || "#000000";

            if (input.hasClass("elem_stroke")) {
                // user changed number/range
                strength = parseFloat(input.val()) || 0;
                // sync both number and range inputs
                $(".elem_stroke").val(strength);
            }

            // Apply to single objects or groups
            this._applyStrokeDeep(this.currentElement, color, strength);

            this.canvas.renderAll();
            this.saveState();
        }
    },

    _onTextChangeOpacity: function (ev) {
        if (this.currentElement) {
            this.startLoader("Updating Canvas...");
            let value = $(ev.currentTarget).val()
                ? parseFloat($(ev.currentTarget).val())
                : 0;
            if (value < 0) {
                value = 0;
            }
            if (value > 100) {
                value = 100;
            }
            $(ev.currentTarget).val(value);
            $(".elem_opacity").val(value);
            this._inputProgress($(".elem_opacity"), value);
            this.currentElement.set("opacity", value / 100);
            this.canvas.renderAll();
        }
    },

    _onRotateElem: function (ev) {
        if (this.currentElement) {
            this.startLoader("Updating Canvas...");
            const value = parseFloat($(ev.currentTarget).val());
            $(".rotate-text").val(value);
            this._inputProgress($(ev.currentTarget), (value / 360) * 100);
            this.currentElement.set("angle", value);
            this.canvas.renderAll();
        }
    },

    _onTextonRotateElem: function (ev) {
        if (this.currentElement) {
            this.startLoader("Updating Canvas...");
            let value = $(ev.currentTarget).val()
                ? parseFloat($(ev.currentTarget).val())
                : 0;
            if (value < 0) {
                value = 0;
            }
            if (value > 360) {
                value = 360;
            }
            $(ev.currentTarget).val(value);
            $(".elem_rotate").val(value);
            this._inputProgress($(".elem_rotate"), (value / 360) * 100);
            this.currentElement.set("angle", value);
            this.canvas.renderAll();
        }
    },

    _onFlipElemX: function (ev) {
        if (this.currentElement) {
            this.startLoader("Updating Canvas...");
            if (this.currentElement.flipX) {
                $(ev.currentTarget).removeClass("active");
            } else {
                $(ev.currentTarget).addClass("active");
            }
            this.currentElement.set("flipX", !this.currentElement.flipX);
            this.canvas.renderAll();
            this.saveState();
        }
    },

    _onFlipElemY: function (ev) {
        if (this.currentElement) {
            this.startLoader("Updating Canvas...");
            if (this.currentElement.flipY) {
                $(ev.currentTarget).removeClass("active");
            } else {
                $(ev.currentTarget).addClass("active");
            }
            this.currentElement.set("flipY", !this.currentElement.flipY);
            this.canvas.renderAll();
            this.saveState();
        }
    },

    _onChangeFontFamily: function (ev) {
        if (this.currentElement) {
            var self = this;
            this.startLoader("Updating Canvas...");
            if ($(ev.currentTarget).val()) {
                WebFont.load({
                    google: {
                        families: [$(ev.currentTarget).val()], // Replace 'Roboto' with any Google Font name you need
                    },
                    active: function () {
                        self.currentElement.set(
                            "fontFamily",
                            $(ev.currentTarget).val()
                        );
                        self.canvas.renderAll();
                        self.saveState();
                    },
                });
            }
        }
    },

    _onReplaceImg: function (ev) {
        var self = this;
        var file = ev.target.files[0];
        var reader = new FileReader();
        this.startLoader("Updating Canvas...");
        reader.onload = function (e) {
            const imageData = e.target.result;
            if (self.currentElement) {
                self.currentElement.setSrc(imageData, function () {
                    self.canvas.renderAll();
                    self.saveState();
                });
            }
        };
        reader.readAsDataURL(file);
    },


    _onBrightnessChange: function (ev) {
        if (!this.currentElement) {
            return;
        }
        const value = parseFloat($(ev.currentTarget).val());
        this._inputProgress($(ev.currentTarget), ((value + 1) / 2) * 100);
        if (this._applyElementToneEffect("brightness", value)) {
            this.canvas?.requestRenderAll();
        }
    },

    _onContrastChange: function (ev) {
        if (!this.currentElement) {
            return;
        }
        const value = parseFloat($(ev.currentTarget).val());
        this._inputProgress($(ev.currentTarget), ((value + 1) / 2) * 100);
        if (this._applyElementToneEffect("contrast", value)) {
            this.canvas?.requestRenderAll();
        }
    },

    _onSaturation: function (ev) {
        if (!this.currentElement) {
            return;
        }
        const value = parseFloat($(ev.currentTarget).val());
        this._inputProgress($(ev.currentTarget), ((value + 1) / 2) * 100);
        if (this._applyElementToneEffect("saturation", value)) {
            this.canvas?.requestRenderAll();
        }
    },

    _onHueRotation: function (ev) {
        if (!this.currentElement) {
            return;
        }
        const value = parseFloat($(ev.currentTarget).val());
        this._inputProgress($(ev.currentTarget), value * 100);
        if (this._applyElementToneEffect("hue", value)) {
            this.canvas?.requestRenderAll();
        }
    },

    _onChangeBorderWidth: function (ev) {
        if (this.currentElement) {
            this.startLoader("Updating Canvas...");
            const value = parseFloat($(ev.currentTarget).val());
            $(".border-text").val(value);
            this._inputProgress($(ev.currentTarget), (value / 50) * 100);
            this.currentElement.set("strokeWidth", value);
            this.canvas.renderAll();
        }
    },

    _onTextChangeBorderWidth: function (ev) {
        if (this.currentElement) {
            this.startLoader("Updating Canvas...");
            let value = $(ev.currentTarget).val()
                ? parseFloat($(ev.currentTarget).val())
                : 0;
            if (value < 0) {
                value = 0;
            }
            if (value > 50) {
                value = 50;
            }
            $(ev.currentTarget).val(value);
            $(".elem_border").val(value);
            this._inputProgress($(".elem_border"), (value / 50) * 100);
            this.currentElement.set("strokeWidth", value);
            this.canvas.renderAll();
        }
    },

    _onChangeStrokeColor: function (ev) {
        if (this.currentElement) {
            this.startLoader("Updating Canvas...");

            // Support both event and direct color usage
            const color = (typeof ev === "string")
                ? ev
                : ($(ev.currentTarget).val?.() || ev?.target?.value || "#000");

            const width = parseFloat($(".elem_stroke").val?.() || $("#borderWidthInput").val?.() || 0) || 0;

            // Apply to single objects or groups
            this._applyStrokeDeep(this.currentElement, color, width);

            this.canvas.renderAll();
            this.saveState();
        }
    },

    _borderType: function (ev) {
        if (this.currentElement) {
            this.startLoader("Updating Canvas...");
            $(".border_type").removeClass("active");
            if (this.currentElement.strokeDashArray) {
                $(".solid").addClass("active");
                this.currentElement.set("strokeDashArray", null);
            } else {
                $(".dashed").addClass("active");
                this.currentElement.set("strokeDashArray", [5, 5]);
            }
            this.canvas.renderAll();
            this.saveState();
        }
    },

    _onRemoveElement: function (ev) {
        ev.stopPropagation();
        if (!this.currentElement) {
            return;
        }
        const canvas = this.currentElement.canvas || this.canvas;
        canvas.remove(this.currentElement);
        canvas.discardActiveObject();
        canvas.requestRenderAll();
    },

    _onLockElement: function (ev) {
        if (this.currentElement.locked) {
            this.startLoader("Unlocking...");
            $(ev.currentTarget).find(".fa-unlock").removeClass("d-none");
            $(ev.currentTarget).find(".fa-lock").addClass("d-none");
        } else {
            this.startLoader("Locking...");
            $(ev.currentTarget).find(".fa-lock").removeClass("d-none");
            $(ev.currentTarget).find(".fa-unlock").addClass("d-none");
        }
        this.currentElement.locked = !this.currentElement.locked;
        this.currentElement.hasControls = !this.currentElement.hasControls;
        this.currentElement.lockRotation = !this.currentElement.lockRotation;
        this.currentElement.lockMovementX = !this.currentElement.lockMovementX;
        this.currentElement.lockMovementY = !this.currentElement.lockMovementY;
        this.currentElement.editable = !this.currentElement.editable;
        if (this.currentElement.locked) {
            this.canvas.discardActiveObject();
            this.canvas.renderAll();
        } else {
            this.canvas.setActiveObject(this.currentElement);
            this.canvas.renderAll();
        }
        this.saveState();
    },

    _onVisibilityElement: function (ev) {
        if (this.currentElement.visible) {
            $(ev.currentTarget).find(".fa-eye").removeClass("d-none");
            $(ev.currentTarget).find(".fa-eye-slash").addClass("d-none");
        } else {
            $(ev.currentTarget).find(".fa-eye-slash").removeClass("d-none");
            $(ev.currentTarget).find(".fa-eye").addClass("d-none");
        }
        this.currentElement.visible = !this.currentElement.visible;
        this.canvas.renderAll();
        this.saveState();
    },

    _onAddShape: function (ev) {
        var self = this;
        this.startLoader("Updating Canvas...");

        let path =
            "/tus_product_personalizer/static/src/data/img/" +
            $(ev.currentTarget).data("shape") +
            ".svg";

        fabric.loadSVGFromURL(path, async function (objects, options) {
            var obj = fabric.util.groupSVGElements(objects, options);

            // --- Get canvas center ---
            const center = self.canvas.getCenter();

            // --- Set object at the exact center ---
            obj.set({
                left: center.left,
                top: center.top,
                id: self.elem_index,
                originX: "center",
                originY: "center",
            });

            self.elem_index += 1;

            self.canvas.add(obj);
            self.canvas.setActiveObject(obj);
            self.canvas.renderAll();

            self.saveState();
        });
    },

    _onBuyNow: async function (ev) {
        if (this._isShareCollaborator?.()) {
            return;
        }
        ev.preventDefault();
        const $btn = $(ev.currentTarget);
        const originalBtnHtml = $btn.html();

        const items = [];
        const cartLines = [];
        let totalQty = 0;

        this.$items.find('.cart-item').each((i, el) => {
            const $el = $(el);
            const qtyAttr = parseInt($el.find('.qty-value').text() || 1, 10);
            const qty = Math.max(1, isNaN(qtyAttr) ? 1 : qtyAttr);
            totalQty += qty;
            let basePrice = parseFloat($el.attr('data-price') || 0);
            const designPrice = parseFloat($el.attr('data-design-price') || 0);
            const texturePrice = parseFloat($el.attr('data-texture-price') || 0);
            const pureBase = parseFloat($('.designer-price').attr('data-base-price'))
                || parseFloat($('.designer-price').data('base-price'))
                || 0;
            if (pureBase > 0 && designPrice > 0 && Math.abs(basePrice - pureBase - designPrice) < 0.02) {
                basePrice = pureBase;
            }
            cartLines.push({
                $el,
                productId: parseInt($el.attr('data-id'), 10),
                basePrice,
                designPrice,
                texturePrice,
                qty,
            });
        });

        if (!cartLines.length) {
            this.notification.add(_t("Cart is empty."), { type: 'danger' });
            return;
        }

        // Add Button Loader early so the long-running collection shows progress
        $btn.html('<i class="fa fa-spinner fa-spin me-2"></i> Redirecting...').prop('disabled', true);

        const currentProductId = parseInt($('input[name="product_id"]').val(), 10) || 0;
        const uniqueCartProducts = new Set(cartLines.map((line) => line.productId));
        const vdpCartLines = cartLines.filter(({ $el }) => Boolean($el.attr("data-vdp")));
        const hasVdpInCart = vdpCartLines.length > 0;
        let vdpCheckoutActive = false;

        if (hasVdpInCart) {
            this._beginVdpCheckoutUi(_t("Preparing your order…"));
            vdpCheckoutActive = true;
        }

        // Original buy-now flow: refresh live canvas export for imprint snapshots.
        let freshDesign = null;

        const printingPerUnit = this._getPrintingUnitCostForQty(totalQty);
        let vdpLineIndex = 0;
        const vdpUploadContexts = new Map();
        const multiColorCart = this._cartHasMultipleColors?.(cartLines);

        try {
            try {
                freshDesign = await this._runCanvasExportBatch(() =>
                    this._collectDesignData({ includeElementImages: true })
                );
            } catch (err) {
                console.warn("Failed to refresh design data for Buy Now:", err);
            }

            let designBundle = null;
            try {
                designBundle = await this._collectAllDesignStates([]);
            } catch (err) {
                console.warn("Failed to collect design bundle for Buy Now:", err);
            }

            for (const { $el, productId, basePrice, designPrice, texturePrice, qty } of cartLines) {
                const finishPrice = this._calculateFinishPrice ? this._calculateFinishPrice() : 0;
                const totalPrice = basePrice + designPrice + texturePrice + finishPrice + printingPerUnit;

                let design = [];
                const designAttr = $el.attr("data-design");
                if (designAttr) {
                    try {
                        design = JSON.parse(designAttr) || [];
                    } catch (e) {
                        console.warn("Failed to parse data-design for product", productId, e);
                    }
                }
                if (freshDesign?.length) {
                    design = this._mergeBuyNowDesignForLine($el, productId, design, freshDesign, {
                        currentProductId,
                        uniqueProductCount: uniqueCartProducts.size,
                        multiColorCart,
                    });
                }

                let vdpPayload = null;
                let lineQty = qty;
                const lineColorId = $el.attr("data-color-id") || null;
                const lineVdpMeta = this._parseVdpCartMeta($el);
                const lineVdpRecords = lineVdpMeta?.records || [];
                if (lineVdpRecords.length) {
                    try {
                        vdpLineIndex += 1;
                        if (!this._validateVdp(lineVdpRecords)) {
                            return;
                        }
                        vdpPayload = this._buildVdpMetadataForLine(lineVdpRecords, design, {
                            omitMaster: true,
                        });
                        if (!vdpPayload) {
                            return;
                        }
                        vdpUploadContexts.set(this._vdpContextKey(productId, lineColorId), {
                            records: lineVdpRecords,
                            masterDesign: design,
                            mockupUrls: lineVdpMeta?.mockup_urls || null,
                            productId,
                            colorId: parseInt(lineColorId, 10) || null,
                        });
                        lineQty = lineVdpRecords.length;
                    } catch (err) {
                        this.notification.add(err.message || _t("VDP export failed."), { type: "danger" });
                        return;
                    }
                }

                items.push({
                    product_id: productId,
                    base_price: basePrice,
                    design_price: designPrice,
                    texture_price: texturePrice,
                    finish_price: this._calculateFinishPrice ? this._calculateFinishPrice() : 0,
                    finish_objects: this._getFinishObjectsPayload ? this._getFinishObjectsPayload() : [],
                    texture_by_side: this._getTexturePayloadForCart?.() || {},
                    price: totalPrice,
                    qty: lineQty,
                    design: vdpPayload ? [] : (design || []),
                    design_bundle: designBundle,
                    printing_method_id: this.selectedPrintingMethod ? this.selectedPrintingMethod.id : null,
                    vdp: vdpPayload,
                    color_id: lineColorId,
                    empty_canvas: this._getEmptyCanvasMeta?.(),
                });
            }

            const result = await rpc('/shop/buy/now', { items: items });
            if (result?.error) {
                console.error('Buy Now failed:', result.error);
                alert(result.error);
                return;
            }
            if (result?.vdp_upload?.length) {
                this._updateVdpCheckoutUi(_t("Uploading personalized designs…"), "");
                await this._uploadPendingVdpDesigns(result.vdp_upload, vdpUploadContexts);
            }
            if (result && result.redirect_url) {
                window.location.href = result.redirect_url;
            }
        } catch (err) {
            console.error('Error during Buy Now:', err);
        } finally {
            if (vdpCheckoutActive) {
                this._endVdpCheckoutUi();
            }
            $btn.html(originalBtnHtml).prop('disabled', false);
        }
    },

    _onIncreaseQty: function (ev) {
        let $item = $(ev.currentTarget).closest('.cart-item');
        let $qtyVal = $item.find('.qty-value');
        let newQty = parseInt($qtyVal.text()) + 1;
        $qtyVal.text(newQty);
        $item.data('qty', newQty);
        this._updateTotals();
    },

    _onDecreaseQty: function (ev) {
        let $item = $(ev.currentTarget).closest('.cart-item');
        let $qtyVal = $item.find('.qty-value');
        let currentQty = parseInt($qtyVal.text());
        if (currentQty > 1) {
            let newQty = currentQty - 1;
            $qtyVal.text(newQty);
            $item.data('qty', newQty);
        } else {
            $item.remove();
        }
        this._updateTotals();
    },

    _updateTotals: function () {
        let totalQty = 0;
        let productTotal = 0;
        let designTotal = 0;
        let textureTotal = 0;

        this.$items.find('.cart-item').each(function () {
            // Use .data() first as it contains the updated value from qty buttons
            let qty = $(this).data('qty') || parseInt($(this).attr('data-qty')) || 0;
            let productPrice = $(this).data('price') || parseFloat($(this).attr('data-price')) || 0;
            let dPrice = $(this).data('design-price') || parseFloat($(this).attr('data-design-price')) || 0;
            let tPrice = $(this).data('texture-price') || parseFloat($(this).attr('data-texture-price')) || 0;

            totalQty += qty;
            productTotal += qty * productPrice;
            designTotal += qty * dPrice;
            textureTotal += qty * tPrice;
        });

        const printingTotal = this._getPrintingUnitCostForQty(totalQty) * totalQty;

        const grandTotal = productTotal + designTotal + textureTotal + printingTotal;

        this.$totalQty.text(`Total Quantity (${totalQty})`);

        const symbol = this._getCurrencySymbol();

        const showDesignPrice = $('input[name="show_design_price"]').val() === '1';
        const showTexture = $('input[name="show_texture"]').val() === '1';
        const $itemsRow = this.$sidebar.find('.items-total-row');
        const $designRow = this.$sidebar.find('.design-total-row');
        const $textureRow = this.$sidebar.find('.texture-total-row');
        const $printingRow = this.$sidebar.find('.printing-row');

        if (showDesignPrice) {
            if (this.$itemsTotalPrice && this.$itemsTotalPrice.length) this.$itemsTotalPrice.text(`${symbol}${productTotal.toFixed(2)}`);
            if (this.$designTotalPrice && this.$designTotalPrice.length) this.$designTotalPrice.text(`${symbol}${designTotal.toFixed(2)}`);
            $itemsRow.removeClass('d-none');
            $designRow.removeClass('d-none');
        } else {
            $itemsRow.addClass('d-none');
            $designRow.addClass('d-none');
        }

        if (showTexture && textureTotal > 0) {
            $textureRow.find('.texture-total-price').text(`${symbol}${textureTotal.toFixed(2)}`);
            $textureRow.removeClass('d-none');
        } else {
            $textureRow.addClass('d-none');
        }

        if (this.selectedPrintingMethod && printingTotal > 0) {
            $printingRow.find('.printing-label').text(`Printing (${this.selectedPrintingMethod.name}):`);
            $printingRow.find('.printing-total-price').text(`${symbol}${printingTotal.toFixed(2)}`);
            $printingRow.removeClass('d-none');
        } else {
            $printingRow.addClass('d-none');
        }

        const $sidebarPriceVal = this.$totalPrice.find('.oe_currency_value');
        if ($sidebarPriceVal.length) {
            $sidebarPriceVal.text(grandTotal.toFixed(2));
        } else {
            this.$totalPrice.html(`${symbol}${grandTotal.toFixed(2)}`);
        }
    },

    _onCloseCart: function () {
        this.$sidebar.removeClass('open');
        $('.fabric_container').removeClass('tus-cart-open');
    },
    _onSaveCanvas: async function (ev) {
        // Save ALL sides and ALL design areas so the user can continue exactly later
        var self = this;
        this.startLoader("Saving Design (all sides)...");
        this.ui.block()
        try {
            // Collect states from all sides (each side will be made visible during collection)
            const cleanupTasks = [];
            const snapshot = await this._collectAllDesignStates(cleanupTasks);

            // Export preview image of the active side
            let dataUrl = await self._exportSideComposite(this.active_side, { format: "png", quality: 1 });

            // Restore extra elements
            cleanupTasks.forEach((fn) => {
                try { fn(); } catch (_e) { }
            });

            // Persist in one payload; backend can store as a single "design" per user
            const name = `Design_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
            const productId = parseInt($('input[name="product_id"]').val());
            await this.rpc("/custom/design/save", {
                name,
                uploaded_type: "bundle",
                product_id: productId,
                uploaded_attachment: JSON.stringify(snapshot),
                view_image: dataUrl,
            });

        } catch (e) {
            console.error("Save all sides failed:", e);
        } finally {
            this.removeLoader();
            this.ui.unblock()
            location.reload()
        }
    },

    _onSelectTemplate: async function (ev) {
        const $target = $(ev.currentTarget);
        const mode = $target.data("mode");
        if (mode === "Product") {
            await this._onSelectProductTemplate(ev);
            return;
        }
        if (mode == "Contact") {
            let template_id = $target.data("design_id");
            this.startLoader("Loading Saved Design...");
            try {
                const text = await this.http.get(
                    `/web/image/res.partner.design/${template_id}/uploaded_attachment`,
                    "text"
                );
                // New: try to parse multi-side, multi-area bundle
                try {
                    const bundle = JSON.parse(text);
                    if (bundle && (Array.isArray(bundle.sides) || bundle.bundleVersion)) {
                        await this._restoreDesignBundle(bundle, { fitToFullArea: true });
                        this.removeLoader();
                        return;
                    }
                } catch (_e) {
                    // Not JSON → fallback to legacy SVG
                }
                // Legacy single-SVG fallback
                await this.loadSvg(text);
            } finally {
                this.removeLoader();
            }
        }
    },

    _collectAllDesignStates: async function (cleanupTasks = []) {
        const bundle = {
            bundleVersion: 1,
            finish_settings: serializeGlobalFinishSettings(this._3dPreviewSettings),
            product_tmpl_id: parseInt($('input[name="product_tmpl_id"]').val() || "0"),
            product_id: parseInt($('input[name="product_id"]').val() || "0", 10),
            color_id: null,
            savedAt: new Date().toISOString(),
            lastSession: {
                active_side: this.active_side,
                active_area_id: this.active_area_id,
            },
            areasDefinition: {
                front: this.frontAreasData || [],
                back: this.backAreasData || [],
                left: this.leftAreasData || [],
                right: this.rightAreasData || [],
            },
            sides: [],
        };

        const self = this;
        const prevSide = this.active_side;
        const prevAreaId = this.active_area_id;

        const collectForSide = async (side) => {
            const entries = (self.canvasesBySide[side] || []);
            if (!entries.length) {
                return [];
            }

            const serializeEntries = () => {
                const records = [];
                for (let areaIdx = 0; areaIdx < entries.length; areaIdx++) {
                    const entry = entries[areaIdx];
                    const fab = entry.canvas;
                    if (!fab) continue;

                    const extras = fab.getObjects().filter(
                        (o) => o.extra_elem || o.tusFoilPreviewOverlay
                    );
                    if (extras.length) {
                        extras.forEach((o) => fab.remove(o));
                        cleanupTasks.push(() => extras.forEach((o) => fab.add(o)));
                    }
                    const hiddenForFoil = fab.getObjects().filter((o) => o._tusFoilHiddenForPreview);
                    if (hiddenForFoil.length) {
                        hiddenForFoil.forEach((o) =>
                            o.set({ opacity: o._tusFoilOpacityBackup ?? 1 })
                        );
                        cleanupTasks.push(() =>
                            hiddenForFoil.forEach((o) => o.set({ opacity: 0 }))
                        );
                    }

                    fab.discardActiveObject();
                    fab.requestRenderAll();

                    const fabricJSON = fab.toJSON([
                        "id", "locked", "title", "extra_elem", "_curvedMeta",
                        "tusFinishEffect", "tusReliefMm", "tusVarnishType", "tusFoilMetal",
                        "tusTextureIntensityMm", "tusTextureActive",
                        "tusVarnishCoverMode", "tusVarnishAreaFile", "tusVarnishAreaFileName",
                        "tusVarnishZonesDescription",
                        "backend_id", "isVectorSvgGroup", "isEmbeddedPhotoSvg",
                        "tusArtworkTone",
                    ]);

                    records.push({
                        area_id: entry.id,
                        area_index: areaIdx,
                        json: fabricJSON,
                        w: fab.getWidth(),
                        h: fab.getHeight(),
                    });
                }
                return records;
            };

            return await self._withMeasurableSide(side, async () => {
                await self._waitForSideMeasurable(side);
                self._setVisibleCanvasSide(side);
                self.restructureCanvas({ preserveSelection: true });
                await new Promise(requestAnimationFrame);
                await new Promise(requestAnimationFrame);
                return serializeEntries();
            });
        };

        try {
            for (const side of ["front", "back", "left", "right"]) {
                const sideData = await collectForSide(side);
                if (sideData.length && self._sideHasUserArtwork(side)) {
                    bundle.sides.push({ side, areas: sideData });
                }
            }
        } finally {
            if (prevSide) {
                self._setVisibleCanvasSide(prevSide);
                await self._setActiveArea(prevSide, prevAreaId);
                self.restructureCanvas({ preserveSelection: true });
            }
        }

        if (this.showMatrixTable && this._getActiveColorId) {
            const activeColorId = this._getActiveColorId();
            if (activeColorId) {
                bundle.color_id = activeColorId;
            }
        }
        const emptyMeta = this._getEmptyCanvasMeta?.();
        if (emptyMeta) {
            bundle.empty_canvas = emptyMeta;
        }
        const texturePayload = this._getTextureBundlePayload?.();
        if (texturePayload && Object.keys(texturePayload).length) {
            bundle.texture_by_side = texturePayload;
        }
        return bundle;
    },

    /**
     * Printing cost per cart unit: unit cost + setup spread across total qty (once per order).
     */
    _getPrintingUnitCostForQty: function (totalQty) {
        if (!this.selectedPrintingMethod || totalQty <= 0) {
            return 0;
        }
        const setupCost = parseFloat(this.selectedPrintingMethod.setup_cost || 0);
        const unitCost = parseFloat(this.selectedPrintingMethod.unit_cost || 0);
        return unitCost + setupCost / totalQty;
    },

    _getCurrencySymbol: function () {
        const fromSidebar = this.$totalPrice && this.$totalPrice.data('currency');
        if (fromSidebar) {
            return fromSidebar;
        }
        const $designerPrice = $('.designer-price .tus-footer-currency, .designer-price .ms-1');
        if ($designerPrice.length) {
            return $designerPrice.first().text().trim();
        }
        return '';
    },

    _calculateDesignPrice: function () {
        const $input = $('input[name="show_design_price"]');
        const showDesignPrice = $input.val() === '1';

        if (!showDesignPrice) return 0;

        let totalDesignPrice = 0;
        for (const side in this.canvasesBySide) {
            this.canvasesBySide[side].forEach(view => {
                const objects = view.canvas.getObjects().filter(obj => !obj.center_line && !obj.tusTextureLayer);
                if (objects.length > 0) {
                    const areaPrice = parseFloat(view.price || 0);
                    if (!isNaN(areaPrice)) {
                        totalDesignPrice += areaPrice;
                    }
                }
            });
        }
        return totalDesignPrice;
    },

    _getActiveDesignAreasInfo: function () {
        const info = [];
        for (const side in this.canvasesBySide) {
            this.canvasesBySide[side].forEach(view => {
                const objects = view.canvas.getObjects().filter(obj => !obj.center_line && !obj.tusTextureLayer);
                if (objects.length > 0) {
                    info.push({
                        name: view.name || "Area",
                        product_id: view.product_id,
                        price: parseFloat(view.price || 0)
                    });
                }
            });
        }
        return info;
    },

    _updateDesignerPriceDisplay: function () {
        const designPrice = this._calculateDesignPrice();
        const texturePrice = this._calculateTexturePrice ? this._calculateTexturePrice() : 0;
        const finishPrice = this._calculateFinishPrice ? this._calculateFinishPrice() : 0;
        const $priceEl = $('.designer-price');
        const basePrice = parseFloat($priceEl.attr('data-base-price')) || parseFloat($priceEl.data('base-price')) || 0;

        let printingCost = 0;
        if (this.selectedPrintingMethod) {
            const setupCost = parseFloat(this.selectedPrintingMethod.setup_cost || 0);
            const unitCost = parseFloat(this.selectedPrintingMethod.unit_cost || 0);
            printingCost = setupCost + unitCost;
        }

        const totalPrice = basePrice + designPrice + texturePrice + finishPrice + printingCost;

        // Update top header display
        const $headerVal = $priceEl.find('.oe_currency_value');
        if ($headerVal.length) {
            $headerVal.text(totalPrice.toFixed(2));
        }

        // Update sidebar summary if visible
        const symbol = this._getCurrencySymbol();
        if (this.$itemsTotalPrice && this.$itemsTotalPrice.length) this.$itemsTotalPrice.text(`${symbol}${basePrice.toFixed(2)}`);
        if (this.$designTotalPrice && this.$designTotalPrice.length) this.$designTotalPrice.text(`${symbol}${designPrice.toFixed(2)}`);
        const $textureTotalPrice = this.$sidebar?.find('.texture-total-price');
        if ($textureTotalPrice?.length) {
            $textureTotalPrice.text(`${symbol}${texturePrice.toFixed(2)}`);
        }
        const $textureRow = this.$sidebar?.find('.texture-total-row');
        if ($textureRow?.length) {
            $textureRow.toggleClass('d-none', !(this.showTexture && texturePrice > 0));
        }
        const $finishTotalPrice = this.$sidebar?.find('.finish-total-price');
        if ($finishTotalPrice?.length) {
            $finishTotalPrice.text(`${symbol}${finishPrice.toFixed(2)}`);
        }
        const $finishRow = this.$sidebar?.find('.finish-total-row');
        if ($finishRow?.length) {
            $finishRow.toggleClass('d-none', !(finishPrice > 0));
        }
        if (this.$totalPrice && this.$totalPrice.length) {
            const $sidebarPriceVal = this.$totalPrice.find('.oe_currency_value');
            if ($sidebarPriceVal.length) {
                $sidebarPriceVal.text(totalPrice.toFixed(2));
            } else {
                this.$totalPrice.html(`${symbol}${totalPrice.toFixed(2)}`);
            }
        }

        if (typeof this._refreshFooterPricePopover === "function") {
            this._refreshFooterPricePopover();
        }
    },

    _switchToVariant: async function (variantId, options = {}) {
        if (this.emptyCanvasMode) {
            const { updateUI = false } = options;
            if (updateUI) {
                $('.variant-swap').removeClass('selected-variant');
                $(`.variant-swap[data-variant_id="${variantId}"]`).addClass('selected-variant');
            }
            try {
                const result = await this.rpc("/get_product_data", {
                    product_id: parseInt(variantId, 10),
                });
                if (result) {
                    const $addBtn = $(".add-to-custom-cart");
                    $addBtn.attr("data-variant-id", variantId);
                    $addBtn.attr("data-product-name", result.display_name);
                    $addBtn.attr("data-price", result.final_price);
                    $addBtn.attr("data-image", result.image_1920 || "");
                    const $priceEl = $(".designer-price");
                    $priceEl.attr("data-base-price", result.final_price);
                    $priceEl.data("base-price", result.final_price);
                    this._updateDesignerPriceDisplay?.();
                    $('input[name="product_id"]').val(variantId);
                    const $badge = $('.tus-topbar-brand .tus-product-badge-name');
                    if ($badge.length && result.display_name) {
                        $badge.text(result.display_name);
                        $badge.attr('title', result.display_name);
                    }
                }
            } catch (error) {
                console.error("Failed to switch empty-canvas variant:", error);
            }
            return;
        }

        // Shared method to switch to a specific product variant
        // options: { updateUI: boolean, loaderMessage: string }
        const { updateUI = false, loaderMessage = "Loading Variant..." } = options;

        const $variantElement = $(`.variant-swap[data-variant_id="${variantId}"]`);
        if (!$variantElement.length) {
            console.warn(`Variant ${variantId} not found in variant selector`);
            return;
        }

        // Update UI selection if requested
        if (updateUI) {
            $('.variant-swap').removeClass('selected-variant');
            $variantElement.addClass('selected-variant');
        }

        this.startLoader(loaderMessage, { scope: "canvas" });
        clearTimeout(this._resizeTimeout);

        try {
            const result = await this.rpc("/get_product_data", {
                product_id: parseInt(variantId),
            });

            if (result) {
                let productName = result.display_name;
                let productPrice = result.list_price;
                let finalPrice = result.final_price;
                let currency = result.currency;
                let previewImg = result.image_1920 || null;

                // Update side images and tab thumbnails
                const views = result.product_thumbnail_views || [];
                if (views.length) {
                    views.forEach(function (view) {
                        const side = view.title;

                        // Update main canvas background image
                        let canvasImg = document.getElementById(`${side}_canvas`)?.querySelector("img");
                        if (canvasImg && view.thumbnails_image) {
                            canvasImg.src = view.thumbnails_image;
                        }

                        // Update tab thumbnail
                        let tabThumb = document.querySelector(`button[data-side="${side}"] img.canvas-thumb`);
                        if (tabThumb && view.thumbnails_image) {
                            tabThumb.src = view.thumbnails_image;
                        }
                    });

                    // Wait for images to load and canvas to be restructured
                    await new Promise(resolve => {
                        this._resizeTimeout = setTimeout(() => {
                            this.restructureCanvas();
                            resolve();
                        }, 300);
                    });
                }

                // Update product info and cart button
                let $addBtn = $(".add-to-custom-cart");
                $addBtn.attr("data-variant-id", variantId);
                $addBtn.attr("data-product-name", productName);
                $addBtn.attr("data-price", finalPrice);
                $addBtn.attr("data-image", previewImg);

                // Premium topbar: keep the product name badge in sync with the
                // selected variant so users always see what they're customising.
                if (productName) {
                    const $badge = $('.tus-topbar-brand .tus-product-badge-name');
                    if ($badge.length) {
                        $badge.text(productName);
                        $badge.attr('title', productName);
                    }
                    // Also update document title so the browser tab reflects the variant.
                    if (typeof document !== 'undefined' && document.title) {
                        document.title = productName;
                    }
                }

                if (currency && this.$totalPrice && this.$totalPrice.length) {
                    this.$totalPrice.attr('data-currency', currency).data('currency', currency);
                }

                // Update base price and refresh display including design surcharges
                const $priceEl = $(".designer-price");
                $priceEl.attr("data-base-price", finalPrice);
                $priceEl.data("base-price", finalPrice); // Update jQuery data cache too
                this._updateDesignerPriceDisplay();

                // Update hidden input
                $('input[name="product_id"]').val(variantId);
            }
        } catch (error) {
            console.error("Failed to switch variant:", error);
        } finally {
            this.removeLoader();
        }
    },

    _restoreDesignBundle: async function (bundle, options = {}) {
        // Validate
        if (!bundle || !Array.isArray(bundle.sides)) return;

        const fitToFullArea = options.fitToFullArea !== false;

        // Matrix uses color views; normal flow uses product variant views.
        const showMatrix = $('input[name="show_matrix_table"]').val() === '1';
        if (bundle.product_id && !options.skipVariantSwitch && (!showMatrix || !bundle.color_id)) {
            const currentProductId = parseInt($('input[name="product_id"]').val(), 10);
            if (currentProductId !== bundle.product_id) {
                await this._switchToVariant(bundle.product_id, {
                    loaderMessage: "Switching to saved variant..."
                });
            } else if (!showMatrix) {
                this._syncVariantSelectionUi(bundle.product_id);
            }
        }

        // Optionally, verify areasDefinition ids against current product view
        // and try to match by id; if id not found, skip gracefully.
        // Load JSON into each corresponding Fabric canvas
        for (const sideEntry of bundle.sides) {
            const side = sideEntry.side;
            const list = this.canvasesBySide[side] || [];
            if (!list.length) continue;
            const sideAreasDef = (bundle.areasDefinition && bundle.areasDefinition[side]) || [];

            await this._withMeasurableSide(side, async () => {
                await this._waitForSideMeasurable(side);
                this._setVisibleCanvasSide(side);
                this.restructureCanvas({ preserveSelection: true });
                await new Promise(requestAnimationFrame);

                for (let areaIdx = 0; areaIdx < sideEntry.areas.length; areaIdx++) {
                    const areaSave = sideEntry.areas[areaIdx];
                    const entry = this._resolveCanvasEntryForAreaSave(
                        list, areaSave, sideAreasDef, areaIdx
                    );
                    if (!entry || !entry.canvas) continue;

                    const hasObjects = (areaSave.json?.objects || []).some(
                        (obj) => !obj.extra_elem
                            && !obj.center_line
                            && obj.custom?.kind !== "design_area"
                    );
                    if (!hasObjects) {
                        continue;
                    }

                    await new Promise((resolve) => {
                        try {
                            entry.canvas.loadFromJSON(areaSave.json, () => {
                                this._rehydrateArtworkGroupFlags(entry.canvas);
                                if (areaSave.w > 0 && areaSave.h > 0) {
                                    this._remapCanvasObjectsToSavedSize(
                                        entry.canvas,
                                        areaSave.w,
                                        areaSave.h
                                    );
                                } else if (fitToFullArea) {
                                    this._fitCanvasObjectsToFullArea(
                                        entry.canvas,
                                        null,
                                        null,
                                        "cover"
                                    );
                                }
                                this._tagTemplateLayers(entry.canvas);
                                entry.canvas.requestRenderAll();
                                resolve();
                            });
                        } catch (e) {
                            console.warn("Failed loading area JSON", side, areaSave.area_id, e);
                            resolve();
                        }
                    });
                }
            });
        }

        // Restore last session position if available
        const ls = bundle.lastSession || {};
        const targetSide = ls.active_side || (bundle.sides[0] && bundle.sides[0].side) || this.active_side || "front";
        const targetAreaId = ls.active_area_id || ((this.canvasesBySide[targetSide] || [])[0]?.id);

        // Switch UI to that side/area
        this._setVisibleCanvasSide(targetSide);

        this.active_side = targetSide;
        await this._setActiveArea(targetSide, targetAreaId);
        this._renderAreaSelectorForSide(targetSide, targetAreaId);

        this._updateDesignerPriceDisplay();

        if (this.canvas) {
            this.managelayers();
        }

        if (bundle.finish_settings) {
            this._3dPreviewSettings = {
                ...this._3dPreviewSettings,
                varnishType: bundle.finish_settings.varnishType || "none",
                reliefMm: bundle.finish_settings.reliefMm ?? DEFAULT_RELIEF_MM,
            };
            this._viewerControls?.setSettings(this._3dPreviewSettings);
        }

        if (bundle.empty_canvas?.background_by_side && this.emptyCanvasBgBySide) {
            Object.assign(this.emptyCanvasBgBySide, bundle.empty_canvas.background_by_side);
            for (const side of Object.keys(bundle.empty_canvas.background_by_side)) {
                this._applyEmptyCanvasBackground?.(side);
            }
        }

        if (bundle.empty_canvas?.margins_by_side && this.emptyCanvasMarginBySide) {
            Object.assign(this.emptyCanvasMarginBySide, bundle.empty_canvas.margins_by_side);
            for (const side of Object.keys(bundle.empty_canvas.margins_by_side)) {
                this.emptyCanvasMarginBySide[side] = this._clampEmptyCanvasMarginMm?.(
                    this.emptyCanvasMarginBySide[side],
                    side
                ) ?? 0;
            }
            this._syncEmptyCanvasMarginsHiddenInput?.();
            for (const side of Object.keys(bundle.empty_canvas.margins_by_side)) {
                this._applyEmptyCanvasMarginsForSide?.(side);
                this._syncEmptyCanvasFooterForSide?.(side);
            }
            this._syncEmptyCanvasChromeUi?.();
        }

        await this._restoreTexturesFromBundle?.(bundle);

        // Trigger a layout update
        this.restructureCanvas();
    },

    _onExitDesigner: async function (ev) {
        const product_tmpl_id = parseInt($('input[name="product_tmpl_id"]').val());
        window.location.href = `/shop/${product_tmpl_id}`;

    },

    _onDownloadCanvas: async function (ev) {
        const self = this;

        // Show format selection popup
        const selectedFormat = await this._showFormatSelectionPopup();
        if (!selectedFormat) return; // User canceled

        return this._runCanvasExportBatch(async () => {
            const sides = ['front', 'back', 'left', 'right'];
            let designedSides = [];

            // Collect all sides that have designs
            for (const side of sides) {
                if (!self.canvasesBySide[side]) continue;

                // Check if side has any design elements
                let hasDesign = false;
                for (const view of self.canvasesBySide[side]) {
                    const canvasObjects = view.canvas.getObjects();
                    if (canvasObjects && canvasObjects.length > 0) {
                        hasDesign = true;
                        break;
                    }
                }

                if (hasDesign) {
                    try {
                        // Export this side
                        const dataUrl = await self._exportSideDuringBatch(side, {
                            format: "png",
                            quality: 1,
                        });

                        if (dataUrl) {
                            designedSides.push({
                                side: side,
                                dataUrl: dataUrl
                            });
                        }
                    } catch (error) {
                        console.error(`Error exporting side '${side}':`, error);
                    }
                }
            }

            if (designedSides.length === 0) {
                this.notification.add(_t("No designs found to download. Please add designs to at least one side."), { type: 'danger' });
                return;
            }

            // Create a combined canvas
            const combinedCanvas = document.createElement('canvas');
            const ctx = combinedCanvas.getContext('2d');

            // Load all images first
            const images = await Promise.all(designedSides.map(sideData => {
                return new Promise((resolve, reject) => {
                    const img = new Image();
                    img.onload = () => resolve({ side: sideData.side, img: img });
                    img.onerror = reject;
                    img.src = sideData.dataUrl;
                });
            }));

            // Calculate layout dimensions
            const padding = 50; // Space between images
            const labelHeight = 40; // Space for side labels

            // Arrange images in a grid (2 columns max for better layout)
            const cols = Math.min(2, images.length);
            const rows = Math.ceil(images.length / cols);

            // Find the maximum dimensions
            const maxWidth = Math.max(...images.map(img => img.img.width));
            const maxHeight = Math.max(...images.map(img => img.img.height));

            // Set combined canvas size
            combinedCanvas.width = cols * maxWidth + (cols + 1) * padding;
            combinedCanvas.height = rows * (maxHeight + labelHeight) + (rows + 1) * padding;

            // Fill background with white
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, combinedCanvas.width, combinedCanvas.height);

            // Draw each image with label
            ctx.fillStyle = 'black';
            ctx.font = '20px Arial';
            ctx.textAlign = 'center';

            images.forEach((imgData, index) => {
                const col = index % cols;
                const row = Math.floor(index / cols);

                const x = padding + col * (maxWidth + padding);
                const y = padding + row * (maxHeight + labelHeight + padding);

                // Draw the label
                ctx.fillText(
                    imgData.side.toUpperCase(),
                    x + maxWidth / 2,
                    y + 25
                );

                // Draw the image (centered if smaller than maxWidth/maxHeight)
                const imgX = x + (maxWidth - imgData.img.width) / 2;
                const imgY = y + labelHeight + (maxHeight - imgData.img.height) / 2;

                ctx.drawImage(imgData.img, imgX, imgY);
            });

            // Get file extension and MIME type based on selected format
            const formatInfo = this._getFormatInfo(selectedFormat);

            // Convert to blob and download
            combinedCanvas.toBlob((blob) => {
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `all_designs_combined.${formatInfo.extension}`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);

            }, formatInfo.mimeType, formatInfo.quality);
        });
    },

    _showFormatSelectionPopup: function () {
        return new Promise((resolve) => {
            // Create popup HTML
            const popupHtml = `
                <div id="format-popup-overlay" style="
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.5);
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    z-index: 9999;
                ">
                    <div style="
                        background: white;
                        padding: 30px;
                        border-radius: 10px;
                        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
                        text-align: center;
                        min-width: 300px;
                    ">
                        <h3 style="margin-top: 0; color: #333;">Choose Download Format</h3>
                        <div style="margin: 20px 0;">
                            <button id="format-jpeg" style="
                                background: #007bff;
                                color: white;
                                border: none;
                                padding: 12px 25px;
                                margin: 5px;
                                border-radius: 5px;
                                cursor: pointer;
                                font-size: 14px;
                            ">JPEG (Smaller file)</button>
                            <button id="format-png" style="
                                background: #28a745;
                                color: white;
                                border: none;
                                padding: 12px 25px;
                                margin: 5px;
                                border-radius: 5px;
                                cursor: pointer;
                                font-size: 14px;
                            ">PNG (Better quality)</button>
                            <button id="format-webp" style="
                                background: #6f42c1;
                                color: white;
                                border: none;
                                padding: 12px 25px;
                                margin: 5px;
                                border-radius: 5px;
                                cursor: pointer;
                                font-size: 14px;
                            ">WebP (Modern format)</button>
                        </div>
                        <button id="format-cancel" style="
                            background: #dc3545;
                            color: white;
                            border: none;
                            padding: 10px 20px;
                            border-radius: 5px;
                            cursor: pointer;
                            font-size: 14px;
                        ">Cancel</button>
                    </div>
                </div>
            `;

            // Add popup to DOM
            document.body.insertAdjacentHTML('beforeend', popupHtml);

            const overlay = document.getElementById('format-popup-overlay');

            // Add click handlers
            document.getElementById('format-jpeg').onclick = () => {
                overlay.remove();
                resolve('jpeg');
            };

            document.getElementById('format-png').onclick = () => {
                overlay.remove();
                resolve('png');
            };

            document.getElementById('format-webp').onclick = () => {
                overlay.remove();
                resolve('webp');
            };

            document.getElementById('format-cancel').onclick = () => {
                overlay.remove();
                resolve(null);
            };

            // Close on overlay click
            overlay.onclick = (e) => {
                if (e.target === overlay) {
                    overlay.remove();
                    resolve(null);
                }
            };

            // Close on Escape key
            const escapeHandler = (e) => {
                if (e.key === 'Escape') {
                    overlay.remove();
                    document.removeEventListener('keydown', escapeHandler);
                    resolve(null);
                }
            };
            document.addEventListener('keydown', escapeHandler);
        });
    },

    _getFormatInfo: function (format) {
        const formats = {
            'jpeg': {
                extension: 'jpg',
                mimeType: 'image/jpeg',
                quality: 1
            },
            'png': {
                extension: 'png',
                mimeType: 'image/png',
                quality: 1.0
            },
            'webp': {
                extension: 'webp',
                mimeType: 'image/webp',
                quality: 1
            }
        };

        return formats[format] || formats['jpeg'];
    },

    _ensureImageLoaded: function (imgEl) {
        if (!imgEl) {
            return Promise.resolve();
        }
        const src = (imgEl.getAttribute("src") || imgEl.src || "").trim();
        if (!src) {
            return Promise.resolve();
        }
        if (imgEl.complete && imgEl.naturalWidth) {
            return Promise.resolve();
        }
        if (imgEl.complete && !imgEl.naturalWidth) {
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            const done = () => resolve();
            imgEl.addEventListener("load", done, { once: true });
            imgEl.addEventListener("error", done, { once: true });
        });
    },

    /**
     * Make a side measurable without switching visible tabs (no flicker).
     * Uses `tus-hidden-render` on inactive panes; matrix overlay masks
     * temporary `.main_wrapper` unhide.
     */
    _withMeasurableSide: async function (side, fn) {
        const targetRoot = document.getElementById(`${side}_canvas`);
        if (!targetRoot) return await fn();

        const activePane = document.querySelector(".editor_side.tab-pane.show.active");
        const isActive = activePane === targetRoot;

        const $mainWrapper = $(".fabric_container .editor_view > .main_wrapper");
        const wasWrapperHidden = $mainWrapper.hasClass("d-none");
        const needsHiddenRender = !isActive;
        const reflowNeeded = wasWrapperHidden || needsHiddenRender;

        if (wasWrapperHidden) {
            $mainWrapper.removeClass("d-none");
        }
        if (needsHiddenRender) {
            targetRoot.classList.add("tus-hidden-render");
        }

        try {
            if (reflowNeeded) {
                await new Promise(requestAnimationFrame);
                await new Promise(requestAnimationFrame);
            }
            return await fn();
        } finally {
            if (needsHiddenRender) {
                targetRoot.classList.remove("tus-hidden-render");
            }
            if (wasWrapperHidden) {
                $mainWrapper.addClass("d-none");
            }
        }
    },

    _waitForSideMeasurable: async function (side, { maxFrames = 30 } = {}) {
        const root = document.getElementById(`${side}_canvas`);
        if (!root) {
            return false;
        }
        if (this.emptyCanvasMode) {
            for (let i = 0; i < maxFrames; i++) {
                const box = root.querySelector(".image_preview_box.tus-empty-canvas-stage");
                const entry = (this.canvasesBySide[side] || [])[0];
                const canvas = entry?.canvas;
                if (box && canvas && canvas.getWidth() > 1 && canvas.getHeight() > 1) {
                    const rect = box.getBoundingClientRect();
                    if (rect.width >= 1 && rect.height >= 1) {
                        return true;
                    }
                }
                await new Promise(requestAnimationFrame);
            }
            return false;
        }
        const img = root.querySelector("img.main_canvas_img") || root.querySelector("img.thumbnail_img");
        if (!img) {
            return false;
        }
        await this._ensureImageLoaded(img);
        for (let i = 0; i < maxFrames; i++) {
            const rect = img.getBoundingClientRect();
            if (rect.width >= 1 && rect.height >= 1) {
                return true;
            }
            await new Promise(requestAnimationFrame);
        }
        return false;
    },

    _prepareSideForExport: async function (side) {
        const root = document.getElementById(`${side}_canvas`);
        if (!root) {
            return;
        }
        await this._waitForSideMeasurable(side);
        if (this.emptyCanvasMode) {
            const element = document.getElementById(`${side}_canvas`);
            if (element && typeof this._syncEmptyCanvasSide === "function") {
                this._syncEmptyCanvasSide(element, side, { preserveSelection: true });
            } else {
                this.restructureCanvas({ preserveSelection: true, onlySide: side });
            }
        } else {
            this.restructureCanvas({ preserveSelection: true });
        }
        await new Promise((resolve) => requestAnimationFrame(resolve));
        await new Promise((resolve) => requestAnimationFrame(resolve));
    },

    _showImagePreview: function (dataUrl) {
        // Remove existing preview if any
        const old = document.getElementById("designPreviewOverlay");
        if (old) old.remove();

        const overlay = document.createElement("div");
        overlay.id = "designPreviewOverlay";
        overlay.style.cssText = `
            position: fixed; inset: 0; background: rgba(0,0,0,0.6);
            display: flex; align-items: center; justify-content: center; z-index: 99999;
        `;

        const panel = document.createElement("div");
        panel.style.cssText = `
            background: #fff; border-radius: 8px; max-width: 92%; max-height: 92%;
            padding: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.3); display: flex; flex-direction: column;
        `;

        const img = document.createElement("img");
        img.src = dataUrl;
        img.alt = "Design Preview";
        img.style.cssText = "max-width: 100%; max-height: 70vh; object-fit: contain;";

        const actions = document.createElement("div");
        actions.style.cssText = "margin-top: 10px; display: flex; gap: 8px; justify-content: flex-end;";

        const downloadBtn = document.createElement("button");
        downloadBtn.textContent = "Download";
        downloadBtn.className = "btn btn-primary";
        downloadBtn.onclick = () => {
            const a = document.createElement("a");
            a.href = dataUrl;
            a.download = `${this.active_side}_design.png`;
            document.body.appendChild(a);
            a.click();
            a.remove();
        };

        const closeBtn = document.createElement("button");
        closeBtn.textContent = "Close";
        closeBtn.className = "btn btn-secondary";
        closeBtn.onclick = () => overlay.remove();

        actions.appendChild(downloadBtn);
        actions.appendChild(closeBtn);

        panel.appendChild(img);
        panel.appendChild(actions);

        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) overlay.remove();
        });

        overlay.appendChild(panel);
        document.body.appendChild(overlay);
    },

    _applyFillDeep: function (obj, color) {
        if (!obj) return;
        const children = typeof obj.getObjects === "function" ? obj.getObjects() : obj._objects;
        if (children && children.length) {
            children.forEach((child) => this._applyFillDeep(child, color));
            if ("fill" in obj) obj.set("fill", color);
            return;
        }
        if ("fill" in obj) {
            obj.set("fill", color);
        }
        this._setObjectPrintColor(obj, color);
    },

    // Recursively set stroke (and optional width) on any Fabric object, including groups
    _applyStrokeDeep: function (obj, color, width) {
        if (!obj) return;
        const children = typeof obj.getObjects === "function" ? obj.getObjects() : obj._objects;
        if (children && children.length) {
            children.forEach((child) => this._applyStrokeDeep(child, color, width));
            if ("stroke" in obj && typeof color === "string") obj.set("stroke", color);
            if ("strokeWidth" in obj && Number.isFinite(width)) obj.set("strokeWidth", width);
            return;
        }
        if ("stroke" in obj && typeof color === "string") {
            obj.set("stroke", color);
        }
        if ("strokeWidth" in obj && Number.isFinite(width)) {
            obj.set("strokeWidth", width);
        }
    },

    _onClickPickerOpen: function (ev) {
        var self = this
        if (window.EyeDropper !== undefined) {
            const eyeDropper = new EyeDropper();
            eyeDropper.open()
                .then((result) => {
                    $('#colorInput').val(result.sRGBHex);
                    if (self.currentElement) {
                        self._applyFillDeep(self.currentElement, result.sRGBHex);
                        $(".color-tool .color-icon").css("background-color", result.sRGBHex);
                        self.currentElement.canvas.renderAll();
                    }
                })
                .catch(() => {
                    // User cancelled EyeDropper.
                });
        }
    },

    _getAreasDataForSide: function (side) {
        switch (side) {
            case 'front': return this.frontAreasData || [];
            case 'back': return this.backAreasData || [];
            case 'left': return this.leftAreasData || [];
            case 'right': return this.rightAreasData || [];
            default: return [];
        }
    },

    // Add this helper to find area definition by side+id
    _findAreaDef: function (side, areaId) {
        const areas = this._getAreasDataForSide(side);
        return areas.find(a => String(a.id) === String(areaId));
    },

    // Add this helper to compute the "actual" area dimensions for saving
    _computeAreaActualForSave: function (areaDef, canvasW, canvasH) {
        // Prefer backend actual
        const actual = areaDef?.meta?.actual;
        if (actual && Number.isFinite(actual.width) && Number.isFinite(actual.height)) {
            let unit = actual.unit || 'inch';
            if (unit === 'millimeter') unit = 'mm';
            else if (unit === 'centimeter') unit = 'cm';
            return {
                width: Math.round(actual.width * 100) / 100,
                height: Math.round(actual.height * 100) / 100,
                unit,
            };
        }
        // Fallback to in_units (area size in configured unit)
        const iu = areaDef?.in_units;
        if (iu && Number.isFinite(iu.width) && Number.isFinite(iu.height)) {
            const unit = iu.unit || 'inch';
            return {
                width: Math.round(iu.width * 100) / 100,
                height: Math.round(iu.height * 100) / 100,
                unit,
            };
        }
        // Final fallback: canvas pixels
        return {
            width: Math.round(canvasW),
            height: Math.round(canvasH),
            unit: 'px',
        };
    },

    _onPreviewCurrentSide: async function () {
        const self = this;
        let previewUrl = null;

        await this._runCanvasExportBatch(async () => {
            const sides = ["front", "back", "left", "right"];
            const designedSides = [];

            for (const side of sides) {
                if (!self.canvasesBySide[side]) continue;

                let hasDesign = false;
                for (const view of self.canvasesBySide[side]) {
                    const canvasObjects = view.canvas.getObjects();
                    if (canvasObjects?.length > 0) {
                        hasDesign = true;
                        break;
                    }
                }

                if (!hasDesign) continue;

                try {
                    const dataUrl = await self._exportSideDuringBatch(side, {
                        format: "png",
                        quality: 1,
                    });
                    if (dataUrl) {
                        designedSides.push({ side, dataUrl });
                    }
                } catch (error) {
                    console.error(`Error previewing side '${side}':`, error);
                }
            }

            if (!designedSides.length) {
                return;
            }

            if (designedSides.length === 1) {
                previewUrl = designedSides[0].dataUrl;
                return;
            }

            previewUrl = await self._createCombinedPreview(designedSides);
        });

        if (!previewUrl) {
            this.notification.add(
                _t("No designs found to preview. Please add designs to at least one side."),
                { type: "warning" }
            );
            return;
        }

        this._showImagePreview(previewUrl);
    },

    _createCombinedPreview: async function (designedSides) {
        const combinedCanvas = document.createElement('canvas');
        const ctx = combinedCanvas.getContext('2d');

        // Load all images
        const images = await Promise.all(designedSides.map(sideData => {
            return new Promise((resolve) => {
                const img = new Image();
                img.onload = () => resolve({ side: sideData.side, img: img });
                img.src = sideData.dataUrl;
            });
        }));

        // Calculate layout
        const padding = 30;
        const labelHeight = 30;
        const cols = Math.min(2, images.length);
        const rows = Math.ceil(images.length / cols);

        const maxWidth = Math.max(...images.map(img => img.img.width));
        const maxHeight = Math.max(...images.map(img => img.img.height));

        // Set canvas size
        combinedCanvas.width = cols * maxWidth + (cols + 1) * padding;
        combinedCanvas.height = rows * (maxHeight + labelHeight) + (rows + 1) * padding;

        // White background
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, combinedCanvas.width, combinedCanvas.height);

        // Draw images with labels
        ctx.fillStyle = 'black';
        ctx.font = '16px Arial';
        ctx.textAlign = 'center';

        images.forEach((imgData, index) => {
            const col = index % cols;
            const row = Math.floor(index / cols);

            const x = padding + col * (maxWidth + padding);
            const y = padding + row * (maxHeight + labelHeight + padding);

            // Draw label
            ctx.fillText(imgData.side.toUpperCase(), x + maxWidth / 2, y + 20);

            // Draw image
            const imgX = x + (maxWidth - imgData.img.width) / 2;
            const imgY = y + labelHeight + (maxHeight - imgData.img.height) / 2;
            ctx.drawImage(imgData.img, imgX, imgY);
        });

        return combinedCanvas.toDataURL('image/png', 1.0);
    },

    _getStageBaseSize: function (side) {
        const stage = (this.stageBySide && this.stageBySide[side]) || this.DEFAULT_STAGE;
        return {
            w: stage.imageW || stage.w || this.DEFAULT_STAGE.w,
            h: stage.imageH || stage.h || this.DEFAULT_STAGE.h,
        };
    },

    _getAreaExportRectOnNatural: function (side, areaId, naturalWidth, naturalHeight) {
        const areaDef = this._findAreaDef(side, areaId);
        if (!areaDef) {
            return null;
        }
        const base = this._getStageBaseSize(side);
        const baseW = base.w;
        const baseH = base.h;
        return {
            left: (Number(areaDef.left) / baseW) * naturalWidth,
            top: (Number(areaDef.top) / baseH) * naturalHeight,
            width: (Number(areaDef.width) / baseW) * naturalWidth,
            height: (Number(areaDef.height) / baseH) * naturalHeight,
        };
    },

    _drawFabricAreaLayerOnExport: function (ctx, fab, destRect) {
        const layer = fab.lowerCanvasEl;
        if (!layer || layer.width < 1 || layer.height < 1) {
            return;
        }
        fab.renderAll();
        const scratch = document.createElement("canvas");
        scratch.width = layer.width;
        scratch.height = layer.height;
        scratch.getContext("2d").drawImage(layer, 0, 0);
        ctx.drawImage(
            scratch,
            0,
            0,
            layer.width,
            layer.height,
            destRect.left,
            destRect.top,
            destRect.width,
            destRect.height
        );
    },

    _exportSideComposite: async function (side, opts = {}) {
        return this._exportSideDuringBatch(side, opts);
    },

    /**
     * Export one side inside a batch: invisible `tus-hidden-render` for
     * inactive tabs (no tab switching flicker).
     */
    _exportSideDuringBatch: async function (side, opts = {}) {
        const targetRoot = document.getElementById(`${side}_canvas`);
        if (!targetRoot) return null;

        return this._withMeasurableSide(side, async () => {
            await this._prepareSideForExport(side);
            return this._exportSideCompositeCore(side, opts);
        });
    },

    _exportSideCompositeCore: async function (side, opts = {}) {
        try {
            const root = document.getElementById(`${side}_canvas`);
            if (!root) return null;

            const entries = (this.canvasesBySide[side] || []).slice();
            if (!entries.length) {
                return null;
            }

            if (this.emptyCanvasMode) {
                const layout = entries[0].layout || {};
                const format = (opts.format || "png").toLowerCase();
                const quality = typeof opts.quality === "number" ? opts.quality : 1;
                if (opts.returnCanvas) {
                    return this._exportEmptyCanvasCompositeCanvas(entries, layout, {
                        side,
                        maxSize: opts.maxSize,
                    });
                }
                if (typeof this._exportEmptyCanvasPreviewDataUrl === "function") {
                    return this._exportEmptyCanvasPreviewDataUrl(entries, layout, {
                        format,
                        quality,
                        side,
                    });
                }
                const stageW = layout.stageW || layout.canvasW || 394;
                const stageH = layout.stageH || layout.canvasH || 394;
                const out = document.createElement("canvas");
                out.width = stageW;
                out.height = stageH;
                const ctx = out.getContext("2d");
                ctx.fillStyle = "#ffffff";
                ctx.fillRect(0, 0, stageW, stageH);
                for (const entry of entries) {
                    const fab = entry.canvas;
                    if (!fab) {
                        continue;
                    }
                    fab.discardActiveObject();
                    fab.renderAll();
                    ctx.drawImage(fab.lowerCanvasEl, 0, 0, stageW, stageH);
                }
                return out.toDataURL(format === "jpeg" ? "image/jpeg" : "image/png", quality);
            }

            const img = root.querySelector("img.main_canvas_img") || root.querySelector("img.thumbnail_img");
            if (!img) return null;

            await this._ensureImageLoaded(img);

            const naturalWidth = img.naturalWidth || img.width || 800;
            const naturalHeight = img.naturalHeight || img.height || 800;

            const imgRect = img.getBoundingClientRect();
            const cachedLayout = entries.find((e) => e.layout?.imgDisplayW > 0)?.layout;
            const displayWidth = imgRect.width
                || cachedLayout?.imgDisplayW
                || img.clientWidth
                || img.width
                || naturalWidth;
            const displayHeight = imgRect.height
                || cachedLayout?.imgDisplayH
                || img.clientHeight
                || img.height
                || naturalHeight;
            if (displayWidth < 1 || displayHeight < 1) {
                return null;
            }

            const out = document.createElement("canvas");
            out.width = naturalWidth;
            out.height = naturalHeight;
            let ctx;
            try {
                ctx = out.getContext("2d", { alpha: true, colorSpace: "srgb" });
            } catch (e) {
                ctx = out.getContext("2d", { alpha: true });
            }
            if (!ctx) {
                ctx = out.getContext("2d");
            }
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";

            ctx.drawImage(img, 0, 0, naturalWidth, naturalHeight);

            const scaleX = naturalWidth / displayWidth;
            const scaleY = naturalHeight / displayHeight;

            for (const entry of entries) {
                const fab = entry.canvas;
                const wrapper = entry.wrapper;
                if (!fab || !wrapper) continue;

                const objects = fab.getObjects().filter((obj) => !obj.center_line);
                if (!objects.length) continue;

                let destLeft, destTop, destW, destH;
                const wRect = wrapper.getBoundingClientRect();
                if (wRect.width >= 1 && wRect.height >= 1 && imgRect.width >= 1) {
                    // Active side: use live coordinates
                    destLeft = (wRect.left - imgRect.left) * scaleX;
                    destTop = (wRect.top - imgRect.top) * scaleY;
                    destW = wRect.width * scaleX;
                    destH = wRect.height * scaleY;
                } else {
                    // Hidden side: use wrapper inline styles + cached image layout offsets
                    const layout = entry.layout || cachedLayout;
                    if (!layout || layout.imgDisplayW <= 0) continue;
                    const leftCSS = parseFloat(wrapper.style.left);
                    const topCSS = parseFloat(wrapper.style.top);
                    const widthCSS = parseFloat(wrapper.style.width) || wrapper.offsetWidth;
                    const heightCSS = parseFloat(wrapper.style.height) || wrapper.offsetHeight;
                    if (!Number.isFinite(leftCSS) || !Number.isFinite(topCSS)) continue;
                    if (widthCSS < 1 || heightCSS < 1) continue;
                    const relLeft = leftCSS - (layout.offsetX || 0);
                    const relTop = topCSS - (layout.offsetY || 0);
                    const cachedScaleX = naturalWidth / layout.imgDisplayW;
                    const cachedScaleY = naturalHeight / layout.imgDisplayH;
                    destLeft = relLeft * cachedScaleX;
                    destTop = relTop * cachedScaleY;
                    destW = widthCSS * cachedScaleX;
                    destH = heightCSS * cachedScaleY;
                }

                const activeBefore = fab.getActiveObject();
                if (activeBefore) {
                    fab.discardActiveObject();
                }
                fab.renderAll();
                const layer = fab.lowerCanvasEl;
                if (!layer || layer.width < 1 || layer.height < 1) {
                    if (activeBefore) {
                        fab.setActiveObject(activeBefore);
                        fab.requestRenderAll();
                    }
                    continue;
                }

                ctx.drawImage(
                    layer,
                    0, 0, layer.width, layer.height,
                    destLeft, destTop, destW, destH
                );

                if (activeBefore) {
                    fab.setActiveObject(activeBefore);
                    fab.requestRenderAll();
                }
            }

            const format = (opts.format || "png").toLowerCase();
            const quality = typeof opts.quality === "number" ? opts.quality : 1;
            const maxExportPx = opts.maxSize || 1024;
            let outputCanvas = out;
            const longest = Math.max(naturalWidth, naturalHeight);
            if (longest > maxExportPx) {
                const ratio = maxExportPx / longest;
                const scaled = document.createElement("canvas");
                scaled.width = Math.max(1, Math.round(naturalWidth * ratio));
                scaled.height = Math.max(1, Math.round(naturalHeight * ratio));
                scaled.getContext("2d").drawImage(out, 0, 0, scaled.width, scaled.height);
                outputCanvas = scaled;
            }
            if (opts.returnCanvas) {
                return outputCanvas;
            }
            return outputCanvas.toDataURL(
                format === "jpeg" ? "image/jpeg" : "image/png",
                quality
            );
        } catch (e) {
            console.error("Composite export failed:", e);
            return null;
        }
    },

    _onAddToCart: async function (ev) {
        ev.preventDefault();
        if (this._isShareCollaborator?.()) {
            return;
        }
        if (this.showMatrixTable) {
            return this._showMatrixTable();
        }
        const $btn = $(ev.currentTarget);
        var self = this;

        // Add Button Loader
        const originalBtnHtml = $btn.html();
        $btn.html('<i class="fa fa-spinner fa-spin me-2"></i> Processing...').prop('disabled', true);

        const productId = $btn.attr('data-variant-id');
        const name = $btn.attr('data-product-name');
        const $priceEl = $('.designer-price');
        const basePrice = parseFloat($priceEl.attr('data-base-price'))
            || parseFloat($priceEl.data('base-price'))
            || parseFloat($btn.attr('data-price'))
            || 0;
        const designPrice = this._calculateDesignPrice();
        const texturePrice = this._calculateTexturePrice ? this._calculateTexturePrice() : 0;
        const image = $btn.attr('data-image') || '/web/image/product.product/' + productId + '/image_128';
        $('.canvas_switcher').css('z-index', '0')
        let designData = [];

        try {
            const mockupUrls = this._isVdpActive?.() ? this._captureMockupBackgrounds() : null;
            if (this._isVdpActive?.()) {
                this._restoreVdpPlaceholders();
            }
            designData = await this._runCanvasExportBatch(() =>
                this._collectDesignData({ includeElementImages: true })
            );

            // Check if no design data was collected
            if (designData.length === 0 && !(this._hasAnyTextureApplied && this._hasAnyTextureApplied())) {
                this.notification.add(_t("Please add a design to at least one side before adding to cart."), { type: 'danger' });
                return; // Exit the function without adding to cart
            }

            const hasColorColumn = this._isVdpActive?.() && this.vdpRecords.some(row => this._vdpRowVal?.(row, "color", "colour", "Color"));
            if (hasColorColumn) {
                if (!this.matrixData?.length) {
                    const productTmplId = parseInt($('input[name="product_tmpl_id"]').val(), 10);
                    this.matrixData = await this.rpc("/tus_personalizer/matrix/data", {
                        product_tmpl_id: productTmplId,
                    });
                }
                const allVariants = this._matrixVariantIndex?.() || [];
                const activeProductId = parseInt(productId, 10);
                const activeVar = allVariants.find(v => v.product_id === activeProductId);
                const activeColorId = $('input[name="current_color_id"]').val() || "";

                const recordsByProductId = {};
                for (const row of this.vdpRecords) {
                    const rowColorVal = this._vdpRowVal?.(row, "color", "colour", "Color") || "";
                    const colorKey = rowColorVal.trim().toLowerCase();

                    let matchedProductId = activeProductId;
                    let matchedColorId = activeColorId;

                    if (colorKey) {
                        const matches = allVariants.filter(v => v.color_key === colorKey);
                        if (matches.length > 0) {
                            const sizeMatch = activeVar ? matches.find(v => v.size_key === activeVar.size_key) : null;
                            const finalMatch = sizeMatch || matches[0];
                            matchedProductId = finalMatch.product_id;
                            matchedColorId = finalMatch.color_id;
                        }
                    }

                    if (!recordsByProductId[matchedProductId]) {
                        recordsByProductId[matchedProductId] = {
                            colorId: matchedColorId,
                            records: []
                        };
                    }
                    recordsByProductId[matchedProductId].records.push(row);
                }

                // Remove existing cart items for all variants of this template to avoid duplicates
                const allVariantIds = allVariants.map(v => v.product_id);
                allVariantIds.forEach(vid => {
                    this.$items.find(`.cart-item[data-id="${vid}"]`).remove();
                });
                this.$items.find(`.cart-item[data-id="${productId}"]`).remove();

                for (const rowProductIdStr of Object.keys(recordsByProductId)) {
                    const rowProductId = parseInt(rowProductIdStr, 10);
                    const rowDataEntry = recordsByProductId[rowProductIdStr];
                    const rowRecords = rowDataEntry.records;
                    const rowColorId = rowDataEntry.colorId;
                    const rowQty = rowRecords.length;

                    let rowPrice = basePrice;
                    for (const color of this.matrixData || []) {
                        const sizeObj = (color.sizes || []).find(s => s.product_id === rowProductId);
                        if (sizeObj) {
                            rowPrice = parseFloat(sizeObj.price) || basePrice;
                            break;
                        }
                    }

                    const rowImage = '/web/image/product.product/' + rowProductId + '/image_128';
                    const rowVdpMeta = JSON.stringify({
                        fields: this._collectVdpFieldKeysFromCanvas?.() || [],
                        records: rowRecords,
                        mockup_urls: rowProductId === activeProductId ? mockupUrls : null,
                    }).replace(/'/g, "&#39;");

                    const cartItemHtml = `
                        <div class="cart-item" data-id="${rowProductId}" data-color-id="${rowColorId}" data-price="${rowPrice}" data-design-price="${designPrice}" data-texture-price="${texturePrice}" data-qty="${rowQty}" data-design='${JSON.stringify(designData)}' data-vdp='${rowVdpMeta}'>
                            <img src="${rowImage}" alt="${name}" class="cart-item-img"/>
                            <div class="cart-item-info">
                                <p class="name">${name} <i class="fa fa-info-circle"></i></p>
                                <div class="quantity-control">
                                    <button class="qty-minus">−</button>
                                    <span class="qty-value">${rowQty}</span>
                                    <button class="qty-plus">+</button>
                                </div>
                            </div>
                        </div>
                    `;
                    this.$items.append(cartItemHtml);
                }
            } else {
                const vdpQty = this._isVdpActive?.() ? this.vdpRecords.length : 1;
                const colorId = $('input[name="current_color_id"]').val() || "";
                const vdpMeta = this._isVdpActive?.()
                    ? JSON.stringify({
                        fields: this._collectVdpFieldKeysFromCanvas?.() || [],
                        records: this.vdpRecords,
                        mockup_urls: mockupUrls,
                    }).replace(/'/g, "&#39;")
                    : "";

                const cartItemHtml = `
                    <div class="cart-item" data-id="${productId}" data-color-id="${colorId}" data-price="${basePrice}" data-design-price="${designPrice}" data-texture-price="${texturePrice}" data-qty="${vdpQty}" data-design='${JSON.stringify(designData)}'${vdpMeta ? ` data-vdp='${vdpMeta}'` : ""}>
                        <img src="${image}" alt="${name}" class="cart-item-img"/>
                        <div class="cart-item-info">
                            <p class="name">${name} <i class="fa fa-info-circle"></i></p>
                            <div class="quantity-control">
                                <button class="qty-minus">−</button>
                                <span class="qty-value">${vdpQty}</span>
                                <button class="qty-plus">+</button>
                            </div>
                        </div>
                    </div>
                `;

                let $existing = this.$items.find(`.cart-item[data-id="${productId}"]`);
                if ($existing.length) {
                    $existing.replaceWith(cartItemHtml);
                } else {
                    this.$items.append(cartItemHtml);
                }
            }

            this._updateTotals();
            this._suppressLayoutSyncUntil = Date.now() + 500;
            this.el?.classList.add("tus-exporting");
            await new Promise((resolve) => {
                requestAnimationFrame(() => requestAnimationFrame(resolve));
            });
            self.$sidebar.addClass("open");
            $(".fabric_container").addClass("tus-cart-open");
            requestAnimationFrame(() => {
                self.el?.classList.remove("tus-exporting");
            });
        } catch (error) {
            console.error('Error collecting design data:', error);
            this.notification.add(
                _t("Failed to prepare design for cart. Please try again."),
                { type: "danger" }
            );
        } finally {
            $btn.html(originalBtnHtml).prop('disabled', false);
        }
    },

    /**
     * Merge fresh PNG snapshots and dimensions into cart-cached design.
     * SVG conversion is done on the backend when Download SVG is clicked.
     */
    _mergeDesignExportData: function (cached, fresh, options = {}) {
        if (!fresh?.length) {
            return cached || [];
        }
        if (!cached?.length) {
            return fresh;
        }
        const preserveComposite = options.preserveSideComposite === true;
        const freshBySide = {};
        fresh.forEach((s) => {
            freshBySide[s.side] = s;
        });
        return cached.map((sideObj) => {
            const freshSide = freshBySide[sideObj.side];
            if (!freshSide) {
                return sideObj;
            }
            const merged = {
                ...sideObj,
                data: preserveComposite ? sideObj.data : (freshSide.data || sideObj.data),
                width: freshSide.width ?? sideObj.width,
                height: freshSide.height ?? sideObj.height,
                unit: freshSide.unit || sideObj.unit,
                active_areas: freshSide.active_areas || sideObj.active_areas,
            };
            if (!freshSide.canvas_vals?.length || !sideObj.canvas_vals?.length) {
                return merged;
            }
            merged.canvas_vals = sideObj.canvas_vals.map((cv, idx) => {
                const freshCv = freshSide.canvas_vals[idx] || {};
                return {
                    ...cv,
                    element_image: freshCv.element_image || cv.element_image,
                    width: freshCv.width ?? cv.width,
                    height: freshCv.height ?? cv.height,
                    src: freshCv.src || cv.src,
                };
            });
            return merged;
        });
    },

    _extractObjectSrc: function (obj) {
        if (!obj) return null;
        if (obj.src) return obj.src;
        if (typeof obj.getSrc === "function") {
            try {
                const s = obj.getSrc();
                if (s) return s;
            } catch (_e) {
                // ignore
            }
        }
        const el = obj._element || obj._originalElement;
        if (el?.src) return el.src;
        return null;
    },

    /**
     * High-res print multiplier for the imprint snapshot that the backend
     * traces into SVG/AI. Higher = crisper print output (capped for memory).
     */
    _printSnapshotMultiplier: function (obj) {
        let base = 4;
        try {
            const rect = obj.getBoundingRect ? obj.getBoundingRect(true, true) : null;
            const longest = rect ? Math.max(rect.width || 0, rect.height || 0) : 0;
            if (longest > 0) {
                // Aim for ~1600px on the longest edge for a clean trace.
                base = Math.min(8, Math.max(3, Math.ceil(1600 / longest)));
            }
        } catch (e) {
            // keep default
        }
        return base;
    },

    /**
     * Snapshot one Fabric object for backend imprint_image (flicker-safe).
     * Uses toCanvasElement first (works for group, image, text, paths).
     * Captured at high resolution with a transparent background so the
     * server-side tracer can produce sharp, print-ready vectors.
     */
    _snapshotElement: async function (fabricCanvas, obj, padding = 6) {
        if (!fabricCanvas || !obj) return null;
        const multiplier = this._printSnapshotMultiplier(obj);
        try {
            const direct = this._snapshotObjectToDataUrl(obj, padding, multiplier);
            if (direct) return direct;
        } catch (e) {
            console.warn("Direct element snapshot failed:", e);
        }
        try {
            return await this._snapshotElementCloned(fabricCanvas, obj, padding, multiplier);
        } catch (e) {
            console.warn("Clone snapshot failed:", e);
            return this._snapshotElementByVisibility(fabricCanvas, obj, padding, multiplier);
        }
    },

    _snapshotObjectToDataUrl: function (obj, padding = 6, multiplier = 4) {
        if (!obj || typeof obj.toCanvasElement !== "function") return null;
        const elCanvas = obj.toCanvasElement({
            multiplier: multiplier,
            enableRetinaScaling: false,
        });
        if (!elCanvas || elCanvas.width < 1 || elCanvas.height < 1) return null;
        const pad = padding * multiplier;
        if (pad <= 0) return elCanvas.toDataURL("image/png");
        const padded = document.createElement("canvas");
        padded.width = elCanvas.width + pad * 2;
        padded.height = elCanvas.height + pad * 2;
        padded.getContext("2d").drawImage(elCanvas, pad, pad);
        return padded.toDataURL("image/png");
    },

    _snapshotElementByVisibility: function (fabricCanvas, obj, padding = 6, multiplier = 4) {
        const objects = fabricCanvas.getObjects() || [];
        if (!objects.length) return null;
        const rect = obj.getBoundingRect(true, true);
        if (!rect || !isFinite(rect.width) || !isFinite(rect.height)) return null;

        const left = Math.max(0, rect.left - padding);
        const top = Math.max(0, rect.top - padding);
        const width = Math.min(fabricCanvas.getWidth() - left, rect.width + padding * 2);
        const height = Math.min(fabricCanvas.getHeight() - top, rect.height + padding * 2);
        if (width <= 0 || height <= 0) return null;

        const visibilityMap = new Map();
        try {
            objects.forEach((o) => {
                visibilityMap.set(o, o.visible);
                o.set("visible", o === obj);
            });
            fabricCanvas.discardActiveObject();
            return fabricCanvas.toDataURL({
                format: "png",
                left,
                top,
                width,
                height,
                multiplier: multiplier,
                enableRetinaScaling: false,
            });
        } finally {
            visibilityMap.forEach((vis, o) => o.set("visible", vis));
        }
    },

    _snapshotElementCloned: async function (fabricCanvas, obj, padding = 6, multiplier = 4) {
        const w = fabricCanvas.getWidth();
        const h = fabricCanvas.getHeight();
        const cloned = await new Promise((resolve, reject) => {
            obj.clone((c) => (c ? resolve(c) : reject(new Error("clone failed"))));
        });

        const el = document.createElement("canvas");
        const temp = new fabric.StaticCanvas(el, {
            width: w,
            height: h,
            renderOnAddRemove: false,
            enableRetinaScaling: false,
        });

        cloned.set({
            visible: true,
            evented: false,
            selectable: false,
            hasControls: false,
        });
        temp.add(cloned);
        temp.renderAll();
        await new Promise(requestAnimationFrame);

        const rect = cloned.getBoundingRect(true, true);
        if (!rect || !isFinite(rect.width) || !isFinite(rect.height)) {
            temp.dispose();
            return null;
        }

        const left = Math.max(0, rect.left - padding);
        const top = Math.max(0, rect.top - padding);
        const width = Math.min(w - left, rect.width + padding * 2);
        const height = Math.min(h - top, rect.height + padding * 2);
        if (width <= 0 || height <= 0) {
            temp.dispose();
            return null;
        }

        const dataUrl = temp.toDataURL({
            format: "png",
            left,
            top,
            width,
            height,
            multiplier: multiplier,
            enableRetinaScaling: false,
        });
        temp.dispose();
        return dataUrl;
    },

    _onClickSaveOrderLine: async function (ev) {
        ev.preventDefault();
        const $btn = $(ev.currentTarget);
        const self = this;

        const product_id = $(".selected-variant").attr("data-variant_id");
        const sale_order_line_id = parseInt($('input[name="sale_order_line_id"]').val());

        let designData = [];
        let items = [];

        try {
            await this._runCanvasExportBatch(async () => {
                const processSide = async function (side) {
                    if (!self.canvasesBySide[side]) return [];

                    let sideCompositeUrl = null;
                    const hasContent = self.canvasesBySide[side].some(
                        (view) => view.canvas && view.canvas.getObjects().length > 0
                    );

                    if (hasContent) {
                        sideCompositeUrl = await self._exportSideDuringBatch(side, {
                            format: "png",
                            quality: 1,
                        });
                    }

                    const promises = self.canvasesBySide[side].map(async function (view) {
                        const canvasObjects = view.canvas.getObjects().filter((element) => !element.center_line);
                        if (!canvasObjects || canvasObjects.length === 0) return null;

                        const areaDef = self._findAreaDef(side, view.id);
                        const actual = self._computeAreaActualForSave(
                            areaDef,
                            view.canvas.getWidth(),
                            view.canvas.getHeight()
                        );

                        const canvas_vals = [];
                        for (const obj of canvasObjects) {
                            const elemImage = await self._snapshotElement(view.canvas, obj, 6);
                            const dim = self._computeObjectDimensions(view.canvas, obj);

                            canvas_vals.push(
                                self._buildCanvasValEntry(view.canvas, obj, dim, actual, elemImage)
                            );
                        }

                        return {
                            id: view.id,
                            side,
                            data: sideCompositeUrl,
                            canvas_vals,
                            width: canvas_vals.length === 1 ? canvas_vals[0].width : actual.width,
                            height: canvas_vals.length === 1 ? canvas_vals[0].height : actual.height,
                            unit: actual.unit,
                            finish_settings: self._getFinishSettingsForSide
                                ? self._getFinishSettingsForSide(side)
                                : serializeGlobalFinishSettings(self._3dPreviewSettings),
                        };
                    });

                    const results = await Promise.all(promises);
                    return results.filter((r) => r !== null);
                };

                const sides = ['front', 'back', 'left', 'right'];
                for (const side of sides) {
                    const sideResults = await processSide(side);
                    if (sideResults.length > 0) designData.push(...sideResults);
                }
            });
        } catch (error) {
            console.error("Error collecting design data:", error);
        }

        items.push({
            sale_order_line_id: sale_order_line_id,
            design: designData,
            product_id: product_id,
            from_cart_edit: $('input[name="from_cart_edit"]').val() === "1",
            design_bundle: await this._collectAllDesignStates([]).catch(() => null),
            finish_objects: this._getFinishObjectsPayload ? this._getFinishObjectsPayload() : [],
            texture_by_side: this._getTexturePayloadForCart?.() || {},
            empty_canvas: this._getEmptyCanvasMeta?.(),
        });

        // Save to backend
        await this.rpc("/save/orderline", {
            items: items,
        }).then(function (result) {
            if (result.success) {
                window.location.href = result.redirect_url;
            } else {
                self.notification.add(result.error || "Something Went Wrong", { type: 'danger' });
            }
        });
    },

    _onExitToSaleOrder: function (ev) {
        ev.preventDefault();
        const saleOrderId = parseInt($('input[name="order_id"]').val());
        if (saleOrderId) {
            window.location.href = `/odoo/sales/${saleOrderId}`;
        }
    },

    destroy: function () {
        if (this._onWindowResize) {
            window.removeEventListener("resize", this._onWindowResize);
        }
        if (this._canvasLayoutObservers?.length) {
            for (const ro of this._canvasLayoutObservers) {
                ro.disconnect();
            }
            this._canvasLayoutObservers = [];
        }
        if (this.fabricByAreaId) {
            for (const canvas of Object.values(this.fabricByAreaId)) {
                canvas?.dispose?.();
            }
        }
        return this._super.apply(this, arguments);
    },
});

registerFabricRefLayout();

export function assertEmbossDoesNotAddLayer(beforeCount, afterCount) {
    return beforeCount === afterCount;
}

export function assertFinishControlsForType(objType, panelState) {
    if (objType === "image") {
        return !!(panelState.showMaskUpload && panelState.showIntensity && panelState.showVarnish);
    }
    return !!(!panelState.showMaskUpload && panelState.showIntensity && panelState.showVarnish);
}

export function assertHelpContext(panelKey, helpPayload) {
    const byContext = (helpPayload && helpPayload.by_context) || {};
    return !!(byContext[panelKey] || byContext.main || helpPayload?.content);
}

export function assertButtonLabels(labels) {
    const expected = [
        "Product",
        "Add Image",
        "Add Text",
        "Add Graphics",
        "Add Clipart",
        "Base Texture",
        "Manage Layers",
        "Templates",
    ];
    return expected.every((label) => labels.includes(label));
}

export const tusRevision1Checks = {
    assertEmbossDoesNotAddLayer,
    assertFinishControlsForType,
    assertHelpContext,
    assertButtonLabels,
};
