// Procedural, original tree / bush prototypes.
// Every prototype returns { bark, leaves, height, radius, trunkR, species }:
//   bark   : BufferGeometry (position, normal, color, uv, aWind)
//   leaves : BufferGeometry (position, normal [spherized], color, uv, aWind) or null
// aWind = (sway weight 0..1 by height, flutter weight, phase, kind)
//   kind (bark): 0 plain bark, 1 pale ringed bark, 2 weathered silver, 3 ringed palm
// Leaf uv addresses the leaf atlas (2x2 cells); SOLID_UV marks opaque canopy shells.
import * as THREE from 'three';
import { mulberry32 } from '../../core/noise.js';

export const SOLID_UV = [0.985, 0.985];

class Builder {
  constructor() { this.pos = []; this.nrm = []; this.col = []; this.uv = []; this.wind = []; this.idx = []; }
  v(p, n, c, uv, w) {
    this.pos.push(p.x, p.y, p.z); this.nrm.push(n.x, n.y, n.z); this.col.push(c.r, c.g, c.b);
    this.uv.push(uv[0], uv[1]); this.wind.push(w[0], w[1], w[2], w[3]);
    return this.pos.length / 3 - 1;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
  geometry(H) {
    // sway weight by normalised height (overrides x)
    for (let i = 0; i < this.pos.length / 3; i++) {
      const y = Math.max(0, this.pos[i * 3 + 1]) / H;
      this.wind[i * 4] = Math.pow(Math.min(1, y), 1.6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aWind', new THREE.Float32BufferAttribute(this.wind, 4));
    g.setIndex(this.idx);
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

const V3 = THREE.Vector3;
const _c = new THREE.Color();

// Tapered tube along a polyline of {p:Vector3, r}. Smooth parallel-transport frames.
function tube(B, pts, sides, color, kind, rand, uvScale = 1) {
  const n = pts.length;
  let prevNormal = new V3(1, 0, 0);
  let vAcc = 0;
  const rings = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i].p;
    const t = new V3().subVectors(pts[Math.min(n - 1, i + 1)].p, pts[Math.max(0, i - 1)].p).normalize();
    let nn = prevNormal.clone().sub(t.clone().multiplyScalar(prevNormal.dot(t)));
    if (nn.lengthSq() < 1e-6) nn = new V3(0, 0, 1).cross(t);
    nn.normalize(); prevNormal = nn;
    const bn = new V3().crossVectors(t, nn);
    if (i > 0) vAcc += pts[i].p.distanceTo(pts[i - 1].p);
    const ring = [];
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const dir = nn.clone().multiplyScalar(Math.cos(a)).add(bn.clone().multiplyScalar(Math.sin(a)));
      const r = pts[i].r * (1 + (rand() - 0.5) * 0.08);
      const pos = p.clone().add(dir.clone().multiplyScalar(r));
      // bark AO: darker near the ground and in crotches
      const ao = 0.7 + 0.3 * Math.min(1, p.y / 2.5);
      _c.copy(color).multiplyScalar(ao);
      ring.push(B.v(pos, dir, _c, [s / sides * uvScale, vAcc / (Math.PI * 2 * Math.max(pts[0].r, 0.05)) * uvScale * 0.5], [0, 0.0, rand(), kind]));
    }
    rings.push(ring);
  }
  for (let i = 0; i < n - 1; i++) for (let s = 0; s < sides; s++) {
    const a = rings[i][s], b = rings[i][s + 1], c = rings[i + 1][s], d = rings[i + 1][s + 1];
    B.tri(a, c, b); B.tri(b, c, d);
  }
}

// curved branch path from a to b with a sag/rise, radius r0->r1
function branchPath(a, b, r0, r1, segs, bendUp, rand) {
  const pts = [];
  const side = new V3(rand() - 0.5, 0, rand() - 0.5).multiplyScalar(0.3 * a.distanceTo(b));
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const p = a.clone().lerp(b, t);
    p.y += Math.sin(t * Math.PI) * bendUp;
    p.add(side.clone().multiplyScalar(Math.sin(t * Math.PI)));
    pts.push({ p, r: r0 + (r1 - r0) * Math.pow(t, 0.8) });
  }
  return pts;
}

// Leaf-card clump around a blob centre. normals spherized between blob + crown centre.
function leafBlob(B, center, radius, crown, cards, cellUV, color, rand, opts = {}) {
  const { cardSize = radius * 1.05, shell = true, stretchY = 1, aoBottom = 0.5 } = opts;
  const crownC = crown.c, crownR = crown.r;
  const cell = cellUV; // [u0, v0, size]
  const addV = (p, uv, flutter) => {
    const nb = p.clone().sub(center).normalize();
    const nc = p.clone().sub(crownC); nc.y /= crown.sy || 1; nc.normalize();
    const n = nb.multiplyScalar(0.45).add(nc.multiplyScalar(0.55)).add(new V3(0, 0.12, 0)).normalize();
    const outer = Math.min(1, p.clone().sub(crownC).length() / crownR);
    const up = Math.min(1, Math.max(0, (p.y - (crownC.y - crownR * (crown.sy || 1))) / (2 * crownR * (crown.sy || 1))));
    const ao = (aoBottom + (1 - aoBottom) * up) * (0.6 + 0.4 * outer);
    _c.copy(color).multiplyScalar(ao);
    return B.v(p, n, _c, uv, [0, flutter, rand(), 0]);
  };
  if (shell) {
    const ico = new THREE.IcosahedronGeometry(radius * 0.78, 1);
    const ip = ico.attributes.position;
    const map = [];
    for (let i = 0; i < ip.count; i++) {
      const p = new V3().fromBufferAttribute(ip, i);
      p.y *= stretchY;
      p.multiplyScalar(1 + (rand() - 0.5) * 0.18).add(center);
      map.push(addV(p, SOLID_UV, 0.15));
    }
    const ii = ico.index ? ico.index.array : null;
    if (ii) for (let i = 0; i < ii.length; i += 3) B.tri(map[ii[i]], map[ii[i + 1]], map[ii[i + 2]]);
    else for (let i = 0; i < ip.count; i += 3) B.tri(map[i], map[i + 1], map[i + 2]);
    ico.dispose();
  }
  for (let k = 0; k < cards; k++) {
    // directions biased upward/outward
    let d = new V3(rand() * 2 - 1, rand() * 1.6 - 0.45, rand() * 2 - 1);
    if (d.lengthSq() < 0.01) d.set(0, 1, 0);
    d.normalize();
    const c = center.clone().add(d.clone().multiplyScalar(radius * (0.55 + rand() * 0.4)));
    c.y = center.y + (c.y - center.y) * stretchY;
    const n0 = d.clone().add(new V3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(0.9)).normalize();
    let t = new V3(0, 1, 0).cross(n0);
    if (t.lengthSq() < 1e-3) t.set(1, 0, 0);
    t.normalize().applyAxisAngle(n0, rand() * Math.PI * 2);
    const b = new V3().crossVectors(n0, t);
    const s = cardSize * (0.75 + rand() * 0.5) * 0.5;
    const u0 = cell[0], v0 = cell[1], us = cell[2];
    const p00 = c.clone().addScaledVector(t, -s).addScaledVector(b, -s);
    const p10 = c.clone().addScaledVector(t, s).addScaledVector(b, -s);
    const p11 = c.clone().addScaledVector(t, s).addScaledVector(b, s);
    const p01 = c.clone().addScaledVector(t, -s).addScaledVector(b, s);
    const a0 = addV(p00, [u0, v0], 1), a1 = addV(p10, [u0 + us, v0], 1), a2 = addV(p11, [u0 + us, v0 + us], 1), a3 = addV(p01, [u0, v0 + us], 1);
    B.tri(a0, a1, a2); B.tri(a0, a2, a3);
  }
}

// atlas cells: [u0, v0, size] (leaf texture is 2x2; bottom-right solid patch lives in cell 3's corner)
const CELL = { broad: [0.0, 0.0, 0.5], broad2: [0.5, 0.0, 0.5], small: [0.0, 0.5, 0.5], needle: [0.5, 0.5, 0.47] };

// ------------------------------------------------------------------ species
export function broadleaf(seed, { height = 10, color = 0x5c9631, bark = 0x7a6852, umbrella = false } = {}) {
  const rand = mulberry32(seed);
  const B = new Builder(), L = new Builder();
  const H = height * (0.9 + rand() * 0.2);
  const trunkH = H * (umbrella ? 0.55 + rand() * 0.06 : 0.33 + rand() * 0.06);
  const r0 = H * (umbrella ? 0.04 : 0.055);
  const barkC = new THREE.Color(bark), leafC = new THREE.Color(color);
  // trunk: slight lean, gentle S-curve + root flare
  const lean = new V3((rand() - 0.5) * 0.16, 1, (rand() - 0.5) * 0.16).normalize();
  const trunk = [];
  for (let i = 0; i <= 7; i++) {
    const t = i / 7;
    const p = lean.clone().multiplyScalar(trunkH * t);
    p.x += Math.sin(t * 3 + seed) * 0.15; p.z += Math.cos(t * 2.3 + seed) * 0.15;
    trunk.push({ p, r: r0 * (1 - 0.3 * t) * (1 + 0.7 * Math.max(0, 0.14 - t) / 0.14) });
  }
  trunk[0].p.y = -0.4;
  tube(B, trunk, 9, barkC, 0, rand);
  const top = trunk[trunk.length - 1].p;
  // crown: overlapping blobs on an ellipsoid (flattened for the umbrella form)
  const crownR = H * (umbrella ? 0.5 + rand() * 0.06 : 0.37 + rand() * 0.05);
  const sy = umbrella ? 0.42 : 0.74;
  const crown = { c: new V3(top.x, trunkH + crownR * sy * (umbrella ? 0.55 : 0.75), top.z), r: crownR, sy };
  const blobs = [{ c: crown.c.clone().add(new V3(0, crownR * sy * 0.3, 0)), r: crownR * (umbrella ? 0.5 : 0.62) }];
  const nBlobs = (umbrella ? 12 : 10) + Math.floor(rand() * 4);
  for (let i = 1; i < nBlobs; i++) {
    const a = (i / nBlobs) * Math.PI * 2 * 1.618 * 3 + rand() * 0.8;
    const el = umbrella ? -0.25 + rand() * 0.7 : -0.6 + rand() * 1.3;
    const d = new V3(Math.cos(a) * Math.cos(el), Math.sin(el) * sy, Math.sin(a) * Math.cos(el));
    blobs.push({ c: crown.c.clone().add(d.multiplyScalar(crownR * (0.58 + rand() * 0.22))), r: crownR * (umbrella ? 0.32 + rand() * 0.12 : 0.38 + rand() * 0.16) });
  }
  // limbs from the trunk top out to the blobs (visible under the canopy)
  let limbs = 0;
  for (let i = 1; i < blobs.length && limbs < 4; i++) {
    // a few limbs toward blobs above the trunk top; they stay mostly inside the foliage
    if (blobs[i].c.y < top.y + crownR * 0.15) continue;
    limbs++;
    const start = top.clone().lerp(trunk[5].p, rand() * 0.6);
    const end = blobs[i].c.clone().lerp(start, 0.45);
    tube(B, branchPath(start, end, r0 * 0.45, r0 * 0.14, 4, 0.25, rand), 5, barkC, 0, rand);
  }
  tube(B, branchPath(top, blobs[0].c, r0 * 0.6, r0 * 0.2, 3, 0, rand), 5, barkC, 0, rand);
  for (const b of blobs) leafBlob(L, b.c, b.r, crown, 18 + Math.floor(b.r / crownR * 22), rand() < 0.5 ? CELL.broad : CELL.broad2, leafC, rand, { stretchY: umbrella ? 0.7 : 0.88 });
  return { bark: B.geometry(H), leaves: L.geometry(H), height: H, radius: crownR * 1.4, trunkR: r0 * 1.1, species: 'broadleaf' };
}

export function birch(seed, { height = 11, color = 0x8fbf45, bark = 0xe9e5dc } = {}) {
  const rand = mulberry32(seed);
  const B = new Builder(), L = new Builder();
  const H = height * (0.9 + rand() * 0.2);
  const r0 = H * 0.022;
  const barkC = new THREE.Color(bark), leafC = new THREE.Color(color);
  const trunk = [];
  const bend = new V3(rand() - 0.5, 0, rand() - 0.5).multiplyScalar(0.8);
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const p = new V3(bend.x * t * t, H * 0.92 * t, bend.z * t * t);
    trunk.push({ p, r: r0 * (1 - 0.7 * t) });
  }
  tube(B, trunk, 7, barkC, 1, rand, 1);
  const crown = { c: new V3(bend.x * 0.6, H * 0.68, bend.z * 0.6), r: H * 0.24, sy: 1.25 };
  // airy crown: distinct clumps spiralling up the trunk on short twigs
  const nBlobs = 6 + Math.floor(rand() * 2);
  let a = rand() * Math.PI * 2;
  for (let i = 0; i < nBlobs; i++) {
    const t = 0.42 + (i / (nBlobs - 1)) * 0.5;
    const y = H * t;
    a += 2.4 + rand() * 0.5;
    const taper = 1 - (t - 0.42) / 0.6;
    const rr = H * (0.06 + 0.11 * taper) * (0.8 + rand() * 0.4);
    const tc = trunk[Math.min(8, Math.round(t * 8))].p;
    const c = new V3(tc.x + Math.cos(a) * rr, y + rr * 0.25, tc.z + Math.sin(a) * rr);
    tube(B, branchPath(tc.clone().setY(y - 0.5), c, r0 * 0.35, r0 * 0.1, 3, 0.3, rand), 4, barkC, 1, rand);
    leafBlob(L, c, H * (0.11 + 0.07 * taper) * (0.85 + rand() * 0.3), crown, 24, CELL.small, leafC, rand, { stretchY: 0.95, shell: true, aoBottom: 0.55 });
  }
  leafBlob(L, trunk[8].p.clone().add(new V3(0, 0.3, 0)), H * 0.08, crown, 10, CELL.small, leafC, rand, { stretchY: 1.2, aoBottom: 0.7 });
  return { bark: B.geometry(H), leaves: L.geometry(H), height: H, radius: H * 0.28, trunkR: r0 * 1.2, species: 'birch' };
}

