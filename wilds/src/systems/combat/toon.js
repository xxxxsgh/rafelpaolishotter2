// Painterly toon shading for enemies, weapons and camp props.
// Same lighting language as the hero (soft 3-band ramp, cool teal shade, warm rim) plus:
//   - per-vertex emissive (attribute `emit`) for eyes, runes, embers, wisp cores
//   - uFlash  : additive hit flash / low-durability pulse
//   - uDissolve: noisy burn-away (0 = solid, 1 = gone) with a hot rim, for death puffs
//   - works skinned (rigid-weighted creature rigs), instanced (palisades, stakes) or plain
// Shadow sides are blue-teal, never black; the night grade matches terrain/hero.

const VERT = /* glsl */`
#include <common>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <fog_pars_vertex>
attribute vec3 color;
attribute float emit;
varying vec3 vWorldPos;
varying vec3 vNormalW;
varying vec3 vColor;
varying float vEmit;
varying vec3 vObj;
void main() {
  #include <skinbase_vertex>
  #include <beginnormal_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  vObj = position;
  vec4 worldPosition = vec4(transformed, 1.0);
  vec3 nW = objectNormal;
  #ifdef USE_INSTANCING
    worldPosition = instanceMatrix * worldPosition;
    nW = mat3(instanceMatrix) * nW;
  #endif
  worldPosition = modelMatrix * worldPosition;
  vWorldPos = worldPosition.xyz;
  vNormalW = normalize(mat3(modelMatrix) * nW);
  vColor = color;
  #ifdef USE_INSTANCING_COLOR
    vColor *= instanceColor;
  #endif
  vEmit = emit;
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  vec3 transformedNormal = normalize(mat3(viewMatrix) * vNormalW);
  #include <shadowmap_vertex>
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */`
#include <common>
#include <packing>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
#include <fog_pars_fragment>
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uGroundColor;
uniform float uWetness;
uniform float uTime;
uniform vec3 uFlash;
uniform float uDissolve;
uniform float uRim;
uniform float uShadowAmt;
uniform float uEmitBoost;
uniform vec3 uEmitColor;
uniform vec4 uFire;          // nearest campfire: xyz position, w intensity (warm local light)
varying vec3 vWorldPos;
varying vec3 vNormalW;
varying vec3 vColor;
varying float vEmit;
varying vec3 vObj;
float sat(float x) { return clamp(x, 0.0, 1.0); }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float h31(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z);
}
void main() {
  float burnEdge = 0.0;
  // negative emit = ragged cut-out mask (ground decals): discard where mask + noise passes 1
  if (vEmit < 0.0) {
    float n = vnoise(vWorldPos * 0.45) * 0.6 + vnoise(vWorldPos * 1.7) * 0.4;
    if (-vEmit + n * 0.55 > 1.0) discard;
  }
  if (uDissolve > 0.0) {
    float n = vnoise(vObj * 7.0) * 0.65 + vnoise(vObj * 19.0) * 0.35;
    float th = uDissolve * 1.15 - 0.05;
    if (n < th) discard;
    burnEdge = 1.0 - smoothstep(0.0, 0.09, n - th);
  }
  vec3 N = normalize(vNormalW);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWorldPos);
  // low-frequency painterly albedo breakup (hue/value drift across a surface)
  float pn = vnoise(vWorldPos * 0.9) - 0.5;
  vec3 albedo = vColor * (1.0 + pn * 0.16);
  vec3 L; vec3 kc;
  #if NUM_DIR_LIGHTS > 0
    L = normalize(inverseTransformDirection(directionalLights[0].direction, viewMatrix));
    kc = directionalLights[0].color;
  #else
    L = normalize(uSunDir); kc = uSunColor * 3.0;
  #endif
  vec3 amb = ambientLightColor;
  #if NUM_HEMI_LIGHTS > 0
    vec3 Nv = normalize((viewMatrix * vec4(N, 0.0)).xyz);
    for (int i = 0; i < NUM_HEMI_LIGHTS; i++) amb += getHemisphereLightIrradiance(hemisphereLights[i], Nv);
  #else
    amb += mix(uGroundColor, uSkyColor, N.y * 0.5 + 0.5);
  #endif
  amb = max(amb, uSkyColor * 0.7 + uGroundColor * 0.2);
  float shadow = getShadowMask();
  float ndl = dot(N, L);
  float ramp = smoothstep(-0.2, 0.25, ndl) * 0.6 + smoothstep(0.35, 0.75, ndl) * 0.4;
  float lit = ramp * mix(1.0, shadow, uShadowAmt);
  vec3 cool = mix(vec3(0.68, 0.86, 1.12), vec3(1.0), lit);
  vec3 col = albedo * (kc * lit * RECIPROCAL_PI * 1.05 + amb * cool * 0.95);
  col += albedo * kc * RECIPROCAL_PI * 0.08 * smoothstep(0.0, 0.2, ndl) * (1.0 - smoothstep(0.2, 0.5, ndl)) * shadow * vec3(1.0, 0.6, 0.3);
  vec3 H = normalize(L + V);
  col += kc * RECIPROCAL_PI * 0.12 * pow(sat(dot(N, H)), 10.0) * shadow * albedo;
  float fres = 1.0 - sat(dot(N, V));
  float rimMask = smoothstep(0.55, 0.88, fres);
  float lightSide = sat(dot(N, L) * 0.6 + 0.5) * (0.4 + 0.6 * sat(-dot(V, L) * 0.5 + 0.6));
  col += uRim * rimMask * (kc * RECIPROCAL_PI * 0.5 * lightSide * mix(0.35, 1.0, shadow) + uSkyColor * 0.2);
  col *= 1.0 - uWetness * 0.15;
  float dayAmt = smoothstep(0.04, 0.3, luma(uSkyColor));
  col *= 0.6 + 0.4 * dayAmt;
  col = mix(vec3(luma(col)) * vec3(0.62, 0.78, 1.1), col, 0.35 + 0.65 * dayAmt);
  // campfire light: warm wrap-lit falloff, strongest at night
  if (uFire.w > 0.0) {
    vec3 fd = uFire.xyz - vWorldPos;
    float fdist = length(fd);
    float fall = max(0.0, 1.0 - fdist / 10.0); fall *= fall;
    float wrapL = 0.35 + 0.65 * max(dot(N, fd / max(fdist, 1e-3)), 0.0);
    col += albedo * vec3(1.0, 0.52, 0.2) * uFire.w * fall * wrapL * (1.15 - 0.85 * dayAmt);
  }
  // emissive (eyes, runes, embers) — survives night
  col = mix(col, vColor * uEmitColor * (1.4 + uEmitBoost), sat(vEmit) * min(1.0, 0.85 + uEmitBoost));
  col += uFlash;
  col = mix(col, vec3(1.0, 0.55, 0.2) * 2.5, burnEdge);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const OUT_VERT = /* glsl */`
#include <common>
#include <skinning_pars_vertex>
#include <fog_pars_vertex>
uniform float uWidth;
varying vec3 vObj;
void main() {
  #include <skinbase_vertex>
  #include <beginnormal_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  vObj = position;
  vec4 worldPosition = vec4(transformed, 1.0);
  vec3 nW = objectNormal;
  #ifdef USE_INSTANCING
    worldPosition = instanceMatrix * worldPosition;
    nW = mat3(instanceMatrix) * nW;
  #endif
  worldPosition = modelMatrix * worldPosition;
  nW = normalize(mat3(modelMatrix) * nW);
  float dist = length(cameraPosition - worldPosition.xyz);
  float w = uWidth * clamp(dist, 1.5, 16.0) * (1.0 - smoothstep(30.0, 80.0, dist));
  worldPosition.xyz += nW * w;
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  gl_Position.z += 0.00002 * gl_Position.w;
  #include <fog_vertex>
}
`;
const OUT_FRAG = /* glsl */`
#include <common>
#include <fog_pars_fragment>
uniform vec3 uColor;
uniform vec3 uSkyColor;
uniform float uDissolve;
varying vec3 vObj;
float h31(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z);
}
void main() {
  if (uDissolve > 0.0) {
    float n = vnoise(vObj * 7.0) * 0.65 + vnoise(vObj * 19.0) * 0.35;
    if (n < uDissolve * 1.15 + 0.02) discard;
  }
  float day = smoothstep(0.04, 0.3, dot(uSkyColor, vec3(0.299, 0.587, 0.114)));
  gl_FragColor = vec4(uColor * (0.45 + 0.55 * day), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export const fireLight = { value: null };
export function makeToon(ctx, { rim = 1, shadowAmt = 0.85, emitColor = 0xffffff, side = 0 } = {}) {
  const { THREE, uniforms: U } = ctx;
  const m = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.lights),
      ...THREE.UniformsLib.fog,
      uSunDir: U.uSunDir, uSunColor: U.uSunColor, uSkyColor: U.uSkyColor, uGroundColor: U.uGroundColor,
      uWetness: U.uWetness, uTime: U.uTime,
      uFlash: { value: new THREE.Color(0, 0, 0) },
      uDissolve: { value: 0 },
      uRim: { value: rim }, uShadowAmt: { value: shadowAmt },
      uEmitBoost: { value: 0 }, uEmitColor: { value: new THREE.Color(emitColor) },
      uFire: fireLight.value ? fireLight : (fireLight.value = new THREE.Vector4(0, -1e4, 0, 0), fireLight),
    },
    vertexShader: VERT, fragmentShader: FRAG, lights: true, fog: true, side,
  });
  m.name = 'combat-toon';
  return m;
}

export function makeOutline(ctx, { width = 0.0024, color = 0x1d1a22, dissolve = null } = {}) {
  const { THREE, uniforms: U } = ctx;
  const m = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsLib.fog,
      uWidth: { value: width },
      uColor: { value: new THREE.Color(color) },
      uSkyColor: U.uSkyColor,
      uDissolve: dissolve || { value: 0 },
    },
    vertexShader: OUT_VERT, fragmentShader: OUT_FRAG, side: THREE.BackSide, fog: true,
  });
  m.name = 'combat-outline';
  return m;
}
