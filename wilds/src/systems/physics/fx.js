// GPU billboard particles for physics FX: flames, smoke, embers, explosion flash, dust,
// glyph motes, splinters. Two instanced draws (additive + alpha), fixed pools, no allocs.
import * as THREE from 'three';

export const FX = { FLAME: 0, EMBER: 1, FLASH: 2, MOTE: 3, SPARK: 4, SMOKE: 10, DUST: 11, DEBRIS: 12, STEAM: 13 };

const VERT = /* glsl */`
#include <common>
#include <fog_pars_vertex>
attribute vec4 aPos;     // xyz, size
attribute vec4 aData;    // type, life01, seed, rot
attribute vec4 aCol;     // rgb, alpha
varying vec2 vUv;
varying vec4 vData;
varying vec4 vCol;
void main() {
  vUv = position.xy + 0.5;
  vData = aData; vCol = aCol;
  vec4 mv = viewMatrix * vec4(aPos.xyz, 1.0);
  float r = aData.w;
  vec2 q = position.xy;
  q = vec2(q.x * cos(r) - q.y * sin(r), q.x * sin(r) + q.y * cos(r));
  // flames stretch upward
  if (aData.x < 0.5) q.y *= 1.5;
  mv.xy += q * aPos.w;
  gl_Position = projectionMatrix * mv;
  vec4 mvPosition = mv;
  #include <fog_vertex>
}
`;
const FRAG = /* glsl */`
#include <common>
#include <fog_pars_fragment>
uniform float uTime;
uniform float uAdd;
varying vec2 vUv;
varying vec4 vData;
varying vec4 vCol;
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1, 0)), f.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec2 p = vUv - 0.5;
  float t = vData.y, type = vData.x, seed = vData.z;
  float a = 0.0; vec3 c = vCol.rgb;
  if (type < 0.5) {            // flame: teardrop with noisy edge, white-yellow core
    vec2 q = p; q.y += 0.12;
    float n = vn(vec2(p.x * 5.0 + seed * 13.0, p.y * 4.0 - uTime * 3.5 - seed * 7.0));
    float shape = length(vec2(q.x * (1.6 + q.y * 1.8), q.y * 0.9));
    float f = 1.0 - smoothstep(0.18, 0.42, shape + (n - 0.5) * 0.25);
    float core = 1.0 - smoothstep(0.05, 0.28, shape + (n - 0.5) * 0.1);
    c = mix(vCol.rgb * mix(1.0, 0.55, smoothstep(0.3, 1.0, t)), vec3(1.0, 0.85, 0.5), core * (1.0 - t));
    a = f * (1.0 - t) * smoothstep(0.0, 0.12, t);
    c *= 1.5;
  } else if (type < 1.5 || type > 3.5 && type < 4.5) {  // ember / spark
    float d = length(p);
    a = (1.0 - smoothstep(0.05, 0.5, d)) * (1.0 - t);
    c *= 2.5;
  } else if (type < 2.5) {     // flash
    float d = length(p);
    a = pow(1.0 - smoothstep(0.0, 0.5, d), 2.0) * (1.0 - t) * (1.0 - t);
    c *= 3.0;
  } else if (type < 3.5) {     // glyph mote (soft diamond)
    float d = abs(p.x) + abs(p.y);
    a = (1.0 - smoothstep(0.1, 0.5, d)) * sin(t * 3.14159);
    c *= 2.0;
  } else {                      // smoke / dust / steam: soft noisy puff
    float n = vn(p * 4.0 + seed * 17.0 + vec2(0.0, -uTime * 0.2)) * 0.6 + vn(p * 9.0 - seed * 5.0) * 0.4;
    float d = length(p) + (n - 0.5) * 0.25;
    a = (1.0 - smoothstep(0.15, 0.48, d)) * smoothstep(0.0, 0.15, t) * (1.0 - t);
    if (type > 11.5 && type < 12.5) { a = step(abs(p.x), 0.18) * step(abs(p.y), 0.42) * (1.0 - smoothstep(0.8, 1.0, t)); }
    c *= 0.85 + 0.3 * n;
  }
  a *= vCol.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(c * (uAdd > 0.5 ? a : 1.0), uAdd > 0.5 ? a : a);
  #include <fog_fragment>
}
`;

