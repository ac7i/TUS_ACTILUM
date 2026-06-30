/** @odoo-module **/

import { rpc } from "@web/core/network/rpc";
import { _t } from "@web/core/l10n/translation";
import { GUEST_ACCESS_REFRESH_MS, SHARE_WRITE_ROUTES } from "./constants";

export const fabricShareMixin = {
    _installShareReadOnlyRpcGuard: function () {
        const baseRpc = rpc;
        const self = this;
        const shareWriteRoutes = new Set(SHARE_WRITE_ROUTES);
        this.rpc = async function (route, params) {
            if (self._isShareReadOnly() && shareWriteRoutes.has(route)) {
                self._notifyShareReadOnlyOnce();
                return { error: "read_only" };
            }
            return baseRpc(route, params);
        };
    },

    _notifyShareReadOnlyOnce: function () {
        const now = Date.now();
        if (this._shareReadOnlyWarnAt && now - this._shareReadOnlyWarnAt < 1500) {
            return;
        }
        this._shareReadOnlyWarnAt = now;
        this.notification.add(_t("This shared design is view-only."), { type: "warning" });
    },

    _rejectIfShareReadOnly: function () {
        if (!this._isShareReadOnly()) {
            return false;
        }
        this._notifyShareReadOnlyOnce();
        return true;
    },

    _isShareReadOnlyError: function (err) {
        return !!(err && (err.shareReadOnly || err.message === "read_only"));
    },

    _getShareDesignPayload: function () {
        const shareUrl = (this.$("#tus-share-popover-url").val() || "").trim();
        const message = _t("Check out my product design: ") + shareUrl;
        return {
            url: shareUrl,
            message: message,
            title: _t("My product design"),
        };
    },

    _shareDesignViaChannel: async function (channel) {
        const payload = this._getShareDesignPayload();
        if (!payload.url) {
            this.notification.add(_t("No share link available yet."), { type: "warning" });
            return;
        }

        const encodedUrl = encodeURIComponent(payload.url);
        const encodedMessage = encodeURIComponent(payload.message);
        const encodedTitle = encodeURIComponent(payload.title);

        switch (channel) {
            case "whatsapp":
                window.open(
                    `https://api.whatsapp.com/send?text=${encodedMessage}`,
                    "_blank",
                    "noopener,noreferrer"
                );
                break;
            case "facebook":
                window.open(
                    `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
                    "_blank",
                    "noopener,noreferrer"
                );
                break;
            case "instagram":
                await this._copyTextToClipboard(
                    payload.url,
                    _t("Link copied. Paste it in your Instagram story, bio, or DM.")
                );
                break;
            case "twitter":
                window.open(
                    `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}`,
                    "_blank",
                    "noopener,noreferrer"
                );
                break;
            case "linkedin":
                window.open(
                    `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
                    "_blank",
                    "noopener,noreferrer"
                );
                break;
            case "telegram":
                window.open(
                    `https://t.me/share/url?url=${encodedUrl}&text=${encodedMessage}`,
                    "_blank",
                    "noopener,noreferrer"
                );
                break;
            case "email":
                window.location.href =
                    `mailto:?subject=${encodedTitle}&body=${encodedMessage}`;
                break;
            case "native":
                try {
                    await navigator.share({
                        title: payload.title,
                        text: _t("Check out my product design"),
                        url: payload.url,
                    });
                } catch (shareErr) {
                    if (shareErr && shareErr.name !== "AbortError") {
                        console.warn("Native share failed:", shareErr);
                    }
                }
                break;
            case "download":
                this._hideSharePopover();
                this.$(".download_btn").first().trigger("click");
                break;
            default:
                break;
        }
    },

    _copyTextToClipboard: async function (text, successMessage) {
        if (!text) {
            return false;
        }
        try {
            await navigator.clipboard.writeText(text);
        } catch (_err) {
            const $temp = $("<input>");
            $("body").append($temp);
            $temp.val(text).select();
            document.execCommand("copy");
            $temp.remove();
        }
        if (successMessage) {
            this.notification.add(successMessage, { type: "success" });
        }
        return true;
    },

    _isShareReadOnly: function () {
        const shareToken = this._getShareToken();
        if (!shareToken) {
            return false;
        }
        return $('input[name="share_can_write"]').val() !== "1";
    },

    _isShareCollaborator: function () {
        const shareToken = this._getShareToken();
        if (!shareToken) {
            return false;
        }
        return $('input[name="share_is_owner"]').val() !== "1";
    },

    _getShareToken: function () {
        let token = $('input[name="share_token"]').val();
        if (!token) {
            const pathParts = window.location.pathname.split("/");
            const shareIndex = pathParts.indexOf("share");
            if (shareIndex !== -1 && pathParts[shareIndex + 1]) {
                token = pathParts[shareIndex + 1];
            }
        }
        return token || "";
    },

    _getShareGuestAccId: function () {
        const fromInput = parseInt($('input[name="share_guest_acc"]').val(), 10);
        if (fromInput) {
            return fromInput;
        }
        const fromUrl = parseInt(new URLSearchParams(window.location.search).get("acc"), 10);
        return fromUrl || 0;
    },

    _applyShareGuestAccessState: function (canWrite) {
        $('input[name="share_can_write"]').val(canWrite ? "1" : "0");
        $('input[name="share_mode"]').val(canWrite ? "edit" : "view");
        const $container = $(".fabric_container");
        if (canWrite) {
            $container.removeClass("tus-preview-mode tus-share-view-only");
            if (this._setTusPreviewMode) {
                this._setTusPreviewMode(false);
            }
        } else {
            $container.addClass("tus-preview-mode tus-share-view-only");
            if (this._setTusPreviewMode) {
                this._setTusPreviewMode(true);
            }
        }
    },

    _refreshGuestShareAccess: async function () {
        const token = this._getShareToken();
        const accId = this._getShareGuestAccId();
        if (!token || !accId || $('input[name="share_is_owner"]').val() === "1") {
            return;
        }
        try {
            const result = await this.rpc("/custom/design/share/guest_access", {
                token: token,
                acc: accId,
            });
            if (!result || result.error) {
                return;
            }
            const hadWrite = $('input[name="share_can_write"]').val() === "1";
            const canWrite = !!result.can_write;
            if (hadWrite === canWrite) {
                return;
            }
            this._applyShareGuestAccessState(canWrite);
            if (canWrite) {
                this.notification.add(
                    _t("You can now customize this design."),
                    { type: "success" }
                );
            } else {
                this.notification.add(
                    _t("Your access was changed to view only."),
                    { type: "warning" }
                );
            }
        } catch (e) {
            console.warn("Guest access refresh failed:", e);
        }
    },

    _bindGuestAccessRefresh: function () {
        if (this._guestAccessRefreshBound) {
            return;
        }
        const token = this._getShareToken();
        const accId = this._getShareGuestAccId();
        if (!token || !accId || $('input[name="share_is_owner"]').val() === "1") {
            return;
        }
        this._guestAccessRefreshBound = true;
        const self = this;
        const refresh = () => self._refreshGuestShareAccess();
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") {
                refresh();
            }
        });
        window.addEventListener("focus", refresh);
        this._guestAccessRefreshInterval = setInterval(refresh, GUEST_ACCESS_REFRESH_MS);
    },

    _ensureShareTokenInput: function (token) {
        if (!token) {
            return;
        }
        let $tokenInput = $('input[name="share_token"]');
        if (!$tokenInput.length) {
            $tokenInput = $('<input type="hidden" name="share_token"/>');
            $('input[name="product_id"]').first().after($tokenInput);
        }
        $tokenInput.val(token);
    },

    _exportDesignSnapshot: async function () {
        const snapshot = await this._runCanvasExportBatch(async () => {
            const cleanupTasks = [];
            const snap = await this._collectAllDesignStates(cleanupTasks);
            cleanupTasks.forEach((fn) => {
                try { fn(); } catch (_e) { }
            });
            return snap;
        });
        const dataUrl = await this._exportSideComposite(this.active_side, { format: "png", quality: 1 });
        const showMatrix = $('input[name="show_matrix_table"]').val() === "1";
        const colorId = showMatrix && this._getActiveColorId ? this._getActiveColorId() : null;
        if (colorId) {
            $('input[name="current_color_id"]').val(colorId);
        }
        return {
            snapshot,
            dataUrl,
            productId: parseInt($('input[name="product_id"]').val(), 10) || 0,
            showMatrix,
            colorId,
        };
    },

    _onShareDesign: async function (ev) {
        if (ev) {
            ev.preventDefault();
        }
        const $popover = this.$(".tus-share-popover");
        if ($popover.length && !$popover.hasClass("d-none")) {
            this._hideSharePopover();
            return;
        }

        const existingToken = this._getShareToken();
        if (existingToken) {
            try {
                const info = await this.rpc("/custom/design/share/get_info", { token: existingToken });
                if (info && !info.error) {
                    if (!info.is_owner) {
                        window.alert(_t("Only the design owner can manage sharing settings."));
                        return;
                    }
                    const shareUrl = `${window.location.origin}/product/designer/share/${existingToken}`;
                    this._showSharePopover(shareUrl, existingToken);
                    return;
                }
            } catch (e) {
                console.error("Failed to load share settings:", e);
            }
        }

        if (!this._canvasHasUserArtwork()) {
            window.alert(_t("Add something to your design before sharing."));
            return;
        }
        this.startLoader(_t("Creating share link..."));
        try {
            const exported = await this._exportDesignSnapshot();
            const shareMode = this.$("#tus-share-access-select").val() || "edit";
            const result = await this.rpc("/custom/design/share", {
                product_id: exported.productId,
                color_id: exported.colorId,
                use_matrix: exported.showMatrix,
                design_bundle: JSON.stringify(exported.snapshot),
                preview_image: exported.dataUrl,
                share_mode: shareMode,
                token: this._getShareToken() || undefined,
            });
            if (result.error === "login_required") {
                window.alert(_t("Please log in to share your design."));
                return;
            }
            if (result.error) {
                window.alert(_t("Could not create share link. Please try again."));
                return;
            }
            this._ensureShareTokenInput(result.token);
            this._showSharePopover(result.share_url, result.token);
        } catch (e) {
            console.error("Share design failed:", e);
            window.alert(_t("Could not create share link. Please try again."));
        } finally {
            this.removeLoader();
        }
    },

    _hideSharePopover: function () {
        const $popover = this.$(".tus-share-popover");
        if ($popover.length) {
            $popover.addClass("d-none");
        }
        this.$(".tus-share-people-menu").removeClass("show");
        $(document).off("mouseup.tusSharePopoverOutside");
    },

    _closeSharePeopleMenus: function () {
        this.$(".tus-share-people-menu").removeClass("show");
    },

    _renderShareAccessList: function (info) {
        const $list = this.$("#tus-share-people-list");
        if (!$list.length) {
            return;
        }
        $list.empty();

        const ownerInitial = (info.owner_email || "O").charAt(0).toUpperCase();
        $list.append(`
            <div class="tus-share-people-entry tus-share-people-entry--owner">
                <div class="tus-share-people-left">
                    <div class="tus-share-people-avatar">${ownerInitial}</div>
                    <div class="tus-share-people-email text-truncate" title="${info.owner_email}">${info.owner_email}</div>
                </div>
                <span class="tus-share-people-role">Owner</span>
            </div>
        `);

        (info.access_list || []).forEach((acc) => {
            const initial = acc.email.charAt(0).toUpperCase();
            const isSelectedEdit = acc.access_mode === "edit" ? "selected" : "";
            const isSelectedView = acc.access_mode === "view" ? "selected" : "";
            let permissionHtml = "";
            let menuHtml = "";

            if (info.is_owner) {
                permissionHtml = `
                    <select class="form-select form-select-sm border-0 bg-transparent tus-share-inline-select tus-share-people-select" data-email="${acc.email}">
                        <option value="edit" ${isSelectedEdit}>Can customize</option>
                        <option value="view" ${isSelectedView}>Can view only</option>
                    </select>
                `;
                menuHtml = `
                    <div class="tus-share-people-menu">
                        <button type="button" class="tus-share-people-menu-btn" title="More actions" aria-label="More actions">&#8942;</button>
                        <div class="tus-share-people-menu-panel">
                            <button type="button" class="tus-share-people-menu-item tus-share-people-copy" data-guest-link="${acc.guest_link}">Copy guest link</button>
                            <button type="button" class="tus-share-people-menu-item tus-share-people-menu-item--danger tus-share-people-remove" data-access-id="${acc.id}">Remove access</button>
                        </div>
                    </div>
                `;
            } else {
                const modeText = acc.access_mode === "edit" ? _t("Can customize") : _t("Can view only");
                permissionHtml = `<span class="tus-share-people-mode-text">${modeText}</span>`;
            }

            $list.append(`
                <div class="tus-share-people-entry">
                    <div class="tus-share-people-left">
                        <div class="tus-share-people-avatar">${initial}</div>
                        <div class="tus-share-people-email text-truncate" title="${acc.email}">${acc.email}</div>
                    </div>
                    ${permissionHtml}
                    ${menuHtml}
                </div>
            `);
        });

        const $hint = this.$("#tus-share-owner-hint");
        if (info.is_owner) {
            $hint.removeClass("d-none");
            this.$("#tus-share-email-input").prop("disabled", false).attr("placeholder", _t("Add email address..."));
            this.$("#tus-share-email-mode").prop("disabled", false);
            this.$("#tus-share-add-btn").prop("disabled", false);
            this.$("#tus-share-restriction-select").prop("disabled", false);
            this.$("#tus-share-access-select").prop("disabled", false);
        } else {
            $hint.addClass("d-none");
            this.$("#tus-share-email-input").prop("disabled", true).attr("placeholder", _t("Only owner can add people"));
            this.$("#tus-share-email-mode").prop("disabled", true);
            this.$("#tus-share-add-btn").prop("disabled", true);
            this.$("#tus-share-restriction-select").prop("disabled", true);
            this.$("#tus-share-access-select").prop("disabled", true);
        }
    },

    _updateShareRestrictionUI: function (restrictionType) {
        const $icon = this.$("#tus-share-restriction-icon i");
        const $hint = this.$("#tus-share-restriction-hint");
        const $accessSelect = this.$("#tus-share-access-select");

        if (restrictionType === "restricted") {
            $icon.attr("class", "fa fa-lock").css("color", "#ef4444");
            $hint.text(_t("Only people added can open with this link."));
            $accessSelect.addClass("d-none");
        } else {
            $icon.attr("class", "fa fa-globe").css("color", "var(--tus-brand-1)");
            $hint.text(_t("Anyone with this link can access."));
            $accessSelect.removeClass("d-none");
        }
    },

    _fetchShareInfoAndRender: async function (token) {
        if (!token) {
            return;
        }
        try {
            const info = await this.rpc("/custom/design/share/get_info", { token: token });
            if (info.error) {
                return;
            }
            this.$("#tus-share-restriction-select").val(info.restriction_type);
            this.$("#tus-share-access-select").val(info.share_mode);
            this._updateShareRestrictionUI(info.restriction_type);
            this._renderShareAccessList(info);
        } catch (rpcErr) {
            console.error("Failed to fetch share info:", rpcErr);
        }
    },

    _bindSharePopoverEvents: function () {
        if (this._sharePopoverEventsBound) {
            return;
        }
        this._sharePopoverEventsBound = true;
        const self = this;

        this.$el.on("change.tusSharePopover", "#tus-share-access-select", async function (ev) {
            const token = self._activeShareToken;
            const $select = $(ev.currentTarget);
            const selectedVal = $select.val();
            if (!token) {
                return;
            }
            $select.prop("disabled", true);
            try {
                await self.rpc("/custom/design/share/update_mode", {
                    token: token,
                    share_mode: selectedVal,
                });
            } catch (rpcErr) {
                console.error("Failed to update share permission mode:", rpcErr);
            } finally {
                $select.prop("disabled", false);
            }
        });

        this.$el.on("change.tusSharePopover", "#tus-share-restriction-select", async function (ev) {
            const token = self._activeShareToken;
            const $select = $(ev.currentTarget);
            const selectedVal = $select.val();
            if (!token) {
                return;
            }
            $select.prop("disabled", true);
            try {
                const res = await self.rpc("/custom/design/share/update_restriction", {
                    token: token,
                    restriction_type: selectedVal,
                });
                if (res.error) {
                    self.notification.add(_t("Action not authorized."), { type: "danger" });
                } else {
                    self._updateShareRestrictionUI(selectedVal);
                }
            } catch (rpcErr) {
                console.error("Failed to update share restriction:", rpcErr);
            } finally {
                $select.prop("disabled", false);
            }
        });

        const handleAddAccess = async () => {
            const token = self._activeShareToken;
            const $input = self.$("#tus-share-email-input");
            const email = $input.val().trim();
            const mode = self.$("#tus-share-email-mode").val();

            if (!email || !email.includes("@")) {
                self.notification.add(_t("Please enter a valid email address."), { type: "warning" });
                return;
            }

            const $btn = self.$("#tus-share-add-btn");
            $input.prop("disabled", true);
            $btn.prop("disabled", true);

            try {
                const res = await self.rpc("/custom/design/share/add_access", {
                    token: token,
                    email: email,
                    access_mode: mode,
                });
                if (res.error) {
                    if (res.error === "invalid_email") {
                        self.notification.add(_t("Invalid email address."), { type: "danger" });
                    } else if (res.error === "unauthorized") {
                        self.notification.add(_t("Action not authorized."), { type: "danger" });
                    } else {
                        self.notification.add(_t("Failed to add user."), { type: "danger" });
                    }
                } else {
                    $input.val("");
                    self.notification.add(_t("Access added successfully."), { type: "success" });
                    await self._fetchShareInfoAndRender(token);
                }
            } catch (rpcErr) {
                console.error("Failed to add partner access:", rpcErr);
            } finally {
                $input.prop("disabled", false);
                $btn.prop("disabled", false);
                $input.focus();
            }
        };

        this.$el.on("click.tusSharePopover", "#tus-share-add-btn", function (ev) {
            ev.preventDefault();
            handleAddAccess();
        });

        this.$el.on("keypress.tusSharePopover", "#tus-share-email-input", function (ev) {
            if (ev.which === 13) {
                ev.preventDefault();
                handleAddAccess();
            }
        });

        this.$el.on("change.tusSharePopover", ".tus-share-people-select", async function (ev) {
            const token = self._activeShareToken;
            const $select = $(ev.currentTarget);
            const email = $select.data("email");
            const mode = $select.val();
            $select.prop("disabled", true);
            try {
                const res = await self.rpc("/custom/design/share/add_access", {
                    token: token,
                    email: email,
                    access_mode: mode,
                });
                if (res.error) {
                    self.notification.add(_t("Action not authorized."), { type: "danger" });
                    await self._fetchShareInfoAndRender(token);
                } else {
                    self.notification.add(
                        _t("Access updated. The guest can use the same link and refresh the page."),
                        { type: "success" }
                    );
                    await self._fetchShareInfoAndRender(token);
                }
            } catch (rpcErr) {
                console.error("Failed to update access mode:", rpcErr);
            } finally {
                $select.prop("disabled", false);
            }
        });

        this.$el.on("click.tusSharePopover", ".tus-share-people-menu-btn", function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            const $menu = $(ev.currentTarget).closest(".tus-share-people-menu");
            const isOpen = $menu.hasClass("show");
            self._closeSharePeopleMenus();
            if (!isOpen) {
                $menu.addClass("show");
            }
        });

        this.$el.on("click.tusSharePopover", ".tus-share-people-copy", async function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            const guestLink = $(ev.currentTarget).data("guest-link");
            self._closeSharePeopleMenus();
            await self._copyTextToClipboard(guestLink, _t("Guest access link copied."));
        });

        this.$el.on("click.tusSharePopover", ".tus-share-people-remove", async function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            const token = self._activeShareToken;
            const $btn = $(ev.currentTarget);
            const accessId = $btn.data("access-id");
            self._closeSharePeopleMenus();
            $btn.prop("disabled", true);
            try {
                const res = await self.rpc("/custom/design/share/remove_access", {
                    token: token,
                    access_id: accessId,
                });
                if (res.error) {
                    self.notification.add(_t("Action not authorized."), { type: "danger" });
                    $btn.prop("disabled", false);
                } else {
                    self.notification.add(_t("Access removed successfully."), { type: "success" });
                    await self._fetchShareInfoAndRender(token);
                }
            } catch (rpcErr) {
                console.error("Failed to remove access:", rpcErr);
                $btn.prop("disabled", false);
            }
        });

        this.$el.on("click.tusSharePopover", "#tus-share-popover-copy-btn", async function (ev) {
            ev.preventDefault();
            const shareUrl = self.$("#tus-share-popover-url").val();
            await self._copyTextToClipboard(shareUrl, _t("Link copied to clipboard."));
        });

        this.$el.on("click.tusSharePopover", "[data-share-channel]", function (ev) {
            ev.preventDefault();
            const channel = $(ev.currentTarget).data("share-channel");
            if (channel) {
                self._shareDesignViaChannel(channel);
            }
        });

        this.$el.on("click.tusSharePopover", ".tus-share-popover-close-btn, .tus-share-backdrop", function (ev) {
            ev.preventDefault();
            self._hideSharePopover();
        });
    },

    _showSharePopover: function (shareUrl, token) {
        const $popover = this.$(".tus-share-popover");
        const $urlInput = this.$("#tus-share-popover-url");
        if (!$popover.length) {
            return;
        }
        this._activeShareToken = token;
        this._bindSharePopoverEvents();
        $urlInput.val(shareUrl || "");
        $popover.removeClass("d-none");

        const nativeBtn = document.getElementById("tus-share-popover-native-btn");
        if (nativeBtn) {
            if (navigator.share) {
                nativeBtn.classList.remove("d-none");
            } else {
                nativeBtn.classList.add("d-none");
            }
        }

        if (token) {
            this._fetchShareInfoAndRender(token);
        }

        const self = this;
        setTimeout(() => {
            $(document).off("mouseup.tusSharePopoverOutside").on("mouseup.tusSharePopoverOutside", (e) => {
                const $target = $(e.target);
                if ($target.closest(".tus-share-people-menu").length) {
                    return;
                }
                self._closeSharePeopleMenus();
                if (
                    !$popover.is(e.target) &&
                    $popover.has(e.target).length === 0 &&
                    !self.$(".share_btn").is(e.target) &&
                    self.$(".share_btn").has(e.target).length === 0
                ) {
                    self._hideSharePopover();
                }
            });
        }, 10);
    },

    _initShareSaveState: function () {
        const token = this._getShareToken();
        if (!token) {
            return;
        }
        this._shareBundleVersion = parseInt(
            $('input[name="share_bundle_version"]').val() || "1",
            10
        );
        const savedBy = $('input[name="share_last_saved_by"]').val() || "";
        const savedAt = $('input[name="share_last_saved_at"]').val() || "";
        this._updateShareStatusBar(savedBy, savedAt, this._shareBundleVersion);
    },

    _formatShareSavedAt: function (savedAt) {
        if (!savedAt) {
            return "";
        }
        const date = new Date(savedAt);
        if (Number.isNaN(date.getTime())) {
            return savedAt;
        }
        return date.toLocaleString();
    },

    _updateShareStatusBar: function (savedBy, savedAt, bundleVersion) {
        const $bar = this.$(".tus-share-save-status");
        if (!$bar.length) {
            return;
        }
        if (bundleVersion) {
            this._shareBundleVersion = bundleVersion;
            $('input[name="share_bundle_version"]').val(bundleVersion);
        }
        if (savedBy) {
            $('input[name="share_last_saved_by"]').val(savedBy);
        }
        if (savedAt) {
            $('input[name="share_last_saved_at"]').val(savedAt);
        }
        const formattedAt = this._formatShareSavedAt(savedAt);
        const isReadOnly = this._isShareReadOnly();
        let message = "";
        if (savedBy && formattedAt) {
            message = _t("Last saved by %(who)s at %(when)s.", {
                who: savedBy,
                when: formattedAt,
            });
        } else if (formattedAt) {
            message = _t("Last saved at %(when)s.", { when: formattedAt });
        }
        if (isReadOnly) {
            message = message
                ? `${message} ${_t("Refresh the page to see the latest design.")}`
                : _t("Refresh the page to see the latest design.");
        } else if (message) {
            message = `${message} ${_t("Others can refresh to see your changes after you save.")}`;
        }
        $bar.text(message);
        $bar.toggleClass("d-none", !message);
    },

    _onSaveCanvasOrShare: async function (ev) {
        if (ev) {
            ev.preventDefault();
        }
        if (this._getShareToken()) {
            return this._onSaveSharedDesign(ev);
        }
        return this._onSaveCanvas(ev);
    },

    _onSaveSharedDesign: async function (ev) {
        if (ev) {
            ev.preventDefault();
        }
        const token = this._getShareToken();
        if (!token) {
            return this._onSaveCanvas(ev);
        }
        if (this._rejectIfShareReadOnly()) {
            return;
        }
        if (!this._canvasHasUserArtwork()) {
            window.alert(_t("Add something to your design before saving."));
            return;
        }
        this.startLoader(_t("Saving shared design..."));
        this.ui.block();
        try {
            const exported = await this._exportDesignSnapshot();
            const result = await this.rpc("/custom/design/share/save", {
                token,
                design_bundle: JSON.stringify(exported.snapshot),
                preview_image: exported.dataUrl,
                client_version: this._shareBundleVersion || 0,
            });
            if (result.error === "read_only") {
                this._notifyShareReadOnlyOnce();
                return;
            }
            if (result.error) {
                window.alert(_t("Could not save the shared design. Please try again."));
                return;
            }
            this._updateShareStatusBar(
                result.saved_by,
                result.saved_at,
                result.bundle_version
            );
            this.notification.add(
                _t("Design saved to the shared link. Others can refresh to see your changes."),
                { type: "success" }
            );
        } catch (e) {
            console.error("Share design save failed:", e);
            window.alert(_t("Could not save the shared design. Please try again."));
        } finally {
            this.removeLoader();
            this.ui.unblock();
        }
    },
};
