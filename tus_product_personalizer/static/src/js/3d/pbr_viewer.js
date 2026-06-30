/** @odoo-module **/

import { getPBRSettings, reliefMmToDisplacementScale, DEFAULT_RELIEF_MM } from "./finish_effects";
import { canvasToTexture, dataUrlToTexture } from "./texture_baker";

function getTHREE() {
    if (typeof window === "undefined" || !window.THREE) {
        throw new Error("Three.js is not loaded");
    }
    return window.THREE;
}

function configureColorTexture(THREE, tex, renderer) {
    tex.encoding = THREE.sRGBEncoding;
    tex.flipY = true;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    if (renderer?.capabilities) {
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    }
    tex.needsUpdate = true;
    return tex;
}

function configureDataTexture(THREE, tex) {
    if (THREE.LinearEncoding !== undefined) {
        tex.encoding = THREE.LinearEncoding;
    }
    tex.flipY = true;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
}

export class TusPBRViewer {
    constructor(containerEl) {
        this.containerEl = containerEl;
        this._running = false;
        this._disposed = false;
        this._textures = [];
        this._animationId = null;
        this._onResize = this._onResize.bind(this);
        this._materialMode = null;
    }

    static isWebGLAvailable() {
        try {
            const canvas = document.createElement("canvas");
            return !!(window.WebGLRenderingContext && (
                canvas.getContext("webgl") || canvas.getContext("experimental-webgl")
            ));
        } catch (e) {
            return false;
        }
    }

    async init() {
        const THREE = getTHREE();
        if (!TusPBRViewer.isWebGLAvailable()) {
            throw new Error("WebGL is not supported in this browser");
        }

        this.canvasEl = this.containerEl.querySelector(".tus-3d-canvas");
        if (!this.canvasEl) {
            this.canvasEl = document.createElement("canvas");
            this.canvasEl.className = "tus-3d-canvas";
            this.containerEl.appendChild(this.canvasEl);
        }

        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvasEl,
            antialias: true,
            alpha: false,
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.outputEncoding = THREE.sRGBEncoding;
        // No tone mapping — keep mockup colors identical to the 2D editor composite.
        this.renderer.toneMapping = THREE.NoToneMapping;
        this.renderer.toneMappingExposure = 1.0;

        this.scene = new THREE.Scene();
        // Match the 2D editor canvas background so product colors read the same.
        this.scene.background = new THREE.Color(0xffffff);

        this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
        this.camera.position.set(0, 0, 2.8);

        this.productGroup = new THREE.Group();
        this.scene.add(this.productGroup);

        // Neutral white lighting only — colored fill lights shift product hue.
        const ambient = new THREE.AmbientLight(0xffffff, 0.58);
        this.scene.add(ambient);

        this.keyLight = new THREE.DirectionalLight(0xffffff, 0.42);
        this.keyLight.position.set(3.0, 2.5, 4.5);
        this.scene.add(this.keyLight);

        this.fillLight = new THREE.DirectionalLight(0xffffff, 0.14);
        this.fillLight.position.set(-2.0, -0.5, 2.0);
        this.scene.add(this.fillLight);

        this.rimLight = new THREE.DirectionalLight(0xffffff, 0.08);
        this.rimLight.position.set(0, 2.5, -2.0);
        this.scene.add(this.rimLight);

        this._defaultLightIntensities = {
            ambient: ambient.intensity,
            key: this.keyLight.intensity,
            fill: this.fillLight.intensity,
            rim: this.rimLight.intensity,
        };

        this.mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(1, 1, 192, 192),
            this._createBasicMaterial(THREE)
        );
        this.productGroup.add(this.mesh);
        this._materialMode = "basic";

        if (THREE.OrbitControls) {
            this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
            this.controls.enableDamping = true;
            this.controls.dampingFactor = 0.08;
            this.controls.enablePan = false;
            this.controls.minDistance = 1.2;
            this.controls.maxDistance = 6;
            this.controls.target.set(0, 0, 0);
        }

