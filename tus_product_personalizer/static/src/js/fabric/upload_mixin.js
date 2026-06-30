/** @odoo-module **/

import { _t } from "@web/core/l10n/translation";

export const fabricUploadMixin = {
    _onVectorizeImage: async function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        const obj = this.currentElement;
        if (!obj || !this._isPhotoArtworkLayer(obj)) {
            this.notification.add(
                _t("Select a photo layer on the canvas first."),
                { type: "warning" }
            );
            return;
        }

        const canvas = obj.canvas || this.canvas;
        const backendId = obj.backend_id;

        this.startLoader(_t("Converting to vector…"), { light: true });
        try {
            let result;
            if (backendId) {
                result = await this.rpc("/canvas/vectorize_image", {
                    image_id: backendId,
                });
            } else {
                let src = null;
                if (obj.type === "image") {
                    src = this._getFabricImageSource(obj);
                } else {
                    src = this._getEmbeddedPhotoRasterSource(obj);
                }
                if (!src) {
                    throw new Error(_t("Could not read the selected image."));
                }
                let base64 = null;
                if (src.startsWith("data:")) {
                    base64 = src.split(",")[1];
                } else {
                    const response = await fetch(src);
                    const blob = await response.blob();
                    base64 = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => {
                            const parts = reader.result.split(",");
                            resolve(parts[1] || "");
                        };
                        reader.onerror = () => reject(new Error("Failed to read image."));
                        reader.readAsDataURL(blob);
                    });
                }
                if (!base64) {
                    throw new Error(_t("Could not read the selected image."));
                }
                result = await this.rpc("/canvas/vectorize_image", {
                    filedata: base64,
                    filename: "image.png",
                });
            }

            if (result.error) {
                throw new Error(result.error);
            }

            const newBackendId = result.id || backendId;
            await this._replaceCanvasObjectWithSvgGroup(canvas, obj, result.svg, {
                backendId: newBackendId,
                isEmbeddedPhotoSvg: false,
            });

            if (result.image_datas && newBackendId) {
                const $thumb = $(`.image-item[data-id="${newBackendId}"] img`);
                if ($thumb.length) {
                    $thumb.attr("src", result.image_datas);
                }
            } else {
                this._appendUploadLibraryItem(result);
            }

            this._syncArtworkToolbarTools(this.currentElement);
            this.notification.add(
                _t("Converted to vector. You can recolor it and apply foil or emboss."),
                { type: "success" }
            );
        } catch (error) {
            console.error("Vectorize failed:", error);
            const detail = error && error.message ? error.message : "";
            this.notification.add(
                detail || _t("Could not convert to vector. Try a simpler logo with solid colors."),
                { type: "danger" }
            );
        } finally {
            this.removeLoader();
        }
    },

    _imageItemHtml: function (result) {
        return `
            <div class="upload-library-item image-item" data-id="${result.id}">
                <div class="upload-library-item__media">
                    <img src="${result.image_datas}"
                         class="default-canvas-img"
                         alt="${result.name}"/>
                </div>
                <div class="upload-library-item__overlay">
                    <button type="button"
                            class="upload-library-item__action tus-remove-bg-thumb-btn"
                            title="Remove background"
                            aria-label="Remove background">
                        <i class="fa fa-magic"></i>
                    </button>
                    <button type="button"
                            class="upload-library-item__action upload-library-item__action--danger delete-btn"
                            title="Delete"
                            aria-label="Delete">
                        <i class="fa fa-trash-o"></i>
                    </button>
                </div>
            </div>
        `;
    },

    _ensureUploadLibraryGrid: function () {
        let $grid = $(".default_images .upload-library-grid");
        if (!$grid.length) {
            $grid = $('<div class="upload-library-grid"></div>');
            const $hint = $(".default_images .upload-library-hint");
            if ($hint.length) {
                $hint.after($grid);
            } else {
                $(".default_images").prepend($grid);
            }
        }
        return $grid;
    },

    _syncUploadLibraryEmptyState: function () {
        const $grid = this._ensureUploadLibraryGrid();
        const $empty = $(".default_images .upload-library-empty");
        const hasItems = $grid.find(".image-item").length > 0;
        $grid.toggleClass("d-none", !hasItems);
        if ($empty.length) {
            $empty.toggleClass("d-none", hasItems);
        } else if (!hasItems) {
            $grid.after(
                `<p class="upload-library-empty">${_t("No uploads yet — drop a file above or browse to get started.")}</p>`
            );
        }
    },

    _appendUploadLibraryItem: function (result) {
        if (!result || !result.id) {
            return;
        }
        if (
            $(".default_images .upload-library-grid").find(
                `.image-item[data-id="${result.id}"]`
            ).length
        ) {
            return;
        }
        this._ensureUploadLibraryGrid().append(this._imageItemHtml(result));
        this._syncUploadLibraryEmptyState();
    },

    _isEmbeddedPhotoSvgFromUpload: function (result, svgText) {
        if (result && result.is_vector === true) {
            return false;
        }
        if (result && result.is_vector === false) {
            return true;
        }
        return !!(svgText && /<image[\s>]/i.test(svgText));
    },

    _isPhotoArtworkLayer: function (elem) {
        if (!elem) {
            return false;
        }
        if (elem.type === "image") {
            return true;
        }
        return !!(elem.type === "group" && elem.isEmbeddedPhotoSvg);
    },

    _syncArtworkToolbarTools: function (elem) {
        const isPhoto = this._isPhotoArtworkLayer(elem);
        $(".vectorize-tool").toggleClass("d-none", !isPhoto);
        $(".finish-tool").toggleClass("d-none", isPhoto);
    },

    _loadSvgGroupOnCanvas: function (svgText, options) {
        const self = this;
        options = options || {};
        const targetCanvas = options.targetCanvas || self.canvas;
        if (!targetCanvas || !svgText) {
            return Promise.reject(new Error("Missing canvas or SVG content."));
        }

        return new Promise((resolve, reject) => {
            fabric.loadSVGFromString(svgText, function (objects, fabricOptions) {
                if (!objects || !objects.length) {
                    reject(new Error("Could not parse SVG."));
                    return;
                }

                objects.forEach((obj) => {
                    if (obj && obj.set) {
                        try {
                            if (obj.fill && typeof obj.fill !== "object") {
                                obj.set("fill", chroma(obj.fill).hex());
                            }
                            if (obj.stroke && typeof obj.stroke !== "object") {
                                obj.set("stroke", chroma(obj.stroke).hex());
                            }
                        } catch (_) {
                            // Ignore chroma errors on unusual color formats
                        }
                        obj.set({
                            selectable: true,
                            hasControls: true,
                            lockScalingFlip: true,
                            centeredRotation: true,
                            centeredScaling: true,
                            locked: false,
                        });
                    }
                });

                const group = fabric.util.groupSVGElements(objects, fabricOptions);
                group.set({
                    centeredRotation: true,
                    centeredScaling: true,
                    locked: false,
                });

                if (options.isEmbeddedPhotoSvg) {
                    group.isEmbeddedPhotoSvg = true;
                } else {
                    group.isVectorSvgGroup = true;
                }
                if (options.backendId) {
                    group.backend_id = options.backendId;
                }
                if (options.preserveTransform && options.preserveTransform.left !== undefined) {
                    group.set(options.preserveTransform);
                } else {
                    self._fitFabricObjectToPlacementBox(group, targetCanvas);
                    self._clampObjectToDesignArea(targetCanvas, group);
                }

                self.elem_index += 1;
                group.id = options.id || self.elem_index;
                if (options.isEmbeddedPhotoSvg) {
                    self._syncPhotoSourcePixels(group, {
                        svgText,
                        sourceWidth: options.sourceWidth,
                        sourceHeight: options.sourceHeight,
                        filePixels: options.filePixels,
                    });
                }

                targetCanvas.add(group);
                targetCanvas.setActiveObject(group);
                targetCanvas.requestRenderAll();
                self._showObjectToolbar(group);
                self._updateDimOverlay?.(targetCanvas, group);
                self._activeSidebarOption = "image";
                resolve(group);
            });
        });
    },

    _isRasterUploadFile: function (file) {
        const ext = (file.name.split(".").pop() || "").toLowerCase();
        return ["jpg", "jpeg", "png", "gif", "webp", "bmp"].includes(ext);
    },

    _readRasterFileDimensions: function (file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = function () {
                resolve({
                    width: img.naturalWidth || img.width,
                    height: img.naturalHeight || img.height,
                });
                URL.revokeObjectURL(url);
            };
            img.onerror = function () {
                URL.revokeObjectURL(url);
                reject(new Error(_t("Could not read image dimensions.")));
            };
            img.src = url;
        });
    },

    _readRasterFileMetadata: async function (file) {
        const { width, height } = await this._readRasterFileDimensions(file);
        let fileDpi = null;
        try {
            const buffer = await file.arrayBuffer();
            fileDpi = this._parseRasterFileDpi(buffer);
        } catch (_) {
            // Ignore metadata parse errors; area-based check still applies.
        }
        return { width, height, fileDpi };
    },

    _parseRasterFileDpi: function (buffer) {
        if (!buffer || buffer.byteLength < 24) {
            return null;
        }
        const view = new DataView(buffer);
        const bytes = new Uint8Array(buffer);

        if (
            bytes[0] === 0x89 &&
            bytes[1] === 0x50 &&
            bytes[2] === 0x4e &&
            bytes[3] === 0x47
        ) {
            let offset = 8;
            while (offset + 12 <= bytes.length) {
                const length = view.getUint32(offset);
                const type = String.fromCharCode(
                    bytes[offset + 4],
                    bytes[offset + 5],
                    bytes[offset + 6],
                    bytes[offset + 7]
                );
                if (type === "pHYs" && length >= 9) {
                    const xppu = view.getUint32(offset + 8);
                    const unit = view.getUint8(offset + 16);
                    if (unit === 1 && xppu > 0) {
                        return Math.round((xppu / 39.3701) * 10) / 10;
                    }
                }
                offset += 12 + length;
            }
            return null;
        }

        if (bytes[0] === 0xff && bytes[1] === 0xd8) {
            let offset = 2;
            while (offset + 4 < bytes.length) {
                if (bytes[offset] !== 0xff) {
                    break;
                }
                const marker = bytes[offset + 1];
                if (marker === 0xd8 || marker === 0xd9) {
                    offset += 2;
                    continue;
                }
                const segLen = view.getUint16(offset + 2);
                if (segLen < 2 || offset + 2 + segLen > bytes.length) {
                    break;
                }
                if (marker === 0xe0 && segLen >= 14) {
                    const units = view.getUint8(offset + 9);
                    const xDensity = view.getUint16(offset + 10);
                    const yDensity = view.getUint16(offset + 12);
                    const density = Math.min(xDensity || 0, yDensity || xDensity || 0);
                    if (units === 1 && density > 0) {
                        return density;
                    }
                    if (units === 2 && density > 0) {
                        return Math.round(density * 2.54 * 10) / 10;
                    }
                }
                offset += 2 + segLen;
            }
        }
        return null;
    },

    _confirmUploadDpiIfNeeded: async function (file, targetCanvas) {
        if (!this._isRasterUploadFile(file)) {
            return null;
        }
        const meta = await this._readRasterFileMetadata(file);
        await this._confirmLowDpiUploadIfNeeded(
            meta.width,
            meta.height,
            targetCanvas,
            meta.fileDpi
        );
        return meta;
    },

    _readImageElementDimensions: function (src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = function () {
                resolve({
                    width: img.naturalWidth || img.width,
                    height: img.naturalHeight || img.height,
                });
            };
            img.onerror = function () {
                reject(new Error(_t("Could not read image dimensions.")));
            };
            img.src = src;
        });
    },

    _parseSvgRasterDimensions: function (svgText) {
        if (!svgText) {
            return null;
        }
        const widthMatch = svgText.match(/\bwidth=["']([\d.]+)/i);
        const heightMatch = svgText.match(/\bheight=["']([\d.]+)/i);
        const viewBoxMatch = svgText.match(
            /viewBox=["'](?:[\d.\s+-]+\s+){2}([\d.]+)\s+([\d.]+)/i
        );
        const width = widthMatch ? parseFloat(widthMatch[1]) : viewBoxMatch ? parseFloat(viewBoxMatch[1]) : 0;
        const height = heightMatch ? parseFloat(heightMatch[1]) : viewBoxMatch ? parseFloat(viewBoxMatch[2]) : 0;
        if (width > 0 && height > 0) {
            return { width: Math.round(width), height: Math.round(height) };
        }
        return null;
    },

    _processUploadedImageFile: function (file, targetCanvas) {
        const self = this;
        if (self._rejectIfShareReadOnly?.()) {
            return Promise.reject(
                Object.assign(new Error("read_only"), { shareReadOnly: true })
            );
        }
        const canvas = targetCanvas || self.canvas;
        const ext = (file.name.split(".").pop() || "").toLowerCase();

        if (ext === "ai" || ext === "eps") {
            return self.uploadAndConvertToSVG(file, canvas);
        }

        return self
            ._confirmUploadDpiIfNeeded(file, canvas)
            .then(function (fileMeta) {
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = function (event) {
                        const base64 = event.target.result.split(",")[1];
                        self.rpc("/canvas/upload_image", {
                            filename: file.name,
                            filedata: base64,
                        }).then(function (result) {
                            if (result.error === "read_only") {
                                reject(
                                    Object.assign(new Error("read_only"), {
                                        shareReadOnly: true,
                                    })
                                );
                                return;
                            }
                            if (result.error) {
                                reject(new Error(result.error));
                                return;
                            }
                            const isPhoto = self._isEmbeddedPhotoSvgFromUpload(
                                result,
                                result.svg
                            );
                            self._loadSvgGroupOnCanvas(result.svg, {
                                backendId: result.id,
                                filename: result.name,
                                targetCanvas: canvas,
                                isEmbeddedPhotoSvg: isPhoto,
                                sourceWidth: result.source_width,
                                sourceHeight: result.source_height,
                                filePixels: fileMeta
                                    ? {
                                          width: fileMeta.width,
                                          height: fileMeta.height,
                                      }
                                    : null,
                            }).then(function (group) {
                                self._appendUploadLibraryItem(result);
                                resolve(group);
                            }).catch(reject);
                        }).catch(reject);
                    };
                    reader.onerror = function () {
                        reject(new Error("Failed to read file."));
                    };
                    reader.readAsDataURL(file);
                });
            })
            .catch(function (err) {
                if (err && (err.dpiCancelled || err.message === "dpi_cancelled")) {
                    return Promise.reject(
                        Object.assign(new Error("dpi_cancelled"), { dpiCancelled: true })
                    );
                }
                throw err;
            });
    },

    _getEmbeddedPhotoRasterSource: function (group) {
        if (!group || group.type !== "group") {
            return null;
        }
        const objects = typeof group.getObjects === "function" ? group.getObjects() : [];
        for (const obj of objects) {
            if (obj.type === "image") {
                return this._getFabricImageSource(obj);
            }
        }
        return null;
    },

    _replaceCanvasObjectWithSvgGroup: function (canvas, obj, svgText, options) {
        const self = this;
        options = options || {};
        if (!canvas || !obj || !svgText) {
            return Promise.resolve(null);
        }

        const preserveTransform = {
            left: obj.left,
            top: obj.top,
            scaleX: obj.scaleX,
            scaleY: obj.scaleY,
            angle: obj.angle,
            flipX: obj.flipX,
            flipY: obj.flipY,
            opacity: obj.opacity,
            originX: obj.originX,
            originY: obj.originY,
            id: obj.id,
            backend_id: options.backendId || obj.backend_id,
            locked: obj.locked,
        };
        const index = canvas.getObjects().indexOf(obj);
        canvas.remove(obj);

        return self._loadSvgGroupOnCanvas(svgText, {
            targetCanvas: canvas,
            backendId: preserveTransform.backend_id,
            isEmbeddedPhotoSvg: options.isEmbeddedPhotoSvg !== false,
            preserveTransform: preserveTransform,
            id: preserveTransform.id,
        }).then(function (group) {
            if (index >= 0) {
                canvas.remove(group);
                canvas.insertAt(group, index);
                canvas.setActiveObject(group);
                canvas.requestRenderAll();
            }
            self.currentElement = group;
            self.saveState();
            return group;
        });
    },

    uploadAndConvertToSVG: function (file, targetCanvas) {
        const self = this;
        if (self._rejectIfShareReadOnly?.()) {
            return Promise.reject(
                Object.assign(new Error("read_only"), { shareReadOnly: true })
            );
        }
        const formData = new FormData();
        formData.append("file", file);

        return fetch("/convert_to_svg", {
            method: "POST",
            body: formData,
        })
            .then(function (res) {
                if (!res.ok) {
                    throw new Error("Conversion failed.");
                }
                return res.json();
            })
            .then(function (result) {
                if (!result || !result.svg) {
                    throw new Error("Invalid conversion response.");
                }
                return self._loadSvgGroupOnCanvas(result.svg, {
                    backendId: result.id,
                    filename: result.name,
                    targetCanvas: targetCanvas || self.canvas,
                    isEmbeddedPhotoSvg: false,
                }).then(function () {
                    self._appendUploadLibraryItem(result);
                    return result;
                });
            })
            .catch(function (err) {
                console.error("Error converting file to SVG:", err);
                self.removeLoader();
                self.notification.add(
                    _t("Could not convert file to SVG."),
                    { type: "danger" }
                );
                throw err;
            });
    },
};
