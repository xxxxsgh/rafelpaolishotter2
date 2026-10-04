// Analytic world height/biome function. Single source of truth for terrain shape —
// rendering, physics, vegetation placement and AI all sample this.
// OWNER: terrain system. Keep the exported API stable.
//
// The island (~3.4 km across inside a 4096 m square) is composed from hand-placed
// features evaluated analytically, plus a small precomputed river-distance grid:
//   * a great central plateau of rolling meadow, ringed by strata cliffs with a few ramps
//   * a snow-capped mountain range arcing across the north, with a tall summit
//   * forested hills in the south-west, terraced mesas + a river canyon in the south-east
//   * rivers carved from the mountains to the sea (RIVERS), a lake (LAKES), a plateau
//     stream that drops off the cliff as a waterfall, sandy beaches and rocky headlands.
// Coordinates: x east, z south (north = -z), y up. Sea level = 0.
//
// Exports used by other systems:
//   getHeight(x,z)            fast (~1-2 µs). getNormal(x,z,out). getBiome(x,z).
//   getSurface(x,z,out)       {grass, dirt, rock, sand, snow} weights (sum≈1), matches terrain shader.
//   RIVERS  [{name, width, points:[{x,z,y,w}]}]  y = water surface, w = half-width (m); ordered downstream.
//   LAKES   [{name, x, z, r, y}]                  y = lake surface.
//   WATERFALLS [{x,z,top,bottom,dirX,dirZ,w}]     steep drops along rivers.
//   getRiverInfo(x,z,out)     {dist, waterY, halfWidth, dirX, dirZ, river} for the nearest river (dist ≤ 400) or null.
//   getRiverMask(x,z)         1 inside a river channel, fading to 0 at the bank.
//   isLake(x,z)               lake index or -1.  getWaterSurface(x,z) river/lake/sea surface or -Infinity.
//   TERRAIN_PALETTE           linear-ish sRGB hex colours used by the terrain shader (grass etc.) so
//                             vegetation can match ground tint.
//   LANDMARKS                 named points of interest {name,x,z,kind}.
//   PATHS [{points:[{x,z,w}]}] + getPathMask(x,z)  worn footpaths between landmarks (0..1, 1 = track).
import { Simplex } from '../core/noise.js';

export const WORLD_SIZE = 4096;          // metres, square, centred on origin
export const WATER_LEVEL = 0;            // sea / lake surface height
const HALF = WORLD_SIZE / 2;
const n1 = new Simplex(20261004);
const n2 = new Simplex(91731);
const n3 = new Simplex(5150);

export const TERRAIN_PALETTE = {
  grassSun: 0xa6cc4c, grassLush: 0x84b13c, grassDry: 0xbcc45e, grassShade: 0x5f8f3c,
  grassAlpine: 0x7a9f52, forestFloor: 0x5c7f34, dirt: 0x8d7350, sand: 0xe2d2a2,
  rock: 0xb4a994, rockDark: 0x857b6c, mesaRock: 0xc8784a, snow: 0xf3f6fa,
};

// ---------------------------------------------------------------------------
// helpers
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
function smin(a, b, k) { const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1); return lerp(b, a, h) - k * h * (1 - h); }
function smax(a, b, k) { return -smin(-a, -b, k); }
function segDist2(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  const ex = px - ax - dx * t, ez = pz - az - dz * t;
  return ex * ex + ez * ez;
}
function polyDist(px, pz, pts) {
  let best = 1e18, bt = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = segDist2(px, pz, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (d < best) { best = d; bt = i; }
  }
  return Math.sqrt(best);
}

// ---------------------------------------------------------------------------
// feature layout
const SPINE = [[-1700, -520], [-1350, -880], [-900, -1130], [-420, -1270], [80, -1330], [560, -1250], [1000, -1050], [1380, -760], [1640, -420]];
const SUMMIT = { x: -260, z: -1290, h: 230, r: 400 };
const SUMMIT2 = { x: 760, z: -1170, h: 170, r: 260 };
const PLATEAU = { x: 60, z: 140, r: 560, h: 46 };
const MESA = { x: 1080, z: 980, r: 640 };
const HILLS = { x: -880, z: 860, r: 680 };

