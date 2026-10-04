// Shared painterly lighting + atmosphere GLSL for terrain, rocks and ruins.
// Lighting reads the scene's directional/hemisphere lights (so it matches whatever the
// sky system sets up) and falls back to the shared uniforms when no lights exist.

export function sharedUniforms(ctx, THREE, noiseTex) {
  const u = ctx.uniforms;
  return {
    uTime: u.uTime, uSunDir: u.uSunDir, uSunColor: u.uSunColor, uSkyColor: u.uSkyColor,
    uGroundColor: u.uGroundColor, uFogColor: u.uFogColor, uFogDensity: u.uFogDensity,
    uWetness: u.uWetness, uRain: u.uRain, uWindDir: u.uWindDir,
    uNoise: { value: noiseTex },
  };
}

export const PAINT_PARS = /* glsl */`
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uGroundColor;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uWetness;
uniform float uRain;
uniform sampler2D uNoise;

float sat(float x) { return clamp(x, 0.0, 1.0); }
vec3 sat3(vec3 x) { return clamp(x, 0.0, 1.0); }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 hueShift(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}

// key light: direction (world), colour (incl. intensity)
void paintKeyLight(out vec3 L, out vec3 col) {
  #if NUM_DIR_LIGHTS > 0
    L = normalize(inverseTransformDirection(directionalLights[0].direction, viewMatrix));
    col = directionalLights[0].color;
  #else
    L = normalize(uSunDir);
    col = uSunColor * 3.0 * smoothstep(-0.05, 0.1, uSunDir.y);
  #endif
}

vec3 paintAmbient(vec3 N) {
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

// Soft 2-3 band toon ramp with a wide terminator.
float paintRamp(float ndl) {
  return smoothstep(-0.12, 0.32, ndl) * 0.62 + smoothstep(0.3, 0.85, ndl) * 0.38;
}

// albedo: linear; shadow: 0..1 shadow-map visibility; ao: 0..1
vec3 paintLight(vec3 albedo, vec3 N, float shadow, float ao, float wrap) {
  vec3 L, kc; paintKeyLight(L, kc);
  float ndl = dot(N, L);
  float lit = paintRamp(ndl + wrap) * shadow;
  // never let shade fall below a soft sky-blue floor (painterly: shadows stay luminous)
  vec3 amb = max(paintAmbient(N), uSkyColor * 0.75 + uGroundColor * 0.25) * ao;
  // shadows read cool blue-teal, never grey
  vec3 coolTint = mix(vec3(0.74, 0.9, 1.15), vec3(1.0), lit);
  // generous painterly fill: vertical faces also catch bounce from the sunlit ground
  float fill = 0.62 + 1.0 * (1.0 - abs(N.y));
  vec3 bounce = uGroundColor * 0.6 * (1.0 - abs(N.y)) * sat(L.y + 0.2);
  vec3 c = albedo * (kc * lit * RECIPROCAL_PI + (amb * coolTint + bounce) * fill);
  // warm bounce in the lit band near the terminator (painterly warmth)
  c += albedo * RECIPROCAL_PI * kc * 0.06 * smoothstep(0.0, 0.25, ndl) * (1.0 - smoothstep(0.25, 0.6, ndl)) * shadow * vec3(1.0, 0.7, 0.4);
  // low light (night/moon): Purkinje shift — desaturate toward cool blue, dimmer fill
  float dayAmt = smoothstep(0.04, 0.3, luma(uSkyColor));
  c *= 0.55 + 0.45 * dayAmt;
  c = mix(vec3(luma(c)) * vec3(0.62, 0.78, 1.1), c, 0.3 + 0.7 * dayAmt);
  return c;
}

// Aerial perspective: exponential height fog + distance haze + sun in-scatter.
vec3 paintFog(vec3 col, vec3 wpos) {
  vec3 V = wpos - cameraPosition;
  float dist = length(V);
  vec3 dir = V / max(dist, 1e-3);
  float b = 1.0 / 260.0;
  float camH = max(cameraPosition.y, 0.0);
  float rd = dir.y * b * dist;
  float heightTerm = exp(-camH * b) * (abs(rd) > 1e-3 ? (1.0 - exp(-rd)) / rd : 1.0);
  float dens = max(uFogDensity, 0.00012) * 1.35;
  float fog = 1.0 - exp(-dens * dist * heightTerm);
  // extra blue distance haze that lifts far terrain into the sky value
  float haze = 1.0 - exp(-dist * 0.00018);
  vec3 L, kc; paintKeyLight(L, kc);
  float sunAmt = pow(sat(dot(dir, normalize(uSunDir))), 6.0) * smoothstep(-0.1, 0.15, uSunDir.y);
  vec3 fogCol = uFogColor + uSunColor * sunAmt * 0.35;
  vec3 hazeCol = mix(uFogColor, uSkyColor, 0.25);
  col = mix(col, hazeCol, haze * 0.45 * (1.0 - fog));
  return mix(col, fogCol, sat(fog));
}
`;
