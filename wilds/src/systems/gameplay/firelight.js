// Screen-space local lights for campfires / the summit beacon.
//
// None of the world's custom shaders evaluate point lights (adding real PointLights would
// recompile every lit material when toggled), so firelight is applied as a deferred-style
// volume: a back-faced sphere around each fire reads a copy of the scene depth + colour
// (blitted once per frame, only while a fire volume is on screen), reconstructs the world
// position and a derivative normal, and adds warm light tinted by the surface's own hue.
// Terrain, grass, the hero, props — everything inside the radius picks up the glow, plus a
// faint in-air halo for smoky warmth. Falls back to nothing if the blit isn't supported.
import * as THREE from 'three';

const VERT = /* glsl */`
varying vec3 vWorld;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const FRAG = /* glsl */`
uniform sampler2D tDepth; uniform sampler2D tColor; uniform vec2 uRes;
uniform mat4 uInvProj; uniform mat4 uCamWorld;
uniform vec3 uLightPos; uniform vec3 uLightCol; uniform float uRadius; uniform float uIntensity; uniform float uHaze;
varying vec3 vWorld;
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float d = texture2D(tDepth, uv).r;
  vec3 ro = cameraPosition, rd = normalize(vWorld - cameraPosition);
  // in-air halo: closest approach of the view ray to the light, clipped by scene depth
  float tc = max(0.0, dot(uLightPos - ro, rd));
  vec3 res = vec3(0.0);
  vec3 wp = vec3(0.0);
  float sceneT = 1e6;
  if (d < 1.0) {
    vec4 ndc = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    vec4 vp = uInvProj * ndc; vp /= vp.w;
    wp = (uCamWorld * vp).xyz;
    sceneT = length(wp - ro);
    vec3 Ld = uLightPos - wp;
    float dist = length(Ld);
    if (dist < uRadius) {
      vec3 N = normalize(cross(dFdx(wp), dFdy(wp)));
      if (dot(N, ro - wp) < 0.0) N = -N;
      vec3 L = Ld / max(dist, 1e-3);
      float wrap = clamp(dot(N, L) * 0.65 + 0.35, 0.0, 1.0);
      float x = dist / uRadius;
      float att = (1.0 - x * x) * (1.0 - x * x) / (1.0 + dist * dist * 0.35);
      vec3 sc = texture2D(tColor, uv).rgb;
      float mx = max(max(sc.r, sc.g), max(sc.b, 1e-4));
      vec3 chroma = sc / mx;
      // the night grade pushes everything blue: pull the hue estimate back toward warm neutral
      vec3 alb = mix(vec3(0.42, 0.36, 0.3), chroma * 0.75, 0.75);
      alb *= 0.75 + 0.5 * clamp(luma(sc) / (mx + 0.02), 0.0, 1.0);
      res += uLightCol * uIntensity * att * wrap * alb;
    }
  }
  float tt = min(tc, sceneT);
  float dmin = length(ro + rd * tt - uLightPos);
  res += uLightCol * uHaze * exp(-dmin * dmin / (uRadius * uRadius * 0.05)) * step(tc, sceneT + 0.5);
  gl_FragColor = vec4(res, 1.0);
}`;

export function createFireLights(ctx) {
  const { THREE: T, renderer, scene, camera } = ctx;
  const grab = { rt: null, frame: -1, ok: true, fb: null, checked: false };
  const shared = {
    tDepth: { value: null }, tColor: { value: null }, uRes: { value: new THREE.Vector2(1, 1) },
    uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
  };
  const geo = new THREE.IcosahedronGeometry(1, 2);
  const lights = [];
  let enabled = ctx.params?.get?.('firelight') !== '0';

  function doGrab() {
    const f = renderer.info.render.frame;
    if (grab.frame === f) return grab.valid;
    grab.frame = f; grab.valid = false;
    if (!grab.ok) return false;
    const src = renderer.getRenderTarget();
    if (!src || !src.depthTexture || !renderer.capabilities.isWebGL2) return false;
    try {
      const gl = renderer.getContext(), state = renderer.state;
      const w = src.width, h = src.height;
      if (!grab.rt || grab.rt.width !== w || grab.rt.height !== h) {
        grab.rt?.dispose();
        const dt = new THREE.DepthTexture(w, h, src.depthTexture.type);
        dt.format = src.depthTexture.format; dt.minFilter = dt.magFilter = THREE.NearestFilter;
        grab.rt = new THREE.WebGLRenderTarget(w, h, { type: src.texture.type, depthBuffer: true, depthTexture: dt,
          stencilBuffer: !!src.stencilBuffer, generateMipmaps: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
        grab.rt.texture.name = 'gameplay.firelight';
        renderer.initRenderTarget(grab.rt);
        grab.fb = renderer.properties.get(grab.rt).__webglFramebuffer;
        shared.tDepth.value = dt; shared.tColor.value = grab.rt.texture;
        shared.uRes.value.set(w, h);
      }
      const sp = renderer.properties.get(src);
      const srcFb = src.samples > 0 && sp.__webglMultisampledFramebuffer ? sp.__webglMultisampledFramebuffer : sp.__webglFramebuffer;
      if (!srcFb || !grab.fb) return false;
      if (!grab.checked) while (gl.getError() !== gl.NO_ERROR) { /* clear stale */ }
      state.bindFramebuffer(gl.READ_FRAMEBUFFER, srcFb);
      state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, grab.fb);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT, gl.NEAREST);
      state.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, srcFb);
      if (!grab.checked) {
        grab.checked = true;
        const err = gl.getError();
        if (err !== gl.NO_ERROR) { console.warn('[gameplay] firelight blit unsupported (gl error ' + err + '); fire glow disabled'); grab.ok = false; return false; }
      }
      shared.uInvProj.value.copy(camera.projectionMatrixInverse);
      shared.uCamWorld.value.copy(camera.matrixWorld);
      grab.valid = true;
      return true;
    } catch (e) {
      console.warn('[gameplay] firelight disabled', e);
      grab.ok = false; return false;
    }
  }

  function add({ position, color = 0xff9a4a, radius = 7, intensity = 1.6, haze = 0.08 } = {}) {
    const m = new THREE.ShaderMaterial({
      uniforms: { ...shared, uLightPos: { value: position.clone() }, uLightCol: { value: new THREE.Color(color) },
        uRadius: { value: radius }, uIntensity: { value: intensity }, uHaze: { value: haze } },
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthTest: false, depthWrite: false, side: THREE.BackSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    });
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.copy(position); mesh.scale.setScalar(radius);
    mesh.renderOrder = -50; mesh.frustumCulled = true;
    mesh.onBeforeRender = () => { if (!doGrab()) m.uniforms.uIntensity.value = 0; };
    mesh.visible = enabled;
    scene.add(mesh);
    const L = {
      mesh, base: intensity, baseHaze: haze, flicker: 1, on: true,
      setPosition(p) { mesh.position.copy(p); m.uniforms.uLightPos.value.copy(p); },
      setIntensity(v) { L.base = v; },
      setRadius(r) { mesh.scale.setScalar(r); m.uniforms.uRadius.value = r; },
      setColor(c) { m.uniforms.uLightCol.value.set(c); },
      remove() { scene.remove(mesh); m.dispose(); lights.splice(lights.indexOf(L), 1); },
    };
    lights.push(L);
    return L;
  }

  let t = 0;
  function update(dt, nightAmt = 1) {
    t += dt;
    for (let i = 0; i < lights.length; i++) {
      const L = lights[i];
      const fl = 0.86 + 0.08 * Math.sin(t * 9.1 + i) + 0.05 * Math.sin(t * 23.7 + i * 3) + 0.04 * Math.sin(t * 4.3 + i * 7);
      const u = L.mesh.material.uniforms;
      // by day the sun overwhelms a campfire: keep a faint warm touch only
      const k = L.on ? fl * L.flicker * (0.18 + 0.82 * nightAmt) : 0;
      u.uIntensity.value = L.base * k;
      u.uHaze.value = L.baseHaze * k * nightAmt;
      const cd = camera.position.distanceTo(L.mesh.position);
      L.mesh.visible = enabled && grab.ok && k > 0.001 && cd < L.mesh.scale.x + 110;
    }
  }
  return { add, update, lights, get enabled() { return enabled; }, set enabled(v) { enabled = !!v; } };
}
