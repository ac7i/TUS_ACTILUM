/** @odoo-module **/

import { _t } from "@web/core/l10n/translation";
import { ensureObjectFinishDefaults } from "../3d/finish_effects";

const VALID_INTENSITY = ["0.3", "0.5", "0.7", "0.9"];
const DEFAULT_INTENSITY = "0.5";
const VALID_COVER_MODE = ["by_file", "all", "zones"];

export function ensureObjectFinishUploadDefaults(obj) {
    if (!obj || obj.center_line || obj.extra_elem || obj.tusFoilPreviewOverlay) {
        return;
    }
    if (obj.tusTextureIntensityMm === undefined) {
        obj.tusTextureIntensityMm = DEFAULT_INTENSITY;
    }
    if (obj.tusVarnishType === undefined) {
        obj.tusVarnishType = "none";
    }
    if (obj.tusVarnishCoverMode === undefined) {
        obj.tusVarnishCoverMode = "all";
    }
}

export function serializeFinishUploadFields(obj) {
    ensureObjectFinishUploadDefaults(obj);
    const textureActive = Boolean(obj.tusTextureActive);
    const payload = {
        tusTextureActive: textureActive,
        tusVarnishType: obj.tusVarnishType || "none",
        tusVarnishCoverMode: obj.tusVarnishCoverMode || "all",
    };
    if (textureActive) {
        payload.tusTextureIntensityMm = obj.tusTextureIntensityMm || DEFAULT_INTENSITY;
    }
    if (obj.tusVarnishAreaFile) {
        payload.tusVarnishAreaFile = obj.tusVarnishAreaFile;
        payload.tusVarnishAreaFileName = obj.tusVarnishAreaFileName || "";
    }
    if (obj.tusVarnishZonesDescription) {
        payload.tusVarnishZonesDescription = obj.tusVarnishZonesDescription;
    }
    return payload;
}

