// Toroidal, camera-centred "field map": a float texture holding terrain height and
// vegetation suitability so the grass/flower/reed/fern shaders can place
// hundreds of thousands of blades entirely on the GPU.
//   R = terrain height (m)
//   G = ground-cover suitability 0..1 (0 in water, on sand, paths, snow, river beds)
//   B = forest factor 0..1
//   A = shoreline factor 0..1 (land just above a river/lake surface -> reeds)
// Texel (i,j) samples world point ((i - OFF) * CELL, (j - OFF) * CELL); the texture is
// addressed modulo N so recentring only recomputes the strips that scroll into view.
import * as THREE from 'three';

export const FIELD_N = 256;
export const FIELD_CELL = 1.0;
const OFF = 8192;          // keeps world cell indices positive (bitwise wrap in GLSL)
const STEP = 16;           // recentre granularity (cells)

export const FIELD_GLSL = /* glsl */`
uniform highp sampler2D uField;
const float FIELD_CELL = ${FIELD_CELL.toFixed(3)};
const float FIELD_OFF = ${OFF.toFixed(1)};
vec4 fieldTexel(ivec2 c) { return texelFetch(uField, c & ${FIELD_N - 1}, 0); }
// bilinear sample + gradient of height (dh/dx, dh/dz)
vec4 fieldSample(vec2 xz, out vec2 grad) {
  vec2 f = xz / FIELD_CELL + FIELD_OFF;
  vec2 i0 = floor(f);
  vec2 t = f - i0;
  ivec2 c = ivec2(i0);
  vec4 a = fieldTexel(c), b = fieldTexel(c + ivec2(1, 0)), d = fieldTexel(c + ivec2(0, 1)), e = fieldTexel(c + ivec2(1, 1));
  grad = vec2(mix(b.r - a.r, e.r - d.r, t.y), mix(d.r - a.r, e.r - b.r, t.x)) / FIELD_CELL;
  return mix(mix(a, b, t.x), mix(d, e, t.x), t.y);
}
`;

export class FieldMap {
  constructor(world) {
    this.world = world;
    this.data = new Float32Array(FIELD_N * FIELD_N * 4);
    this.tex = new THREE.DataTexture(this.data, FIELD_N, FIELD_N, THREE.RGBAFormat, THREE.FloatType);
    this.tex.magFilter = this.tex.minFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;
    this.tex.colorSpace = THREE.NoColorSpace;
    this.ox = null; this.oz = null;      // world cell index of region min corner (valid data)
    this.jobs = []; this.pending = null;
    this._ri = {};
    this.uniform = { value: this.tex };
  }

  _cell(i, j) {
    const w = this.world, x = (i - OFF) * FIELD_CELL, z = (j - OFF) * FIELD_CELL;
    const h = w.getHeight(x, z);
    let suit = 1, shore = 0;
    // sea + beach sand
    suit *= smooth(1.2, 4.0, h);
    // rivers
    const ri = w.getRiverInfo ? w.getRiverInfo(x, z, this._ri) : null;
    if (ri) {
      const m = w.getRiverMask(x, z);
      suit *= 1 - m;
      const dh = h - ri.waterY;
      if (ri.dist < ri.halfWidth + 14) shore = Math.max(shore, smooth(-0.7, -0.15, dh) * (1 - smooth(0.5, 1.7, dh)));
      if (dh < -0.05 && ri.dist < ri.halfWidth + 2) suit = 0;
    }
    // lakes
    for (let k = 0; k < w.LAKES.length; k++) {
      const L = w.LAKES[k];
      const dd = (x - L.x) ** 2 + (z - L.z) ** 2;
      if (dd > (L.r * 2) ** 2) continue;
      const dh = h - L.y;
      if (dh < 0.05) suit = 0;
      shore = Math.max(shore, smooth(-0.8, -0.15, dh) * (1 - smooth(0.6, 1.9, dh)));
    }
    if (h < 0.4) suit = 0;
    // paths, snow, mesas
    if (w.getPathMask) suit *= 1 - 0.92 * smooth(0.25, 0.75, w.getPathMask(x, z));
    if (w.snowLine) suit *= 1 - smooth(-25, 5, h - w.snowLine(x, z));
    if (w.mesaFactor) suit *= 1 - 0.8 * w.mesaFactor(x, z);
    const forest = w.forestFactor ? w.forestFactor(x, z) : 0;
    const k = ((j & (FIELD_N - 1)) * FIELD_N + (i & (FIELD_N - 1))) * 4;
    this.data[k] = h; this.data[k + 1] = suit; this.data[k + 2] = forest; this.data[k + 3] = shore;
  }

