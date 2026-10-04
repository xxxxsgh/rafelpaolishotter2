// sky system — sky dome, sun/moon, day/night, weather, lighting, fog, post FX.
// See src/main.js for the contract and DESIGN.md for ownership.
//
// API (ctx.systems.sky):
//   setTime(h) / getTime()        hours 0..24
//   timeScale                     1 = 24 real minutes per in-game day
//   setWeather(name, instant?) / getWeather()   'clear'|'cloudy'|'rain'|'storm'|'fog'|'snow'
//   autoWeather (bool)            random weather progression
//   strikeLightning()             force a strike (storm or not)
//   sunLight, hemiLight           the three.js lights
//   getDaylight()                 0 (night) .. 1 (full day)
//   isNight()
//   post                          post pipeline handle (enabled flag, bloom, grade uniforms)
// Writes every frame: uniforms.uSunDir/uSunColor (key light: sun by day, moon by night),
// uSkyColor/uGroundColor (hemisphere fill), uFogColor/uFogDensity (linear: fog = 1-exp(-d*dist)),
// uRain, uWetness, uWindStrength, uWindDir.
// Events: 'lightning' {position, distance, delay}, 'weatherChange' {from, to}, 'timeChange' {hour}.
import * as THREE from 'three';
import { installFogChunks, fogShared } from './fogChunk.js';
import { makeCloudNoise } from './noiseTex.js';
import { makePaletteState, samplePalette } from './palette.js';
import { createSkyDome } from './skyDome.js';
import { createPrecip } from './precip.js';
import { createLightning } from './lightning.js';
import { createPost } from './post.js';

const WEATHER = {
  //          cov   overcast fog  wind  rain snow storm cirrus
  clear:  { cov: 0.4, oc: 0.0, fog: 1.0, wind: 0.55, rain: 0, snow: 0, storm: 0, cirrus: 0.35 },
  cloudy: { cov: 0.62, oc: 0.14, fog: 1.25, wind: 0.8, rain: 0, snow: 0, storm: 0, cirrus: 0.3 },
  rain:   { cov: 0.86, oc: 0.78, fog: 2.2, wind: 1.0, rain: 1, snow: 0, storm: 0.25, cirrus: 0.0 },
  storm:  { cov: 0.96, oc: 1.0, fog: 2.6, wind: 1.6, rain: 1, snow: 0, storm: 1, cirrus: 0.0 },
  fog:    { cov: 0.5, oc: 0.5, fog: 7.0, wind: 0.2, rain: 0, snow: 0, storm: 0, cirrus: 0.0 },
  snow:   { cov: 0.84, oc: 0.7, fog: 3.2, wind: 0.7, rain: 0, snow: 1, storm: 0, cirrus: 0.0 },
};
const NEXT = {
  clear: [['clear', 2], ['cloudy', 3], ['fog', 0.5]],
  cloudy: [['clear', 2], ['rain', 2], ['cloudy', 1], ['storm', 0.6]],
  rain: [['cloudy', 2], ['storm', 1], ['rain', 1]],
  storm: [['rain', 2], ['cloudy', 1]],
  fog: [['clear', 2], ['cloudy', 1]],
  snow: [['cloudy', 2], ['snow', 1]],
};
const BASE_FOG = 0.00112;
const SHADOW_R = 95, SHADOW_MAP = 2048;

