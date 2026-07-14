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

export const fabricHelpMixin = {
    _getHelpContent: function () {
        if (this._helpContent !== undefined) {
            return this._helpContent;
        }
        const node = document.getElementById("tus-help-content-json");
        if (!node || !node.value) {
            this._helpContent = {};
            return this._helpContent;
        }
        try {
            const parsed = JSON.parse(node.value);
            this._helpContent = parsed && typeof parsed === "object" ? parsed : {};
        } catch (_err) {
            this._helpContent = {};
        }
        return this._helpContent;
    },

    _onHelpButtonClick: function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        this._openHelpDialog();
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

    _openHelpDialog: function () {
        const help = this._getHelpContent();
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
        const shareUrl = (this._getHelpContent().share_url) || "";
        if (!shareUrl) {
            this.notification.add(_t("No help link available."), { type: "warning" });
            return;
        }
        await this._copyTextToClipboard(shareUrl, _t("Help link copied to clipboard."));
    },
};
