/** @odoo-module **/

import publicWidget from "@web/legacy/js/public/public_widget";
import { loadJS } from "@web/core/assets";
import { debounce } from "@web/core/utils/timing";
import { _t } from "@web/core/l10n/translation";
import {
    DEFAULT_FOIL_METAL,
    DEFAULT_RELIEF_MM,
    FINISH_DEBOSS,
    FINISH_EMBOSS,
    FINISH_FOIL_EMBOSS,
    applyCanvasFinishPreview,
    applyFinishFields,
    ensureObjectFinishDefaults,
    isFoilFinish,
} from "../3d/finish_effects";
import { TusPBRViewer } from "../3d/pbr_viewer";
import { TusViewerControls } from "../3d/viewer_controls";
import { bakeMapsForSide } from "../3d/texture_baker";
import { TUS_PANEL_TITLES, TUS_SKIP_INFO_KEY } from "./constants";

let _threeRuntimePromise = null;

const THREE_JS_URL = "/tus_product_personalizer/static/lib/three/three.min.js";
const ORBIT_CONTROLS_URL = "/tus_product_personalizer/static/lib/three/OrbitControls.js";

/**
 * Three.js and OrbitControls are classic scripts (window.THREE).
 * OrbitControls MUST load after three.min.js — never in parallel.
 */
async function _ensureThreeRuntime() {
    if (typeof window === "undefined") {
        return;
    }
    if (window.THREE?.OrbitControls) {
        return;
    }
    if (!_threeRuntimePromise) {
        _threeRuntimePromise = (async () => {
            if (!window.THREE) {
                await loadJS(THREE_JS_URL);
            }
            if (!window.THREE) {
                throw new Error("Three.js failed to load");
            }
            if (!window.THREE.OrbitControls) {
                await loadJS(ORBIT_CONTROLS_URL);
            }
        })().catch((err) => {
            _threeRuntimePromise = null;
            throw err;
        });
    }
    await _threeRuntimePromise;
}

