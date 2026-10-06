// Painterly toon materials for physics props + sanctum architecture, and the ink outline.
//
// One ShaderMaterial family with per-kind procedural albedo (defines):
//   WOOD (crate planks), BARREL (painted staves), STONE (boulders), BARK (logs + end rings),
//   METAL (blued iron with rune inlays), ICE (frosted translucent), SANCTUM (ancient stone with
//   glowing glyph channels), GLOW (pure emissive), CHEST.
// Lighting: soft 2-3 band ramp, cool blue-teal shade, warm rim; outdoors it reads the sky
// system's directional + hemisphere lights, shadow map and patched fog. Indoors (uIndoor=1)
// it switches to the sanctum light rig: up to 8 point lights + warm/cool ambient, no sun.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const MAX_PL = 8;

// shared uniforms for every physics material (indoor rig, burn glow time etc.)
export function createShared(ctx) {
  const pl = [], plc = [];
  for (let i = 0; i < MAX_PL; i++) { pl.push(new THREE.Vector4(0, -1e4, 0, 1)); plc.push(new THREE.Vector3()); }
  return {
    uIndoor: { value: 0 },
    uPL: { value: pl },              // xyz pos, w range
    uPLC: { value: plc },            // colour * intensity
    uAmbTop: { value: new THREE.Color(0x26344a) },
    uAmbBot: { value: new THREE.Color(0x2e2218) },
    uGlyphPulse: { value: 0 },
    uGlyphCol: { value: new THREE.Color(0x56f0d2) },
    uIndoorFog: { value: new THREE.Color(0x231f1c) },
    uIndoorFogD: { value: 0.009 },
  };
}

const NOISE = /* glsl */`
float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y);
  float b = mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y);
  return mix(a, b, f.z);
}
float fbm3(vec3 p) { return vnoise(p) * 0.55 + vnoise(p * 2.07 + 7.1) * 0.3 + vnoise(p * 4.3 - 3.7) * 0.15; }
float sat(float x) { return clamp(x, 0.0, 1.0); }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
`;

