// Gameplay VFX: a pooled billboard particle system (additive + alpha variants sharing one
// procedural atlas), an animated painterly flame billboard, and twinkling forage sparkles.
// No per-frame allocations: particles live in preallocated typed arrays; only the live range
// of the instanced attributes is uploaded each frame.
import * as THREE from 'three';

// ---------------------------------------------------------------- atlas (4x1 cells)
// 0 soft round puff, 1 crisp ember dot, 2 four-point star glint, 3 wispy smoke curl
let atlas = null;
function getAtlas() {
  if (atlas) return atlas;
  const S = 128, cv = document.createElement('canvas'); cv.width = S * 4; cv.height = S;
  const g = cv.getContext('2d');
  // 0 puff
  let gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.65)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  // 1 ember
  gr = g.createRadialGradient(S * 1.5, S / 2, 0, S * 1.5, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.25)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(S, 0, S, S);
  // 2 star
  g.save(); g.translate(S * 2.5, S / 2);
  gr = g.createRadialGradient(0, 0, 0, 0, 0, S * 0.22);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, S * 0.22, 0, 7); g.fill();
  for (const r of [0, Math.PI / 2]) {
    g.save(); g.rotate(r);
    const lg = g.createLinearGradient(-S / 2, 0, S / 2, 0);
    lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, 'rgba(255,255,255,1)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = lg; g.beginPath(); g.moveTo(-S / 2, 0); g.lineTo(0, -S * 0.035); g.lineTo(S / 2, 0); g.lineTo(0, S * 0.035); g.fill();
    g.restore();
  }
  g.restore();
  // 3 smoke: clustered soft blobs
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4, r = S * 0.16 * Math.sqrt(i / 9);
    const x = S * 3.5 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r, rr = S * (0.3 - i * 0.015);
    gr = g.createRadialGradient(x, y, 0, x, y, rr);
    gr.addColorStop(0, 'rgba(255,255,255,0.42)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(S * 3, 0, S, S);
  }
  atlas = new THREE.CanvasTexture(cv);
  atlas.colorSpace = THREE.NoColorSpace;
  return atlas;
}

const P_VERT = /* glsl */`
#include <fog_pars_vertex>
attribute vec4 iPos;     // xyz, size
attribute vec4 iCol;     // rgba
attribute vec2 iMisc;    // cell, rotation
varying vec2 vUv; varying vec4 vCol; varying float vCell;
void main() {
  vec4 mv = viewMatrix * vec4(iPos.xyz, 1.0);
  float c = cos(iMisc.y), s = sin(iMisc.y);
  vec2 q = mat2(c, -s, s, c) * position.xy;
  mv.xy += q * iPos.w;
  gl_Position = projectionMatrix * mv;
  vUv = uv; vCol = iCol; vCell = iMisc.x;
  vec4 mvPosition = mv;
  #include <fog_vertex>
}`;
const P_FRAG = /* glsl */`
#include <fog_pars_fragment>
uniform sampler2D uAtlas; uniform float uAdd; uniform float uNight;
varying vec2 vUv; varying vec4 vCol; varying float vCell;
void main() {
  vec4 t = texture2D(uAtlas, vec2((vUv.x + vCell) * 0.25, vUv.y));
  float a = t.a * vCol.a;
  if (a < 0.003) discard;
  vec3 c = vCol.rgb;
  if (uAdd > 0.5) gl_FragColor = vec4(c * a, 1.0);
  else gl_FragColor = vec4(c, a);
  #include <fog_fragment>
}`;

