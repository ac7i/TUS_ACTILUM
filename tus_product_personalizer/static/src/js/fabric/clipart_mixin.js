/** @odoo-module **/

import { CLIPART_CATEGORIES } from "./constants";
export const fabricClipartMixin = {
_renderClipartCategories: async function (isSearch = false) {
    const container = this.el.querySelector("#clipart-categories-container");
    if (!container) return;

    if (container.innerHTML.trim() === "" || isSearch) {
        let html = "";
        for (const [key, cat] of Object.entries(CLIPART_CATEGORIES)) {
            html += `
                <div class="clipart-category mb-4" data-category="${key}" id="cat-wrapper-${key}">
                    <div class="d-flex justify-content-between align-items-center mb-2">
                        <h6 class="text-dark m-0 fw-bold" style="font-size: 14px;">${cat.label}</h6>
                        <a href="#" class="text-primary text-decoration-none small toggle_clipart_view fw-bold d-none" data-category="${key}" style="font-size: 13px;">See more</a>
                    </div>
                    <div class="clipart-grid d-flex flex-wrap gap-2" id="grid-${key}">
                        <div class="spinner-border text-primary spinner-border-sm mx-auto my-3" role="status"></div>
                    </div>
                    <div class="text-center mt-3 btn-more-container">
                         <button class="btn btn-sm btn-outline-secondary load_more_clipart d-none" data-category="${key}" style="border-radius:20px; padding: 4px 16px;">Load more</button>
                    </div>
                </div>
            `;
        }
        container.innerHTML = html;
    }

    for (const [key, cat] of Object.entries(CLIPART_CATEGORIES)) {
        if (!cat.loaded) {
            try {
                const response = await fetch(`https://api.iconify.design/collection?prefix=${cat.prefix}`);
                if (response.ok) {
                    const data = await response.json();
                    let names = [];
                    if (data.uncategorized) {
                        names.push(...data.uncategorized);
                    }
                    if (data.categories) {
                        for (let cList of Object.values(data.categories)) {
                            names.push(...cList);
                        }
                    }
                    let allNames = [...new Set(names)];
                    // Apply keyword filter if this category defines one
                    if (cat.filterKeywords && cat.filterKeywords.length) {
                        allNames = allNames.filter(name =>
                            cat.filterKeywords.some(kw => name.includes(kw))
                        );
                    }
                    cat.all_icons = allNames;
                    cat.loaded = true;
                } else {
                    cat.loaded = true;
                }
            } catch (e) {
                console.error("Failed loading category", key, e);
                cat.loaded = true;
            }
        }
        if (isSearch && !this._currentSearchQuery) {
            cat.expanded = false;
            cat.offset = 0;
        }
        this._renderClipartGrid(key);
    }
},

_renderClipartGrid: function (key) {
    const cat = CLIPART_CATEGORIES[key];
    const grid = this.el.querySelector(`#grid-${key}`);
    const wrapper = this.el.querySelector(`#cat-wrapper-${key}`);
    const toggleBtn = this.el.querySelector(`.toggle_clipart_view[data-category="${key}"]`);
    const loadMoreBtn = this.el.querySelector(`.load_more_clipart[data-category="${key}"]`);
    if (!grid) return;

    let sourceList = cat.all_icons;
    if (this._currentSearchQuery) {
        const query = this._currentSearchQuery.toLowerCase().replace(/\s+/g, '-');
        sourceList = sourceList.filter(i => i.includes(query));
    }

    if (sourceList.length === 0) {
        wrapper.classList.add("d-none");
        return;
    }
    wrapper.classList.remove("d-none");

    const limit = cat.expanded ? Math.max(48, cat.offset) : 8;
    const effectiveList = sourceList.slice(0, limit);

    let htmlChunk = "";
    effectiveList.forEach(iconName => {
        const fullIconName = `${cat.prefix}:${iconName}`;
        htmlChunk += `
            <div class="clipart-item add_clipart_icon flex-shrink-0 cursor-pointer p-2 border rounded bg-light d-flex align-items-center justify-content-center shadow-sm" 
                 data-icon="${fullIconName}" 
                 style="width: 52px; height: 52px; transition: all 0.2s ease;"
                 onmouseover="this.style.transform='scale(1.1)'; this.style.backgroundColor='#fff'"
                 onmouseout="this.style.transform='scale(1)'; this.style.backgroundColor='#f8f9fa'">
                <span class="iconify text-dark" data-icon="${fullIconName}" data-width="34" data-height="34"></span>
            </div>
        `;
    });

    grid.innerHTML = htmlChunk;

    if (sourceList.length > 8) {
        toggleBtn.classList.remove("d-none");
        toggleBtn.innerText = cat.expanded ? "See less" : "See more";
    } else {
        toggleBtn.classList.add("d-none");
    }

    if (cat.expanded && effectiveList.length < sourceList.length) {
        loadMoreBtn.classList.remove("d-none");
    } else {
        loadMoreBtn.classList.add("d-none");
    }

    if (window.Iconify) {
        window.Iconify.scan();
    }
},

_onSearchClipartInput: function (ev) {
    this._currentSearchQuery = ev.target.value.trim();
    for (let key in CLIPART_CATEGORIES) {
        CLIPART_CATEGORIES[key].expanded = !!this._currentSearchQuery;
        CLIPART_CATEGORIES[key].offset = 48;
    }
    this._renderClipartCategories(true);
},

_onToggleClipartView: function (ev) {
    ev.preventDefault();
    const key = $(ev.currentTarget).data("category");
    if (!key) return;
    const cat = CLIPART_CATEGORIES[key];
    cat.expanded = !cat.expanded;
    cat.offset = cat.expanded ? 48 : 0;
    this._renderClipartGrid(key);
},

_onLoadMoreClipart: function (ev) {
    ev.preventDefault();
    const key = $(ev.currentTarget).data("category");
    if (!key) return;
    const cat = CLIPART_CATEGORIES[key];
    cat.offset += 48;
    this._renderClipartGrid(key);
},

_onAddClipartIcon: async function (ev) {
    const iconName = $(ev.currentTarget).data("icon");
    if (!iconName) return;
    if (!this.canvas) return;

    try {
        const svgText = await this._loadIconifySVG(iconName);
        const self = this;
        fabric.loadSVGFromString(svgText, function (objects, options) {
            if (!objects || objects.length === 0) {
                console.warn("No SVG objects parsed for", iconName);
                return;
            }
            var obj = fabric.util.groupSVGElements(objects, options);

            // Use canvas.getCenter() — same approach as _onAddShape
            const center = self.canvas.getCenter();

            // Scale to ~30% of the smallest canvas dimension
            var maxDim = Math.max(obj.width || 1, obj.height || 1);
            var targetSize = Math.min(self.canvas.width, self.canvas.height) * 0.3;
            var scale = targetSize / maxDim;

            obj.set({
                left: center.left,
                top: center.top,
                originX: 'center',
                originY: 'center',
                scaleX: scale,
                scaleY: scale,
                id: Date.now().toString(),
                type_custom: 'clipart',
            });
            obj.setCoords();

            self.canvas.add(obj);
            self.canvas.setActiveObject(obj);
            self.canvas.requestRenderAll();
            self.updateLayers();
            self.saveState();
        });
    } catch (e) {
        console.error("Failed to load Clipart SVG", e);
    }
},

_loadIconifySVG: function (iconName) {
    return new Promise((resolve, reject) => {
        // Method 1: fetch straight from Iconify CDN as SVG
        const svgUrl = `https://api.iconify.design/${iconName.replace(':', '/')}.svg`;
        fetch(svgUrl)
            .then(res => {
                if (!res.ok) throw new Error('SVG fetch failed: ' + res.status);
                return res.text();
            })
            .then(svgText => {
                if (!svgText || !svgText.trim().startsWith('<svg')) {
                    throw new Error('Invalid SVG response');
                }
                resolve(svgText);
            })
            .catch(() => {
                // Method 2: fallback to Iconify.loadIcon
                if (!window.Iconify) return reject('Iconify not loaded');
                window.Iconify.loadIcon(iconName).then(iconData => {
                    if (!iconData) return reject('Icon not found');
                    const w = iconData.width || 24;
                    const h = iconData.height || 24;
                    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${iconData.body}</svg>`;
                    resolve(svg);
                }).catch(reject);
            });
    });
},
};