export function conifer(seed, { height = 14, color = 0x3f6d3c, bark = 0x5b4636 } = {}) {
  const rand = mulberry32(seed);
  const B = new Builder(), L = new Builder();
  const H = height * (0.85 + rand() * 0.3);
  const r0 = H * 0.03;
  const barkC = new THREE.Color(bark), leafC = new THREE.Color(color);
  tube(B, [{ p: new V3(0, -0.3, 0), r: r0 * 1.3 }, { p: new V3(0, H * 0.3, 0), r: r0 }, { p: new V3(0, H * 0.97, 0), r: r0 * 0.15 }], 7, barkC, 0, rand);
  const tiers = 7 + Math.floor(rand() * 3);
  const baseY = Math.max(2.4, H * (0.2 + rand() * 0.06));
  const maxR = H * (0.25 + rand() * 0.05);
  const k = 11;
  const crown = { c: new V3(0, H * 0.5, 0), r: H * 0.5, sy: 1 };
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const y = baseY + (H - baseY) * Math.pow(t, 0.92) * 0.93;
    const R = maxR * (1 - t * 0.88) * (0.9 + rand() * 0.2);
    const th = (H - baseY) / tiers * 1.65;
    const apex = new V3(0, y + th * 0.95, 0);
    const rot = rand() * Math.PI * 2;
    const ringIn = [], ringOut = [];
    const shade = 0.62 + 0.38 * t;
    // inner ring around the trunk
    for (let s = 0; s <= k * 2; s++) {
      const a = rot + (s / (k * 2)) * Math.PI * 2;
      const jag = s % 2 === 0 ? 1.0 : 0.62 + rand() * 0.12;
      const rr = R * 0.74 * jag * (0.92 + rand() * 0.16);
      const droop = th * (s % 2 === 0 ? 0.25 : 0.05) + rr * 0.12;
      const po = new V3(Math.cos(a) * rr, y - droop, Math.sin(a) * rr);
      const pi = new V3(Math.cos(a) * R * 0.18, y + th * 0.55, Math.sin(a) * R * 0.18);
      const no = new V3(Math.cos(a), 0.55, Math.sin(a)).normalize();
      const ni = new V3(Math.cos(a) * 0.6, 0.85, Math.sin(a) * 0.6).normalize();
      _c.copy(leafC).multiplyScalar(shade * (s % 2 === 0 ? 1.08 : 0.92));
      ringOut.push(L.v(po, no, _c, SOLID_UV, [0, 0.6, rand(), 0]));
      _c.copy(leafC).multiplyScalar(shade * 0.6);
      ringIn.push(L.v(pi, ni, _c, SOLID_UV, [0, 0.2, rand(), 0]));
    }
    _c.copy(leafC).multiplyScalar(shade * 0.75);
    const ap = L.v(apex, new V3(0, 1, 0), _c, SOLID_UV, [0, 0.1, rand(), 0]);
    for (let s = 0; s < k * 2; s++) {
      L.tri(ringIn[s], ringOut[s + 1], ringOut[s]);
      L.tri(ringIn[s], ringIn[s + 1], ringOut[s + 1]);
      L.tri(ap, ringIn[s + 1], ringIn[s]);
    }
    // drooping branch cards (needle frond texture) radiate past the solid skirt
    const nb = Math.round(10 + R * 2.6);
    for (let q = 0; q < nb; q++) {
      const a = rot + (q / nb) * Math.PI * 2 + (rand() - 0.5) * 0.4;
      const ca = Math.cos(a), sa = Math.sin(a);
      const len = R * (0.95 + rand() * 0.25);
      const wid = Math.max(0.3, R * (0.26 + rand() * 0.1));
      const side = new V3(-sa, 0, ca);
      const segs = 3;
      let prev = null;
      for (let sgi = 0; sgi <= segs; sgi++) {
        const t2 = sgi / segs;
        const rr = R * 0.1 + len * t2;
        const yy = y + th * 0.32 - (th * 0.42 + len * 0.12) * t2 * t2;
        const c = new V3(ca * rr, yy, sa * rr);
        const w = wid * (0.45 + 0.55 * Math.sin(Math.PI * Math.min(1, t2 * 0.9 + 0.1)));
        const n = new V3(ca * 0.7, 0.75, sa * 0.7).normalize();
        _c.copy(leafC).multiplyScalar(shade * (0.75 + 0.35 * t2));
        const u = CELL.needle[0] + CELL.needle[2] * t2;
        const lA = L.v(c.clone().addScaledVector(side, -w * 0.5), n, _c, [u, CELL.needle[1]], [0, 0.35 + 0.5 * t2, rand(), 0]);
        const lB = L.v(c.clone().addScaledVector(side, w * 0.5), n, _c, [u, CELL.needle[1] + CELL.needle[2]], [0, 0.35 + 0.5 * t2, rand(), 0]);
        if (prev) { L.tri(prev[0], prev[1], lB); L.tri(prev[0], lB, lA); }
        prev = [lA, lB];
      }
    }
  }
  return { bark: B.geometry(H), leaves: L.geometry(H), height: H, radius: maxR, trunkR: r0 * 1.2, species: 'conifer' };
}