const VERT = /* glsl */`
#include <common>
#include <shadowmap_pars_vertex>
#include <fog_pars_vertex>
attribute vec3 color;
attribute float aGlow;
varying vec3 vWorldPos;
varying vec3 vNormalW;
varying vec3 vColor;
varying vec3 vLocal;
varying vec3 vLocalN;
varying vec2 vUv;
varying float vGlow;
void main() {
  mat4 m = modelMatrix;
  #ifdef USE_INSTANCING
    m = modelMatrix * instanceMatrix;
  #endif
  vec4 worldPosition = m * vec4(position, 1.0);
  vWorldPos = worldPosition.xyz;
  vNormalW = normalize(mat3(m) * normal);
  vColor = color;
  vLocal = position;
  vLocalN = normal;
  vUv = uv;
  vGlow = aGlow;
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
${NOISE}
uniform vec3 uSunDir, uSunColor, uSkyColor, uGroundColor;
uniform float uWetness, uTime;
uniform float uIndoor;
uniform vec4 uPL[${MAX_PL}];
uniform vec3 uPLC[${MAX_PL}];
uniform vec3 uAmbTop, uAmbBot, uGlyphCol, uIndoorFog;
uniform float uGlyphPulse, uIndoorFogD;
uniform vec3 uTint;
uniform vec3 uTint2;
uniform float uBurn;       // 0..1 charring
uniform float uHeat;       // 0..1 ember glow (on fire)
uniform float uGlow;       // object highlight (rune grab, plate active)
uniform vec3 uGlowCol;
uniform float uSolved;     // sanctum glyph state
uniform float uMelt;
varying vec3 vWorldPos;
varying vec3 vNormalW;
varying vec3 vColor;
varying vec3 vLocal;
varying vec3 vLocalN;
varying vec2 vUv;
varying float vGlow;

float ramp(float ndl) { return smoothstep(-0.12, 0.3, ndl) * 0.62 + smoothstep(0.32, 0.85, ndl) * 0.38; }

// rune glyphs on a cell grid: each cell holds a character built from 2-4 strokes between the
// nodes of a 3x3 lattice (+ optional ring / dot), with blank cells for rhythm. AA via fwidth.
float segd(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
float glyph(vec2 p, float seed) {
  vec2 cell = floor(p); vec2 f = fract(p);
  float h0 = hash12(cell + seed);
  if (h0 > 0.84) return 0.0;
  vec2 q = (f - 0.5) / 0.34;
  float d = 9.0;
  if (h0 < 0.55) d = segd(q, vec2(0.0, -1.0), vec2(0.0, 1.0));
  else if (h0 < 0.7) d = segd(q, vec2(-1.0, 1.0), vec2(1.0, 1.0));
  for (int i = 0; i < 3; i++) {
    float hi = hash12(cell * 1.7 + seed + float(i) * 13.1);
    float hj = hash12(cell * 2.3 - seed + float(i) * 7.7);
    vec2 a = vec2(floor(hi * 3.0) - 1.0, floor(fract(hi * 7.13) * 3.0) - 1.0);
    vec2 b = clamp(a + vec2(floor(hj * 3.0) - 1.0, floor(fract(hj * 5.31) * 3.0) - 1.0), -1.0, 1.0);
    if (dot(a - b, a - b) > 0.1) d = min(d, segd(q, a, b));
  }
  float hr = hash12(cell + seed + 91.0);
  if (hr < 0.16) d = min(d, abs(length(q - vec2(0.0, 0.45)) - 0.42));
  else if (hr < 0.28) d = min(d, length(q - vec2(0.0, -1.05)) - 0.1);
  float fw = max(fwidth(d), 1e-3);
  return 1.0 - smoothstep(0.13 - fw, 0.13 + fw, d);
}

void main() {
  vec3 N = normalize(vNormalW);
  if (!gl_FrontFacing) N = -N;
  vec3 wp = vWorldPos;
  vec3 V = normalize(cameraPosition - wp);
  float dist = length(cameraPosition - wp);
  vec3 albedo = vColor * uTint;
  vec3 emis = vec3(0.0);
  float spec = 0.0; float specPow = 24.0;
  float rimAmt = 0.35;

#if defined(WOOD)
  // crate planks along U, cross battens from vertex colour (geometry), grain
  float pl = vUv.x * 4.0;
  float seam = smoothstep(0.0, 0.05, fract(pl)) * smoothstep(1.0, 0.95, fract(pl));
  float pid = floor(pl);
  float grain = fbm3(vec3(vUv.x * 30.0 + pid * 3.1, vUv.y * 3.0, pid));
  albedo *= mix(0.86, 1.08, hash12(vec2(pid, 3.0))) * (0.85 + 0.25 * grain);
  albedo *= mix(0.55, 1.0, seam);
  // knots
  float kn = smoothstep(0.86, 0.95, vnoise(vec3(vUv * vec2(9.0, 5.0), pid)));
  albedo *= 1.0 - kn * 0.25;
#elif defined(BARREL)
  float st = vUv.x * 18.0;
  float seam = smoothstep(0.0, 0.08, fract(st)) * smoothstep(1.0, 0.92, fract(st));
  float sid = floor(st);
  albedo *= mix(0.88, 1.06, hash12(vec2(sid, 1.0))) * (0.9 + 0.18 * fbm3(vec3(vUv.x * 40.0, vUv.y * 4.0, sid)));
  albedo *= mix(0.6, 1.0, seam);
  // painted hazard glyph band (warm cream rune on red)
  float band = smoothstep(0.38, 0.4, vUv.y) * smoothstep(0.62, 0.6, vUv.y);
  vec2 gp = vec2(vUv.x * 6.0, (vUv.y - 0.5) * 6.0 + 0.5);
  float gl = glyph(gp * vec2(1.0, 1.0), 4.0) * band * uTint2.y;
  albedo = mix(albedo, vec3(0.93, 0.82, 0.55), gl * 0.9);
  spec = 0.15;
#elif defined(STONE)
  vec3 q = vLocal * 1.3;
  float n1 = fbm3(q), n2 = vnoise(q * 3.7);
  albedo *= 0.82 + 0.3 * n1;
  albedo *= 1.0 - smoothstep(0.62, 0.8, n2) * 0.18;
  float up = smoothstep(0.35, 0.9, N.y + (n1 - 0.5) * 0.7);
  albedo = mix(albedo, vec3(0.42, 0.56, 0.22) * (0.8 + 0.4 * n2), up * 0.75 * uTint2.x);
  // lichen speckles
  albedo = mix(albedo, vec3(0.86, 0.84, 0.66), smoothstep(0.78, 0.84, vnoise(q * 6.0)) * 0.4);
#elif defined(BARK)
  float cap = smoothstep(0.85, 0.95, abs(vLocalN.y));
  float a = atan(vLocal.z, vLocal.x);
  float bark = fbm3(vec3(a * 3.0, vLocal.y * 1.4, 0.0));
  float furrow = smoothstep(0.35, 0.6, vnoise(vec3(a * 8.0, vLocal.y * 0.7, 2.0)));
  vec3 barkCol = albedo * (0.7 + 0.45 * bark) * mix(0.6, 1.0, furrow);
  float r = length(vLocal.xz) * 9.0;
  float ring = 0.5 + 0.5 * sin(r * 6.2832 + vnoise(vLocal * 6.0) * 2.0);
  vec3 endCol = mix(vec3(0.78, 0.6, 0.38), vec3(0.62, 0.44, 0.26), ring * 0.7);
  endCol = mix(endCol, barkCol, smoothstep(0.86, 0.98, length(vLocal.xz) / max(0.01, uTint2.x)));
  albedo = mix(barkCol, endCol, cap);
  // moss on top side
  float mossy = smoothstep(0.3, 0.9, N.y) * (1.0 - cap) * smoothstep(0.45, 0.7, vnoise(vLocal * 2.5));
  albedo = mix(albedo, vec3(0.38, 0.52, 0.2), mossy * 0.7);
#elif defined(METAL)
  float n1 = fbm3(vLocal * 3.0);
  albedo *= 0.8 + 0.3 * n1;
  // worn edges brighter
  vec3 ab = abs(vLocalN);
  spec = 0.9; specPow = 40.0; rimAmt = 0.55;
  // rune inlay on faces: glyph grid in face-local coords
  vec2 fp = ab.x > 0.5 ? vLocal.zy : (ab.y > 0.5 ? vLocal.xz : vLocal.xy);
  float g = glyph(fp * 3.2 + 0.5, 11.0) * uTint2.y;
  float frame = 0.0;
  emis += uGlowCol * g * (0.35 + 1.6 * uGlow);
  albedo = mix(albedo, albedo * 0.5, g);
#elif defined(ICE)
  float n1 = fbm3(vLocal * 2.2);
  float fres = pow(1.0 - sat(dot(N, V)), 2.0);
  albedo = mix(vec3(0.55, 0.82, 0.95), vec3(0.92, 0.98, 1.0), fres * 0.8 + n1 * 0.2);
  float crack = 1.0 - smoothstep(0.0, 0.04, abs(vnoise(vLocal * 3.0) - 0.5));
  albedo = mix(albedo, vec3(1.0), crack * 0.4);
  emis += vec3(0.25, 0.5, 0.6) * (0.25 + fres * 0.5);
  spec = 1.0; specPow = 60.0;
#elif defined(SANCTUM)
  // carved stone blocks in world space, glyph channels where aGlow > 0
  vec3 an = abs(N);
  vec2 fp = an.x > 0.6 ? wp.zy : (an.y > 0.6 ? wp.xz : wp.xy);
  vec2 blk = fp / vec2(2.0, 1.0);
  blk.x += step(1.0, mod(floor(blk.y), 2.0)) * 0.5;
  vec2 bf = fract(blk);
  float joint = smoothstep(0.0, 0.035, bf.x) * smoothstep(1.0, 0.965, bf.x) * smoothstep(0.0, 0.06, bf.y) * smoothstep(1.0, 0.94, bf.y);
  if (an.y > 0.6) { vec2 tf = fract(fp / 2.0); joint = smoothstep(0.0, 0.025, tf.x) * smoothstep(1.0, 0.975, tf.x) * smoothstep(0.0, 0.025, tf.y) * smoothstep(1.0, 0.975, tf.y); }
  float bid = hash12(floor(blk) + floor(an.x * 3.0));
  float n1 = fbm3(wp * 0.7);
  albedo *= mix(0.86, 1.1, bid) * (0.86 + 0.24 * n1);
  albedo *= mix(0.55, 1.0, joint);
  // worn, slightly warm edges
  albedo = mix(albedo, albedo * vec3(1.08, 1.0, 0.9), smoothstep(0.6, 0.9, vnoise(wp * 2.3)) * 0.4);
  // glyphs
  float gmask = vGlow;
  if (gmask > 0.5 && gmask < 1.5 && an.y > 0.6) gmask = 0.0;   // small glyph panels only on vertical faces
  if (gmask > 0.5) {
    float gs = gmask > 1.5 ? 1.0 : 2.4;
    float g = glyph(fp * gs, floor(gmask) * 7.0);
    // border channel around glyph panels
    float pulse = 0.65 + 0.35 * sin(uTime * 1.6 - (fp.x + fp.y) * 0.35);
    float strip = gmask > 2.5 ? 1.0 : 0.0;
    float k = max(g, strip);
    albedo = mix(albedo, albedo * 0.35, k);
    vec3 gc = mix(uGlyphCol, vec3(1.0, 0.72, 0.32), uTint2.z);
    float gboost = strip > 0.5 ? 1.0 : 1.9;
    emis += gc * k * gboost * (0.9 + 1.4 * uSolved + 0.6 * uGlyphPulse) * pulse;
  }
#elif defined(CHEST)
  float n1 = fbm3(vLocal * 4.0);
  albedo *= 0.85 + 0.25 * n1;
  spec = vGlow > 0.5 ? 0.8 : 0.1;
  if (vGlow > 1.5) emis += uGlowCol * (0.8 + 1.2 * uGlow);
#elif defined(GLOW)
  emis = albedo * (1.0 + uGlow);
  albedo *= 0.1;
#endif

  // charring + embers
  if (uBurn > 0.001) {
    float cn = fbm3(wp * 2.2);
    float burnt = smoothstep(0.0, 1.0, uBurn * 1.6 - cn * 0.6);
    albedo = mix(albedo, vec3(0.06, 0.045, 0.04), burnt);
    float cracks = smoothstep(0.55, 0.62, vnoise(wp * 5.0 + uTime * 0.2)) * burnt;
    emis += vec3(1.0, 0.35, 0.06) * cracks * uHeat * (0.8 + 0.4 * sin(uTime * 7.0 + cn * 9.0)) * 2.4;
  }
  albedo *= 1.0 - uWetness * 0.25 * (1.0 - uIndoor);

  vec3 col;
  if (uIndoor < 0.5) {
    vec3 L, kc;
    #if NUM_DIR_LIGHTS > 0
      L = normalize(inverseTransformDirection(directionalLights[0].direction, viewMatrix));
      kc = directionalLights[0].color;
    #else
      L = normalize(uSunDir); kc = uSunColor * 3.0;
    #endif
    float shadow = getShadowMask();
    float ndl = dot(N, L);
    float lit = ramp(ndl + 0.05) * shadow;
    vec3 amb = vec3(0.0);
    #if NUM_HEMI_LIGHTS > 0
      vec3 Nv = normalize((viewMatrix * vec4(N, 0.0)).xyz);
      for (int i = 0; i < NUM_HEMI_LIGHTS; i++) amb += getHemisphereLightIrradiance(hemisphereLights[i], Nv);
    #else
      amb = mix(uGroundColor, uSkyColor, N.y * 0.5 + 0.5) * 1.2;
    #endif
    amb += ambientLightColor;
    amb = max(amb, uSkyColor * 0.7 + uGroundColor * 0.2);
    vec3 cool = mix(vec3(0.74, 0.9, 1.15), vec3(1.0), lit);
    float fill = 0.62 + 0.9 * (1.0 - abs(N.y));
    col = albedo * (kc * lit * RECIPROCAL_PI + amb * cool * fill);
    col += albedo * RECIPROCAL_PI * kc * 0.06 * smoothstep(0.0, 0.25, ndl) * (1.0 - smoothstep(0.25, 0.6, ndl)) * shadow * vec3(1.0, 0.7, 0.4);
    // toon specular + rim
    vec3 H = normalize(L + V);
    col += kc * spec * smoothstep(0.5, 0.56, pow(sat(dot(N, H)), specPow)) * shadow * 0.25;
    float rim = smoothstep(0.62, 0.82, 1.0 - sat(dot(N, V))) * sat(dot(-V, L) * 0.5 + 0.6);
    col += kc * rim * rimAmt * 0.12 * (0.5 + 0.5 * shadow);
    float dayAmt = smoothstep(0.04, 0.3, luma(uSkyColor));
    col *= 0.55 + 0.45 * dayAmt;
    col = mix(vec3(luma(col)) * vec3(0.62, 0.78, 1.1), col, 0.3 + 0.7 * dayAmt);
  } else {
    // sanctum rig: hemispheric ambient + point lights with toon falloff
    vec3 amb = mix(uAmbBot, uAmbTop, N.y * 0.5 + 0.5);
    vec3 acc = vec3(0.0);
    for (int i = 0; i < ${MAX_PL}; i++) {
      vec3 d = uPL[i].xyz - wp;
      float l = length(d);
      float att = sat(1.0 - l / uPL[i].w); att *= att;
      if (att <= 0.0) continue;
      vec3 Ld = d / l;
      float ndl = dot(N, Ld);
      acc += uPLC[i] * att * (ramp(ndl) * 0.85 + 0.15);
      vec3 H = normalize(Ld + V);
      acc += uPLC[i] * att * spec * smoothstep(0.5, 0.56, pow(sat(dot(N, H)), specPow)) * 0.6;
    }
    col = albedo * (amb + acc);
    float rim = smoothstep(0.6, 0.85, 1.0 - sat(dot(N, V)));
    col += uGlyphCol * rim * rimAmt * 0.06;
  }
  col += emis;
  // highlight (grabbed / selected)
  col += uGlowCol * uGlow * 0.12 * (0.6 + 0.4 * smoothstep(0.4, 0.9, 1.0 - sat(dot(N, V))));

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  vec3 preFog = gl_FragColor.rgb;
  #include <fog_fragment>
  if (uIndoor > 0.5) {
    float f = 1.0 - exp(-uIndoorFogD * dist);
    gl_FragColor.rgb = mix(preFog, uIndoorFog, f);
  }
}
`;

