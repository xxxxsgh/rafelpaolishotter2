// Painterly toon materials for the hero: soft 2-3 band ramp with a wide terminator,
// cool blue-teal shade, warm key-side rim + bluish sky fill, inverted-hull ink outline.
// Works on SkinnedMesh (three injects USE_SKINNING) and on plain meshes, receives the
// sky system's shadow map and its patched fog chunks.

const VERT = /* glsl */`
#include <common>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <fog_pars_vertex>
attribute vec3 color;
#ifdef USE_TOON_UV
varying vec2 vUv;
#endif
varying vec3 vWorldPos;
varying vec3 vNormalW;
varying vec3 vColor;
void main() {
  #include <skinbase_vertex>
  #include <beginnormal_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
  vWorldPos = worldPosition.xyz;
  vNormalW = normalize(mat3(modelMatrix) * objectNormal);
  vColor = color;
  #ifdef USE_TOON_UV
  vUv = uv;
  #endif
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  vec3 transformedNormal = normalize(normalMatrix * objectNormal);
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
uniform vec3 uTint;        // damage flash etc. (added)
uniform float uRim;
uniform float uInk;        // fresnel ink for outline-less cloth
uniform float uSheen;      // fabric sheen
uniform float uShadowAmt;  // how much the sun shadow map darkens (soft on faces)
#ifdef USE_TOON_UV
uniform sampler2D uMap;
varying vec2 vUv;
#endif
varying vec3 vWorldPos;
varying vec3 vNormalW;
varying vec3 vColor;
float sat(float x) { return clamp(x, 0.0, 1.0); }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec3 N = normalize(vNormalW);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 albedo = vColor;
  #ifdef USE_TOON_UV
  albedo *= texture2D(uMap, vUv).rgb;
  #endif
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
  // soft 3-band ramp, wide terminator
  float ramp = smoothstep(-0.18, 0.22, ndl) * 0.6 + smoothstep(0.32, 0.7, ndl) * 0.4;
  float lit = ramp * mix(1.0, shadow, uShadowAmt);
  vec3 cool = mix(vec3(0.70, 0.86, 1.12), vec3(1.0), lit);
  vec3 col = albedo * (kc * lit * RECIPROCAL_PI * 1.05 + amb * cool * 0.95);
  // warm band near the terminator
  col += albedo * kc * RECIPROCAL_PI * 0.08 * smoothstep(0.0, 0.2, ndl) * (1.0 - smoothstep(0.2, 0.5, ndl)) * shadow * vec3(1.0, 0.6, 0.3);
  // fabric sheen (soft broad highlight)
  vec3 H = normalize(L + V);
  col += kc * RECIPROCAL_PI * uSheen * pow(sat(dot(N, H)), 8.0) * shadow * 0.25 * albedo;
  // rim: bright thin rim on the light side + faint cool rim all round
  float fres = 1.0 - sat(dot(N, V));
  float rimMask = smoothstep(0.55, 0.85, fres);
  float lightSide = sat(dot(N, L) * 0.6 + 0.5) * (0.4 + 0.6 * sat(-dot(V, L) * 0.5 + 0.6));
  col += uRim * rimMask * (kc * RECIPROCAL_PI * 0.55 * lightSide * mix(0.35, 1.0, shadow) + uSkyColor * 0.22);
  // wet darkening
  col *= 1.0 - uWetness * 0.18;
  // night: purkinje-ish cool desaturation (match terrain)
  float dayAmt = smoothstep(0.04, 0.3, luma(uSkyColor));
  col *= 0.6 + 0.4 * dayAmt;
  col = mix(vec3(luma(col)) * vec3(0.62, 0.78, 1.1), col, 0.35 + 0.65 * dayAmt);
  // fresnel ink on outline-less surfaces
  col = mix(col, col * vec3(0.18, 0.2, 0.26), uInk * smoothstep(0.78, 0.95, fres));
  col += uTint;
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
void main() {
  #include <skinbase_vertex>
  #include <beginnormal_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
  vec3 nW = normalize(mat3(modelMatrix) * objectNormal);
  float dist = length(cameraPosition - worldPosition.xyz);
  // constant-ish screen width, thinning out with distance so far figures stay clean
  float w = uWidth * clamp(dist, 1.5, 14.0) * (1.0 - smoothstep(25.0, 60.0, dist));
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
void main() {
  float day = smoothstep(0.04, 0.3, dot(uSkyColor, vec3(0.299, 0.587, 0.114)));
  gl_FragColor = vec4(uColor * (0.45 + 0.55 * day), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export function makeToonMaterial(ctx, { map = null, side = 0, rim = 1, ink = 0, sheen = 0.4, shadowAmt = 0.85 } = {}) {
  const { THREE, uniforms: U } = ctx;
  const uniforms = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.lights),
    ...THREE.UniformsLib.fog,
    uSunDir: U.uSunDir, uSunColor: U.uSunColor, uSkyColor: U.uSkyColor, uGroundColor: U.uGroundColor,
    uWetness: U.uWetness,
    uTint: { value: new THREE.Color(0, 0, 0) },
    uRim: { value: rim }, uInk: { value: ink }, uSheen: { value: sheen }, uShadowAmt: { value: shadowAmt },
    uMap: { value: map },
  };
  const m = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG, lights: true, fog: true, side,
    defines: map ? { USE_TOON_UV: '' } : {},
  });
  m.name = 'player-toon';
  return m;
}

export function makeOutlineMaterial(ctx, { width = 0.0022, color = 0x1b1c26 } = {}) {
  const { THREE, uniforms: U } = ctx;
  const m = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsLib.fog,
      uWidth: { value: width },
      uColor: { value: new THREE.Color(color) },
      uSkyColor: U.uSkyColor,
    },
    vertexShader: OUT_VERT, fragmentShader: OUT_FRAG, side: THREE.BackSide, fog: true,
  });
  m.name = 'player-outline';
  return m;
}