export async function init(ctx) {
  const { scene, uniforms, renderer, camera } = ctx;
  installFogChunks();
  const noiseTex = makeCloudNoise();
  fogShared.wbCloudTex.value = noiseTex;

  scene.background = null;
  scene.fog = new THREE.FogExp2(0xa8c4dc, BASE_FOG);

  // ---------- lights ----------
  const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x5a5236, 1.0);
  const sun = new THREE.DirectionalLight(0xfff1d8, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
  const sc = sun.shadow.camera;
  sc.left = -SHADOW_R; sc.right = SHADOW_R; sc.top = SHADOW_R; sc.bottom = -SHADOW_R;
  sc.near = 1; sc.far = 1400;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.06;
  sun.shadow.radius = 3;
  scene.add(hemi, sun, sun.target);
  renderer.shadowMap.type = THREE.PCFShadowMap;   // PCFSoft was removed in r18x

  // ---------- sky ----------
  const dome = createSkyDome();
  scene.add(dome.mesh);
  const precip = createPrecip(scene);
  const lightning = createLightning(scene);

  // ---------- post ----------
  let post = null;
  try {
    // MSAA x4 on real GPUs; software rasterisers (SwiftShader screenshots) skip it — SMAA still runs.
    let soft = false;
    try {
      const gl = renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      soft = /swiftshader|llvmpipe|software/i.test(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '');
    } catch { /* ignore */ }
    const msaaQ = ctx.params.get('msaa');
    post = createPost(ctx, { samples: msaaQ !== null ? +msaaQ : soft ? 0 : 4 });
    renderer.toneMapping = THREE.NoToneMapping;
    ctx.engine.renderFn = () => {
      if (post.enabled) {
        try { post.render(); return; } catch (e) { console.error('[sky] post failed, falling back', e); post.enabled = false; renderer.toneMapping = THREE.ACESFilmicToneMapping; }
      }
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    };
    ctx.renderFn = ctx.engine.renderFn;
  } catch (e) {
    console.error('[sky] post init failed', e);
  }

  // ---------- state ----------
  const pal = makePaletteState();
  let hour = 10, day = 0, lastHourInt = -1;
  let weather = 'clear';
  const cur = { ...WEATHER.clear };
  let target = WEATHER.clear;
  let weatherTimer = 240 + Math.random() * 300;
  let wetness = 0, lightningTimer = 6, cloudT = 0, cirrusT = 0, gustT = 0;
  const sunDir = new THREE.Vector3(), moonDir = new THREE.Vector3(), keyDir = new THREE.Vector3();
  const keyCol = new THREE.Color(), tmpC = new THREE.Color(), grey = new THREE.Color(), tmpC2 = new THREE.Color();
  const lightU = new THREE.Vector3(), lightR = new THREE.Vector3(), lightF = new THREE.Vector3(), snapP = new THREE.Vector3();
  const windV = new THREE.Vector3();
  const starAxis = new THREE.Vector3(0.0, 0.8, -0.6).normalize();
  const starQ = new THREE.Quaternion(), starM4 = new THREE.Matrix4();
  const camDir = new THREE.Vector3();
  const OVERCAST = new THREE.Color().setHex(0x8e9aa6);
  const fogCol = new THREE.Color(), WHITE = new THREE.Color(1, 1, 1);

  // Periodic sun path: 5:30 -> 19:30 is day (angle 0..PI), the rest of the clock is night (PI..2PI).
  function orbitAngle(h) {
    h = ((h % 24) + 24) % 24;
    const t = h < 5.5 ? h + 24 : h;
    return t <= 19.5 ? (t - 5.5) / 14 * Math.PI : Math.PI + (t - 19.5) / 10 * Math.PI;
  }
  function orbit(h, out) {
    // sunrise in the east (-x), sunset in the west (+x), noon high in the south (-z)
    const a = orbitAngle(h);
    const el = Math.sin(a);
    out.set(-Math.cos(a), el * 0.86, -el * 0.36 - 0.12).normalize();
    return out;
  }
  const PHASE0 = 0.095;
  function moonPhase(h) { return (((day + h / 24) / 8 + PHASE0) % 1 + 1) % 1; }   // 8-day cycle; 0 = full
  function moonOrbit(h, out) {
    const a = orbitAngle(h + 12 + moonPhase(h) * 24);
    const el = Math.sin(a);
    out.set(-Math.cos(a), el * 0.8 + 0.05, -el * 0.3 + 0.12).normalize();
    return out;
  }

  const api = {
    timeScale: 1,
    autoWeather: true,
    sunLight: sun, hemiLight: hemi, post,
    setTime(h) { hour = ((h % 24) + 24) % 24; api._apply(0); },
    getTime: () => hour,
    getDay: () => day,
    getMoonPhase: () => moonPhase(hour),
    setWeather(name, instant) {
      if (!WEATHER[name]) return;
      const from = weather;
      weather = name; target = WEATHER[name];
      if (instant || ctx.shotMode) { Object.assign(cur, target); wetness = target.rain > 0 ? 0.9 : wetness; }
      weatherTimer = 240 + Math.random() * 360;
      if (from !== name) ctx.events.emit('weatherChange', { from, to: name });
    },
    getWeather: () => weather,
    getDaylight: () => THREE.MathUtils.smoothstep(sunDir.y, -0.1, 0.15),
    isNight: () => sunDir.y < -0.05,
    getSunDir: () => sunDir,
    getMoonDir: () => moonDir,
    strikeLightning() {
      camera.getWorldDirection(camDir);
      const info = lightning.strike(camera.position, camDir, (x, z) => Math.max(ctx.world.getHeight(x, z), ctx.world.WATER_LEVEL));
      ctx.events.emit('lightning', info);
      return info;
    },
    update(dt) { api._apply(dt); },

    _apply(dt) {
      const frozen = ctx.shotMode;
      // ---------- clock ----------
      if (!frozen && dt > 0) {
        hour += dt * api.timeScale / 60;
        if (hour >= 24) { hour -= 24; day++; }
      }
      const hi = Math.floor(hour);
      if (hi !== lastHourInt) { if (lastHourInt >= 0) ctx.events.emit('timeChange', { hour }); lastHourInt = hi; }

      // ---------- weather ----------
      if (!frozen && api.autoWeather && dt > 0) {
        weatherTimer -= dt;
        if (weatherTimer <= 0) {
          const opts = NEXT[weather];
          let sum = 0; for (const o of opts) sum += o[1];
          let r = Math.random() * sum, pick = opts[0][0];
          for (const o of opts) { r -= o[1]; if (r <= 0) { pick = o[0]; break; } }
          const highSnow = ctx.world.getBiome?.(ctx.focus.x, ctx.focus.z) === 'snow';
          if (highSnow && (pick === 'rain' || pick === 'storm')) pick = 'snow';
          if (!highSnow && pick === 'snow') pick = 'cloudy';
          api.setWeather(pick);
        }
      }
      const k = dt > 0 ? 1 - Math.exp(-dt / 18) : 1;
      for (const key in cur) cur[key] += (target[key] - cur[key]) * (dt > 0 ? k : 0);
      // snow when precipitating in the snow biome / at altitude
      const cold = ctx.world.getBiome?.(ctx.focus.x, ctx.focus.z) === 'snow' || ctx.focus.y > 205;
      const precipAmt = Math.max(cur.rain, cur.snow);
      const rainAmt = cold ? 0 : cur.rain;
      const snowAmt = cold ? precipAmt : cur.snow;

      // ---------- sun / moon ----------
      orbit(hour, sunDir);
      moonOrbit(hour, moonDir);
      const elev = Math.asin(THREE.MathUtils.clamp(sunDir.y, -1, 1)) * 180 / Math.PI;
      samplePalette(elev, pal);
      const night = THREE.MathUtils.smoothstep(-elev, -2, 12);
      const oc = cur.oc, storm = cur.storm;

      // overcast: desaturate + darken toward weather grey (luminance matched)
      const lumH = pal.horizon.r * 0.2126 + pal.horizon.g * 0.7152 + pal.horizon.b * 0.0722;
      grey.copy(OVERCAST).multiplyScalar(lumH / 0.31 * (1 - 0.6 * storm));
      pal.zenith.lerp(tmpC.copy(grey).multiplyScalar(0.82), oc * 0.92);
      pal.horizon.lerp(grey, oc * 0.85);
      pal.glow.multiplyScalar(1 - oc * 0.85);
      pal.cLit.lerp(tmpC.copy(grey).multiplyScalar(1.2 - storm * 0.3), oc * 0.85);
      pal.cShade.lerp(tmpC.copy(grey).multiplyScalar(0.55 - storm * 0.25), oc * 0.9);
      pal.sky.lerp(tmpC.copy(grey).multiplyScalar(1.05), oc * 0.7);
      pal.sunI *= 1 - oc * 0.82;
      pal.hemiI *= 1 + oc * 0.25 - storm * 0.25;
      pal.band *= 1 - oc;

      // lightning
      if (cur.storm > 0.6 && !frozen && dt > 0) {
        lightningTimer -= dt;
        if (lightningTimer <= 0) { api.strikeLightning(); lightningTimer = 3 + Math.random() * 10; }
      }
      const flash = lightning.update(frozen ? 1 / 60 : dt);

      // ---------- key light ----------
      const sunW = THREE.MathUtils.smoothstep(elev, -4, 1.5);
      const moonUp = THREE.MathUtils.smoothstep(moonDir.y, -0.02, 0.15);
      const phaseLit = 0.5 + 0.5 * -sunDir.dot(moonDir);   // 1 = full moon
      if (sunW > 0.02) {
        keyDir.copy(sunDir);
        keyCol.copy(pal.sun);
        sun.intensity = pal.sunI * sunW;
      } else {
        keyDir.copy(moonDir);
        keyCol.setRGB(0.55, 0.75, 0.9);
        sun.intensity = (0.15 + 0.3 * phaseLit) * moonUp * (1 - sunW) * (1 - oc * 0.8);
      }
      if (keyDir.y < 0.06) { keyDir.y = 0.06; keyDir.normalize(); }
      sun.color.copy(keyCol);
      hemi.color.copy(pal.sky);
      hemi.groundColor.copy(pal.gnd);
      hemi.intensity = pal.hemiI + flash * 1.1;

      // shadow camera follows focus with texel snapping (no shimmer)
      const f = ctx.focus;
      lightF.copy(keyDir).negate();
      lightR.set(0, 1, 0).cross(lightF);
      if (lightR.lengthSq() < 1e-6) lightR.set(1, 0, 0);
      lightR.normalize();
      lightU.crossVectors(lightF, lightR);
      const texel = (2 * SHADOW_R) / SHADOW_MAP;
      const pr = Math.round(f.dot(lightR) / texel) * texel;
      const pu = Math.round(f.dot(lightU) / texel) * texel;
      const pf = f.dot(lightF);
      snapP.copy(lightR).multiplyScalar(pr).addScaledVector(lightU, pu).addScaledVector(lightF, pf);
      sun.target.position.copy(snapP);
      sun.position.copy(snapP).addScaledVector(keyDir, 700);
      sun.target.updateMatrixWorld();
      sun.updateMatrixWorld();

      // ---------- fog ----------
      const fogDensity = BASE_FOG * cur.fog * (1 + night * 0.25);
      // terrain haze: slightly deeper + bluer than the sky horizon so far ridges read as layered silhouettes
      fogCol.copy(pal.horizon).multiply(tmpC.setRGB(0.76, 0.86, 0.98).lerp(WHITE, Math.max(night, oc)));
      scene.fog.color.copy(fogCol);
      scene.fog.density = fogDensity;
      const fs = fogShared;
      fs.wbFogSun.value[0] = sunDir.x; fs.wbFogSun.value[1] = sunDir.y; fs.wbFogSun.value[2] = sunDir.z;
      fs.wbFogSun.value[3] = pal.band;
      fs.wbFogGlow.value[0] = pal.glow.r * (1 - night); fs.wbFogGlow.value[1] = pal.glow.g * (1 - night); fs.wbFogGlow.value[2] = pal.glow.b * (1 - night);
      fs.wbFogGlow.value[3] = 1 / (130 + cur.fog * 10);
      fs.wbFogParams.value[0] = cur.fog > 4 ? -10 : 0;
      fs.wbFogParams.value[1] = 45;
      fs.wbFogParams.value[2] = Math.min(0.985, 0.88 + cur.fog * 0.02);

      // clouds
      if (dt > 0 && !frozen) { cloudT += dt; }
      cloudT += 0;
      const wd = uniforms.uWindDir.value;
      const drift = (cloudT + 40) * 0.0011 * (0.6 + cur.wind);
      fs.wbCloudParams.value[0] = wd.x * drift * 0.25 + 0.13;
      fs.wbCloudParams.value[1] = wd.y * drift * 0.25 + 0.71;
      fs.wbCloudParams.value[2] = cur.cov;
      fs.wbCloudParams.value[3] = 0.42 * (1 - night) * (1 - oc * 0.85) * sunW;
      fs.wbCloudShade.value[0] = 0.66; fs.wbCloudShade.value[1] = 0.73; fs.wbCloudShade.value[2] = 0.88;

      // ---------- sky dome ----------
      const du = dome.uniforms;
      du.uZenith.value.copy(pal.zenith);
      du.uHorizon.value.copy(pal.horizon);
      du.uFogCol.value.copy(fogCol);
      du.uSunCol.value.copy(pal.sun).multiplyScalar(1 - night * 0.9);
      du.uSunDisk.value.copy(sunDir);
      du.uMoonDir.value.copy(moonDir);
      du.uMoonPhaseDir.value.copy(sunDir);
      du.uCloudLit.value.copy(pal.cLit);
      du.uCloudShade.value.copy(pal.cShade);
      du.uSky.value.set(night, oc, flash, 1 - oc * 0.85);
      du.uCirrus.value.set(cirrusT * 0.0006 * wd.x + 0.3, cirrusT * 0.0006 * wd.y, cur.cirrus * (1 - night * 0.6), 0);
      du.uTime.value = uniforms.uTime.value;
      if (dt > 0 && !frozen) cirrusT += dt;
      starQ.setFromAxisAngle(starAxis, (hour / 24) * Math.PI * 2);
      starM4.makeRotationFromQuaternion(starQ);
      du.uStarRot.value.setFromMatrix4(starM4);

      // ---------- wind ----------
      gustT += dt;
      const gust = cur.storm * (0.5 + 0.5 * Math.sin(gustT * 0.7) * Math.sin(gustT * 1.9 + 1.3)) * 0.9;
      uniforms.uWindStrength.value = cur.wind + gust + 0.12 * Math.sin(gustT * 0.23);
      if (dt > 0 && cur.storm > 0.2) {
        const a = Math.atan2(wd.y, wd.x) + Math.sin(gustT * 0.05) * 0.002 * cur.storm;
        wd.set(Math.cos(a), Math.sin(a));
      }

      // ---------- wetness ----------
      if (dt > 0 && !frozen) {
        if (rainAmt > 0.3) wetness = Math.min(1, wetness + dt / 45 * rainAmt);
        else wetness = Math.max(0, wetness - dt / 150);
      }
      if (frozen) wetness = Math.max(wetness, rainAmt * 0.9);

      // ---------- precipitation ----------
      const ws = uniforms.uWindStrength.value;
      windV.set(wd.x * ws * 4, 0, wd.y * ws * 4);
      tmpC2.copy(hemi.color).multiplyScalar(hemi.intensity * 0.55).add(tmpC.copy(keyCol).multiplyScalar(sun.intensity * 0.12));
      precip.update(uniforms.uTime.value % 1000, rainAmt, snowAmt, windV, tmpC2, flash);

      // ---------- shared uniforms ----------
      uniforms.uSunDir.value.copy(keyDir);
      uniforms.uSunColor.value.copy(keyCol).multiplyScalar(sun.intensity / 3);
      uniforms.uSkyColor.value.copy(pal.sky).multiplyScalar(hemi.intensity);
      uniforms.uGroundColor.value.copy(pal.gnd).multiplyScalar(hemi.intensity);
      uniforms.uFogColor.value.copy(fogCol);
      uniforms.uFogDensity.value = fogDensity;
      uniforms.uRain.value = rainAmt;
      uniforms.uWetness.value = wetness;

      // ---------- post ----------
      if (post) {
        const g = post.grade;
        g.uExposure.value = pal.exp * (1 + oc * 0.1 - storm * 0.22);
        g.uFlash.value = flash;
        g.uSat.value = 1.1 - oc * 0.2 - storm * 0.1 - night * 0.25;
        g.uContrast.value = 1.02 - oc * 0.06;
        // warm highlights at golden hour, cool shadows always, teal night
        const golden = THREE.MathUtils.smoothstep(elev, -3, 2) * (1 - THREE.MathUtils.smoothstep(elev, 10, 25));
        g.uHighTint.value.setRGB(1.03 + golden * 0.04, 1.0 + golden * 0.005, 0.95 - golden * 0.04).lerp(tmpC.setRGB(0.95, 1.02, 1.04), night);
        g.uShadowTint.value.setRGB(0.88 - night * 0.08 - storm * 0.06, 0.95 + night * 0.02 + storm * 0.03, 1.06 + night * 0.02 - storm * 0.02);
        if (storm > 0.01) g.uHighTint.value.lerp(tmpC.setRGB(0.94, 1.01, 0.98), storm);
        g.uVignette.value = 0.26 + oc * 0.1;
        g.uWet.value = wetness;
        post.grade.uBloom.value = 0.28 + golden * 0.12 + night * 0.08;
        post.setSun(sunDir, pal.sun, THREE.MathUtils.smoothstep(sunDir.y, -0.02, 0.05) * (1 - oc * 0.9));
      }
      renderer.setClearColor(pal.horizon, 1);
    },
  };
  api.setTime(hour);
  return api;
}
