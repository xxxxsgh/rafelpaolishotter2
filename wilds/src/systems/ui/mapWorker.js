// Map painter (module worker). Samples the analytic heightfield and paints two images:
//   'paint'  — saturated painterly terrain (minimap tiles)
//   'parch'  — the same land washed onto parchment with contour lines and coastal hatching (world map)
// Messages in:  {id, kind:'world'|'tile', x0, z0, size(m), res(px), style:'paint'|'parch'|'both'}
// Messages out: {id, kind, x0, z0, size, res, paint?:ArrayBuffer, parch?:ArrayBuffer}
import * as W from '../../world/heightfield.js';
import { Simplex } from '../../core/noise.js';

const nz = new Simplex(77123);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
function hex(h) { return [(h >> 16) & 255, (h >> 8) & 255, h & 255]; }
const C = {
  deep: hex(0x2f5f86), mid: hex(0x3f7fa4), shallow: hex(0x6fb4c4), foam: hex(0xd8eee8),
  river: hex(0x5aa4c0), sand: hex(0xe6d6a4), meadow: hex(0x9cc44e), meadowDry: hex(0xc2c466),
  lush: hex(0x7aac40), forest: hex(0x4f8a3c), forestDeep: hex(0x3c7034), mesa: hex(0xcf7f4e),
  mesaLight: hex(0xe3a066), alpine: hex(0x8ba468), rock: hex(0xa79f8e), rockDark: hex(0x7d776c),
  snow: hex(0xf4f6f8), path: hex(0xc9b48a),
};
// parchment
const P = { paper: hex(0xe9dcb8), paperDark: hex(0xd6c49a), ink: hex(0x5a4630), sea: hex(0x9fbcb8), seaDeep: hex(0x7fa2a6) };

function sample(x0, z0, size, res) {
  const n = res * res, step = size / res;
  const h = new Float32Array(n), wat = new Float32Array(n), forest = new Float32Array(n), mesa = new Float32Array(n), snow = new Float32Array(n), path = new Float32Array(n);
  // expensive factors at half resolution, bilinear upsampled
  const hr = Math.ceil(res / 2) + 1, hs = step * 2;
  const fH = new Float32Array(hr * hr), mH = new Float32Array(hr * hr), sH = new Float32Array(hr * hr);
  for (let j = 0; j < hr; j++) for (let i = 0; i < hr; i++) {
    const x = x0 + i * hs, z = z0 + j * hs, k = j * hr + i;
    fH[k] = W.forestFactor(x, z); mH[k] = W.mesaFactor(x, z); sH[k] = W.snowLine(x, z);
  }
  const bil = (A, fx, fz) => {
    const i = Math.min(hr - 2, fx | 0), j = Math.min(hr - 2, fz | 0), tx = fx - i, tz = fz - j;
    const a = A[j * hr + i], b = A[j * hr + i + 1], c = A[(j + 1) * hr + i], d = A[(j + 1) * hr + i + 1];
    return mix(mix(a, b, tx), mix(c, d, tx), tz);
  };
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    const x = x0 + (i + 0.5) * step, z = z0 + (j + 0.5) * step, k = j * res + i;
    const hh = W.getHeight(x, z);
    h[k] = hh;
    const ws = hh > 0.5 ? W.getWaterSurface(x, z) : 0;
    wat[k] = ws > hh ? ws - hh : (hh <= 0 ? -1 : 0);   // -1 = sea marker handled below
    if (hh <= W.WATER_LEVEL) wat[k] = -1;
    const fx = i / 2, fz = j / 2;
    forest[k] = bil(fH, fx, fz); mesa[k] = bil(mH, fx, fz); snow[k] = bil(sH, fx, fz);
    path[k] = (i & 1) === 0 && (j & 1) === 0 && hh > 1 ? W.getPathMask(x, z) : -1;
  }
  // fill skipped path samples from neighbours
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    const k = j * res + i; if (path[k] >= 0) continue;
    const ii = i & ~1, jj = j & ~1; const v = path[Math.min(res - 1, jj) * res + Math.min(res - 1, ii)];
    path[k] = v > 0 ? v : 0;
  }
  return { h, wat, forest, mesa, snow, path, step };
}

