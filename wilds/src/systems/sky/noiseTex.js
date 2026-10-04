// Tileable cloud noise texture, generated once on the CPU.
//   R: perlin-worley "billow" (large cumulus shapes)
//   G: worley fbm, mid frequency (puffs)
//   B: worley fbm, high frequency (edge erosion)
//   A: perlin fbm (cirrus / weather / moon craters)
import * as THREE from 'three';
import { mulberry32 } from '../../core/noise.js';

const N = 256;

function makeWorley(rand, cells) {
  const pts = new Float32Array(cells * cells * 2);
  for (let i = 0; i < pts.length; i++) pts[i] = rand();
  return (u, v) => {   // u,v in [0,1), tileable
    const x = u * cells, y = v * cells;
    const cx = Math.floor(x), cy = Math.floor(y);
    let d = 9;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const gx = cx + i, gy = cy + j;
      const wx = ((gx % cells) + cells) % cells, wy = ((gy % cells) + cells) % cells;
      const k = (wy * cells + wx) * 2;
      const dx = gx + pts[k] - x, dy = gy + pts[k + 1] - y;
      const dd = dx * dx + dy * dy;
      if (dd < d) d = dd;
    }
    return Math.sqrt(d);
  };
}

function makePerlin(rand, cells) {
  const g = new Float32Array(cells * cells * 2);
  for (let i = 0; i < cells * cells; i++) { const a = rand() * Math.PI * 2; g[i * 2] = Math.cos(a); g[i * 2 + 1] = Math.sin(a); }
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const dot = (ix, iy, dx, dy) => {
    const k = (((iy % cells) + cells) % cells * cells + (((ix % cells) + cells) % cells)) * 2;
    return g[k] * dx + g[k + 1] * dy;
  };
  return (u, v) => {
    const x = u * cells, y = v * cells;
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const a = dot(ix, iy, fx, fy), b = dot(ix + 1, iy, fx - 1, fy);
    const c = dot(ix, iy + 1, fx, fy - 1), d = dot(ix + 1, iy + 1, fx - 1, fy - 1);
    const sx = fade(fx), sy = fade(fy);
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;   // ~[-0.7,0.7]
  };
}

export function makeCloudNoise() {
  const rand = mulberry32(7741);
  const per = [4, 8, 16, 32, 64].map(c => makePerlin(rand, c));
  const wor = [4, 8, 16, 32, 64].map(c => makeWorley(rand, c));
  const raw = [new Float32Array(N * N), new Float32Array(N * N), new Float32Array(N * N), new Float32Array(N * N)];
  const data = new Uint8Array(N * N * 4);
  const clamp = x => x < 0 ? 0 : x > 1 ? 1 : x;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    const pf = per[0](u, v) * 0.55 + per[1](u, v) * 0.28 + per[2](u, v) * 0.12 + per[3](u, v) * 0.05;
    const w = (i) => 1 - wor[i](u, v);
    const wf0 = w(0) * 0.625 + w(1) * 0.25 + w(2) * 0.125;
    const wf1 = w(1) * 0.625 + w(2) * 0.25 + w(3) * 0.125;
    const wf2 = w(2) * 0.625 + w(3) * 0.25 + w(4) * 0.125;
    // perlin-worley: remap perlin with worley as the floor (billowy cumulus)
    const p01 = clamp(pf * 0.9 + 0.5);
    const pw = clamp((p01 - (1 - wf0)) / (1 - (1 - wf0) + 1e-3) * 0.5 + p01 * 0.5);
    const cir = clamp(per[1](u, v) * 0.5 + per[2](u, v) * 0.3 + per[3](u, v) * 0.15 + per[4](u, v) * 0.05 + 0.5);
    const k = y * N + x;
    raw[0][k] = pw; raw[1][k] = wf1; raw[2][k] = wf2; raw[3][k] = cir;
  }
  // R: histogram-equalised so 'coverage' maps ~linearly to sky fraction.
  // G/B/A: robust linear stretch to the full 0..1 range.
  {
    const idx = Array.from({ length: N * N }, (_, i) => i).sort((a, b) => raw[0][a] - raw[0][b]);
    for (let r = 0; r < idx.length; r++) data[idx[r] * 4] = Math.round(r / (idx.length - 1) * 255);
  }
  for (let c = 1; c < 4; c++) {
    const sorted = Float32Array.from(raw[c]).sort();
    const lo = sorted[Math.floor(sorted.length * 0.01)], hi = sorted[Math.floor(sorted.length * 0.99)];
    for (let i = 0; i < N * N; i++) data[i * 4 + c] = Math.round(clamp((raw[c][i] - lo) / (hi - lo)) * 255);
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
