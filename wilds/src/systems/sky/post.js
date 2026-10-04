// Post pipeline (owns ctx.renderFn):
//   scene -> HDR MSAA target (+depth)
//   -> god rays (half res, depth-masked radial blur toward the sun)
//   -> bloom (dual-filter down/up chain, soft threshold, 6 mips; cheap and wide)
//   -> grade: exposure, neutral filmic tonemap, painterly split-tone grade,
//      saturation, lens ghosts toward the sun, lightning flash, vignette, sRGB, dither
//   -> SMAA to screen.
import * as THREE from 'three';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const VS = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// Dual-filter (Kawase-style) bloom: prefilter at 1/2, downsample to 1/64, upsample back.
function createBloom(W, H, src) {
  const LEVELS = 6;
  const rts = [];
  const opts = { type: THREE.HalfFloatType, depthBuffer: false };
  for (let i = 0; i < LEVELS; i++) rts.push(new THREE.WebGLRenderTarget(1, 1, opts));
  const ups = [];
  for (let i = 0; i < LEVELS - 1; i++) ups.push(new THREE.WebGLRenderTarget(1, 1, opts));
  const pre = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: src }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 0.85 }, uKnee: { value: 0.6 } },
    vertexShader: VS, depthTest: false, depthWrite: false,
    fragmentShader: `uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold, uKnee; varying vec2 vUv;
      vec3 q(vec2 o){ vec3 c = texture2D(tSrc, vUv + o * uTexel).rgb; return min(c, vec3(40.0)); }
      void main(){
        vec3 c = (q(vec2(-1.0,-1.0)) + q(vec2(1.0,-1.0)) + q(vec2(-1.0,1.0)) + q(vec2(1.0,1.0))) * 0.25;
        float br = max(c.r, max(c.g, c.b));
        float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
        soft = soft * soft / (4.0 * uKnee + 1e-4);
        float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
        gl_FragColor = vec4(c * contrib, 1.0);
      }`,
  }));
  const down = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
    vertexShader: VS, depthTest: false, depthWrite: false,
    fragmentShader: `uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
      void main(){
        vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
        c += texture2D(tSrc, vUv + uTexel * vec2(-1.0,-1.0)).rgb;
        c += texture2D(tSrc, vUv + uTexel * vec2( 1.0,-1.0)).rgb;
        c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
        c += texture2D(tSrc, vUv + uTexel * vec2( 1.0, 1.0)).rgb;
        gl_FragColor = vec4(c / 8.0, 1.0);
      }`,
  }));
  const up = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null }, tBase: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 0.75 } },
    vertexShader: VS, depthTest: false, depthWrite: false,
    fragmentShader: `uniform sampler2D tSrc, tBase; uniform vec2 uTexel; uniform float uRadius; varying vec2 vUv;
      void main(){
        vec2 t = uTexel;
        vec3 c = texture2D(tSrc, vUv + vec2(-2.0, 0.0) * t).rgb;
        c += texture2D(tSrc, vUv + vec2( 2.0, 0.0) * t).rgb;
        c += texture2D(tSrc, vUv + vec2( 0.0,-2.0) * t).rgb;
        c += texture2D(tSrc, vUv + vec2( 0.0, 2.0) * t).rgb;
        c += texture2D(tSrc, vUv + vec2(-1.0,-1.0) * t).rgb * 2.0;
        c += texture2D(tSrc, vUv + vec2( 1.0,-1.0) * t).rgb * 2.0;
        c += texture2D(tSrc, vUv + vec2(-1.0, 1.0) * t).rgb * 2.0;
        c += texture2D(tSrc, vUv + vec2( 1.0, 1.0) * t).rgb * 2.0;
        gl_FragColor = vec4(texture2D(tBase, vUv).rgb + c / 12.0 * uRadius, 1.0);
      }`,
  }));
  const api = {
    texture: ups[0].texture,
    threshold: pre.material.uniforms.uThreshold,
    setSize(w, h) {
      let ww = w, hh = h;
      for (let i = 0; i < LEVELS; i++) {
        ww = Math.max(1, ww >> 1); hh = Math.max(1, hh >> 1);
        rts[i].setSize(ww, hh);
        if (i < LEVELS - 1) ups[i].setSize(ww, hh);
      }
    },
    render(renderer) {
      pre.material.uniforms.uTexel.value.set(0.5 / rts[0].width, 0.5 / rts[0].height);
      renderer.setRenderTarget(rts[0]); pre.render(renderer);
      for (let i = 1; i < LEVELS; i++) {
        down.material.uniforms.tSrc.value = rts[i - 1].texture;
        down.material.uniforms.uTexel.value.set(1 / rts[i - 1].width, 1 / rts[i - 1].height);
        renderer.setRenderTarget(rts[i]); down.render(renderer);
      }
      for (let i = LEVELS - 2; i >= 0; i--) {
        const srcT = i === LEVELS - 2 ? rts[LEVELS - 1] : ups[i + 1];
        up.material.uniforms.tSrc.value = srcT.texture;
        up.material.uniforms.tBase.value = rts[i].texture;
        up.material.uniforms.uTexel.value.set(0.5 / srcT.width, 0.5 / srcT.height);
        renderer.setRenderTarget(ups[i]); up.render(renderer);
      }
    },
  };
  api.setSize(W, H);
  return api;
}

