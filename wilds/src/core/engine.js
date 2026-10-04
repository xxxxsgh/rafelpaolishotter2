// Renderer, scene, camera, shared uniforms and the frame loop.
// Systems plug in through ctx (see main.js). Rendering can be taken over by the
// lighting/post system by assigning ctx.renderFn = (dt) => { ... }.
import * as THREE from 'three';

export class Engine {
  constructor(canvas) {
    const params = new URLSearchParams(location.search);
    this.params = params;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('shot') });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, params.has('shot') ? 1 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 6000);
    this.camera.position.set(0, 80, 40);

    // Shared uniforms: every custom shader should reference these objects
    // directly so time/wind/sun/fog stay in sync without per-system plumbing.
    this.uniforms = {
      uTime: { value: 0 },
      uWindDir: { value: new THREE.Vector2(1, 0.3).normalize() },
      uWindStrength: { value: 0.6 },
      uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
      uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
      uSkyColor: { value: new THREE.Color(0.55, 0.72, 0.95) },
      uGroundColor: { value: new THREE.Color(0.35, 0.33, 0.25) },
      uFogColor: { value: new THREE.Color(0.7, 0.8, 0.9) },
      uFogDensity: { value: 0.00035 },
      uRain: { value: 0 },
      uWetness: { value: 0 },
      uPlayerPos: { value: new THREE.Vector3() },
    };

    this.clock = new THREE.Clock();
    this.time = 0;
    this.timeScale = 1;
    this.updaters = [];   // [{name, fn}]
    this.renderFn = null;
    addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = this.renderer.domElement.clientWidth || innerWidth;
    const h = this.renderer.domElement.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    for (const cb of this._resizeCbs || []) cb(w, h);
  }
  onResize(cb) { (this._resizeCbs ||= []).push(cb); }

  add(name, fn) { this.updaters.push({ name, fn }); }

  start(beforeFrame, afterFrame) {
    const loop = () => {
      requestAnimationFrame(loop);
      this.step(Math.min(this.clock.getDelta(), 1 / 20), beforeFrame, afterFrame);
    };
    loop();
  }

  step(rawDt, beforeFrame, afterFrame) {
    const dt = rawDt * this.timeScale;
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    beforeFrame?.(dt);
    for (const u of this.updaters) {
      try { u.fn(dt); } catch (e) { if (!u.failed) { console.error(`[${u.name}] update failed`, e); u.failed = true; } }
    }
    if (this.renderFn) this.renderFn(dt);
    else this.renderer.render(this.scene, this.camera);
    afterFrame?.(dt);
  }
}
