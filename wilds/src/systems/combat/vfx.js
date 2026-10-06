// Combat VFX: one instanced billboard particle pool per blend mode (additive sparks/flame/flash,
// alpha-blended painterly smoke/dust/shards), weapon slash ribbons, shock rings, and the
// alert '!' / suspicious '?' indicators. Struct-of-arrays CPU sim, zero per-frame allocation.
import * as THREE from 'three';

// ---------------------------------------------------------------- textures
function makeAtlas() {
  // 4 cells (128px): 0 soft glow dot, 1 painterly smoke puff, 2 4-point star flash, 3 shard/leaf
  const S = 128, c = document.createElement('canvas'); c.width = S * 4; c.height = S;
  const g = c.getContext('2d');
  // 0 glow
  let gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  // 1 smoke puff: clustered soft blobs with a lit top (baked shading for a painted look)
  const ox = S;
  const rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2, r = rnd() * S * 0.18;
    const x = ox + S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r * 0.8, rr = S * (0.2 + rnd() * 0.12);
    gr = g.createRadialGradient(x - rr * 0.25, y - rr * 0.35, rr * 0.1, x, y, rr);
    gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.55, 'rgba(225,228,232,0.85)'); gr.addColorStop(0.85, 'rgba(190,198,210,0.4)'); gr.addColorStop(1, 'rgba(180,190,205,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fill();
  }
  // 2 star flash
  const sx = S * 2 + S / 2, sy = S / 2;
  gr = g.createRadialGradient(sx, sy, 0, sx, sy, S * 0.5);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.15, 'rgba(255,255,255,0.6)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.08)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(S * 2, 0, S, S);
  g.fillStyle = 'rgba(255,255,255,0.95)';
  for (let k = 0; k < 8; k++) {
    const a = k / 8 * Math.PI * 2, L = k % 2 ? S * 0.26 : S * 0.48, w = k % 2 ? 4 : 7;
    g.beginPath(); g.moveTo(sx + Math.cos(a) * L, sy + Math.sin(a) * L);
    g.lineTo(sx + Math.cos(a + Math.PI / 2) * w, sy + Math.sin(a + Math.PI / 2) * w);
    g.lineTo(sx - Math.cos(a) * 2, sy - Math.sin(a) * 2);
    g.lineTo(sx + Math.cos(a - Math.PI / 2) * w, sy + Math.sin(a - Math.PI / 2) * w); g.fill();
  }
  // 3 shard (angular sliver)
  g.fillStyle = 'rgba(255,255,255,1)';
  g.beginPath(); g.moveTo(S * 3 + S * 0.5, S * 0.08); g.lineTo(S * 3 + S * 0.72, S * 0.55); g.lineTo(S * 3 + S * 0.46, S * 0.94); g.lineTo(S * 3 + S * 0.3, S * 0.42); g.closePath(); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
