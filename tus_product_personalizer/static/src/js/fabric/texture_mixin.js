/** @odoo-module **/

import { _t } from "@web/core/l10n/translation";

const SIDES = ["front", "back", "left", "right"];
const textureImageUrl = (id, field = "texture_file") => `/web/image/editor.texture/${id}/${field}`;

export const fabricTextureMixin = {
    _initTextureState() {
        this.showTexture = $('input[name="show_texture"]').val() === "1";
        this.textureBySide = Object.fromEntries(SIDES.map((side) => [side, null]));
    },

    _textureSide(side) {
        return side || this.active_side || "front";
    },

    _onSelectTexture(ev) {
        ev.preventDefault();
        const meta = this._textureMetaFromEl($(ev.currentTarget).closest(".fab_texture_option"));
        if (meta) {
            this._applyTextureToSide(this._textureSide(), meta);
        }
    },

    _onRemoveTexture(ev) {
        ev.preventDefault();
        this._removeTextureFromSide(this._textureSide());
    },

    _onTextureCategory(ev) {
        ev.preventDefault();
        const category = $(ev.currentTarget).data("category");
        const $root = $(this.el);
        $root.find(".fab_texture_category_btn").removeClass("active");
        $(ev.currentTarget).addClass("active");
        $root.find(".fab_texture_category_panel").addClass("d-none");
        $root.find(`.fab_texture_category_panel[data-category="${category}"]`).removeClass("d-none");
    },

    _textureMetaFromEl($el) {
        const textureId = parseInt($el.attr("data-texture-id"), 10);
        if (!textureId) {
            return null;
        }
        return {
            textureId,
            name: $el.attr("data-texture-name") || "",
            pricePerSqm: parseFloat($el.attr("data-price-per-sqm")) || 0,
            imageUrl: $el.attr("data-image-url") || textureImageUrl(textureId),
        };
    },

    _loadTextureImage(textureId, preferredUrl) {
        const urls = [preferredUrl, textureImageUrl(textureId, "preview_image")]
            .filter((url, index, all) => url && all.indexOf(url) === index);
        const tryUrl = (index) => {
            if (index >= urls.length) {
                return Promise.resolve(null);
            }
            return new Promise((resolve) => {
                fabric.Image.fromURL(
                    urls[index],
                    (img) => resolve(img?.width ? img : null),
                    { crossOrigin: "anonymous" }
                );
            }).then((img) => img || tryUrl(index + 1));
        };
        return tryUrl(0);
    },

    _textureBgProps(canvas, img) {
        const cw = canvas.getWidth();
        const ch = canvas.getHeight();
        const scale = Math.max(cw / Math.max(1, img.width), ch / Math.max(1, img.height));
        return {
            originX: "center",
            originY: "center",
            left: cw / 2,
            top: ch / 2,
            scaleX: scale,
            scaleY: scale,
            selectable: false,
            evented: false,
        };
    },

    async _applyTextureToCanvas(canvas, meta) {
        if (!canvas || !meta?.textureId) {
            return false;
        }
        const img = await this._loadTextureImage(meta.textureId, meta.imageUrl);
        if (!img) {
            this.notification?.add(_t("Could not load texture image."), { type: "danger" });
            return false;
        }
        return new Promise((resolve) => {
            canvas.setBackgroundImage(
                img,
                () => {
                    canvas.backgroundColor = null;
                    canvas.requestRenderAll();
                    resolve(true);
                },
                this._textureBgProps(canvas, img)
            );
        });
    },

    _rescaleTextureBackground(canvas) {
        const bg = canvas?.backgroundImage;
        if (!bg) {
            return;
        }
        bg.set(this._textureBgProps(canvas, bg));
        bg.setCoords?.();
    },

    _clearTextureLayer(canvas) {
        if (!canvas) {
            return;
        }
        canvas.setBackgroundImage(null, () => {
            if (this.emptyCanvasMode) {
                const side = canvas._tusSide || this._textureSide();
                canvas.backgroundColor = this._getEmptyCanvasBackground?.(side) || "#ffffff";
            }
            canvas.requestRenderAll();
        });
    },

    _hasAnyTextureApplied() {
        return SIDES.some((side) => this.textureBySide?.[side]);
    },

    _sideHasTexture(side) {
        return Boolean(this.textureBySide?.[this._textureSide(side)]);
    },

    _getPrintableAreaM2ForSide(side) {
        const key = this._textureSide(side);
        let width;
        let height;
        let unit;
        let marginMm = 0;
        if (this.emptyCanvasMode) {
            ({ width, height, unit } = this.emptyCanvasActual || {});
            width = parseFloat(width) || 0;
            height = parseFloat(height) || 0;
            unit = unit || "in";
            marginMm = this._getEmptyCanvasMarginMm?.(key) || 0;
        } else {
            const stage = this.stageBySide?.[key] || {};
            width = parseFloat(stage.imageW || stage.w) || 0;
            height = parseFloat(stage.imageH || stage.h) || 0;
            unit = "in";
        }
        if (!width || !height) {
            return 0;
        }
        const wMm = Math.max(0, this._convertSheetDimensionToMm(width, unit) - 2 * marginMm);
        const hMm = Math.max(0, this._convertSheetDimensionToMm(height, unit) - 2 * marginMm);
        return (wMm / 1000) * (hMm / 1000);
    },

    _calculateTexturePrice() {
        if (!this.showTexture) {
            return 0;
        }
        return SIDES.reduce((total, side) => {
            const tex = this.textureBySide?.[side];
            return tex ? total + tex.pricePerSqm * this._getPrintableAreaM2ForSide(side) : total;
        }, 0);
    },

    _texturePayload(kind) {
        const payload = {};
        for (const side of SIDES) {
            const tex = this.textureBySide?.[side];
            if (!tex) {
                continue;
            }
            if (kind === "cart") {
                const areaM2 = this._getPrintableAreaM2ForSide(side);
                payload[side] = {
                    texture_id: tex.textureId,
                    name: tex.name,
                    area_m2: areaM2,
                    price: tex.pricePerSqm * areaM2,
                };
            } else {
                payload[side] = {
                    texture_id: tex.textureId,
                    name: tex.name,
                    price_per_sqm: tex.pricePerSqm,
                };
            }
        }
        return payload;
    },

    _getTexturePayloadForCart() {
        return this._texturePayload("cart");
    },

    _getTextureBundlePayload() {
        return this._texturePayload("bundle");
    },

    _refreshTextureState(side) {
        this._syncTexturePanelUi(side);
        this._updateDesignerPriceDisplay?.();
        this._updateAddToCartButtonState?.();
    },

    async _applyTextureToSide(side, meta) {
        if (!side || !meta) {
            return;
        }
        this.textureBySide[side] = { ...meta };
        await Promise.all(
            (this.canvasesBySide[side] || []).map(async ({ canvas }) => {
                canvas._tusSide = side;
                await this._applyTextureToCanvas(canvas, meta);
            })
        );
        this._refreshTextureState(side);
        this._schedule3DPreviewRefresh?.();
    },

    _removeTextureFromSide(side) {
        this.textureBySide[side] = null;
        for (const { canvas } of this.canvasesBySide[side] || []) {
            this._clearTextureLayer(canvas);
        }
        this._refreshTextureState(side);
        this._schedule3DPreviewRefresh?.();
    },

    async _rescaleAllTextures() {
        const jobs = [];
        for (const side of SIDES) {
            const meta = this.textureBySide[side];
            if (!meta) {
                continue;
            }
            for (const { canvas } of this.canvasesBySide[side] || []) {
                if (canvas?.backgroundImage) {
                    this._rescaleTextureBackground(canvas);
                    canvas.requestRenderAll();
                } else if (canvas) {
                    jobs.push(this._applyTextureToCanvas(canvas, meta));
                }
            }
        }
        await Promise.all(jobs);
    },

    _syncTexturePanelUi(side) {
        const key = this._textureSide(side);
        const tex = this.textureBySide?.[key];
        const $panel = $(this.el).find(".section_textures");
        if (!$panel.length) {
            return;
        }
        const $info = $panel.find(".fab_texture_selected_info");
        const $remove = $panel.find(".fab_texture_remove_btn");
        if (!tex) {
            $info.addClass("d-none").empty();
            $remove.addClass("d-none");
            $panel.find(".fab_texture_option").removeClass("selected");
            return;
        }
        const areaM2 = this._getPrintableAreaM2ForSide(key);
        const symbol = this._getCurrencySymbol?.() || "";
        $info.removeClass("d-none").html(
            `<strong>${tex.name}</strong><br/><span class="small text-muted">${areaM2.toFixed(3)} m² · ${symbol}${(tex.pricePerSqm * areaM2).toFixed(2)}</span>`
        );
        $remove.removeClass("d-none");
        $panel.find(".fab_texture_option").removeClass("selected");
        $panel.find(`.fab_texture_option[data-texture-id="${tex.textureId}"]`).addClass("selected");
    },

    async _restoreTexturesFromBundle(bundle) {
        for (const [side, data] of Object.entries(bundle?.texture_by_side || {})) {
            const textureId = data?.texture_id || data?.textureId;
            if (!textureId) {
                continue;
            }
            const $el = $(this.el).find(`.fab_texture_option[data-texture-id="${textureId}"]`).first();
            const meta = $el.length
                ? this._textureMetaFromEl($el)
                : {
                      textureId,
                      name: data.name || "",
                      pricePerSqm: parseFloat(data.price_per_sqm || data.pricePerSqm) || 0,
                      imageUrl: textureImageUrl(textureId),
                  };
            await this._applyTextureToSide(side, meta);
        }
    },
};
