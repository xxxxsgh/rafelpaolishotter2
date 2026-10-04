// Terrain shader: CDLOD geomorph + painterly triplanar material blend + toon light + fog.
import { PAINT_PARS, sharedUniforms } from './shading.js';
import { TERRAIN_PALETTE as P } from '../../world/heightfield.js';

const VERT = /* glsl */`
#include <common>
#include <shadowmap_pars_vertex>
#include <fog_pars_vertex>
attribute vec4 aMorph;
attribute vec4 aSurf;
uniform vec3 uCamPos;
uniform vec2 uMorphRange;
varying vec3 vWorldPos;
varying vec3 vNormalW;
varying vec4 vSurf;
void main() {
  vec3 p = position;
  float dist = distance(uCamPos, p);
  float k = clamp((dist - uMorphRange.x) / (uMorphRange.y - uMorphRange.x), 0.0, 1.0);
  p.y += aMorph.x * k;
  vec3 nrm = normalize(mix(normal, aMorph.yzw, k));
  vWorldPos = p;
  vNormalW = nrm;
  vSurf = aSurf;
  vec4 worldPosition = modelMatrix * vec4(p, 1.0);
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  vec3 transformedNormal = normalMatrix * nrm;
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
uniform vec2 uWindDir;
uniform vec3 cGrassSun, cGrassLush, cGrassDry, cGrassShade, cAlpine, cForest, cDirt, cSand, cRock, cRockDark, cMesa, cSnow;
varying vec3 vWorldPos;
varying vec3 vNormalW;
varying vec4 vSurf;

vec4 tri(vec3 p, vec3 w, float scale) {
  return texture2D(uNoise, p.zy / scale) * w.x + texture2D(uNoise, p.xz / scale) * w.y + texture2D(uNoise, p.xy / scale) * w.z;
}

void main() {
  vec3 wp = vWorldPos;
  vec3 Ng = normalize(vNormalW);
  float dist = length(wp - cameraPosition);
  float detailFade = 1.0 - smoothstep(150.0, 900.0, dist);

  // --- noise fields (world-space; low frequency first = painterly masses)
  vec4 nM = texture2D(uNoise, wp.xz / 640.0);
  vec4 nL = texture2D(uNoise, wp.xz / 170.0);
  vec4 nD = texture2D(uNoise, wp.xz / 31.0);
  vec4 nF = texture2D(uNoise, wp.xz / 6.5);
  vec3 tw = pow(abs(Ng), vec3(4.0)); tw /= (tw.x + tw.y + tw.z);
  vec4 nT = tri(wp, tw, 23.0);
  vec4 nT2 = tri(wp, tw, 5.0);

  float slope = 1.0 - Ng.y;
  float h = wp.y;
  float river = vSurf.x, forest = vSurf.y, mesa = vSurf.z, cav = vSurf.w;
  float nz = (nL.g - 0.5) * 0.12 + (nD.r - 0.5) * 0.06;

  // --- weights
  float rockW = smoothstep(0.24, 0.36, slope + nz);
  float snowLine = 305.0 + 40.0 * (nM.a - 0.5) * 2.0;
  float snowW = smoothstep(-12.0, 12.0, h - snowLine + (nD.g - 0.5) * 30.0 + (nL.b - 0.5) * 30.0) * (1.0 - smoothstep(0.3 + 0.12 * sat((h - snowLine) / 150.0), 0.48 + 0.12 * sat((h - snowLine) / 150.0), slope + nz * 1.5));
  rockW *= 1.0 - snowW;
  float sandW = max(1.0 - smoothstep(1.5, 4.5, h + nz * 30.0), river * 0.85) * (1.0 - rockW) * (1.0 - snowW);
  float alpine = smoothstep(170.0, 260.0, h + (nL.r - 0.5) * 40.0);
  float slopeDirt = smoothstep(0.16, 0.25, slope + nz) * 0.75;
  float patchDirt = smoothstep(0.8, 0.95, nL.a * 0.7 + nD.r * 0.45) * 0.45 * smoothstep(0.5, 0.8, nM.a);
  float dirtW = (1.0 - rockW) * (1.0 - snowW) * (1.0 - sandW) * sat(max(max(mesa * 0.55, alpine * 0.35), max(slopeDirt, patchDirt * (1.0 - forest * 0.5))));
  float grassW = max(0.0, 1.0 - rockW - snowW - sandW - dirtW);

  // --- grass: big painted masses with gentle hue drift
  float m1 = nM.r, m2 = nL.r;
  vec3 grass = mix(cGrassLush, cGrassSun, smoothstep(0.25, 0.8, m2 * 0.7 + m1 * 0.5));
  grass = mix(grass, cGrassDry, smoothstep(0.55, 0.85, nM.a * 0.8 + nL.a * 0.35) * 0.6);
  grass = mix(grass, cForest, forest * 0.75);
  grass = mix(grass, cAlpine, alpine);
  grass = mix(grass, cGrassDry * vec3(1.05, 0.95, 0.8), mesa * 0.6);
  grass = hueShift(grass, (nM.g - 0.5) * 0.3 + (nL.a - 0.5) * 0.12);
  // large painted value masses: whole hillsides shift lighter/darker
  grass *= 0.8 + 0.32 * smoothstep(0.15, 0.85, nM.r * 0.6 + nL.g * 0.4);
  grass = mix(vec3(luma(grass)), grass, 0.86);
  // brush-like stroke variation (stretched along wind)
  float stroke = texture2D(uNoise, vec2(wp.x * 0.94 + wp.z * 0.34, wp.z * 0.94 - wp.x * 0.34) / vec2(5.0, 11.0)).g;
  float speck = texture2D(uNoise, wp.xz / 1.7).g;
  float nearF = 1.0 - smoothstep(10.0, 60.0, dist);
  grass *= 0.9 + 0.18 * mix(0.5, stroke, detailFade) + (nD.g - 0.5) * 0.1 * detailFade + (speck - 0.5) * 0.16 * nearF;
  grass = mix(grass, grass * vec3(1.08, 1.06, 0.8), smoothstep(0.62, 0.8, nF.a) * 0.4 * detailFade); // sun-bleached tufts
  // rolling wind gusts: broad sheen bands drifting across the fields (matches grass gusts)
  vec2 gp = wp.xz - uWindDir * uTime * 7.0;
  float gust = texture2D(uNoise, gp / 160.0).r * 0.65 + texture2D(uNoise, gp / 47.0 + 0.3).g * 0.35;
  grass *= 1.0 + smoothstep(0.55, 0.8, gust) * 0.13 * smoothstep(8.0, 60.0, dist);
  grass = mix(grass, grass * vec3(0.78, 0.86, 0.72), sat(-cav) * 0.0 + sat(cav) * 0.35); // hollows darker/lusher

  // --- dirt
  vec3 dirt = cDirt * (0.85 + 0.3 * nD.r) ;
  dirt = mix(dirt, cMesa * 0.9, mesa * 0.5);
  dirt = mix(dirt, dirt * vec3(0.9, 0.95, 1.0), alpine);

  // --- sand (wet near the waterline)
  vec3 sand = cSand * (0.92 + 0.12 * nD.g);
  float wetSand = 1.0 - smoothstep(0.2, 1.6, h - (river > 0.3 ? h : 0.0));
  sand = mix(sand, sand * vec3(0.62, 0.6, 0.55), wetSand);
  // river beds: wet rounded pebbles, grey-brown with a cool tint
  vec3 pebble = mix(vec3(0.38, 0.35, 0.3), vec3(0.47, 0.45, 0.4), smoothstep(0.2, 0.8, nF.g + (speck - 0.5) * 0.3));
  sand = mix(sand, pebble, smoothstep(0.3, 0.9, river));

  // --- rock: stylised strata + fissures (triplanar)
  vec4 nTL = tri(wp, tw, 140.0);
  float bandH = mix(3.2, 4.6, mesa);
  float warp = (nTL.r - 0.5) * 1.1 + (nT.a - 0.5) * 0.18;
  float band = (h + 1.4 * sin(h / 11.0 + nTL.g * 3.0)) / bandH + warp;
  float bf = fract(band);
  float bandId = floor(band);
  float bandRnd = fract(sin(bandId * 12.9898 + 3.1) * 43758.5453);
  float bandRnd2 = fract(sin(bandId * 78.233 + 1.7) * 23421.631);
  // face-horizontal coordinate (for vertical erosion grooves)
  float hc = mix(wp.x, wp.z, tw.x / max(tw.x + tw.z, 1e-3));
  float groove = texture2D(uNoise, vec2(hc / 7.0, wp.y / 70.0 + bandId * 0.13)).b;
  float groove2 = texture2D(uNoise, vec2(hc / 2.3, wp.y / 25.0)).g;
  vec3 rockBase = mix(cRock, cRockDark, smoothstep(0.2, 0.9, bandRnd) * 0.7);
  rockBase = mix(rockBase, rockBase * vec3(1.08, 1.02, 0.9), bandRnd2 * 0.6);
  vec3 mesaBand = mix(cMesa, cMesa * vec3(1.25, 1.12, 0.92), bandRnd);
  mesaBand = mix(mesaBand, vec3(0.86, 0.72, 0.55), step(0.78, bandRnd2) * 0.7); // pale cream layers
  mesaBand = mix(mesaBand, cMesa * vec3(0.72, 0.55, 0.5), step(bandRnd2, 0.15) * 0.6); // deep red layers
  rockBase = mix(rockBase, mesaBand, mesa);
  // stratum edges: bright top lip, dark recess under it
  float lip = smoothstep(0.80, 0.96, bf);
  float recess = 1.0 - smoothstep(0.0, 0.14, bf);
  rockBase *= 1.0 + 0.12 * lip - 0.2 * recess;
  float column = texture2D(uNoise, vec2(hc / 16.0, wp.y / 160.0)).r;
  rockBase *= 0.8 + 0.32 * groove;
  rockBase *= 0.86 + 0.28 * smoothstep(0.3, 0.7, column);
  rockBase = hueShift(rockBase, (nTL.a - 0.5) * 0.3) * (0.88 + 0.24 * nTL.g);
  float fiss = smoothstep(0.62, 0.92, nT.b) * detailFade;
  rockBase *= 1.0 - fiss * 0.3;
  rockBase *= 0.94 + 0.12 * mix(0.5, nT2.g, detailFade);
  // moss/grass on top-facing rock and ledges
  float moss = smoothstep(0.55, 0.85, Ng.y + (nT.g - 0.5) * 0.4 + lip * 0.25) * (1.0 - alpine * 0.7) * (1.0 - mesa);
  rockBase = mix(rockBase, mix(cGrassLush, cForest, 0.4) * 0.85, moss * 0.65);
  rockBase *= 1.0 - sat(cav) * 0.2;

  // --- snow
  vec3 snow = cSnow * (0.95 + 0.06 * nD.g);

  vec3 albedo = grass * grassW + dirt * dirtW + sand * sandW + rockBase * rockW + snow * snowW;

  // --- wetness: darken porous surfaces
  float porous = 1.0 - snowW;
  albedo *= 1.0 - uWetness * 0.38 * porous;

  // --- shading normal: subtle painterly breakup on rock (near only)
  vec3 N = Ng;
  vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), Ng) + vec3(1e-4, 0.0, 0.0));
  float rf = rockW * mix(1.0, 0.45, 1.0 - detailFade);
  N = normalize(N + vec3(0.0, 1.0, 0.0) * (lip * 0.9 - recess * 0.7) * rf
                  + T * ((groove - 0.5) * 1.3 + (column - 0.5) * 1.6 + (groove2 - 0.5) * 0.5 * detailFade) * rf);

  float shadow = getShadowMask();
  float ao = 1.0 - sat(cav) * 0.4 - (1.0 - Ng.y) * 0.08;
  float wrap = snowW * 0.15 + grassW * 0.08;
  vec3 col = paintLight(albedo, N, shadow, ao, wrap);

  // wet sheen / snow glints
  vec3 L, kc; paintKeyLight(L, kc);
  vec3 V = normalize(cameraPosition - wp);
  float spec = pow(sat(dot(reflect(-L, N), V)), 40.0);
  col += kc * spec * shadow * (uWetness * 0.25 * porous + snowW * 0.05) * RECIPROCAL_PI;
  // cool rim on far ridgelines (reads silhouettes against the sky)
  float rim = pow(1.0 - sat(dot(N, V)), 4.0);
  col += uSkyColor * rim * 0.06;

  #ifndef USE_FOG
  col = paintFog(col, wp);
  #endif
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export function makeTerrainMaterials(ctx, noiseTex, levels) {
  const { THREE } = ctx;
  const shared = sharedUniforms(ctx, THREE, noiseTex);
  const colors = {};
  const map = { cGrassSun: P.grassSun, cGrassLush: P.grassLush, cGrassDry: P.grassDry, cGrassShade: P.grassShade,
    cAlpine: P.grassAlpine, cForest: P.forestFloor, cDirt: P.dirt, cSand: P.sand, cRock: P.rock, cRockDark: P.rockDark,
    cMesa: P.mesaRock, cSnow: P.snow };
  for (const k in map) colors[k] = { value: new THREE.Color(map[k]) };
  const camPos = { value: new THREE.Vector3() };
  const mats = [];
  for (let l = 0; l < levels; l++) {
    const uniforms = {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.lights),
    ...THREE.UniformsLib.fog,
      ...shared, ...colors,
      uCamPos: camPos,
      uMorphRange: { value: new THREE.Vector2(1e6, 1e6 + 1) },
    };
    const m = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, lights: true, fog: true });
    m.name = 'terrain-L' + l;
    mats.push(m);
  }
  return { mats, camPos, colors };
}