export function deadTree(seed, { height = 8, bark = 0xa49a8c } = {}) {
  const rand = mulberry32(seed);
  const B = new Builder();
  const H = height * (0.8 + rand() * 0.4);
  const barkC = new THREE.Color(bark);
  const r0 = H * 0.05;
  function grow(start, dir, len, r, depth) {
    const pts = [];
    const segs = 4;
    let p = start.clone(), d = dir.clone();
    pts.push({ p: p.clone(), r });
    for (let i = 1; i <= segs; i++) {
      d.add(new V3(rand() - 0.5, (rand() - 0.5) * 0.4, rand() - 0.5).multiplyScalar(0.35)).normalize();
      p = p.clone().addScaledVector(d, len / segs);
      pts.push({ p: p.clone(), r: r * (1 - 0.75 * i / segs) });
    }
    tube(B, pts, depth === 0 ? 7 : 4, barkC, 2, rand);
    if (depth >= 3) return;
    const kids = depth === 0 ? 3 + Math.floor(rand() * 2) : 2;
    for (let c = 0; c < kids; c++) {
      const at = pts[Math.min(pts.length - 1, 2 + Math.floor(rand() * 3))];
      const nd = d.clone().add(new V3(rand() - 0.5, 0.2 + rand() * 0.5, rand() - 0.5).multiplyScalar(1.6)).normalize();
      grow(at.p, nd, len * (0.45 + rand() * 0.2), at.r * 0.7, depth + 1);
    }
  }
  grow(new V3(0, -0.3, 0), new V3((rand() - 0.5) * 0.3, 1, (rand() - 0.5) * 0.3).normalize(), H * 0.62, r0, 0);
  return { bark: B.geometry(H), leaves: null, height: H, radius: H * 0.35, trunkR: r0, species: 'dead' };
}

