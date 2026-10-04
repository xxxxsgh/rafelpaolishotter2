// GPU ground cover: grass, wildflowers, reeds and ferns.
//
// Each layer owns one "patch" geometry (a square tile containing N plants whose
// order is a random permutation) and draws it as instances on a camera-centred
// grid. Concentric rings reuse the SAME vertex buffers but draw only the first
// fraction of plants (drawRange), so density falls off continuously with
// distance: a plant of rank r is visible while r < density(dist). Heights,
// suitability, slope and colour all come from the field map texture, so tiles
// never need rebuilding — only the per-ring instance lists (frustum culled) do.
import * as THREE from 'three';
import { mulberry32 } from '../../core/noise.js';
import { VEG_COMMON, VEG_LIGHT, vegUniforms } from './common.js';
import { FIELD_GLSL } from './fieldmap.js';

// ---------------------------------------------------------------- geometry
// Grass blade patch: blades are generated in tufts (clumps) for a natural look.
// position = (localX, t, localZ); aB = (side -1|0|1, rank, rand1, rand2)
function grassPatch(tile, count, seed, segs = 4) {
  const rand = mulberry32(seed);
  const vertsPer = segs * 2 + 1, idxPer = (segs * 2 - 1) * 3;
  const pos = new Float32Array(count * vertsPer * 3);
  const ab = new Float32Array(count * vertsPer * 4);
  const idx = new Uint32Array(count * idxPer);
  // tuft centres
  const blades = [];
  while (blades.length < count) {
    const cx = rand() * tile, cz = rand() * tile;
    const n = 3 + Math.floor(rand() * 9);
    const rad = 0.06 + rand() * 0.16;
    for (let k = 0; k < n && blades.length < count; k++) {
      const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * rad;
      let x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      x = ((x % tile) + tile) % tile; z = ((z % tile) + tile) % tile;
      blades.push([x, z]);
    }
    // a share of solitary blades fills gaps between tufts
    for (let k = 0; k < 4 && blades.length < count; k++) blades.push([rand() * tile, rand() * tile]);
  }
  // random permutation -> rank
  for (let i = blades.length - 1; i > 0; i--) { const j = (rand() * (i + 1)) | 0; [blades[i], blades[j]] = [blades[j], blades[i]]; }
  for (let b = 0; b < count; b++) {
    const [x, z] = blades[b];
    const rank = (b + 0.5) / count, r1 = rand(), r2 = rand();
    const v0 = b * vertsPer;
    for (let s = 0; s < segs; s++) {
      const t = Math.pow(s / segs, 0.85);
      for (let side = 0; side < 2; side++) {
        const v = v0 + s * 2 + side;
        pos.set([x, t, z], v * 3);
        ab.set([side ? 1 : -1, rank, r1, r2], v * 4);
      }
    }
    const tip = v0 + segs * 2;
    pos.set([x, 1, z], tip * 3);
    ab.set([0, rank, r1, r2], tip * 4);
    let ii = b * idxPer;
    for (let s = 0; s < segs - 1; s++) {
      const a = v0 + s * 2;
      idx[ii++] = a; idx[ii++] = a + 1; idx[ii++] = a + 2;
      idx[ii++] = a + 1; idx[ii++] = a + 3; idx[ii++] = a + 2;
    }
    const a = v0 + (segs - 1) * 2;
    idx[ii++] = a; idx[ii++] = a + 1; idx[ii++] = tip;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aB', new THREE.BufferAttribute(ab, 4));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return { geo: g, idxPer, count };
}

// Generic plant patch from a list of small meshes ("prototypes"). Each prototype
// is {pos:[], idx:[], part:[]} in metres around the root; parts tag vertices so
// the shader can colour stems/petals/centres differently.
// attributes: position (mesh local), aRoot (lx, lz, protoIdx), aB (rank, r1, r2, part)
function plantPatch(tile, count, seed, protos, cluster = 0) {
  const rand = mulberry32(seed);
  const pts = [];
  while (pts.length < count) {
    if (cluster > 0) {
      const cx = rand() * tile, cz = rand() * tile, n = 2 + Math.floor(rand() * cluster);
      for (let k = 0; k < n && pts.length < count; k++) {
        const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * 0.55;
        pts.push([(((cx + Math.cos(a) * r) % tile) + tile) % tile, (((cz + Math.sin(a) * r) % tile) + tile) % tile]);
      }
    } else pts.push([rand() * tile, rand() * tile]);
  }
  for (let i = pts.length - 1; i > 0; i--) { const j = (rand() * (i + 1)) | 0; [pts[i], pts[j]] = [pts[j], pts[i]]; }
  const choice = pts.map(() => (rand() * protos.length) | 0);
  let nv = 0, ni = 0;
  for (let i = 0; i < count; i++) { nv += protos[choice[i]].pos.length / 3; ni += protos[choice[i]].idx.length; }
  const pos = new Float32Array(nv * 3), root = new Float32Array(nv * 3), ab = new Float32Array(nv * 4);
  const idx = new Uint32Array(ni);
  const offsets = new Uint32Array(count + 1); // index offsets per plant (for drawRange)
  let v = 0, ii = 0;
  for (let i = 0; i < count; i++) {
    const p = protos[choice[i]], rank = (i + 0.5) / count, r1 = rand(), r2 = rand();
    const n = p.pos.length / 3;
    for (let k = 0; k < p.idx.length; k++) idx[ii++] = p.idx[k] + v;
    for (let k = 0; k < n; k++) {
      pos[(v + k) * 3] = p.pos[k * 3]; pos[(v + k) * 3 + 1] = p.pos[k * 3 + 1]; pos[(v + k) * 3 + 2] = p.pos[k * 3 + 2];
      root[(v + k) * 3] = pts[i][0]; root[(v + k) * 3 + 1] = pts[i][1]; root[(v + k) * 3 + 2] = choice[i];
      ab[(v + k) * 4] = rank; ab[(v + k) * 4 + 1] = r1; ab[(v + k) * 4 + 2] = r2; ab[(v + k) * 4 + 3] = p.part[k];
    }
    v += n;
    offsets[i + 1] = ii;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aRoot', new THREE.BufferAttribute(root, 3));
  g.setAttribute('aB', new THREE.BufferAttribute(ab, 4));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return { geo: g, offsets, count };
}

// --- prototypes (all original, procedural)
function protoFlower(rand, petals, petalLen, petalW, stemH, cup) {
  const pos = [], idx = [], part = [];
  const add = (x, y, z, p) => { pos.push(x, y, z); part.push(p); return pos.length / 3 - 1; };
  // stem: thin bent ribbon (two segments)
  const lean = (rand() - 0.5) * 0.12;
  const s0 = add(-0.006, 0, 0, 0), s1 = add(0.006, 0, 0, 0);
  const s2 = add(-0.005 + lean * 0.5, stemH * 0.55, 0, 0), s3 = add(0.005 + lean * 0.5, stemH * 0.55, 0, 0);
  const s4 = add(-0.004 + lean, stemH, 0, 0), s5 = add(0.004 + lean, stemH, 0, 0);
  idx.push(s0, s1, s2, s1, s3, s2, s2, s3, s4, s3, s5, s4);
  // two little leaves on the stem
  for (let k = 0; k < 2; k++) {
    const y = stemH * (0.15 + 0.25 * k), dir = k ? -1 : 1, L = 0.07 + rand() * 0.05;
    const a = add(0, y, 0, 0), b = add(dir * L * 0.55, y + L * 0.25, 0.02, 0), c = add(dir * L, y + L * 0.55, 0, 0), d = add(dir * L * 0.5, y + L * 0.38, -0.02, 0);
    idx.push(a, b, c, a, c, d);
  }
  // head: centre + petals fanning around, cupped upward
  const hx = lean, hy = stemH;
  const centre = add(hx, hy + 0.008, 0, 2);
  const tilt = (rand() - 0.5) * 0.5;
  for (let k = 0; k < petals; k++) {
    const a = (k / petals) * Math.PI * 2 + rand() * 0.2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const L = petalLen * (0.85 + rand() * 0.3);
    const w = petalW;
    const lift = cup * L;
    const pl = add(hx + (ca * 0.25 - sa * w) * L, hy + lift * 0.3 + tilt * ca * L * 0.3, (sa * 0.25 + ca * w) * L, 1);
    const tip = add(hx + ca * L, hy + lift + tilt * ca * L, sa * L, 1);
    const pr = add(hx + (ca * 0.25 + sa * w) * L, hy + lift * 0.3 + tilt * ca * L * 0.3, (sa * 0.25 - ca * w) * L, 1);
    idx.push(centre, pl, tip, centre, tip, pr);
  }
  return { pos, idx, part };
}

function protoFern(rand, fronds, len) {
  const pos = [], idx = [], part = [];
  const add = (x, y, z, p) => { pos.push(x, y, z); part.push(p); return pos.length / 3 - 1; };
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2 + rand() * 0.5;
    const ca = Math.cos(a), sa = Math.sin(a);
    const L = len * (0.75 + rand() * 0.45);
    const rise = 0.55 + rand() * 0.35;
    const N = 6;
    let prevL = -1, prevR = -1, prevC = -1;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      // arching rachis
      const d = t * L, y = L * rise * (t * 1.7 - t * t * 1.25);
      const cx = ca * d, cz = sa * d;
      // leaflet half-width: sawtooth (alternating) envelope -> leafy fronds
      const env = Math.sin(Math.PI * Math.min(1, t * 1.1)) * L * 0.2 * (i % 2 ? 1.0 : 0.55);
      const wx = -sa * env, wz = ca * env;
      const droop = env * 0.35;
      const c = add(cx, y, cz, 0);
      const l = add(cx + wx, y - droop, cz + wz, 1);
      const r = add(cx - wx, y - droop, cz - wz, 1);
      if (i > 0) idx.push(prevC, prevL, l, prevC, l, c, prevC, c, r, prevC, r, prevR);
      prevL = l; prevR = r; prevC = c;
    }
  }
  return { pos, idx, part };
}

