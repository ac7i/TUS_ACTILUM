/** @odoo-module **/

import { _t } from "@web/core/l10n/translation";

function escapeAttr(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function normalizeVideoEmbedUrl(url) {
    const raw = (url || "").trim();
    if (!raw) {
        return "";
    }
    if (raw.includes("/embed/") || raw.includes("player.vimeo.com")) {
        return raw;
    }
    if (raw.includes("youtu.be/")) {
        const videoId = raw.split("youtu.be/")[1]?.split(/[?&#]/)[0];
        return videoId ? `https://www.youtube.com/embed/${videoId}` : raw;
    }
    if (raw.includes("youtube.com/watch")) {
        try {
            const videoId = new URL(raw).searchParams.get("v");
            return videoId ? `https://www.youtube.com/embed/${videoId}` : raw;
        } catch (_err) {
            return raw;
        }
    }
    if (raw.includes("vimeo.com/")) {
        const videoId = raw.replace(/\/$/, "").split("/").pop()?.split("?")[0];
        return videoId && /^\d+$/.test(videoId)
            ? `https://player.vimeo.com/video/${videoId}`
            : raw;
    }
    return raw;
}

const OBJECT_TOOL_HELP_CONTEXT = {
    color: "text_color",
    edit: "text_edit",
    size: "text_size",
    fonts: "text_fonts",
    format: "text_format",
    curved: "text_curved",
    transform: "text_transform",
    vdp: "vdp",
    effects: "image_effects",
    finish: "finish",
    remove_bg: "image_remove_bg",
    vectorize: "image_vectorize",
    replace: "image_replace",
    flip: "image_flip",
    opacity: "image_opacity",
    duplicate: "object_duplicate",
    remove: "object_remove",
};

const PANEL_HELP_CONTEXT = {
    swap: "swap",
    image: "image",
    text: "text",
    shapes: "shapes",
    clipart: "clipart",
    textures: "textures",
    layers: "layers",
    templates: "templates",
    finish: "finish",
    finish_texture: "finish_texture",
    finish_varnish: "finish_varnish",
    vdp: "vdp",
    ai: "ai",
    image_effects: "image_effects",
    image_remove_bg: "image_remove_bg",
    image_vectorize: "image_vectorize",
    image_replace: "image_replace",
    image_flip: "image_flip",
    image_opacity: "image_opacity",
    image_transform: "image_transform",
    image_qr: "image_qr",
    text_color: "text_color",
    text_fill: "text_fill",
    text_stroke: "text_stroke",
    text_shadow: "text_shadow",
    text_edit: "text_edit",
    text_size: "text_size",
    text_fonts: "text_fonts",
    text_format: "text_format",
    text_transform: "text_transform",
    text_curved: "text_curved",
    object_duplicate: "object_duplicate",
    object_remove: "object_remove",
};

/** Parent fallback when a child context has no active help record. */
const HELP_CONTEXT_PARENT = {
    finish_texture: "finish",
    finish_varnish: "finish",
    image_effects: "image",
    image_remove_bg: "image",
    image_vectorize: "image",
    image_replace: "image",
    image_flip: "image",
    image_opacity: "image",
    image_transform: "image",
    image_qr: "image",
    text_fill: "text_color",
    text_stroke: "text_color",
    text_shadow: "text_color",
    text_color: "text",
    text_edit: "text",
    text_size: "text",
    text_fonts: "text",
    text_format: "text",
    text_transform: "text",
    text_curved: "text",
    object_duplicate: "main",
    object_remove: "main",
};

function hasHelpRecord(record) {
    return Boolean(record && (record.body || record.video_url || record.name));
}

export const fabricHelpMixin = {
    _getHelpContent: function () {
        if (this._helpContent !== undefined) {
            return this._helpContent;
        }
        const node = document.getElementById("tus-help-content-json");
        if (!node || !node.value) {
            this._helpContent = { by_context: {} };
            return this._helpContent;
        }
        try {
            const parsed = JSON.parse(node.value);
            this._helpContent = parsed && typeof parsed === "object"
                ? parsed
                : { by_context: {} };
            if (!this._helpContent.by_context) {
                this._helpContent.by_context = {};
            }
        } catch (_err) {
            this._helpContent = { by_context: {} };
        }
        return this._helpContent;
    },

    _getHelpContentForContext: function (contextKey) {
        const help = this._getHelpContent();
        const byContext = help.by_context || {};
        let key = contextKey || "main";
        const seen = new Set();
        while (key && !seen.has(key)) {
            seen.add(key);
            if (hasHelpRecord(byContext[key])) {
                return byContext[key];
            }
            key = HELP_CONTEXT_PARENT[key] || (key !== "main" ? "main" : null);
        }
        return {};
    },

    _resolveHelpContextKey: function (preferredKey) {
        const help = this._getHelpContent();
        const byContext = help.by_context || {};
        let key = preferredKey || "main";
        const seen = new Set();
        while (key && !seen.has(key)) {
            seen.add(key);
            if (hasHelpRecord(byContext[key])) {
                return key;
            }
            key = HELP_CONTEXT_PARENT[key] || (key !== "main" ? "main" : null);
        }
        return "main";
    },

    _isObjectToolbarOpen: function () {
        const $toolbar = this.$(".new_toolbar_container");
        return $toolbar.length > 0 && !$toolbar.hasClass("d-none");
    },

    _isTextLikeSelection: function () {
        const obj = this.canvas?.getActiveObject?.();
        if (!obj) {
            return false;
        }
        const type = String(obj.type || "").toLowerCase();
        return type.includes("text") || Boolean(obj.tusVdpKey);
    },

    /**
     * Sidebar rail Help (#tus-help-btn): active main menu
     * (Product, Add Image, QR tab, etc.).
     */
    _resolveSidebarHelpContext: function () {
        const activeFab = this.$(".sidebar_options .fab_item.active");
        if (activeFab.length && activeFab.data("option")) {
            const option = String(activeFab.data("option"));
            if (option === "image") {
                const qrPane = this.$("#upload-module-pane-qr");
                if (qrPane.length && qrPane.hasClass("active")) {
                    return "image_qr";
                }
            }
            return PANEL_HELP_CONTEXT[option] || option;
        }

        const activeSection = this.$(".section_options.active");
        if (activeSection.length) {
            const classes = (activeSection.attr("class") || "").split(/\s+/);
            for (const cls of classes) {
                if (cls.startsWith("section_") && cls !== "section_options") {
                    const key = cls.replace("section_", "");
                    return PANEL_HELP_CONTEXT[key] || key;
                }
            }
        }

        const panelOption = this.$(".options_content").attr("data-panel-option") || "main";
        return PANEL_HELP_CONTEXT[panelOption] || panelOption || "main";
    },

    /**
     * Object dock Help (#tus-object-help-btn): active image/text tool.
     */
    _resolveObjectToolHelpContext: function () {
        const activeTool = this.$(".new_toolbar_container .tool.active");
        if (!activeTool.length) {
            return null;
        }
        const panel = String(activeTool.data("panel") || "");
        if (!panel) {
            return null;
        }
        if (panel === "transform") {
            return this._isTextLikeSelection() ? "text_transform" : "image_transform";
        }
        if (panel === "color") {
            const activeTab =
                this.$(".section_tool_color .nav-link.active").attr("href") || "#fill";
            if (String(activeTab).includes("stroke")) {
                return "text_stroke";
            }
            if (String(activeTab).includes("shadow")) {
                return "text_shadow";
            }
            return "text_fill";
        }
        if (panel === "finish") {
            // Texture / Varnish are siblings in one panel — use last focused block,
            // else parent "finish". Inline help buttons also set data-help-context.
            if (this._finishHelpSubContext === "finish_texture"
                || this._finishHelpSubContext === "finish_varnish") {
                return this._finishHelpSubContext;
            }
            return "finish";
        }
        return OBJECT_TOOL_HELP_CONTEXT[panel] || PANEL_HELP_CONTEXT[panel] || panel;
    },

    _onFinishHelpBlockFocus: function (ev) {
        const $block = $(ev.currentTarget).closest(
            ".tus-finish-texture-block, .tus-finish-varnish-block"
        );
        if ($block.hasClass("tus-finish-texture-block")) {
            this._finishHelpSubContext = "finish_texture";
        } else if ($block.hasClass("tus-finish-varnish-block")) {
            this._finishHelpSubContext = "finish_varnish";
        }
        if (typeof this._syncPanelHelpButton === "function") {
            this._syncPanelHelpButton();
        }
    },

    /** @deprecated use _resolveSidebarHelpContext / _resolveObjectToolHelpContext */
    _resolveCurrentHelpContext: function () {
        if (this._isObjectToolbarOpen()) {
            const objectContext = this._resolveObjectToolHelpContext();
            if (objectContext) {
                return objectContext;
            }
        }
        return this._resolveSidebarHelpContext();
    },

    _syncPanelHelpButton: function () {
        const byContext = this._getHelpContent().by_context || {};

        // Optional legacy panel help icons (if any markup still exists)
        const sidebarContext = this._resolveSidebarHelpContext();
        this.$(".tus-panel-help-btn").each((idx, btn) => {
            const $btn = $(btn);
            const explicit = $btn.attr("data-help-context");
            const resolved = this._resolveHelpContextKey(explicit || sidebarContext);
            $btn.toggleClass("d-none", !hasHelpRecord(byContext[resolved]));
        });

        const objectContext = this._resolveObjectToolHelpContext();
        const objectHelp = objectContext
            ? this._getHelpContentForContext(objectContext)
            : {};
        this.$("#tus-object-help-btn").toggleClass(
            "d-none",
            !this._isObjectToolbarOpen() || !hasHelpRecord(objectHelp)
        );

        const railResolved = this._resolveHelpContextKey(sidebarContext);
        this.$("#tus-help-btn").toggleClass(
            "d-none",
            !hasHelpRecord(byContext[railResolved])
        );
    },

    _onHelpButtonClick: function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        // Existing bottom sidebar Help → active main menu (e.g. Product / swap)
        const contextKey = this._resolveHelpContextKey(this._resolveSidebarHelpContext());
        this._openHelpDialog(contextKey);
    },

    _onObjectHelpButtonClick: function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        // Existing object-toolbar Help → active image/text tool
        const contextKey = this._resolveHelpContextKey(
            this._resolveObjectToolHelpContext() || this._resolveSidebarHelpContext()
        );
        this._openHelpDialog(contextKey);
    },

    _onPanelHelpButtonClick: function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        const explicit = $(ev.currentTarget).attr("data-help-context");
        const contextKey = this._resolveHelpContextKey(
            explicit || this._resolveSidebarHelpContext()
        );
        this._openHelpDialog(contextKey);
    },

    _onColorHelpTabClick: function () {
        // Let Bootstrap switch the tab, then refresh object-help context.
        setTimeout(() => {
            if (typeof this._syncPanelHelpButton === "function") {
                this._syncPanelHelpButton();
            }
        }, 0);
    },

    _onHelpDialogClose: function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        this._closeHelpDialog();
    },

    _onHelpBackdropClick: function (ev) {
        ev.preventDefault();
        this._closeHelpDialog();
    },

    _openHelpDialog: function (contextKey) {
        const resolvedKey = this._resolveHelpContextKey(contextKey || "main");
        const help = this._getHelpContentForContext(resolvedKey);
        const $dialog = $(".tus-help-dialog");
        const $title = $dialog.find(".tus-help-dialog-title");
        const $videoWrap = $dialog.find(".tus-help-video-wrap");
        const $htmlContent = $dialog.find(".tus-help-html-content");
        const $empty = $dialog.find(".tus-help-empty");
        const $copyBtn = $dialog.find(".tus-help-copy-link");
        const hasContent = Boolean(help.name || help.body || help.video_url);

        $title.text(help.name || _t("Help"));
        $htmlContent.empty().toggleClass("d-none", !help.body);
        $empty.toggleClass("d-none", hasContent);
        $copyBtn.toggleClass("d-none", !help.share_url);
        $dialog.find(".tus-help-dialog-footer").toggleClass("d-none", !help.share_url);
        $dialog.find(".tus-help-share-url").val(help.share_url || "");
        $dialog.data("help-context", resolvedKey);

        if (help.body) {
            $htmlContent.html(help.body);
        }

        const embedUrl = normalizeVideoEmbedUrl(help.video_url);
        if (embedUrl) {
            const safeUrl = escapeAttr(embedUrl);
            const safeTitle = escapeAttr(help.name || "Help video");
            $videoWrap
                .removeClass("d-none")
                .html(
                    `<div class="tus-help-video-ratio"><iframe src="${safeUrl}" title="${safeTitle}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen="allowfullscreen"></iframe></div>`
                );
        } else {
            $videoWrap.addClass("d-none").empty();
        }

        $dialog.removeClass("d-none").addClass("open");
        $(".tus-help-backdrop").removeClass("d-none");
        $dialog.find(".tus-help-dialog-close").trigger("focus");
    },

    _closeHelpDialog: function () {
        $(".tus-help-dialog").removeClass("open").addClass("d-none");
        $(".tus-help-backdrop").addClass("d-none");
    },

    _onHelpCopyLink: async function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        const contextKey = $(".tus-help-dialog").data("help-context") || "main";
        const shareUrl = (this._getHelpContentForContext(contextKey).share_url) || "";
        if (!shareUrl) {
            this.notification.add(_t("No help link available."), { type: "warning" });
            return;
        }
        await this._copyTextToClipboard(shareUrl, _t("Help link copied to clipboard."));
    },
};
