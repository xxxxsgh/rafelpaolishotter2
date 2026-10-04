// Painterly material for rocks, boulders, standing stones and ruins (supports instancing
// and vertex colours). Same light model + atmosphere as the terrain.
import { PAINT_PARS, sharedUniforms } from './shading.js';

const VERT = /* glsl */`
#include <common>
#include <shadowmap_pars_vertex>
#include <fog_pars_vertex>
attribute vec3 color;
varying vec3 vWorldPos;
varying vec3 vNormalW;
varying vec3 vColor;
varying vec3 vLocal;
varying float vGround;
uniform float uGroundBlend;
void main() {
  vec3 p = position;
  vec3 nrm = normal;
  mat4 m = modelMatrix;
  #ifdef USE_INSTANCING
    m = modelMatrix * instanceMatrix;
  #endif
  vec4 worldPosition = m * vec4(p, 1.0);
  vWorldPos = worldPosition.xyz;
  vNormalW = normalize(mat3(m) * nrm);
  vColor = color;
  vLocal = p;
  #ifdef USE_INSTANCING
    vGround = clamp(1.0 - (p.y + 0.6) / 1.6, 0.0, 1.0);
  #else
    vGround = 0.0;
  #endif
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
${PAINT_PARS}
uniform vec3 cStone, cStoneDark, cMoss, cLichen;
uniform float uMossAmt;
uniform float uStrata;
varying vec3 vWorldPos;
varying vec3 vNormalW;
varying vec3 vColor;
varying vec3 vLocal;
varying float vGround;

void main() {
  vec3 wp = vWorldPos;
  vec3 N = normalize(vNormalW);
  float dist = length(wp - cameraPosition);
  float detailFade = 1.0 - smoothstep(60.0, 400.0, dist);
  vec3 tw = pow(abs(N), vec3(4.0)); tw /= (tw.x + tw.y + tw.z);
  vec4 nA = texture2D(uNoise, wp.zy / 7.0) * tw.x + texture2D(uNoise, wp.xz / 7.0) * tw.y + texture2D(uNoise, wp.xy / 7.0) * tw.z;
  vec4 nB = texture2D(uNoise, wp.zy / 1.7) * tw.x + texture2D(uNoise, wp.xz / 1.7) * tw.y + texture2D(uNoise, wp.xy / 1.7) * tw.z;
  vec4 nM = texture2D(uNoise, wp.xz / 90.0);

  vec3 stone = mix(cStone, cStoneDark, smoothstep(0.3, 0.8, nA.r) * 0.6);
  stone *= vColor;
  // soft strata on natural rock
  float band = fract(wp.y / 1.6 + nA.a * 1.4);
  stone *= 1.0 - uStrata * 0.12 * smoothstep(0.85, 1.0, band);
  stone *= 0.92 + 0.16 * mix(0.5, nB.g, detailFade);
  // weathering streaks running down vertical faces
  float streak = texture2D(uNoise, vec2(wp.x + wp.z, wp.y * 0.08) / 3.0).g;
  stone *= 1.0 - (1.0 - tw.y) * smoothstep(0.55, 0.85, streak) * 0.18;
  // cracks
  stone *= 1.0 - smoothstep(0.6, 0.92, nA.b) * 0.3 * detailFade;
  // lichen patches (warm yellow-white) and moss (green) on up-facing / sheltered surfaces
  float lich = smoothstep(0.68, 0.8, nB.a + nA.g * 0.3) * 0.5;
  stone = mix(stone, cLichen, lich * 0.45);
  float up = smoothstep(0.35, 0.85, N.y + (nA.g - 0.5) * 0.6);
  float moss = sat(up * smoothstep(0.35, 0.65, nA.r + nM.r * 0.4) + vGround * 0.6 * smoothstep(0.4, 0.6, nB.r)) * uMossAmt;
  vec3 mossCol = cMoss * (0.8 + 0.4 * nB.g);
  vec3 albedo = mix(stone, mossCol, sat(moss));
  albedo *= 1.0 - uWetness * 0.35;

  float shadow = getShadowMask();
  float ao = mix(1.0, 0.6, vGround) * (0.85 + 0.15 * N.y);
  vec3 col = paintLight(albedo, N, shadow, ao, 0.05);
  vec3 L, kc; paintKeyLight(L, kc);
  vec3 V = normalize(cameraPosition - wp);
  col += kc * pow(sat(dot(reflect(-L, N), V)), 30.0) * uWetness * 0.2 * shadow * RECIPROCAL_PI;
  #ifndef USE_FOG
  col = paintFog(col, wp);
  #endif
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export function makePropMaterial(ctx, noiseTex, { kind = 'rock' } = {}) {
  const { THREE } = ctx;
  const ruin = kind === 'ruin';
  const uniforms = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.lights),
    ...THREE.UniformsLib.fog,
    ...sharedUniforms(ctx, THREE, noiseTex),
    cStone: { value: new THREE.Color(ruin ? 0xcdbb98 : 0xa49c8e) },
    cStoneDark: { value: new THREE.Color(ruin ? 0xa08d6e : 0x7c766e) },
    cMoss: { value: new THREE.Color(0x6f9a3a) },
    cLichen: { value: new THREE.Color(0xd8d0a8) },
    uMossAmt: { value: ruin ? 1.0 : 0.85 },
    uStrata: { value: ruin ? 0.0 : 1.0 },
    uGroundBlend: { value: 0 },
  };
  const m = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, lights: true, fog: true });
  m.name = 'terrain-prop-' + kind;
  return m;
}