export function makeGlowTexture() {
  const S = 64, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function glyphTexture(ch, fill, stroke) {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.font = '900 104px Georgia, "Times New Roman", serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 16; g.strokeStyle = 'rgba(20,14,18,0.9)'; g.strokeText(ch, S / 2, S / 2 + 6);
  g.lineWidth = 7; g.strokeStyle = stroke; g.strokeText(ch, S / 2, S / 2 + 6);
  g.fillStyle = fill; g.fillText(ch, S / 2, S / 2 + 6);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const PV = /* glsl */`
attribute vec3 iPos; attribute vec4 iColor; attribute vec4 iData; attribute vec3 iVel;
varying vec2 vUv; varying vec4 vColor;
#include <fog_pars_vertex>
void main() {
  vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec2 q = position.xy;
  float s = iData.x;
  vec3 wp;
  if (iData.w > 0.0) {
    vec3 ax = iVel; float l = length(ax); ax = l > 1e-4 ? ax / l : camU;
    vec3 toCam = normalize(cameraPosition - iPos);
    vec3 rt = normalize(cross(ax, toCam) + 1e-5);
    wp = iPos + ax * q.y * s * (1.0 + iData.w * l) + rt * q.x * s * 0.32;
  } else {
    float c = cos(iData.y), sn = sin(iData.y);
    vec2 r = vec2(q.x * c - q.y * sn, q.x * sn + q.y * c);
    wp = iPos + (camR * r.x + camU * r.y) * s;
  }
  vUv = vec2((position.x + 0.5 + iData.z) * 0.25, position.y + 0.5);
  vColor = iColor;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const PF = /* glsl */`
uniform sampler2D uMap; uniform float uLight; uniform vec3 uSunColor; uniform vec3 uSkyColor; uniform float uLit;
varying vec2 vUv; varying vec4 vColor;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(uMap, vUv);
  vec3 col = vColor.rgb * t.rgb;
  if (uLit > 0.5) {
    // smoke/dust pick up the key + sky light so they sit in the scene (cool undersides baked in tex)
    float day = smoothstep(0.04, 0.3, dot(uSkyColor, vec3(0.299, 0.587, 0.114)));
    col *= mix(uSkyColor * 0.9 + 0.08, min(vec3(1.25), uSunColor * 0.45 + uSkyColor * 0.55), 0.6) * (0.35 + 0.65 * day) * 1.25;
  }
  float a = t.a * vColor.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

class Pool {
  constructor(ctx, cap, blending, lit, atlas) {
    const { uniforms: U } = ctx;
    this.cap = cap; this.n = 0;
    this.px = new Float32Array(cap * 3); this.pv = new Float32Array(cap * 3);
    this.life = new Float32Array(cap); this.max = new Float32Array(cap);
    this.s0 = new Float32Array(cap); this.s1 = new Float32Array(cap);
    this.col = new Float32Array(cap * 4); this.rot = new Float32Array(cap); this.rv = new Float32Array(cap);
    this.cell = new Float32Array(cap); this.stretch = new Float32Array(cap);
    this.drag = new Float32Array(cap); this.grav = new Float32Array(cap); this.fade = new Float32Array(cap);
    this.ground = new Float32Array(cap);
    const geo = new THREE.InstancedBufferGeometry();
    const q = new THREE.PlaneGeometry(1, 1);
    geo.index = q.index; geo.setAttribute('position', q.attributes.position);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aDat = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.aPos); geo.setAttribute('iColor', this.aCol); geo.setAttribute('iData', this.aDat); geo.setAttribute('iVel', this.aVel);
    geo.instanceCount = 0;
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsLib.fog, uMap: { value: atlas }, uLight: { value: 1 }, uSunColor: U.uSunColor, uSkyColor: U.uSkyColor, uLit: { value: lit ? 1 : 0 } },
      vertexShader: PV, fragmentShader: PF, transparent: true, depthWrite: false, blending, fog: true, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = lit ? 5 : 6;
  }
  // o: {x,y,z, vx,vy,vz, life, size, size1, r,g,b,a, cell, stretch, drag, grav, rot, rv, fade(0=linear,1=late), ground}
  spawn(o) {
    let i;
    if (this.n < this.cap) i = this.n++;
    else { // recycle the oldest-ish: pick the one with least remaining life
      i = 0; let best = 1e9;
      for (let k = 0; k < this.cap; k += 7) { const r = this.max[k] - this.life[k]; if (r < best) { best = r; i = k; } }
    }
    const i3 = i * 3, i4 = i * 4;
    this.px[i3] = o.x; this.px[i3 + 1] = o.y; this.px[i3 + 2] = o.z;
    this.pv[i3] = o.vx || 0; this.pv[i3 + 1] = o.vy || 0; this.pv[i3 + 2] = o.vz || 0;
    this.life[i] = 0; this.max[i] = o.life || 1;
    this.s0[i] = o.size ?? 0.3; this.s1[i] = o.size1 ?? this.s0[i];
    this.col[i4] = o.r ?? 1; this.col[i4 + 1] = o.g ?? 1; this.col[i4 + 2] = o.b ?? 1; this.col[i4 + 3] = o.a ?? 1;
    this.rot[i] = o.rot ?? Math.random() * 6.28; this.rv[i] = o.rv ?? 0;
    this.cell[i] = o.cell ?? 0; this.stretch[i] = o.stretch ?? 0;
    this.drag[i] = o.drag ?? 0; this.grav[i] = o.grav ?? 0; this.fade[i] = o.fade ?? 0;
    this.ground[i] = o.ground ?? -1e9;
  }
  update(dt) {
    let n = this.n;
    const P = this.aPos.array, C = this.aCol.array, D = this.aDat.array, Vv = this.aVel.array;
    for (let i = 0; i < n; i++) {
      this.life[i] += dt;
      if (this.life[i] >= this.max[i]) {
        // swap-remove
        n--; this.copy(n, i); i--; continue;
      }
      const i3 = i * 3;
      const dk = Math.exp(-this.drag[i] * dt);
      this.pv[i3] *= dk; this.pv[i3 + 1] = this.pv[i3 + 1] * dk - this.grav[i] * dt; this.pv[i3 + 2] *= dk;
      this.px[i3] += this.pv[i3] * dt; this.px[i3 + 1] += this.pv[i3 + 1] * dt; this.px[i3 + 2] += this.pv[i3 + 2] * dt;
      if (this.px[i3 + 1] < this.ground[i]) { this.px[i3 + 1] = this.ground[i]; this.pv[i3 + 1] *= -0.3; this.pv[i3] *= 0.6; this.pv[i3 + 2] *= 0.6; this.rv[i] *= 0.5; }
      this.rot[i] += this.rv[i] * dt;
    }
    this.n = n;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3, i4 = i * 4, u = this.life[i] / this.max[i];
      P[i3] = this.px[i3]; P[i3 + 1] = this.px[i3 + 1]; P[i3 + 2] = this.px[i3 + 2];
      Vv[i3] = this.pv[i3]; Vv[i3 + 1] = this.pv[i3 + 1]; Vv[i3 + 2] = this.pv[i3 + 2];
      const f = this.fade[i] > 0 ? 1 - Math.max(0, (u - 0.55) / 0.45) : 1 - u;
      const fin = Math.min(1, this.life[i] * 30);
      C[i4] = this.col[i4]; C[i4 + 1] = this.col[i4 + 1]; C[i4 + 2] = this.col[i4 + 2]; C[i4 + 3] = this.col[i4 + 3] * f * fin;
      D[i4] = this.s0[i] + (this.s1[i] - this.s0[i]) * (1 - (1 - u) * (1 - u)); D[i4 + 1] = this.rot[i]; D[i4 + 2] = this.cell[i]; D[i4 + 3] = this.stretch[i];
    }
    this.geo.instanceCount = n;
    if (n) { this.aPos.needsUpdate = this.aCol.needsUpdate = this.aDat.needsUpdate = this.aVel.needsUpdate = true; }
  }
  copy(from, to) {
    if (from === to) return;
    for (let k = 0; k < 3; k++) { this.px[to * 3 + k] = this.px[from * 3 + k]; this.pv[to * 3 + k] = this.pv[from * 3 + k]; }
    for (let k = 0; k < 4; k++) this.col[to * 4 + k] = this.col[from * 4 + k];
    this.life[to] = this.life[from]; this.max[to] = this.max[from]; this.s0[to] = this.s0[from]; this.s1[to] = this.s1[from];
    this.rot[to] = this.rot[from]; this.rv[to] = this.rv[from]; this.cell[to] = this.cell[from]; this.stretch[to] = this.stretch[from];
    this.drag[to] = this.drag[from]; this.grav[to] = this.grav[from]; this.fade[to] = this.fade[from]; this.ground[to] = this.ground[from];
  }
}

