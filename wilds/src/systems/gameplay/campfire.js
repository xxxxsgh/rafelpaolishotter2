// Campfires with a hanging cooking pot: stone ring, leaning logs with glowing ends, layered
// painterly flame billboards, embers / sparks / smoke / steam particles, a screen-space fire
// light, a bubbling soup surface and the cooking animation (ingredients tossed in, bouncing in
// the boil, steam + sparks, the finished dish rising out of the pot).
import * as THREE from 'three';
import { campfireGeometry, tripodGeometry, potGeometry, campDressing, lanternGeometry, ingredientGeometry, dishGeometry } from './models.js';
import { makeFlame } from './fx.js';
import { toonMesh } from './toon.js';

const SOUP_VERT = /* glsl */`
#include <fog_pars_vertex>
varying vec2 vUv; varying vec3 vWorld;
void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const SOUP_FRAG = /* glsl */`
#include <fog_pars_fragment>
uniform float uTime; uniform float uBoil; uniform vec3 uCol; uniform vec3 uCol2; uniform float uGlow;
varying vec2 vUv; varying vec3 vWorld;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 h2(vec2 p) { return vec2(h(p), h(p + 17.3)); }
float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  // swirling broth
  float a = atan(p.y, p.x) + uTime * 0.35 * (0.4 + uBoil);
  vec2 q = vec2(cos(a), sin(a)) * r;
  float sw = n(q * 4.0 + uTime * 0.2) * 0.6 + n(q * 9.0 - uTime * 0.3) * 0.4;
  vec3 c = mix(uCol, uCol2, smoothstep(0.35, 0.75, sw));
  // bubbles: voronoi-ish cells that grow and pop
  float bub = 0.0;
  vec2 g = p * 5.0;
  vec2 gi = floor(g);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 cell = gi + vec2(float(x), float(y));
    vec2 o = h2(cell);
    float ph = fract(uTime * (0.5 + o.x * 0.9) * (0.4 + uBoil * 1.4) + o.y);
    float rad = 0.12 + 0.3 * ph;
    float d = length(g - cell - o);
    float ring = smoothstep(rad, rad - 0.08, d) * smoothstep(rad - 0.2, rad - 0.08, d);
    bub += ring * step(o.x, 0.35 + uBoil * 0.55) * (1.0 - ph * 0.5);
  }
  c += vec3(1.0, 0.95, 0.85) * bub * 0.45;
  // firelit rim + soft centre highlight
  c *= 0.75 + 0.35 * (1.0 - r);
  c += uCol2 * uGlow * (1.0 - r) * 0.5;
  float edge = smoothstep(1.0, 0.92, r);
  gl_FragColor = vec4(c, edge);
  #include <fog_fragment>
}`;

export function createCampfireKit(ctx, res) {
  const { scene, world } = ctx;
  const geos = {
    fire: campfireGeometry(3), tripod: tripodGeometry(), pot: potGeometry(),
    dressing: campDressing(7), lantern: lanternGeometry(),
  };

  class Campfire {
    constructor(def) {
      this.def = def;
      this.id = def.id;
      const y = def.y ?? world.getHeight(def.x, def.z);
      this.pos = new THREE.Vector3(def.x, y, def.z);
      this.yaw = def.yaw || 0;
      const g = this.group = new THREE.Group();
      g.position.copy(this.pos); g.rotation.y = this.yaw;
      g.name = 'campfire-' + def.id;
      g.add(toonMesh(ctx, geos.fire, res.mat, null));
      this.lit = def.lit !== false;
      this.hasPot = def.pot !== false;
      if (this.hasPot) {
        g.add(toonMesh(ctx, geos.tripod, res.mat, null));
        this.potPivot = new THREE.Group(); this.potPivot.position.set(0, 0.55, 0);
        g.add(this.potPivot);
        this.pot = toonMesh(ctx, geos.pot, res.mat, res.outline);
        this.potPivot.add(this.pot);
        this.soupMat = new THREE.ShaderMaterial({
          uniforms: { ...THREE.UniformsLib.fog, uTime: ctx.uniforms.uTime, uBoil: { value: 0.25 }, uCol: { value: new THREE.Color(0x6a4a2a) }, uCol2: { value: new THREE.Color(0xc89050) }, uGlow: { value: 0.4 } },
          vertexShader: SOUP_VERT, fragmentShader: SOUP_FRAG, transparent: true, fog: true,
        });
        this.soup = new THREE.Mesh(new THREE.CircleGeometry(0.275, 24).rotateX(-Math.PI / 2), this.soupMat);
        this.soup.position.y = 0.33; this.soup.renderOrder = 2;
        this.potPivot.add(this.soup);
      }
      if (def.dressing) {
        g.add(toonMesh(ctx, geos.dressing, res.mat, null));
        const lan = toonMesh(ctx, geos.lantern, res.mat, res.outline);
        lan.position.set(-0.5, 0.4, -1.95); g.add(lan);
        this.lanternPos = new THREE.Vector3(-0.5, 0.55, -1.95).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw).add(this.pos);
      }
      // flames: three crossing tongues + a low wide base glow
      this.flames = [];
      const fdefs = [[0, 0.05, 0, 1.25, 0], [0.12, 0.05, 0.08, 0.95, 1.3], [-0.12, 0.05, -0.06, 1.0, 2.7], [0.02, 0.03, -0.12, 0.8, 4.1]];
      for (const [fx, fy, fz, s, seed] of fdefs) {
        const f = makeFlame(ctx, { scale: s, seed });
        f.position.set(fx, fy, fz); g.add(f); this.flames.push(f);
      }
      scene.add(g);
      this.light = res.lights?.add({ position: this.pos.clone().add(new THREE.Vector3(0, 0.7, 0)), color: 0xff7426, radius: def.lightRadius ?? 7.5, intensity: def.lightIntensity ?? 0.6, haze: 0.05 });
      this.emit = { flame: 0, spark: 0, smoke: 0, steam: 0, ember: 0 };
      this.cook = null;           // active cooking animation
      this.boil = 0.25;
      this.t = Math.random() * 10;
      this.near = false;
      this._v = new THREE.Vector3();
      this.setLit(this.lit);
    }
    setLit(v) {
      this.lit = v;
      for (const f of this.flames) f.visible = v;
      if (this.light) this.light.on = v;
    }
    worldPoint(lx, ly, lz, out) {
      out.set(lx, ly, lz).applyAxisAngle(_Y, this.yaw).add(this.pos);
      return out;
    }
    get potTop() { return this.worldPoint(0, 0.55 + 0.36, 0, this._v); }

    // ------------------------------------------------------------- cooking animation
    startCook(ids, dish, opts = {}) {
      const ing = ids.map((id, i) => {
        const m = toonMesh(ctx, ingredientGeometry(id, 'item'), res.matCook || res.mat, res.outline, { shadow: false });
        m.scale.setScalar(2.0);
        this.group.add(m);
        const from = opts.from ? opts.from.clone().sub(this.pos).applyAxisAngle(_Y, -this.yaw) : new THREE.Vector3(0.9, 0.9, 0.5);
        return { id, mesh: m, from, delay: i * 0.16, seed: i * 1.7 + 0.4, spin: new THREE.Vector3(Math.random() * 6 - 3, Math.random() * 6 - 3, Math.random() * 6 - 3) };
      });
      const dm = toonMesh(ctx, dishGeometry(dish), res.matCook || res.mat, res.outline, { shadow: false });
      dm.visible = false; this.group.add(dm);
      this.cook = { t: 0, ing, dish, dishMesh: dm, onDone: opts.onDone, done: false, total: opts.duration ?? 4.6 };
      new THREE.Color(dish.c).toArray(this._targetCol = [0, 0, 0]);
    }
    // jump the animation to time t (shots) — keeps everything deterministic
    poseCook(t) { if (!this.cook) return; this.cook.t = t; this._animate(0); }
    _animate(dt) {
      const c = this.cook; if (!c) return;
      c.t += dt;
      const t = c.t;
      const potY = 0.55, surf = potY + 0.33;
      // toss phase: arcs from the cook's hands into the pot
      for (const g of c.ing) {
        const lt = t - g.delay;
        const m = g.mesh;
        if (lt < 0) { m.visible = false; continue; }
        m.visible = true;
        if (lt < 0.55) {
          const k = lt / 0.55;
          m.position.lerpVectors(g.from, _tmp.set(0, surf, 0), k);
          m.position.y += Math.sin(k * Math.PI) * 0.55;
          m.rotation.set(g.spin.x * lt, g.spin.y * lt, g.spin.z * lt);
          if (!g.splashed && k > 0.95) { g.splashed = true; this.splash(1); }
        } else if (t < c.total - 1.2) {
          // boil: ingredients bob and hop out of the broth in turns
          const bt = lt - 0.55;
          const period = 0.9 + (g.seed % 0.5);
          const ph = (bt / period + g.seed * 0.37) % 1;
          const hop = ph < 0.45 ? Math.sin(ph / 0.45 * Math.PI) : 0;
          const ang = g.seed * 2.3 + bt * 0.9;
          const rr = 0.11 + 0.05 * Math.sin(g.seed * 5);
          m.position.set(Math.cos(ang) * rr, surf - 0.03 + hop * (0.42 + 0.1 * Math.sin(g.seed * 3)), Math.sin(ang) * rr);
          m.rotation.set(g.spin.x * bt * 0.5, g.spin.y * bt * 0.6 + g.seed, g.spin.z * bt * 0.4);
        } else {
          // sink as the dish forms
          const k = Math.min(1, (t - (c.total - 1.2)) / 0.35);
          m.position.y = THREE.MathUtils.lerp(m.position.y, surf - 0.15, k);
          m.scale.setScalar(2.0 * (1 - k));
          if (k >= 1) m.visible = false;
        }
      }
      // pot jiggle + boil intensity
      const boilK = THREE.MathUtils.smoothstep(t, 0.4, 1.4) * (1 - THREE.MathUtils.smoothstep(t, c.total - 0.4, c.total + 0.6));
      this.boil = 0.25 + 0.75 * boilK;
      if (this.potPivot) {
        this.potPivot.rotation.z = Math.sin(t * 17) * 0.035 * boilK;
        this.potPivot.rotation.x = Math.sin(t * 13 + 1) * 0.03 * boilK;
        this.potPivot.position.y = potY + Math.abs(Math.sin(t * 11)) * 0.02 * boilK;
      }
      // broth colour blends towards the dish colour
      if (this.soupMat && this._targetCol) {
        const k = THREE.MathUtils.smoothstep(t, 0.6, c.total - 1.0);
        this.soupMat.uniforms.uCol.value.setRGB(0.42 + (this._targetCol[0] * 0.7 - 0.42) * k, 0.29 + (this._targetCol[1] * 0.7 - 0.29) * k, 0.16 + (this._targetCol[2] * 0.7 - 0.16) * k);
        this.soupMat.uniforms.uCol2.value.setRGB(0.78 + (this._targetCol[0] - 0.78) * k, 0.56 + (this._targetCol[1] - 0.56) * k, 0.31 + (this._targetCol[2] - 0.31) * k);
      }
      // reveal: dish rises from the pot, spinning, with a burst
      const rv = t - (c.total - 0.9);
      if (rv > 0) {
        if (!c.burst) { c.burst = true; this.burst(); }
        const dm = c.dishMesh; dm.visible = true;
        const k = Math.min(1, rv / 0.7);
        dm.position.set(0, surf + 0.1 + (1 - Math.pow(1 - k, 3)) * 0.75, 0);
        dm.rotation.y = rv * 2.4;
        dm.scale.setScalar(1.6 * (0.3 + 0.7 * Math.min(1, rv / 0.3)));
      }
      if (t >= c.total + 0.8 && !c.done) {
        c.done = true;
        c.onDone?.(c.dish);
      }
      if (t >= c.total + 1.6) this.endCook();
    }
    endCook() {
      const c = this.cook; if (!c) return;
      for (const g of c.ing) this.group.remove(g.mesh);
      this.group.remove(c.dishMesh);
      this.cook = null;
      if (this.potPivot) { this.potPivot.rotation.set(0, 0, 0); this.potPivot.position.y = 0.55; }
      if (this.soupMat) { this.soupMat.uniforms.uCol.value.set(0x6a4a2a); this.soupMat.uniforms.uCol2.value.set(0xc89050); }
    }
    splash(k = 1) {
      const p = this.potTop, A = res.alpha;
      for (let i = 0; i < 6 * k; i++) A.spawn({ x: p.x + (Math.random() - 0.5) * 0.3, y: p.y, z: p.z + (Math.random() - 0.5) * 0.3, vx: (Math.random() - 0.5) * 0.4, vy: 0.6 + Math.random() * 0.6, vz: (Math.random() - 0.5) * 0.4, life: 1.6, size: 0.25, size1: 0.9, r: 0.95, g: 0.93, b: 0.9, a: 0.35, cell: 3, drag: 1.2, grav: -0.15, spin: 0.4 });
    }
    burst() {
      const p = this.potTop, A = res.alpha, D = res.add;
      for (let i = 0; i < 16; i++) A.spawn({ x: p.x + (Math.random() - 0.5) * 0.4, y: p.y + 0.05, z: p.z + (Math.random() - 0.5) * 0.4, vx: (Math.random() - 0.5) * 1.2, vy: 0.8 + Math.random() * 1.0, vz: (Math.random() - 0.5) * 1.2, life: 2.2, size: 0.35, size1: 1.6, r: 1, g: 0.98, b: 0.94, a: 0.5, cell: 3, drag: 1.6, grav: -0.2, spin: 0.5 });
      for (let i = 0; i < 26; i++) { const a = Math.random() * 6.28, s = 0.8 + Math.random() * 1.6; D.spawn({ x: p.x, y: p.y + 0.3, z: p.z, vx: Math.cos(a) * s, vy: 1.0 + Math.random() * 1.6, vz: Math.sin(a) * s, life: 0.9 + Math.random() * 0.6, size: 0.12, size1: 0.02, r: 1, g: 0.9, b: 0.55, a: 1, cell: 2, drag: 2.5, grav: 1.2, spin: 3 }); }
    }

    // ------------------------------------------------------------- per-frame
    update(dt, camPos, wind, night) {
      this.t += dt;
      const d2 = camPos.distanceToSquared(this.pos);
      const vis = d2 < 160 * 160;
      this.group.visible = vis;
      if (this.cook && !this._prewarming) this._animate(dt);
      if (!vis) return;
      if (this.soupMat) {
        this.soupMat.uniforms.uBoil.value = this.boil * (this.lit ? 1 : 0.1);
        this.soupMat.uniforms.uGlow.value = this.lit ? 0.35 + 0.3 * this.boil : 0;
      }
      if (!this.lit || d2 > 90 * 90) return;
      // flame flicker (scale breathing)
      for (let i = 0; i < this.flames.length; i++) {
        const f = this.flames[i];
        const s = 1 + 0.08 * Math.sin(this.t * (7 + i * 1.3) + i) + 0.05 * Math.sin(this.t * 17 + i * 2);
        f.material.uniforms.uScale.value = [1.25, 0.95, 1.0, 0.8][i] * s * (this.def.fireScale || 1);
      }
      const p = this.pos, A = res.alpha, D = res.add;
      const em = this.emit;
      // licks of flame (additive puffs)
      em.flame += dt * 26;
      while (em.flame > 1) { em.flame--; const a = Math.random() * 6.28, r = Math.random() * 0.25; D.spawn({ x: p.x + Math.cos(a) * r, y: p.y + 0.12, z: p.z + Math.sin(a) * r, vx: (Math.random() - 0.5) * 0.2, vy: 0.9 + Math.random() * 0.9, vz: (Math.random() - 0.5) * 0.2, life: 0.45 + Math.random() * 0.3, size: 0.3 + Math.random() * 0.15, size1: 0.06, r: 1, g: 0.62, b: 0.22, r2: 0.9, g2: 0.25, b2: 0.06, a: 0.55, cell: 0, drag: 1, grav: -0.4, spin: 2 }); }
      // sparks: bright motes spiralling up in the hot air
      em.spark += dt * (5 + 10 * this.boil * (this.cook ? 1.5 : 0.4));
      while (em.spark > 1) { em.spark--; const a = Math.random() * 6.28, r = Math.random() * 0.3; D.spawn({ x: p.x + Math.cos(a) * r, y: p.y + 0.3, z: p.z + Math.sin(a) * r, vx: (Math.random() - 0.5) * 0.9, vy: 1.4 + Math.random() * 1.8, vz: (Math.random() - 0.5) * 0.9, life: 1.4 + Math.random() * 1.6, size: 0.05 + Math.random() * 0.04, size1: 0.015, r: 1, g: 0.78, b: 0.4, r2: 1, g2: 0.35, b2: 0.1, a: 1, a1: 0.4, cell: 1, drag: 0.8, grav: -0.25 }); }
      // smoke: soft blue-grey columns drifting downwind, warm-lit at the base
      em.smoke += dt * 3.2;
      while (em.smoke > 1) { em.smoke--; A.spawn({ x: p.x + (Math.random() - 0.5) * 0.3, y: p.y + 1.25, z: p.z + (Math.random() - 0.5) * 0.3, vx: (Math.random() - 0.5) * 0.15, vy: 0.55 + Math.random() * 0.25, vz: (Math.random() - 0.5) * 0.15, life: 6 + Math.random() * 2, size: 0.5, size1: 2.8, r: 0.62 - 0.1 * night, g: 0.5 - 0.18 * night, b: 0.44 - 0.24 * night, r2: 0.3 - 0.18 * night, g2: 0.34 - 0.18 * night, b2: 0.42 - 0.16 * night, a: 0.22, cell: 3, drag: 0.35, grav: -0.03, spin: (Math.random() - 0.5) * 0.4 }); }
      // fireflies drifting at the edge of the light on warm nights
      if (this.def.dressing && night > 0.5) {
        em.ember += dt * 2.2 * night;
        while (em.ember > 1) { em.ember--; const a = Math.random() * 6.28, r = 2.5 + Math.random() * 4; D.spawn({ x: p.x + Math.cos(a) * r, y: p.y + 0.4 + Math.random() * 1.4, z: p.z + Math.sin(a) * r, vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.3) * 0.15, vz: (Math.random() - 0.5) * 0.3, life: 3 + Math.random() * 3, size: 0.07, size1: 0.05, r: 0.75, g: 1, b: 0.45, a: 0.9, a1: 1, cell: 1, drag: 0.2 }); }
      }
      // steam from the pot
      if (this.hasPot) {
        em.steam += dt * (1.5 + 7 * this.boil);
        const pt = this.potTop;
        while (em.steam > 1) { em.steam--; const a = Math.random() * 6.28, r = Math.random() * 0.18; A.spawn({ x: pt.x + Math.cos(a) * r, y: pt.y - 0.02, z: pt.z + Math.sin(a) * r, vx: (Math.random() - 0.5) * 0.15, vy: 0.35 + Math.random() * 0.3 + this.boil * 0.3, vz: (Math.random() - 0.5) * 0.15, life: 2.4 + Math.random(), size: 0.18, size1: 1.0 + this.boil * 0.5, r: 1 - 0.25 * night, g: 0.9 - 0.32 * night, b: 0.82 - 0.42 * night, r2: 0.75 - 0.45 * night, g2: 0.8 - 0.45 * night, b2: 0.88 - 0.4 * night, a: 0.16 + 0.12 * this.boil, cell: 3, drag: 0.8, grav: -0.1, spin: (Math.random() - 0.5) * 0.8 }); }
      }
    }
    // pre-roll particles so a capture starts with established flames / smoke
    prewarm(seconds, camPos, wind, night) { this._prewarming = true; const steps = Math.ceil(seconds / 0.1); for (let i = 0; i < steps; i++) { this.update(0.1, camPos, wind, night); res.add.update(0.1, wind); res.alpha.update(0.1, wind); } this._prewarming = false; }
    dispose() { scene.remove(this.group); this.light?.remove(); }
  }
  return { Campfire };
}
const _Y = new THREE.Vector3(0, 1, 0);
const _tmp = new THREE.Vector3();
