// Trees, bushes and forest-floor logs: procedural prototypes, biome placement,
// chunk streaming, instanced LOD0 meshes with wind, and lit billboard impostors
// (rendered once into an atlas at start-up) out to the horizon. LOD0 and the
// impostor cross-fade with a complementary screen-space dither, so there is no pop.
import * as THREE from 'three';
import { mulberry32, Simplex } from '../../core/noise.js';
import { VEG_COMMON, VEG_LIGHT, vegUniforms } from './common.js';
import { broadleaf, birch, conifer, deadTree, palm, bush, log, makeLeafAtlas } from './treeGeo.js';

const CH = 64;                 // placement chunk size (m)
const LOD0_FADE = [138, 147];  // trees: full mesh -> impostor cross-fade
const BUSH_FADE = [58, 65];
const IMP_FAR = 2100;          // impostor draw distance (trees)
const BUSH_FAR = 420;
const LOAD_R = 2000;           // chunk streaming radius
const DETAIL_R = 380;          // bushes/logs generated inside this radius

// ------------------------------------------------------------------ shaders
const TREE_VERT = /* glsl */`
#include <common>
#include <shadowmap_pars_vertex>
#include <fog_pars_vertex>
${VEG_COMMON}
in vec4 aWind;
uniform vec2 uFade;
out vec2 vUv;
out vec3 vCol;
out vec3 vNormalW;
out vec3 vWorldPos;
out float vFade;
out float vKind;
out vec3 vLocal;
void main() {
  mat4 im = mat4(1.0);
  vec3 tint = vec3(1.0);
  #ifdef USE_INSTANCING
    im = instanceMatrix;
  #endif
  #ifdef USE_INSTANCING_COLOR
    tint = instanceColor;
  #endif
  vec3 tpos = (modelMatrix * im[3]).xyz;
  float scale = length(im[0].xyz);
  vec4 wp = modelMatrix * im * vec4(position, 1.0);
  vec3 nW = normalize(mat3(modelMatrix) * mat3(im) * normal);
  // ---- wind: whole-tree sway (gust driven) + leaf flutter
  float phase = vhash(tpos.xz * 0.37);
  float g = vegGust(tpos.xz);
  float ws = uWindStrength;
  float sw = aWind.x * scale;
  vec2 sway = uWindDir * sw * ws * (0.22 * vegGustBend(g) + 0.07 * sin(uTime * 1.1 + phase * 6.28))
            + vec2(sin(uTime * 0.7 + phase * 9.0), cos(uTime * 0.83 + phase * 5.0)) * sw * 0.03 * ws;
  wp.xz += sway;
  wp.y -= dot(sway, sway) * 0.08;
  float fl = aWind.y * (0.35 + ws) * (0.6 + vegGustBend(g) * 0.4);
  wp.xyz += nW * sin(uTime * (4.0 + phase * 3.0) + dot(wp.xyz, vec3(1.7, 1.3, 2.1)) + aWind.z * 6.28) * 0.045 * fl;
  wp.xyz += vec3(uWindDir.x, 0.0, uWindDir.y) * sin(uTime * 2.3 + aWind.z * 6.28 + phase * 4.0) * 0.06 * fl;
  vUv = uv;
  vCol = color * tint;
  vNormalW = nW;
  vWorldPos = wp.xyz;
  vKind = aWind.w;
  vLocal = position;
  float d = distance(tpos, cameraPosition);
  vFade = 1.0 - smoothstep(uFade.x, uFade.y, d);
  vec4 worldPosition = wp;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  vec3 transformedNormal = normalize(mat3(viewMatrix) * nW);
  #include <shadowmap_vertex>
  #include <fog_vertex>
}
`;

