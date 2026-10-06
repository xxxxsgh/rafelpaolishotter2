// Shared GLSL + helpers for every vegetation material: painterly foliage lighting,
// the global wind/gust field (identical to the terrain sheen so ground and grass
// gust together), hashing, and a tileable noise texture fallback.
import * as THREE from 'three';
import { mulberry32 } from '../../core/noise.js';

// Uniform objects shared with the engine (reference, never copy).
export function vegUniforms(ctx, noiseTex) {
  const u = ctx.uniforms;
  if (!u.uSnow) u.uSnow = { value: 0 };   // sky writes it (snow cover 0..1); create early so we share the object
  return {
    uTime: u.uTime, uWindDir: u.uWindDir, uWindStrength: u.uWindStrength,
    uSunDir: u.uSunDir, uSunColor: u.uSunColor, uSkyColor: u.uSkyColor, uGroundColor: u.uGroundColor,
    uFogColor: u.uFogColor, uWetness: u.uWetness, uRain: u.uRain, uSnow: u.uSnow, uPlayerPos: u.uPlayerPos,
    uNoise: { value: noiseTex },
  };
}

export const VEG_COMMON = /* glsl */`
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uGroundColor;
uniform vec3 uFogColor;
uniform float uWetness;
uniform float uRain;
uniform float uSnow;
uniform vec3 uPlayerPos;
uniform sampler2D uNoise;

float vsat(float x) { return clamp(x, 0.0, 1.0); }
float vluma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float vhash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vhash1(float n) { return fract(sin(n) * 43758.5453123); }
vec3 vhueShift(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}
// Rolling gust field (0..1). Same field + speed as the terrain grass sheen.
float vegGust(vec2 p) {
  vec2 gp = p - uWindDir * uTime * 7.0;
  return texture(uNoise, gp / 160.0).r * 0.65 + texture(uNoise, gp / 47.0 + 0.3).g * 0.35;
}
// gust -> bend strength (big waves), includes base sway level
float vegGustBend(float g) { return 0.25 + 1.25 * smoothstep(0.42, 0.82, g); }
`;

// Lighting for foliage. Must be used in shaders compiled with lights:true.
export const VEG_LIGHT = /* glsl */`
void vegKeyLight(out vec3 L, out vec3 col) {
  #if NUM_DIR_LIGHTS > 0
    L = normalize(inverseTransformDirection(directionalLights[0].direction, viewMatrix));
    col = directionalLights[0].color;
  #else
    L = normalize(uSunDir);
    col = uSunColor * 3.0 * smoothstep(-0.05, 0.1, uSunDir.y);
  #endif
}
vec3 vegAmbient(vec3 N) {
  vec3 amb = vec3(0.0);
  #if NUM_HEMI_LIGHTS > 0
    vec3 Nv = normalize((viewMatrix * vec4(N, 0.0)).xyz);
    for (int i = 0; i < NUM_HEMI_LIGHTS; i++) amb += getHemisphereLightIrradiance(hemisphereLights[i], Nv);
  #else
    amb = mix(uGroundColor, uSkyColor, N.y * 0.5 + 0.5) * 1.2;
  #endif
  amb += ambientLightColor;
  return amb;
}
float vegRamp(float ndl) {
  return smoothstep(-0.15, 0.35, ndl) * 0.6 + smoothstep(0.3, 0.9, ndl) * 0.4;
}
// albedo linear; shadow visibility; ao; trans = translucency amount; V = view dir (to camera)
vec3 vegLight(vec3 albedo, vec3 N, vec3 V, float shadow, float ao, float trans, float wrap) {
  vec3 L, kc; vegKeyLight(L, kc);
  float ndl = dot(N, L);
  float lit = vegRamp(ndl + wrap) * shadow;
  vec3 amb = max(vegAmbient(N), uSkyColor * 0.75 + uGroundColor * 0.25) * ao;
  // luminous cool-teal shade
  vec3 coolTint = mix(vec3(0.72, 0.9, 1.12), vec3(1.0), lit);
  vec3 c = albedo * (kc * lit * RECIPROCAL_PI + amb * coolTint * 0.95);
  // warm band near the terminator
  c += albedo * RECIPROCAL_PI * kc * 0.07 * smoothstep(0.0, 0.25, ndl) * (1.0 - smoothstep(0.25, 0.6, ndl)) * shadow * vec3(1.0, 0.75, 0.4);
  // sub-surface: light passing through leaves/blades toward the viewer
  float back = pow(vsat(dot(-V, L)), 3.0);
  vec3 sss = albedo * vec3(0.85, 1.1, 0.5) * kc * RECIPROCAL_PI * trans * (0.18 + 1.1 * back) * (0.35 + 0.65 * shadow);
  c += sss * vsat(L.y * 4.0 + 0.2);
  float dayAmt = smoothstep(0.04, 0.3, vluma(uSkyColor));
  c *= 0.55 + 0.45 * dayAmt;
  c = mix(vec3(vluma(c)) * vec3(0.62, 0.78, 1.1), c, 0.3 + 0.7 * dayAmt);
  return c;
}
`;

// Tileable RGBA value-noise texture (same channel semantics as the terrain noise).
export function makeNoiseTexture(size = 256, seed = 777) {
  const rand = mulberry32(seed);
  const periods = [4, 8, 16, 32, 64, 128];
  const lat = periods.map(P => [0, 1, 2, 3].map(() => { const a = new Float32Array(P * P); for (let i = 0; i < a.length; i++) a[i] = rand() * 2 - 1; return a; }));
  const vn = (l, P, x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % P) + P) % P, y0 = ((yi % P) + P) % P, x1 = (x0 + 1) % P, y1 = (y0 + 1) % P;
    const a = l[y0 * P + x0], b = l[y0 * P + x1], c = l[y1 * P + x0], d = l[y1 * P + x1];
    return a + (b - a) * ux + (c - a + (a - b + d - c) * ux) * uy;
  };
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const u = i / size, v = j / size, k = (j * size + i) * 4;
    for (let c = 0; c < 4; c++) {
      let s = 0, amp = 1, n = 0;
      const o0 = c === 1 ? 2 : 0;
      for (let o = o0; o < periods.length; o++) { s += amp * vn(lat[o][c], periods[o], u * periods[o], v * periods[o]); n += amp; amp *= 0.55; }
      data[k + c] = Math.max(0, Math.min(255, (s / n * 0.5 + 0.5) * 255));
    }
  }
  for (let c = 0; c < 4; c++) {
    let lo = 255, hi = 0;
    for (let k = c; k < data.length; k += 4) { lo = Math.min(lo, data[k]); hi = Math.max(hi, data[k]); }
    const sc = 255 / Math.max(1, hi - lo);
    for (let k = c; k < data.length; k += 4) data[k] = (data[k] - lo) * sc;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
  return t;
}
