// Sanctums: small ancient-tech stone chambers. Surface entrances (stepped octagonal dais, slanted
// pylons, an amber energy door, floating rune-stone and a sky beacon) teleport the player into an
// interior built lazily far out over the sea (y = 150), lit by its own rig (lanterns, oculus shaft,
// glyph channels). Each interior hosts one physics puzzle:
//   'balance'   tilting maze table steered from a lectern; roll the iron ball into the socket
//   'lodestone' carry iron slabs/blocks with the Lodestone rune to bridge a chasm and weigh a plate
//   'weight'    hold two pressure plates down with crates / stone cubes (the player counts too)
//   'ascent'    stack blocks to climb a sheer ledge
// Solving opens the gate; the reward chest emits 'shrineSolved' {id, name, kind}.
import * as THREE from 'three';
import { Body } from './engine.js';
import { makeMaterial, makeOutlineMaterial, outlineGeometry, cloneMaterial } from './materials.js';
import { roundedBox, merge, rng } from './geometry.js';
import { findSpot } from './props.js';
import { FX } from './fx.js';

const IN_Y = 150;
const W = 24, L = 46, H = 14;

export const SANCTUMS = [
  { id: 1, name: 'Sanctum of Balance', kind: 'balance', target: [262, 205], yaw: 0 },
  { id: 2, name: 'Sanctum of the Lodestone', kind: 'lodestone', target: [-690, 770], yaw: 0 },
  { id: 3, name: 'Sanctum of Weight', kind: 'weight', target: [990, 840], yaw: 0 },
  { id: 4, name: 'Sanctum of Ascent', kind: 'ascent', target: [-520, 40], yaw: 0 },
];

// ---------------------------------------------------------------------------
// shaders: energy door membrane, beacon, light shaft, halo
const DOOR_FRAG = /* glsl */`
uniform float uTime; uniform vec3 uCol; uniform float uOpen; uniform float uAmp;
varying vec2 vUv;
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1, 0)), f.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), f.x), f.y); }
float glyph(vec2 p, float seed) {
  vec2 cell = floor(p); vec2 f = fract(p) - 0.5; float h = h12(cell + seed); float d = 9.0;
  if (h < 0.2) d = abs(f.y); else if (h < 0.38) d = abs(f.x); else if (h < 0.5) d = abs(length(f) - 0.3);
  else if (h < 0.62) d = abs(abs(f.x) + abs(f.y) - 0.33); else if (h < 0.7) d = length(f) - 0.07;
  return 1.0 - smoothstep(0.03, 0.08, d);
}
void main() {
  vec2 uv = vUv;
  float edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  float rim = 1.0 - smoothstep(0.0, 0.12, edge);
  float n = vn(uv * vec2(3.0, 5.0) + vec2(0.0, -uTime * 0.35)) * 0.6 + vn(uv * vec2(9.0, 14.0) - vec2(uTime * 0.2, uTime * 0.6)) * 0.4;
  float g = glyph(uv * vec2(4.0, 6.0) + vec2(0.0, floor(uTime * 0.5)), 3.0) * smoothstep(0.1, 0.25, edge);
  float scan = smoothstep(0.92, 1.0, fract(uv.y * 1.5 - uTime * 0.4));
  float a = 0.28 + n * 0.35 + rim * 0.9 + g * 0.6 + scan * 0.25;
  a *= (1.0 - uOpen) * uAmp;
  vec3 c = uCol * (0.7 + n * 0.6) + vec3(1.0, 0.95, 0.8) * (rim * 0.5 + g * 0.6);
  gl_FragColor = vec4(c * a, a);
}`;
const UV_VERT = /* glsl */`
varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vW;
void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vV = cameraPosition - w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w; }`;
const BEAM_FRAG = /* glsl */`
uniform float uTime; uniform vec3 uCol; uniform float uAmp; uniform float uFade;
varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vW;
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1, 0)), f.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec3 V = normalize(vV);
  float facing = abs(dot(normalize(vN), V));
  float soft = pow(facing, 1.6);
  float d = length(vV);
  float near = smoothstep(uFade * 0.4, uFade, d);     // fades when close so it never blocks the view
  float vert = smoothstep(0.0, 0.08, vUv.y) * (1.0 - smoothstep(0.35, 1.0, vUv.y));
  float n = vn(vec2(vUv.x * 12.0, vUv.y * 6.0 - uTime * 0.4)) * 0.5 + 0.6;
  float a = soft * vert * n * near * uAmp;
  gl_FragColor = vec4(uCol * a, a);
}`;
const SHAFT_FRAG = /* glsl */`
uniform float uTime; uniform vec3 uCol; uniform float uAmp;
varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vW;
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1, 0)), f.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec3 V = normalize(vV);
  float facing = pow(abs(dot(normalize(vN), V)), 2.2);
  float streak = vn(vec2(vUv.x * 26.0, vUv.y * 1.5 + uTime * 0.05)) * 0.7 + 0.45;
  float vert = smoothstep(0.0, 0.25, vUv.y) * (0.55 + 0.45 * vUv.y);
  float a = facing * streak * vert * uAmp;
  gl_FragColor = vec4(uCol * a, a);
}`;
const HALO_VERT = /* glsl */`
uniform float uSize; varying vec2 vUv;
void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0); mv.xy += (uv - 0.5) * uSize; gl_Position = projectionMatrix * mv; }`;
const HALO_FRAG = /* glsl */`
uniform vec3 uCol; uniform float uAmp; varying vec2 vUv;
void main() { float d = length(vUv - 0.5) * 2.0; float a = pow(max(0.0, 1.0 - d), 2.4) * uAmp; gl_FragColor = vec4(uCol * a, a); }`;
const MOTE_VERT = /* glsl */`
uniform float uTime; uniform vec3 uShaft; attribute float aSeed; varying float vA; varying float vS;
void main() {
  vec3 p = position;
  p.y = mod(p.y + uTime * (0.08 + aSeed * 0.12), 12.0);
  p.x += sin(uTime * 0.3 + aSeed * 30.0) * 0.6; p.z += cos(uTime * 0.25 + aSeed * 17.0) * 0.6;
  vec4 w = modelMatrix * vec4(p, 1.0);
  float inShaft = 1.0 - smoothstep(2.0, 4.6, length(w.xz - uShaft.xz));
  vS = inShaft;
  vA = (0.25 + 0.75 * inShaft) * (0.5 + 0.5 * sin(uTime * 2.0 + aSeed * 40.0));
  vec4 mv = viewMatrix * w;
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(60.0 / -mv.z, 1.0, 5.0) * (1.0 + inShaft);
}`;
const MOTE_FRAG = /* glsl */`
uniform vec3 uCol; varying float vA; varying float vS;
void main() { float d = length(gl_PointCoord - 0.5) * 2.0; float a = (1.0 - smoothstep(0.2, 1.0, d)) * vA; gl_FragColor = vec4(mix(uCol, vec3(1.0, 0.9, 0.7), vS) * a, a); }`;

function additive(uniforms, vert, frag, o = {}) {
  return new THREE.ShaderMaterial({ uniforms, vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation, side: o.side ?? THREE.FrontSide });
}

