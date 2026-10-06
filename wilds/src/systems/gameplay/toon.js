// Painterly toon material for gameplay props (forage, dishes, pots, campfires, spires, beacon).
// Same lighting language as the rest of the world: soft 3-band ramp with a wide terminator,
// cool blue-teal shade (never black), warm terminator glow, thin rim, low-frequency albedo
// breakup, night desaturation. Vertex attributes: color (rgb), emit (0..1 emissive amount).
// Works plain or instanced (instanceColor multiplies the vertex colour).
// uSway > 0 adds a gentle wind sway to vertices above the origin (herbs, flowers).

const VERT = /* glsl */`
#include <common>
#include <shadowmap_pars_vertex>
#include <fog_pars_vertex>
attribute vec3 color;
attribute float emit;
uniform float uTime;
uniform float uSway;
uniform vec2 uWindDir;
uniform float uWindStrength;
varying vec3 vWorldPos;
varying vec3 vNormalW;
varying vec3 vColor;
varying float vEmit;
void main() {
  vec3 transformed = position;
  vec3 objectNormal = normal;
  vec4 worldPosition = vec4(transformed, 1.0);
  vec3 nW = objectNormal;
  #ifdef USE_INSTANCING
    worldPosition = instanceMatrix * worldPosition;
    nW = mat3(instanceMatrix) * nW;
  #endif
  worldPosition = modelMatrix * worldPosition;
  if (uSway > 0.0) {
    vec3 org = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    #ifdef USE_INSTANCING
      org = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    #endif
    float hgt = max(0.0, worldPosition.y - org.y);
    float ph = dot(org.xz, vec2(0.37, 0.61));
    float s = sin(uTime * 2.3 + ph) * 0.6 + sin(uTime * 3.7 + ph * 1.7) * 0.4;
    worldPosition.xz += uWindDir * (s * 0.5 + 0.6) * uWindStrength * uSway * hgt * hgt;
  }
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
uniform float uRim;
uniform float uShadowAmt;
uniform vec3 uEmitColor;
uniform float uEmitBoost;
uniform vec3 uTint;
uniform vec3 uGlow;
varying vec3 vWorldPos;
varying vec3 vNormalW;
varying vec3 vColor;
varying float vEmit;
float sat(float x) { return clamp(x, 0.0, 1.0); }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float h31(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z);
}
void main() {
  vec3 N = normalize(vNormalW);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWorldPos);
  float pn = vnoise(vWorldPos * 1.3) - 0.5;
  vec3 albedo = vColor * (1.0 + pn * 0.14) * uTint;
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
  col += kc * RECIPROCAL_PI * 0.14 * pow(sat(dot(N, H)), 12.0) * shadow * albedo;
  float fres = 1.0 - sat(dot(N, V));
  float rimMask = smoothstep(0.55, 0.9, fres);
  float lightSide = sat(dot(N, L) * 0.6 + 0.5);
  col += uRim * rimMask * (kc * RECIPROCAL_PI * 0.45 * lightSide * mix(0.35, 1.0, shadow) + uSkyColor * 0.18);
  col *= 1.0 - uWetness * 0.15;
  float dayAmt = smoothstep(0.04, 0.3, luma(uSkyColor));
  col *= 0.6 + 0.4 * dayAmt;
  col = mix(vec3(luma(col)) * vec3(0.62, 0.78, 1.1), col, 0.35 + 0.65 * dayAmt);
  col += albedo * uGlow * (0.6 + 0.4 * sat(-N.y * 0.5 + 0.5));
  col = mix(col, vColor * uEmitColor * (1.4 + uEmitBoost), sat(vEmit));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const OUT_VERT = /* glsl */`
#include <common>
#include <fog_pars_vertex>
uniform float uWidth;
void main() {
  vec3 transformed = position;
  vec4 worldPosition = vec4(transformed, 1.0);
  vec3 nW = normal;
  #ifdef USE_INSTANCING
    worldPosition = instanceMatrix * worldPosition;
    nW = mat3(instanceMatrix) * nW;
  #endif
  worldPosition = modelMatrix * worldPosition;
  nW = normalize(mat3(modelMatrix) * nW);
  float dist = length(cameraPosition - worldPosition.xyz);
  worldPosition.xyz += nW * uWidth * clamp(dist, 1.0, 14.0) * (1.0 - smoothstep(25.0, 60.0, dist));
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
void main() {
  float day = smoothstep(0.04, 0.3, dot(uSkyColor, vec3(0.299, 0.587, 0.114)));
  gl_FragColor = vec4(uColor * (0.5 + 0.5 * day), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export function makeToon(ctx, { rim = 1, shadowAmt = 0.85, emitColor = 0xffffff, emitBoost = 0, sway = 0, side = 2 } = {}) {
  const { THREE, uniforms: U } = ctx;
  const m = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.lights),
      ...THREE.UniformsLib.fog,
      uSunDir: U.uSunDir, uSunColor: U.uSunColor, uSkyColor: U.uSkyColor, uGroundColor: U.uGroundColor,
      uWetness: U.uWetness, uTime: U.uTime, uWindDir: U.uWindDir, uWindStrength: U.uWindStrength,
      uRim: { value: rim }, uShadowAmt: { value: shadowAmt },
      uEmitColor: { value: new THREE.Color(emitColor) }, uEmitBoost: { value: emitBoost },
      uSway: { value: sway }, uTint: { value: new THREE.Color(1, 1, 1) }, uGlow: { value: new THREE.Color(0, 0, 0) },
    },
    vertexShader: VERT, fragmentShader: FRAG, lights: true, fog: true, side,
  });
  m.name = 'gameplay-toon';
  return m;
}

export function makeOutline(ctx, { width = 0.0022, color = 0x1d1a22 } = {}) {
  const { THREE, uniforms: U } = ctx;
  const m = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsLib.fog, uWidth: { value: width }, uColor: { value: new THREE.Color(color) }, uSkyColor: U.uSkyColor },
    vertexShader: OUT_VERT, fragmentShader: OUT_FRAG, side: THREE.BackSide, fog: true,
  });
  m.name = 'gameplay-outline';
  return m;
}

// Mesh + inverted-hull outline pair sharing a geometry.
export function toonMesh(ctx, geo, mat, outline, { shadow = true, receive = true } = {}) {
  const { THREE } = ctx;
  const g = new THREE.Group();
  const m = new THREE.Mesh(geo, mat); m.castShadow = shadow; m.receiveShadow = receive;
  g.add(m);
  if (outline) { const o = new THREE.Mesh(geo, outline); o.raycast = () => {}; g.add(o); }
  g.userData.mesh = m;
  return g;
}
