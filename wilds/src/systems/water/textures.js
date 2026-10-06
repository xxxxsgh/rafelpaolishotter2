// Procedural, tileable water textures (built once at init, no external assets).
//   makeWaveNormal(): RGBA8 256^2  RG = surface slope (dh/dx, dh/dz) packed 0..1, B = height, A = crest/foam mask
//   makeWaterNoise(): RGBA8 256^2  R = fbm value noise, G = worley F1 (cells), B = fbm #2, A = worley F2-F1 (caustic web)
import * as THREE from 'three';

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function finishTex(data, N) {
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

// Sum of periodic directional waves (integer wave vectors => perfectly tileable).
export function makeWaveNormal(N = 256, seed = 7) {
  const r = rng(seed);
  const waves = [];
  for (let i = 0; i < 56; i++) {
    let kx, ky, k;
    do {
      kx = Math.round((r() * 2 - 1) * 14); ky = Math.round((r() * 2 - 1) * 14);
      k = Math.hypot(kx, ky);
    } while (k < 1.5 || k > 14.5);
    // slight directional bias so the pattern has a "grain" like wind-driven chop
    const ang = Math.atan2(ky, kx);
    const bias = 0.55 + 0.45 * Math.abs(Math.cos(ang - 0.5));
    waves.push({ kx, ky, a: bias * Math.pow(k, -1.35), ph: r() * Math.PI * 2 });
  }
  const H = new Float32Array(N * N), DX = new Float32Array(N * N), DY = new Float32Array(N * N);
  const TAU = Math.PI * 2;
  let maxS = 0, minH = 1e9, maxH = -1e9;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let h = 0, dx = 0, dy = 0;
    const u = x / N, v = y / N;
    for (const w of waves) {
      const p = TAU * (w.kx * u + w.ky * v) + w.ph;
      // sharpened crests: |sin| based profile, peaky like real chop
      const s = Math.sin(p), c = Math.cos(p);
      const prof = 1 - Math.abs(s);           // cusp at troughs, broad crests flipped below
      h += w.a * (s * 0.6 + (prof - 0.36) * 0.4);
      const dprof = -Math.sign(s) * c;
      const d = w.a * (c * 0.6 + dprof * 0.4) * TAU;
      dx += d * w.kx; dy += d * w.ky;
    }
    const k = y * N + x;
    H[k] = h; DX[k] = dx; DY[k] = dy;
    maxS = Math.max(maxS, Math.abs(dx), Math.abs(dy));
    minH = Math.min(minH, h); maxH = Math.max(maxH, h);
  }
  const data = new Uint8Array(N * N * 4);
  for (let k = 0; k < N * N; k++) {
    const hn = (H[k] - minH) / (maxH - minH);
    data[k * 4] = Math.round((DX[k] / maxS * 0.5 + 0.5) * 255);
    data[k * 4 + 1] = Math.round((DY[k] / maxS * 0.5 + 0.5) * 255);
    data[k * 4 + 2] = Math.round(hn * 255);
    data[k * 4 + 3] = Math.round(Math.max(0, Math.min(1, (hn - 0.62) / 0.3)) * 255);
  }
  return finishTex(data, N);
}

export function makeWaterNoise(N = 256, seed = 11) {
  const r = rng(seed);
  // periodic value noise lattice
  function valueLayer(cells) {
    const g = new Float32Array(cells * cells);
    for (let i = 0; i < g.length; i++) g[i] = r();
    return (u, v) => {
      const x = u * cells, y = v * cells;
      const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const x0 = ((xi % cells) + cells) % cells, y0 = ((yi % cells) + cells) % cells;
      const x1 = (x0 + 1) % cells, y1 = (y0 + 1) % cells;
      const a = g[y0 * cells + x0], b = g[y0 * cells + x1], c = g[y1 * cells + x0], d = g[y1 * cells + x1];
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    };
  }
  const oct1 = [valueLayer(4), valueLayer(8), valueLayer(16), valueLayer(32), valueLayer(64)];
  const oct2 = [valueLayer(5), valueLayer(10), valueLayer(20), valueLayer(40)];
  // periodic worley
  const WC = 9;
  const pts = [];
  for (let j = 0; j < WC; j++) for (let i = 0; i < WC; i++) pts.push([(i + 0.15 + r() * 0.7) / WC, (j + 0.15 + r() * 0.7) / WC]);
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    let f = 0, a = 0.5, s = 0;
    for (const o of oct1) { f += o(u, v) * a; s += a; a *= 0.5; }
    f /= s;
    let f2 = 0; a = 0.5; s = 0;
    for (const o of oct2) { f2 += o(u, v) * a; s += a; a *= 0.55; }
    f2 /= s;
    const ci = Math.floor(u * WC), cj = Math.floor(v * WC);
    let d1 = 9, d2 = 9;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = ci + di, jj = cj + dj;
      const p = pts[(((jj % WC) + WC) % WC) * WC + (((ii % WC) + WC) % WC)];
      const px = p[0] + Math.floor(ii / WC), py = p[1] + Math.floor(jj / WC);
      const d = Math.hypot(px - u, py - v) * WC;
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    const k = (y * N + x) * 4;
    data[k] = Math.round(Math.min(1, Math.max(0, (f - 0.5) * 1.6 + 0.5)) * 255);
    data[k + 1] = Math.round(Math.min(1, d1 / 1.0) * 255);
    data[k + 2] = Math.round(Math.min(1, Math.max(0, (f2 - 0.5) * 1.6 + 0.5)) * 255);
    data[k + 3] = Math.round(Math.min(1, (d2 - d1) / 0.6) * 255);
  }
  return finishTex(data, N);
}

// Soft round sprite for spray / mist particles (alpha in A, slight cloudy breakup in RGB).
export function makeSpriteTex(N = 64) {
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = (x + 0.5) / N * 2 - 1, dy = (y + 0.5) / N * 2 - 1;
    const d = Math.hypot(dx, dy);
    const a = Math.max(0, 1 - d);
    const k = (y * N + x) * 4;
    data[k] = data[k + 1] = data[k + 2] = 255;
    data[k + 3] = Math.round(Math.pow(a, 1.6) * 255);
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
