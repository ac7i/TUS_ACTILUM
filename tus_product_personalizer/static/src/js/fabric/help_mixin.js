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
    vdp: "vdp",
    ai: "ai",
};

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
        if (contextKey && byContext[contextKey]) {
            return byContext[contextKey];
        }
        if (byContext.main) {
            return byContext.main;
        }
        return {};
    },

    _resolveCurrentHelpContext: function () {
        // If an object is active on canvas, resolve help context from object type
        try {
            const activeCanvas = this._getActiveCanvas ? this._getActiveCanvas() : null;
            const activeObj = activeCanvas ? activeCanvas.getActiveObject() : null;
            if (activeObj) {
                if (activeObj.tusFinishEffect || activeObj.tusVarnishType || activeObj.tusTextureActive) {
                    return "finish";
                }
                const type = activeObj.type;
                if (type === "i-text" || type === "text" || type === "textbox") {
                    return "text";
                }
                if (type === "image") {
                    return "image";
                }
                if (type === "path" || type === "rect" || type === "circle" || type === "polygon" || type === "triangle" || type === "group") {
                    return "shapes";
                }
            }
        } catch (_e) {
            // fallback
        }
        const panelOption = this.$(".options_content").attr("data-panel-option")
            || this.$(".fab_item.active").data("option")
            || this.$(".sidebar_options .fab_item.active").attr("data-option")
            || "main";
        return PANEL_HELP_CONTEXT[panelOption] || panelOption || "main";
    },

    _syncPanelHelpButton: function () {
        const help = this._getHelpContent();
        const byContext = help.by_context || {};
        const currentContext = this._resolveCurrentHelpContext();
        
        this.$(".tus-panel-help-btn").each((idx, btn) => {
            const $btn = $(btn);
            const explicit = $btn.attr("data-help-context");
            const contextKey = explicit || currentContext;
            const hasHelp = Boolean((contextKey && byContext[contextKey]) || byContext["main"]);
            $btn.toggleClass("d-none", !hasHelp);
        });
        
        const hasMainHelp = Boolean(byContext["main"] && (byContext["main"].body || byContext["main"].video_url || byContext["main"].name));
        this.$("#tus-help-btn").toggleClass("d-none", !hasMainHelp);
    },

    _onHelpButtonClick: function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        this._openHelpDialog("main");
    },

    _onPanelHelpButtonClick: function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        const explicit = $(ev.currentTarget).attr("data-help-context");
        const contextKey = explicit || this._resolveCurrentHelpContext();
        this._openHelpDialog(contextKey);
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
        const help = this._getHelpContentForContext(contextKey || "main");
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
        $dialog.data("help-context", contextKey || "main");

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
