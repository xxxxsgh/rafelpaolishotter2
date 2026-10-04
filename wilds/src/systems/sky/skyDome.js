// Painterly sky dome: gradient + Rayleigh/Mie-ish tint, sun disc and halo,
// moon with phase, twinkling stars + milky band, two painted cloud layers
// (lit cumulus with soft 2-3 band ramp, wispy cirrus), lightning flash.
// Rendered at the far plane (xyww) after the opaque pass.
import * as THREE from 'three';
import { WB_COMMON, fogShared } from './fogChunk.js';

export function createSkyDome() {
  const uniforms = {
    ...fogShared,
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunCol: { value: new THREE.Color() },      // sun disc / cloud key colour
    uSunDisk: { value: new THREE.Vector3() },   // true sun direction
    uMoonDir: { value: new THREE.Vector3() },
    uMoonPhaseDir: { value: new THREE.Vector3() }, // direction of light on the moon
    uStarRot: { value: new THREE.Matrix3() },
    uCloudLit: { value: new THREE.Color() },
    uFogCol: { value: new THREE.Color() },
    uCloudShade: { value: new THREE.Color() },
    uSky: { value: new THREE.Vector4(0, 0, 0, 0) },  // x night, y storm darkening, z lightning flash, w sun visibility
    uCirrus: { value: new THREE.Vector4(0, 0, 0.35, 0) }, // xy offset, z amount, w time
    uTime: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    depthWrite: false,
    depthTest: true,
    side: THREE.BackSide,
    fog: false,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */`
      ${WB_COMMON}
      uniform vec3 uZenith, uHorizon, uSunCol, uSunDisk, uMoonDir, uMoonPhaseDir;
      uniform vec3 uCloudLit, uCloudShade, uFogCol;
      uniform mat3 uStarRot;
      uniform vec4 uSky, uCirrus;
      uniform float uTime;
      varying vec3 vDir;

      float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
      vec3 hash33(vec3 p) {
        p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
        return fract(sin(p) * 43758.5453123);
      }

      float stars(vec3 d, float scale, float thresh) {
        vec3 p = d * scale;
        vec3 c = floor(p);
        vec3 r = hash33(c);
        if (r.x < thresh) return 0.0;
        vec3 sp = c + 0.25 + r * 0.5;
        float dist = length(p - sp);
        float tw = 0.65 + 0.35 * sin(uTime * (1.5 + r.y * 4.0) + r.z * 40.0);
        float b = pow(r.y, 6.0) * 2.2 + 0.25;
        return (1.0 - smoothstep(0.0, 0.11 * (0.6 + r.z), dist)) * b * tw;
      }

      vec3 skyBase(vec3 d) {
        float h = d.y;
        float hc = max(h, 0.0);
        // painterly gradient: wide pale horizon band rolling up into cerulean
        float g = pow(hc, 0.42);
        vec3 col = mix(uHorizon, uZenith, smoothstep(0.0, 1.0, g));
        // brighter near-white band hugging the horizon
        col = mix(col, uHorizon * 1.06 + 0.02, exp(-hc * 18.0) * 0.6);
        col = wbFogTint(col, d) * 1.0;
        // anti-sun side slightly deeper / bluer (Rayleigh shadow)
        float c = dot(d, wbFogSun.xyz);
        col *= 1.0 - 0.07 * (1.0 - smoothstep(-1.0, 0.0, c)) * (1.0 - uSky.x);
        // below horizon: settle into fog colour
        if (h < 0.0) col = mix(col, wbFogTint(uFogCol, d), (1.0 - smoothstep(-0.06, 0.0, h)));
        return col;
      }

      void main() {
        vec3 d = normalize(vDir);
        vec3 col = skyBase(d);
        float night = uSky.x, storm = uSky.y, flash = uSky.z;
        float above = smoothstep(-0.02, 0.04, d.y);

        // ---------- night sky ----------
        if (night > 0.01) {
          vec3 sd = uStarRot * d;
          float st = stars(sd, 220.0, 0.82) + stars(sd, 420.0, 0.9) * 0.7;
          // milky band
          float band = exp(-pow(dot(sd, normalize(vec3(0.3, 0.2, 1.0))) / 0.16, 2.0));
          vec3 aw = abs(sd); aw /= (aw.x + aw.y + aw.z);
          float neb = texture2D(wbCloudTex, sd.yz * 0.7).a * aw.x + texture2D(wbCloudTex, sd.xz * 0.7).a * aw.y + texture2D(wbCloudTex, sd.xy * 0.7).a * aw.z;
          float neb2 = texture2D(wbCloudTex, sd.yz * 2.1 + 0.3).g * aw.x + texture2D(wbCloudTex, sd.xz * 2.1 + 0.3).g * aw.y + texture2D(wbCloudTex, sd.xy * 2.1 + 0.3).g * aw.z;
          float milky = band * smoothstep(0.45, 1.0, neb * 0.7 + neb2 * 0.45);
          st += stars(sd, 900.0, 0.72) * band * 1.6;
          float vis = night * above * (1.0 - storm) * smoothstep(0.0, 0.25, d.y + 0.05);
          col += vec3(0.82, 0.9, 1.0) * st * vis * 1.1;
          col += vec3(0.22, 0.30, 0.40) * milky * vis * 0.1;
        }

        // ---------- sun ----------
        float mu = dot(d, uSunDisk);
        float sunVis = uSky.w * (1.0 - storm * 0.9);
        float disk = smoothstep(0.99955, 0.99975, mu);
        float halo = pow(max(mu, 0.0), 900.0) * 3.0 + pow(max(mu, 0.0), 120.0) * 0.5;
        float horizonDim = smoothstep(-0.03, 0.03, d.y);
        vec3 sunC = uSunCol * sunVis * horizonDim;

        // ---------- moon ----------
        float mm = dot(d, uMoonDir);
        float moonR = 0.0185;
        vec3 moonCol = vec3(0.0);
        float moonMask = 0.0;
        if (mm > 0.995 && night > 0.01) {
          vec3 up = abs(uMoonDir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
          vec3 mx = normalize(cross(up, uMoonDir));
          vec3 my = cross(uMoonDir, mx);
          vec2 q = vec2(dot(d, mx), dot(d, my)) / moonR;
          float r2 = dot(q, q);
          if (r2 < 1.0) {
            // surface normal of the visible hemisphere (faces the viewer)
            vec3 n = normalize(q.x * mx + q.y * my - uMoonDir * sqrt(1.0 - r2));
            float lit = smoothstep(-0.06, 0.14, dot(n, uMoonPhaseDir));
            float mar = texture2D(wbCloudTex, q * 0.22 + 0.5).a;
            float cr = texture2D(wbCloudTex, q * 0.6 + 0.2).g;
            float albedo = 0.75 + (mar - 0.5) * 0.7 + (cr - 0.5) * 0.25;
            float edge = (1.0 - smoothstep(0.92, 1.0, r2));
            moonMask = edge;
            moonCol = vec3(0.92, 0.97, 1.0) * albedo * (lit * 2.6 + 0.04) * edge;
          }
        }
        float moonGlow = night * pow(max(mm, 0.0), 300.0) * 0.5 + night * pow(max(mm, 0.0), 30.0) * 0.06;

        col += sunC * halo;
        col = mix(col, col * 0.2 + sunC * 28.0, disk * horizonDim);
        col += vec3(0.6, 0.75, 0.8) * moonGlow * (1.0 - storm) * above;
        col = mix(col, moonCol + col * 0.25, moonMask * night * (1.0 - storm) * above);

        // ---------- clouds (cumulus deck) ----------
        if (d.y > -0.01) {
          float t = (WB_CLOUD_H - min(cameraPosition.y, WB_CLOUD_H - 200.0) * 0.6) / (d.y + 0.045);
          vec2 p = cameraPosition.xz + d.xz * t;
          float den = wbCloudDensity(p, 1.0);
          // overcast: the deck closes into a continuous ceiling, structure comes from lighting
          float ovc = uSky.y;
          float fillD = wbCloudDensity(p * 0.33 + 917.0, 0.0);
          den = mix(den, 0.45 + 0.55 * max(den, fillD), ovc * 0.92);
          if (den > 0.001) {
            vec2 cuv = p / WB_CLOUD_SCALE + wbCloudParams.xy;
            // march toward the sun across the deck for self-shadowing
            vec3 ld = wbFogSun.xyz;
            float lowSun = 1.0 - smoothstep(0.0, 0.35, ld.y);
            vec2 ls = normalize(ld.xz + 1e-4) * (130.0 + 170.0 * lowSun);
            float od = 0.0;
            od += wbCloudDensity(p + ls * 1.0, 0.6);
            od += wbCloudDensity(p + ls * 2.3, 0.3);
            od += wbCloudDensity(p + ls * 4.0, 0.0);
            float light = exp(-od * (1.15 - lowSun * 0.45));
            // inner thickness: denser = taller cloud = darker belly
            float thick = smoothstep(0.2, 1.0, den);
            light *= 1.0 - thick * 0.28;
            // billowy painted bumps (cauliflower tops catch the light)
            float bump = texture2D(wbCloudTex, cuv * 4.3 + vec2(0.37, 0.11)).g;
            float bump2 = texture2D(wbCloudTex, cuv * 11.0 - wbCloudParams.xy).b;
            light = clamp(light + (bump - 0.5) * 0.3 + (bump2 - 0.5) * 0.12, 0.0, 1.0);
            // overcast: big brooding masses dominate the shading
            float mass = smoothstep(0.25, 0.95, fillD);
            light = mix(light, (1.0 - mass) * 0.8 + (bump - 0.5) * 0.25 + 0.1, ovc * 0.75);
            // view-space volume cue: near edge (screen-bottom) = flat shaded base, far edge (screen-top) = sunlit crown
            vec2 vdir = normalize(d.xz + 1e-5) * 420.0;
            float dNear = wbCloudDensity(p - vdir, 0.0);
            float dFar = wbCloudDensity(p + vdir, 0.0);
            float base = clamp((den - dNear) * 1.6 + 0.15, 0.0, 1.0);
            float crown = clamp((den - dFar) * 1.6, 0.0, 1.0);
            light = clamp(mix(light, 0.85, 0.35) - base * 0.45 + crown * 0.35, 0.0, 1.0);
            // soft painterly ramp: three soft bands with wide terminators
            float ramp = smoothstep(0.1, 0.4, light) * 0.5 + smoothstep(0.45, 0.8, light) * 0.5;
            vec3 cc = mix(uCloudShade, uCloudLit, ramp);
            // low sun: warm glow bleeding under/around clouds on the sun side
            float sunSide = pow(mu * 0.5 + 0.5, 4.0);
            cc += uSunCol * sunSide * lowSun * (0.18 + 0.3 * (1.0 - thick)) * sunVis;
            // silver lining / forward scattering near the sun on thin edges
            float edgeT = 1.0 - smoothstep(0.0, 0.5, den);
            cc += uSunCol * (pow(max(mu, 0.0), 7.0) * 0.8 + pow(max(mu, 0.0), 40.0) * 2.2) * edgeT * sunVis;
            // aerial perspective on far clouds -> merge into horizon haze
            float far = 1.0 - exp(-t / 11000.0);
            float hz = 1.0 - smoothstep(0.0, 0.1 + 0.22 * ovc, d.y);
            cc = mix(cc, wbFogTint(uHorizon, d), clamp(far * 0.8 + hz * (0.4 + 0.5 * ovc), 0.0, 1.0));
            // feathered edges
            float a = smoothstep(0.0, 0.5, den) * smoothstep(-0.01, 0.06, d.y);
            col = mix(col, cc, a);
          }
          // ---------- cirrus ----------
          if (uCirrus.z > 0.01) {
            float t2 = 3200.0 / (d.y + 0.07);
            vec2 p2 = cameraPosition.xz * 0.3 + d.xz * t2;
            vec2 cu = p2 / 9000.0 * vec2(1.0, 3.2) + uCirrus.xy;
            float ci = texture2D(wbCloudTex, cu).a;
            float ci2 = texture2D(wbCloudTex, cu * vec2(3.0, 1.2) + 0.4).b;
            float cd = smoothstep(0.66, 0.95, ci * 0.85 + ci2 * 0.3) * uCirrus.z;
            cd *= smoothstep(0.0, 0.18, d.y);
            vec3 ccol = mix(uCloudLit, wbFogTint(uHorizon, d), 0.35) + uSunCol * pow(max(mu, 0.0), 6.0) * 0.5 * sunVis;
            col = mix(col, ccol, cd * 0.4);
          }
        }

        // storm: heavy grey overcast
        col = mix(col, col * vec3(0.55, 0.6, 0.66), storm * 0.0);
        // lightning lights the whole sky
        col += vec3(0.75, 0.82, 1.0) * flash * (0.25 + 0.2 * above);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const geo = new THREE.SphereGeometry(100, 48, 24);
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10000;   // after the rest of the opaque pass: only fills uncovered pixels
  mesh.name = 'sky-dome';
  return { mesh, uniforms, material };
}