export function makeMaterial(ctx, shared, kind, o = {}) {
  const u = ctx.uniforms;
  const uniforms = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.lights),
    ...THREE.UniformsLib.fog,
    uSunDir: u.uSunDir, uSunColor: u.uSunColor, uSkyColor: u.uSkyColor, uGroundColor: u.uGroundColor,
    uWetness: u.uWetness, uTime: u.uTime,
    ...shared,
    uTint: { value: new THREE.Color(o.tint ?? 0xffffff) },
    uTint2: { value: new THREE.Vector3(...(o.tint2 || [1, 1, 0])) },
    uBurn: { value: 0 }, uHeat: { value: 0 }, uGlow: { value: 0 },
    uGlowCol: { value: new THREE.Color(o.glowCol ?? 0x5ef2d6) },
    uSolved: { value: 0 }, uMelt: { value: 0 },
  };
  const m = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG, lights: true, fog: true,
    defines: { [kind]: 1 },
    side: o.side ?? THREE.FrontSide,
  });
  m.name = 'phys-' + kind;
  return m;
}

// clone sharing the program but with its own per-object uniforms
export function cloneMaterial(m) {
  const c = m.clone();
  // keep shared (global) uniforms linked
  for (const k in m.uniforms) {
    if (['uTint', 'uTint2', 'uBurn', 'uHeat', 'uGlow', 'uGlowCol', 'uSolved', 'uMelt'].includes(k)) continue;
    c.uniforms[k] = m.uniforms[k];
  }
  return c;
}