export function palm(seed, { height = 9, color = 0x67a238, bark = 0x8c765a } = {}) {
  const rand = mulberry32(seed);
  const B = new Builder(), L = new Builder();
  const H = height * (0.85 + rand() * 0.3);
  const r0 = H * 0.035;
  const barkC = new THREE.Color(bark), leafC = new THREE.Color(color);
  const lean = new V3(rand() - 0.5, 0, rand() - 0.5).normalize().multiplyScalar(H * (0.15 + rand() * 0.15));
  const trunk = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    trunk.push({ p: new V3(lean.x * t * t, H * t, lean.z * t * t), r: r0 * (1.25 - 0.45 * t) * (i === 0 ? 1.3 : 1) });
  }
  tube(B, trunk, 8, barkC, 3, rand, 1);
  const top = trunk[10].p;
  const fronds = 9 + Math.floor(rand() * 3);
  const crown = { c: top.clone(), r: H * 0.4, sy: 0.5 };
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2 + rand() * 0.3;
    const len = H * (0.42 + rand() * 0.12);
    const rise = 0.35 + rand() * 0.5;
    const dir = new V3(Math.cos(a), 0, Math.sin(a));
    const side = new V3(-dir.z, 0, dir.x);
    const N = 10;
    let pc = -1, pl = -1, pr = -1;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const p = top.clone().addScaledVector(dir, len * t);
      p.y += len * (rise * t - (rise + 0.55) * t * t);
      const w = len * 0.2 * Math.sin(Math.PI * Math.min(1, t * 1.05 + 0.04)) * (i % 2 ? 1 : 0.8);
      const droop = w * 0.55;
      const ao = 0.7 + 0.3 * t;
      _c.copy(leafC).multiplyScalar(ao);
      const up = new V3(0, 1, 0);
      const c = L.v(p, up, _c, SOLID_UV, [0, 0.8 * t, rand(), 0]);
      const lp = p.clone().addScaledVector(side, w); lp.y -= droop;
      const rp = p.clone().addScaledVector(side, -w); rp.y -= droop;
      _c.copy(leafC).multiplyScalar(ao * 1.08);
      const l = L.v(lp, side.clone().add(up).normalize(), _c, SOLID_UV, [0, t, rand(), 0]);
      const r = L.v(rp, side.clone().negate().add(up).normalize(), _c, SOLID_UV, [0, t, rand(), 0]);
      if (i > 0) { L.tri(pc, c, pl); L.tri(pl, c, l); L.tri(pc, pr, c); L.tri(pr, r, c); }
      pc = c; pl = l; pr = r;
    }
  }
  return { bark: B.geometry(H), leaves: L.geometry(H), height: H, radius: H * 0.45, trunkR: r0 * 1.2, species: 'palm' };
}