const TREE_FRAG = /* glsl */`
#include <common>
#include <packing>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
#include <fog_pars_fragment>
${VEG_COMMON}
${VEG_LIGHT}
uniform sampler2D uLeafTex;
uniform float uCapture;
in vec2 vUv;
in vec3 vCol;
in vec3 vNormalW;
in vec3 vWorldPos;
in float vFade;
in float vKind;
in vec3 vLocal;
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main() {
  if (uCapture < 0.5 && ign(gl_FragCoord.xy) > vFade) discard;
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 N = normalize(vNormalW);
  vec3 albedo;
  float trans, wrap, ao = 1.0;
#ifdef LEAVES
  vec4 tx = texture(uLeafTex, vUv);
  if (tx.a < 0.5) discard;
  albedo = vCol * (0.62 + 0.55 * tx.r) * (1.0 + tx.b * 0.12);
  albedo = mix(vec3(vluma(albedo)), albedo, 0.82);
  // painterly low-frequency hue drift across the canopy
  vec4 nz = texture(uNoise, vWorldPos.xz / 9.0 + vWorldPos.y / 13.0);
  albedo = vhueShift(albedo, (nz.r - 0.5) * 0.22) * (0.92 + 0.16 * nz.g);
  trans = 0.75; wrap = 0.3;
  // shade side of the canopy drifts toward a cool desaturated blue-green
  {
    vec3 Lk, kk; vegKeyLight(Lk, kk);
    float sh = 1.0 - smoothstep(-0.25, 0.35, dot(N, Lk));
    albedo = mix(albedo, vec3(vluma(albedo)) * vec3(0.78, 1.0, 1.05), sh * 0.4);
  }
  if (!gl_FrontFacing && vUv.x < 0.97) N = normalize(mix(N, -N, 0.3));
#else
  // procedural bark
  float k = vKind;
  vec4 nb = texture(uNoise, vec2(vUv.x * 2.0, vUv.y * 0.45));
  vec4 nf = texture(uNoise, vec2(vUv.x * 6.0, vUv.y * 2.2));
  albedo = vCol;
  if (k < 0.5) {
    float groove = smoothstep(0.35, 0.75, texture(uNoise, vec2(vUv.x * 3.0, vUv.y * 0.18)).b);
    albedo *= 0.82 + 0.3 * nb.r - 0.22 * groove;
    // moss creeping up the trunk on the up/north-facing side
    float moss = smoothstep(0.45, 0.75, nf.g * 0.6 + nb.a * 0.5 + N.y * 0.3 - N.z * 0.25) * (1.0 - smoothstep(1.0, 6.0, vLocal.y) * 0.6);
    albedo = mix(albedo, vec3(0.2, 0.3, 0.1), moss * 0.55);
  } else if (k < 1.5) {
    // pale ringed bark with dark lenticel marks
    float marks = smoothstep(0.72, 0.8, texture(uNoise, vec2(vUv.x * 1.5, vUv.y * 3.0)).g + nf.b * 0.2);
    float band = smoothstep(0.85, 0.95, fract(vUv.y * 2.3 + nb.r * 0.4)) * 0.6;
    albedo *= 0.92 + 0.1 * nb.g;
    albedo = mix(albedo, vec3(0.12, 0.11, 0.1), max(marks, band) * 0.85);
    albedo = mix(albedo, vCol * 0.45, smoothstep(1.2, 0.0, vLocal.y));
  } else if (k < 2.5) {
    float streak = texture(uNoise, vec2(vUv.x * 1.2, vUv.y * 0.08)).g;
    albedo *= 0.8 + 0.35 * streak;
    albedo = mix(albedo, albedo * vec3(0.7, 0.66, 0.6), smoothstep(0.6, 0.85, nf.b));
  } else {
    float ring = smoothstep(0.7, 0.95, fract(vUv.y * 4.5));
    albedo *= (0.85 + 0.2 * nb.r) * (1.0 - ring * 0.32);
  }
  trans = 0.0; wrap = 0.22;
  ao = 0.85 + 0.15 * smoothstep(0.0, 3.0, vLocal.y);
#endif
  if (uCapture > 0.5) {
    // impostor bake: albedo with a little baked form shading (lighting is applied at runtime)
    float form = 0.82 + 0.3 * (N.y * 0.5 + 0.5) + 0.1 * N.z;
    gl_FragColor = vec4(albedo * form * ao, 1.0);
    return;
  }
  albedo *= 1.0 - uWetness * 0.25;
  albedo = mix(albedo, vec3(0.92, 0.95, 1.0), uSnow * smoothstep(0.25, 0.75, N.y) * 0.85);
  float shadow = getShadowMask();
  vec3 col = vegLight(albedo, N, V, shadow, ao, trans, wrap);
  // soft sky rim on silhouettes
  col += uSkyColor * pow(1.0 - vsat(dot(N, V)), 3.0) * 0.12 * shadow;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const IMP_VERT = /* glsl */`