// Plateau edge ramps (angle in radians around plateau centre, half-width in radians)
const RAMPS = [[2.35, 0.16], [-0.35, 0.10], [4.3, 0.12]];

function coastMask(x, z) {
  const wx = x + 160 * n2.noise2(x / 900, z / 900);
  const wz = z + 160 * n2.noise2(x / 900 + 7.3, z / 900 - 3.1);
  const r = Math.hypot(wx * 0.94, wz * 1.02) / 1720 + 0.2 * n1.fbm2(x / 650 + 11, z / 650 - 4, 4);
  return r;   // < ~0.9 land
}

function plateauMask(x, z) {
  const dx = x - PLATEAU.x, dz = z - PLATEAU.z;
  const ang = Math.atan2(dz, dx);
  const r = PLATEAU.r * (1 + 0.16 * n1.noise2(Math.cos(ang) * 1.3 + 3, Math.sin(ang) * 1.3 - 2) + 0.06 * n2.noise2(x / 120, z / 120) + 0.022 * n3.noise2(x / 32, z / 32));
  const d = Math.hypot(dx, dz) / r;
  // ramps: soften the cliff band in a few directions
  let soft = 0;
  for (let i = 0; i < RAMPS.length; i++) {
    let da = Math.abs(((ang - RAMPS[i][0]) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
    soft = Math.max(soft, 1 - smooth(RAMPS[i][1] * 0.5, RAMPS[i][1], da));
  }
  const w = lerp(0.045, 0.32, soft);
  return { m: 1 - smooth(1 - w, 1, d), d, soft };
}

function terrace(v, steps, sharp) {
  const s = v * steps, f = Math.floor(s), t = s - f;
  return (f + smooth(1 - sharp, 1, t)) / steps;
}

// Height before rivers/lakes are carved.
export function baseHeight(x, z) {
  const cr = coastMask(x, z);
  // lowland: gentle large swells + rolling hills
  const big = n1.fbm2(x / 1300 + 5, z / 1300 - 9, 3);
  const roll = n2.fbm2(x / 300, z / 300, 4);
  let h = 22 + 16 * big + 9 * roll;

  // south-west forested hills
  const hd = Math.hypot(x - HILLS.x, z - HILLS.z) / HILLS.r;
  if (hd < 1.4) {
    const hm = 1 - smooth(0.4, 1.4, hd);
    const hv = n3.fbm2(x / 260 + 2, z / 260 + 8, 4);
    h += hm * (30 + 55 * Math.max(0, hv + 0.25) ** 1.4);
  }

  // central plateau
  const pm = plateauMask(x, z);
  if (pm.m > 0) {
    const top = 34 + PLATEAU.h + 7 * n3.fbm2(x / 240 - 4, z / 240 + 1, 4) + 10 * big;
    // stepped cliff band: two ledges part-way down the escarpment
    const mt = pm.m * 3, mf = Math.floor(mt), m2 = Math.min(1, (mf + smooth(0.35, 0.9, mt - mf)) / 3);
    h = lerp(h, Math.max(h, top), lerp(m2, pm.m, pm.soft));
  }

  // south-east mesas (terraced, flat-topped, steep strata risers)
  const md = Math.hypot(x - MESA.x, z - MESA.z) / MESA.r;
  if (md < 1.25) {
    const mm = 1 - smooth(0.55, 1.25, md);
    const v = 0.5 + 0.5 * n3.fbm2(x / 420 + 31, z / 420 - 17, 3) + 0.18 * n2.noise2(x / 140, z / 140);
    const t = terrace(clamp(v * 1.15 - 0.1, 0, 1), 4, 0.22);
    h = lerp(h, 26 + t * 120, mm * smooth(0.0, 0.35, v));
  }

  // northern mountain range
  const sd = polyDist(x, z, SPINE);
  if (sd < 900) {
    const wx = x + 90 * n1.noise2(x / 400 + 1.7, z / 400), wz = z + 90 * n1.noise2(x / 400 - 4.2, z / 400 + 3);
    const mm = 1 - smooth(120, 760 + 120 * n2.noise2(x / 600, z / 600), sd);
    const r1 = n2.ridged2(wx / 950, wz / 950, 4, 2.0, 0.5);
    const r2 = n3.ridged2(wx / 320 + 3, wz / 320, 5, 2.1, 0.5);
    const rg = Math.pow(0.58 * r1 + 0.42 * r2 * (0.5 + r1), 1.15);
    const crest = mm * mm;
    let mh = crest * (70 + 400 * rg * (0.55 + 0.45 * mm));
    const s1 = Math.hypot(x - SUMMIT.x, z - SUMMIT.z) / SUMMIT.r;
    mh += SUMMIT.h * Math.exp(-s1 * s1 * 1.6) * (0.75 + 0.5 * rg);
    const s2 = Math.hypot(x - SUMMIT2.x, z - SUMMIT2.z) / SUMMIT2.r;
    mh += SUMMIT2.h * Math.exp(-s2 * s2 * 1.6) * (0.7 + 0.5 * rg);
    h = smax(h, h * (1 - crest * 0.4) + mh, 20);
  }

  // rocky knolls/outcrops scattered over the lowlands and plateau: steep-sided rises
  {
    const o = n3.noise2(x / 170 + 13, z / 170 - 5) + 0.25 * n1.noise2(x / 45, z / 45);
    if (o > 0.5) {
      const t = smooth(0.5, 0.62, o) * 0.7 + smooth(0.62, 0.95, o) * 0.3;
      h += t * (9 + 8 * n2.noise2(x / 300, z / 300)) * (1 - smooth(130, 200, h));
    }
  }
  // fine detail (small undulation; stronger on high rocky ground)
  h += 1.6 * n3.noise2(x / 38, z / 38) + 0.5 * n1.noise2(x / 13, z / 13);
  if (h > 90) h += Math.min(1, (h - 90) / 120) * 14 * (n1.ridged2(x / 110, z / 110, 3) - 0.45);

  // coast: beaches slope gently into the sea, rocky bits stay higher
  // coast: wide sandy beaches, with rocky headlands where the noise says so
  const rocky = smooth(0.15, 0.5, n2.noise2(x / 520 + 20, z / 520 - 7));
  const beachT = smooth(0.64, 0.9, cr) * (1 - rocky * 0.85);
  const beachH = 2.0 + Math.max(0, 0.9 - cr) * 70 + 0.8 * n1.noise2(x / 60, z / 60);
  h = lerp(h, Math.min(h, beachH), beachT);
  const seabed = Math.max(-38 + 6 * n1.noise2(x / 300, z / 300), -1.5 - (cr - 0.9) * lerp(260, 900, rocky));
  h = lerp(h, Math.min(h, seabed), smooth(0.885, 0.93 + 0.05 * (1 - rocky), cr));
  return h;
}

// ---------------------------------------------------------------------------
// rivers + lakes (precomputed once at module load; ~100 ms)
const RIVER_DEFS = [
  { name: 'Brightwater', width: 9, end: 11, pts: [[300, -1030], [360, -820], [520, -600], [760, -420], [900, -160], [950, 140], [1010, 420], [1090, 690], [1190, 930], [1330, 1170], [1500, 1390], [1720, 1580], [1900, 1720]] },
  { name: 'Willowrun', width: 6, end: 9, pts: [[-640, -1010], [-690, -780], [-760, -540], [-820, -300], [-880, -90], [-905, 40]], lake: 0 },
  { name: 'Lowmere', width: 9, end: 13, pts: [[-930, 300], [-1040, 500], [-1170, 720], [-1340, 950], [-1560, 1170], [-1800, 1380], [-2000, 1520]], fromLake: 0 },
  { name: 'Fallstream', width: 4, end: 6, pts: [[120, 90], [250, 40], [380, -10], [500, -50], [610, -80], [700, -110], [810, -150], [905, -160]], joins: 0 },
];
const LAKE_DEFS = [{ name: 'Mirrormere', x: -890, z: 150, r: 200 }];

export const RIVERS = [];
export const LAKES = [];
export const WATERFALLS = [];

function catmull(pts, step) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(2, Math.ceil(len / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1].slice());
  return out;
}

// lake surfaces from rim heights
for (const L of LAKE_DEFS) {
  let lo = 1e9;
  for (let a = 0; a < 64; a++) {
    const ang = a / 64 * Math.PI * 2;
    lo = Math.min(lo, baseHeight(L.x + Math.cos(ang) * L.r * 1.25, L.z + Math.sin(ang) * L.r * 1.25));
  }
  LAKES.push({ name: L.name, x: L.x, z: L.z, r: L.r, y: Math.max(2, lo - 2.5) });
}

for (const def of RIVER_DEFS) {
  const raw = catmull(def.pts, 24);
  // meander: perpendicular noise offset
  const pts = [];
  for (let i = 0; i < raw.length; i++) {
    const a = raw[Math.max(0, i - 1)], b = raw[Math.min(raw.length - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    const edge = Math.min(i, raw.length - 1 - i) / 6;
    const off = 28 * n3.noise2(raw[i][0] / 260, raw[i][1] / 260) * Math.min(1, edge);
    pts.push([raw[i][0] - tz * off, raw[i][1] + tx * off]);
  }
  const fine = catmull(pts, 8);
  // water surface: monotonic, below banks
  const out = [];
  let y = def.fromLake !== undefined ? LAKES[def.fromLake].y : 1e9;
  for (let i = 0; i < fine.length; i++) {
    const [x, z] = fine[i];
    const t = i / (fine.length - 1);
    const w = lerp(def.width * 0.55, def.end, t) * (1 + 0.25 * n1.noise2(x / 150, z / 150));
    const a = fine[Math.max(0, i - 1)], b = fine[Math.min(fine.length - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    const bank = Math.min(baseHeight(x, z), baseHeight(x - tz * (w + 6), z + tx * (w + 6)), baseHeight(x + tz * (w + 6), z - tx * (w + 6)));
    const target = bank - 1.6;
    if (target < y) y = target;
    else y -= 0.004 * 8; // gentle minimum gradient
    if (def.lake !== undefined) y = Math.max(y, LAKES[def.lake].y);
    out.push({ x, z, y: Math.max(y, 0), w });
  }
  RIVERS.push({ name: def.name, width: def.width, points: out, joins: def.joins, lake: def.lake, fromLake: def.fromLake });
}
// tributary joins: never end below the main river's surface there
for (const r of RIVERS) {
  if (r.joins === undefined) continue;
  const main = RIVERS[r.joins].points, last = r.points[r.points.length - 1];
  let best = 1e18, my = 0;
  for (const p of main) { const d = (p.x - last.x) ** 2 + (p.z - last.z) ** 2; if (d < best) { best = d; my = p.y; } }
  for (const p of r.points) p.y = Math.max(p.y, my);
}
// waterfalls = big drops over short distances
for (const r of RIVERS) {
  const p = r.points;
  for (let i = 0; i < p.length - 1; i++) {
    let j = i, drop = 0;
    while (j < p.length - 1 && j - i < 4 && p[i].y - p[j + 1].y > 0) { j++; drop = p[i].y - p[j].y; }
    if (drop > 8) {
      const dx = p[j].x - p[i].x, dz = p[j].z - p[i].z, l = Math.hypot(dx, dz) || 1;
      WATERFALLS.push({ river: r.name, x: p[i].x, z: p[i].z, top: p[i].y, bottom: p[j].y, dirX: dx / l, dirZ: dz / l, w: p[i].w });
      i = j;
    }
  }
}

// River distance grid (nearest river): distance, water y, half width, flow dir, river id.
const RG = 512, RCELL = WORLD_SIZE / RG, RMAX = 400;
const rDist = new Float32Array(RG * RG).fill(RMAX);
const rY = new Float32Array(RG * RG);
const rW = new Float32Array(RG * RG).fill(1);
const rDX = new Float32Array(RG * RG), rDZ = new Float32Array(RG * RG);
const rId = new Int8Array(RG * RG).fill(-1);
{
  const tmp = new Float32Array(RG * RG).fill(RMAX * RMAX);
  RIVERS.forEach((r, id) => {
    const p = r.points;
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      const x0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - RMAX + HALF) / RCELL));
      const x1 = Math.min(RG - 1, Math.ceil((Math.max(a.x, b.x) + RMAX + HALF) / RCELL));
      const z0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - RMAX + HALF) / RCELL));
      const z1 = Math.min(RG - 1, Math.ceil((Math.max(a.z, b.z) + RMAX + HALF) / RCELL));
      const dx = b.x - a.x, dz = b.z - a.z, ll = dx * dx + dz * dz || 1, l = Math.sqrt(ll);
      for (let gz = z0; gz <= z1; gz++) {
        const pz = gz * RCELL - HALF;
        for (let gx = x0; gx <= x1; gx++) {
          const px = gx * RCELL - HALF;
          const t = clamp(((px - a.x) * dx + (pz - a.z) * dz) / ll, 0, 1);
          const ex = px - a.x - dx * t, ez = pz - a.z - dz * t;
          const d2 = ex * ex + ez * ez;
          const k = gz * RG + gx;
          if (d2 < tmp[k]) {
            tmp[k] = d2; rY[k] = lerp(a.y, b.y, t); rW[k] = lerp(a.w, b.w, t);
            rDX[k] = dx / l; rDZ[k] = dz / l; rId[k] = id;
          }
        }
      }
    }
  });
  for (let k = 0; k < tmp.length; k++) rDist[k] = Math.sqrt(tmp[k]);
}