export function bush(seed, { size = 1.6, color = 0x55892e, berries = false } = {}) {
  const rand = mulberry32(seed);
  const B = new Builder(), L = new Builder();
  const S = size * (0.8 + rand() * 0.4);
  const leafC = new THREE.Color(color);
  const crown = { c: new V3(0, S * 0.45, 0), r: S * 0.75, sy: 0.7 };
  const n = 3 + Math.floor(rand() * 3);
  // a couple of stems
  const barkC = new THREE.Color(0x5e4b38);
  for (let i = 0; i < 3; i++) {
    const a = rand() * 6.28;
    tube(B, branchPath(new V3(0, -0.1, 0), new V3(Math.cos(a) * S * 0.3, S * 0.5, Math.sin(a) * S * 0.3), 0.05 * S, 0.015, 2, 0, rand), 4, barkC, 0, rand);
  }
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2, d = i === 0 ? 0 : S * (0.25 + rand() * 0.25);
    const c = new V3(Math.cos(a) * d, S * (0.38 + rand() * 0.2), Math.sin(a) * d);
    leafBlob(L, c, S * (0.38 + rand() * 0.14), crown, 12, rand() < 0.5 ? CELL.broad : CELL.small, leafC, rand, { stretchY: 0.8, aoBottom: 0.45 });
  }
  if (berries) {
    const bc = new THREE.Color(0x9e1f2c);
    for (let i = 0; i < 18; i++) {
      const d = new V3(rand() * 2 - 1, rand() * 0.9 + 0.1, rand() * 2 - 1).normalize();
      const p = crown.c.clone().add(new V3(d.x * crown.r * 0.95, d.y * crown.r * 0.7, d.z * crown.r * 0.95));
      const s = 0.045;
      const a = L.v(p.clone().add(new V3(-s, 0, 0)), d, bc, SOLID_UV, [0, 1, 0, 0]);
      const b = L.v(p.clone().add(new V3(s, 0, 0)), d, bc, SOLID_UV, [0, 1, 0, 0]);
      const c = L.v(p.clone().add(new V3(0, s * 1.7, 0)), d, bc, SOLID_UV, [0, 1, 0, 0]);
      const e = L.v(p.clone().add(new V3(0, 0, s)), d, bc, SOLID_UV, [0, 1, 0, 0]);
      L.tri(a, b, c); L.tri(a, e, b); L.tri(b, e, c); L.tri(e, a, c);
    }
  }
  return { bark: B.geometry(S * 1.2), leaves: L.geometry(S * 1.2), height: S, radius: S * 0.85, trunkR: 0, species: 'bush' };
}

