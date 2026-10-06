// River + lake surface geometry built from the terrain's river/lake data.
// Rivers: ribbons that follow each channel's centreline, wide enough to meet the banks;
// per-vertex true depth, flow velocity, channel-space uv, turbulence and steepness.
// Lakes: a 2.5 m grid clipped to the wet basin, per-vertex depth.
import * as THREE from 'three';
import { riverSpeedAt } from '../../world/water.js';

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// resample a polyline of {x,z,y,w} at a fixed spacing (linear)
function resample(pts, step) {
  const cum = [0];
  for (let i = 0; i < pts.length - 1; i++) cum.push(cum[i] + Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z));
  const total = cum[cum.length - 1];
  const out = [];
  let seg = 0;
  const at = (s) => {
    while (seg < pts.length - 2 && cum[seg + 1] < s) seg++;
    const a = pts[seg], b = pts[seg + 1];
    const t = clamp((s - cum[seg]) / ((cum[seg + 1] - cum[seg]) || 1), 0, 1);
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t, s };
  };
  for (let s = 0; s < total; s += step) out.push(at(s));
  out.push(at(total));
  return out;
}

export function buildRiverGeometry(world, riverIndex) {
  const R = world.RIVERS[riverIndex];
  const rows = resample(R.points, 3);
  const NC = 15;                            // vertices across
  const n = rows.length;
  const pos = new Float32Array(n * NC * 3);
  const water = new Float32Array(n * NC * 4);
  const flow = new Float32Array(n * NC * 4);
  const info = {};
  const lake = R.lake !== undefined ? world.LAKES[R.lake] : null;
  const fromLake = R.fromLake !== undefined ? world.LAKES[R.fromLake] : null;
  const total = rows[n - 1].s;

  // per-row tangent, surface y (from the same grid the terrain carves with), speed
  const tx = new Float32Array(n), tz = new Float32Array(n), ys = new Float32Array(n), sp = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = rows[Math.max(0, i - 1)], b = rows[Math.min(n - 1, i + 1)];
    let dx = b.x - a.x, dz = b.z - a.z; const l = Math.hypot(dx, dz) || 1;
    tx[i] = dx / l; tz[i] = dz / l;
    const r = rows[i];
    const g = world.getRiverInfo(r.x, r.z, info);
    ys[i] = g && g.river === riverIndex && g.dist < 4 ? g.waterY : r.y;
  }
  // smooth tangents a little (prevents fans on tight bends)
  for (let pass = 0; pass < 2; pass++) for (let i = 1; i < n - 1; i++) {
    const x = tx[i - 1] + tx[i] * 2 + tx[i + 1], z = tz[i - 1] + tz[i] * 2 + tz[i + 1], l = Math.hypot(x, z) || 1;
    tx[i] = x / l; tz[i] = z / l;
  }
  const slopeArr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 2), b = Math.min(n - 1, i + 2);
    slopeArr[i] = Math.max(0, (ys[a] - ys[b]) / Math.max(1, rows[b].s - rows[a].s));
    sp[i] = clamp(1.1 + slopeArr[i] * 26, 1, 9);
  }
  // turbulence: rapids + white water persisting downstream of falls
  const turbArr = new Float32Array(n);
  let carry = 0;
  for (let i = 0; i < n; i++) {
    const st = smooth(0.3, 0.9, slopeArr[i]);
    const rap = smooth(0.03, 0.14, slopeArr[i]) * 0.7;
    carry = Math.max(carry * Math.exp(-3 / 22), st);
    turbArr[i] = Math.max(rap, carry * 0.95);
  }

  for (let i = 0; i < n; i++) {
    const r = rows[i];
    const W = r.w + 7;
    const bx = -tz[i], bz = tx[i];
    const steep = smooth(0.35, 1.1, slopeArr[i]);
    // fades where another water body takes over
    let fd = 1;
    if (!lake && !fromLake && R.joins === undefined) fd = Math.min(fd, smooth(0.05, 0.9, ys[i]));   // into the sea
    if (R.joins !== undefined) fd = Math.min(fd, smooth(4, 30, total - r.s));
    if (lake) {
      const dl = Math.hypot(r.x - lake.x, r.z - lake.z);
      fd = Math.min(fd, smooth(lake.r * 0.95, lake.r * 1.3, dl));
    }
    if (fromLake) {
      const dl = Math.hypot(r.x - fromLake.x, r.z - fromLake.z);
      fd = Math.min(fd, smooth(fromLake.r * 0.95, fromLake.r * 1.3, dl));
    }
    fd = Math.min(fd, smooth(0, 12, r.s));   // spring
    for (let j = 0; j < NC; j++) {
      const u = j / (NC - 1) * 2 - 1;
      // denser vertices toward the banks where the waterline is
      const a = Math.sign(u) * Math.pow(Math.abs(u), 0.8) * W;
      const x = r.x + bx * a, z = r.z + bz * a;
      let y = ys[i];
      const g = world.getRiverInfo(x, z, info);
      if (g && g.river === riverIndex) y = g.waterY;
      const h = world.getHeight(x, z);
      const k = i * NC + j;
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
      water[k * 4] = y - h;
      water[k * 4 + 1] = fd;
      water[k * 4 + 2] = turbArr[i];
      water[k * 4 + 3] = steep;
      const across = Math.abs(a) / W;
      const s = sp[i] * (1 - 0.55 * across * across);
      flow[k * 4] = tx[i] * s; flow[k * 4 + 1] = tz[i] * s;
      flow[k * 4 + 2] = a; flow[k * 4 + 3] = r.s;
    }
  }
  // indices: skip quads that are fully dry (all four corners above the water)
  const idx = [];
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < NC - 1; j++) {
    const a = i * NC + j, b = a + 1, c = a + NC, d = c + 1;
    if (water[a * 4] < -0.6 && water[b * 4] < -0.6 && water[c * 4] < -0.6 && water[d * 4] < -0.6) continue;
    if (water[a * 4 + 1] + water[b * 4 + 1] + water[c * 4 + 1] + water[d * 4 + 1] <= 0) continue;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aWater', new THREE.BufferAttribute(water, 4));
  geo.setAttribute('aFlow', new THREE.BufferAttribute(flow, 4));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // make sure faces point up
  const nrm = geo.attributes.normal;
  let up = 0; for (let k = 0; k < nrm.count; k++) up += nrm.getY(k);
  if (up < 0) {
    for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
    geo.setIndex(idx);
    geo.computeVertexNormals();
  }
  geo.computeBoundingSphere();
  return geo;
}

