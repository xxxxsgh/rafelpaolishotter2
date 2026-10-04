// Global aerial perspective + height fog + drifting cloud shadows.
//
// We patch three's fog chunks so EVERY material with fog:true (built-ins and
// ShaderMaterials that merge UniformsLib.fog and #include <fog_*>) gets:
//   - exponential height fog (valleys hazier, peaks crisper)
//   - sun-direction in-scatter so the haze matches the sky dome exactly
//   - soft cloud shadows sliding across the land
// Extra uniforms are shared Float32Arrays (cloneUniforms keeps typed arrays by
// reference), so values written here reach every material without plumbing.
// Materials compiled without these uniforms fall back to plain exp2 fog.
import * as THREE from 'three';

export const CLOUD_HEIGHT = 1400.0;   // virtual cloud deck altitude (m)
export const CLOUD_SCALE = 5200.0;    // metres per noise tile (large shapes)

export const fogShared = {
  wbFogSun: { value: new Float32Array([0.4, 0.8, 0.3, 0]) },      // xyz sun dir (true sun), w sunset band
  wbFogGlow: { value: new Float32Array([1, 0.9, 0.7, 1 / 130]) }, // rgb in-scatter tint, w height falloff
  wbFogParams: { value: new Float32Array([0, 30, 0.97, 1]) },     // x base height, y start dist, z max opacity, w enabled
  wbCloudParams: { value: new Float32Array([0, 0, 0.45, 0.5]) },  // xy drift offset (uv), z coverage, w shadow strength
  wbCloudShade: { value: new Float32Array([0.62, 0.70, 0.86, 0]) }, // rgb shadow tint, w unused
  wbCloudTex: { value: null },
};

// Shared GLSL (also used verbatim by the sky dome so horizon == fog).
export const WB_COMMON = /* glsl */`
uniform vec4 wbFogSun;
uniform vec4 wbFogGlow;
uniform vec4 wbFogParams;
uniform vec4 wbCloudParams;
uniform vec4 wbCloudShade;
uniform sampler2D wbCloudTex;
#define WB_CLOUD_H ${CLOUD_HEIGHT.toFixed(1)}
#define WB_CLOUD_SCALE ${CLOUD_SCALE.toFixed(1)}
vec3 wbFogTint(vec3 base, vec3 dir) {
  float c = dot(dir, wbFogSun.xyz);
  float mu = max(c, 0.0);
  float m2 = c * 0.5 + 0.5;
  float horiz = exp(-abs(dir.y) * 4.0);
  return base + wbFogGlow.rgb * (0.22 * pow(mu, 4.0) + 0.55 * pow(mu, 18.0) + wbFogSun.w * m2 * m2 * m2 * m2 * (0.05 + 0.95 * horiz));
}
float wbRemap(float v, float lo, float hi) { return clamp((v - lo) / max(hi - lo, 1e-4), 0.0, 1.0); }
// Cloud density at world-plane position p (metres). Shared by sky + shadows.
float wbCloudDensity(vec2 p, float detail) {
  vec2 uv = p / WB_CLOUD_SCALE + wbCloudParams.xy;
  float base = texture2D(wbCloudTex, uv).r;
  float big = texture2D(wbCloudTex, uv * 0.37 + vec2(0.31, 0.17)).a;   // coverage variation
  float cov = clamp(wbCloudParams.z + (big - 0.5) * 0.55, 0.0, 1.0);
  float d = wbRemap(base, 1.0 - cov, 1.0);
  d = sqrt(d);
  if (detail > 0.0) {
    float e = texture2D(wbCloudTex, uv * 3.1 + wbCloudParams.xy * 0.6).g * 0.6
            + texture2D(wbCloudTex, uv * 8.3 - wbCloudParams.xy * 0.3).b * 0.4;
    // erode mostly at the rim -> billowy, feathered outlines with solid cores
    d = wbRemap(d, e * (0.62 - d * 0.35) * detail, 1.0);
  }
  return d;
}
float wbFogAmount(vec3 camPos, vec3 wpos, float density) {
  vec3 d = wpos - camPos;
  float len = max(length(d), 1e-3);
  float dist = max(len - wbFogParams.y, 0.0);
  float falloff = wbFogGlow.w;
  float rd = d.y / len;
  float h0 = camPos.y - wbFogParams.x;
  float fh = falloff * rd * dist;
  float integ = abs(fh) > 1e-3 ? (1.0 - exp(-fh)) / fh : 1.0 - 0.5 * fh;
  float od = density * dist * exp(-falloff * max(h0, -50.0)) * integ;
  // painterly: a touch of distance-squared haze so mid-ground separates
  od += density * density * dist * dist * 0.2;
  return min(1.0 - exp(-od), wbFogParams.z);
}
`;

export function installFogChunks() {
  const C = THREE.ShaderChunk;
  C.wb_common = WB_COMMON;
  C.fog_pars_vertex = `#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
#endif`;
  C.fog_vertex = `#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorldPos = transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);
#endif`;
  C.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  ${WB_COMMON}
#endif`;
  C.fog_fragment = `#ifdef USE_FOG
  #ifdef FOG_EXP2
    float wbDens = fogDensity;
  #else
    float wbDens = 3.0 / max(fogFar, 1.0);
  #endif
  if (wbFogParams.w > 0.5) {
    vec3 wbRay = vFogWorldPos - cameraPosition;
    vec3 wbDir = normalize(wbRay);
    // cloud shadow (soft, cool-tinted), fades with distance so far land stays readable
    if (wbCloudParams.w > 0.001) {
      vec3 sd = wbFogSun.xyz;
      vec2 sp = vFogWorldPos.xz + sd.xz / max(sd.y, 0.12) * (WB_CLOUD_H - vFogWorldPos.y);
      float cs = smoothstep(0.05, 0.55, wbCloudDensity(sp, 0.0));
      cs *= wbCloudParams.w * (1.0 - smoothstep(900.0, 2600.0, length(wbRay)));
      gl_FragColor.rgb *= mix(vec3(1.0), wbCloudShade.rgb, cs);
    }
    float fogFactor = wbFogAmount(cameraPosition, vFogWorldPos, wbDens);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, wbFogTint(fogColor, wbDir), fogFactor);
  } else {
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    #endif
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
  }
#endif`;

  // Make the shared uniforms visible to every fog-capable material.
  Object.assign(THREE.UniformsLib.fog, fogShared);
  for (const k in THREE.ShaderLib) {
    const u = THREE.ShaderLib[k].uniforms;
    if (u && u.fogColor) Object.assign(u, fogShared);
  }
}
