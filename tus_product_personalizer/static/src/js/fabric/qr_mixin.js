/** @odoo-module **/

import { _t } from "@web/core/l10n/translation";

export const fabricQrMixin = {
    _getQrPayload: function ($section) {
        return ($section.find(".qr-url-input").val() || "").trim();
    },

    _getSelectedQrColor: function ($section) {
        const $active = $section.find(".qr-color-swatch.active");
        return ($active.data("color") || "#000000").toString();
    },

    _onUploadModuleTabClick: function (ev) {
        ev.preventDefault();
        const tab = $(ev.currentTarget).data("uploadTab");
        const $section = $(ev.currentTarget).closest(".section_image");
        if (!tab || !$section.length) {
            return;
        }

        $section.find(".upload-module-tab").removeClass("active").attr("aria-selected", "false");
        $(ev.currentTarget).addClass("active").attr("aria-selected", "true");
        $section.find(".upload-module-pane").removeClass("active");
        $section.find(`.upload-module-pane.${tab}-pane`).addClass("active");
    },

    _onQrColorSwatchClick: function (ev) {
        ev.preventDefault();
        const $swatch = $(ev.currentTarget);
        const $group = $swatch.closest(".qr-color-swatches");
        $group.find(".qr-color-swatch").removeClass("active");
        $swatch.addClass("active");
    },

    _onAddQrCode: async function (ev) {
        ev.preventDefault();
        const $section = $(ev.currentTarget).closest(".section_image");
        const payload = this._getQrPayload($section);

        if (!payload) {
            this.notification.add(_t("Please enter a URL or text."), { type: "danger" });
            return;
        }

        if (!window.QRCode || typeof window.QRCode.toDataURL !== "function") {
            this.notification.add(_t("QR code generator is not available."), { type: "danger" });
            return;
        }

        const qrColor = this._getSelectedQrColor($section);

        this._activeSidebarOption = "image";
        this._highlightSidebarOption("image", { showPanel: true });
        this.startLoader(_t("Adding QR Code…"), { light: true });

        try {
            const dataUrl = await window.QRCode.toDataURL(payload, {
                width: 400,
                margin: 1,
                color: {
                    dark: qrColor,
                    light: "#ffffff",
                },
            });
            const base64 = dataUrl.split(",")[1];
            if (!base64) {
                throw new Error(_t("Could not generate QR code."));
            }

            const result = await this.rpc("/canvas/upload_image", {
                filename: "qr-code.png",
                filedata: base64,
                vectorize: false,
                auto_detect: false,
            });
            if (result.error) {
                throw new Error(
                    result.error === "read_only"
                        ? _t("This shared design is read-only.")
                        : result.error
                );
            }

            await this._loadSvgGroupOnCanvas(result.svg, {
                backendId: result.id,
                filename: result.name,
                targetCanvas: this.canvas,
                isEmbeddedPhotoSvg: this._isEmbeddedPhotoSvgFromUpload(result, result.svg),
            });
            $section.find(".qr-url-input").val("");
        } catch (error) {
            console.error("Add QR code failed:", error);
            const msg =
                (error && error.message) ||
                _t("Could not add the QR code to the canvas.");
            this.notification.add(msg, { type: "danger" });
        } finally {
            this.removeLoader();
        }
    },
};