// ---------------------------------------------------------------- shaders
const VERT = /* glsl */`
#include <common>
#include <shadowmap_pars_vertex>
#include <fog_pars_vertex>
${VEG_COMMON}
${FIELD_GLSL}
uniform vec3 cGrassSun, cGrassLush, cGrassDry, cGrassShade, cAlpine, cForest;
uniform vec4 uRings;      // r0, r1, r2, tile
uniform vec4 uLayer;      // height scale, width scale, density scale, unused
uniform vec3 uCamPos;
in vec4 aB;
in vec3 aTile;
#ifdef PLANT
in vec3 aRoot;
#endif
out vec3 vBase;
out vec3 vNormalW;
out vec3 vTerrN;
out vec3 vWorldPos;
out vec4 vData;   // t (0 root..1 tip), fade-to-ground, gust, rand
out vec4 vData2;  // part, species, dry, ao

// Terrain grass colour (mirrors the terrain shader's painted grass masses so blade
// roots and far fades match the ground exactly).
vec3 terrainGrass(vec2 p, float forest, float h) {
  vec4 nM = texture(uNoise, p / 640.0);
  vec4 nL = texture(uNoise, p / 170.0);
  vec4 nD = texture(uNoise, p / 31.0);
  float alpine = smoothstep(170.0, 260.0, h + (nL.r - 0.5) * 40.0);
  vec3 g = mix(cGrassLush, cGrassSun, smoothstep(0.25, 0.8, nL.r * 0.7 + nM.r * 0.5));
  g = mix(g, cGrassDry, smoothstep(0.5, 0.8, nM.a * 0.8 + nL.a * 0.35) * 0.75);
  g = mix(g, cForest, forest * 0.75);
  g = mix(g, cAlpine, alpine);
  g = vhueShift(g, (nM.g - 0.5) * 0.3 + (nL.a - 0.5) * 0.12);
  g *= 0.74 + 0.4 * smoothstep(0.15, 0.85, nM.r * 0.6 + nL.g * 0.4);
  g = mix(g, cGrassShade * 1.05, smoothstep(0.6, 0.85, nL.b * 0.5 + nM.g * 0.6) * 0.45);
  g = mix(vec3(vluma(g)), g, 0.86);
  g *= 0.9 + 0.18 * 0.5 + (nD.g - 0.5) * 0.1;
  return g;
}

float ringDensity(float d) {
  float a = mix(1.0, 0.25, smoothstep(uRings.x * 0.3, uRings.x, d));
  float b = mix(0.25, 0.0625, smoothstep(uRings.x, uRings.y, d));
  float c = mix(0.0625, 0.0, smoothstep(uRings.y, uRings.z, d));
  return d < uRings.x ? a : (d < uRings.y ? b : c);
}

void main() {
  float T = uRings.w;
  vec2 tileO = aTile.xy;
  // dihedral variant per tile breaks repetition
  float th = vhash(tileO * 0.0731 + vec2(3.1, 7.7));
#ifdef PLANT
  vec2 l = aRoot.xy - T * 0.5;
#else
  vec2 l = position.xz - T * 0.5;
#endif
  if (th > 0.5) l = l.yx;
  if (fract(th * 7.0) > 0.5) l.x = -l.x;
  if (fract(th * 13.0) > 0.5) l.y = -l.y;
  vec2 root = tileO + T * 0.5 + l;

  vec2 grad;
  vec4 fd = fieldSample(root, grad);
  float h = fd.r;
  float slope = length(grad);
  vec3 terrN = normalize(vec3(-grad.x, 1.0, -grad.y));
  vec3 root3 = vec3(root.x, h, root.y);
  float dist = distance(root3, uCamPos);
  float dens = ringDensity(dist);

  vec4 nP = texture(uNoise, root / 23.0);
  vec4 nQ = texture(uNoise, root / 7.0 + 0.37);
  float rank = aB.y;
  float r1 = aB.z, r2 = aB.w;
#ifdef PLANT
  rank = aB.x; r1 = aB.y; r2 = aB.z;
#endif

  // ---- layer coverage + size
  float cover, hgt, wid = 1.0;
  float alpine = smoothstep(150.0, 280.0, h);
  float forest = fd.b;
  float dry = smoothstep(0.55, 0.85, texture(uNoise, root / 640.0).a * 0.8 + texture(uNoise, root / 170.0).a * 0.35);
#if defined(LAYER_GRASS)
  cover = fd.g * (1.0 - smoothstep(0.55, 0.95, slope)) * (1.0 - forest * 0.35);
  cover *= smoothstep(0.08, 0.3, nQ.g * 0.6 + nP.r * 0.6 + fd.g * 0.3);   // soft bald-patch edges
  float tall = smoothstep(0.35, 0.75, nP.r * 0.8 + texture(uNoise, root / 90.0).g * 0.5);
  hgt = mix(0.45, 1.1, tall) * mix(0.55, 1.2, r1 * r1);
  hgt *= mix(1.0, 0.5, alpine) * mix(1.0, 0.6, forest) * mix(1.0, 0.85, dry);
  hgt *= 0.55 + 0.45 * smoothstep(0.0, 0.6, fd.g);
  if (r1 > 0.985) hgt *= 1.55;                       // a few tall seed stalks
#elif defined(LAYER_REED)
  cover = fd.a * smoothstep(0.2, 0.5, nQ.r * 0.5 + nP.g * 0.7);
  hgt = mix(1.0, 1.9, r1) * (0.7 + 0.3 * nP.b);
  wid = 0.85;
#elif defined(LAYER_FLOWER)
  float cl = texture(uNoise, root / 41.0 + 0.71).g * 0.7 + texture(uNoise, root / 13.0).b * 0.5;
  cover = fd.g * (1.0 - forest) * (1.0 - alpine * 0.6) * smoothstep(0.46, 0.68, cl) * (1.0 - smoothstep(0.4, 0.7, slope));
  hgt = mix(0.75, 1.3, r1) * (1.0 - alpine * 0.35);
#elif defined(LAYER_FERN)
  cover = smoothstep(0.35, 0.8, forest) * smoothstep(0.1, 0.4, fd.g + 0.25) * (1.0 - smoothstep(0.7, 1.1, slope)) * smoothstep(0.3, 0.55, nP.g * 0.7 + nQ.r * 0.5);
  hgt = mix(0.7, 1.35, r1);
#endif
  cover *= uLayer.z;
  float present = vsat((dens * cover - rank) / max(0.12 * dens, 1e-3));
  float fadeGround = smoothstep(uRings.z * 0.55, uRings.z, dist);
  hgt *= uLayer.x * present;
  if (present <= 0.001) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

  // ---- wind
  float g = vegGust(root);
  float ws = uWindStrength;
  float bendAmt = ws * vegGustBend(g) * (0.65 + 0.5 * r2);
  float flutter = sin(uTime * (3.2 + r1 * 2.6) + root.x * 1.7 + root.y * 1.3 + r2 * 6.283) * (0.05 + 0.1 * ws)
                + sin(uTime * 7.1 + r1 * 17.0) * 0.02 * ws;
  float yaw = r2 * 6.2831 + th * 3.0;
  vec2 F = vec2(cos(yaw), sin(yaw));
  vec2 W = vec2(-F.y, F.x);
  vec2 bend = uWindDir * (bendAmt * 0.6 + flutter) + F * (0.12 + r1 * 0.35);
  // player pushes blades aside
  vec2 dp = root - uPlayerPos.xz;
  float dl = length(dp);
  float push = (1.0 - smoothstep(0.2, 1.4, dl)) * (1.0 - smoothstep(1.0, 2.5, abs(uPlayerPos.y - h)));
  bend += dp / max(dl, 1e-3) * push * 1.4;
  float bl = length(bend);
  bend *= min(1.0, 1.35 / max(bl, 1e-3));
  bl = min(bl, 1.35);

  vec3 pos;
  vec3 nrm;
  float t;
#ifdef PLANT
  // baked mesh: yaw-rotate, scale, sway by height
  float s = hgt;
  vec3 lp = position * s;
  float cy = cos(yaw), sy = sin(yaw);
  lp.xz = vec2(cy * lp.x - sy * lp.z, sy * lp.x + cy * lp.z);
  float hn = vsat(position.y / 0.5);
  t = hn;
  vec2 sway = (uWindDir * (bendAmt * 0.28 + flutter * 0.6) + dp / max(dl, 1e-3) * push * 0.6) * hn * hn * s;
  lp.xz += sway;
  lp.y -= dot(sway, sway) * 0.4;
  pos = root3 + lp;
  nrm = normalize(mix(terrN, normalize(vec3(lp.x, 0.6, lp.z) + vec3(0.0, 0.3, 0.0)), 0.5));
  vData2 = vec4(aB.w, aRoot.z, dry, 0.0);
#else
  t = position.y;
  float side = aB.x;
  float bh = hgt * mix(0.95, 1.05, nQ.b);
  float compW = clamp(inversesqrt(max(dens, 0.04)), 1.0, 3.2);
  float bw = (0.05 + 0.035 * r1) * uLayer.y * wid * mix(1.0, compW, 0.75) * mix(1.0, 1.25, step(0.985, r1) * 0.0);
  float w = bw * (1.0 - pow(t, 1.5)) * (0.65 + 0.35 * present);
  vec2 off = bend * bh * (t * t) * 0.85;
  float y = bh * t * (1.0 - 0.32 * bl * bl * t);
  pos = root3 + vec3(off.x, y, off.y) + vec3(W.x, 0.0, W.y) * side * w * 0.5;
  // sink slightly with distance so coarse terrain LOD never shows floating roots
  pos.y -= smoothstep(30.0, 100.0, dist) * 0.12;
  // normal: blade face normal, rounded across the width, tilted by bend
  vec3 Fn = vec3(F.x, 0.0, F.y);
  vec3 bendDir = vec3(bend.x, 0.0, bend.y);
  nrm = normalize(Fn * 0.8 + vec3(W.x, 0.0, W.y) * side * 0.55 - bendDir * 0.6 * t + vec3(0.0, 0.35 + 0.4 * t, 0.0));
  vData2 = vec4(0.0, 0.0, dry, 0.0);
#endif
  vec3 base = terrainGrass(root, forest, h);
  vBase = base;
  vTerrN = terrN;
  vNormalW = nrm;
  vData = vec4(t, fadeGround, smoothstep(0.5, 0.85, g) * ws, r1);
  vec4 worldPosition = vec4(pos, 1.0);
  vWorldPos = pos;
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  vec3 transformedNormal = normalize(mat3(viewMatrix) * terrN);
  #include <shadowmap_vertex>
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */`
#include <common>
#include <packing>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
#include <fog_pars_fragment>
${VEG_COMMON}
${VEG_LIGHT}
uniform vec3 cTipA, cTipB, cDryTip;
uniform vec3 cPetals[4];
in vec3 vBase;
in vec3 vNormalW;
in vec3 vTerrN;
in vec3 vWorldPos;
in vec4 vData;
in vec4 vData2;

