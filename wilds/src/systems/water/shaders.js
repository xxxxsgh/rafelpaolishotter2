// Stylised water shader shared by ocean / lakes / rivers (selected with defines OCEAN, LAKE, RIVER).
//
// Look: depth-based body colour (turquoise shallows -> deep teal-blue), soft painterly foam at
// shorelines (depth contact band + lapping lines that travel toward the beach), flow-mapped
// normals that run down river channels, white aerated water on rapids and falls, Fresnel sky +
// cloud reflection that uses the sky system's palette, toon-ish sun glint with sparkles,
// shallow-bed caustics, rain ripples and splash rings. Output is premultiplied alpha so
// reflections/glints are additive over the bed seen through the shallows.

export const WATER_VERT = /* glsl */`
#include <common>
#include <shadowmap_pars_vertex>
#include <fog_pars_vertex>
uniform float uTime;
uniform sampler2D tHeight;
uniform vec4 uHeightXf;     // x: world offset (half size), y: 1/size
uniform float uLevel;
uniform vec4 uWaves[4];     // dirX, dirZ, k (2pi/len), amplitude
#if defined(RIVER) || defined(LAKE)
attribute vec4 aWater;      // x depth, y fade, z turbulence, w steepness
#endif
#ifdef RIVER
attribute vec4 aFlow;       // xy flow velocity (world m/s), z across (m), w along (m)
varying vec4 vFlow;
#endif
varying vec3 vWorld;
varying vec3 vNrm;
varying vec4 vWater;
varying vec3 vWave;         // xy wave slope, z wave height (crest factor)

float terrainH(vec2 xz) {
  vec2 uv = (xz + uHeightXf.x) * uHeightXf.y;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return -40.0;
  return texture2D(tHeight, uv).r;
}

void main() {
  vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
  vec3 nrm = normalize(mat3(modelMatrix) * normal);
  vWave = vec3(0.0);
#ifdef OCEAN
  float depth = uLevel - terrainH(p.xz);
  float camD = length(p.xz - cameraPosition.xz);
  float att = smoothstep(-0.5, 6.5, depth);
  att = att * att * (3.0 - 2.0 * att);
  att *= 1.0 - smoothstep(900.0, 3000.0, camD);
  vec3 off = vec3(0.0);
  vec2 slope = vec2(0.0);
  float crest = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 w = uWaves[i];
    float k = w.z;
    float c = sqrt(9.81 / k);
    float ph = k * (dot(w.xy, p.xz) - c * uTime);
    float a = w.w * att;
    float s = sin(ph), co = cos(ph);
    off.y += a * s;
    off.xz += w.xy * (0.6 * a * co);     // Gerstner: crests sharpen, troughs broaden
    slope += w.xy * (a * k * co);
    crest += a * s / max(w.w, 1e-3) * (i < 2 ? 0.5 : 0.25);
  }
  p += off;
  nrm = normalize(vec3(-slope.x, 1.0, -slope.y));
  vWater = vec4(depth, 1.0, 0.0, 0.0);
  vWave = vec3(slope, crest);
#else
  vWater = aWater;
#endif
#ifdef RIVER
  vFlow = aFlow;
#endif
  vWorld = p;
  vNrm = nrm;
  vec4 worldPosition = vec4(p, 1.0);
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  vec3 transformedNormal = normalMatrix * normal;
  #include <shadowmap_vertex>
  #include <fog_vertex>
}
`;