export function registerFabricRefLayout() {
    publicWidget.registry.Fabric.include({
        events: Object.assign({}, publicWidget.registry.Fabric.prototype.events, {
            "click .tus-mode-btn": "_onTusModeToggle",
            "click #tus-product-info-btn": "_onTusToggleInfoPanel",
            "click .tus-footer-price-info-btn": "_onTusToggleFooterPricePopover",
            "click .tus-info-close": "_onTusCloseInfoPanel",
            "click .tus-overlay-backdrop": "_onTusCloseInfoPanel",
            "click .tus-zoom-in": "_onTusZoomIn",
            "click .tus-zoom-out": "_onTusZoomOut",
            "click .tus-zoom-reset": "_onTusZoomReset",
            "click .tus-back-btn": "_onTusBack",
            "click .tus-fullscreen-btn": "_onTusFullscreen",
            "change #tus-skip-info-future": "_onTusSkipInfoChange",
            "click .tus-header-menu-btn": "_onTusHeaderMenuToggle",
            "click .tus-header-cart-btn": "_onTusHeaderCart",
            "click .tus-menu-save-template": "_onTusMenuSaveTemplate",
            "click .tus-menu-share-save": "_onTusMenuShareSave",
            "click .tus-menu-download": "_onTusMenuDownload",
            "click .tus-menu-share": "_onTusMenuShare",
            "click .tus-menu-save-product": "_onTusMenuSaveProduct",
            "click .tus-menu-exit": "_onTusMenuExit",
            "change .tus-finish-effect": "_onFinishEffectChange",
            "input .tus-finish-relief": "_onFinishReliefChange",
            "change .tus-finish-varnish": "_onFinishVarnishChange",
            "change .tus-finish-foil-metal": "_onFinishFoilMetalChange",
        }),

        start: async function () {
            this._loadPersonalizerConfig();
            this._tusZoom = 100;
            this._tusEditorMode = "edit";
            this._pbrViewer = null;
            this._viewerControls = null;
            this._3dPreviewSettings = {
                varnishType: "none",
                reliefMm: DEFAULT_RELIEF_MM,
            };
            this._schedule3DPreviewRefresh = debounce(() => {
                if (this._is3dPreviewEnabled() && this._tusEditorMode === "3d-preview") {
                    this._refresh3DPreview();
                }
            }, 300);
            await this._super(...arguments);
            this._initRefLayout();
            this._ensureDefaultEditorMode();
            this._bind3DVisibilityPause();
            this._fixDefaultActiveSidebar();
            if (this._is3dPreviewEnabled()) {
                _ensureThreeRuntime().catch((err) => {
                    console.warn("3D preview preload skipped:", err);
                });
            }
        },

        _ensureDefaultEditorMode: function () {
            const $container = $(".fabric_container");
            const in3d = this._tusEditorMode === "3d-preview";
            const in2dPreview = this._tusEditorMode === "preview";
            const threeDAllowed = typeof this._is3dPreviewEnabled === "function" && this._is3dPreviewEnabled();
            const previewAllowed = !this._isFeatureDisabled("enable_preview");

            if (in3d && !threeDAllowed) {
                this._tusEditorMode = "edit";
                $container.removeClass("tus-3d-preview-mode tus-preview-mode");
                this._exit3DPreview();
                $(".tus-mode-btn").removeClass("active");
                $('.tus-mode-btn[data-mode="edit"]').addClass("active");
            } else if (in2dPreview && (threeDAllowed || !previewAllowed)) {
                this._tusEditorMode = "edit";
                $container.removeClass("tus-preview-mode");
                this._setTusPreviewMode(false);
                $(".tus-mode-btn").removeClass("active");
                $('.tus-mode-btn[data-mode="edit"]').addClass("active");
            }
        },

        _initRefLayout: function () {
            const $root = $(".fabric_container");
            $root.addClass("tus-ref-layout");

            this._relocateCanvasTabs();
            this._relocateMobileChrome();
            this._bindHeaderMenuDismiss();
            this._bindFooterPricePopoverDismiss();
            this._updateSaveProductState();
            if ($(".fab_item.active").length) {
                this._syncOptionsPanelTitle();
            }

            $(".fab_item").on("click.tusPanelTitle", () => {
                setTimeout(() => this._syncOptionsPanelTitle(), 0);
            });

            $(window).on("resize.tusRefLayout", () => {
                if ($(".tus-product-info-panel").hasClass("open")) {
                    this._positionInfoPanel();
                }
                this._relocateMobileChrome();
                this._syncMobilePanelState();
            });

            if (!localStorage.getItem(TUS_SKIP_INFO_KEY)) {
                setTimeout(() => this._openInfoPanel(false), 400);
            }
        },

        _relocateCanvasTabs: function () {
            const $tabs = this.$(".tus-stage-controls .canvas-tabs");
            const $dock = this.$(".tus-canvas-views-dock");
            if ($tabs.length && $dock.length && !$dock.children().length) {
                $tabs.appendTo($dock);
            }
            const self = this;
            $dock.off("shown.bs.tab.tusLayout").on(
                "shown.bs.tab.tusLayout",
                ".canvas-tabs [data-bs-toggle='tab']",
                function (ev) {
                    const side = $(ev.target).closest("[data-side]").data("side") || $(ev.target).data("side");
                    if (side) {
                        self._setVisibleCanvasSide(side);
                    }
                }
            );
        },

        _relocateMobileChrome: function () {
            const $footer = this.$("footer.tus-designer-footer");
            const $zoomDock = this.$(".tus-canvas-zoom-dock");
            if (!$footer.length || !$zoomDock.length) {
                return;
            }
            const mobile = this._isMobileRefLayout();
            const $zoom = $footer.find(".tus-zoom-controls");
            const zoomRelocated = $footer.hasClass("tus-zoom-relocated");

            if (mobile && !zoomRelocated && $zoom.length) {
                $zoomDock.append($zoom);
                $footer.addClass("tus-zoom-relocated");
                $zoomDock.removeClass("d-none");
            } else if (!mobile && zoomRelocated) {
                const $movedZoom = $zoomDock.find(".tus-zoom-controls");
                if ($movedZoom.length) {
                    $footer.find(".tus-footer-left").prepend($movedZoom);
                }
                $footer.removeClass("tus-zoom-relocated");
                $zoomDock.addClass("d-none");
            } else if (mobile) {
                $zoomDock.removeClass("d-none");
            }
        },

        _bindFooterPricePopoverDismiss: function () {
            $(document).off("click.tusFooterPricePopover").on("click.tusFooterPricePopover", (ev) => {
                const $anchor = this.$(".tus-footer-checkout-anchor");
                if (!$anchor.length || $anchor.has(ev.target).length) {
                    return;
                }
                this._closeFooterPricePopover();
            });
        },

        _openFooterPricePopover: function () {
            this._refreshFooterPricePopover();
            const $pop = this.$(".tus-footer-price-popover");
            if (!$pop.length) {
                return;
            }
            $pop.removeClass("d-none").addClass("open").attr("aria-hidden", "false");
            this.$(".tus-footer-price-info-btn")
                .addClass("is-active")
                .attr("aria-expanded", "true");
        },

        _closeFooterPricePopover: function () {
            this.$(".tus-footer-price-popover")
                .removeClass("open")
                .addClass("d-none")
                .attr("aria-hidden", "true");
            this.$(".tus-footer-price-info-btn")
                .removeClass("is-active")
                .attr("aria-expanded", "false");
        },

        _onTusToggleFooterPricePopover: function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            const $pop = this.$(".tus-footer-price-popover");
            if ($pop.hasClass("open")) {
                this._closeFooterPricePopover();
            } else {
                this._openFooterPricePopover();
            }
        },

        _refreshFooterPricePopover: function () {
            const $pop = this.$(".tus-footer-price-popover");
            if (!$pop.length) {
                return;
            }
            const symbol = this._getCurrencySymbol ? this._getCurrencySymbol() : "";
            const fmt = (value) => `${symbol}${Number(value || 0).toFixed(2)}`;
            const $priceEl = this.$(".designer-price").first();
            const basePrice = parseFloat($priceEl.attr("data-base-price"))
                || parseFloat($priceEl.data("base-price"))
                || 0;
            const designPrice = this._calculateDesignPrice ? this._calculateDesignPrice() : 0;
            let printingCost = 0;
            let printingLabel = "Printing";
            if (this.selectedPrintingMethod) {
                printingCost = parseFloat(this.selectedPrintingMethod.setup_cost || 0)
                    + parseFloat(this.selectedPrintingMethod.unit_cost || 0);
                printingLabel = this.selectedPrintingMethod.name || printingLabel;
            }
            const total = basePrice + designPrice + printingCost;

            this.$(".tus-footer-pop-base-val").text(fmt(basePrice));
            this.$(".tus-footer-pop-total-val").text(fmt(total));

            const showDesignPrice = $('input[name="show_design_price"]').val() === "1";
            const $designRow = this.$(".tus-footer-pop-design");
            if (showDesignPrice && designPrice > 0) {
                $designRow.removeClass("d-none");
                this.$(".tus-footer-pop-design-val").text(fmt(designPrice));
            } else {
                $designRow.addClass("d-none");
            }

            const showPrinting = $('input[name="show_printing_methods"]').val() === "1";
            const $printingRow = this.$(".tus-footer-pop-printing");
            if (showPrinting && printingCost > 0) {
                $printingRow.removeClass("d-none");
                this.$(".tus-footer-pop-printing-label").text(printingLabel);
                this.$(".tus-footer-pop-printing-val").text(fmt(printingCost));
            } else {
                $printingRow.addClass("d-none");
            }
        },

        _bindHeaderMenuDismiss: function () {
            $(document).off("click.tusHeaderMenu").on("click.tusHeaderMenu", (ev) => {
                const $menu = this.$(".tus-header-menu");
                if (!$menu.length || $menu.has(ev.target).length) {
                    return;
                }
                this._closeHeaderMenu();
            });
        },

        _closeHeaderMenu: function () {
            this.$(".tus-header-menu-panel").addClass("d-none");
            this.$(".tus-header-menu-btn").attr("aria-expanded", "false");
        },

        _onTusHeaderMenuToggle: function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            const $panel = this.$(".tus-header-menu-panel");
            const open = $panel.hasClass("d-none");
            if (open) {
                $panel.removeClass("d-none");
                this.$(".tus-header-menu-btn").attr("aria-expanded", "true");
            } else {
                this._closeHeaderMenu();
            }
        },

        _onTusHeaderCart: function (ev) {
            ev.preventDefault();
            const $save = this.$(".tus-save-product-btn:enabled").first();
            if ($save.length) {
                $save.trigger("click");
            }
        },

        _onTusMenuSaveTemplate: function (ev) {
            ev.preventDefault();
            this._closeHeaderMenu();
            this.$(".add_to_save").first().trigger("click");
        },

        _onTusMenuShareSave: function (ev) {
            ev.preventDefault();
            this._closeHeaderMenu();
            this.$(".share_save_btn").first().trigger("click");
        },

        _onTusMenuDownload: function (ev) {
            ev.preventDefault();
            this._closeHeaderMenu();
            this.$(".download_btn").first().trigger("click");
        },

        _onTusMenuShare: function (ev) {
            ev.preventDefault();
            this._closeHeaderMenu();
            this.$(".share_btn").first().trigger("click");
        },

        _onTusMenuSaveProduct: function (ev) {
            ev.preventDefault();
            if ($(ev.currentTarget).prop("disabled")) {
                return;
            }
            this._closeHeaderMenu();
            this._onTusHeaderCart(ev);
        },

        _onTusMenuExit: function (ev) {
            ev.preventDefault();
            this._closeHeaderMenu();
            const $exit = this.$(".exit_designer:visible, .exit_designer_backend:visible").first();
            if ($exit.length) {
                $exit[0].click();
            }
        },

        _isMobileRefLayout: function () {
            return window.innerWidth <= 1024;
        },

        _syncMobilePanelState: function () {
            const $root = this.$(".fabric_container");
            if (!$root.hasClass("tus-ref-layout")) {
                return;
            }
            const panelOpen =
                this._isMobileRefLayout() &&
                $(".options_content").hasClass("tus-panel-visible") &&
                !$root.hasClass("tus-toolbar-open");
            $root.toggleClass("tus-mobile-panel-open", panelOpen);
        },

        _syncOptionsPanelTitle: function () {
            const $active = $(".fab_item.active");
            const option = $active.data("option");
            const title = TUS_PANEL_TITLES[option] || (option ? String(option) : "");
            const $content = $(".options_content");
            const hasActiveSection = $content.find(".section_options.active").length > 0;
            $content.attr("data-panel-title", title);
            $content.find(".tus-panel-title").text(title);
            const visible = Boolean(title) || hasActiveSection;
            $content.toggleClass("tus-panel-visible", visible);
            if (visible) {
                $content.addClass("tus-panel-visible").css("display", "flex");
            } else {
                $content.removeClass("tus-panel-visible").hide();
            }
            this._syncMobilePanelState();
        },

        _positionInfoPanel: function () {
            const $panel = $(".tus-product-info-panel");
            if (!$panel.length) {
                return;
            }
            const railW = parseInt(
                getComputedStyle(document.querySelector(".fabric_container.tus-ref-layout") || document.body)
                    .getPropertyValue("--tus-ref-rail-w"),
                10
            ) || 76;
            const headerH = parseInt(
                getComputedStyle(document.querySelector(".fabric_container.tus-ref-layout") || document.body)
                    .getPropertyValue("--tus-ref-header-h"),
                10
            ) || 52;
            const footerH = parseInt(
                getComputedStyle(document.querySelector(".fabric_container.tus-ref-layout") || document.body)
                    .getPropertyValue("--tus-ref-footer-h"),
                10
            ) || 64;
            const panelW = Math.min(340, window.innerWidth - railW - 16);
            const maxH = window.innerHeight - headerH - footerH - 24;
            $panel.css({
                left: `${railW}px`,
                top: `${headerH + 8}px`,
                width: `${panelW}px`,
                maxHeight: `${maxH}px`,
            });
        },

        _openInfoPanel: function (focusClose = true) {
            this._positionInfoPanel();
            $(".tus-product-info-panel").removeClass("d-none").addClass("open");
            $(".tus-overlay-backdrop").removeClass("d-none");
            if (focusClose) {
                $(".tus-info-close").trigger("focus");
            }
        },

        _closeInfoPanel: function () {
            $(".tus-product-info-panel").removeClass("open").addClass("d-none");
            $(".tus-overlay-backdrop").addClass("d-none");
        },

        _onTusToggleInfoPanel: function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            const $panel = $(".tus-product-info-panel");
            if ($panel.hasClass("open")) {
                this._closeInfoPanel();
            } else {
                this._openInfoPanel(true);
            }
        },

        _onTusCloseInfoPanel: function (ev) {
            ev.preventDefault();
            this._closeInfoPanel();
        },

        _onTusSkipInfoChange: function (ev) {
            if (ev.currentTarget.checked) {
                localStorage.setItem(TUS_SKIP_INFO_KEY, "1");
            } else {
                localStorage.removeItem(TUS_SKIP_INFO_KEY);
            }
        },

        _onTusBack: function (ev) {
            ev.preventDefault();
            const $exit = this.$(".exit_designer:visible, .exit_designer_backend:visible").first();
            if ($exit.length) {
                $exit[0].click();
            } else {
                window.history.back();
            }
        },

        _onTusFullscreen: function (ev) {
            ev.preventDefault();
            const el = document.querySelector(".fabric_container.tus-ref-layout") || document.documentElement;
            const icon = this.$(".tus-fullscreen-btn i");
            if (!document.fullscreenElement) {
                const req = el.requestFullscreen || el.webkitRequestFullscreen;
                if (req) {
                    Promise.resolve(req.call(el)).catch(() => {});
                }
                icon.removeClass("fa-expand").addClass("fa-compress");
            } else {
                const exit = document.exitFullscreen || document.webkitExitFullscreen;
                if (exit) {
                    Promise.resolve(exit.call(document)).catch(() => {});
                }
                icon.removeClass("fa-compress").addClass("fa-expand");
            }
        },

        _onTusModeToggle: function (ev) {
            ev.preventDefault();
            const mode = $(ev.currentTarget).data("mode");
            if (mode === "3d-preview" && !this._is3dPreviewEnabled()) {
                return;
            }
            if (mode === "preview" && (this._is3dPreviewEnabled() || this._isFeatureDisabled("enable_preview"))) {
                return;
            }
            if (mode === this._tusEditorMode) {
                return;
            }
            this._tusEditorMode = mode;
            $(".tus-mode-btn").removeClass("active");
            $(`.tus-mode-btn[data-mode="${mode}"]`).addClass("active");
            const $container = $(".fabric_container");
            const is3DPreview = mode === "3d-preview";
            const is2DPreview = mode === "preview";
            $container.toggleClass("tus-3d-preview-mode", is3DPreview);
            $container.toggleClass("tus-preview-mode", is2DPreview);
            if (is3DPreview) {
                this._enter3DPreview();
            } else {
                this._exit3DPreview();
                this._setTusPreviewMode(is2DPreview);
            }
            this._closeHeaderMenu();
        },

        _getActive3DContainer: function () {
            return this.el.querySelector(".main_wrapper .tus-3d-viewer-container");
        },

        _getActiveSide: function () {
            return this.active_side || "front";
        },

        _bind3DVisibilityPause: function () {
            this._on3DVisibilityChange = () => {
                if (!this._pbrViewer) {
                    return;
                }
                if (document.hidden) {
                    this._pbrViewer.pause();
                } else if (this._tusEditorMode === "3d-preview") {
                    this._pbrViewer.resume();
                }
            };
            document.addEventListener("visibilitychange", this._on3DVisibilityChange);
        },

        _show3DFallback: function (container, message) {
            let el = container.querySelector(".tus-3d-fallback");
            if (!el) {
                el = document.createElement("div");
                el.className = "tus-3d-fallback";
                container.appendChild(el);
            }
            el.textContent = message;
        },

        _clear3DFallback: function (container) {
            container?.querySelector(".tus-3d-fallback")?.remove();
        },

        _ensure3DRuntime: async function () {
            await _ensureThreeRuntime();
        },

        _enter3DPreview: async function () {
            const container = this._getActive3DContainer();
            if (!container) {
                return;
            }
            container.classList.remove("d-none");
            this._setTusPreviewMode(true);
            $(".options_content").removeClass("tus-panel-visible");
            $(".new_toolbar_container").addClass("d-none");
            $(".fabric_container").removeClass("tus-toolbar-open");

            try {
                await this._ensure3DRuntime();
            } catch (err) {
                console.error("3D runtime load failed:", err);
                this._show3DFallback(
                    container,
                    "Unable to load 3D preview. Please refresh the page and try again."
                );
                return;
            }

            if (!TusPBRViewer.isWebGLAvailable()) {
                this._show3DFallback(
                    container,
                    "WebGL is not available in this browser. 3D preview requires WebGL support."
                );
                return;
            }

            try {
                if (!this._pbrViewer) {
                    this._pbrViewer = new TusPBRViewer(container);
                    await this._pbrViewer.init();
                    this._viewerControls = new TusViewerControls(container, {
                        onSettingsChange: (settings) => {
                            this._3dPreviewSettings = { ...this._3dPreviewSettings, ...settings };
                            this._schedule3DPreviewRefresh();
                        },
                        onResetView: () => this._pbrViewer?.resetView(),
                    });
                    if (this._3dPreviewSettings) {
                        this._viewerControls.setSettings(this._3dPreviewSettings);
                    }
                } else {
                    this._pbrViewer.resume();
                }
                this._clear3DFallback(container);
            } catch (err) {
                console.error("3D preview init failed:", err);
                this._show3DFallback(
                    container,
                    "Unable to start 3D preview. Please try again or use Edit mode."
                );
                return;
            }
            try {
                await this._refresh3DPreview();
            } catch (err) {
                console.error("3D preview refresh failed:", err);
                this._show3DFallback(
                    container,
                    "3D preview could not render the design. Check the browser console or switch back to Edit mode."
                );
            }
        },

        _exit3DPreview: function () {
            this._setTusPreviewMode(false);
            this.$(".tus-3d-viewer-container").addClass("d-none");
            if (this._pbrViewer) {
                this._pbrViewer.pause();
            }
            const active = this.currentElement || this.canvas?.getActiveObject();
            if (active) {
                requestAnimationFrame(() => {
                    this._showObjectToolbar(active);
                    requestAnimationFrame(() => {
                        const panel = $(".tool.active").data("panel");
                        if (panel) {
                            this._activateObjectToolPanel(panel);
                        }
                        this._syncMobilePanelState();
                        this._scrollActiveToolIntoView();
                    });
                });
            }
        },

        _onElementSelected: function (elem) {
            this._super.apply(this, arguments);
            requestAnimationFrame(() => {
                const panel = $(".tool.active").data("panel");
                if (panel) {
                    this._activateObjectToolPanel(panel);
                }
                this._syncMobilePanelState();
                setTimeout(() => this._scrollActiveToolIntoView(), 80);
            });
        },

        _refresh3DPreview: async function () {
            if (!this._pbrViewer || this._tusEditorMode !== "3d-preview") {
                return;
            }
            const container = this._getActive3DContainer();
            const side = this._getActiveSide();
            const maps = await bakeMapsForSide(this, side, {
                globalVarnish: this._3dPreviewSettings?.varnishType || "none",
                reliefMm: this._3dPreviewSettings?.reliefMm ?? DEFAULT_RELIEF_MM,
            });
            if (!maps) {
                if (container) {
                    this._show3DFallback(
                        container,
                        this.emptyCanvasMode
                            ? "3D preview could not render this empty canvas side."
                            : "No product image found for 3D preview on this side."
                    );
                }
                return;
            }
            if (container) {
                this._clear3DFallback(container);
            }
            await this._pbrViewer.updateMaps(maps, {
                varnishType: this._3dPreviewSettings?.varnishType || "none",
                reliefMm: this._3dPreviewSettings?.reliefMm ?? DEFAULT_RELIEF_MM,
            });
        },

        _syncFinishPanelFromObject: function (obj) {
            if (!obj) {
                return;
            }
            ensureObjectFinishDefaults(obj);
            const effect = obj.tusFinishEffect || "none";
            const relief = obj.tusReliefMm ?? DEFAULT_RELIEF_MM;
            const varnish = obj.tusVarnishType || "none";
            const foilMetal = obj.tusFoilMetal || DEFAULT_FOIL_METAL;
            this.$(".tus-finish-effect").val(effect);
            this.$(".tus-finish-relief").val(relief);
            this.$(".tus-finish-relief-value").text(`${parseFloat(relief).toFixed(2)} mm`);
            this.$(".tus-finish-varnish").val(varnish);
            this.$(".tus-finish-foil-metal").val(foilMetal);
            this._updateFinishPanelVisibility(effect);
        },

        _updateFinishPanelVisibility: function (effect) {
            const showRelief =
                effect === FINISH_EMBOSS ||
                effect === FINISH_DEBOSS ||
                effect === FINISH_FOIL_EMBOSS;
            const showFoilMetal = isFoilFinish(effect);
            const showVarnish = !isFoilFinish(effect);
            this.$(".tus-finish-relief-row").toggleClass("d-none", !showRelief);
            this.$(".tus-finish-foil-row").toggleClass("d-none", !showFoilMetal);
            this.$(".tus-finish-varnish-row").toggleClass("d-none", !showVarnish);
        },

        _getFinishTargetObjects: function () {
            const active = this.currentElement || this.canvas?.getActiveObject();
            if (!active) {
                return [];
            }
            if (active.type === "activeSelection" && typeof active.getObjects === "function") {
                return active.getObjects().filter((o) => !o.center_line && !o.extra_elem);
            }
            return [active];
        },

        _getAllCanvasFinishTargets: function () {
            if (!this.canvas) {
                return [];
            }
            return this.canvas
                .getObjects()
                .filter((o) => !o.center_line && !o.extra_elem && !o.tusFoilPreviewOverlay);
        },

        _applyFinishToTargets: function (partial, options = {}) {
            const targets = options.applyToAllCanvas
                ? this._getAllCanvasFinishTargets()
                : this._getFinishTargetObjects();
            if (!targets.length) {
                return;
            }
            const previewTasks = [];
            for (const obj of targets) {
                applyFinishFields(obj, partial);
                previewTasks.push(applyCanvasFinishPreview(obj));
            }
            Promise.all(previewTasks).then(() => this.canvas?.requestRenderAll());
            this._schedule3DPreviewRefresh();
            this.saveState();
        },

        _onFinishEffectChange: function (ev) {
            const effect = ev.currentTarget.value;
            this._updateFinishPanelVisibility(effect);
            const partial = { tusFinishEffect: effect };
            if (isFoilFinish(effect)) {
                partial.tusFoilMetal =
                    this.$(".tus-finish-foil-metal").val() || DEFAULT_FOIL_METAL;
            } else {
                partial.tusFoilMetal = null;
            }
            this._applyFinishToTargets(partial);
        },

        _onFinishReliefChange: function (ev) {
            const reliefMm = parseFloat(ev.currentTarget.value) || 0;
            this.$(".tus-finish-relief-value").text(`${reliefMm.toFixed(2)} mm`);
            this._applyFinishToTargets({ tusReliefMm: reliefMm });
        },

        _onFinishVarnishChange: function (ev) {
            this._applyFinishToTargets({
                tusVarnishType: ev.currentTarget.value,
            });
        },

        _onFinishFoilMetalChange: function (ev) {
            this._applyFinishToTargets({
                tusFoilMetal: ev.currentTarget.value,
            });
        },

        destroy: function () {
            if (this._on3DVisibilityChange) {
                document.removeEventListener("visibilitychange", this._on3DVisibilityChange);
            }
            this._viewerControls?.dispose();
            this._pbrViewer?.dispose();
            this._viewerControls = null;
            this._pbrViewer = null;
            return this._super.apply(this, arguments);
        },

        _setTusPreviewMode: function (enabled) {
            const sides = this.canvasesBySide || {};
            for (const side of Object.keys(sides)) {
                for (const entry of sides[side] || []) {
                    const canvas = entry.canvas;
                    if (!canvas) {
                        continue;
                    }
                    canvas.discardActiveObject();
                    canvas.selection = !enabled;
                    canvas.skipTargetFind = !!enabled;
                    canvas.defaultCursor = enabled ? "default" : "move";
                    canvas.hoverCursor = enabled ? "default" : "move";

                    if (canvas._dimOverlayEl) {
                        canvas._dimOverlayEl.style.display = "none";
                    }
                    if (typeof this._hideAlignmentGuides === "function") {
                        this._hideAlignmentGuides(canvas);
                    }
                    if (entry.wrapper) {
                        entry.wrapper.classList.toggle("tus-preview-hidden-area", enabled);
                    }

                    canvas.getObjects().forEach((obj) => {
                        if (obj.extra_elem || obj.center_line) {
                            return;
                        }
                        obj.set({
                            selectable: !enabled,
                            evented: !enabled,
                            hasControls: !enabled,
                            hasBorders: !enabled,
                        });
                    });
                    canvas.requestRenderAll();
                }
            }
        },

        _onTusZoomIn: function (ev) {
            ev.preventDefault();
            this._applyTusZoom(this._tusZoom + 10);
        },

        _onTusZoomOut: function (ev) {
            ev.preventDefault();
            this._applyTusZoom(this._tusZoom - 10);
        },

        _onTusZoomReset: function (ev) {
            ev.preventDefault();
            this._applyTusZoom(100);
        },

        _applyTusZoom: function (pct) {
            this._tusZoom = Math.min(200, Math.max(50, pct));
            this.$(".tus-zoom-value").text(`${this._tusZoom}%`);
            const scale = this._tusZoom / 100;
            this.$(".main_wrapper .tab-content").css({ transform: "" });
            this.$(".main_wrapper .tab-content > .tab-pane.active .product-stage").css({
                transform: `scale(${scale})`,
                "transform-origin": "center center",
            });
            const activePane = this.$(".main_wrapper .tab-pane.active")[0];
            if (activePane && typeof this._syncPreviewBoxToImage === "function") {
                this._syncPreviewBoxToImage(activePane);
            }
        },

        _updateSaveProductState: function (hasDesign) {
            const $save = this.$(".tus-save-product-btn");
            if (!$save.length) {
                return;
            }
            let dirty = !!hasDesign;
            if (!dirty && this.canvas) {
                const objects = this.canvas.getObjects().filter(
                    (o) => !o.custom || o.custom.kind !== "design_area"
                );
                dirty = objects.length > 0;
            }
            $save.prop("disabled", !dirty);
            $save.toggleClass("disabled", !dirty);
            const $cart = this.$(".tus-header-cart-btn");
            $cart.prop("disabled", !dirty);
            $cart.toggleClass("disabled", !dirty);
            this.$(".tus-menu-save-product")
                .prop("disabled", !dirty)
                .toggleClass("disabled", !dirty);
        },

        _scrollActiveToolIntoView: function () {
            if (!this._isMobileRefLayout() || !this.$(".fabric_container").hasClass("tus-toolbar-open")) {
                return;
            }
            const nav = this.$(".new_toolbar_container .tools-nav")[0];
            const tool = this.$(".new_toolbar_container .tools-nav .tool.active")[0];
            if (!nav || !tool) {
                return;
            }
            const target = tool.offsetLeft - (nav.clientWidth - tool.clientWidth) / 2;
            nav.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
        },

        _loadPersonalizerConfig: function () {
            const configEl = document.querySelector('input[name="personalizer_config"]');
            if (!configEl || !configEl.value) {
                this.personalizerConfig = {};
                return;
            }
            try {
                this.personalizerConfig = JSON.parse(configEl.value);
            } catch (e) {
                this.personalizerConfig = {};
            }
        },

        _isFeatureDisabled: function (featureKey) {
            if (!this.personalizerConfig || Object.keys(this.personalizerConfig).length === 0) {
                return false;
            }
            return this.personalizerConfig[featureKey] === false;
        },

        _is3dPreviewEnabled: function () {
            return this.personalizerConfig?.show_3d_preview === true;
        },

        _fixDefaultActiveSidebar: function () {
            const activeItem = this.el.querySelector(".fab_item.active");
            if (!activeItem) {
                const firstVisible = this.el.querySelector(".fab_item");
                if (firstVisible) {
                    firstVisible.classList.add("active");
                    const option = firstVisible.dataset.option;
                    const section = this.el.querySelector(`.section_${option}`);
                    if (section) {
                        section.classList.add("active");
                    }
                    this._activeSidebarOption = option;
                }
            } else if (activeItem.dataset.option) {
                this._activeSidebarOption = activeItem.dataset.option;
                const section = this.el.querySelector(`.section_${activeItem.dataset.option}`);
                if (section && !section.classList.contains("active")) {
                    section.classList.add("active");
                }
            }
            if (typeof this._syncOptionsPanelTitle === "function") {
                this._syncOptionsPanelTitle();
            }
        },

        _onSwapImageVarinatImage: function () {
            if (this._isFeatureDisabled("enable_swap")) {
                return;
            }
            return this._super.apply(this, arguments);
        },

        _selectFirstVariantOnLoad: function () {
            if (this._isFeatureDisabled("enable_swap")) {
                return;
            }
            return this._super.apply(this, arguments);
        },

        _onAddText: function () {
            if (this._isFeatureDisabled("enable_text")) {
                return;
            }
            return this._super.apply(this, arguments);
        },

        _onEditText: function () {
            if (this._isFeatureDisabled("enable_text")) {
                return;
            }
            return this._super.apply(this, arguments);
        },

        _onAddImage: function () {
            if (this._isFeatureDisabled("enable_image")) {
                return;
            }
            return this._super.apply(this, arguments);
        },

        _onAddQrCode: function () {
            if (this._isFeatureDisabled("enable_image")) {
                return;
            }
            return this._super.apply(this, arguments);
        },

        _onUploadModuleTabClick: function () {
            if (this._isFeatureDisabled("enable_image")) {
                return;
            }
            return this._super.apply(this, arguments);
        },

        _onQrColorSwatchClick: function () {
            if (this._isFeatureDisabled("enable_image")) {
                return;
            }
            return this._super.apply(this, arguments);
        },

        _onAddDefaultImage: function () {
            if (this._isFeatureDisabled("enable_image")) {
                return;
            }
            return this._super.apply(this, arguments);
        },

        _onDeleteImage: function () {
            if (this._isFeatureDisabled("enable_image")) {
                return;
            }
            return this._super.apply(this, arguments);
        },

        _onSaveCanvas: function () {
            if (this._getShareToken && this._getShareToken()) {
                return this._onSaveSharedDesign();
            }
            if (this._isFeatureDisabled("enable_templates")) {
                return;
            }
            return this._super.apply(this, arguments);
        },

        _onSelectTemplate: function () {
            if (this._isFeatureDisabled("enable_templates")) {
                return;
            }
            return this._super.apply(this, arguments);
        },

        _onClickPreview: function () {
            if (this._isFeatureDisabled("enable_preview")) {
                return;
            }
            return this._super.apply(this, arguments);
        },

        _onDownloadCanvas: function () {
            if (this._isFeatureDisabled("enable_download")) {
                return;
            }
            return this._super.apply(this, arguments);
        },

        _onShareDesign: function () {
            if (this._isFeatureDisabled("enable_share")) {
                return;
            }
            return this._super.apply(this, arguments);
        },
    });
}