function paint(S, x0, z0, size, res, style) {
  const { h, wat, forest, mesa, snow, path, step } = S;
  const out = new Uint8ClampedArray(res * res * 4);
  const parch = style === 'parch';
  const at = (i, j) => h[clamp(j, 0, res - 1) * res + clamp(i, 0, res - 1)];
  const lx = -0.62, ly = 0.55, lz = -0.56;    // light from the north-west, fairly low
  const zf = parch ? 2.2 : 1.6;              // vertical exaggeration for hillshade
  // distance-to-coast field for the sea (shallows + hatching rings), cheap two-pass chamfer
  const coast = new Float32Array(res * res);
  for (let k = 0; k < res * res; k++) coast[k] = wat[k] === -1 ? 1e6 : 0;
  const pass = (a, b, c) => { const v = coast[b] + c; if (v < coast[a]) coast[a] = v; };
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) { const k = j * res + i; if (i > 0) pass(k, k - 1, 1); if (j > 0) { pass(k, k - res, 1); if (i > 0) pass(k, k - res - 1, 1.414); if (i < res - 1) pass(k, k - res + 1, 1.414); } }
  for (let j = res - 1; j >= 0; j--) for (let i = res - 1; i >= 0; i--) { const k = j * res + i; if (i < res - 1) pass(k, k + 1, 1); if (j < res - 1) { pass(k, k + res, 1); if (i < res - 1) pass(k, k + res + 1, 1.414); if (i > 0) pass(k, k + res - 1, 1.414); } }

  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    const k = j * res + i, o = k * 4;
    const x = x0 + (i + 0.5) * step, z = z0 + (j + 0.5) * step;
    const hh = h[k];
    const dx = (at(i + 1, j) - at(i - 1, j)) / (2 * step), dz = (at(i, j + 1) - at(i, j - 1)) / (2 * step);
    const nl = 1 / Math.hypot(dx * zf, 1, dz * zf);
    const nx = -dx * zf * nl, ny = nl, nzv = -dz * zf * nl;
    const slope = 1 - ny;
    let shade = nx * lx + ny * ly + nzv * lz;               // ~ -1..1
    shade = clamp(shade / 0.78, -1, 1.25);
    // low-frequency brush variation
    const b1 = nz.noise2(x / 420, z / 420), b2 = nz.noise2(x / 90 + 13, z / 90 - 7);
    const brush = b1 * 0.6 + b2 * 0.4;
    let r, g, b;
    if (wat[k] === -1) {                                     // sea
      const d = coast[k] * step;                             // metres from shore
      const t = smooth(0, 260, d), t2 = smooth(200, 900, d);
      if (parch) {
        r = mix(P.sea[0], P.seaDeep[0], t2); g = mix(P.sea[1], P.seaDeep[1], t2); b = mix(P.sea[2], P.seaDeep[2], t2);
        r = mix(r, P.paper[0], 0.25 * (1 - t)); g = mix(g, P.paper[1], 0.25 * (1 - t)); b = mix(b, P.paper[2], 0.25 * (1 - t));
        // engraved coastal rings
        const ring = d / 34;
        const fr = ring - Math.floor(ring);
        if (d < 240 && fr < 0.12) { const a = 0.28 * (1 - d / 240); r = mix(r, P.ink[0], a); g = mix(g, P.ink[1], a); b = mix(b, P.ink[2], a); }
      } else {
        r = mix(mix(C.shallow[0], C.mid[0], t), C.deep[0], t2); g = mix(mix(C.shallow[1], C.mid[1], t), C.deep[1], t2); b = mix(mix(C.shallow[2], C.mid[2], t), C.deep[2], t2);
        if (d < step * 1.6) { r = mix(r, C.foam[0], 0.6); g = mix(g, C.foam[1], 0.6); b = mix(b, C.foam[2], 0.6); }
      }
      const v = 1 + brush * 0.04;
      r *= v; g *= v; b *= v;
    } else {
      // land base colour by biome-ish factors
      const dry = smooth(-0.2, -0.5, nz.noise2(x / 500 + 99, z / 500 - 31));
      r = mix(C.meadow[0], C.meadowDry[0], dry); g = mix(C.meadow[1], C.meadowDry[1], dry); b = mix(C.meadow[2], C.meadowDry[2], dry);
      const lush = smooth(0.1, 0.6, b1); r = mix(r, C.lush[0], lush * 0.5); g = mix(g, C.lush[1], lush * 0.5); b = mix(b, C.lush[2], lush * 0.5);
      const f = smooth(0.35, 0.7, forest[k]);
      const fd = 0.5 + 0.5 * nz.noise2(x / 60, z / 60);
      r = mix(r, mix(C.forest[0], C.forestDeep[0], fd), f); g = mix(g, mix(C.forest[1], C.forestDeep[1], fd), f); b = mix(b, mix(C.forest[2], C.forestDeep[2], fd), f);
      const m = smooth(0.3, 0.65, mesa[k]);
      const band = 0.5 + 0.5 * Math.sin(hh * 0.35);
      r = mix(r, mix(C.mesa[0], C.mesaLight[0], band), m); g = mix(g, mix(C.mesa[1], C.mesaLight[1], band), m); b = mix(b, mix(C.mesa[2], C.mesaLight[2], band), m);
      const al = smooth(150, 200, hh); r = mix(r, C.alpine[0], al); g = mix(g, C.alpine[1], al); b = mix(b, C.alpine[2], al);
      const rk = smooth(0.32, 0.55, slope) * (1 - m * 0.6);
      r = mix(r, mix(C.rock[0], C.rockDark[0], 0.5 - brush * 0.5), rk); g = mix(g, mix(C.rock[1], C.rockDark[1], 0.5 - brush * 0.5), rk); b = mix(b, mix(C.rock[2], C.rockDark[2], 0.5 - brush * 0.5), rk);
      const sn = smooth(snow[k] - 12, snow[k] + 12, hh) * (1 - smooth(0.55, 0.8, slope) * 0.5);
      r = mix(r, C.snow[0], sn); g = mix(g, C.snow[1], sn); b = mix(b, C.snow[2], sn);
      const sd = smooth(3.2, 0.6, hh); r = mix(r, C.sand[0], sd); g = mix(g, C.sand[1], sd); b = mix(b, C.sand[2], sd);
      if (path[k] > 0.2) { const a = smooth(0.2, 0.7, path[k]) * 0.7; r = mix(r, C.path[0], a); g = mix(g, C.path[1], a); b = mix(b, C.path[2], a); }
      // hue drift
      r *= 1 + brush * 0.06; g *= 1 + brush * 0.035; b *= 1 - brush * 0.03;
      // painterly hillshade: warm lit side, cool teal shadow side (never black)
      const lit = clamp(shade, 0, 1.25), sh = clamp(-shade, 0, 1);
      const amb = parch ? 0.9 : 0.86;
      r = r * (amb + lit * 0.26) * (1 - sh * 0.34) + sh * 10; g = g * (amb + lit * 0.22) * (1 - sh * 0.28) + sh * 22; b = b * (amb + lit * 0.14) * (1 - sh * 0.12) + sh * 40;
      // inland water (painted version; parchment adds it after the sepia wash)
      if (wat[k] > 0 && !parch) {
        const t = smooth(0, 3, wat[k]);
        r = mix(r, C.river[0], 0.6 + 0.4 * t); g = mix(g, C.river[1], 0.6 + 0.4 * t); b = mix(b, C.river[2], 0.6 + 0.4 * t);
      }
      if (parch) {
        // wash land onto paper: desaturate toward sepia, keep value structure
        const lum = r * 0.3 + g * 0.55 + b * 0.15;
        const sep = [lum * 1.06 + 18, lum * 0.98 + 12, lum * 0.82];
        r = mix(r, sep[0], 0.38); g = mix(g, sep[1], 0.38); b = mix(b, sep[2], 0.38);
        r = mix(r, P.paper[0], 0.2); g = mix(g, P.paper[1], 0.2); b = mix(b, P.paper[2], 0.2);
        // contour lines (every 20 m, index line every 100 m)
        const c0 = Math.floor(hh / 20);
        const cR = Math.floor(at(i + 1, j) / 20), cD = Math.floor(at(i, j + 1) / 20);
        if (wat[k] > 0) {
          const t = smooth(0, 3, wat[k]);
          r = mix(r, 112, 0.7 + 0.3 * t); g = mix(g, 160, 0.7 + 0.3 * t); b = mix(b, 168, 0.7 + 0.3 * t);
        } else if (hh > 2 && (c0 !== cR || c0 !== cD)) {
          const major = (Math.max(c0, cR, cD) % 5) === 0;
          if (!major && slope > 0.45) { /* steep: keep only index lines so cliffs don't turn to mud */ }
          else {
          const a = major ? 0.42 : 0.2;
          r = mix(r, P.ink[0], a); g = mix(g, P.ink[1], a); b = mix(b, P.ink[2], a);
          }
        }
      }
    }
    // shoreline ink
    if (wat[k] !== -1) {
      const sea = (ii, jj) => wat[clamp(jj, 0, res - 1) * res + clamp(ii, 0, res - 1)] === -1;
      if (sea(i + 1, j) || sea(i - 1, j) || sea(i, j + 1) || sea(i, j - 1)) {
        const ink = parch ? P.ink : [52, 74, 70];
        const a = parch ? 0.7 : 0.45;
        r = mix(r, ink[0], a); g = mix(g, ink[1], a); b = mix(b, ink[2], a);
      }
    }
    if (parch) {   // paper grain + fibres
      const gr = nz.noise2(x / 9, z / 9) * 6 + nz.noise2(x / 2.6 + 50, z / 2.6) * 4;
      r += gr; g += gr; b += gr * 0.8;
    }
    out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
  }
  return out;
}