// ---------------------------------------------------------------- slash ribbon
const TV = /* glsl */`
attribute float aAge; attribute float aSide;
varying float vAge; varying float vSide;
void main() { vAge = aAge; vSide = aSide; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`;
const TF = /* glsl */`
uniform vec3 uColor; uniform float uAlpha;
varying float vAge; varying float vSide;
void main() {
  float a = (1.0 - vAge) * (1.0 - vAge) * smoothstep(0.15, 0.85, vSide) * uAlpha * (0.35 + 0.65 * smoothstep(0.0, 0.25, vAge));
  vec3 col = mix(uColor, vec3(1.0), smoothstep(0.88, 1.0, vSide) * (1.0 - vAge));
  gl_FragColor = vec4(col * 1.2, a);
  #include <colorspace_fragment>
}`;
export class Trail {
  constructor(N = 18, color = 0xdff6ff) {
    this.N = N; this.count = 0; this.alpha = 0; this.active = false;
    this.base = new Float32Array(N * 3); this.tip = new Float32Array(N * 3);
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const age = new Float32Array(N * 2), side = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) { age[i * 2] = age[i * 2 + 1] = i / (N - 1); side[i * 2] = 0; side[i * 2 + 1] = 1; }
    const idx = [];
    for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geo.setIndex(idx);
    geo.setAttribute('position', this.pos); geo.setAttribute('aAge', new THREE.BufferAttribute(age, 1)); geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    this.mat = new THREE.ShaderMaterial({ uniforms: { uColor: { value: new THREE.Color(color) }, uAlpha: { value: 0 } }, vertexShader: TV, fragmentShader: TF,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(geo, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 7; this.mesh.visible = false;
  }
  push(b, t) {
    const N = this.N;
    this.base.copyWithin(3, 0, (N - 1) * 3); this.tip.copyWithin(3, 0, (N - 1) * 3);
    this.base[0] = b.x; this.base[1] = b.y; this.base[2] = b.z; this.tip[0] = t.x; this.tip[1] = t.y; this.tip[2] = t.z;
    if (this.count === 0) for (let i = 1; i < N; i++) for (let k = 0; k < 3; k++) { this.base[i * 3 + k] = this.base[k]; this.tip[i * 3 + k] = this.tip[k]; }
    this.count = Math.min(N, this.count + 1);
  }
  update(dt, b, t) {
    if (this.active && b) { this.push(b, t); this.alpha = Math.min(1, this.alpha + dt * 20); }
    else { this.alpha = Math.max(0, this.alpha - dt * 6); if (this.count && b) this.push(b, t); }
    if (this.alpha <= 0) { this.mesh.visible = false; this.count = 0; return; }
    this.mesh.visible = true;
    const P = this.pos.array;
    for (let i = 0; i < this.N; i++) {
      P[i * 6] = this.base[i * 3]; P[i * 6 + 1] = this.base[i * 3 + 1]; P[i * 6 + 2] = this.base[i * 3 + 2];
      P[i * 6 + 3] = this.tip[i * 3]; P[i * 6 + 4] = this.tip[i * 3 + 1]; P[i * 6 + 5] = this.tip[i * 3 + 2];
    }
    this.pos.needsUpdate = true;
    this.mat.uniforms.uAlpha.value = this.alpha * 0.6;
  }
}

// ---------------------------------------------------------------- main fx api
export function createVfx(ctx) {
  const { scene, world } = ctx;
  const atlas = makeAtlas();
  const add = new Pool(ctx, 1400, THREE.AdditiveBlending, false, atlas);
  const nrm = new Pool(ctx, 900, THREE.NormalBlending, true, atlas);
  scene.add(add.mesh, nrm.mesh);
  const glowTex = makeGlowTexture();
  ctx.__combatGlowTex = glowTex;
  const texBang = glyphTexture('!', '#ffd23a', '#ff7a1a');
  const texQ = glyphTexture('?', '#f4f1e6', '#9fb8c8');
  const R = Math.random;

  // shock rings (additive, flat on the ground)
  const ringGeo = new THREE.RingGeometry(0.75, 1, 48, 1); ringGeo.rotateX(-Math.PI / 2);
  const rings = [];
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: true, side: THREE.DoubleSide }));
    m.visible = false; m.renderOrder = 6; m.frustumCulled = false; scene.add(m); rings.push({ m, t: 0, dur: 0.5, r: 4 });
  }
  let ringI = 0;

  const fx = {
    add, nrm, glowTex, texBang, texQ,
    spawnAdd: o => add.spawn(o), spawnNrm: o => nrm.spawn(o),
    ring(x, y, z, radius = 4, color = 0xfff0c8, dur = 0.45) {
      const r = rings[ringI++ % rings.length];
      r.m.position.set(x, y + 0.08, z); r.m.material.color.set(color); r.t = 0; r.dur = dur; r.r = radius; r.m.visible = true;
    },
    // metal-on-flesh/metal sparks + white star flash, oriented roughly along dir
    sparks(p, dir, n = 14, color = [1, 0.85, 0.45], power = 1) {
      add.spawn({ x: p.x, y: p.y, z: p.z, life: 0.2, size: 1.6 * power, size1: 2.6 * power, cell: 2, r: 1, g: 0.9, b: 0.65, a: 1, rot: R() * 6 });
      add.spawn({ x: p.x, y: p.y, z: p.z, life: 0.12, size: 0.9 * power, size1: 1.4 * power, cell: 2, r: 1, g: 1, b: 1, a: 1, rot: R() * 6 });
      add.spawn({ x: p.x, y: p.y, z: p.z, life: 0.22, size: 0.9 * power, size1: 0.3, cell: 0, r: color[0], g: color[1], b: color[2], a: 1 });
      for (let i = 0; i < n; i++) {
        const sp = (4 + R() * 9) * power;
        let vx = (R() - 0.5) * 2, vy = R() * 1.2, vz = (R() - 0.5) * 2;
        if (dir) { vx += dir.x * 1.5; vy += dir.y * 1.5; vz += dir.z * 1.5; }
        const l = Math.hypot(vx, vy, vz) || 1;
        add.spawn({ x: p.x, y: p.y, z: p.z, vx: vx / l * sp, vy: vy / l * sp, vz: vz / l * sp, life: 0.18 + R() * 0.25, size: 0.07, cell: 0, stretch: 0.045,
          r: color[0], g: color[1], b: color[2], a: 1, grav: 14, drag: 2.5 });
      }
    },
    // painterly impact: dust kick + leaf-ish flecks (non-metal hits)
    dust(p, n = 6, size = 0.6, col = [0.86, 0.8, 0.68]) {
      for (let i = 0; i < n; i++) {
        const a = R() * 6.28, s = 0.8 + R() * 1.6;
        nrm.spawn({ x: p.x + Math.cos(a) * 0.2, y: p.y + 0.1, z: p.z + Math.sin(a) * 0.2, vx: Math.cos(a) * s, vy: 0.6 + R() * 0.8, vz: Math.sin(a) * s,
          life: 0.7 + R() * 0.6, size: size * (0.6 + R() * 0.5), size1: size * 2.0, cell: 1, r: col[0], g: col[1], b: col[2], a: 0.55, drag: 3, rv: (R() - 0.5) * 2, fade: 1 });
      }
    },
    // death: big cartoon smoke poof (purple-grey core for enemies), embers and a flash
    poof(p, scale = 1, tint = [0.82, 0.78, 0.9]) {
      add.spawn({ x: p.x, y: p.y, z: p.z, life: 0.2, size: 1.5 * scale, size1: 3.2 * scale, cell: 2, r: 1, g: 0.85, b: 0.7, a: 0.9 });
      for (let i = 0; i < 18; i++) {
        const a = R() * 6.28, e = (R() - 0.3) * 1.2, s = (1.2 + R() * 2.2) * scale;
        nrm.spawn({ x: p.x + Math.cos(a) * 0.3 * scale, y: p.y + R() * 0.6 * scale, z: p.z + Math.sin(a) * 0.3 * scale,
          vx: Math.cos(a) * s, vy: (0.8 + e) * s * 0.6, vz: Math.sin(a) * s, life: 0.9 + R() * 0.8, size: 0.7 * scale, size1: (1.8 + R()) * scale,
          cell: 1, r: tint[0] + R() * 0.08, g: tint[1] + R() * 0.08, b: tint[2] + R() * 0.06, a: 0.95, drag: 2.8, grav: -0.6, rv: (R() - 0.5) * 1.5, fade: 1 });
      }
      for (let i = 0; i < 12; i++) {
        const a = R() * 6.28, s = 2 + R() * 4;
        add.spawn({ x: p.x, y: p.y + 0.4 * scale, z: p.z, vx: Math.cos(a) * s, vy: 2 + R() * 4, vz: Math.sin(a) * s, life: 0.5 + R() * 0.6, size: 0.08, stretch: 0.03,
          r: 1, g: 0.7, b: 0.35, a: 1, grav: 6, drag: 1.5 });
      }
    },
    // weapon shatter: shard slivers in the weapon colours + glints
    shatter(p, color = [0.8, 0.85, 0.9], n = 22) {
      add.spawn({ x: p.x, y: p.y, z: p.z, life: 0.25, size: 1.2, size1: 2.4, cell: 2, r: 1, g: 1, b: 1, a: 1 });
      for (let i = 0; i < n; i++) {
        const a = R() * 6.28, s = 2 + R() * 6, up = 1 + R() * 4;
        nrm.spawn({ x: p.x, y: p.y, z: p.z, vx: Math.cos(a) * s, vy: up, vz: Math.sin(a) * s, life: 0.7 + R() * 0.6, size: 0.06 + R() * 0.09, cell: 3,
          r: color[0] * 1.3, g: color[1] * 1.3, b: color[2] * 1.3, a: 1, grav: 14, drag: 1, rv: (R() - 0.5) * 30, ground: world.getHeight(p.x, p.z) + 0.03, fade: 1 });
        if (i % 3 === 0) add.spawn({ x: p.x, y: p.y, z: p.z, vx: Math.cos(a) * s * 0.8, vy: up, vz: Math.sin(a) * s * 0.8, life: 0.4, size: 0.12, cell: 0, r: 0.9, g: 0.95, b: 1, a: 1, grav: 10 });
      }
    },
    explosion(p, scale = 1) {
      fx.ring(p.x, world.getHeight(p.x, p.z), p.z, 5 * scale, 0xffc070, 0.5);
      add.spawn({ x: p.x, y: p.y, z: p.z, life: 0.25, size: 3 * scale, size1: 7 * scale, cell: 2, r: 1, g: 0.85, b: 0.55, a: 1 });
      for (let i = 0; i < 26; i++) {
        const a = R() * 6.28, e = R(), s = (3 + R() * 6) * scale;
        add.spawn({ x: p.x, y: p.y + 0.3, z: p.z, vx: Math.cos(a) * s * (1 - e * 0.5), vy: e * s, vz: Math.sin(a) * s * (1 - e * 0.5), life: 0.35 + R() * 0.35,
          size: 1.0 * scale, size1: 2.2 * scale, cell: 0, r: 1, g: 0.55 + R() * 0.3, b: 0.15, a: 0.9, drag: 4 });
      }
      for (let i = 0; i < 22; i++) {
        const a = R() * 6.28, s = (1 + R() * 3) * scale;
        nrm.spawn({ x: p.x, y: p.y + 0.5, z: p.z, vx: Math.cos(a) * s, vy: 1.5 + R() * 3, vz: Math.sin(a) * s, life: 1.4 + R() * 1.2, size: 1.2 * scale, size1: 3.5 * scale,
          cell: 1, r: 0.42, g: 0.4, b: 0.42, a: 0.85, drag: 2, grav: -0.5, rv: (R() - 0.5), fade: 1 });
      }
      for (let i = 0; i < 16; i++) {
        const a = R() * 6.28, s = 4 + R() * 8;
        add.spawn({ x: p.x, y: p.y + 0.3, z: p.z, vx: Math.cos(a) * s, vy: 3 + R() * 7, vz: Math.sin(a) * s, life: 0.8 + R() * 0.5, size: 0.1, stretch: 0.04, r: 1, g: 0.75, b: 0.3, a: 1, grav: 14 });
      }
    },
    // campfire flame tongues + embers + smoke column (called every frame per visible fire)
    fire(x, y, z, dt, intensity = 1) {
      const n = dt * 40 * intensity;
      for (let i = 0; i < n; i++) {
        const a = R() * 6.28, r = R() * 0.32;
        add.spawn({ x: x + Math.cos(a) * r, y: y + 0.1, z: z + Math.sin(a) * r, vx: -Math.cos(a) * r * 0.8, vy: 1.4 + R() * 1.2, vz: -Math.sin(a) * r * 0.8,
          life: 0.45 + R() * 0.35, size: 0.55 + R() * 0.3, size1: 0.08, cell: 0, r: 1, g: 0.45 + R() * 0.25, b: 0.12, a: 0.75, drag: 1.2 });
      }
      if (R() < dt * 9) add.spawn({ x: x + (R() - 0.5) * 0.4, y: y + 0.4, z: z + (R() - 0.5) * 0.4, vx: (R() - 0.5) * 0.8, vy: 2 + R() * 2, vz: (R() - 0.5) * 0.8,
        life: 1.2 + R(), size: 0.05, stretch: 0.02, r: 1, g: 0.7, b: 0.3, a: 1, drag: 0.6, grav: -0.3 });
      if (R() < dt * 5 * intensity) nrm.spawn({ x: x + (R() - 0.5) * 0.3, y: y + 1.0, z: z + (R() - 0.5) * 0.3, vx: 0.25 + (R() - 0.5) * 0.3, vy: 1.1 + R() * 0.4, vz: 0.1,
        life: 4 + R() * 2, size: 0.5, size1: 2.6, cell: 1, r: 0.72, g: 0.72, b: 0.74, a: 0.32, drag: 0.15, rv: (R() - 0.5) * 0.5, fade: 1 });
    },
    torch(x, y, z, dt) {
      const n = dt * 16;
      for (let i = 0; i < n; i++) add.spawn({ x: x + (R() - 0.5) * 0.12, y, z: z + (R() - 0.5) * 0.12, vx: (R() - 0.5) * 0.3, vy: 0.9 + R() * 0.7, vz: (R() - 0.5) * 0.3,
        life: 0.35 + R() * 0.25, size: 0.32 + R() * 0.12, size1: 0.04, cell: 0, r: 1, g: 0.5 + R() * 0.2, b: 0.15, a: 0.8, drag: 1 });
      if (R() < dt * 4) add.spawn({ x, y: y + 0.2, z, vx: (R() - 0.5) * 0.6, vy: 1.5 + R(), vz: (R() - 0.5) * 0.6, life: 0.9, size: 0.04, stretch: 0.02, r: 1, g: 0.7, b: 0.3, a: 1, grav: -0.2 });
    },
    // elemental burst / bolt trail
    element(p, kind, n = 10, spread = 2) {
      const c = kind === 'frost' ? [0.6, 0.9, 1] : kind === 'storm' ? [0.85, 0.7, 1] : [1, 0.55, 0.18];
      for (let i = 0; i < n; i++) {
        const a = R() * 6.28, s = R() * spread;
        add.spawn({ x: p.x, y: p.y, z: p.z, vx: Math.cos(a) * s, vy: (R() - 0.3) * spread, vz: Math.sin(a) * s, life: 0.3 + R() * 0.4, size: 0.25 + R() * 0.25, size1: 0.02,
          cell: 0, r: c[0], g: c[1], b: c[2], a: 0.9, drag: 2 });
      }
    },
    update(dt) {
      add.update(dt); nrm.update(dt);
      for (const r of rings) {
        if (!r.m.visible) continue;
        r.t += dt; const u = r.t / r.dur;
        if (u >= 1) { r.m.visible = false; continue; }
        const s = r.r * (0.2 + 0.8 * (1 - (1 - u) * (1 - u)));
        r.m.scale.set(s, 1, s); r.m.material.opacity = (1 - u) * 0.8;
      }
    },
    makeIndicator() {
      const m = new THREE.SpriteMaterial({ map: texBang, transparent: true, depthWrite: false, depthTest: false, fog: false });
      const s = new THREE.Sprite(m); s.renderOrder = 20; s.visible = false; s.center.set(0.5, 0);
      return s;
    },
  };
  return fx;
}