export const WATER_FRAG = /* glsl */`
#include <common>
#include <packing>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
#include <fog_pars_fragment>
uniform float uTime;
uniform float uRain;
uniform float uWindStrength;
uniform vec2 uWindDir;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uFogColor;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform vec4 uSkyState;      // x night, y daylight, z cloud reflection on/off, w unused
uniform vec3 cShallow, cMid, cDeep, cScatter, cFoam;
uniform sampler2D tNormal, tNoise, tHeight, tRefract;
uniform vec4 uRefr;          // xy 1/resolution, z refraction+SSR available, w unused
uniform sampler2D tRefractDepth;
uniform mat4 uProj;
uniform vec2 uNearFar;
uniform vec4 uHeightXf;
uniform float uLevel;
uniform float uNormalStrength;
uniform vec4 uRipples[8];    // x, z, start time, strength
uniform vec4 uFalls[12];     // plunge pools: x, z, radius, strength
#ifdef RIVER
varying vec4 vFlow;
#endif
varying vec3 vWorld;
varying vec3 vNrm;
varying vec4 vWater;
varying vec3 vWave;

float sat(float x) { return clamp(x, 0.0, 1.0); }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec2 nrmTex(vec2 uv) { return texture2D(tNormal, uv).rg * 2.0 - 1.0; }

float linZ(float d) {
  float z = d * 2.0 - 1.0;
  return 2.0 * uNearFar.x * uNearFar.y / (uNearFar.y + uNearFar.x - z * (uNearFar.y - uNearFar.x));
}
float sceneLin(vec2 uv) { return linZ(texture2D(tRefractDepth, uv).r); }

// Screen-space reflection against the grabbed opaque scene (banks, trees, cliffs, ruins).
// Geometric ray march in view space with growing steps + binary refinement. Sky misses fall
// back to the analytic sky/cloud reflection.
vec3 ssrTrace(vec3 vpos, vec3 Rv, float maxT, out float hit) {
  hit = 0.0;
  if (Rv.z > 0.25) return vec3(0.0);
  float t = 0.35 + 0.004 * -vpos.z;
  float tPrev = 0.0;
  for (int i = 0; i < 22; i++) {
    vec3 P = vpos + Rv * t;
    vec4 c = uProj * vec4(P, 1.0);
    vec2 uv = c.xy / c.w * 0.5 + 0.5;
    if (c.w <= 0.0 || uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || t > maxT) break;
    float sz = sceneLin(uv);
    float diff = -P.z - sz;
    if (diff > 0.0 && sz < uNearFar.y * 0.98 && diff < max(0.8, (t - tPrev) * 1.6)) {
      float a = tPrev, b = t;
      for (int k = 0; k < 5; k++) {
        float m = 0.5 * (a + b);
        vec3 Q = vpos + Rv * m;
        vec4 cq = uProj * vec4(Q, 1.0);
        vec2 uq = cq.xy / cq.w * 0.5 + 0.5;
        if (-Q.z > sceneLin(uq)) { b = m; uv = uq; } else a = m;
      }
      vec2 e = smoothstep(vec2(0.0), vec2(0.07), uv) * smoothstep(vec2(1.0), vec2(0.93), uv);
      hit = e.x * e.y * smoothstep(0.25, -0.05, Rv.z) * (1.0 - smoothstep(maxT * 0.6, maxT, t));
      return texture2D(tRefract, uv).rgb;
    }
    tPrev = t;
    t *= 1.42;
  }
  return vec3(0.0);
}


float terrainHF(vec2 xz) {
  vec2 uv = (xz + uHeightXf.x) * uHeightXf.y;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return -40.0;
  return texture2D(tHeight, uv).r;
}

void keyLight(out vec3 L, out vec3 col) {
  #if NUM_DIR_LIGHTS > 0
    L = normalize(inverseTransformDirection(directionalLights[0].direction, viewMatrix));
    col = directionalLights[0].color;
  #else
    L = normalize(uSunDir);
    col = uSunColor * 3.0 * smoothstep(-0.05, 0.1, uSunDir.y);
  #endif
}

// Expanding rain-drop rings on a jittered grid (two layers). Returns surface slope.
vec2 rainRipples(vec2 p, float t) {
  vec2 acc = vec2(0.0);
  for (int l = 0; l < 2; l++) {
    vec2 q = p * (l == 0 ? 1.0 : 1.43) + float(l) * 17.31;
    vec2 cell = floor(q);
    vec2 f = fract(q);
    float h = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
    float h2 = fract(sin(dot(cell, vec2(269.5, 183.3))) * 43758.5453);
    vec2 c = vec2(0.3 + 0.4 * h, 0.3 + 0.4 * h2);
    float ph = fract(t * (0.9 + 0.5 * h2) + h * 13.0);
    vec2 d = f - c;
    float r = length(d);
    float x = (r - ph * 0.3) * 40.0;
    float ring = sin(x) * exp(-x * x * 0.08) * (1.0 - ph) * (1.0 - ph);
    acc += d / max(r, 1e-3) * ring;
  }
  return acc;
}

// Splash / swim rings placed by the water system.
vec2 splashRings(vec2 p, out float foamRing) {
  vec2 acc = vec2(0.0);
  foamRing = 0.0;
  for (int i = 0; i < 8; i++) {
    vec4 r = uRipples[i];
    if (r.w <= 0.0) continue;
    float age = uTime - r.z;
    if (age < 0.0 || age > 3.0) continue;
    vec2 d = p - r.xy;
    float dist = length(d);
    float R = age * (1.6 + r.w * 0.8);
    float x = (dist - R);
    float env = (1.0 - age / 3.0) * r.w;
    float wave = sin(x * 7.0) * exp(-x * x * 1.5) * env;
    acc += d / max(dist, 1e-3) * wave * 0.6;
    foamRing = max(foamRing, exp(-x * x * 6.0) * env * smoothstep(3.0, 0.5, age));
  }
  return acc;
}

vec3 skyColour(vec3 R) {
  float up = sat(R.y);
  vec3 sky = mix(uHorizon, uZenith, pow(up, 0.5));
  #ifdef USE_FOG
    sky = mix(wbFogTint(sky, R), sky, smoothstep(0.0, 0.35, up));
  #endif
  return sky;
}

void main() {
  vec3 wp = vWorld;
  vec3 toCam = cameraPosition - wp;
  float dist = length(toCam);
  vec3 V = toCam / max(dist, 1e-4);
  float detail = 1.0 - smoothstep(25.0, 700.0, dist);
  float nearD = 1.0 - smoothstep(10.0, 90.0, dist);
  vec3 Ng = normalize(vNrm);
  if (!gl_FrontFacing) Ng = -Ng;
  bool refrOn = uRefr.z > 0.5;
  vec3 vpos = (viewMatrix * vec4(wp, 1.0)).xyz;
  float fragZ = -vpos.z;
  vec2 suv = gl_FragCoord.xy * uRefr.xy;

  float depth, fade = 1.0, turb = 0.0, steep = 0.0;
#ifdef OCEAN
  depth = wp.y - terrainHF(wp.xz);
#else
  depth = vWater.x; fade = vWater.y; turb = vWater.z; steep = vWater.w;
#endif
  // water thickness from the depth buffer (catches rocks, ruins, logs, legs — anything in the water)
  float sceneZ = uNearFar.y;
  float thick = 1e4;          // along the view ray (m)
  float vThick = 1e4;         // ~vertical
  if (refrOn) {
    sceneZ = sceneLin(suv);
    thick = max(0.0, (sceneZ - fragZ) * dist / max(fragZ, 1e-3));
    vThick = thick * max(V.y, 0.08);
  }

  // ---------------- surface normal ----------------
  vec2 slope = vec2(0.0);
  float speed = 0.0;
  vec2 T = vec2(0.0, 1.0), B = vec2(1.0, 0.0);
  vec2 ruv = vec2(0.0);
#ifdef RIVER
  vec2 fl = vFlow.xy;
  speed = length(fl);
  T = speed > 1e-3 ? fl / speed : vec2(0.0, 1.0);
  B = vec2(-T.y, T.x);
  ruv = vFlow.zw;
  // two-phase flow map in channel space (across, along): normals stream downstream
  {
    float cyc = 1.7;
    float t0 = fract(uTime / cyc), t1 = fract(uTime / cyc + 0.5);
    float w0 = 1.0 - abs(1.0 - 2.0 * t0);
    float w1 = 1.0 - w0;
    vec2 o0 = vec2(0.0, speed * t0 * cyc), o1 = vec2(0.0, speed * t1 * cyc);
    vec2 sA = nrmTex((ruv - o0) / vec2(4.5, 7.5)) * w0 + nrmTex((ruv - o1) / vec2(4.5, 7.5) + vec2(0.43, 0.27)) * w1;
    vec2 sB = nrmTex((ruv - o0 * 1.15) / vec2(1.7, 2.6) + 0.31) * w0 + nrmTex((ruv - o1 * 1.15) / vec2(1.7, 2.6) + vec2(0.71, 0.13)) * w1;
    vec2 s = sA * 0.65 + sB * 0.4 * (0.4 + 0.6 * detail);
    float k = (0.32 + 0.05 * min(speed, 6.0)) * uNormalStrength;
    slope = (B * s.x + T * s.y) * k;
  }
#else
  {
    vec2 wd = uWindDir;
    mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
    vec2 uvA = wp.xz / 23.0 + wd * uTime * 0.021;
    vec2 uvB = rot * (wp.xz / 9.1) + vec2(-wd.y, wd.x) * uTime * 0.027;
    vec2 uvC = rot * rot * (wp.xz / 3.3) - wd * uTime * 0.045;
    vec2 s = nrmTex(uvA) * 0.55 + nrmTex(uvB) * 0.38 + nrmTex(uvC) * 0.24 * (0.3 + 0.7 * nearD);
    float k = uNormalStrength * (0.55 + 0.45 * sat(uWindStrength));
    slope = s * k;
  }
#endif
#ifdef OCEAN
  slope *= mix(0.12, 1.0, 1.0 - smoothstep(20.0, 380.0, dist));
#else
  slope *= mix(0.22, 1.0, detail);
#endif
  // grazing views: ripples foreshorten into a calmer, more mirror-like sheet
  slope *= mix(0.45, 1.0, sat(V.y * 3.5));
#ifdef OCEAN
  slope += vWave.xy * 0.85;
#endif
  float rainK = uRain * (1.0 - smoothstep(15.0, 70.0, dist));
  if (rainK > 0.01) slope += rainRipples(wp.xz * 1.1, uTime) * rainK * 0.5;
  float ringFoam;
  slope += splashRings(wp.xz, ringFoam);
  vec3 N = normalize(Ng + vec3(-slope.x, 0.0, -slope.y));

  // ---------------- light ----------------
  vec3 L, kc; keyLight(L, kc);
  float shadow = getShadowMask();
  float night = uSkyState.x;
  float dayK = uSkyState.y;
  vec3 sunI = kc * RECIPROCAL_PI;
  vec3 amb = max(uSkyColor, vec3(0.02, 0.03, 0.045));

  // ---------------- body colour (absorption by depth) ----------------
  float dpos = max(depth, 0.0);
  float shoreD = min(dpos, vThick);
  // view-dependent optical path: grazing views see "deeper" water
  float path = dpos * mix(1.0, 1.0 / max(V.y, 0.25), 0.4);
  if (refrOn) path = min(path, thick * 0.8 + 0.1);
#ifdef OCEAN
  float tD = 1.0 - exp(-path * 0.075);     // long turquoise shelf around the island
#else
  float tD = 1.0 - exp(-path * 0.12);
#endif
  vec3 body = mix(cShallow, cMid, smoothstep(0.0, 0.55, tD));
  body = mix(body, cDeep, smoothstep(0.45, 1.0, tD));
#ifdef RIVER
  body = mix(body, cShallow * vec3(0.9, 1.0, 0.95), 0.25 * sat(speed / 6.0));
#endif
  // painterly hue drift across big water bodies
  vec4 nBig = texture2D(tNoise, wp.xz / 420.0);
  body *= 0.92 + 0.16 * nBig.r;
  body = mix(body, body * vec3(0.9, 1.06, 1.0), smoothstep(0.4, 0.8, nBig.b) * 0.4);
  float ndlB = sat(L.y);
  vec3 bodyLit = body * (amb * 0.62 + sunI * ndlB * mix(0.45, 1.0, shadow) * 0.85);
  // forward scatter through wave crests when looking toward the light (glassy turquoise glow)
  float towardSun = pow(sat(dot(-V, L) * 0.6 + 0.4), 3.0);
  float crestK = sat(vWave.z * 0.6 + 0.35 + (slope.x * L.x + slope.y * L.z) * 1.5);
  bodyLit += cScatter * sunI * towardSun * crestK * 0.35 * shadow * (1.0 - tD * 0.4);

  // caustics on the shallow bed: soft, low contrast light web, broken up by big noise
  float caus = 0.0;
  {
    vec2 cuv = wp.xz / 4.2 + slope * 0.3;
    float c1 = texture2D(tNoise, cuv + vec2(uTime * 0.031, uTime * 0.017)).a;
    float c2 = texture2D(tNoise, cuv * 1.37 + vec2(-uTime * 0.023, uTime * 0.029) + 0.5).a;
    caus = pow(1.0 - min(c1, c2), 4.0);
    caus *= smoothstep(0.03, 0.35, shoreD) * (1.0 - smoothstep(0.8, 4.0, dpos)) * nearD;
    caus *= 0.45 + 0.55 * smoothstep(0.3, 0.7, texture2D(tNoise, wp.xz / 37.0).b);
  }

  // ---------------- reflection ----------------
  float NdV = sat(dot(N, V));
  float F = 0.025 + 0.975 * pow(1.0 - NdV, 5.0);
  F = mix(F, pow(1.0 - NdV, 3.0) * 0.9, 0.35);   // stylised: a little more sky at mid angles
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 refl = skyColour(R);
  #ifdef USE_FOG
  if (uSkyState.z > 0.5 && R.y > 0.015) {
    // clouds are looked up along a calmer reflection vector so they stay soft painted shapes
    vec3 Rc = reflect(-V, normalize(Ng + vec3(-slope.x, 0.0, -slope.y) * 0.35));
    Rc.y = abs(Rc.y);
    vec2 cp = wp.xz + Rc.xz / max(Rc.y, 0.03) * (WB_CLOUD_H - wp.y);
    float cd = wbCloudDensity(cp, 0.0) * smoothstep(0.015, 0.16, Rc.y) * 0.8;
    vec3 cloudC = mix(uCloudShade, uCloudLit, 0.55 + 0.45 * sat(dot(R, L)));
    refl = mix(refl, cloudC, cd * 0.85);
  }
  #endif
  // the far bank / horizon: reflections fade toward haze at grazing distance (no hard mirror)
  refl = mix(refl, uHorizon, smoothstep(300.0, 2500.0, dist) * 0.3);
  if (refrOn && dist < 1400.0) {
    // reflected banks / trees / cliffs; a calmer normal keeps the mirror image coherent
    vec3 Nr = normalize(Ng + vec3(-slope.x, 0.0, -slope.y) * 0.45);
    vec3 Rv = reflect(normalize(vpos), normalize(mat3(viewMatrix) * Nr));
    float hit;
    vec3 sc = ssrTrace(vpos, Rv, 900.0, hit);
    hit *= 1.0 - smoothstep(900.0, 1400.0, dist);
    // slightly darker + cooler than the source, like a real reflection on tinted water
    refl = mix(refl, sc * vec3(0.86, 0.92, 0.96), hit * 0.92);
  }

  // ---------------- sun glint ----------------
  float sd = sat(dot(R, L));
  float glintCore = smoothstep(0.9965, 0.9988, sd) * 3.2;            // toon disc-ish highlight
  float glintSoft = pow(sd, 90.0) * 0.55 + pow(sd, 12.0) * 0.06;
  // sparkles: high-frequency facets catching the sun
  vec2 spUV = wp.xz / 1.7 + slope * 2.0 + vec2(uTime * 0.13, -uTime * 0.11);
  float sp = texture2D(tNormal, spUV).b * texture2D(tNormal, spUV * 1.9 - uTime * 0.07).b;
  float spark = smoothstep(0.55, 0.7, sp) * smoothstep(0.93, 0.995, sd) * 4.0 * (0.3 + 0.7 * detail);
  float sunVis = shadow * (1.0 - night * 0.7);
  vec3 glint = sunI * PI * (glintCore + glintSoft + spark) * sunVis * 0.55;

  // ---------------- foam ----------------
  float fn = texture2D(tNoise, wp.xz / 7.0 + vec2(uTime * 0.012, -uTime * 0.008)).r;
  float fcell = texture2D(tNoise, wp.xz / 2.6 + vec2(-uTime * 0.02, uTime * 0.015)).g;
  float fcell2 = texture2D(tNoise, wp.xz / 1.1 + vec2(uTime * 0.03, uTime * 0.02)).g;
  float foamShape = sat(fcell * 0.75 + fcell2 * 0.45);
  float fallStreak = 0.0;
  // thin contact line where the water meets banks / rocks, broken by bubbly cells
  float contact = 1.0 - smoothstep(0.0, 0.07 + 0.12 * fn, shoreD);
  float foam = contact * smoothstep(0.2, 0.55, foamShape + 0.15) * 0.95;
  // a second, lacier band slightly off the edge that breathes in and out
  float breathe = 0.5 + 0.5 * sin(uTime * 1.1 + fn * 9.0 + wp.x * 0.05);
  float lace = (1.0 - smoothstep(0.08, 0.28 + 0.25 * fn + 0.12 * breathe, shoreD)) * smoothstep(0.08, 0.2, shoreD);
  foam = max(foam, smoothstep(0.62, 0.8, foamShape) * lace * 0.75);
#ifdef OCEAN
  {
    // lapping lines: depth contours that travel shoreward and break up as they go
    float band = 1.0 - smoothstep(0.3, 2.6 + fn * 1.5, dpos);
    float lap = fract(dpos * 0.55 - uTime * 0.11 + fn * 0.55);
    float line = smoothstep(0.84, 0.96, lap) * (1.0 - smoothstep(0.965, 1.0, lap));
    foam = max(foam, smoothstep(0.3, 0.65, line * band * (0.35 + foamShape)) * 0.8);
    // whitecaps on crests out at sea when windy
    float cap = smoothstep(0.7, 1.05, vWave.z + (fcell - 0.5) * 0.4) * smoothstep(0.7, 1.4, uWindStrength);
    foam = max(foam, cap * smoothstep(0.45, 0.7, foamShape) * 0.7 * detail);
  }
#endif
#ifdef RIVER
  {
    // foam streaks advected along the current (rapids, below falls, around the banks)
    float cyc = 2.3;
    float t0 = fract(uTime / cyc), t1 = fract(uTime / cyc + 0.5);
    float w0 = 1.0 - abs(1.0 - 2.0 * t0);
    vec2 sc = vec2(3.0, 9.0);
    float n0 = texture2D(tNoise, (ruv - vec2(0.0, speed * t0 * cyc)) / sc).r;
    float n1 = texture2D(tNoise, (ruv - vec2(0.0, speed * t1 * cyc)) / sc + 0.5).r;
    float fs = mix(n1, n0, w0);
    float c0 = texture2D(tNoise, (ruv - vec2(0.0, speed * t0 * cyc)) / vec2(1.6, 3.2)).g;
    float c1 = texture2D(tNoise, (ruv - vec2(0.0, speed * t1 * cyc)) / vec2(1.6, 3.2) + 0.5).g;
    float fc = mix(c1, c0, w0);
    float rap = turb + sat(speed - 3.0) * 0.12;
    float streak = smoothstep(0.62 - rap * 0.5, 0.9 - rap * 0.4, fs * 0.7 + fc * 0.45);
    foam = max(foam, streak * sat(rap * 1.6 + 0.12) * 0.85);
    // bank-side foam lines trailing downstream (thin, streaky)
    float bank = 1.0 - smoothstep(0.0, 0.25 + 0.35 * fs, shoreD);
    foam = max(foam, smoothstep(0.55, 0.85, bank * (0.45 + fc * 0.8)) * 0.7);
    // falls: aerated white water with darker glassy streaks racing down
    if (steep > 0.01) {
      float st = texture2D(tNoise, vec2(ruv.x / 1.4, ruv.y / 5.0 - uTime * (0.9 + speed * 0.12))).r;
      float st2 = texture2D(tNoise, vec2(ruv.x / 0.6, ruv.y / 2.3 - uTime * (1.5 + speed * 0.2))).g;
      float st3 = texture2D(tNoise, vec2(ruv.x / 2.7, ruv.y / 11.0 - uTime * (0.6 + speed * 0.08)) + 0.37).b;
      float white = smoothstep(0.3, 0.75, st * 0.7 + st2 * 0.5 + steep * 0.2 - (st3 - 0.5) * 0.8);
      foam = max(foam, steep * mix(0.3, 1.0, white));
      fallStreak = steep * (1.0 - white);
    }
  }
#endif
#ifdef RIVER
  // churning plunge pools under the falls
  for (int i = 0; i < 12; i++) {
    vec4 pf = uFalls[i];
    if (pf.w <= 0.0) continue;
    vec2 d = wp.xz - pf.xy;
    float r = length(d) / pf.z;
    if (r > 1.6) continue;
    float boil = texture2D(tNoise, d / 3.5 + vec2(uTime * 0.21, -uTime * 0.17)).g;
    float boil2 = texture2D(tNoise, d / 1.3 - vec2(uTime * 0.33, uTime * 0.29)).r;
    float ringW = fract(r * 2.2 - uTime * 0.6 + boil * 0.3);
    float k = (1.0 - smoothstep(0.35, 1.5, r)) * pf.w;
    foam = max(foam, k * smoothstep(0.25, 0.6, boil * 0.65 + boil2 * 0.5 + (1.0 - r) * 0.3 - ringW * 0.15));
  }
#endif
  foam = max(foam, ringFoam * 0.8 * smoothstep(0.3, 0.6, foamShape + 0.3));
  foam *= 1.0 - smoothstep(600.0, 1800.0, dist) * 0.7;
  vec3 foamCol = cFoam * (amb * 0.8 + sunI * (0.35 + 0.65 * shadow) * (0.55 + 0.45 * sat(N.y)) * 1.15);
  // foam in the slope shadow of its own bubbles: a touch of blue at the low end
  foamCol = mix(foamCol * vec3(0.78, 0.9, 1.0), foamCol, smoothstep(0.3, 0.9, foamShape));
  // glassy green-blue sheets between the white ropes of a fall
  foamCol = mix(foamCol, mix(cMid, cShallow, 0.5) * (amb * 0.9 + sunI * 0.6), fallStreak * 0.55);

  // ---------------- transparency ----------------
  float aBody = 1.0 - exp(-path * 0.55);
  aBody = mix(aBody, 1.0, smoothstep(150.0, 900.0, dist));        // far water reads as a solid colour
  aBody = max(aBody, 0.1);
  float edge = smoothstep(0.0, 0.18, depth) * fade;
  if (refrOn) edge *= smoothstep(0.0, 0.06, vThick);               // soft intersection with rocks / banks

  vec3 C;
  float A;
  vec3 causL = sunI * caus * 0.5 * shadow * dayK;
  if (refrOn) {
    // screen-space refraction: the bed seen through a wobbling surface, tinted by absorption
    float dk = sat(shoreD * 0.9) * (1.0 - smoothstep(40.0, 400.0, dist));
    vec2 offs = slope * (0.04 * dk) * vec2(1.0, 1.6) * (0.5 + 0.5 * nearD);
    vec2 ruv2 = clamp(suv + offs, vec2(0.001), vec2(0.999));
    // never pull in things that are in front of the water surface
    if (sceneLin(ruv2) < fragZ) ruv2 = suv;
    vec3 bed = texture2D(tRefract, ruv2).rgb;
    vec3 trans = exp(-path * vec3(0.5, 0.15, 0.1));
    vec3 bedT = (bed + causL * (0.3 + bed)) * trans;
    vec3 under = mix(bedT, bodyLit, aBody);
    C = under * (1.0 - F) + refl * F + glint;
    A = 1.0;
  } else {
    C = bodyLit * aBody * (1.0 - F) + refl * F + glint;
    C += causL * (1.0 - aBody * 0.7);
    A = 1.0 - (1.0 - aBody) * (1.0 - F);
    A = sat(max(A, luma(glint) * 0.5));
  }
  C = mix(C, foamCol, foam);
  A = mix(A, 1.0, foam);
  if (!gl_FrontFacing) { C = mix(cDeep, cShallow, 0.4) * amb * 0.9; A = 0.85; }
  C *= edge; A *= edge;
  if (A < 0.002) discard;

  gl_FragColor = vec4(C / A, A);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
  gl_FragColor.rgb *= gl_FragColor.a;
}
`;