self.onmessage = (e) => {
  const q = e.data;
  try {
    const S = sample(q.x0, q.z0, q.size, q.res);
    const msg = { id: q.id, kind: q.kind, x0: q.x0, z0: q.z0, size: q.size, res: q.res };
    const tr = [];
    if (q.style === 'paint' || q.style === 'both') { msg.paint = paint(S, q.x0, q.z0, q.size, q.res, 'paint').buffer; tr.push(msg.paint); }
    if (q.style === 'parch' || q.style === 'both') { msg.parch = paint(S, q.x0, q.z0, q.size, q.res, 'parch').buffer; tr.push(msg.parch); }
    if (q.sketch && msg.parch) {   // pencil sketch of the land only (uncharted regions of the world map)
      const src = new Uint8ClampedArray(msg.parch), sk = new Uint8ClampedArray(src.length);
      for (let k = 0, n = q.res * q.res; k < n; k++) {
        const o = k * 4;
        if (S.wat[k] === -1) {
          // keep only the coastline itself
          const i = k % q.res, j = (k / q.res) | 0;
          const land = (ii, jj) => ii >= 0 && jj >= 0 && ii < q.res && jj < q.res && S.wat[jj * q.res + ii] !== -1;
          if (land(i + 1, j) || land(i - 1, j) || land(i, j + 1) || land(i, j - 1)) { sk[o] = 92; sk[o + 1] = 70; sk[o + 2] = 46; sk[o + 3] = 120; }
          continue;
        }
        const lum = src[o] * 0.3 + src[o + 1] * 0.55 + src[o + 2] * 0.15;
        const a = clamp((205 - lum) / 150, 0, 1);
        sk[o] = 92; sk[o + 1] = 70; sk[o + 2] = 46; sk[o + 3] = 24 + a * 120;
      }
      msg.sketch = sk.buffer; tr.push(msg.sketch);
    }
    if (q.heights) { msg.heights = S.h.buffer; tr.push(msg.heights); }
    self.postMessage(msg, tr);
  } catch (err) {
    self.postMessage({ id: q.id, error: String(err && err.stack || err) });
  }
};