void main() {
  float t = vData.x;
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 Nb = normalize(vNormalW);
  if (!gl_FrontFacing) Nb = -Nb;
  vec3 base = vBase;
  vec3 albedo;
  float trans = 0.0;
#if defined(LAYER_GRASS) || defined(LAYER_REED)
  vec3 rootC = base * vec3(0.42, 0.52, 0.48);
  vec3 tip = mix(cTipA, cTipB, vData.w);
  tip = mix(tip, base * 1.1, 0.32);
  tip = mix(tip, cDryTip, vData2.z * 0.55);
  #ifdef LAYER_REED
  rootC = base * vec3(0.45, 0.55, 0.4);
  tip = mix(vec3(0.33, 0.42, 0.14), vec3(0.62, 0.6, 0.3), vData.w * 0.8);
  #endif
  albedo = mix(rootC, tip, smoothstep(0.0, 1.0, pow(t, 0.75)));
  // gust sheen: bent blades catch the sky -> bright bands sweep across the field
  albedo *= (1.0 + vData.z * 0.5 * t) * (0.9 + 0.1 * smoothstep(0.0, 0.2, vData.z));
  trans = t * t * 0.7;
  float ao = mix(0.6, 1.0, smoothstep(0.0, 0.7, t));
  vec3 N = normalize(mix(Nb, vTerrN, 0.55));
#elif defined(LAYER_FLOWER)
  float part = vData2.x;
  int sp = int(clamp(floor(texture(uNoise, vWorldPos.xz / 55.0 + 0.2).r * 4.6 - 0.3), 0.0, 3.0));
  vec3 petal = cPetals[sp] * (0.9 + 0.2 * vData.w);
  vec3 stem = base * vec3(0.7, 0.85, 0.6);
  albedo = part > 1.5 ? vec3(0.95, 0.72, 0.18) : (part > 0.5 ? petal : stem);
  trans = part > 0.5 ? 0.7 : 0.3;
  float ao = mix(0.6, 1.0, t);
  vec3 N = normalize(mix(Nb, vec3(0.0, 1.0, 0.0), part > 0.5 ? 0.6 : 0.4));
#else // FERN
  float part = vData2.x;
  vec3 fern = mix(vec3(0.16, 0.36, 0.08), vec3(0.32, 0.5, 0.12), vData.w);
  albedo = mix(fern * 0.75, fern * 1.15, part) ;
  albedo = mix(albedo, base, 0.25);
  trans = 0.6;
  float ao = mix(0.55, 1.0, t);
  vec3 N = normalize(mix(Nb, vec3(0.0, 1.0, 0.0), 0.35));
#endif
  // distance fade into the ground colour (no visible pop-in line)
  albedo = mix(albedo, base, vData.y);
  N = normalize(mix(N, vTerrN, vData.y));
  float shadow = getShadowMask();
  vec3 col = vegLight(albedo, N, V, shadow, ao, trans * (1.0 - vData.y), 0.18);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

// ---------------------------------------------------------------- layer
const _frustum = new THREE.Frustum(), _m = new THREE.Matrix4(), _box = new THREE.Box3();

export class GroundLayer {
  constructor(ctx, field, noiseTex, opts) {
    const { name, tile, rings, define, patch, maxHeight, layer } = opts;
    this.ctx = ctx; this.field = field; this.tile = tile; this.rings = rings; this.maxHeight = maxHeight;
    this.group = new THREE.Group(); this.group.name = 'veg-' + name;
    const P = ctx.world.TERRAIN_PALETTE;
    const col = h => ({ value: new THREE.Color(h) });
    this.camPos = { value: new THREE.Vector3() };
    const uniforms = {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.lights),
      ...THREE.UniformsLib.fog,
      ...vegUniforms(ctx, noiseTex),
      uField: field.uniform,
      uCamPos: this.camPos,
      uRings: { value: new THREE.Vector4(rings[0], rings[1], rings[2], tile) },
      uLayer: { value: new THREE.Vector4(...layer) },
      cGrassSun: col(P.grassSun), cGrassLush: col(P.grassLush), cGrassDry: col(P.grassDry), cGrassShade: col(P.grassShade),
      cAlpine: col(P.grassAlpine), cForest: col(P.forestFloor),
      cTipA: col(0x86c24c), cTipB: col(0xa6d062), cDryTip: col(0xd0cc78),
      cPetals: { value: [new THREE.Color(0xf6f3ea), new THREE.Color(0xf4cf3c), new THREE.Color(0x6f86e6), new THREE.Color(0xe98bb0)] },
    };
    const defines = { [define]: 1 };
    if (opts.plant) defines.PLANT = 1;
    this.material = new THREE.ShaderMaterial({
      name: 'veg-' + name, uniforms, defines, vertexShader: VERT, fragmentShader: FRAG,
      lights: true, fog: true, side: THREE.DoubleSide,
    });
    this.meshes = [];
    const fracs = [1, 0.25, 0.0625];
    for (let r = 0; r < 3; r++) {
      const src = r > 0 && opts.patchFar ? opts.patchFar : patch;
      const base = src.geo;
      const g = new THREE.InstancedBufferGeometry();
      for (const k in base.attributes) g.setAttribute(k, base.attributes[k]);
      g.setIndex(base.index);
      const n = Math.ceil(src.count * fracs[r]);
      const cnt = src.offsets ? src.offsets[n] : n * src.idxPer;
      g.setDrawRange(0, cnt);
      const R = rings[r], maxTiles = Math.ceil((2 * R) / tile + 2) ** 2;
      const arr = new Float32Array(maxTiles * 3);
      const attr = new THREE.InstancedBufferAttribute(arr, 3);
      attr.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('aTile', attr);
      g.instanceCount = 0;
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
      const mesh = new THREE.Mesh(g, this.material);
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.renderOrder = -10 + r;
      mesh.name = `veg-${name}-ring${r}`;
      this.group.add(mesh);
      this.meshes.push({ mesh, attr, arr, maxTiles });
    }
    this.cover = opts.cover || null;   // (field, x0, z0, T) -> bool : tile may contain this layer
    this._last = new THREE.Vector3(1e9, 0, 0);
    this._lastQ = new THREE.Quaternion();
  }

  update(camera, force) {
    const cp = camera.position;
    this.camPos.value.copy(cp);
    if (!force && cp.distanceToSquared(this._last) < 0.25 && camera.quaternion.angleTo(this._lastQ) < 0.02) return;
    this._last.copy(cp); this._lastQ.copy(camera.quaternion);
    camera.updateMatrixWorld();
    _m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_m);
    const T = this.tile, f = this.field, mh = this.maxHeight;
    const R2 = this.rings[2];
    const i0 = Math.floor((cp.x - R2) / T), i1 = Math.floor((cp.x + R2) / T);
    const j0 = Math.floor((cp.z - R2) / T), j1 = Math.floor((cp.z + R2) / T);
    const counts = [0, 0, 0];
    // camera height above ground: when high up, skip the ground cover entirely
    const gh = f.sample(cp.x, cp.z, 0);
    if (cp.y - gh > R2) { for (const m of this.meshes) m.mesh.geometry.instanceCount = 0; return; }
    for (let j = j0; j <= j1; j++) {
      const z = j * T;
      for (let i = i0; i <= i1; i++) {
        const x = i * T;
        // nearest point of the tile to the camera (horizontal)
        const nx = Math.max(x, Math.min(cp.x, x + T)) - cp.x, nz = Math.max(z, Math.min(cp.z, z + T)) - cp.z;
        const hc = f.sample(x + T * 0.5, z + T * 0.5, 0);
        const dy = Math.max(0, Math.abs(cp.y - hc) - T);
        const d = Math.sqrt(nx * nx + nz * nz + dy * dy);
        let r = d < this.rings[0] ? 0 : d < this.rings[1] ? 1 : d < R2 ? 2 : -1;
        if (r < 0) continue;
        if (this.cover && !this.cover(f, x, z, T)) continue;
        const h0 = Math.min(hc, f.sample(x, z, 0), f.sample(x + T, z + T, 0), f.sample(x + T, z, 0), f.sample(x, z + T, 0));
        const h1 = Math.max(hc, f.sample(x, z, 0), f.sample(x + T, z + T, 0), f.sample(x + T, z, 0), f.sample(x, z + T, 0));
        _box.min.set(x - 1.5, h0 - 0.5, z - 1.5); _box.max.set(x + T + 1.5, h1 + mh, z + T + 1.5);
        if (!_frustum.intersectsBox(_box)) continue;
        const m = this.meshes[r];
        if (counts[r] >= m.maxTiles) continue;
        const k = counts[r]++ * 3;
        m.arr[k] = x; m.arr[k + 1] = z; m.arr[k + 2] = 0;
      }
    }
    for (let r = 0; r < 3; r++) {
      const m = this.meshes[r];
      m.mesh.geometry.instanceCount = counts[r];
      m.attr.clearUpdateRanges();
      m.attr.addUpdateRange(0, counts[r] * 3);
      m.attr.needsUpdate = true;
    }
  }
}