  // world cell origin wanted for a focus position
  _want(x, z) {
    const ci = Math.round(x / FIELD_CELL / STEP) * STEP + OFF, cj = Math.round(z / FIELD_CELL / STEP) * STEP + OFF;
    return [ci - FIELD_N / 2, cj - FIELD_N / 2];
  }

  rebuild(x, z) {
    const [ox, oz] = this._want(x, z);
    for (let j = oz; j < oz + FIELD_N; j++) for (let i = ox; i < ox + FIELD_N; i++) this._cell(i, j);
    this.ox = ox; this.oz = oz; this.jobs.length = 0; this.pending = null;
    this.tex.needsUpdate = true;
  }

  // incremental recentre with a per-frame time budget (ms)
  update(x, z, budgetMs = 1.5) {
    if (this.ox === null) { this.rebuild(x, z); return; }
    if (!this.pending) {
      const [nx, nz] = this._want(x, z);
      if (nx === this.ox && nz === this.oz) return;
      if (Math.abs(nx - this.ox) >= FIELD_N / 2 || Math.abs(nz - this.oz) >= FIELD_N / 2) { this.rebuild(x, z); return; }
      // strips: columns of the new region outside the old one (full height), then rows
      const jobs = this.jobs; jobs.length = 0;
      for (let i = nx; i < nx + FIELD_N; i++) if (i < this.ox || i >= this.ox + FIELD_N) jobs.push(0, i);
      for (let j = nz; j < nz + FIELD_N; j++) if (j < this.oz || j >= this.oz + FIELD_N) jobs.push(1, j);
      this.pending = [nx, nz]; this.jobIdx = 0;
    }
    const [nx, nz] = this.pending;
    const t0 = performance.now();
    while (this.jobIdx < this.jobs.length) {
      const kind = this.jobs[this.jobIdx], v = this.jobs[this.jobIdx + 1];
      this.jobIdx += 2;
      if (kind === 0) for (let j = nz; j < nz + FIELD_N; j++) this._cell(v, j);
      else for (let i = nx; i < nx + FIELD_N; i++) { if (i < this.ox || i >= this.ox + FIELD_N) continue; this._cell(i, v); }
      if (performance.now() - t0 > budgetMs) break;
    }
    if (this.jobIdx >= this.jobs.length) {
      this.ox = nx; this.oz = nz; this.pending = null;
      this.tex.needsUpdate = true;
    }
  }

  // CPU bilinear sample of channel c (0 height, 1 suit, 2 forest, 3 shore)
  sample(x, z, c = 0) {
    const fx = x / FIELD_CELL + OFF, fz = z / FIELD_CELL + OFF;
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, M = FIELD_N - 1, d = this.data;
    const a = d[((j & M) * FIELD_N + (i & M)) * 4 + c], b = d[((j & M) * FIELD_N + ((i + 1) & M)) * 4 + c];
    const e = d[(((j + 1) & M) * FIELD_N + (i & M)) * 4 + c], f = d[(((j + 1) & M) * FIELD_N + ((i + 1) & M)) * 4 + c];
    return (a + (b - a) * tx) * (1 - tz) + (e + (f - e) * tx) * tz;
  }
}

function smooth(a, b, v) { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); }