#include <common>
#include <fog_pars_vertex>
${VEG_COMMON}
in vec4 aIPos;    // x, y, z, scale
in vec4 aIInfo;   // proto, tint, rand, unused
uniform vec4 uCells[24];   // atlas rect per proto (u0, v0, us, vs)
uniform vec4 uSizes[24];   // quad width, height, y offset, far distance
uniform vec4 uFadeNear[24];
out vec2 vUv;
out vec2 vQ;
out vec3 vRight;
out vec3 vToCam;
out vec3 vWorldPos;
out float vFade;
out float vTint;
void main() {
  int p = int(aIInfo.x + 0.5);
  vec4 cell = uCells[p];
  vec4 sz = uSizes[p];
  vec3 c = aIPos.xyz;
  float s = aIPos.w;
  vec3 tc = cameraPosition - c;
  vec2 hz = normalize(tc.xz + 1e-4);
  vec3 right = vec3(hz.y, 0.0, -hz.x);
  vec3 toCam = vec3(hz.x, 0.0, hz.y);
  float d = length(tc);
  float fadeIn = smoothstep(uFadeNear[p].x, uFadeNear[p].y, d);
  float fadeOut = 1.0 - smoothstep(sz.w * 0.82, sz.w, d);
  vFade = fadeIn * fadeOut;
  if (vFade <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  // slight wind sway of the whole billboard
  float g = vegGust(c.xz);
  vec2 sway = uWindDir * position.y * s * uWindStrength * 0.22 * vegGustBend(g) * sz.y / 12.0;
  vec3 wp = c + right * position.x * sz.x * s + vec3(0.0, sz.z * s + position.y * sz.y * s, 0.0);
  wp.xz += sway;
  // push the quad slightly toward the camera so it doesn't clip into slopes
  wp += toCam * sz.x * s * 0.15;
  vUv = cell.xy + vec2(position.x + 0.5, position.y) * cell.zw;
  vQ = vec2(position.x * 2.0, position.y);
  vRight = right; vToCam = toCam; vWorldPos = wp; vTint = aIInfo.y;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const IMP_FRAG = /* glsl */`
#include <common>
#include <lights_pars_begin>
#include <fog_pars_fragment>
${VEG_COMMON}
${VEG_LIGHT}
uniform sampler2D uAtlas;
in vec2 vUv;
in vec2 vQ;
in vec3 vRight;
in vec3 vToCam;
in vec3 vWorldPos;
in float vFade;
in float vTint;
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main() {
  if (ign(gl_FragCoord.xy) > vFade) discard;
  vec4 a = texture(uAtlas, vUv);
  if (a.a < 0.42) discard;
  vec3 albedo = a.rgb / max(a.a, 1e-3);
  albedo *= 0.92 + 0.16 * vTint;
  albedo *= 1.0 - uWetness * 0.25;
  albedo = mix(albedo, vec3(0.92, 0.95, 1.0), uSnow * smoothstep(0.35, 0.9, vQ.y) * 0.6);
  // pseudo-spherical normal across the billboard
  float nx = clamp(vQ.x, -1.0, 1.0);
  float ny = clamp((vQ.y - 0.55) * 1.6, -1.0, 1.0);
  float nz = sqrt(max(0.0, 1.0 - nx * nx * 0.8 - ny * ny * 0.4));
  vec3 N = normalize(vRight * nx + vec3(0.0, 1.0, 0.0) * (ny * 0.7 + 0.25) + vToCam * nz);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 col = vegLight(albedo, N, V, 1.0, 1.0, 0.5, 0.3);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

// ------------------------------------------------------------------ helpers
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
function chunkSeed(i, j) { return ((i * 73856093) ^ (j * 19349663) ^ 0x5bd1e995) >>> 0; }

export function createTrees(ctx, { noiseTex, group, quality = 1 }) {
  const { world, renderer, camera } = ctx;
  const terrain = ctx.systems.terrain;
  const noise = new Simplex(31337);
  const root = new THREE.Group(); root.name = 'veg-trees';
  group.add(root);

  // ---------------- prototypes
  const P = [];
  const add = (geo, kind, opts = {}) => { geo.kind = kind; Object.assign(geo, opts); P.push(geo); return P.length - 1; };
  const BROAD = [add(broadleaf(11, { color: 0x578a36, bark: 0x857560 }), 'tree'), add(broadleaf(23, { color: 0x66983a, height: 12 }), 'tree'), add(broadleaf(37, { color: 0x50843a, height: 13, umbrella: true }), 'tree')];
  const CONIF = [add(conifer(5, { color: 0x3d6740 }), 'tree'), add(conifer(17, { color: 0x355e3e, height: 16 }), 'tree'), add(conifer(29, { color: 0x467545, height: 12 }), 'tree')];
  const BIRCH = [add(birch(7, { color: 0x7fae46 }), 'tree'), add(birch(19, { color: 0x8cb550, height: 12 }), 'tree')];
  const DEAD = [add(deadTree(3), 'tree'), add(deadTree(13, { height: 6.5 }), 'tree')];
  const PALM = [add(palm(9), 'tree'), add(palm(21, { height: 10.5, color: 0x72a83c }), 'tree')];
  const BUSH = [add(bush(41, { color: 0x56883a }), 'bush'), add(bush(43, { color: 0x6a9440, size: 1.3 }), 'bush'), add(bush(47, { color: 0x4c7c36, berries: true }), 'bush')];
  const GOLD = [add(broadleaf(53, { color: 0xc9a43a, height: 10 }), 'tree')];
  const LOG = [add(log(61), 'log')];

  // ---------------- materials
  const leafTex = makeLeafAtlas();
  const common = () => ({
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.lights),
    ...THREE.UniformsLib.fog,
    ...vegUniforms(ctx, noiseTex),
    uLeafTex: { value: leafTex },
    uCapture: { value: 0 },
  });
  const mkMat = (leaves, fade) => {
    const m = new THREE.ShaderMaterial({
      name: leaves ? 'veg-leaves' : 'veg-bark',
      uniforms: { ...common(), uFade: { value: new THREE.Vector2(...fade) } },
      defines: leaves ? { LEAVES: 1 } : {},
      vertexShader: TREE_VERT, fragmentShader: TREE_FRAG,
      lights: true, fog: true, vertexColors: true, side: leaves ? THREE.DoubleSide : THREE.FrontSide,
    });
    if (leaves) { m.alphaMap = leafTex; m.alphaTest = 0.5; }   // read by the shadow depth pass
    return m;
  };
  const mats = {
    tree: { bark: mkMat(false, LOD0_FADE), leaves: mkMat(true, LOD0_FADE) },
    bush: { bark: mkMat(false, BUSH_FADE), leaves: mkMat(true, BUSH_FADE) },
    log: { bark: mkMat(false, [70, 90]), leaves: null },
  };
  const leafDepth = new THREE.MeshDepthMaterial({ alphaMap: leafTex, alphaTest: 0.5 });
  leafDepth.alphaMap = leafTex; leafDepth.alphaTest = 0.5;

  // ---------------- LOD0 instanced meshes
  const cap = Math.round(900 * quality);
  const lod0 = P.map((p, i) => {
    const m = mats[p.kind];
    const capN = p.kind === 'bush' ? cap * 2 : p.kind === 'log' ? 200 : cap;
    const mk = (geo, mat, leaves) => {
      if (!geo) return null;
      const im = new THREE.InstancedMesh(geo, mat, capN);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.setColorAt(0, new THREE.Color(1, 1, 1));
      im.instanceColor.setUsage(THREE.DynamicDrawUsage);
      im.count = 0; im.frustumCulled = false;
      im.castShadow = true; im.receiveShadow = true;
      if (leaves) im.customDepthMaterial = leafDepth;
      im.name = `veg-${p.species}-${i}-${leaves ? 'leaves' : 'bark'}`;
      root.add(im);
      return im;
    };
    return { bark: mk(p.bark, m.bark, false), leaves: mk(p.leaves, m.leaves, true), cap: capN, n: 0 };
  });

  // ---------------- impostor atlas
  const COLS = 5, ROWS = Math.ceil(P.length / COLS), CELL = 256;
  const atlas = new THREE.WebGLRenderTarget(COLS * CELL, ROWS * CELL, {
    type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true,
  });
  atlas.texture.colorSpace = THREE.NoColorSpace;
  const cells = [], sizes = [], fadeNear = [];
  {
    const capScene = new THREE.Scene();
    const capMats = { bark: mkMat(false, [1e6, 1e6]), leaves: mkMat(true, [1e6, 1e6]) };
    capMats.bark.uniforms.uCapture.value = 1; capMats.leaves.uniforms.uCapture.value = 1;
    capMats.bark.fog = false; capMats.leaves.fog = false;
    capMats.bark.uniforms.uWindStrength = { value: 0 }; capMats.leaves.uniforms.uWindStrength = { value: 0 };
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    const prevRT = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
    const prevAuto = renderer.autoClear;
    renderer.setRenderTarget(atlas);
    renderer.setClearColor(0x2c4a22, 0);
    renderer.clear(true, true, true);
    renderer.autoClear = false;
    P.forEach((p, i) => {
      const box = new THREE.Box3();
      box.union(p.bark.boundingBox);
      if (p.leaves) box.union(p.leaves.boundingBox);
      const rx = Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z));
      const size = Math.max(rx * 2, box.max.y - box.min.y) * 1.04;
      const cx = (i % COLS) * CELL, cy = Math.floor(i / COLS) * CELL;
      cam.left = -size / 2; cam.right = size / 2; cam.bottom = box.min.y; cam.top = box.min.y + size;
      cam.position.set(0, 0, 100); cam.lookAt(0, 0, 0); cam.updateProjectionMatrix(); cam.updateMatrixWorld();
      const meshes = [new THREE.Mesh(p.bark, capMats.bark)];
      if (p.leaves) meshes.push(new THREE.Mesh(p.leaves, capMats.leaves));
      for (const m of meshes) { m.frustumCulled = false; capScene.add(m); }
      atlas.viewport.set(cx, cy, CELL, CELL); atlas.scissor.set(cx, cy, CELL, CELL); atlas.scissorTest = true;
      renderer.setRenderTarget(atlas);
      renderer.render(capScene, cam);
      for (const m of meshes) capScene.remove(m);
      const inset = 0.5 / (COLS * CELL);
      cells.push(new THREE.Vector4(cx / (COLS * CELL) + inset, cy / (ROWS * CELL) + inset, CELL / (COLS * CELL) - 2 * inset, CELL / (ROWS * CELL) - 2 * inset));
      const far = p.kind === 'bush' ? BUSH_FAR : p.kind === 'log' ? 0 : IMP_FAR;
      sizes.push(new THREE.Vector4(size, size, box.min.y, far));
      const f = p.kind === 'bush' ? BUSH_FADE : p.kind === 'log' ? [1e6, 1e6 + 1] : LOD0_FADE;
      fadeNear.push(new THREE.Vector4(f[0], f[1], 0, 0));
    });
    atlas.scissorTest = false;
    atlas.viewport.set(0, 0, COLS * CELL, ROWS * CELL);
    renderer.setRenderTarget(prevRT);
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.autoClear = prevAuto;
    capMats.bark.dispose(); capMats.leaves.dispose();
  }
  while (cells.length < 24) { cells.push(new THREE.Vector4()); sizes.push(new THREE.Vector4()); fadeNear.push(new THREE.Vector4()); }

  const impGeo = new THREE.InstancedBufferGeometry();
  impGeo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  impGeo.setIndex([0, 1, 2, 0, 2, 3]);
  let impCap = 0, impPos = null, impInfo = null;
  function ensureImp(n) {
    if (n <= impCap) return;
    impCap = Math.ceil(n * 1.4 / 1024) * 1024;
    impPos = new THREE.InstancedBufferAttribute(new Float32Array(impCap * 4), 4);
    impInfo = new THREE.InstancedBufferAttribute(new Float32Array(impCap * 4), 4);
    impGeo.setAttribute('aIPos', impPos); impGeo.setAttribute('aIInfo', impInfo);
  }
  ensureImp(4096);
  impGeo.instanceCount = 0;
  impGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  const impMat = new THREE.ShaderMaterial({
    name: 'veg-impostor',
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.lights), ...THREE.UniformsLib.fog, ...vegUniforms(ctx, noiseTex),
      uAtlas: { value: atlas.texture }, uCells: { value: cells }, uSizes: { value: sizes }, uFadeNear: { value: fadeNear },
    },
    vertexShader: IMP_VERT, fragmentShader: IMP_FRAG, lights: true, fog: true, side: THREE.DoubleSide,
  });
  const impMesh = new THREE.Mesh(impGeo, impMat);
  impMesh.frustumCulled = false; impMesh.name = 'veg-impostors';
  root.add(impMesh);

  // ---------------- placement
  const ruinSites = terrain?.ruinSites || [];
  const tmpCol = [];
  function blocked(x, z, r) {
    for (const s of ruinSites) if ((s.x - x) ** 2 + (s.z - z) ** 2 < (s.r + r) ** 2) return true;
    if (terrain?.queryColliders) { tmpCol.length = 0; if (terrain.queryColliders(x, z, r, tmpCol).length) return true; }
    return false;
  }
  function riverOrLake(x, z, h) {
    if (world.getRiverMask(x, z) > 0.02) return true;
    for (const L of world.LAKES) if ((x - L.x) ** 2 + (z - L.z) ** 2 < (L.r * 1.8) ** 2 && h < L.y + 1.2) return true;
    return false;
  }
  // tree record stride: x y z proto scale yaw tint id-alive
  const STRIDE = 8;
  function genChunk(ci, cj, detail) {
    const rand = mulberry32(chunkSeed(ci, cj));
    const x0 = ci * CH, z0 = cj * CH;
    const out = [];
    const S = 5.2;
    const n = Math.floor(CH / S);
    const half = world.WORLD_SIZE / 2 - 40;
    for (let gj = 0; gj < n; gj++) for (let gi = 0; gi < n; gi++) {
      const x = x0 + (gi + 0.1 + rand() * 0.8) * S, z = z0 + (gj + 0.1 + rand() * 0.8) * S;
      const r = rand(), r2 = rand(), r3 = rand();
      if (Math.abs(x) > half || Math.abs(z) > half) continue;
      const ff = world.forestFactor(x, z);
      const grove = noise.noise2(x / 170, z / 170) * 0.7 + noise.noise2(x / 47, z / 47) * 0.3;
      // cheap upper bound before height sampling
      if (r > 0.62 && r > grove * 0.4 + 0.02) continue;
      const h = world.getHeight(x, z);
      if (h < 1.4) continue;
      const hx = world.getHeight(x + 1.5, z), hz = world.getHeight(x, z + 1.5);
      const slope = Math.hypot(hx - h, hz - h) / 1.5;
      if (slope > 1.0) continue;
      if (riverOrLake(x, z, h)) continue;
      if ((world.getPathMask?.(x, z) || 0) > 0.15) continue;
      const snowL = world.snowLine(x, z), mesa = world.mesaFactor(x, z);
      let p = 0, proto = -1, sc = 1;
      if (h > snowL + 25) continue;
      else if (h > snowL - 25) { p = 0.05 * (slope < 0.75 ? 1 : 0); proto = DEAD[(r2 * 2) | 0]; sc = 0.8 + r3 * 0.5; }
      else if (h > 165) {
        const lim = 1 - smooth(snowL - 90, snowL - 20, h);
        p = 0.34 * lim * (slope < 0.85 ? 1 : 0) * smooth(-0.6, 0.2, grove + 0.3);
        proto = r2 < 0.04 + 0.2 * smooth(snowL - 120, snowL - 30, h) ? DEAD[(r3 * 2) | 0] : CONIF[(r3 * 3) | 0]; sc = 0.75 + r3 * 0.55 * lim;
      } else if (mesa > 0.5) { p = 0.012; proto = DEAD[1]; sc = 0.7 + r3 * 0.4; }
      else if (h < 8 && ff < 0.3) {
        p = 0.16 * smooth(-0.3, 0.3, grove) * (slope < 0.4 ? 1 : 0); proto = PALM[(r2 * 2) | 0]; sc = 0.8 + r3 * 0.45;
      } else if (ff > 0.22) {
        const dens = smooth(0.22, 0.65, ff) * (0.55 + 0.45 * smooth(-0.5, 0.3, grove));
        p = 0.4 * dens;
        const conifP = smooth(100, 170, h) * 0.75 + smooth(0.35, 0.75, slope) * 0.5 + 0.08;
        const birchN = noise.noise2(x / 90 + 40, z / 90);
        if (r2 < conifP) proto = CONIF[(r3 * 3) | 0];
        else if (birchN > 0.35) proto = BIRCH[(r3 * 2) | 0];
        else proto = r3 < 0.025 ? GOLD[0] : BROAD[(r3 * 3) | 0];
        if (slope > 0.6 && !CONIF.includes(proto)) continue;
        sc = 0.75 + r3 * 0.5 + dens * 0.2;
      } else {
        const g = smooth(0.38, 0.7, grove);
        p = 0.32 * g + 0.005;
        const dry = h > 0 && ff < 0.05 ? 0.6 : 1;
        p *= dry;
        const birchN = noise.noise2(x / 90 + 40, z / 90);
        proto = birchN > 0.4 ? BIRCH[(r3 * 2) | 0] : (r3 < 0.03 ? GOLD[0] : BROAD[(r3 * 3) | 0]);
        if (slope > 0.55) continue;
        sc = 0.8 + r3 * 0.55;
      }
      if (r >= p || proto < 0) continue;
      if (blocked(x, z, 2.5)) continue;
      out.push(x, h - 0.15, z, proto, sc, rand() * Math.PI * 2, rand(), 1);
    }
    if (detail) {
      // bushes + logs (closer streaming radius)
      const SB = 4.2, nb = Math.floor(CH / SB);
      for (let gj = 0; gj < nb; gj++) for (let gi = 0; gi < nb; gi++) {
        const x = x0 + (gi + 0.1 + rand() * 0.8) * SB, z = z0 + (gj + 0.1 + rand() * 0.8) * SB;
        const r = rand(), r2 = rand(), r3 = rand();
        if (Math.abs(x) > half || Math.abs(z) > half) continue;
        if (r > 0.2) continue;
        const ff = world.forestFactor(x, z);
        const grove = noise.noise2(x / 170, z / 170) * 0.7 + noise.noise2(x / 47, z / 47) * 0.3;
        const h = world.getHeight(x, z);
        if (h < 2 || h > world.snowLine(x, z) - 30) continue;
        const hx = world.getHeight(x + 1.2, z), hz = world.getHeight(x, z + 1.2);
        const slope = Math.hypot(hx - h, hz - h) / 1.2;
        if (slope > 0.7 || riverOrLake(x, z, h) || (world.getPathMask?.(x, z) || 0) > 0.1) continue;
        const mesa = world.mesaFactor(x, z);
        let p;
        if (ff > 0.6) p = 0.07; else if (ff > 0.15) p = 0.16; else if (mesa > 0.5) p = 0.05; else if (h > 165) p = 0.04; else p = 0.1 * smooth(0.45, 0.75, grove);
        if (r < p) {
          if (blocked(x, z, 1.2)) continue;
          const proto = r2 < 0.12 ? BUSH[2] : BUSH[(r3 * 2) | 0];
          out.push(x, h - 0.1, z, proto, 0.75 + r3 * 0.6, rand() * 6.28, rand(), 1);
        } else if (ff > 0.55 && r < p + 0.012) {
          if (blocked(x, z, 3)) continue;
          out.push(x, h - 0.05, z, LOG[0], 0.8 + r3 * 0.4, rand() * 6.28, rand(), 1);
        }
      }
    }
    return { ci, cj, data: new Float32Array(out), detail };
  }

  const chunks = new Map();
  const key = (i, j) => i * 4096 + j;
  const cut = new Set();
  let dirtyImp = true, dirtyLod = true, pending = false;
  const lastStream = new THREE.Vector3(1e9, 0, 0);
  // chunk offsets within the load radius, nearest first
  const order = [];
  {
    const R = Math.ceil(LOAD_R / CH);
    for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) { const d = Math.hypot(i + 0.5, j + 0.5) * CH - CH * 0.7; if (d <= LOAD_R) order.push([i, j, Math.max(0, d)]); }
    order.sort((a, b) => a[2] - b[2]);
  }
  function genChunkKeep(ci, cj, detail) {
    const c = genChunk(ci, cj, detail);
    if (cut.size) for (let o = 0; o < c.data.length; o += STRIDE) if (cut.has(`${ci},${cj},${o}`)) c.data[o + 7] = 0;
    return c;
  }
  // returns true when everything wanted is loaded
  function streamChunks(cp, budgetMs) {
    const t0 = performance.now();
    const ci0 = Math.floor(cp.x / CH), cj0 = Math.floor(cp.z / CH);
    let changed = false, done = true;
    for (const [i, j, d] of order) {
      const k = key(ci0 + i, cj0 + j);
      const wantDetail = d < DETAIL_R;
      const c = chunks.get(k);
      if (c && (c.detail || !wantDetail)) continue;
      if (performance.now() - t0 > budgetMs) { done = false; break; }
      chunks.set(k, genChunkKeep(ci0 + i, cj0 + j, wantDetail));
      changed = true;
    }
    for (const [k, c] of chunks) {
      const dx = (c.ci + 0.5) * CH - cp.x, dz = (c.cj + 0.5) * CH - cp.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > (LOAD_R + CH * 3) ** 2) { chunks.delete(k); changed = true; }
      else if (c.detail && d2 > (DETAIL_R + CH * 3) ** 2) { chunks.set(k, genChunkKeep(c.ci, c.cj, false)); changed = true; }
    }
    if (changed) { dirtyImp = true; dirtyLod = true; }
    return done;
  }

  function rebuildImpostors() {
    let n = 0;
    for (const c of chunks.values()) n += c.data.length / STRIDE;
    ensureImp(n);
    const ap = impPos.array, ai = impInfo.array;
    let k = 0;
    for (const c of chunks.values()) {
      const d = c.data;
      for (let o = 0; o < d.length; o += STRIDE) {
        if (d[o + 7] < 0.5 || P[d[o + 3]].kind === 'log') continue;
        ap[k * 4] = d[o]; ap[k * 4 + 1] = d[o + 1]; ap[k * 4 + 2] = d[o + 2]; ap[k * 4 + 3] = d[o + 4];
        ai[k * 4] = d[o + 3]; ai[k * 4 + 1] = d[o + 6]; ai[k * 4 + 2] = d[o + 5]; ai[k * 4 + 3] = 0;
        k++;
      }
    }
    impGeo.instanceCount = k;
    impPos.needsUpdate = true; impInfo.needsUpdate = true;
    impPos.clearUpdateRanges(); impInfo.clearUpdateRanges();
    impPos.addUpdateRange(0, k * 4); impInfo.addUpdateRange(0, k * 4);
  }

  const frustum = new THREE.Frustum(), pm = new THREE.Matrix4(), box = new THREE.Box3(), _sph = new THREE.Sphere();
  const lastCam = new THREE.Vector3(1e9, 0, 0), lastQ = new THREE.Quaternion();
  function rebuildLod0(cp) {
    camera.updateMatrixWorld();
    pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(pm);
    for (const l of lod0) l.n = 0;
    const R = LOD0_FADE[1] + 4;
    for (const c of chunks.values()) {
      const x0 = c.ci * CH, z0 = c.cj * CH;
      const nx = Math.max(x0, Math.min(cp.x, x0 + CH)) - cp.x, nz = Math.max(z0, Math.min(cp.z, z0 + CH)) - cp.z;
      const dn = nx * nx + nz * nz;
      if (dn > R * R) continue;
      // expanded frustum test (shadow casters just outside the view still count when near)
      if (dn > 45 * 45) {
        box.min.set(x0 - 14, -50, z0 - 14); box.max.set(x0 + CH + 14, 600, z0 + CH + 14);
        if (!frustum.intersectsBox(box)) continue;
      }
      const d = c.data;
      for (let o = 0; o < d.length; o += STRIDE) {
        if (d[o + 7] < 0.5) continue;
        const pi = d[o + 3], p = P[pi];
        const dx = d[o] - cp.x, dy = d[o + 1] - cp.y, dz = d[o + 2] - cp.z;
        const dist2 = dx * dx + dy * dy + dz * dz;
        const lim = p.kind === 'bush' ? BUSH_FADE[1] + 2 : p.kind === 'log' ? 92 : R;
        if (dist2 > lim * lim) continue;
        const L = lod0[pi];
        if (L.n >= L.cap) continue;
        // per-tree sphere cull (near trees always kept: they cast shadows into view)
        if (dist2 > 900) {
          const s0 = d[o + 4];
          _sph.center.set(d[o], d[o + 1] + p.height * s0 * 0.5, d[o + 2]);
          _sph.radius = (p.height * 0.6 + p.radius) * s0;
          if (!frustum.intersectsSphere(_sph)) continue;
        }
        const s = d[o + 4], yaw = d[o + 5], cs = Math.cos(yaw) * s, sn = Math.sin(yaw) * s;
        const idx = L.n++;
        for (const im of [L.bark, L.leaves]) {
          if (!im) continue;
          const a = im.instanceMatrix.array, b = idx * 16;
          a[b] = cs; a[b + 1] = 0; a[b + 2] = -sn; a[b + 3] = 0;
          a[b + 4] = 0; a[b + 5] = s; a[b + 6] = 0; a[b + 7] = 0;
          a[b + 8] = sn; a[b + 9] = 0; a[b + 10] = cs; a[b + 11] = 0;
          a[b + 12] = d[o]; a[b + 13] = d[o + 1]; a[b + 14] = d[o + 2]; a[b + 15] = 1;
          const t = d[o + 6], ca = im.instanceColor.array, cb = idx * 3;
          ca[cb] = 0.9 + 0.2 * t; ca[cb + 1] = 0.94 + 0.12 * ((t * 7.3) % 1); ca[cb + 2] = 0.88 + 0.2 * ((t * 3.1) % 1);
        }
      }
    }
    for (const L of lod0) for (const im of [L.bark, L.leaves]) {
      if (!im) continue;
      im.count = L.n;
      im.instanceMatrix.clearUpdateRanges(); im.instanceMatrix.addUpdateRange(0, L.n * 16); im.instanceMatrix.needsUpdate = true;
      im.instanceColor.clearUpdateRanges(); im.instanceColor.addUpdateRange(0, L.n * 3); im.instanceColor.needsUpdate = true;
    }
  }

  // ---------------- colliders + cutting
  function forChunksNear(x, z, r, fn) {
    const i0 = Math.floor((x - r) / CH), i1 = Math.floor((x + r) / CH), j0 = Math.floor((z - r) / CH), j1 = Math.floor((z + r) / CH);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const c = chunks.get(key(i, j)); if (c) fn(c); }
  }
  function getColliders(x, z, r, out = []) {
    out.length = 0;
    if (x === undefined) {
      const cp = lastStream;
      x = cp.x; z = cp.z; r = 200;
    }
    forChunksNear(x, z, r, c => {
      const d = c.data;
      for (let o = 0; o < d.length; o += STRIDE) {
        if (d[o + 7] < 0.5) continue;
        const p = P[d[o + 3]];
        if (!p.trunkR) continue;
        const dx = d[o] - x, dz = d[o + 2] - z;
        if (dx * dx + dz * dz > (r + 1) ** 2) continue;
        out.push({ x: d[o], y: d[o + 1], z: d[o + 2], r: p.trunkR * d[o + 4], h: p.height * d[o + 4], species: p.species, id: key(c.ci, c.cj) * 4096 + o / STRIDE });
      }
    });
    return out;
  }
  function cutTree(q) {
    let best = null, bd = 1e9;
    if (typeof q === 'number') {
      const ck = Math.floor(q / 4096), c = chunks.get(ck), o = (q % 4096) * STRIDE;
      if (c && o < c.data.length) best = { c, o };
    } else if (q && q.x !== undefined) {
      forChunksNear(q.x, q.z, 4, c => {
        const d = c.data;
        for (let o = 0; o < d.length; o += STRIDE) {
          if (d[o + 7] < 0.5 || !P[d[o + 3]].trunkR) continue;
          const dd = (d[o] - q.x) ** 2 + (d[o + 2] - q.z) ** 2;
          if (dd < bd && dd < 16) { bd = dd; best = { c, o }; }
        }
      });
    }
    if (!best) return false;
    const d = best.c.data;
    d[best.o + 7] = 0;
    cut.add(`${best.c.ci},${best.c.cj},${best.o}`);
    dirtyImp = true; dirtyLod = true;
    ctx.events?.emit?.('treeCut', { x: d[best.o], y: d[best.o + 1], z: d[best.o + 2], species: P[d[best.o + 3]].species });
    return true;
  }
  // ---------------- initial fill
  const shotMode = ctx.params.has('shot');
  const start = (ctx.cameraOverride?.pos || ctx.focus || camera.position).clone();
  let impTimer = 0;

  const api = {
    prototypes: P, chunks, atlas,
    getColliders, cutTree,
    update(dt, cp) {
      const jump = cp.distanceToSquared(lastStream) > 300 * 300;
      if (pending || jump || cp.distanceToSquared(lastStream) > 16 * 16) {
        pending = !streamChunks(cp, shotMode || jump ? 1e9 : 2.5);
        lastStream.copy(cp);
      }
      impTimer -= dt;
      if (dirtyImp && (impTimer <= 0 || shotMode || jump)) { rebuildImpostors(); dirtyImp = false; impTimer = 0.6; }
      if (dirtyLod || cp.distanceToSquared(lastCam) > 2.5 * 2.5 || camera.quaternion.angleTo(lastQ) > 0.12) {
        rebuildLod0(cp); dirtyLod = false; lastCam.copy(cp); lastQ.copy(camera.quaternion);
      }
    },
  };
  // boot: everything near synchronously (the whole radius in shot mode), the rest streams in
  {
    const t0 = performance.now();
    const ci0 = Math.floor(start.x / CH), cj0 = Math.floor(start.z / CH);
    for (const [i, j, d] of order) {
      if (!shotMode && d > 450) { pending = true; break; }
      chunks.set(key(ci0 + i, cj0 + j), genChunkKeep(ci0 + i, cj0 + j, d < DETAIL_R));
    }
    lastStream.copy(start);
    rebuildImpostors(); dirtyImp = false;
    console.log(`[veg] trees: ${chunks.size} chunks, ${impGeo.instanceCount} instances in ${(performance.now() - t0).toFixed(0)} ms`);
  }
  return api;
}
