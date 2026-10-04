// Tileable multi-channel noise texture used by terrain + prop shaders.
//   R: low-frequency fbm (macro colour variation)
//   G: higher-frequency fbm (detail)
//   B: ridged / crack noise (rock fissures, strata breakup)
//   A: independent fbm (second macro field)
import { mulberry32 } from '../../core/noise.js';

function makeLattice(P, rand) {
  const a = new Float32Array(P * P);
  for (let i = 0; i < a.length; i++) a[i] = rand() * 2 - 1;
  return a;
}
function valueNoise(lat, P, x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const x0 = ((xi % P) + P) % P, y0 = ((yi % P) + P) % P, x1 = (x0 + 1) % P, y1 = (y0 + 1) % P;
  const a = lat[y0 * P + x0], b = lat[y0 * P + x1], c = lat[y1 * P + x0], d = lat[y1 * P + x1];
  return (a + (b - a) * ux) + ((c + (d - c) * ux) - (a + (b - a) * ux)) * uy;
}

export function makeNoiseTexture(THREE, size = 256, seed = 4242) {
  const rand = mulberry32(seed);
  const periods = [4, 8, 16, 32, 64, 128, 256];
  const lats = periods.map(P => [makeLattice(P, rand), makeLattice(P, rand), makeLattice(P, rand), makeLattice(P, rand)]);
  const data = new Uint8Array(size * size * 4);
  const fbm = (ch, u, v, o0, o1) => {
    let s = 0, amp = 1, norm = 0;
    for (let o = o0; o <= o1; o++) {
      const P = periods[o];
      s += amp * valueNoise(lats[o][ch], P, u * P, v * P); norm += amp; amp *= 0.55;
    }
    return s / norm;
  };
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = i / size, v = j / size;
      const r = fbm(0, u, v, 0, 4);
      const g = fbm(1, u, v, 2, 6);
      let rid = 0, amp = 1, norm = 0;
      for (let o = 1; o <= 5; o++) { const P = periods[o]; rid += amp * (1 - Math.abs(valueNoise(lats[o][2], P, u * P, v * P))); norm += amp; amp *= 0.5; }
      rid = Math.pow(rid / norm, 3);
      const a = fbm(3, u, v, 0, 5);
      const k = (j * size + i) * 4;
      data[k] = Math.max(0, Math.min(255, (r * 0.5 + 0.5) * 255 * 1.0));
      data[k + 1] = Math.max(0, Math.min(255, (g * 0.5 + 0.5) * 255));
      data[k + 2] = Math.max(0, Math.min(255, rid * 255));
      data[k + 3] = Math.max(0, Math.min(255, (a * 0.5 + 0.5) * 255));
    }
  }
  // stretch contrast per channel to use the full range
  for (let c = 0; c < 4; c++) {
    let lo = 255, hi = 0;
    for (let k = c; k < data.length; k += 4) { lo = Math.min(lo, data[k]); hi = Math.max(hi, data[k]); }
    const sc = 255 / Math.max(1, hi - lo);
    for (let k = c; k < data.length; k += 4) data[k] = (data[k] - lo) * sc;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