        this._running = true;
        this._onResize();
        window.addEventListener("resize", this._onResize);
        this._animate();
    }

    _createBasicMaterial(THREE) {
        return new THREE.MeshBasicMaterial({
            color: 0xffffff,
            side: THREE.FrontSide,
            transparent: true,
            alphaTest: 0.08,
        });
    }

    _createPhysicalMaterial(THREE) {
        return new THREE.MeshPhysicalMaterial({
            color: 0xffffff,
            roughness: 1.0,
            metalness: 0.0,
            side: THREE.FrontSide,
            transparent: true,
            alphaTest: 0.08,
        });
    }

    _setMaterialMode(THREE, mode) {
        if (this._materialMode === mode && this.mesh?.material) {
            return;
        }
        if (this.mesh?.material) {
            this.mesh.material.dispose();
        }
        this.mesh.material = mode === "physical"
            ? this._createPhysicalMaterial(THREE)
            : this._createBasicMaterial(THREE);
        this._materialMode = mode;
    }

    _onResize() {
        if (!this.containerEl || !this.renderer || !this.camera) {
            return;
        }
        const rect = this.containerEl.getBoundingClientRect();
        const w = Math.max(1, rect.width);
        const h = Math.max(1, rect.height);
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }

    _animate() {
        if (!this._running || this._disposed) {
            return;
        }
        this._animationId = requestAnimationFrame(() => this._animate());
        if (this.controls) {
            this.controls.update();
        }
        this.renderer.render(this.scene, this.camera);
    }

    _disposeTextures() {
        for (const tex of this._textures) {
            tex.dispose();
        }
        this._textures = [];
    }

    _setFoilLighting(hasFoil) {
        const d = this._defaultLightIntensities;
        if (!d) {
            return;
        }
        if (hasFoil) {
            this.keyLight.intensity = d.key * 1.55;
            this.rimLight.intensity = d.rim * 2.75;
            this.fillLight.intensity = d.fill * 0.85;
        } else {
            this.keyLight.intensity = d.key;
            this.rimLight.intensity = d.rim;
            this.fillLight.intensity = d.fill;
        }
    }

    async updateMaps(maps, settings = {}) {
        const THREE = getTHREE();
        if (!this.mesh?.material || !maps) {
            return;
        }
        this._disposeTextures();

        const pbr = getPBRSettings({ ...settings, hasFoil: !!maps.hasFoil });
        const aspect = maps.aspect || 1;
        const maxSize = 1.6;
        let planeW = maxSize;
        let planeH = maxSize;
        if (aspect >= 1) {
            planeH = maxSize / aspect;
        } else {
            planeW = maxSize * aspect;
        }
        this.mesh.geometry.dispose();
        this.mesh.geometry = new THREE.PlaneGeometry(planeW, planeH, 192, 192);

        const hasEmboss = !!maps.hasEmboss;
        const hasVarnish = !!maps.hasVarnish;
        const hasFoil = !!maps.hasFoil;
        const varnishType = settings.varnishType || "none";
        const usePhysical = hasEmboss || hasVarnish || hasFoil;

        this._setFoilLighting(hasFoil);

        this._setMaterialMode(THREE, usePhysical ? "physical" : "basic");
        const material = this.mesh.material;

        const colorTex = maps.colorCanvas
            ? canvasToTexture(THREE, maps.colorCanvas, {
                colorSpace: "srgb",
                anisotropy: this.renderer.capabilities.getMaxAnisotropy(),
            })
            : await dataUrlToTexture(THREE, maps.colorDataUrl, this.renderer);
        configureColorTexture(THREE, colorTex, this.renderer);
        this._textures.push(colorTex);

        let alphaTex = null;
        if (maps.alphaCanvas) {
            alphaTex = canvasToTexture(THREE, maps.alphaCanvas, {
                colorSpace: "linear",
                generateMipmaps: false,
            });
            configureDataTexture(THREE, alphaTex);
            alphaTex.wrapS = alphaTex.wrapT = THREE.ClampToEdgeWrapping;
            this._textures.push(alphaTex);
        }

        if (!usePhysical) {
            // Unlit path — pixel-accurate match with the 2D editor composite.
            material.map = colorTex;
            material.alphaMap = null;
            material.transparent = true;
            material.alphaTest = 0.001;
            material.needsUpdate = true;
            this._updateDimensionLabels(maps.widthMm, maps.heightMm, planeW, planeH);
            this._onResize();
            return;
        }

        let dispTex = null;
        let normalTex = null;
        if (hasEmboss) {
            dispTex = canvasToTexture(THREE, maps.displacementCanvas, {
                colorSpace: "linear",
                generateMipmaps: false,
            });
            configureDataTexture(THREE, dispTex);
            dispTex.wrapS = dispTex.wrapT = THREE.ClampToEdgeWrapping;
            this._textures.push(dispTex);

            normalTex = canvasToTexture(THREE, maps.normalCanvas, {
                colorSpace: "linear",
                generateMipmaps: false,
            });
            configureDataTexture(THREE, normalTex);
            normalTex.wrapS = normalTex.wrapT = THREE.ClampToEdgeWrapping;
            this._textures.push(normalTex);
        }

        let roughTex = null;
        if ((hasVarnish && varnishType !== "none") || hasFoil) {
            roughTex = canvasToTexture(THREE, maps.roughnessCanvas, {
                colorSpace: "linear",
                generateMipmaps: false,
            });
            configureDataTexture(THREE, roughTex);
            roughTex.wrapS = roughTex.wrapT = THREE.ClampToEdgeWrapping;
            this._textures.push(roughTex);
        }

        let metalTex = null;
        if (hasFoil && maps.foilMetalnessCanvas) {
            metalTex = canvasToTexture(THREE, maps.foilMetalnessCanvas, {
                colorSpace: "linear",
                generateMipmaps: false,
            });
            configureDataTexture(THREE, metalTex);
            metalTex.wrapS = metalTex.wrapT = THREE.ClampToEdgeWrapping;
            this._textures.push(metalTex);
        }

        const reliefScale = hasEmboss
            ? reliefMmToDisplacementScale(settings.reliefMm ?? pbr.reliefMm ?? DEFAULT_RELIEF_MM)
            : 0;

        // Keep diffuse map for visibility/alpha; boost emissive so PBR lights do not wash out color.
        material.map = colorTex;
        material.emissiveMap = colorTex;
        material.emissive.setHex(0xffffff);
        material.emissiveIntensity = pbr.foilEmissiveIntensity;
        material.displacementMap = dispTex;
        material.displacementScale = reliefScale;
        material.displacementBias = 0;
        material.normalMap = normalTex;
        material.normalScale = new THREE.Vector2(
            hasEmboss ? pbr.normalStrength : 1,
            hasEmboss ? pbr.normalStrength : 1
        );
        material.roughness = (hasVarnish || hasFoil) ? pbr.baseRoughness : 1.0;
        material.roughnessMap = roughTex;
        material.metalnessMap = metalTex;
        material.metalness = hasFoil ? pbr.foilMetalness : 0.0;
        material.clearcoat = hasVarnish ? pbr.clearcoat : 0;
        material.clearcoatRoughness = hasVarnish ? pbr.clearcoatRoughness : 1;

        if (material.sheen instanceof THREE.Color) {
            if (hasVarnish && pbr.useSheenColor) {
                material.sheen.set(0xffffff);
            } else {
                material.sheen.set(0x000000);
            }
        }

        material.alphaMap = null;
        material.transparent = true;
        material.alphaTest = 0.001;
        material.needsUpdate = true;

        this._updateDimensionLabels(maps.widthMm, maps.heightMm, planeW, planeH);
        this._onResize();
    }

    get material() {
        return this.mesh?.material;
    }

    _updateDimensionLabels(widthMm, heightMm, planeW, planeH) {
        let labels = this.containerEl.querySelector(".tus-3d-dimensions");
        if (!labels) {
            labels = document.createElement("div");
            labels.className = "tus-3d-dimensions";
            this.containerEl.appendChild(labels);
        }
        const wLabel = widthMm ? `${Math.round(widthMm)} mm` : "";
        const hLabel = heightMm ? `${Math.round(heightMm)} mm` : "";
        labels.innerHTML = `
            <span class="tus-3d-dim tus-3d-dim-top">${wLabel}</span>
            <span class="tus-3d-dim tus-3d-dim-right">${hLabel}</span>
        `;
    }

    resetView() {
        if (!this.controls || !this.camera) {
            return;
        }
        this.controls.reset();
        this.camera.position.set(0, 0, 2.8);
        this.controls.target.set(0, 0, 0);
        this.controls.update();
    }

    pause() {
        this._running = false;
        if (this._animationId) {
            cancelAnimationFrame(this._animationId);
            this._animationId = null;
        }
    }

    resume() {
        if (this._disposed || this._running) {
            return;
        }
        this._running = true;
        this._animate();
    }

    dispose() {
        this._disposed = true;
        this.pause();
        window.removeEventListener("resize", this._onResize);
        if (this.controls) {
            this.controls.dispose();
        }
        this._disposeTextures();
        if (this.mesh?.geometry) {
            this.mesh.geometry.dispose();
        }
        if (this.mesh?.material) {
            this.mesh.material.dispose();
        }
        if (this.renderer) {
            this.renderer.dispose();
        }
        const labels = this.containerEl?.querySelector(".tus-3d-dimensions");
        if (labels) {
            labels.remove();
        }
    }
}