export const fabricFinishUploadMixin = {
    _initFinishUploadState() {
        this.showFinishTexture = $('input[name="show_finish_texture"]').val() === "1";
        this.showFinishVarnish = $('input[name="show_finish_varnish"]').val() === "1";
        this.showFinishTool = this.showFinishTexture || this.showFinishVarnish;
    },

    _isFinishToolEnabled() {
        return Boolean(this.showFinishTool);
    },

    _getFinishTargetObject() {
        const active = this.currentElement?.object || this.canvas?.getActiveObject();
        if (!active || active.center_line || active.extra_elem || active.tusFoilPreviewOverlay) {
            return null;
        }
        if (active.type === "activeSelection" && typeof active.getObjects === "function") {
            const objects = active.getObjects().filter(
                (o) => !o.center_line && !o.extra_elem && !o.tusFoilPreviewOverlay
            );
            return objects[0] || null;
        }
        return active;
    },

    _readFileAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (ev) => resolve(ev.target.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    },

    _onFinishTextureFileBtn(ev) {
        ev.preventDefault();
        $(this.el).find(".section_tool_finish .tus-texture-file-input").trigger("click");
    },

    async _onFinishTextureFileChange(ev) {
        const file = ev.currentTarget.files && ev.currentTarget.files[0];
        if (!file) {
            return;
        }
        try {
            // Add the uploaded picture as a real, visible design layer (same as the
            // Upload tab). Since it is uploaded from the Texture panel, emboss is
            // enabled on it automatically (the customer can untick it if needed).
            const group = await this._processUploadedImageFile(file, this.canvas);
            if (group) {
                group.tusTextureActive = true;
                if (!group.tusTextureIntensityMm) {
                    group.tusTextureIntensityMm = DEFAULT_INTENSITY;
                }
                this.canvas?.setActiveObject(group);
                this._showObjectToolbar?.(group);
                this._syncFinishPanelFromObject(group);
                this._schedule3DPreviewRefresh?.();
            }
            this.saveState?.();
        } catch (err) {
            if (!err?.shareReadOnly && err?.message !== "dpi_cancelled") {
                console.warn("Texture photo upload failed:", err);
            }
        } finally {
            ev.currentTarget.value = "";
        }
    },

    _onFinishTextureFileClear(ev) {
        ev.preventDefault();
        const obj = this._getFinishTargetObject();
        if (!obj) {
            return;
        }
        obj.tusTextureActive = false;
        this._syncFinishPanelFromObject(obj);
        this._schedule3DPreviewRefresh?.();
        this.saveState?.();
    },

    _onFinishTextureEnableChange(ev) {
        const obj = this._getFinishTargetObject();
        if (!obj) {
            return;
        }
        obj.tusTextureActive = Boolean(ev.currentTarget.checked);
        if (obj.tusTextureActive && !obj.tusTextureIntensityMm) {
            obj.tusTextureIntensityMm = DEFAULT_INTENSITY;
        }
        this._syncFinishPanelFromObject(obj);
        this._schedule3DPreviewRefresh?.();
        this.saveState?.();
    },

    _onFinishTextureIntensityChange(ev) {
        const obj = this._getFinishTargetObject();
        if (!obj) {
            return;
        }
        const value = String(ev.currentTarget.value);
        obj.tusTextureIntensityMm = VALID_INTENSITY.includes(value) ? value : DEFAULT_INTENSITY;
        // Depth only affects the layer when emboss is explicitly enabled.
        if (obj.tusTextureActive) {
            this._schedule3DPreviewRefresh?.();
        }
        this.saveState?.();
    },

    _onFinishVarnishTypeChange(ev) {
        const obj = this._getFinishTargetObject();
        if (!obj) {
            return;
        }
        const value = String(ev.currentTarget.value);
        obj.tusVarnishType = ["none", "gloss", "satin"].includes(value) ? value : "none";
        if (obj.tusVarnishType === "none") {
            // Keep mask/notes stored so re-enabling gloss restores the previous area choice.
        } else if (!VALID_COVER_MODE.includes(obj.tusVarnishCoverMode)) {
            obj.tusVarnishCoverMode = "all";
        }
        this._syncFinishPanelFromObject(obj);
        this._schedule3DPreviewRefresh?.();
        this.saveState?.();
    },

    _onFinishVarnishCoverChange(ev) {
        const obj = this._getFinishTargetObject();
        if (!obj) {
            return;
        }
        const mode = String(ev.currentTarget.value);
        if (!ev.currentTarget.checked || !VALID_COVER_MODE.includes(mode)) {
            return;
        }
        obj.tusVarnishCoverMode = mode;
        this._syncFinishPanelFromObject(obj);
        this._schedule3DPreviewRefresh?.();
        this.saveState?.();
    },

    _onFinishVarnishFileBtn(ev) {
        ev.preventDefault();
        const obj = this._getFinishTargetObject();
        if (!obj || (obj.tusVarnishType || "none") === "none") {
            this.notification?.add?.(
                _t("Select Gloss or Satin before uploading a varnish mask."),
                { type: "warning" }
            );
            return;
        }
        $(this.el).find(".section_tool_finish .tus-varnish-file-input").trigger("click");
    },

    async _onFinishVarnishFileChange(ev) {
        const file = ev.currentTarget.files && ev.currentTarget.files[0];
        const obj = this._getFinishTargetObject();
        if (!file || !obj) {
            return;
        }
        try {
            // Mask only — never add a visible design layer (unlike Texture upload).
            if ((obj.tusVarnishType || "none") === "none") {
                obj.tusVarnishType = "gloss";
            }
            obj.tusVarnishAreaFile = await this._readFileAsDataURL(file);
            obj.tusVarnishAreaFileName = file.name;
            obj.tusVarnishCoverMode = "by_file";
            this._syncFinishPanelFromObject(obj);
            this._schedule3DPreviewRefresh?.();
            this.saveState?.();
        } catch (err) {
            console.warn("Varnish file read failed:", err);
        } finally {
            ev.currentTarget.value = "";
        }
    },

    _onFinishVarnishFileClear(ev) {
        ev.preventDefault();
        const obj = this._getFinishTargetObject();
        if (!obj) {
            return;
        }
        delete obj.tusVarnishAreaFile;
        delete obj.tusVarnishAreaFileName;
        if (obj.tusVarnishCoverMode === "by_file") {
            obj.tusVarnishCoverMode = "all";
        }
        this._syncFinishPanelFromObject(obj);
        this._schedule3DPreviewRefresh?.();
        this.saveState?.();
    },

    _onFinishVarnishZonesInput(ev) {
        const obj = this._getFinishTargetObject();
        if (!obj) {
            return;
        }
        obj.tusVarnishZonesDescription = ev.currentTarget.value || "";
        this.saveState?.();
    },

    _syncFinishPanelFromObject(obj) {
        const $root = $(this.el);
        const $panel = $root.find(".section_tool_finish");
        if (!$panel.length) {
            return;
        }
        if (!obj) {
            return;
        }
        ensureObjectFinishUploadDefaults(obj);

        if (this.showFinishTexture) {
            $panel.find(".tus-texture-file-name").text("");
            $panel.find(".tus-texture-enable").prop("checked", Boolean(obj.tusTextureActive));
            $panel.find(".tus-texture-intensity")
                .val(obj.tusTextureIntensityMm || DEFAULT_INTENSITY)
                .prop("disabled", !obj.tusTextureActive);
        }

        if (this.showFinishVarnish) {
            const varnishType = obj?.tusVarnishType || "none";
            $panel.find(".tus-varnish-type").each((i, el) => {
                el.checked = el.value === varnishType;
            });
            const varnishActive = varnishType !== "none";
            const coverMode = VALID_COVER_MODE.includes(obj?.tusVarnishCoverMode)
                ? obj.tusVarnishCoverMode
                : "all";
            $panel.find(".tus-varnish-area-block").toggleClass("tus-disabled", !varnishActive);
            $panel.find(".tus-varnish-cover").each((i, el) => {
                el.checked = el.value === coverMode;
                el.disabled = !varnishActive;
            });
            const hasMask = Boolean(obj?.tusVarnishAreaFileName || obj?.tusVarnishAreaFile);
            $panel.find(".tus-varnish-file-name").text(obj?.tusVarnishAreaFileName || "");
            $panel.find(".tus-varnish-file-clear").toggleClass("d-none", !hasMask || !varnishActive);
            $panel.find(".tus-varnish-file-btn").prop("disabled", !varnishActive);
            $panel.find(".tus-varnish-file-row").toggleClass(
                "tus-varnish-file-row--active",
                coverMode === "by_file"
            );
            $panel.find(".tus-varnish-zones")
                .toggleClass("d-none", coverMode !== "zones")
                .prop("disabled", !varnishActive)
                .val(obj?.tusVarnishZonesDescription || "");
        }

        this._sync3DControlsFromObject(obj);
    },

    _sync3DControlsFromObject(obj) {
        if (!this._viewerControls || !obj) {
            return;
        }
        const settings = this._getFinishSettingsFromObject(obj);
        this._3dPreviewSettings = {
            ...this._3dPreviewSettings,
            varnishType: settings.varnishType,
            reliefMm: settings.reliefMm,
        };
        this._viewerControls.setSettings(this._3dPreviewSettings);
    },

    _getFinishSettingsFromObject(obj) {
        ensureObjectFinishUploadDefaults(obj);
        const settings = {
            varnishType: "none",
            reliefMm: 0,
            textureActive: false,
        };
        if (this.showFinishTexture && obj) {
            const textureActive = Boolean(obj.tusTextureActive);
            settings.textureActive = textureActive;
            if (textureActive) {
                const intensity = parseFloat(obj.tusTextureIntensityMm || DEFAULT_INTENSITY);
                settings.reliefMm = Number.isNaN(intensity) ? 0 : intensity;
                settings.textureIntensityMm = obj.tusTextureIntensityMm || DEFAULT_INTENSITY;
            }
        }
        if (this.showFinishVarnish && obj) {
            settings.varnishType = obj.tusVarnishType || "none";
            if (settings.varnishType !== "none") {
                settings.varnishCoverMode = obj.tusVarnishCoverMode || "all";
                settings.varnishAreaFile = obj.tusVarnishAreaFile || null;
                settings.varnishAreaFileName = obj.tusVarnishAreaFileName || "";
                settings.varnishZonesDescription = obj.tusVarnishZonesDescription || "";
            }
        }
        return settings;
    },

    _getFinishSettingsForSide(side) {
        const entries = this.canvasesBySide?.[side] || [];
        const aggregated = {
            varnishType: "none",
            reliefMm: 0,
            textureActive: false,
            varnishCoverMode: "all",
            varnishAreaFile: null,
            varnishAreaFileName: "",
            varnishZonesDescription: "",
        };
        const preferVarnish = (current, next) => {
            if (!next || next === "none") {
                return current;
            }
            if (!current || current === "none") {
                return next;
            }
            if (current === "gloss" || next === "gloss") {
                return "gloss";
            }
            return next;
        };

        for (const entry of entries) {
            const canvas = entry.canvas;
            if (!canvas) {
                continue;
            }
            const objects = canvas.getObjects().filter(
                (o) => !o.center_line && !o.extra_elem && !o.tusFoilPreviewOverlay
            );
            for (const obj of objects) {
                const objSettings = this._getFinishSettingsFromObject(obj);
                if (objSettings.textureActive) {
                    aggregated.textureActive = true;
                    aggregated.reliefMm = Math.max(
                        aggregated.reliefMm,
                        Number(objSettings.reliefMm) || 0
                    );
                }
                // Finish-effect emboss / deboss also carries relief independent of varnish.
                ensureObjectFinishDefaults(obj);
                if (
                    obj.tusFinishEffect === "emboss" ||
                    obj.tusFinishEffect === "deboss" ||
                    obj.tusFinishEffect === "foil_emboss"
                ) {
                    const embossRelief =
                        Number(obj.tusReliefMm) > 0 ? Number(obj.tusReliefMm) : 0.6;
                    aggregated.reliefMm = Math.max(aggregated.reliefMm, embossRelief);
                }
                aggregated.varnishType = preferVarnish(
                    aggregated.varnishType,
                    objSettings.varnishType
                );
                if (objSettings.varnishType && objSettings.varnishType !== "none") {
                    aggregated.varnishCoverMode = objSettings.varnishCoverMode || aggregated.varnishCoverMode;
                    aggregated.varnishAreaFile =
                        objSettings.varnishAreaFile || aggregated.varnishAreaFile;
                    aggregated.varnishAreaFileName =
                        objSettings.varnishAreaFileName || aggregated.varnishAreaFileName;
                    aggregated.varnishZonesDescription =
                        objSettings.varnishZonesDescription || aggregated.varnishZonesDescription;
                }
            }
        }
        return aggregated;
    },

    _get3DFinishForSide(side) {
        const settings = this._getFinishSettingsForSide(side);
        return {
            varnishType: settings.varnishType || "none",
            reliefMm: settings.reliefMm ?? 0,
            varnishAreaFileData: settings.varnishAreaFile || null,
            varnishCoverMode: settings.varnishCoverMode || "all",
        };
    },
};