// ---------------------------------------------------------------------------
export class Sanctums {
  constructor(ctx, phys, props, fx, shared) {
    this.ctx = ctx; this.phys = phys; this.props = props; this.fx = fx; this.shared = shared;
    this.worldStatics = [];                    // entrance colliders (group 0)
    this.list = [];
    this.active = null;                        // interior currently occupied
    this.prompt = null; this.promptEl = null; this.fadeEl = null;
    this.t = 0;
    const s = shared;
    this.mStone = makeMaterial(ctx, s, 'SANCTUM', { tint: 0xc4b9a4, tint2: [1, 1, 0] });
    this.mStoneDark = makeMaterial(ctx, s, 'SANCTUM', { tint: 0xa8a090, tint2: [1, 1, 0] });
    this.mInterior = makeMaterial(ctx, s, 'SANCTUM', { tint: 0xe6d8bc, tint2: [1, 1, 0] });
    this.mGate = makeMaterial(ctx, s, 'SANCTUM', { tint: 0x6f7a7e, tint2: [1, 1, 1] });
    this.mGlow = makeMaterial(ctx, s, 'GLOW', { tint: 0x7ff5dc });
    this.mGlowAmber = makeMaterial(ctx, s, 'GLOW', { tint: 0xffb45a });
    this.mChest = makeMaterial(ctx, s, 'CHEST', { tint: 0xffffff, glowCol: 0x6ff2d6 });
    this.ink = makeOutlineMaterial(ctx, s, { width: 0.03, ink: 0x16141c });
    this.root = new THREE.Group(); this.root.name = 'sanctums';
    ctx.scene.add(this.root);
    // soft contact shadows for props indoors (no sun shadow map inside)
    this.blobs = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vP; varying float vA; attribute float aA; void main(){ vP = position.xz; vA = aA; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying vec2 vP; varying float vA; void main(){ float d = length(vP); float a = pow(1.0 - smoothstep(0.0, 1.0, d), 1.5) * vA; gl_FragColor = vec4(0.06, 0.05, 0.05, a); }',
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }), 32);
    this.blobs.geometry.setAttribute('aA', new THREE.InstancedBufferAttribute(new Float32Array(32), 1));
    this.blobs.count = 0; this.blobs.frustumCulled = false; this.blobs.renderOrder = 3;
    ctx.scene.add(this.blobs);
    this._bm = new THREE.Matrix4();
    this.solved = this.loadSolved();
    this.placeEntrances();
    this.makeUI();
  }

  loadSolved() { try { return new Set(JSON.parse(localStorage.getItem('windborne.sanctums') || '[]')); } catch { return new Set(); } }
  saveSolved() { try { localStorage.setItem('windborne.sanctums', JSON.stringify([...this.solved])); } catch {} }

  // ------------------------------------------------------------------ UI (prompt + fade)
  makeUI() {
    const hud = this.ctx.hud; if (!hud) return;
    const p = document.createElement('div');
    p.style.cssText = 'position:absolute;left:50%;bottom:17%;transform:translateX(-50%);padding:7px 16px 7px 10px;border-radius:18px;background:rgba(14,20,24,.42);border:1px solid rgba(240,228,200,.35);color:#f2ead6;font:500 14px/1.2 system-ui,sans-serif;letter-spacing:.06em;display:none;align-items:center;gap:10px;backdrop-filter:blur(3px);white-space:nowrap';
    p.innerHTML = '<span style="display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;border:1px solid rgba(240,228,200,.7);font-size:12px">E</span><span class="t"></span>';
    hud.appendChild(p); this.promptEl = p;
    const f = document.createElement('div');
    f.style.cssText = 'position:fixed;inset:0;background:#05090c;opacity:0;pointer-events:none;transition:opacity .45s;z-index:5';
    document.body.appendChild(f); this.fadeEl = f;
    const b = document.createElement('div');
    b.style.cssText = 'position:fixed;left:50%;top:22%;transform:translateX(-50%);color:#f3ead2;font:300 30px/1.3 Georgia,serif;letter-spacing:.18em;text-shadow:0 2px 14px rgba(0,0,0,.6);opacity:0;transition:opacity .8s;pointer-events:none;text-align:center;z-index:6';
    document.body.appendChild(b); this.bannerEl = b;
  }
  showPrompt(text) {
    if (!this.promptEl) return;
    if (text) { this.promptEl.querySelector('.t').textContent = text; this.promptEl.style.display = 'flex'; }
    else this.promptEl.style.display = 'none';
    if (text !== this._lastPrompt) { this._lastPrompt = text; this.ctx.events.emit('interactPrompt', { text: text || null }); }
  }
  banner(text, sub, dur = 3.2) {
    if (!this.bannerEl || this.ctx.shotMode) return;
    this.bannerEl.innerHTML = `${text}${sub ? `<div style="font:400 13px system-ui;letter-spacing:.35em;opacity:.8;margin-top:6px">${sub}</div>` : ''}`;
    this.bannerEl.style.opacity = 1;
    clearTimeout(this._bt); this._bt = setTimeout(() => (this.bannerEl.style.opacity = 0), dur * 1000);
  }

  // ------------------------------------------------------------------ entrances
  placeEntrances() {
    const world = this.ctx.world;
    SANCTUMS.forEach((def, i) => {
      const rand = rng(1000 + def.id * 77);
      // flattest candidate (height spread over the dais footprint) near the target
      let spot = null, best = Infinity;
      for (let k = 0; k < 140; k++) {
        const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * 70;
        const x = def.target[0] + Math.cos(a) * r, z = def.target[1] + Math.sin(a) * r;
        const h = world.getHeight(x, z);
        if (h < 2 || (world.getWaterSurface?.(x, z) ?? -Infinity) > h - 1) continue;
        let lo = h, hi = h;
        for (let j = 0; j < 12; j++) for (const rr of [5, 9]) {
          const hh = world.getHeight(x + Math.cos(j * 0.5236) * rr, z + Math.sin(j * 0.5236) * rr);
          lo = Math.min(lo, hh); hi = Math.max(hi, hh);
          if ((world.getWaterSurface?.(x + Math.cos(j * 0.5236) * rr, z + Math.sin(j * 0.5236) * rr) ?? -Infinity) > hh) hi += 50;
        }
        const score = hi - lo + r * 0.01;
        if (score < best) { best = score; spot = { x, z, h }; }
      }
      spot ||= { x: def.target[0], z: def.target[1], h: world.getHeight(def.target[0], def.target[1]) };
      // lowest point of the footprint so the dais never floats
      let hmin = Infinity;
      for (let a = 0; a < 8; a++) hmin = Math.min(hmin, world.getHeight(spot.x + Math.cos(a * 0.785) * 6, spot.z + Math.sin(a * 0.785) * 6));
      hmin = Math.min(hmin, spot.h);
      // face roughly toward the island centre (plateau) so the door is seen from paths
      const yaw = Math.atan2(60 - spot.x, 140 - spot.z);
      const s = {
        def, id: def.id, name: def.name, kind: def.kind,
        x: spot.x, z: spot.z, y: hmin, yaw,
        origin: new THREE.Vector3(1880, IN_Y, -1900 + i * 125),
        built: false, solved: this.solved.has(def.id), statics: [], props: [], gateOpen: 0, gateTarget: 0,
        chestOpen: 0, chestOpened: this.solved.has(def.id),
      };
      this.buildEntrance(s);
      this.list.push(s);
    });
  }

  buildEntrance(s) {
    const g = new THREE.Group();
    g.position.set(s.x, s.y, s.z); g.rotation.y = s.yaw;
    const parts = [];
    // stepped octagonal dais (3 tiers) with glyph risers
    const tiers = [[7.2, 5.4], [6.1, 0.55], [5.1, 0.45]];   // first tier doubles as a buried foundation
    let y = -4.9;
    for (const [r, h] of tiers) {
      const c = new THREE.CylinderGeometry(r * 0.97, r, h, 8, 1).rotateY(Math.PI / 8).translate(0, y + h / 2, 0);
      parts.push(tintGeo(c, 0xc9bfa9, 1));
      y += h;
    }
    const top = y;
    // flagstone inlay ring (glyph circle)
    parts.push(tintGeo(new THREE.CylinderGeometry(3.4, 3.4, 0.04, 40, 1).translate(0, top + 0.02, 1.2), 0xa49a86, 2));
    // gateway: two slanted pylons + lintel + capstone
    const pw = 1.25, ph = 6.2;
    for (const sx of [-1, 1]) {
      const p = roundedBox(pw, ph, 1.7, 0.12, 2, 0xbfb49e, 0);
      p.translate(0, ph / 2, 0).rotateZ(sx * 0.13).translate(sx * 2.25, top, -2.2);
      parts.push(p);
      // glowing vertical channel on the pylon front
      const ch = roundedBox(0.18, ph * 0.78, 0.08, 0.03, 1, 0xffffff, 3);
      ch.translate(0, ph * 0.46, 0.86).rotateZ(sx * 0.13).translate(sx * 2.25, top, -2.2);
      parts.push(ch);
    }
    const lint = roundedBox(6.4, 1.15, 2.1, 0.14, 2, 0xc4b9a2, 1).translate(0, top + ph + 0.15, -2.2);
    parts.push(lint);
    const cap = new THREE.CylinderGeometry(1.2, 3.0, 1.3, 4, 1).rotateY(Math.PI / 4).scale(1.1, 1, 0.55).translate(0, top + ph + 1.35, -2.2);
    parts.push(tintGeo(cap, 0xb3a891, 1));
    // back wall of the gate (door recess)
    parts.push(roundedBox(4.6, ph - 0.4, 1.0, 0.1, 1, 0x8f8676, 0).translate(0, top + (ph - 0.4) / 2, -2.9));
    // four small obelisks on the corners of the dais
    for (const [ox, oz] of [[-5.2, 3.2], [5.2, 3.2], [-5.6, -3.0], [5.6, -3.0]]) {
      const ob = new THREE.CylinderGeometry(0.28, 0.5, 2.6, 4, 1).rotateY(Math.PI / 4).translate(ox, top + 1.3, oz);
      parts.push(tintGeo(ob, 0xbcb19b, 1));
      parts.push(tintGeo(new THREE.OctahedronGeometry(0.22).translate(ox, top + 2.95, oz), 0xffffff, 3));
    }
    const geo = merge(parts);
    const mesh = new THREE.Mesh(geo, this.mStone);
    mesh.castShadow = true; mesh.receiveShadow = true;
    const ol = new THREE.Mesh(outlineGeometry(geo), this.ink);
    g.add(mesh, ol);
    // energy door
    const doorMat = additive({ uTime: this.ctx.uniforms.uTime, uCol: { value: new THREE.Color(s.solved ? 0x55f0d0 : 0xffa648) }, uOpen: { value: 0 }, uAmp: { value: 1.0 } }, UV_VERT, DOOR_FRAG, { side: THREE.DoubleSide });
    const door = new THREE.Mesh(new THREE.PlaneGeometry(3.3, ph - 0.7), doorMat);
    door.position.set(0, top + (ph - 0.7) / 2, -2.35);
    door.renderOrder = 8;
    g.add(door);
    // floating rune-stone above the capstone
    const rune = new THREE.Mesh(new THREE.OctahedronGeometry(0.75, 0).scale(0.8, 1.35, 0.8), cloneMaterial(this.mGlowAmber));
    rune.position.set(0, top + ph + 3.3, -2.2);
    rune.material.uniforms.uTint.value.set(s.solved ? 0x6ff5da : 0xffb45a);
    const runeOl = new THREE.Mesh(outlineGeometry(rune.geometry), this.ink); rune.add(runeOl);
    g.add(rune);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), additive({ uCol: { value: new THREE.Color(s.solved ? 0x55f0d0 : 0xffa648) }, uAmp: { value: 0.55 }, uSize: { value: 6.5 } }, HALO_VERT, HALO_FRAG));
    halo.position.copy(rune.position); halo.renderOrder = 9; halo.frustumCulled = false;
    g.add(halo);
    // sky beacon (landmark visible from afar; fades close up)
    const beamMat = additive({ uTime: this.ctx.uniforms.uTime, uCol: { value: new THREE.Color(s.solved ? 0x55f0d0 : 0xffa648) }, uAmp: { value: 0.16 }, uFade: { value: 60 } }, UV_VERT, BEAM_FRAG, { side: THREE.DoubleSide });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.2, 260, 16, 1, true).translate(0, 130, 0), beamMat);
    beam.position.set(0, top + ph + 3.3, -2.2); beam.renderOrder = 7; beam.frustumCulled = false;
    g.add(beam);
    this.root.add(g);
    s.ent = { group: g, door, doorMat, rune, halo, beam, beamMat, top };
    // world statics: tiers (cylinders), pylons + lintel (boxes)
    const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
    const toW = (lx, lz) => ({ x: s.x + lx * c + lz * sn, z: s.z - lx * sn + lz * c });
    y = -4.9;
    for (const [r, h] of tiers) { this.worldStatics.push({ type: 'cylinder', x: s.x, y: s.y + y + h / 2, z: s.z, r: r * 0.93, hy: h / 2, kind: 'sanctum' }); y += h; }
    for (const sx of [-1, 1]) { const p = toW(sx * 2.45, -2.2); this.worldStatics.push({ type: 'box', x: p.x, y: s.y + top + ph / 2, z: p.z, hx: 0.75, hy: ph / 2, hz: 0.85, rotY: s.yaw, kind: 'sanctum' }); }
    const bw = toW(0, -2.95); this.worldStatics.push({ type: 'box', x: bw.x, y: s.y + top + ph / 2, z: bw.z, hx: 2.3, hy: ph / 2, hz: 0.5, rotY: s.yaw, kind: 'sanctum' });
    const dp = toW(0, -1.6);
    s.doorPos = new THREE.Vector3(dp.x, s.y + top, dp.z);
    const out = toW(0, 2.2);
    s.exitPos = new THREE.Vector3(out.x, s.y + top, out.z);
    for (const st of this.worldStatics) st._sid ??= 3900 + this.worldStatics.indexOf(st);
  }

  // ------------------------------------------------------------------ interior shell
  buildInterior(s) {
    if (s.built) return;
    s.built = true;
    const O = s.origin;
    const g = new THREE.Group(); g.position.copy(O);
    g.visible = false;
    const parts = [], dark = [], statics = s.statics;
    const addS = (x, y, z, hx, hy, hz, o = {}) => {
      const c = { type: 'box', x: O.x + x, y: O.y + y, z: O.z + z, hx, hy, hz, rotY: 0, kind: 'sanctum', ...o };
      c._sid = 3000 + statics.length;
      statics.push(c); return c;
    };
    const box = (w, h, d, x, y, z, col = 0x9aa6a8, glow = 0, list = parts, r = 0.05) => {
      const b = roundedBox(w, h, d, r, 1, col, glow).translate(x, y, z); list.push(b); return b;
    };
    const kind = s.kind;
    const pitZ0 = -9.2, pitZ1 = -5.6;     // lodestone chasm
    // floor (split around the chasm for lodestone)
    if (kind === 'lodestone') {
      box(W, 1, L / 2 - pitZ1 + 0, 0, -0.5, (L / 2 + pitZ1) / 2, 0x8e9a9c, 0, parts, 0.02);
      addS(0, -0.5, (L / 2 + pitZ1) / 2, W / 2, 0.5, (L / 2 - pitZ1) / 2);
      box(W, 1, pitZ0 + L / 2, 0, -0.5, (-L / 2 + pitZ0) / 2, 0x8e9a9c, 0, parts, 0.02);
      addS(0, -0.5, (-L / 2 + pitZ0) / 2, W / 2, 0.5, (pitZ0 + L / 2) / 2);
      // abyss walls + glowing floor far below
      box(W, 0.6, pitZ1 - pitZ0, 0, -9, (pitZ0 + pitZ1) / 2, 0x334046, 2, dark);
      box(W, 8, 0.4, 0, -5, pitZ0 + 0.2, 0x4c585c, 1, dark); box(W, 8, 0.4, 0, -5, pitZ1 - 0.2, 0x4c585c, 1, dark);
      addS(0, -9, (pitZ0 + pitZ1) / 2, W / 2, 0.3, (pitZ1 - pitZ0) / 2);
    } else {
      box(W, 1, L, 0, -0.5, 0, 0x8e9a9c, 0, parts, 0.02);
      addS(0, -0.5, 0, W / 2, 0.5, L / 2);
    }
    // central glyph ring in the floor
    parts.push(tintGeo(new THREE.RingGeometry(3.2, 4.6, 48, 1).rotateX(-Math.PI / 2).translate(0, 0.012, 6.5), 0x7d898c, 2));
    parts.push(tintGeo(new THREE.RingGeometry(1.0, 1.25, 32, 1).rotateX(-Math.PI / 2).translate(0, 0.014, 6.5), 0x7d898c, 3));
    // walls
    const wt = 1.6;
    box(wt, H + 10, L, -W / 2 - wt / 2, (H - 10) / 2, 0, 0x8a9698); addS(-W / 2 - wt / 2, H / 2, 0, wt / 2, H / 2, L / 2);
    box(wt, H + 10, L, W / 2 + wt / 2, (H - 10) / 2, 0, 0x8a9698); addS(W / 2 + wt / 2, H / 2, 0, wt / 2, H / 2, L / 2);
    box(W + wt * 2, H, wt, 0, H / 2, -L / 2 - wt / 2, 0x8a9698); addS(0, H / 2, -L / 2 - wt / 2, W / 2 + wt, H / 2, wt / 2);
    box(W + wt * 2, H, wt, 0, H / 2, L / 2 + wt / 2, 0x8a9698); addS(0, H / 2, L / 2 + wt / 2, W / 2 + wt, H / 2, wt / 2);
    // ceiling with transverse beams and an oculus
    box(W + wt * 2, 1.2, L + wt * 2, 0, H + 0.6, 0, 0x5f6b70, 0, dark);
    for (let z = -L / 2 + 3.3; z < L / 2; z += 6.6) box(W, 1.0, 1.1, 0, H - 0.5, z, 0x75828a, 0, dark);
    for (const x of [-W / 2 + 3, W / 2 - 3]) box(1.0, 0.9, L, x, H - 0.45, 0, 0x75828a, 0, dark);
    // pilasters with glowing channels + lantern brackets; frieze with glyph panels
    s.lanterns = [];
    for (let z = -L / 2 + 3.3; z < L / 2 - 1; z += 6.6) {
      for (const sx of [-1, 1]) {
        const x = sx * (W / 2 - 0.55);
        box(1.1, H, 1.7, x, H / 2, z, 0x9da9ab);
        addS(x, H / 2, z, 0.55, H / 2, 0.85);
        box(0.12, H - 4.2, 0.22, x - sx * 0.56, H / 2 + 0.6, z, 0xffffff, 3, parts, 0.02);
        box(1.5, 0.7, 2.1, x, 1.0, z, 0x7e8a8c);     // plinth
        box(1.5, 0.6, 2.1, x, H - 1.6, z, 0x7e8a8c);  // capital
      }
    }
    for (let z = -L / 2 + 6.6; z < L / 2 - 1; z += 6.6) {
      for (const sx of [-1, 1]) {
        box(0.25, 1.6, 4.4, sx * (W / 2 - 0.12), 9.4, z, 0x8f9b9d, 1, parts, 0.04);    // glyph frieze panel
        box(0.3, 0.25, 5.4, sx * (W / 2 - 0.15), 8.4, z, 0x7a8688);
        box(0.3, 0.25, 5.4, sx * (W / 2 - 0.15), 10.4, z, 0x7a8688);
        box(0.35, 1.3, 5.6, sx * (W / 2 - 0.17), 0.65, z, 0x6d797b);                     // wainscot
      }
    }
    // lanterns: floating crystals over wall brackets (light rig)
    const lanternZ = [-13.2, -0.0, 13.2];
    for (const z of lanternZ) for (const sx of [-1, 1]) {
      const x = sx * (W / 2 - 1.6);
      box(1.2, 0.35, 1.2, sx * (W / 2 - 1.2), 4.6, z, 0x6e7a7c);
      s.lanterns.push({ pos: new THREE.Vector3(x, 5.6, z), col: new THREE.Color(1.0, 0.66, 0.34), seed: Math.random() * 10 });
    }
    // arrival dais (south) + sealed door outline behind it
    const dz = L / 2 - 4.2;
    parts.push(tintGeo(new THREE.CylinderGeometry(2.8, 3.0, 0.35, 24).translate(0, 0.175, dz), 0x9ea8a8, 0));
    parts.push(tintGeo(new THREE.RingGeometry(1.6, 2.2, 40).rotateX(-Math.PI / 2).translate(0, 0.36, dz), 0x7d898c, 2));
    statics.push({ type: 'cylinder', x: O.x, y: O.y + 0.175, z: O.z + dz, r: 2.9, hy: 0.175, kind: 'sanctum', _sid: 3000 + statics.length });
    box(5.2, 7.2, 0.6, 0, 3.6, L / 2 - 0.1, 0x6f7b7d, 1);
    box(4.2, 6.4, 0.5, 0, 3.4, L / 2 - 0.25, 0x56626a, 0);
    s.arrival = new THREE.Vector3(O.x, O.y + 0.35, O.z + dz);
    // partition wall with the gate (north), altar room behind
    const gz = -14.5, gw = 4.4, gh = 6;
    const sideW = (W - gw) / 2;
    for (const sx of [-1, 1]) {
      const cx = sx * (gw / 2 + sideW / 2);
      box(sideW, H, 1.4, cx, H / 2, gz, 0x8a9698, 0);
      addS(cx, H / 2, gz, sideW / 2, H / 2, 0.7);
      box(0.9, gh + 1.2, 1.8, sx * (gw / 2 + 0.45), (gh + 1.2) / 2, gz + 0.1, 0x9faaa9, 1);
      box(0.14, gh, 0.1, sx * (gw / 2 + 0.06), gh / 2, gz + 0.75, 0xffffff, 3, parts, 0.02);
    }
    box(gw + 1.8, H - gh - 0.4, 1.4, 0, gh + 0.4 + (H - gh - 0.4) / 2, gz, 0x8a9698, 0);
    box(gw + 1.4, 0.7, 1.5, 0, gh + 2.2, gz, 0x8a9698, 1);
    // great sigil above the gate: concentric glowing rings on a carved disc
    parts.push(tintGeo(new THREE.CylinderGeometry(2.3, 2.3, 0.3, 40).rotateX(Math.PI / 2).translate(0, gh + 4.4, gz + 0.8), 0x7f8b8d, 0));
    parts.push(tintGeo(new THREE.RingGeometry(1.95, 2.1, 48).translate(0, gh + 4.4, gz + 0.96), 0xffffff, 3));
    parts.push(tintGeo(new THREE.RingGeometry(0.55, 0.68, 32).translate(0, gh + 4.4, gz + 0.96), 0xffffff, 3));
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2;
      parts.push(tintGeo(new THREE.PlaneGeometry(0.12, 1.2).translate(0, 1.32, 0).rotateZ(a).translate(0, gh + 4.4, gz + 0.965), 0xffffff, 3));
    }
    addS(0, gh + 0.4 + (H - gh - 0.4) / 2, gz, gw / 2 + 0.9, (H - gh - 0.4) / 2, 0.7);
    box(gw + 2.4, 0.9, 2.0, 0, gh + 0.45, gz + 0.1, 0x9faaa9, 1);
    // gate slabs (separate meshes, slide apart)
    s.gate = [];
    for (const sx of [-1, 1]) {
      const gg = merge([roundedBox(gw / 2, gh, 0.5, 0.06, 1, 0xffffff, 1), roundedBox(gw / 2 - 0.4, gh - 0.6, 0.56, 0.04, 1, 0xd8d8d8, 1)]);
      const m = new THREE.Mesh(gg, cloneMaterial(this.mGate));
      m.material.uniforms.uSolved.value = 0;
      const ol = new THREE.Mesh(outlineGeometry(gg), this.ink); m.add(ol);
      m.position.set(sx * gw / 4, gh / 2, gz);
      g.add(m);
      const col = addS(sx * gw / 4, gh / 2, gz, gw / 4, gh / 2, 0.3);
      s.gate.push({ mesh: m, col, sx, x0: sx * gw / 4 });
    }
    // altar room: raised dais, chest, heart monolith
    const az = -19.5;
    parts.push(tintGeo(new THREE.CylinderGeometry(3.6, 4.0, 0.6, 8).rotateY(Math.PI / 8).translate(0, 0.3, az), 0xa2acac, 1));
    statics.push({ type: 'cylinder', x: O.x, y: O.y + 0.3, z: O.z + az, r: 3.8, hy: 0.3, kind: 'sanctum', _sid: 3000 + statics.length });
    box(2.2, 7.5, 2.2, 0, 3.75, -L / 2 + 1.4, 0x8d999b, 1);
    s.heart = new THREE.Vector3(0, 6.2, -L / 2 + 2.4);
    // exit glyph circle in the altar room
    parts.push(tintGeo(new THREE.RingGeometry(1.1, 1.5, 36).rotateX(-Math.PI / 2).translate(-7, 0.02, az), 0x7d898c, 3));
    s.altarExit = new THREE.Vector3(O.x - 7, O.y, O.z + az);

    // ---------- puzzle-specific architecture ----------
    if (kind === 'ascent') {
      // sheer ledge in front of the gate (no climbing: smooth ward stone)
      const lz0 = -14, lz1 = -9.6, lh = 4.2;
      box(W, lh, lz1 - lz0, 0, lh / 2, (lz0 + lz1) / 2, 0x7c888a, 1);
      addS(0, lh / 2, (lz0 + lz1) / 2, W / 2, lh / 2, (lz1 - lz0) / 2, { noClimb: true, kind: 'sanctum-ward' });
      box(W, 0.12, 0.12, 0, lh - 0.3, lz1 + 0.02, 0xffffff, 3, parts, 0.02);
    }
    if (kind === 'lodestone') {
      // far-side pedestal with the high plate
      box(2.4, 3.0, 2.4, 6.5, 1.5, -11.6, 0x8d999b, 1);
      addS(6.5, 1.5, -11.6, 1.2, 1.5, 1.2, { noClimb: true });
      box(W, 0.1, 0.1, 0, 0.03, pitZ1 + 0.08, 0xffffff, 3, parts, 0.01);
      box(W, 0.1, 0.1, 0, 0.03, pitZ0 - 0.08, 0xffffff, 3, parts, 0.01);
    }
    if (kind === 'balance') {
      // lectern facing the maze table
      parts.push(tintGeo(new THREE.CylinderGeometry(0.45, 0.7, 1.15, 6).translate(0, 0.575, 8.3), 0x9ba6a6, 1));
      parts.push(roundedBox(1.3, 0.18, 0.9, 0.05, 1, 0x8a9696, 0).rotateX(-0.4).translate(0, 1.22, 8.3));
      statics.push({ type: 'cylinder', x: O.x, y: O.y + 0.6, z: O.z + 8.3, r: 0.6, hy: 0.6, kind: 'sanctum', _sid: 3000 + statics.length });
      parts.push(tintGeo(new THREE.CylinderGeometry(0.9, 1.6, 1.0, 8).translate(0, 0.5, -2), 0x8c9898, 1));   // table pivot
      s.lecternPos = new THREE.Vector3(O.x, O.y, O.z + 9.4);
      parts.push(tintGeo(new THREE.CircleGeometry(5.6, 40).rotateX(-Math.PI / 2).translate(0, 0.008, -2), 0x6a6258, 0));
    }
    const shell = new THREE.Mesh(merge(parts), this.mInterior);
    const shellDark = new THREE.Mesh(merge(dark), this.mStoneDark);
    g.add(shell, shellDark);
    // ink on the architecture is expensive (welding) -> only on smaller set pieces
    // oculus + light shaft
    const oc = new THREE.Mesh(new THREE.CircleGeometry(2.4, 32).rotateX(Math.PI / 2), cloneMaterial(this.mGlow));
    oc.material.uniforms.uTint.value.setRGB(1.0, 0.92, 0.78); oc.material.uniforms.uGlow.value = 0.6;
    oc.position.set(0, H - 0.02, -1);
    g.add(oc);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 4.4, H, 28, 1, true).translate(0, H / 2, 0),
      additive({ uTime: this.ctx.uniforms.uTime, uCol: { value: new THREE.Color(1.0, 0.86, 0.62) }, uAmp: { value: 0.3 } }, UV_VERT, SHAFT_FRAG, { side: THREE.DoubleSide }));
    shaft.position.set(0, 0, -1); shaft.renderOrder = 9;
    g.add(shaft);
    s.shaft = shaft;
    // lantern crystals + halos
    for (const ln of s.lanterns) {
      const cr = new THREE.Mesh(new THREE.OctahedronGeometry(0.32).scale(1, 1.6, 1), cloneMaterial(this.mGlowAmber));
      cr.position.copy(ln.pos); cr.material.uniforms.uGlow.value = 0.7;
      const ol = new THREE.Mesh(outlineGeometry(cr.geometry), this.ink); cr.add(ol);
      const halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), additive({ uCol: { value: new THREE.Color(1.0, 0.58, 0.26) }, uAmp: { value: 0.6 }, uSize: { value: 4.8 } }, HALO_VERT, HALO_FRAG));
      halo.position.copy(ln.pos); halo.renderOrder = 10; halo.frustumCulled = false;
      g.add(cr, halo);
      ln.mesh = cr; ln.halo = halo;
    }
    // heart monolith crystal
    const heart = new THREE.Mesh(new THREE.OctahedronGeometry(0.9).scale(0.8, 1.7, 0.8), cloneMaterial(this.mGlow));
    heart.position.copy(s.heart);
    heart.add(new THREE.Mesh(outlineGeometry(heart.geometry), this.ink));
    const hh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), additive({ uCol: { value: new THREE.Color(0x55f0d0) }, uAmp: { value: 0.5 }, uSize: { value: 7 } }, HALO_VERT, HALO_FRAG));
    hh.position.copy(s.heart); hh.renderOrder = 10; hh.frustumCulled = false;
    const rings = [];
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(1.5 + i * 0.45, 0.06, 6, 48), cloneMaterial(this.mGlow));
      r.position.copy(s.heart); rings.push(r); g.add(r);
    }
    g.add(heart, hh);
    s.heartMesh = heart; s.heartHalo = hh; s.rings = rings;
    // dust motes
    const N = 420, pos = new Float32Array(N * 3), seed = new Float32Array(N), R = rng(s.id * 31);
    for (let i = 0; i < N; i++) { pos[i * 3] = (R() - 0.5) * (W - 2); pos[i * 3 + 1] = R() * 12; pos[i * 3 + 2] = (R() - 0.5) * (L - 4); seed[i] = R(); }
    const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); mg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const motes = new THREE.Points(mg, additive({ uTime: this.ctx.uniforms.uTime, uCol: { value: new THREE.Color(0.55, 0.95, 0.85) }, uShaft: { value: new THREE.Vector3(O.x, 0, O.z - 1) } }, MOTE_VERT, MOTE_FRAG));
    motes.frustumCulled = false; motes.renderOrder = 10;
    g.add(motes);
    // chest
    s.chest = this.buildChest(s, g, new THREE.Vector3(0, 0.6, az + 0.8));
    // light rig (local -> world)
    const rig = [];
    for (const ln of s.lanterns) rig.push([ln.pos.clone().add(O), new THREE.Color(1.0, 0.62, 0.32).multiplyScalar(5.0), 13]);
    rig.push([new THREE.Vector3(0, H - 1, -1).add(O), new THREE.Color(1.0, 0.9, 0.74).multiplyScalar(12.0), 16]);
    rig.push([s.heart.clone().add(O), new THREE.Color(0.35, 0.95, 0.82).multiplyScalar(3.0), 14]);
    s.rig = rig;
    this.root.add(g);
    s.group = g;
    this.buildPuzzle(s);
  }

  buildChest(s, parent, p) {
    const base = merge([
      roundedBox(1.6, 0.8, 1.0, 0.06, 1, 0x6b4a32, 0).translate(0, 0.4, 0),
      roundedBox(1.66, 0.12, 1.06, 0.03, 1, 0x3c4650, 1).translate(0, 0.74, 0),
      roundedBox(0.14, 0.82, 1.06, 0.03, 1, 0x3c4650, 1).translate(-0.55, 0.4, 0),
      roundedBox(0.14, 0.82, 1.06, 0.03, 1, 0x3c4650, 1).translate(0.55, 0.4, 0),
      roundedBox(1.5, 0.05, 0.9, 0.02, 1, 0xffffff, 2).translate(0, 0.81, 0),
    ]);
    const lidG = merge([
      new THREE.CylinderGeometry(0.5, 0.5, 1.6, 14, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(Math.PI / 2).scale(1, 0.7, 1).translate(0, 0, 0.5),
      roundedBox(0.14, 0.4, 1.06, 0.03, 1, 0x3c4650, 1).translate(-0.55, 0.15, 0.5),
      roundedBox(0.14, 0.4, 1.06, 0.03, 1, 0x3c4650, 1).translate(0.55, 0.15, 0.5),
      roundedBox(0.3, 0.3, 0.1, 0.03, 1, 0xffffff, 2).translate(0, 0.0, 1.03),
    ].map((g, i) => i === 0 ? tintGeo(g, 0x7a5638, 0) : g));
    const g = new THREE.Group(); g.position.copy(p);
    const bm = new THREE.Mesh(base, cloneMaterial(this.mChest));
    const lid = new THREE.Mesh(lidG, bm.material);
    const lidPivot = new THREE.Group(); lidPivot.position.set(0, 0.8, -0.5); lidPivot.add(lid);
    bm.add(new THREE.Mesh(outlineGeometry(base), this.ink));
    lid.add(new THREE.Mesh(outlineGeometry(lidG), this.ink));
    g.add(bm, lidPivot);
    g.rotation.y = 0;
    parent.add(g);
    if (s.chestOpened) lidPivot.rotation.x = -1.9;
    s.statics.push({ type: 'box', x: s.origin.x + p.x, y: s.origin.y + p.y + 0.45, z: s.origin.z + p.z, hx: 0.8, hy: 0.45, hz: 0.5, rotY: 0, kind: 'sanctum', _sid: 3000 + s.statics.length });
    return { group: g, lid: lidPivot, mat: bm.material, pos: p.clone().add(s.origin) };
  }

  // ------------------------------------------------------------------ puzzles
  spawnProp(s, type, lx, ly, lz, o = {}) {
    const p = this.props.spawn(type, { position: new THREE.Vector3(s.origin.x + lx, s.origin.y + ly, s.origin.z + lz), group: s.id, quaternion: o.quaternion });
    p.home = p.body.pos.clone(); p.homeQ = p.body.quat.clone();
    p.body.killY = s.origin.y - 6;
    p.body.userData.onFellOut = b => this.respawnProp(p);
    s.props.push(p);
    return p;
  }
  respawnProp(p) {
    const b = p.body;
    b.pos.copy(p.home); b.pos.y += 1.5; b.quat.copy(p.homeQ); b.vel.set(0, 0, 0); b.angVel.set(0, 0, 0); b.wake(); b.updateDerived();
    for (let i = 0; i < 10; i++) this.fx.emit(FX.MOTE, b.pos.x + (Math.random() - 0.5) * 1.5, b.pos.y + Math.random(), b.pos.z + (Math.random() - 0.5) * 1.5, 0, 0.8, 0, 0.35, 1.2, 0.4, 1, 0.85, 1);
  }
  addPlate(s, lx, lz, ly = 0, need = 10) {
    const O = s.origin;
    const g = merge([roundedBox(2.2, 0.16, 2.2, 0.05, 1, 0x7f8b8d, 1), roundedBox(1.6, 0.2, 1.6, 0.04, 1, 0xa8b2b0, 2)]);
    const m = new THREE.Mesh(g, cloneMaterial(this.mInterior));
    m.position.set(lx, ly + 0.08, lz);
    s.group.add(m);
    const plate = { lx, lz, ly, x: O.x + lx, z: O.z + lz, y: O.y + ly, mesh: m, need, pressed: false, t: 0 };
    (s.plates ||= []).push(plate);
    return plate;
  }

  buildPuzzle(s) {
    const k = s.kind;
    s.plates = [];
    if (k === 'weight') {
      this.addPlate(s, -6, -6); this.addPlate(s, 6, -6);
      this.spawnProp(s, 'crate', -4, 0.55, 6); this.spawnProp(s, 'crate', -4, 1.6, 6);
      this.spawnProp(s, 'stoneCube', 5, 0.7, 4); this.spawnProp(s, 'crateBig', 7, 0.75, 9);
      this.spawnProp(s, 'boom', -8, 0.6, -2);
      s.check = () => s.plates.every(p => p.pressed);
    } else if (k === 'ascent') {
      this.spawnProp(s, 'stoneCube', -5, 0.7, 2); this.spawnProp(s, 'stoneCube', 4, 0.7, 4);
      this.spawnProp(s, 'crateBig', 0, 0.75, 8); this.spawnProp(s, 'crate', 7, 0.55, 0); this.spawnProp(s, 'crate', -8, 0.55, 7);
      this.addPlate(s, 0, -12, 4.2, 10);
      s.check = () => s.plates.every(p => p.pressed);
    } else if (k === 'lodestone') {
      this.spawnProp(s, 'ironSlab', -4, 0.25, -1);
      this.spawnProp(s, 'ironSlab', -4, 0.7, 2);
      this.spawnProp(s, 'ironBlock', 4, 0.65, 2);
      this.spawnProp(s, 'ironBall', 7, 0.5, 6);
      this.addPlate(s, 6.5, -11.6, 3.0, 30);
      // runestone pedestal giving the Lodestone rune
      s.check = () => s.plates.every(p => p.pressed);
    } else if (k === 'balance') {
      this.buildTilt(s);
      s.check = () => s.tilt && s.tilt.done;
    }
  }

  buildTilt(s) {
    const O = s.origin;
    const cx = 0, cy = 1.25, cz = -2;
    const half = 4.6, th = 0.2, wh = 0.32, wt = 0.16;
    const pieces = [];
    const add = (x, z, hx, hz, hy = wh, y = th + wh) => pieces.push({ lx: x, ly: y, lz: z, hx, hy, hz });
    pieces.push({ lx: 0, ly: 0, lz: 0, hx: half, hy: th, hz: half, base: true });
    add(0, -half + wt, half, wt); add(0, half - wt, half, wt); add(-half + wt, 0, wt, half); add(half - wt, 0, wt, half);
    // maze walls (cell 1.53 m grid of 6x6), hand-laid
    const C = (2 * half) / 6;
    const seg = (i0, j0, i1, j1) => {
      const x0 = -half + i0 * C, z0 = -half + j0 * C, x1 = -half + i1 * C, z1 = -half + j1 * C;
      add((x0 + x1) / 2, (z0 + z1) / 2, Math.max(wt, Math.abs(x1 - x0) / 2 + wt * 0.5), Math.max(wt, Math.abs(z1 - z0) / 2 + wt * 0.5));
    };
    seg(1, 1, 1, 4); seg(1, 1, 3, 1); seg(2, 2, 5, 2); seg(3, 3, 3, 6); seg(4, 3, 6, 3); seg(4, 4, 4, 5); seg(0, 5, 2, 5); seg(5, 4, 5, 5); seg(2, 3, 2, 4);
    const parts = [];
    const bodies = [];
    for (const pc of pieces) {
      const geo = pc.base
        ? merge([roundedBox(pc.hx * 2, pc.hy * 2, pc.hz * 2, 0.08, 1, 0x9aa5a6, 1)])
        : roundedBox(pc.hx * 2, pc.hy * 2, pc.hz * 2, 0.05, 1, 0xb3bcbb, 0);
      parts.push(geo.translate(pc.lx, pc.ly, pc.lz));
      const b = new Body({ shape: 'box', hx: pc.hx, hy: pc.hy, hz: pc.hz, kinematic: true, group: s.id, friction: 0.5, position: new THREE.Vector3(O.x + cx + pc.lx, O.y + cy + pc.ly, O.z + cz + pc.lz) });
      b.local = new THREE.Vector3(pc.lx, pc.ly, pc.lz);
      this.phys.add(b); bodies.push(b);
    }
    // goal socket ring + start ring (decals on the table)
    const goal = new THREE.Vector3(-half + C * 5.5, th + 0.01, -half + C * 5.5);
    const start = new THREE.Vector3(-half + C * 0.5, th + 0.5, -half + C * 0.5);
    parts.push(tintGeo(new THREE.RingGeometry(0.42, 0.62, 32).rotateX(-Math.PI / 2).translate(goal.x, goal.y + 0.005, goal.z), 0xffffff, 3));
    parts.push(tintGeo(new THREE.CircleGeometry(0.42, 24).rotateX(-Math.PI / 2).translate(goal.x, goal.y + 0.004, goal.z), 0x3a464c, 0));
    parts.push(tintGeo(new THREE.RingGeometry(0.4, 0.5, 32).rotateX(-Math.PI / 2).translate(start.x, th + 0.012, start.z), 0xffffff, 2));
    const geo = merge(parts);
    const table = new THREE.Group(); table.position.set(cx, cy, cz);
    const mesh = new THREE.Mesh(geo, cloneMaterial(this.mInterior));
    mesh.add(new THREE.Mesh(outlineGeometry(geo), this.ink));
    table.add(mesh);
    s.group.add(table);
    const ball = this.spawnProp(s, 'ironBall', cx + start.x, cy + start.y, cz + start.z);
    ball.body.canSleep = false; ball.body.r = 0.4; ball.body.restitution = 0.05;
    ball.home = ball.body.pos.clone();
    s.tilt = { table, bodies, center: new THREE.Vector3(O.x + cx, O.y + cy, O.z + cz), q: new THREE.Quaternion(), tx: 0, tz: 0, ax: 0, az: 0, wx: 0, wz: 0, goal, ball, done: false, control: false, mesh };
  }

  updateTilt(s, dt) {
    const T = s.tilt; if (!T) return;
    // input from the lectern
    const input = this.ctx.input;
    let tx = 0, tz = 0;
    if (T.control) {
      const mv = input.move();
      const cam = this.ctx.camera;
      // camera-relative steering
      const f = cam.getWorldDirection(_t1); f.y = 0; f.normalize();
      const r = _t2.set(-f.z, 0, f.x);
      const dx = r.x * mv.x + f.x * mv.y, dz = r.z * mv.x + f.z * mv.y;
      // tilt so the ball rolls toward the stick direction
      tz = -dx * 0.16; tx = dz * 0.16;
    } else if (!T.done && this.ctx.shotMode) { tx = 0.07; tz = -0.05; }
    const k = 1 - Math.exp(-dt * 3.5);
    const ox = T.ax, oz = T.az;
    T.ax += (tx - T.ax) * k; T.az += (tz - T.az) * k;
    T.wx = (T.ax - ox) / Math.max(dt, 1e-4); T.wz = (T.az - oz) / Math.max(dt, 1e-4);
    T.q.setFromEuler(_e.set(T.ax, 0, T.az));
    T.table.quaternion.copy(T.q);
    for (const b of T.bodies) {
      const wp = _t1.copy(b.local).applyQuaternion(T.q).add(T.center);
      b.vel.subVectors(wp, b.pos).divideScalar(Math.max(dt, 1e-4));
      b.angVel.set(T.wx, 0, T.wz);
      b.pos.copy(wp); b.quat.copy(T.q); b.updateDerived();
    }
    // goal check (table-local)
    const bp = _t1.copy(T.ball.body.pos).sub(T.center).applyQuaternion(_q1.copy(T.q).invert());
    if (!T.done && Math.hypot(bp.x - T.goal.x, bp.z - T.goal.z) < 0.42 && Math.abs(bp.y - T.goal.y - 0.4) < 0.35) {
      T.done = true; T.control = false;
      this.ctx.systems.player?.setInputEnabled?.(true);
      for (let i = 0; i < 30; i++) this.fx.emit(FX.MOTE, T.ball.body.pos.x, T.ball.body.pos.y + 0.3, T.ball.body.pos.z, (Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3, 0.4, 1.6, 0.4, 1, 0.85, 1);
    }
    if (T.done) { T.ball.mat.uniforms.uGlow.value = 1; T.ball.body.vel.multiplyScalar(0.8); }
  }

  // ------------------------------------------------------------------ enter / exit
  enter(s, { instant = false } = {}) {
    this.buildInterior(s);
    const go = () => {
      if (this.active && this.active !== s) this.active.group.visible = false;
      this.active = s;
      s.group.visible = true;
      this.phys.activeGroup = s.id;
      this.applyRig(s);
      this.shared.uIndoor.value = 1;
      this.ctx.indoor = { kind: 'sanctum', id: s.id };
      const pl = this.ctx.systems.player;
      pl?.teleport?.(s.arrival.x, s.arrival.z, Math.PI);
      if (pl?.position) pl.position.y = s.arrival.y;
      this.ctx.events.emit('sanctumEnter', { id: s.id, name: s.name, kind: s.kind });
      this.banner(s.name, s.solved ? 'COMPLETED' : PUZZLE_HINT[s.kind]);
      for (const p of s.props) p.body.wake();
    };
    if (instant || !this.fadeEl) go();
    else { this.fadeEl.style.opacity = 1; setTimeout(() => { go(); this.fadeEl.style.opacity = 0; }, 480); }
  }
  exit({ instant = false } = {}) {
    const s = this.active; if (!s) return;
    const go = () => {
      s.group.visible = false;
      this.active = null;
      this.phys.activeGroup = 0;
      this.shared.uIndoor.value = 0;
      this.ctx.indoor = null;
      if (s.tilt) s.tilt.control = false;
      const pl = this.ctx.systems.player;
      pl?.setInputEnabled?.(true);
      pl?.teleport?.(s.exitPos.x, s.exitPos.z, s.yaw);
      this.ctx.events.emit('sanctumExit', { id: s.id, name: s.name });
    };
    if (instant || !this.fadeEl) go();
    else { this.fadeEl.style.opacity = 1; setTimeout(() => { go(); this.fadeEl.style.opacity = 0; }, 480); }
  }
  applyRig(s) {
    const pl = this.shared.uPL.value, pc = this.shared.uPLC.value;
    for (let i = 0; i < pl.length; i++) {
      const r = s.rig[i];
      if (r) { pl[i].set(r[0].x, r[0].y, r[0].z, r[2]); pc[i].set(r[1].r, r[1].g, r[1].b); }
      else { pl[i].set(0, -1e4, 0, 1); pc[i].set(0, 0, 0); }
    }
  }

  solve(s) {
    if (s.gateTarget === 1) return;
    s.gateTarget = 1;
    this.ctx.events.emit('sanctumGateOpen', { id: s.id });
    this.ctx.systems.audio?.play?.('sanctumOpen');
  }
  openChest(s) {
    if (s.chestOpened) return;
    s.chestOpened = true;
    s.solved = true; this.solved.add(s.id); this.saveSolved();
    const p = s.chest.pos;
    for (let i = 0; i < 40; i++) this.fx.emit(FX.MOTE, p.x + (Math.random() - 0.5), p.y + 1, p.z + (Math.random() - 0.5), (Math.random() - 0.5) * 2, 1.5 + Math.random() * 2.5, (Math.random() - 0.5) * 2, 0.5, 2.2, 0.45, 1, 0.85, 1);
    this.ctx.systems.gameplay?.addItem?.('sanctum-sigil', 1);
    this.ctx.events.emit('itemPickup', { item: 'sanctum-sigil', name: 'Sigil of Passage', count: 1, source: 'sanctum' });
    this.ctx.events.emit('shrineSolved', { id: s.id, name: s.name, kind: s.kind });
    this.banner('Sigil of Passage', s.name.toUpperCase() + ' — COMPLETE', 3.6);
    // entrance turns jade
    s.ent.doorMat.uniforms.uCol.value.set(0x55f0d0);
    s.ent.beamMat.uniforms.uCol.value.set(0x55f0d0);
    s.ent.halo.material.uniforms.uCol.value.set(0x55f0d0);
    s.ent.rune.material.uniforms.uTint.value.set(0x6ff5da);
  }

  updateBlobs(s) {
    let n = 0;
    const aA = this.blobs.geometry.getAttribute('aA');
    for (const p of s.props) {
      if (!p.alive || n >= 32) continue;
      const b = p.body;
      let fy = -Infinity;
      for (const c of s.statics) {
        let inside;
        if (c.type === 'box') inside = Math.abs(b.pos.x - c.x) < c.hx && Math.abs(b.pos.z - c.z) < c.hz;
        else inside = (b.pos.x - c.x) ** 2 + (b.pos.z - c.z) ** 2 < c.r * c.r;
        if (!inside) continue;
        const top = c.y + (c.hy || 0);
        if (top <= b.pos.y + 0.05 && top > fy) fy = top;
      }
      if (!isFinite(fy)) continue;
      const hgt = b.pos.y - b.boundR - fy;
      const r = b.boundR * 1.25 + Math.max(0, hgt) * 0.3;
      this._bm.makeScale(r, 1, r).setPosition(b.pos.x, fy + 0.015, b.pos.z);
      this.blobs.setMatrixAt(n, this._bm);
      aA.setX(n, 0.75 * Math.max(0, 1 - Math.max(0, hgt) / 4));
      n++;
    }
    this.blobs.count = n;
    this.blobs.instanceMatrix.needsUpdate = true; aA.needsUpdate = true;
  }

  // ------------------------------------------------------------------ queries
  queryStatics(x, z, r, out, group) {
    out.length = 0;
    const list = group ? (this.list[group - 1]?.statics || []) : this.worldStatics;
    for (const c of list) {
      const rr = (c.type === 'box' ? Math.hypot(c.hx, c.hz) : c.r) + r;
      if ((c.x - x) ** 2 + (c.z - z) ** 2 <= rr * rr) out.push(c);
    }
    return out;
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    this.t += dt;
    const t = this.ctx.uniforms.uTime.value;
    const pl = this.ctx.systems.player;
    const input = this.ctx.input;
    const ppos = pl?.position;
    let prompt = null, action = null;
    // entrance animation + proximity
    for (const s of this.list) {
      const e = s.ent;
      e.rune.position.y = e.top + 6.2 + 3.3 + Math.sin(t * 1.2 + s.id) * 0.25;
      e.rune.rotation.y = t * 0.6;
      e.halo.position.copy(e.rune.position);
      e.halo.material.uniforms.uAmp.value = 0.45 + 0.12 * Math.sin(t * 2.1 + s.id);
      if (!this.active && ppos && ppos.distanceToSquared(s.doorPos) < 2.6 * 2.6) { prompt = `Enter ${s.name}`; action = () => this.enter(s); }
      // ambient glyph motes drifting off the door
      if (this.ctx.camera.position.distanceToSquared(s.doorPos) < 70 * 70 && Math.random() < dt * 3) {
        const c = s.solved ? [0.4, 1, 0.85] : [1, 0.65, 0.3];
        this.fx.emit(FX.MOTE, s.doorPos.x + (Math.random() - 0.5) * 3, s.doorPos.y + Math.random() * 5, s.doorPos.z + (Math.random() - 0.5) * 2, 0, 0.4 + Math.random() * 0.4, 0, 0.18, 2.5, c[0], c[1], c[2], 1);
      }
    }
    const s = this.active;
    if (s) {
      // interior animation
      for (const ln of s.lanterns) {
        ln.mesh.position.y = ln.pos.y + Math.sin(t * 1.3 + ln.seed) * 0.12;
        ln.mesh.rotation.y = t * 0.7 + ln.seed;
        ln.halo.position.copy(ln.mesh.position);
        ln.halo.material.uniforms.uAmp.value = 0.55 + 0.08 * Math.sin(t * 5 + ln.seed * 3);
      }
      s.heartMesh.rotation.y = t * 0.5;
      s.heartMesh.material.uniforms.uGlow.value = 0.6 + 0.4 * Math.sin(t * 1.7) + s.gateOpen;
      s.rings.forEach((r, i) => { r.rotation.set(t * (0.3 + i * 0.17), t * (0.21 - i * 0.11), i * 0.9); });
      // plates
      for (const p of s.plates) {
        let mass = 0;
        for (const pr of s.props) {
          const b = pr.body;
          if (Math.abs(b.pos.x - p.x) < 1.25 && Math.abs(b.pos.z - p.z) < 1.25 && b.pos.y - p.y < b.boundR + 0.45 && b.pos.y > p.y) mass += b.mass;
        }
        if (ppos && Math.abs(ppos.x - p.x) < 1.1 && Math.abs(ppos.z - p.z) < 1.1 && Math.abs(ppos.y - p.y - 0.16) < 0.5) mass += 60;
        const was = p.pressed;
        p.pressed = mass >= p.need;
        p.t += ((p.pressed ? 1 : 0) - p.t) * Math.min(1, dt * 8);
        p.mesh.position.y = p.ly + 0.08 - p.t * 0.06;
        p.mesh.material.uniforms.uSolved.value = p.t;
        if (p.pressed !== was) this.ctx.events.emit('plate', { sanctum: s.id, pressed: p.pressed });
      }
      if (s.kind === 'balance') this.updateTilt(s, dt);
      if (s.check && s.check()) this.solve(s);
      else if (s.gateTarget === 1 && s.kind !== 'balance' && !s.chestOpened && !(s.check && s.check())) { /* plates released: keep open once solved */ }
      // gate
      s.gateOpen += (s.gateTarget - s.gateOpen) * Math.min(1, dt * 1.2);
      for (const gt of s.gate) {
        const x = gt.x0 + gt.sx * s.gateOpen * 2.3;
        gt.mesh.position.x = x;
        gt.col.x = s.origin.x + x;
        gt.mesh.material.uniforms.uSolved.value = s.gateOpen;
        gt.col.hy = s.gateOpen > 0.92 ? 0.01 : 3;   // fully open: let the player through cleanly
        gt.col.y = s.origin.y + (s.gateOpen > 0.92 ? -5 : 3);
      }
      this.mInterior.uniforms.uSolved.value = s.gateOpen * 0.6;
      // chest lid
      const lidT = s.chestOpened ? -1.9 : 0;
      s.chest.lid.rotation.x += (lidT - s.chest.lid.rotation.x) * Math.min(1, dt * 3);
      s.chest.mat.uniforms.uGlow.value = s.chestOpened ? 0.2 : 0.6 + 0.4 * Math.sin(t * 2.4);
      // interactions
      if (ppos) {
        if (ppos.distanceToSquared(s.arrival) < 2.4 * 2.4) { prompt = 'Leave Sanctum'; action = () => this.exit(); }
        else if (s.chestOpened && ppos.distanceToSquared(s.altarExit) < 1.6 * 1.6) { prompt = 'Return to the Surface'; action = () => this.exit(); }
        else if (!s.chestOpened && ppos.distanceToSquared(s.chest.pos) < 2.2 * 2.2 && s.gateOpen > 0.5) { prompt = 'Open'; action = () => this.openChest(s); }
        else if (s.tilt && !s.tilt.done && ppos.distanceToSquared(s.lecternPos) < 1.8 * 1.8) {
          prompt = s.tilt.control ? 'Release the Table' : 'Steer the Table';
          action = () => { s.tilt.control = !s.tilt.control; pl?.setInputEnabled?.(!s.tilt.control); };
        }
        // fell into the chasm
        if (ppos.y < s.origin.y - 5) { pl?.teleport?.(s.arrival.x, s.arrival.z, Math.PI); if (pl?.position) pl.position.y = s.arrival.y; pl?.damage?.(4, { source: 'fall' }); }
      }
      // rig flicker
      const pc = this.shared.uPLC.value;
      for (let i = 0; i < s.lanterns.length; i++) { const f = 5.0 * (0.92 + 0.08 * Math.sin(t * 6 + i * 1.7) * Math.sin(t * 3.3 + i)); pc[i].set(1.0 * f, 0.62 * f, 0.32 * f); }
      this.shared.uGlyphPulse.value = s.gateOpen;
      this.updateBlobs(s);
    } else this.blobs.count = 0;
    this.showPrompt(this.ctx.shotMode ? null : prompt);
    if (action && input?.justPressed?.('interact')) action();
  }
}

const PUZZLE_HINT = {
  balance: 'GUIDE THE IRON SPHERE HOME',
  lodestone: 'THE RUNE MOVES WHAT IRON REMEMBERS',
  weight: 'WHAT IS HEAVY OPENS THE WAY',
  ascent: 'BUILD WHAT YOU CANNOT CLIMB',
};

const _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3(), _q1 = new THREE.Quaternion(), _e = new THREE.Euler();

function tintGeo(g, color, glow) {
  if (g.index) g = g.toNonIndexed();
  const n = g.getAttribute('position').count;
  const c = new THREE.Color(color), a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  g.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n).fill(glow), 1));
  if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}
