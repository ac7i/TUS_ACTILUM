/** @odoo-module **/

/**
 * Design areas: rectangle (legacy) or polygon (custom shape from backend wizard).
 * All polygon points are in stage space (stage_width × stage_height).
 */

export function normalizeDesignArea(area) {
    if (!area) {
        return area;
    }
    const copy = { ...area };
    if (Array.isArray(copy.points) && copy.points.length >= 3) {
        copy.shape = copy.shape || "polygon";
    } else {
        copy.shape = copy.shape || "rect";
    }
    return copy;
}

export function normalizeDesignAreas(areas) {
    return (areas || []).map(normalizeDesignArea);
}

export function isShapedArea(area) {
    return normalizeDesignArea(area)?.shape === "polygon";
}

export function areaBounds(area, stage) {
    const a = normalizeDesignArea(area);
    if (a.shape === "polygon" && a.points?.length) {
        const xs = a.points.map((p) => p[0]);
        const ys = a.points.map((p) => p[1]);
        const left = Math.min(...xs);
        const top = Math.min(...ys);
        return {
            left,
            top,
            width: Math.max(...xs) - left,
            height: Math.max(...ys) - top,
        };
    }
    return {
        left: a.left || 0,
        top: a.top || 0,
        width: a.width || 0,
        height: a.height || 0,
    };
}

/**
 * Layout for placing the design-area overlay on the storefront mockup.
 * Polygon areas use the full mockup (stage-aligned) so they match the wizard exactly.
 */
export function getAreaDisplayLayout(area, stage, imgRect, offsetX, offsetY) {
    const a = normalizeDesignArea(area);
    const stageW = stage?.w || 394;
    const stageH = stage?.h || 394;
    const widthRatio = imgRect.width / stageW;
    const heightRatio = imgRect.height / stageH;

    if (a.shape === "polygon") {
        return {
            mode: "polygon",
            left: offsetX,
            top: offsetY,
            width: imgRect.width,
            height: imgRect.height,
            canvasW: Math.max(1, Math.round(imgRect.width)),
            canvasH: Math.max(1, Math.round(imgRect.height)),
            widthRatio,
            heightRatio,
            stageW,
            stageH,
        };
    }

    const bbox = areaBounds(a, stage);
    return {
        mode: "rect",
        left: offsetX + widthRatio * bbox.left,
        top: offsetY + heightRatio * bbox.top,
        width: widthRatio * bbox.width,
        height: heightRatio * bbox.height,
        canvasW: Math.max(1, Math.round(widthRatio * bbox.width)),
        canvasH: Math.max(1, Math.round(heightRatio * bbox.height)),
        widthRatio,
        heightRatio,
        stageW,
        stageH,
        bbox,
    };
}

/** Stage coordinates → canvas pixel coordinates. */
export function stagePointsToCanvas(points, widthRatio, heightRatio) {
    return (points || []).map(([x, y]) => ({
        x: x * widthRatio,
        y: y * heightRatio,
    }));
}

export function cssClipPathPolygonStage(area, stageW, stageH) {
    const pts = area.points
        .map(([x, y]) => {
            const px = (x / stageW) * 100;
            const py = (y / stageH) * 100;
            return `${px.toFixed(4)}% ${py.toFixed(4)}%`;
        })
        .join(", ");
    return `polygon(${pts})`;
}

export function buildFabricClipPath(area, layout) {
    if (!window.fabric || layout.mode !== "polygon") {
        return null;
    }
    const pts = stagePointsToCanvas(area.points, layout.widthRatio, layout.heightRatio);
    return new fabric.Polygon(pts, {
        absolutePositioned: true,
        originX: "left",
        originY: "top",
    });
}

export function pointInPolygon(x, y, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const xi = points[i].x;
        const yi = points[i].y;
        const xj = points[j].x;
        const yj = points[j].y;
        const intersect =
            yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
        if (intersect) {
            inside = !inside;
        }
    }
    return inside;
}

export function applyAreaGeometryStyles(wrapper, area, layout, color) {
    wrapper.style.clipPath = "";
    wrapper.style.webkitClipPath = "";
    wrapper.classList.remove("design-area--shaped", "design-area--rect");
    wrapper.style.background = "transparent";

    if (layout.mode === "polygon") {
        wrapper.classList.add("design-area--shaped");
        wrapper.style.border = "none";
        const clip = cssClipPathPolygonStage(area, layout.stageW, layout.stageH);
        wrapper.style.clipPath = clip;
        wrapper.style.webkitClipPath = clip;
        return;
    }

    wrapper.classList.add("design-area--rect");
    wrapper.style.border = `1px dashed ${color || "#6366f1"}`;
}

export function ensureBoundarySvg(wrapper, area, layout, color) {
    const existing = wrapper.querySelector(".design-area-boundary-svg");
    if (layout.mode !== "polygon") {
        if (existing) {
            existing.remove();
        }
        return;
    }
    let svg = existing;
    if (!svg) {
        svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("class", "design-area-boundary-svg");
        svg.style.cssText =
            "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:6;";
        wrapper.appendChild(svg);
    }
    const poly = stagePointsToCanvas(area.points, layout.widthRatio, layout.heightRatio);
    const pointsAttr = poly.map((p) => `${p.x},${p.y}`).join(" ");
    svg.innerHTML = "";
    const pg = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    pg.setAttribute("points", pointsAttr);
    pg.setAttribute("fill", "none");
    pg.setAttribute("stroke", color || "#374151");
    pg.setAttribute("stroke-width", "2");
    pg.setAttribute("stroke-dasharray", "8 5");
    pg.setAttribute("vector-effect", "non-scaling-stroke");
    svg.appendChild(pg);
}