export function createPost(ctx, { samples = 4 } = {}) {
  const { renderer, scene, camera } = ctx;
  const size = new THREE.Vector2();
  const pr = renderer.getPixelRatio();
  renderer.getSize(size);
  let W = Math.max(1, Math.floor(size.x * pr)), H = Math.max(1, Math.floor(size.y * pr));

  const depthTex = new THREE.DepthTexture(W, H);
  depthTex.type = THREE.UnsignedIntType;
  const sceneRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples, depthTexture: depthTex });
  sceneRT.texture.name = 'wb.scene';
  const godRT = new THREE.WebGLRenderTarget(W >> 1, H >> 1, { type: THREE.HalfFloatType, depthBuffer: false });
  const ldrRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthBuffer: false });

  const bloom = createBloom(W, H, sceneRT.texture);
  const smaa = new SMAAPass();
  smaa.renderToScreen = true;
  smaa.setSize(W, H);

  const godU = {
    tScene: { value: sceneRT.texture },
    tDepth: { value: depthTex },
    uSunUV: { value: new THREE.Vector2(0.5, 0.5) },
    uAspect: { value: W / H },
    uOn: { value: 0 },
  };
  const godQuad = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: godU, vertexShader: VS, depthTest: false, depthWrite: false,
    fragmentShader: /* glsl */`
      uniform sampler2D tScene, tDepth;
      uniform vec2 uSunUV; uniform float uAspect, uOn;
      varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        if (uOn <= 0.001) { gl_FragColor = vec4(0.0); return; }
        const int N = 24;
        vec2 delta = (uSunUV - vUv) / float(N) * 0.92;
        vec2 uv = vUv + delta * hash(vUv * 731.0);
        float decay = 1.0, acc = 0.0;
        for (int i = 0; i < N; i++) {
          float sky = step(0.99999, texture2D(tDepth, uv).r);
          vec3 c = texture2D(tScene, uv).rgb;
          vec2 dd = (uv - uSunUV) * vec2(uAspect, 1.0);
          float near = exp(-dot(dd, dd) * 9.0);
          acc += sky * min(dot(c, vec3(0.3, 0.5, 0.2)), 3.0) * near * decay;
          decay *= 0.95;
          uv += delta;
        }
        gl_FragColor = vec4(vec3(acc / float(N)), 1.0);
      }`,
  }));

  const gradeU = {
    tDiffuse: { value: sceneRT.texture },
    tGod: { value: godRT.texture },
    tBloom: { value: bloom.texture },
    uBloom: { value: 0.3 },
    tDepth: { value: depthTex },
    uExposure: { value: 1 },
    uSat: { value: 1.08 },
    uContrast: { value: 1.0 },
    uShadowTint: { value: new THREE.Color(0.86, 0.94, 1.06) },
    uHighTint: { value: new THREE.Color(1.04, 1.0, 0.94) },
    uLift: { value: 0.012 },
    uVignette: { value: 0.28 },
    uFlash: { value: 0 },
    uSunUV: { value: new THREE.Vector2(0.5, 0.5) },
    uSunCol: { value: new THREE.Color(1, 0.9, 0.7) },
    uSunVis: { value: 0 },
    uGodI: { value: 0.0 },
    uAspect: { value: W / H },
    uRes: { value: new THREE.Vector2(W, H) },
    uWet: { value: 0 },
  };
  const gradeQuad = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: gradeU, vertexShader: VS, depthTest: false, depthWrite: false,
    fragmentShader: /* glsl */`
      uniform sampler2D tDiffuse, tGod, tDepth, tBloom;
      uniform float uBloom, uExposure, uSat, uContrast, uLift, uVignette, uFlash, uSunVis, uGodI, uAspect, uWet;
      uniform vec3 uShadowTint, uHighTint, uSunCol;
      uniform vec2 uSunUV, uRes;
      varying vec2 vUv;

      // Khronos PBR-neutral style tonemap: soft shoulder, hue preserving.
      vec3 neutral(vec3 color) {
        const float startCompression = 0.8 - 0.04;
        const float desaturation = 0.15;
        float x = min(color.r, min(color.g, color.b));
        float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
        color -= offset;
        float peak = max(color.r, max(color.g, color.b));
        if (peak < startCompression) return color;
        const float d = 1.0 - startCompression;
        float newPeak = 1.0 - d * d / (peak + d - startCompression);
        color *= newPeak / peak;
        float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
        return mix(color, vec3(newPeak), g);
      }
      vec3 toSRGB(vec3 c) {
        c = clamp(c, 0.0, 1.0);
        return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
      }
      float sunOcc() {
        float v = 0.0;
        vec2 px = vec2(6.0) / uRes;
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++)
          v += step(0.99999, texture2D(tDepth, clamp(uSunUV + vec2(x, y) * px, 0.001, 0.999)).r);
        return v / 9.0;
      }
      void main() {
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        c += texture2D(tBloom, vUv).rgb * uBloom;
        // god rays (warm, additive)
        c += texture2D(tGod, vUv).r * uSunCol * uGodI;
        // lens ghosts along the sun->centre axis (subtle, painterly)
        if (uSunVis > 0.001) {
          float occ = sunOcc() * uSunVis;
          if (occ > 0.001) {
            vec2 axis = vec2(0.5) - uSunUV;
            vec3 gh = vec3(0.0);
            for (int i = 1; i <= 4; i++) {
              float fi = float(i);
              vec2 gp = uSunUV + axis * (fi * 0.48 + 0.1);
              vec2 dd = (vUv - gp) * vec2(uAspect, 1.0);
              float r = 0.018 + 0.03 * fract(fi * 0.618);
              float ring = (1.0 - smoothstep(r * 0.7, r, length(dd)));
              vec3 tint = mix(vec3(0.5, 0.9, 1.0), vec3(1.0, 0.75, 0.45), fract(fi * 0.37));
              gh += tint * ring * 0.045;
            }
            // anamorphic-ish soft streak and wide veil
            vec2 sd = (vUv - uSunUV) * vec2(uAspect, 1.0);
            gh += uSunCol * exp(-abs(sd.y) * 90.0) * exp(-abs(sd.x) * 2.5) * 0.05;
            gh += uSunCol * exp(-length(sd) * 3.0) * 0.07;
            c += gh * occ * uSunCol;
          }
        }
        c *= uExposure;
        c += vec3(0.75, 0.82, 1.0) * uFlash * 0.12;
        c = neutral(c);
        // painterly grade
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, uSat);
        c *= mix(uShadowTint, uHighTint, smoothstep(0.05, 0.7, l));
        c = (c - 0.45) * uContrast + 0.45;
        c = c + uLift * (1.0 - c);   // lifted, never-crushed blacks
        // vignette (soft, slightly cool)
        vec2 v = (vUv - 0.5) * vec2(uAspect, 1.0);
        float vig = smoothstep(0.35, 1.05, length(v));
        c *= 1.0 - vig * uVignette * vec3(1.0, 0.97, 0.92);
        vec3 o = toSRGB(max(c, 0.0));
        // dither to kill banding in the sky gradient
        o += (fract(sin(dot(vUv * uRes, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
        gl_FragColor = vec4(o, 1.0);
      }`,
  }));

  function setSize(w, h) {
    const p = renderer.getPixelRatio();
    W = Math.max(1, Math.floor(w * p)); H = Math.max(1, Math.floor(h * p));
    sceneRT.setSize(W, H);
    godRT.setSize(W >> 1, H >> 1);
    ldrRT.setSize(W, H);
    bloom.setSize(W, H);
    smaa.setSize(W, H);
    godU.uAspect.value = gradeU.uAspect.value = W / H;
    gradeU.uRes.value.set(W, H);
  }
  ctx.engine.onResize?.(setSize);

  const sunNDC = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  const api = {
    enabled: true,
    bloom, smaa, grade: gradeU, god: godU,
    sceneRT,
    // world-space sun direction -> screen uv + visibility
    setSun(sunDir, sunCol, sunAbove) {
      sunNDC.copy(camera.position).addScaledVector(sunDir, 1000).project(camera);
      camera.getWorldDirection(camDir);
      const facing = camDir.dot(sunDir);
      const onScreen = facing > 0 && Math.abs(sunNDC.x) < 1.4 && Math.abs(sunNDC.y) < 1.4;
      const u = sunNDC.x * 0.5 + 0.5, v = sunNDC.y * 0.5 + 0.5;
      godU.uSunUV.value.set(u, v);
      gradeU.uSunUV.value.set(u, v);
      gradeU.uSunCol.value.copy(sunCol);
      const edge = 1 - Math.min(1, Math.max(0, (Math.max(Math.abs(sunNDC.x), Math.abs(sunNDC.y)) - 0.9) / 0.5));
      const vis = onScreen ? edge * sunAbove : 0;
      gradeU.uSunVis.value = (Math.abs(sunNDC.x) < 1 && Math.abs(sunNDC.y) < 1 && facing > 0) ? sunAbove : 0;
      godU.uOn.value = vis;
      gradeU.uGodI.value = vis * 0.55;
    },
    render() {
      renderer.setRenderTarget(sceneRT);
      renderer.clear();
      renderer.render(scene, camera);
      if (godU.uOn.value > 0.001) {
        renderer.setRenderTarget(godRT);
        godQuad.render(renderer);
      }
      bloom.render(renderer);
      renderer.setRenderTarget(ldrRT);
      gradeQuad.render(renderer);
      smaa.render(renderer, null, ldrRT, 0, false);
    },
  };
  return api;
}
