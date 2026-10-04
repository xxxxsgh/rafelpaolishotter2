// Time-of-day colour script, keyed by sun elevation (degrees).
// Colours are authored in sRGB and converted to linear once at load.
import * as THREE from 'three';

const K = (elev, o) => ({ elev, ...o });
// zenith/horizon: sky gradient; glow: sun-side in-scatter tint; sun: key light colour; sunI: key intensity
// sky/gnd: hemisphere fill; hemiI; exp: exposure; band: sunset horizon band strength
// cLit/cShade: cloud lit/shadow colours; mist: aerial-perspective colour bias (low valley haze)
const KEYS = [
  K(-24, { zenith: 0x061722, horizon: 0x16323b, glow: 0x0a1418, sun: 0x9fc4e0, sunI: 0.0, sky: 0x4a7f8e, gnd: 0x16241f, hemiI: 0.62, exp: 1.55, band: 0.0, cLit: 0x34525c, cShade: 0x0f2229 }),
  K(-10, { zenith: 0x10284a, horizon: 0x3c5a78, glow: 0x3a3456, sun: 0x9fb8e0, sunI: 0.0, sky: 0x55779a, gnd: 0x1e2428, hemiI: 0.62, exp: 1.45, band: 0.15, cLit: 0x4a5a7a, cShade: 0x1c2638 }),
  K(-4,  { zenith: 0x2b4c80, horizon: 0xb98d88, glow: 0xd06a48, sun: 0xff7040, sunI: 0.0, sky: 0x7486ad, gnd: 0x3a3236, hemiI: 0.72, exp: 1.3, band: 0.7, cLit: 0xd88a78, cShade: 0x47486a }),
  K(1,   { zenith: 0x3d67a8, horizon: 0xd6aea0, glow: 0xff9848, sun: 0xff9050, sunI: 1.5, sky: 0x8d9ec4, gnd: 0x4f4234, hemiI: 0.85, exp: 1.18, band: 0.65, cLit: 0xf0a888, cShade: 0x6a6a88 }),
  K(6,   { zenith: 0x4a80c4, horizon: 0xcfd2cc, glow: 0xffc078, sun: 0xffb874, sunI: 2.3, sky: 0x9cb2d4, gnd: 0x5a5038, hemiI: 0.95, exp: 1.08, band: 0.45, cLit: 0xf6d4b4, cShade: 0x7c8098 }),
  K(14,  { zenith: 0x5d99d4, horizon: 0xd6e0d6, glow: 0xffc27a, sun: 0xffdcaa, sunI: 2.9, sky: 0xa8c2de, gnd: 0x5e5a40, hemiI: 1.05, exp: 1.0, band: 0.35, cLit: 0xfff0d8, cShade: 0x8c9cb8 }),
  K(30,  { zenith: 0x5f9ed8, horizon: 0xd4eaee, glow: 0xffe6bc, sun: 0xfff1dc, sunI: 3.25, sky: 0xb2cde8, gnd: 0x62603f, hemiI: 1.12, exp: 1.0, band: 0.1, cLit: 0xffffff, cShade: 0xa4b4ca }),
  K(70,  { zenith: 0x5b9bd8, horizon: 0xd6ecf0, glow: 0xfff2dc, sun: 0xfff8ee, sunI: 3.4, sky: 0xb8d4ee, gnd: 0x666442, hemiI: 1.15, exp: 0.98, band: 0.0, cLit: 0xffffff, cShade: 0xa8b8cc }),
];

const COLOR_KEYS = ['zenith', 'horizon', 'glow', 'sun', 'sky', 'gnd', 'cLit', 'cShade'];
const NUM_KEYS = ['sunI', 'hemiI', 'exp', 'band'];
for (const k of KEYS) for (const c of COLOR_KEYS) k[c] = new THREE.Color().setHex(k[c]);   // sRGB hex -> linear

export function makePaletteState() {
  const s = {};
  for (const c of COLOR_KEYS) s[c] = new THREE.Color();
  for (const n of NUM_KEYS) s[n] = 0;
  return s;
}

const smooth = t => t * t * (3 - 2 * t);
export function samplePalette(elevDeg, out) {
  let i = 0;
  while (i < KEYS.length - 2 && elevDeg > KEYS[i + 1].elev) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = smooth(Math.min(1, Math.max(0, (elevDeg - a.elev) / (b.elev - a.elev))));
  for (const c of COLOR_KEYS) out[c].copy(a[c]).lerp(b[c], t);
  for (const n of NUM_KEYS) out[n] = a[n] + (b[n] - a[n]) * t;
  return out;
}
