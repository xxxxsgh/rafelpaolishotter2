// Analytic world height/biome function. Single source of truth for terrain shape —
// rendering, physics, vegetation placement and AI all sample this.
// OWNER: terrain system. Keep the exported API stable.
import { Simplex } from '../core/noise.js';

export const WORLD_SIZE = 4096;          // metres, square, centred on origin
export const WATER_LEVEL = 0;            // sea / lake surface height
const noise = new Simplex(20261004);

export function getHeight(x, z) {
  const n = noise;
  const s = 1 / 900;
  const continent = n.fbm2(x * s * 0.5, z * s * 0.5, 4) * 60 + 25;
  const hills = n.fbm2(x * s * 3, z * s * 3, 5) * 18;
  const m = Math.max(0, n.fbm2(x * s + 40, z * s - 17, 3) - 0.05);
  const mountains = n.ridged2(x * s * 1.4, z * s * 1.4, 6) * 260 * m * m * 2.5;
  let h = continent + hills + mountains;
  // island falloff
  const d = Math.max(Math.abs(x), Math.abs(z)) / (WORLD_SIZE * 0.5);
  h -= Math.max(0, d - 0.8) * 600;
  return h;
}

export function getNormal(x, z, out = { x: 0, y: 1, z: 0 }) {
  const e = 0.75;
  const hx = getHeight(x + e, z) - getHeight(x - e, z);
  const hz = getHeight(x, z + e) - getHeight(x, z - e);
  const l = Math.hypot(hx, 2 * e, hz);
  out.x = -hx / l; out.y = (2 * e) / l; out.z = -hz / l;
  return out;
}

// Returns a biome tag used by vegetation, audio, weather.
export function getBiome(x, z) {
  const h = getHeight(x, z);
  if (h < WATER_LEVEL + 1.5) return 'shore';
  if (h > 210) return 'snow';
  if (h > 130) return 'alpine';
  const f = noise.fbm2(x / 500 + 99, z / 500 - 31, 3);
  if (f > 0.15) return 'forest';
  if (f < -0.35) return 'meadow_dry';
  return 'meadow';
}

export const world = { WORLD_SIZE, WATER_LEVEL, getHeight, getNormal, getBiome };
