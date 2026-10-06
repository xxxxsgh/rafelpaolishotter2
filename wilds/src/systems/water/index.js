// water system — ocean around the island, lakes, rivers flowing down the terrain's channels,
// waterfalls with mist/spray, splash particles + rings, underwater tint.
// See src/main.js for the contract and DESIGN.md for ownership.
//
// API (ctx.systems.water):
//   getWaterHeight(x,z) -> surface y | null      getWaterDepth(x,z) -> m
//   getFlow(x,z,out?) -> {x,z} m/s               isUnderwater(pos) -> bool
//   getWaterKind(x,z) -> 'ocean'|'lake'|'river'|null
//   splash(pos, strength=1)   spray burst + expanding ring on the surface
//   ripple(x, z, strength)    ring only (wading / swimming wakes)
//   falls                     waterfall list (see src/world/water.js FALLS)
//   group                     THREE.Group holding all water meshes
// Events emitted: 'splash' {position, strength} when something enters the water fast.
import * as THREE from 'three';
import * as W from '../../world/water.js';
import { WATER_VERT, WATER_FRAG } from './shaders.js';
import { makeWaveNormal, makeWaterNoise, makeSpriteTex } from './textures.js';
import { buildRiverGeometry, buildLakeGeometry, buildOceanGeometry } from './rivers.js';
import { createParticles } from './particles.js';

const HX_SYNC = 256, HX_FULL = 1024;