function gridSample(arr, x, z) {
  const gx = clamp((x + HALF) / RCELL, 0, RG - 1.001), gz = clamp((z + HALF) / RCELL, 0, RG - 1.001);
  const ix = gx | 0, iz = gz | 0, fx = gx - ix, fz = gz - iz, k = iz * RG + ix;
  return lerp(lerp(arr[k], arr[k + 1], fx), lerp(arr[k + RG], arr[k + RG + 1], fx), fz);
}

// Footpaths linking the landmarks (worn dirt tracks; vegetation should avoid them).
const PATH_DEFS = [
  [[40, -130], [110, 40], [250, 330], [-60, 450], [-332, 537], [-520, 610], [-760, 680], [-900, 700]],
  [[20, -205], [-70, -300], [-164, -380], [-300, -340], [-470, -160], [-590, 140]],
  [[300, 150], [470, 40], [586, -50], [760, 40], [900, 200], [1010, 250], [1200, 200], [1400, 125]],
  [[250, 330], [420, 260], [560, 140], [600, -40]],
];
export const PATHS = [];
const PG = 1024, PCELL = WORLD_SIZE / PG, PMAX = 16;
const pDist = new Float32Array(PG * PG).fill(PMAX);
for (const def of PATH_DEFS) {
  const raw = catmull(def, 20);
  const pts = raw.map(([x, z]) => [x + 9 * n2.noise2(x / 90, z / 90), z + 9 * n2.noise2(x / 90 + 40, z / 90)]);
  const fine = catmull(pts, 4).map(([x, z]) => ({ x, z, w: 1.6 + 0.6 * n3.noise2(x / 70, z / 70) }));
  PATHS.push({ points: fine });
  for (let i = 0; i < fine.length - 1; i++) {
    const a = fine[i], b = fine[i + 1];
    const x0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - PMAX + HALF) / PCELL)), x1 = Math.min(PG - 1, Math.ceil((Math.max(a.x, b.x) + PMAX + HALF) / PCELL));
    const z0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - PMAX + HALF) / PCELL)), z1 = Math.min(PG - 1, Math.ceil((Math.max(a.z, b.z) + PMAX + HALF) / PCELL));
    for (let gz = z0; gz <= z1; gz++) for (let gx = x0; gx <= x1; gx++) {
      const d = Math.sqrt(segDist2(gx * PCELL - HALF, gz * PCELL - HALF, a.x, a.z, b.x, b.z)) - (a.w - 1.6);
      const k = gz * PG + gx;
      if (d < pDist[k]) pDist[k] = Math.max(0, d);
    }
  }
}
// 0..1 worn-path mask (1 on the track centre)
export function getPathMask(x, z) {
  const gx = clamp((x + HALF) / PCELL, 0, PG - 1.001), gz = clamp((z + HALF) / PCELL, 0, PG - 1.001);
  const ix = gx | 0, iz = gz | 0, fx = gx - ix, fz = gz - iz, k = iz * PG + ix;
  const d = lerp(lerp(pDist[k], pDist[k + 1], fx), lerp(pDist[k + PG], pDist[k + PG + 1], fx), fz);
  if (d >= PMAX - 1) return 0;
  return 1 - smooth(0.6, 2.6, d);
}