export class Particles {
  constructor(ctx, { max = 512, additive = true, fog = true } = {}) {
    this.max = max; this.n = 0;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.age = new Float32Array(max);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max);
    this.c = new Float32Array(max * 4); this.a1 = new Float32Array(max);
    this.cell = new Float32Array(max); this.rot = new Float32Array(max); this.spin = new Float32Array(max);
    this.drag = new Float32Array(max); this.grav = new Float32Array(max); this.c2 = new Float32Array(max * 3);
    const g = new THREE.InstancedBufferGeometry();
    const q = new THREE.PlaneGeometry(1, 1);
    g.index = q.index; g.setAttribute('position', q.attributes.position); g.setAttribute('uv', q.attributes.uv);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aMisc = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iCol', this.aCol); g.setAttribute('iMisc', this.aMisc);
    g.instanceCount = 0;
    const m = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsLib.fog, uAtlas: { value: getAtlas() }, uAdd: { value: additive ? 1 : 0 }, uNight: { value: 0 } },
      vertexShader: P_VERT, fragmentShader: P_FRAG, transparent: true, depthWrite: false, fog: fog && !additive,
      blending: additive ? THREE.CustomBlending : THREE.NormalBlending,
    });
    if (additive) { m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneFactor; m.blendEquation = THREE.AddEquation; }
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 12 : 10;
    this.geo = g;
  }
  // o: {x,y,z, vx,vy,vz, life, size, size1, r,g,b,a, a1(end alpha mult), r2,g2,b2 (end colour), cell, rot, spin, drag, grav}
  spawn(o) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.p[i * 3] = o.x; this.p[i * 3 + 1] = o.y; this.p[i * 3 + 2] = o.z;
    this.v[i * 3] = o.vx || 0; this.v[i * 3 + 1] = o.vy || 0; this.v[i * 3 + 2] = o.vz || 0;
    this.life[i] = o.life || 1; this.age[i] = 0;
    this.s0[i] = o.size ?? 0.2; this.s1[i] = o.size1 ?? this.s0[i];
    this.c[i * 4] = o.r ?? 1; this.c[i * 4 + 1] = o.g ?? 1; this.c[i * 4 + 2] = o.b ?? 1; this.c[i * 4 + 3] = o.a ?? 1;
    this.c2[i * 3] = o.r2 ?? this.c[i * 4]; this.c2[i * 3 + 1] = o.g2 ?? this.c[i * 4 + 1]; this.c2[i * 3 + 2] = o.b2 ?? this.c[i * 4 + 2];
    this.a1[i] = o.a1 ?? 0;
    this.cell[i] = o.cell ?? 0; this.rot[i] = o.rot ?? Math.random() * 6.28; this.spin[i] = o.spin ?? 0;
    this.drag[i] = o.drag ?? 0; this.grav[i] = o.grav ?? 0;
  }
  _kill(i) {
    const j = --this.n;
    if (i === j) return;
    for (let k = 0; k < 3; k++) { this.p[i * 3 + k] = this.p[j * 3 + k]; this.v[i * 3 + k] = this.v[j * 3 + k]; this.c2[i * 3 + k] = this.c2[j * 3 + k]; }
    for (let k = 0; k < 4; k++) this.c[i * 4 + k] = this.c[j * 4 + k];
    this.life[i] = this.life[j]; this.age[i] = this.age[j]; this.s0[i] = this.s0[j]; this.s1[i] = this.s1[j];
    this.a1[i] = this.a1[j]; this.cell[i] = this.cell[j]; this.rot[i] = this.rot[j]; this.spin[i] = this.spin[j];
    this.drag[i] = this.drag[j]; this.grav[i] = this.grav[j];
  }
  update(dt, wind) {
    const P = this.aPos.array, C = this.aCol.array, M = this.aMisc.array;
    const wx = wind ? wind.x : 0, wz = wind ? wind.y : 0;
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { this._kill(i); i--; continue; }
      const d = Math.exp(-this.drag[i] * dt);
      this.v[i * 3] = this.v[i * 3] * d + wx * this.drag[i] * dt * 0.6;
      this.v[i * 3 + 1] = this.v[i * 3 + 1] * d - this.grav[i] * dt;
      this.v[i * 3 + 2] = this.v[i * 3 + 2] * d + wz * this.drag[i] * dt * 0.6;
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      this.rot[i] += this.spin[i] * dt;
    }
    for (let i = 0; i < this.n; i++) {
      const t = this.age[i] / this.life[i];
      P[i * 4] = this.p[i * 3]; P[i * 4 + 1] = this.p[i * 3 + 1]; P[i * 4 + 2] = this.p[i * 3 + 2];
      P[i * 4 + 3] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      const fade = Math.min(1, t * 8) * (1 - t * (1 - this.a1[i]));
      C[i * 4] = this.c[i * 4] + (this.c2[i * 3] - this.c[i * 4]) * t;
      C[i * 4 + 1] = this.c[i * 4 + 1] + (this.c2[i * 3 + 1] - this.c[i * 4 + 1]) * t;
      C[i * 4 + 2] = this.c[i * 4 + 2] + (this.c2[i * 3 + 2] - this.c[i * 4 + 2]) * t;
      C[i * 4 + 3] = this.c[i * 4 + 3] * fade * (1 - Math.pow(t, 3));
      M[i * 2] = this.cell[i]; M[i * 2 + 1] = this.rot[i];
    }
    this.geo.instanceCount = this.n;
    if (this.n) {
      this.aPos.clearUpdateRanges(); this.aPos.addUpdateRange(0, this.n * 4); this.aPos.needsUpdate = true;
      this.aCol.clearUpdateRanges(); this.aCol.addUpdateRange(0, this.n * 4); this.aCol.needsUpdate = true;
      this.aMisc.clearUpdateRanges(); this.aMisc.addUpdateRange(0, this.n * 2); this.aMisc.needsUpdate = true;
    }
  }
}