export function buildLakeGeometry(world, L) {
  const cell = 2.5;
  const ext = L.r * 1.5;
  const N = Math.ceil(ext * 2 / cell) + 1;
  const x0 = L.x - ext, z0 = L.z - ext;
  const H = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) H[j * N + i] = world.getHeight(x0 + i * cell, z0 + j * cell);
  const map = new Int32Array(N * N).fill(-1);
  const pos = [], water = [], idx = [];
  const vid = (i, j) => {
    const k = j * N + i;
    if (map[k] < 0) {
      map[k] = pos.length / 3;
      pos.push(x0 + i * cell, L.y, z0 + j * cell);
      water.push(L.y - H[k], 1, 0, 0);
    }
    return map[k];
  };
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
    const k = j * N + i;
    const lo = Math.min(H[k], H[k + 1], H[k + N], H[k + N + 1]);
    if (lo > L.y + 0.3) continue;
    const a = vid(i, j), b = vid(i + 1, j), c = vid(i, j + 1), d = vid(i + 1, j + 1);
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aWater', new THREE.Float32BufferAttribute(water, 4));
  const nrm = new Float32Array(pos.length); for (let k = 1; k < nrm.length; k += 3) nrm[k] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

// Ocean: polar grid (fine near the centre, coarse to the horizon) recentred on the camera.
export function buildOceanGeometry(rings = 132, segs = 200, first = 1.2, growth = 1.043) {
  const pos = [0, 0, 0];
  const radii = [];
  let r = first, step = first;
  for (let i = 0; i < rings; i++) { radii.push(r); step *= growth; r += step; }
  for (let i = 0; i < rings; i++) {
    for (let s = 0; s < segs; s++) {
      const a = s / segs * Math.PI * 2 + (i % 2) * Math.PI / segs;
      pos.push(Math.cos(a) * radii[i], 0, Math.sin(a) * radii[i]);
    }
  }
  const idx = [];
  for (let s = 0; s < segs; s++) idx.push(0, 1 + (s + 1) % segs, 1 + s);
  for (let i = 0; i < rings - 1; i++) {
    const r0 = 1 + i * segs, r1 = 1 + (i + 1) * segs;
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      if (i % 2 === 0) { idx.push(r0 + s, r0 + s1, r1 + s); idx.push(r0 + s1, r1 + s1, r1 + s); }
      else { idx.push(r0 + s, r1 + s1, r1 + s); idx.push(r0 + s, r0 + s1, r1 + s1); }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const nrm = new Float32Array(pos.length); for (let k = 1; k < nrm.length; k += 3) nrm[k] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setIndex(idx);
  // winding check: faces must face +y
  const p = geo.attributes.position;
  const ax = p.getX(idx[0]), az = p.getZ(idx[0]), bx = p.getX(idx[1]), bz = p.getZ(idx[1]), cx = p.getX(idx[2]), cz = p.getZ(idx[2]);
  const ny = (cx - ax) * (bz - az) - (cz - az) * (bx - ax);
  if (ny < 0) { for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; } geo.setIndex(idx); }
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), r);
  return { geo, radius: r };
}

export { riverSpeedAt };
