// Water queries shared by every system (player swimming, physics buoyancy, AI, audio, UI).
// OWNER: water system. Built on the river/lake data the terrain exports from heightfield.js.
//
//   getWaterHeight(x, z)      water surface y at (x,z) (ocean incl. waves, lake, river), or null if dry
//   getWaterDepth(x, z)       surface - terrain (m), 0 when dry
//   getFlow(x, z, out?)       {x, z} surface current in m/s (rivers; gentle longshore drift at sea)
//   isUnderwater(pos)         pos.y below the local water surface
//   getWaterKind(x, z)        'ocean' | 'lake' | 'river' | null
//   oceanWaveHeight(x, z, t)  analytic wave offset (matches the ocean vertex shader)
//   OCEAN_WAVES               [dirX, dirZ, wavelength, amplitude, speed] shared with the shader
//   FALLS                     waterfall list {x,z (top), bx,bz,by (bottom), top, dirX, dirZ, w, river}
//   setWaterTime(t)           the water system keeps this in sync with uniforms.uTime
import {
  getHeight, getRiverInfo, RIVERS, LAKES, WATER_LEVEL,
} from './heightfield.js';

// --- ocean waves ------------------------------------------------------------
// Each: direction (normalised), wavelength (m), amplitude (m), phase speed multiplier.
export const OCEAN_WAVES = [
  [0.86, 0.51, 41.0, 0.22, 1.0],
  [0.36, 0.93, 23.0, 0.12, 1.0],
  [0.98, -0.21, 13.5, 0.065, 1.0],
  [-0.3, 0.95, 8.2, 0.035, 1.0],
];
for (const w of OCEAN_WAVES) { const l = Math.hypot(w[0], w[1]); w[0] /= l; w[1] /= l; }

let waterTime = 0;
export function setWaterTime(t) { waterTime = t; }
export function getWaterTime() { return waterTime; }

// Waves calm down in the shallows (depth = sea level - seabed).
export function waveAttenuation(depth) {
  const t = Math.min(1, Math.max(0, (depth + 0.5) / 7));
  return t * t * (3 - 2 * t);
}

export function oceanWaveHeight(x, z, t = waterTime, depth = 30) {
  let h = 0;
  const att = waveAttenuation(depth);
  if (att <= 0) return 0;
  for (let i = 0; i < OCEAN_WAVES.length; i++) {
    const w = OCEAN_WAVES[i];
    const k = 6.283185 / w[2];
    const c = Math.sqrt(9.81 / k) * w[4];
    h += w[3] * Math.sin(k * (w[0] * x + w[1] * z) - k * c * t);
  }
  return h * att;
}

// --- waterfalls (bottom positions resolved from the river polylines) ---------
export const FALLS = [];
for (const r of RIVERS) {
  const p = r.points;
  for (let i = 0; i < p.length - 1; i++) {
    let j = i;
    while (j < p.length - 1 && j - i < 5 && p[j].y - p[j + 1].y > 0.6) j++;
    const drop = p[i].y - p[j].y;
    if (drop > 7 && j > i) {
      const dx = p[j].x - p[i].x, dz = p[j].z - p[i].z, l = Math.hypot(dx, dz) || 1;
      FALLS.push({ river: r.name, x: p[i].x, z: p[i].z, top: p[i].y, bx: p[j].x, bz: p[j].z, by: p[j].y,
        dirX: dx / l, dirZ: dz / l, w: p[i].w, drop });
      i = j;
    }
  }
}

// --- queries -----------------------------------------------------------------
const _ri = {};
const _ri2 = {};

function riverSurface(x, z, h) {
  const info = getRiverInfo(x, z, _ri);
  if (!info) return null;
  if (info.dist > info.halfWidth + 5) return null;
  if (h >= info.waterY) return null;
  return info.waterY;
}

function lakeSurface(x, z, h) {
  for (let i = 0; i < LAKES.length; i++) {
    const L = LAKES[i];
    const dx = x - L.x, dz = z - L.z;
    if (dx * dx + dz * dz < (L.r * 1.45) ** 2 && h < L.y) return L.y;
  }
  return null;
}

let _kind = null;
export function getWaterHeight(x, z) {
  const h = getHeight(x, z);
  let s = null; _kind = null;
  const sea = WATER_LEVEL + oceanWaveHeight(x, z, waterTime, WATER_LEVEL - h);
  if (h < sea) { s = sea; _kind = 'ocean'; }
  const l = lakeSurface(x, z, h);
  if (l !== null && (s === null || l > s)) { s = l; _kind = 'lake'; }
  const r = riverSurface(x, z, h);
  if (r !== null && (s === null || r > s)) { s = r; _kind = 'river'; }
  return s;
}

export function getWaterKind(x, z) { getWaterHeight(x, z); return _kind; }

export function getWaterDepth(x, z) {
  const s = getWaterHeight(x, z);
  return s === null ? 0 : Math.max(0, s - getHeight(x, z));
}

export function isUnderwater(pos) {
  const s = getWaterHeight(pos.x, pos.z);
  return s !== null && pos.y < s;
}

// River current: direction from the channel polyline, speed from the surface gradient
// (steeper reach = faster), strongest mid-channel and dying out at the banks.
export function riverSpeedAt(info, x, z) {
  const up = getRiverInfo(x - info.dirX * 6, z - info.dirZ * 6, _ri2);
  const yUp = up ? up.waterY : info.waterY;
  const dn = getRiverInfo(x + info.dirX * 6, z + info.dirZ * 6, _ri2);
  const yDn = dn ? dn.waterY : info.waterY;
  const slope = Math.max(0, (yUp - yDn) / 12);
  return Math.min(9, 1.1 + slope * 26);
}

export function getFlow(x, z, out = { x: 0, z: 0 }) {
  out.x = 0; out.z = 0;
  const h = getHeight(x, z);
  const info = getRiverInfo(x, z, _ri);
  if (info && info.dist < info.halfWidth + 4 && h < info.waterY) {
    const across = Math.min(1, info.dist / (info.halfWidth + 4));
    const sp = riverSpeedAt(info, x, z) * (1 - across * across);
    const dx = info.dirX, dz = info.dirZ;
    out.x = dx * sp; out.z = dz * sp;
    return out;
  }
  if (h < WATER_LEVEL) {
    // faint longshore drift so floating things don't sit dead still
    out.x = 0.12 * Math.sin(z * 0.002 + waterTime * 0.05);
    out.z = 0.12 * Math.cos(x * 0.002 + waterTime * 0.04);
  }
  return out;
}

export const waterApi = {
  getWaterHeight, getWaterDepth, getWaterKind, getFlow, isUnderwater, oceanWaveHeight, OCEAN_WAVES, FALLS, setWaterTime,
};
