/** @odoo-module **/

import {
    DEFAULT_RELIEF_MM,
    MAX_RELIEF_MM,
    VARNISH_GLOSS,
    VARNISH_NONE,
    VARNISH_OPTIONS,
    VARNISH_SATIN,
} from "./finish_effects";

export class TusViewerControls {
    constructor(containerEl, callbacks = {}) {
        this.containerEl = containerEl;
        this.callbacks = callbacks;
        // Texture (relief) and varnish are configured per side in the designer
        // sidebar; the in-preview controls are shown only when explicitly enabled.
        this.showVarnish = callbacks.showVarnish === true;
        this.showRelief = callbacks.showRelief === true;
        this.settings = {
            varnishType: VARNISH_NONE,
            reliefMm: DEFAULT_RELIEF_MM,
        };
        this._build();
    }

    _build() {
        this.rootEl = document.createElement("div");
        this.rootEl.className = "tus-3d-controls-panel";
        const varnishGroup = this.showVarnish
            ? `<div class="tus-3d-control-group">
                <label class="tus-3d-control-label">Varnish</label>
                <div class="tus-3d-varnish-options" role="radiogroup"></div>
            </div>`
            : "";
        const reliefGroup = this.showRelief
            ? `<div class="tus-3d-control-group">
                <label class="tus-3d-control-label" for="tus-3d-relief-range">Relief</label>
                <div class="tus-3d-relief-row">
                    <input type="range" id="tus-3d-relief-range" class="tus-3d-relief-range"
                           min="0" max="${MAX_RELIEF_MM}" step="0.05" value="${DEFAULT_RELIEF_MM}"/>
                    <span class="tus-3d-relief-value">${DEFAULT_RELIEF_MM.toFixed(2)} mm</span>
                </div>
            </div>`
            : "";
        this.rootEl.innerHTML = `
            <div class="tus-3d-controls-title">3D Preview</div>
            ${varnishGroup}
            ${reliefGroup}
            <div class="tus-3d-control-actions">
                <button type="button" class="btn btn-sm btn-outline-light tus-3d-reset-view">Reset view</button>
            </div>
            <p class="tus-3d-hint mb-0">Drag to rotate the product and inspect emboss and varnish effects.</p>
        `;
        this.containerEl.appendChild(this.rootEl);

        if (this.showVarnish) {
            const varnishWrap = this.rootEl.querySelector(".tus-3d-varnish-options");
            for (const opt of VARNISH_OPTIONS) {
                const id = `tus-varnish-${opt.value}`;
                const checked = opt.value === VARNISH_NONE ? "checked" : "";
                varnishWrap.insertAdjacentHTML(
                    "beforeend",
                    `<label class="tus-3d-varnish-option">
                        <input type="radio" name="tus-3d-varnish" id="${id}" value="${opt.value}" ${checked}/>
                        <span>${opt.label}</span>
                    </label>`
                );
            }
            this.rootEl.querySelectorAll('input[name="tus-3d-varnish"]').forEach((input) => {
                input.addEventListener("change", () => {
                    if (!input.checked) {
                        return;
                    }
                    this.settings.varnishType = input.value;
                    this.callbacks.onSettingsChange?.({ ...this.settings });
                });
            });
        }

        if (this.showRelief) {
            this.reliefRange = this.rootEl.querySelector(".tus-3d-relief-range");
            this.reliefValue = this.rootEl.querySelector(".tus-3d-relief-value");
            this.reliefRange.addEventListener("input", () => {
                this.settings.reliefMm = parseFloat(this.reliefRange.value) || 0;
                this.reliefValue.textContent = `${this.settings.reliefMm.toFixed(2)} mm`;
                this.callbacks.onSettingsChange?.({ ...this.settings });
            });
        }

        this.rootEl.querySelector(".tus-3d-reset-view").addEventListener("click", () => {
            this.callbacks.onResetView?.();
        });
    }

    getSettings() {
        return { ...this.settings };
    }

    setSettings(partial) {
        if (partial.varnishType !== undefined) {
            this.settings.varnishType = partial.varnishType;
            const input = this.rootEl.querySelector(
                `input[name="tus-3d-varnish"][value="${partial.varnishType}"]`
            );
            if (input) {
                input.checked = true;
            }
        }
        if (partial.reliefMm !== undefined) {
            this.settings.reliefMm = partial.reliefMm;
            if (this.reliefRange) {
                this.reliefRange.value = partial.reliefMm;
                this.reliefValue.textContent = `${partial.reliefMm.toFixed(2)} mm`;
            }
        }
    }

    dispose() {
        this.rootEl?.remove();
    }
}