function bakeHeights(world, R) {
  const out = new Float32Array(R * R);
  const cell = world.WORLD_SIZE / R, half = world.WORLD_SIZE / 2;
  for (let j = 0; j < R; j++) {
    const z = (j + 0.5) * cell - half;
    for (let i = 0; i < R; i++) out[j * R + i] = world.getHeight((i + 0.5) * cell - half, z);
  }
  return out;
}
function heightTexture(data, R) {
  const half = new Uint16Array(R * R);
  for (let k = 0; k < half.length; k++) half[k] = THREE.DataUtils.toHalfFloat(Math.max(-60, Math.min(4000, data[k])));
  const t = new THREE.DataTexture(half, R, R, THREE.RedFormat, THREE.HalfFloatType);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

export async function init(ctx) {
  const { scene, world, uniforms: U, camera } = ctx;
  const group = new THREE.Group();
  group.name = 'water';
  scene.add(group);

  // ---------- textures ----------
  const tNormal = makeWaveNormal();
  const tNoise = makeWaterNoise();
  const tSprite = makeSpriteTex();
  const heightU = { value: heightTexture(bakeHeights(world, HX_SYNC), HX_SYNC) };
  // full-res bake off the main thread; swap in when ready
  try {
    const worker = new Worker(new URL('./heightWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const old = heightU.value;
      heightU.value = heightTexture(e.data.data, e.data.R);
      old.dispose();
      worker.terminate();
    };
    worker.onerror = (e) => { console.warn('[water] height worker failed; using coarse depth', e.message); worker.terminate(); };
    worker.postMessage({ R: HX_FULL });
  } catch (e) { console.warn('[water] no worker; using coarse depth', e); }

  // ---------- shared uniforms ----------
  // sky palette (by reference from the sky dome when it exists, so reflections match the sky exactly)
  const dome = scene.getObjectByName('sky-dome');
  const du = dome?.material?.uniforms || {};
  const own = {
    uZenith: { value: new THREE.Color(0x5b9bd8).convertSRGBToLinear() },
    uHorizon: { value: new THREE.Color(0xd6ecf0).convertSRGBToLinear() },
    uCloudLit: { value: new THREE.Color(1, 1, 1) },
    uCloudShade: { value: new THREE.Color(0.6, 0.66, 0.75) },
  };
  const skyState = { value: new THREE.Vector4(0, 1, du.uZenith ? 1 : 0, 0) };
  const waves = [];
  for (const w of W.OCEAN_WAVES) waves.push(new THREE.Vector4(w[0], w[1], 2 * Math.PI / w[2], w[3]));
  const ripples = [];
  for (let i = 0; i < 8; i++) ripples.push(new THREE.Vector4(0, 0, -100, 0));
  const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
  const colors = {
    cShallow: { value: lin(0x4fd6c4) },
    cMid: { value: lin(0x1fa6b8) },
    cDeep: { value: lin(0x11579e) },
    cScatter: { value: lin(0x6ff0d2) },
    cFoam: { value: lin(0xf4fbff) },
  };
  const sharedU = {
    uTime: U.uTime, uRain: U.uRain, uWindStrength: U.uWindStrength, uWindDir: U.uWindDir,
    uSunDir: U.uSunDir, uSunColor: U.uSunColor, uSkyColor: U.uSkyColor, uFogColor: U.uFogColor,
    uZenith: du.uZenith || own.uZenith, uHorizon: du.uHorizon || own.uHorizon,
    uCloudLit: du.uCloudLit || own.uCloudLit, uCloudShade: du.uCloudShade || own.uCloudShade,
    uSkyState: skyState,
    tNormal: { value: tNormal }, tNoise: { value: tNoise }, tHeight: heightU,
    uHeightXf: { value: new THREE.Vector4(world.WORLD_SIZE / 2, 1 / world.WORLD_SIZE, 0, 0) },
    uWaves: { value: waves },
    uRipples: { value: ripples },
    uFalls: { value: Array.from({ length: 12 }, (_, i) => {
      const f = W.FALLS[i];
      return f ? new THREE.Vector4(f.bx + f.dirX * 2, f.bz + f.dirZ * 2, Math.max(5, f.w * 1.9), Math.min(1, f.drop / 14)) : new THREE.Vector4(0, 0, 1, 0);
    }) },
    tRefract: { value: null },
    tRefractDepth: { value: null },
    uProj: { value: camera.projectionMatrix },
    uNearFar: { value: new THREE.Vector2(camera.near, camera.far) },
    uRefr: { value: new THREE.Vector4(1, 1, 0, 0) },   // xy 1/resolution, z on/off
    ...colors,
  };

  // ---------- refraction grab ----------
  // Just before the first water mesh draws (transparent pass: terrain, rocks, trees and the sky
  // are already in the colour buffer) the current scene target is blitted into our own texture,
  // which the water samples with a slope-distorted uv. One blit per frame, no extra scene pass.
  const grab = { rt: null, frame: -1, ok: true, fb: null };
  const renderer = ctx.renderer;
  function grabScene() {
    if (!grab.ok) return;
    const f = renderer.info.render.frame;
    if (grab.frame === f) return;
    grab.frame = f;
    const src = renderer.getRenderTarget();
    if (!src || !renderer.capabilities.isWebGL2) { sharedU.uRefr.value.z = 0; return; }
    try {
      const gl = renderer.getContext(), state = renderer.state;
      const w = src.width, h = src.height;
      if (!grab.rt || grab.rt.width !== w || grab.rt.height !== h) {
        grab.rt?.dispose();
        const dt = src.depthTexture ? new THREE.DepthTexture(w, h, src.depthTexture.type) : null;
        if (dt) { dt.format = src.depthTexture.format; dt.minFilter = dt.magFilter = THREE.NearestFilter; }
        grab.rt = new THREE.WebGLRenderTarget(w, h, { type: src.texture.type, depthBuffer: !!dt, depthTexture: dt,
          stencilBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
        grab.depth = !!dt;
        sharedU.tRefractDepth.value = dt;
        grab.rt.texture.name = 'water.refract';
        renderer.initRenderTarget(grab.rt);
        grab.fb = renderer.properties.get(grab.rt).__webglFramebuffer;
        sharedU.tRefract.value = grab.rt.texture;
        sharedU.uRefr.value.set(1 / w, 1 / h, 1, 0);
      }
      const sp = renderer.properties.get(src);
      const srcFb = src.samples > 0 && sp.__webglMultisampledFramebuffer ? sp.__webglMultisampledFramebuffer : sp.__webglFramebuffer;
      if (!srcFb || !grab.fb) { sharedU.uRefr.value.z = 0; return; }
      if (!grab.checked) while (gl.getError() !== gl.NO_ERROR) { /* clear stale errors */ }
      state.bindFramebuffer(gl.READ_FRAMEBUFFER, srcFb);
      state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, grab.fb);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT | (grab.depth ? gl.DEPTH_BUFFER_BIT : 0), gl.NEAREST);
      state.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, srcFb);
      sharedU.uRefr.value.z = grab.depth && ctx.params?.get?.('refract') !== '0' ? 1 : 0;
      sharedU.uNearFar.value.set(camera.near, camera.far);
      if (!grab.checked) {
        // a format mismatch makes the blit a silent GL error; detect it once and fall back
        grab.checked = true;
        const err = gl.getError();
        if (err !== gl.NO_ERROR) { console.warn('[water] refraction blit unsupported (gl error ' + err + '); using alpha water'); grab.ok = false; sharedU.uRefr.value.z = 0; }
      }
    } catch (e) {
      console.warn('[water] refraction grab disabled', e);
      grab.ok = false; sharedU.uRefr.value.z = 0;
    }
  }

  function makeMaterial(kind, extra = {}) {
    const uniforms = {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.lights),
      ...THREE.UniformsLib.fog,
      ...sharedU,
      uLevel: { value: extra.level ?? 0 },
      uNormalStrength: { value: extra.normal ?? 0.3 },
    };
    const m = new THREE.ShaderMaterial({
      uniforms, vertexShader: WATER_VERT, fragmentShader: WATER_FRAG,
      defines: { [kind]: '' },
      lights: true, fog: true, transparent: true, depthWrite: true,
      side: kind === 'OCEAN' ? THREE.DoubleSide : THREE.FrontSide,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    m.name = 'water-' + kind.toLowerCase();
    return m;
  }
  function hookGrab(mesh) { mesh.onBeforeRender = grabScene;
  }

  // ---------- ocean ----------
  const { geo: oceanGeo } = buildOceanGeometry();
  const oceanMat = makeMaterial('OCEAN', { level: world.WATER_LEVEL, normal: 0.34 });
  const ocean = new THREE.Mesh(oceanGeo, oceanMat);
  ocean.frustumCulled = false;
  ocean.receiveShadow = true;
  ocean.renderOrder = 1;
  ocean.name = 'water-ocean';
  hookGrab(ocean);
  group.add(ocean);

  // ---------- lakes ----------
  const lakes = [];
  for (const L of world.LAKES) {
    try {
      const m = new THREE.Mesh(buildLakeGeometry(world, L), makeMaterial('LAKE', { level: L.y, normal: 0.2 }));
      m.receiveShadow = true; m.renderOrder = 2; m.name = 'water-lake-' + L.name;
      hookGrab(m); group.add(m); lakes.push(m);
    } catch (e) { console.error('[water] lake build failed', L.name, e); }
  }

  // ---------- rivers ----------
  const riverMat = makeMaterial('RIVER', { normal: 0.3 });
  const rivers = [];
  world.RIVERS.forEach((r, i) => {
    try {
      const m = new THREE.Mesh(buildRiverGeometry(world, i), riverMat);
      m.receiveShadow = true; m.renderOrder = 3; m.name = 'water-river-' + r.name;
      hookGrab(m); group.add(m); rivers.push(m);
    } catch (e) { console.error('[water] river build failed', r.name, e); }
  });

  // ---------- particles ----------
  const parts = createParticles(ctx, tSprite);
  group.add(parts.points);

  // ---------- underwater tint (fullscreen, only when the camera is submerged) ----------
  const uwMat = new THREE.ShaderMaterial({
    uniforms: { cDeep: colors.cDeep, cShallow: colors.cShallow, uSkyColor: U.uSkyColor, uTime: U.uTime, uDepth: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }`,
    fragmentShader: `uniform vec3 cDeep, cShallow, uSkyColor; uniform float uTime, uDepth; varying vec2 vUv;
      void main(){
        float k = smoothstep(0.0, 1.0, vUv.y);
        vec3 c = mix(cDeep * 0.55, cShallow * 0.9, k * 0.7) * (0.35 + 0.9 * uSkyColor);
        float w = 0.04 * sin(vUv.x * 24.0 + uTime * 1.7) * sin(vUv.y * 17.0 - uTime * 1.3);
        float a = clamp(0.62 + uDepth * 0.025 + w - k * 0.12, 0.0, 0.92);
        gl_FragColor = vec4(c, a);
      }`,
    transparent: true, depthTest: false, depthWrite: false,
  });
  const underwater = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), uwMat);
  underwater.frustumCulled = false;
  underwater.renderOrder = 20000;
  underwater.visible = false;
  underwater.name = 'water-underwater';
  group.add(underwater);

  // ---------- splash / ripples ----------
  let ripHead = 0;
  function ripple(x, z, strength = 1) {
    ripples[ripHead].set(x, z, U.uTime.value, Math.min(2, strength));
    ripHead = (ripHead + 1) % ripples.length;
  }
  function splash(pos, strength = 1) {
    const s = Math.max(0.2, Math.min(4, strength));
    const y = W.getWaterHeight(pos.x, pos.z) ?? pos.y;
    const n = Math.round(10 + 28 * s);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random();
      const out = (0.6 + 2.2 * r) * s;
      parts.spawn(pos.x + Math.cos(a) * 0.3 * s, y + 0.05, pos.z + Math.sin(a) * 0.3 * s,
        Math.cos(a) * out, (2.5 + 4.5 * Math.random()) * Math.sqrt(s), Math.sin(a) * out,
        0.7 + 0.6 * Math.random(), 0.09 + 0.12 * Math.random() * s, 0);
    }
    for (let i = 0; i < 3 + 4 * s; i++) {
      const a = Math.random() * Math.PI * 2;
      parts.spawn(pos.x, y + 0.2, pos.z, Math.cos(a) * 1.2 * s, 0.8 * s, Math.sin(a) * 1.2 * s, 1.6 + Math.random(), 1.2 * s, 1);
    }
    for (let i = 0; i < 10 + 10 * s; i++) {
      const a = Math.random() * Math.PI * 2, sp = (1 + Math.random() * 2) * s;
      parts.spawn(pos.x, y + 0.03, pos.z, Math.cos(a) * sp, 0, Math.sin(a) * sp, 1.5 + Math.random(), 0.35 + 0.3 * s, 2);
    }
    ripple(pos.x, pos.z, s);
  }

  // ---------- waterfall emitters ----------
  let prewarmed = false;
  const falls = W.FALLS.map(f => ({ ...f, acc: 0, accD: 0, accT: 0 }));
  const camPos = new THREE.Vector3();
  function emitFalls(dt, age = 0) {
    for (const f of falls) {
      const dx = f.bx - camPos.x, dz = f.bz - camPos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 520 * 520) continue;
      const near = 1 - Math.sqrt(d2) / 520;
      const scale = Math.min(1.6, f.drop / 18);
      f.acc += dt * (4 + 10 * near) * scale;
      f.accD += dt * (10 + 30 * near) * scale;
      f.accT += dt * 2.5 * scale;
      while (f.acc >= 1) {
        f.acc -= 1;
        const a = (Math.random() * 2 - 1) * f.w * 0.9;
        const x = f.bx - f.dirZ * a + f.dirX * (Math.random() * 4 - 1), z = f.bz + f.dirX * a + f.dirZ * (Math.random() * 4 - 1);
        parts.spawn(x, f.by + 0.5, z, f.dirX * 2.5 + (Math.random() - 0.5) * 2.5, 1.0 + Math.random() * 2, f.dirZ * 2.5 + (Math.random() - 0.5) * 2.5,
          3.5 + Math.random() * 2.5, 2.5 + Math.random() * 2.5 * scale, 1, age);
      }
      while (f.accD >= 1) {
        f.accD -= 1;
        const a = (Math.random() * 2 - 1) * f.w;
        const x = f.bx - f.dirZ * a, z = f.bz + f.dirX * a;
        const sp = 2 + Math.random() * 4;
        const ang = Math.random() * Math.PI * 2;
        parts.spawn(x, f.by + 0.3, z, Math.cos(ang) * sp * 0.6 + f.dirX * 2, 3 + Math.random() * 5, Math.sin(ang) * sp * 0.6 + f.dirZ * 2,
          0.8 + Math.random() * 0.7, 0.12 + Math.random() * 0.2, 0, age);
      }
      while (f.accT >= 1) {
        // spray peeling off the lip / face of the fall
        f.accT -= 1;
        const t = Math.random();
        const a = (Math.random() * 2 - 1) * f.w;
        const x = f.x + (f.bx - f.x) * t - f.dirZ * a, z = f.z + (f.bz - f.z) * t + f.dirX * a;
        const y = f.top + (f.by - f.top) * t;
        parts.spawn(x, y, z, f.dirX * 1.5, 0.3, f.dirZ * 1.5, 2.5 + Math.random() * 2, 1.6 + 2 * Math.random(), 1, age);
      }
    }
  }

  // ---------- player interaction (guarded; player API may not exist) ----------
  let prevIn = null, wakeT = 0;
  const prevP = new THREE.Vector3();
  function playerWater(dt) {
    const p = ctx.systems.player?.position || ctx.systems.player?.getPosition?.();
    if (!p || !p.isVector3) return;
    const s = W.getWaterHeight(p.x, p.z);
    const inW = s !== null && p.y < s + 0.05;
    if (prevIn !== null && dt > 0) {
      const vy = (p.y - prevP.y) / dt;
      if (inW && !prevIn && vy < -2) {
        const st = Math.min(3, -vy / 6);
        splash(p, st);
        ctx.events?.emit?.('splash', { position: p.clone(), strength: st });
      }
      if (inW && s - p.y < 2.2) {
        const sp = Math.hypot(p.x - prevP.x, p.z - prevP.z) / dt;
        wakeT -= dt;
        if (sp > 0.8 && wakeT <= 0) { ripple(p.x, p.z, Math.min(1, sp / 6)); wakeT = 0.35; }
      }
    }
    prevIn = inW; prevP.copy(p);
  }

  const api = {
    group, ocean, lakes, rivers, falls: W.FALLS,
    getWaterHeight: W.getWaterHeight,
    getWaterDepth: W.getWaterDepth,
    getWaterKind: W.getWaterKind,
    getFlow: W.getFlow,
    isUnderwater: W.isUnderwater,
    splash, ripple,
    colors,
    update(dt) {
      W.setWaterTime(U.uTime.value);
      const nc = ctx.cameraOverride?.pos || camera.position;
      if (nc.distanceToSquared(camPos) > 300 * 300) prewarmed = false;   // teleport / preset jump
      camPos.copy(nc);
      // ocean grid follows the camera (snapped so the near grid doesn't crawl)
      ocean.position.set(Math.round(camPos.x / 2) * 2, 0, Math.round(camPos.z / 2) * 2);
      // sky state
      const sky = ctx.systems.sky;
      const day = sky?.getDaylight ? sky.getDaylight() : THREE.MathUtils.smoothstep(U.uSunDir.value.y, -0.1, 0.15);
      skyState.value.x = du.uSky ? du.uSky.value.x : 1 - day;
      skyState.value.y = day;
      if (!prewarmed) {
        // fill the mist/spray volumes as if the falls had been running for a while
        prewarmed = true;
        for (let k = 60; k > 0; k--) emitFalls(0.1, k * 0.1);
      }
      emitFalls(Math.min(dt, 0.1));
      playerWater(dt);
      parts.flush(camera, ctx.renderer);
      // underwater overlay
      const cp = camera.position;
      const s = W.getWaterHeight(cp.x, cp.z);
      const under = s !== null && cp.y < s - 0.05;
      underwater.visible = under;
      if (under) uwMat.uniforms.uDepth.value = s - cp.y;
    },
  };
  return api;
}