// ---------------------------------------------------------------- painterly flame billboard
// Y-axis aligned camera-facing quad; scrolling FBM tongues inside a teardrop mask with a
// white-gold core fading to orange-red edges. Additive. uIntensity drives size/brightness.
const F_VERT = /* glsl */`
uniform float uScale;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 centre = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 toCam = cameraPosition - centre; toCam.y = 0.0; toCam = normalize(toCam);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
  vec3 wp = centre + right * position.x * uScale + vec3(0.0, 1.0, 0.0) * (position.y + 0.5) * uScale;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;
const F_FRAG = /* glsl */`
uniform float uTime; uniform float uSeed; uniform float uIntensity; uniform vec3 uHot; uniform vec3 uMid; uniform vec3 uCool;
varying vec2 vUv;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * n(p); p = p * 2.03 + 1.7; a *= 0.5; } return s; }
void main() {
  vec2 uv = vUv; float t = uTime * 1.6 + uSeed * 10.0;
  float y = uv.y;
  // tongues: horizontal warp grows with height
  float warp = (fbm(vec2(uv.x * 3.0 + uSeed, y * 2.2 - t * 1.4)) - 0.5) * 0.55 * y;
  float x = (uv.x - 0.5 + warp) * 2.0;
  float width = mix(0.95, 0.0, pow(y, 0.85)) * (0.75 + 0.25 * sin(y * 3.0 + t));
  float body = 1.0 - smoothstep(width * 0.55, width, abs(x));
  float lick = fbm(vec2(x * 2.4 + uSeed, y * 3.4 - t * 2.6));
  float shape = body * smoothstep(0.0, 0.08, y) * smoothstep(1.0, 0.45, y + (1.0 - lick) * 0.55);
  float core = smoothstep(0.55, 1.0, shape) * (1.0 - smoothstep(0.1, 0.45, y));
  vec3 c = mix(uCool, uMid, smoothstep(0.05, 0.5, shape));
  c = mix(c, uHot, core);
  float a = smoothstep(0.02, 0.35, shape);
  gl_FragColor = vec4(c * a * uIntensity, 1.0);
}`;

export function makeFlame(ctx, { scale = 1, seed = 0, hot = 0xffe090, mid = 0xff7a14, cool = 0xc02a14 } = {}) {
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: ctx.uniforms.uTime, uScale: { value: scale }, uSeed: { value: seed }, uIntensity: { value: 1.7 },
      uHot: { value: new THREE.Color(hot) }, uMid: { value: new THREE.Color(mid) }, uCool: { value: new THREE.Color(cool) } },
    vertexShader: F_VERT, fragmentShader: F_FRAG, transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 1), m);
  mesh.frustumCulled = false; mesh.renderOrder = 11;
  return mesh;
}

// ---------------------------------------------------------------- forage sparkles
// One instanced quad per visible collectible; twinkle is animated entirely in the shader.
const S_VERT = /* glsl */`
#include <fog_pars_vertex>
attribute vec4 iPos;   // xyz, phase
uniform float uTime;
varying vec2 vUv; varying float vA;
void main() {
  vUv = uv;
  float ph = iPos.w;
  float cyc = fract(uTime * 0.33 + ph);
  float tw = smoothstep(0.0, 0.08, cyc) * (1.0 - smoothstep(0.08, 0.3, cyc));
  vec3 p = iPos.xyz + vec3(sin(ph * 40.0) * 0.12, 0.1 + cyc * 0.25, cos(ph * 33.0) * 0.12);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float d = -mv.z;
  float size = (0.12 + 0.25 * tw) * clamp(d / 8.0, 0.6, 2.5);
  float c = cos(uTime + ph * 6.0), s = sin(uTime + ph * 6.0);
  mv.xy += mat2(c, -s, s, c) * position.xy * size;
  vA = tw * (1.0 - smoothstep(30.0, 45.0, d)) + 0.12 * (1.0 - smoothstep(10.0, 30.0, d));
  gl_Position = projectionMatrix * mv;
  vec4 mvPosition = mv;
  #include <fog_vertex>
}`;
const S_FRAG = /* glsl */`
uniform sampler2D uAtlas;
varying vec2 vUv; varying float vA;
void main() {
  float a = texture2D(uAtlas, vec2((vUv.x + 2.0) * 0.25, vUv.y)).a * vA;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vec3(1.0, 0.95, 0.78) * a * 1.6, 1.0);
}`;
export class Sparkles {
  constructor(ctx, max = 256) {
    this.max = max;
    const g = new THREE.InstancedBufferGeometry();
    const q = new THREE.PlaneGeometry(1, 1);
    g.index = q.index; g.setAttribute('position', q.attributes.position); g.setAttribute('uv', q.attributes.uv);
    this.attr = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    g.setAttribute('iPos', this.attr); g.instanceCount = 0;
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: ctx.uniforms.uTime, uAtlas: { value: getAtlas() } },
      vertexShader: S_VERT, fragmentShader: S_FRAG, transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(g, m); this.mesh.frustumCulled = false; this.mesh.renderOrder = 13;
    this.geo = g;
  }
  set(list) {   // [{x,y,z,phase}]
    const A = this.attr.array; let n = 0;
    for (const s of list) { if (n >= this.max) break; A[n * 4] = s.x; A[n * 4 + 1] = s.y; A[n * 4 + 2] = s.z; A[n * 4 + 3] = s.phase; n++; }
    this.geo.instanceCount = n; this.attr.needsUpdate = true;
  }
}