export class Particles {
  constructor(ctx, max = 1400) {
    this.ctx = ctx;
    this.add = this._make(true, max);
    this.alpha = this._make(false, Math.floor(max * 0.6));
  }
  _make(additive, max) {
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const aData = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const aCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPos', aPos); geo.setAttribute('aData', aData); geo.setAttribute('aCol', aCol);
    geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsLib.fog, uTime: this.ctx.uniforms.uTime, uAdd: { value: additive ? 1 : 0 } },
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, fog: true,
      blending: additive ? THREE.CustomBlending : THREE.NormalBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    if (additive) { mat.blendSrc = THREE.OneFactor; mat.blendDst = THREE.OneFactor; mat.blendEquation = THREE.AddEquation; }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = additive ? 12 : 11;
    this.ctx.scene.add(mesh);
    // CPU state
    const P = {
      mesh, geo, max, n: 0,
      pos: new Float32Array(max * 3), vel: new Float32Array(max * 3),
      size: new Float32Array(max), grow: new Float32Array(max), life: new Float32Array(max), age: new Float32Array(max),
      type: new Uint8Array(max), seed: new Float32Array(max), rot: new Float32Array(max), spin: new Float32Array(max),
      col: new Float32Array(max * 4), drag: new Float32Array(max), grav: new Float32Array(max),
      aPos, aData, aCol,
    };
    return P;
  }
  emit(type, x, y, z, vx = 0, vy = 0, vz = 0, size = 1, life = 1, r = 1, g = 1, b = 1, a = 1, o = {}) {
    const P = type >= 10 ? this.alpha : this.add;
    if (P.n >= P.max) return;
    const i = P.n++;
    P.pos[i * 3] = x; P.pos[i * 3 + 1] = y; P.pos[i * 3 + 2] = z;
    P.vel[i * 3] = vx; P.vel[i * 3 + 1] = vy; P.vel[i * 3 + 2] = vz;
    P.size[i] = size; P.grow[i] = o.grow ?? (type >= 10 ? 1.2 : -0.3);
    P.life[i] = life; P.age[i] = 0; P.type[i] = type; P.seed[i] = Math.random();
    P.rot[i] = Math.random() * 6.28; P.spin[i] = o.spin ?? (Math.random() - 0.5) * (type >= 10 ? 0.6 : 0.2);
    P.col[i * 4] = r; P.col[i * 4 + 1] = g; P.col[i * 4 + 2] = b; P.col[i * 4 + 3] = a;
    P.drag[i] = o.drag ?? (type >= 10 ? 0.6 : 0.3);
    P.grav[i] = o.grav ?? (type === FX.EMBER || type === FX.SPARK || type === FX.DEBRIS ? -9 : 0);
  }
  update(dt) { this._upd(this.add, dt); this._upd(this.alpha, dt); }
  _upd(P, dt) {
    let n = P.n;
    for (let i = 0; i < n; i++) {
      P.age[i] += dt;
      if (P.age[i] >= P.life[i]) {
        // swap-remove
        n--;
        if (i !== n) {
          for (let k = 0; k < 3; k++) { P.pos[i * 3 + k] = P.pos[n * 3 + k]; P.vel[i * 3 + k] = P.vel[n * 3 + k]; }
          for (let k = 0; k < 4; k++) P.col[i * 4 + k] = P.col[n * 4 + k];
          P.size[i] = P.size[n]; P.grow[i] = P.grow[n]; P.life[i] = P.life[n]; P.age[i] = P.age[n]; P.type[i] = P.type[n];
          P.seed[i] = P.seed[n]; P.rot[i] = P.rot[n]; P.spin[i] = P.spin[n]; P.drag[i] = P.drag[n]; P.grav[i] = P.grav[n];
          i--;
        }
        continue;
      }
      const d = Math.exp(-P.drag[i] * dt);
      P.vel[i * 3] *= d; P.vel[i * 3 + 1] = P.vel[i * 3 + 1] * d + P.grav[i] * dt; P.vel[i * 3 + 2] *= d;
      P.pos[i * 3] += P.vel[i * 3] * dt; P.pos[i * 3 + 1] += P.vel[i * 3 + 1] * dt; P.pos[i * 3 + 2] += P.vel[i * 3 + 2] * dt;
      P.size[i] = Math.max(0.01, P.size[i] + P.grow[i] * dt);
      P.rot[i] += P.spin[i] * dt;
    }
    P.n = n;
    const ap = P.aPos.array, ad = P.aData.array, ac = P.aCol.array;
    for (let i = 0; i < n; i++) {
      ap[i * 4] = P.pos[i * 3]; ap[i * 4 + 1] = P.pos[i * 3 + 1]; ap[i * 4 + 2] = P.pos[i * 3 + 2]; ap[i * 4 + 3] = P.size[i];
      ad[i * 4] = P.type[i]; ad[i * 4 + 1] = P.age[i] / P.life[i]; ad[i * 4 + 2] = P.seed[i]; ad[i * 4 + 3] = P.rot[i];
      ac[i * 4] = P.col[i * 4]; ac[i * 4 + 1] = P.col[i * 4 + 1]; ac[i * 4 + 2] = P.col[i * 4 + 2]; ac[i * 4 + 3] = P.col[i * 4 + 3];
    }
    P.geo.instanceCount = n;
    if (n) {
      P.aPos.needsUpdate = true; P.aData.needsUpdate = true; P.aCol.needsUpdate = true;
      P.aPos.clearUpdateRanges?.(); P.aPos.addUpdateRange?.(0, n * 4);
      P.aData.clearUpdateRanges?.(); P.aData.addUpdateRange?.(0, n * 4);
      P.aCol.clearUpdateRanges?.(); P.aCol.addUpdateRange?.(0, n * 4);
    }
  }
}