// ---------------------------------------------------------------- factory
// tile coverage tests on the CPU copy of the field map (skip tiles a layer can't occupy)
function tileMax(ch, thr, step) {
  return (f, x, z, T) => {
    for (let j = 0; j <= T; j += step) for (let i = 0; i <= T; i += step) if (f.sample(x + i, z + j, ch) > thr) return true;
    return false;
  };
}
function tileMin(ch, thr, step) {
  return (f, x, z, T) => {
    for (let j = 0; j <= T; j += step) for (let i = 0; i <= T; i += step) if (f.sample(x + i, z + j, ch) < thr) return false;
    return true;
  };
}
export function createGroundCover(ctx, field, noiseTex, quality = 1) {
  const layers = [];
  const q = quality;
  // grass: ~64 blades / m2 near the camera
  const grassTile = 4;
  const gp = grassPatch(grassTile, Math.round(1024 * q), 1234, 4);
  const gpFar = grassPatch(grassTile, Math.round(1024 * q), 1234, 2);
  layers.push(new GroundLayer(ctx, field, noiseTex, {
    name: 'grass', tile: grassTile, rings: [30, 62, 96], define: 'LAYER_GRASS', patch: gp, patchFar: gpFar, maxHeight: 1.6, layer: [1, 1, 1, 0],
    cover: tileMax(1, 0.03, 2),
  }));
  // reeds along rivers + lakes
  const rp = grassPatch(4, Math.round(220 * q), 4321, 5);
  const rpFar = grassPatch(4, Math.round(220 * q), 4321, 2);
  layers.push(new GroundLayer(ctx, field, noiseTex, {
    name: 'reeds', tile: 4, rings: [30, 60, 90], define: 'LAYER_REED', patch: rp, patchFar: rpFar, maxHeight: 2.4, layer: [1, 0.55, 1, 0],
    cover: tileMax(3, 0.05, 1),
  }));
  // wildflowers (in clusters)
  const fA = tileMax(1, 0.1, 4), fB = tileMin(2, 0.9, 4);
  const flowerCover = (f, x, z, T) => fA(f, x, z, T) && !fB(f, x, z, T);
  const rand = mulberry32(99);
  const fprotos = [
    protoFlower(rand, 6, 0.085, 0.32, 0.4, 0.3),
    protoFlower(rand, 5, 0.06, 0.5, 0.3, 0.12),
    protoFlower(rand, 8, 0.065, 0.22, 0.36, 0.45),
    protoFlower(rand, 5, 0.07, 0.42, 0.46, 0.2),
    protoFlower(rand, 6, 0.1, 0.28, 0.55, 0.35),
  ];
  const fp = plantPatch(8, Math.round(360 * q), 777, fprotos, 7);
  layers.push(new GroundLayer(ctx, field, noiseTex, {
    name: 'flowers', tile: 8, rings: [26, 52, 80], define: 'LAYER_FLOWER', plant: true, patch: fp, maxHeight: 0.8, layer: [1, 1, 1, 0],
    cover: flowerCover,
  }));
  // ferns on the forest floor
  const ferns = [protoFern(rand, 7, 0.7), protoFern(rand, 9, 0.85), protoFern(rand, 6, 0.6)];
  const pp = plantPatch(8, Math.round(70 * q), 555, ferns, 3);
  layers.push(new GroundLayer(ctx, field, noiseTex, {
    name: 'ferns', tile: 8, rings: [24, 48, 72], define: 'LAYER_FERN', plant: true, patch: pp, maxHeight: 1.4, layer: [1, 1, 1, 0],
    cover: tileMax(2, 0.36, 4),
  }));
  return layers;
}