// fallen log / stump for the forest floor
export function log(seed, { len = 5, r = 0.32, bark = 0x6a5440 } = {}) {
  const rand = mulberry32(seed);
  const B = new Builder();
  const barkC = new THREE.Color(bark);
  const pts = [];
  for (let i = 0; i <= 5; i++) { const t = i / 5; pts.push({ p: new V3(-len / 2 + len * t, r * 0.8 + Math.sin(t * 3) * 0.05, Math.sin(t * 2 + seed) * 0.2), r: r * (1 - 0.2 * t) }); }
  tube(B, pts, 8, barkC, 0, rand);
  return { bark: B.geometry(1e3), leaves: null, height: r * 2, radius: len / 2, trunkR: 0, species: 'log' };
}

// ------------------------------------------------------------------ leaf atlas
// 512x512 RGBA DataTexture, 2x2 cells: broad leaves A/B, small leaves, needle tuft.
//   R = shading variation (0..1), G = coverage (alpha, also read by shadow depth pass),
//   B = vein/edge highlight, A = coverage.
// The top-right corner (u,v > 0.97) is fully opaque for solid canopy shells.
export function makeLeafAtlas() {
  const S = 512, C = 256;
  const cov = new Float32Array(S * S), shade = new Float32Array(S * S).fill(0.75), vein = new Float32Array(S * S);
  const rand = mulberry32(4711);
  function leaf(cx, cy, ang, len, wid, x0, y0, tone) {
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const ext = len * 1.1;
    for (let y = Math.max(y0, Math.floor(cy - ext)); y <= Math.min(y0 + C - 1, Math.ceil(cy + ext)); y++) {
      for (let x = Math.max(x0, Math.floor(cx - ext)); x <= Math.min(x0 + C - 1, Math.ceil(cx + ext)); x++) {
        const dx = x - cx, dy = y - cy;
        const u = (dx * ca + dy * sa) / len;       // along leaf 0..1
        const v = (-dx * sa + dy * ca) / wid;      // across
        if (u < 0 || u > 1) continue;
        const prof = Math.sin(Math.PI * Math.pow(u, 0.75)) * (1 - 0.15 * u);
        const e = Math.abs(v) / Math.max(prof, 1e-3);
        if (e > 1) continue;
        const k = y * S + x;
        const a = Math.min(1, (1 - e) * 6);
        if (a > cov[k] - 0.05) {
          cov[k] = Math.max(cov[k], a);
          // light side / dark side of the midrib + tone per leaf
          shade[k] = tone * (v > 0 ? 1.0 : 0.86) * (0.85 + 0.15 * u);
          vein[k] = Math.max(0, 1 - Math.abs(v) * 8) * 0.6 + (e > 0.8 ? 0.4 : 0);
        }
      }
    }
  }
  const cells = [[0, 0], [C, 0], [0, C], [C, C]];
  for (let ci = 0; ci < 4; ci++) {
    const [x0, y0] = cells[ci];
    const n = ci === 2 ? 70 : ci === 3 ? 0 : 34;
    if (ci === 3) {
      // needle frond: twig along +u through the cell middle, needles angled toward the tip
      for (let i = 0; i < 260; i++) {
        const u = 0.02 + rand() * 0.96;
        const side = rand() < 0.5 ? -1 : 1;
        const ang = side * (0.45 + rand() * 0.45);
        const len = C * (0.1 + 0.32 * (1 - u * 0.65)) * (0.7 + rand() * 0.4);
        leaf(x0 + u * C, y0 + C / 2 + (rand() - 0.5) * 6, ang, len, 2.2 + rand() * 1.4, x0, y0, 0.6 + rand() * 0.4);
      }
      for (let x = x0; x < x0 + C; x++) for (let dy = -2; dy <= 2; dy++) { const k = (y0 + C / 2 + dy) * S + x; cov[k] = 1; shade[k] = 0.5; }
    }
    for (let i = 0; i < n; i++) {
      // leaves fill a rounded clump; denser in the middle
      const r = Math.pow(rand(), 0.6) * C * 0.42, a = rand() * Math.PI * 2;
      const cx = x0 + C / 2 + Math.cos(a) * r, cy = y0 + C / 2 + Math.sin(a) * r;
      const ang = a + (rand() - 0.5) * 1.2;
      let len, wid;
      if (ci === 3) { len = 30 + rand() * 26; wid = 2.6 + rand() * 1.5; }        // needles
      else if (ci === 2) { len = 22 + rand() * 12; wid = 8 + rand() * 4; }    // small round leaves
      else { len = 46 + rand() * 26; wid = 16 + rand() * 8; }                  // broad leaves
      leaf(cx - Math.cos(ang) * len * 0.3, cy - Math.sin(ang) * len * 0.3, ang, len, wid, x0, y0, 0.62 + rand() * 0.38);
    }
  }
  const data = new Uint8Array(S * S * 4);
  for (let k = 0; k < S * S; k++) {
    const x = k % S, y = (k / S) | 0;
    let c = cov[k];
    let sh = shade[k], vn = vein[k];
    if (x > S * 0.97 && y > S * 0.97) { c = 1; sh = 0.8; vn = 0; }
    data[k * 4] = sh * 255; data[k * 4 + 1] = c * 255; data[k * 4 + 2] = vn * 255; data[k * 4 + 3] = c * 255;
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.colorSpace = THREE.NoColorSpace; t.anisotropy = 4; t.needsUpdate = true;
  return t;
}