// ---------------------------------------------------------------------------
// ink outline (inverted hull, width grows gently with distance; fades out far away)
const OVERT = /* glsl */`
#include <common>
#include <fog_pars_vertex>
uniform float uWidth;
varying float vFade;
void main() {
  mat4 m = modelMatrix;
  #ifdef USE_INSTANCING
    m = modelMatrix * instanceMatrix;
  #endif
  vec4 wpos = m * vec4(position, 1.0);
  vec3 n = normalize(mat3(m) * normal);
  float d = length(cameraPosition - wpos.xyz);
  wpos.xyz += n * uWidth * (0.55 + d * 0.016);
  vFade = 1.0 - smoothstep(70.0, 130.0, d);
  vec4 mvPosition = viewMatrix * wpos;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;
const OFRAG = /* glsl */`
#include <common>
#include <fog_pars_fragment>
uniform vec3 uInk;
uniform float uIndoor;
uniform vec3 uIndoorFog;
varying float vFade;
void main() {
  if (vFade < 0.02) discard;
  gl_FragColor = vec4(uInk, 1.0);
  #include <colorspace_fragment>
  vec3 pre = gl_FragColor.rgb;
  #include <fog_fragment>
  if (uIndoor > 0.5) gl_FragColor.rgb = pre;
}
`;
export function makeOutlineMaterial(ctx, shared, o = {}) {
  const m = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsLib.fog, uWidth: { value: o.width ?? 0.022 }, uInk: { value: new THREE.Color(o.ink ?? 0x1c1a24) }, uIndoor: shared.uIndoor, uIndoorFog: shared.uIndoorFog },
    vertexShader: OVERT, fragmentShader: OFRAG, side: THREE.BackSide, fog: true,
  });
  m.name = 'phys-ink';
  return m;
}

// geometry copy with welded, averaged normals for the outline hull
export function outlineGeometry(geo) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', geo.getAttribute('position').clone());
  if (geo.index) g.setIndex(geo.index.clone());
  const w = mergeVertices(g, 1e-3);
  w.computeVertexNormals();
  return w;
}

// ensure color + aGlow attributes exist (defaults white / 0)
export function prepGeometry(geo, color = 0xffffff, glow = 0) {
  const n = geo.getAttribute('position').count;
  if (!geo.getAttribute('color')) {
    const c = new THREE.Color(color), a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  }
  if (!geo.getAttribute('aGlow')) geo.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n).fill(glow), 1));
  if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return geo;
}