// canyon factor along Brightwater through the mesas: steep walls
function canyonK(x, z) {
  const md = Math.hypot(x - MESA.x, z - MESA.z) / MESA.r;
  return 1 - smooth(0.5, 1.0, md);
}

export function getHeight(x, z) {
  let h = baseHeight(x, z);
  // rivers
  const d = gridSample(rDist, x, z);
  if (d < RMAX - 10) {
    const wy = gridSample(rY, x, z), w = gridSample(rW, x, z);
    const e = d - w;
    let carve;
    if (e < 0) {
      const q = d / w;
      carve = wy - 0.4 - (1.2 + w * 0.12) * (1 - q * q);
    } else {
      const ck = canyonK(x, z);
      const gentle = wy - 0.4 + e * 0.14 + (e * 0.035) ** 2 * 40 * 0.06;
      const wallT = Math.max(0, e - 6) * 2.4 / 9;
      const steep = wy - 0.4 + Math.min(e * 0.25, 2) + (Math.floor(wallT) + smooth(0.45, 1, wallT - Math.floor(wallT)) * 0.85 + (wallT - Math.floor(wallT)) * 0.15) * 9;
      carve = lerp(gentle, steep, ck);
    }
    const fade = smooth(RMAX - 60, RMAX - 10, d);
    h = lerp(smin(h, carve, 3), h, fade);
  }
  // lakes
  for (let i = 0; i < LAKES.length; i++) {
    const L = LAKES[i];
    const dx = x - L.x, dz = z - L.z;
    const dd = dx * dx + dz * dz;
    if (dd > (L.r * 2.4) ** 2) continue;
    const ang = Math.atan2(dz, dx);
    const rr = L.r * (1 + 0.18 * n1.noise2(Math.cos(ang) * 1.5 + 9, Math.sin(ang) * 1.5));
    const q = Math.sqrt(dd) / rr;
    const bowl = q < 1 ? L.y - 0.6 - 14 * Math.sqrt(1 - q * q) : L.y - 0.6 + (q - 1) * rr * 0.12;
    h = smin(h, bowl, 4);
  }
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

export function getRiverInfo(x, z, out = {}) {
  const d = gridSample(rDist, x, z);
  if (d >= RMAX - 10) return null;
  const gx = clamp(Math.round((x + HALF) / RCELL), 0, RG - 1), gz = clamp(Math.round((z + HALF) / RCELL), 0, RG - 1);
  const k = gz * RG + gx;
  out.dist = d; out.waterY = gridSample(rY, x, z); out.halfWidth = gridSample(rW, x, z);
  out.dirX = rDX[k]; out.dirZ = rDZ[k]; out.river = rId[k];
  return out;
}

export function getRiverMask(x, z) {
  const d = gridSample(rDist, x, z);
  if (d > 60) return 0;
  const w = gridSample(rW, x, z);
  return 1 - smooth(w - 1, w + 2, d);
}

export function isLake(x, z) {
  for (let i = 0; i < LAKES.length; i++) {
    const L = LAKES[i];
    if ((x - L.x) ** 2 + (z - L.z) ** 2 < (L.r * 1.4) ** 2 && getHeight(x, z) < L.y) return i;
  }
  return -1;
}

export function getWaterSurface(x, z) {
  const h = getHeight(x, z);
  let s = h < 0 ? 0 : -Infinity;
  const li = isLake(x, z); if (li >= 0) s = Math.max(s, LAKES[li].y);
  const d = gridSample(rDist, x, z);
  if (d < 60) { const wy = gridSample(rY, x, z); if (h < wy) s = Math.max(s, wy); }
  return s;
}

// ---------------------------------------------------------------------------
// surface classification (mirrors the terrain shader weights)
const _n = { x: 0, y: 1, z: 0 };
export function snowLine(x, z) { return 305 + 40 * n2.noise2(x / 300, z / 300); }
export function mesaFactor(x, z) {
  const md = Math.hypot(x - MESA.x, z - MESA.z) / MESA.r;
  return 1 - smooth(0.55, 1.05, md);
}
export function forestFactor(x, z) {
  const hd = Math.hypot(x - HILLS.x, z - HILLS.z) / HILLS.r;
  const f = n1.fbm2(x / 500 + 99, z / 500 - 31, 3);
  return clamp(Math.max(1 - smooth(0.3, 1.2, hd), smooth(0.1, 0.4, f)) * (1 - mesaFactor(x, z)), 0, 1);
}

export function getSurface(x, z, out = {}) {
  const h = getHeight(x, z);
  const nrm = getNormal(x, z, _n);
  const slope = 1 - nrm.y;
  const nz = n3.noise2(x / 60, z / 60) * 0.06;
  let rock = smooth(0.24, 0.36, slope + nz);
  let snow = smooth(-10, 15, h - snowLine(x, z)) * (1 - smooth(0.35, 0.55, slope));
  rock *= 1 - snow;
  const river = getRiverMask(x, z);
  let sand = Math.max(1 - smooth(1.5, 4.5, h + nz * 30), river * 0.8) * (1 - rock) * (1 - snow);
  const mesa = mesaFactor(x, z);
  const alpine = smooth(170, 260, h);
  let dirt = (1 - rock) * (1 - snow) * (1 - sand) * Math.max(mesa * 0.6, alpine * 0.35, smooth(0.16, 0.24, slope + nz) * 0.7, getPathMask(x, z) * 0.95);
  const grass = Math.max(0, 1 - rock - snow - sand - dirt);
  out.grass = grass; out.dirt = dirt; out.rock = rock; out.sand = sand; out.snow = snow;
  return out;
}

// Returns a biome tag used by vegetation, audio, weather.
// Tags: 'shore' | 'snow' | 'alpine' | 'forest' | 'meadow' | 'meadow_dry' | 'mesa'
export function getBiome(x, z) {
  const h = getHeight(x, z);
  if (h < WATER_LEVEL + 1.5) return 'shore';
  if (h > snowLine(x, z)) return 'snow';
  if (h > 170) return 'alpine';
  if (mesaFactor(x, z) > 0.5) return 'mesa';
  if (forestFactor(x, z) > 0.5) return 'forest';
  const f = n1.fbm2(x / 500 + 99, z / 500 - 31, 3);
  if (f < -0.35) return 'meadow_dry';
  return 'meadow';
}

export const LANDMARKS = [
  { name: 'Summit', kind: 'peak', x: SUMMIT.x, z: SUMMIT.z },
  { name: 'Great Plateau', kind: 'plateau', x: PLATEAU.x, z: PLATEAU.z },
  { name: 'Mirrormere', kind: 'lake', x: LAKE_DEFS[0].x, z: LAKE_DEFS[0].z },
  { name: 'Red Mesas', kind: 'mesa', x: MESA.x, z: MESA.z },
];
export const FEATURES = { SPINE, SUMMIT, SUMMIT2, PLATEAU, MESA, HILLS };

export const world = {
  WORLD_SIZE, WATER_LEVEL, getHeight, getNormal, getBiome, getSurface,
  getRiverInfo, getRiverMask, getWaterSurface, isLake,
  RIVERS, LAKES, WATERFALLS, LANDMARKS, TERRAIN_PALETTE, FEATURES,
  forestFactor, mesaFactor, snowLine, baseHeight, getPathMask, PATHS,
};
