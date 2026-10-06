// GPU spray/mist particles: a fixed ring buffer of points whose motion is evaluated in the
// vertex shader from (spawn pos, velocity, birth, life). Spawning only rewrites the touched
// slots (partial buffer uploads); nothing is allocated per frame.
//   kind 0: droplet  (ballistic, small, bright)
//   kind 1: mist     (drifts up/with wind, grows, soft and translucent)
//   kind 2: foam fleck on the surface (stays at spawn height, spreads, fades)
import * as THREE from 'three';

const VERT = /* glsl */`
#include <common>
#include <fog_pars_vertex>
attribute vec3 aVel;
attribute vec4 aInfo;   // birth, life, size, kind
uniform float uTime;
uniform float uPxScale;
uniform vec2 uWindDir;
uniform float uWindStrength;
varying float vAlpha;
varying float vKind;
void main() {
  float t = uTime - aInfo.x;
  float life = aInfo.y;
  vKind = aInfo.w;
  if (t < 0.0 || t > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vAlpha = 0.0; return; }
  float u = t / life;
  vec3 p = position;
  float size = aInfo.z;
  if (vKind < 0.5) {
    p += aVel * t + vec3(0.0, -4.9, 0.0) * t * t;
    vAlpha = (1.0 - u) * smoothstep(0.0, 0.05, u);
    size *= 1.0 - 0.5 * u;
  } else if (vKind < 1.5) {
    float k = (1.0 - exp(-t * 1.2)) / 1.2;
    p += aVel * k + vec3(uWindDir.x, 0.0, uWindDir.y) * uWindStrength * 1.6 * t + vec3(0.0, 0.55 * t, 0.0);
    vAlpha = sin(3.14159 * u) * sin(3.14159 * u) * 0.26;
    size *= 0.7 + 1.4 * u;
  } else {
    float k = (1.0 - exp(-t * 2.0)) / 2.0;
    p += vec3(aVel.x, 0.0, aVel.z) * k;
    vAlpha = (1.0 - u) * smoothstep(0.0, 0.1, u) * 0.85;
    size *= 0.6 + 0.8 * u;
  }
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = clamp(size * uPxScale / max(-mvPosition.z, 0.1), 0.0, 220.0);
  vAlpha *= smoothstep(0.3, 2.0, -mvPosition.z);
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */`
#include <common>
#include <fog_pars_fragment>
uniform sampler2D tSprite;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uSunDir;
varying float vAlpha;
varying float vKind;
void main() {
  vec2 pc = gl_PointCoord;
  float a = texture2D(tSprite, pc).a * vAlpha;
  if (vKind > 1.5) a *= smoothstep(0.05, 0.4, abs(pc.y - 0.5) * 2.0 + 0.2);  // flecks: flattened
  if (a < 0.004) discard;
  float sunUp = smoothstep(-0.05, 0.2, uSunDir.y);
  vec3 light = uSkyColor * 0.75 + uSunColor * (0.42 + 0.2 * sunUp);
  vec3 col = (vKind > 0.5 && vKind < 1.5) ? light * vec3(0.92, 0.97, 1.02) : light * 1.05;
  gl_FragColor = vec4(col, a);
  #include <fog_fragment>
}
`;

export function createParticles(ctx, spriteTex, max = 8192) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(max * 3);
  const vel = new Float32Array(max * 3);
  const info = new Float32Array(max * 4);
  for (let i = 0; i < max; i++) info[i * 4] = -1e6;   // dead
  const aPos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const aVel = new THREE.BufferAttribute(vel, 3).setUsage(THREE.DynamicDrawUsage);
  const aInfo = new THREE.BufferAttribute(info, 4).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', aPos);
  geo.setAttribute('aVel', aVel);
  geo.setAttribute('aInfo', aInfo);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  const u = ctx.uniforms;
  const uniforms = {
    ...THREE.UniformsLib.fog,
    uTime: u.uTime, uSunColor: u.uSunColor, uSkyColor: u.uSkyColor, uSunDir: u.uSunDir,
    uWindDir: u.uWindDir, uWindStrength: u.uWindStrength,
    uPxScale: { value: 600 },
    tSprite: { value: spriteTex },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false, fog: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 6;
  points.name = 'water-particles';

  let head = 0, lo = max, hi = -1;
  function spawn(x, y, z, vx, vy, vz, life, size, kind, age = 0) {
    const i = head;
    head = (head + 1) % max;
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
    info[i * 4] = u.uTime.value - age; info[i * 4 + 1] = life; info[i * 4 + 2] = size; info[i * 4 + 3] = kind;
    if (i < lo) lo = i;
    if (i > hi) hi = i;
  }
  function flush(camera, renderer) {
    // projected pixel scale for world-size points
    const h = renderer.domElement.height || 720;
    uniforms.uPxScale.value = h * camera.projectionMatrix.elements[5] * 0.5;
    if (hi < lo) return;
    for (const [attr, n] of [[aPos, 3], [aVel, 3], [aInfo, 4]]) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(lo * n, (hi - lo + 1) * n);
      attr.needsUpdate = true;
    }
    lo = max; hi = -1;
  }
  return { points, spawn, flush, material: mat };
}
