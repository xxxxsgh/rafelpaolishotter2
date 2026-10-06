// Procedural geometry for gameplay objects. Every builder returns ONE merged BufferGeometry
// (position/normal/color/emit) for the toon material, origin at the base (y = 0 is ground).
import * as THREE from 'three';
import { Kit, P, rng } from './geo.js';
import { ITEMS } from './items.js';

const cache = new Map();
const col = (h) => new THREE.Color(h).getHex();

// ------------------------------------------------------------------ ingredients
function mushroom(k, it, x = 0, z = 0, s = 1, lean = 0, seed = 1) {
  const tall = it.tall ? 1.5 : 1;
  const h = 0.11 * s * tall, cr = 0.075 * s * (it.tall ? 0.8 : 1);
  k.add(P.cyl(0.018 * s, 0.026 * s, h, 7), { pos: [x, h / 2, z], rot: [lean, 0, lean * 0.6], color: col(it.c2), color2: 0xd8c8a8, grad: (lx, ly) => 0.5 - ly / h });
  const capY = h * 0.95;
  const cap = P.sphere(cr, 12, 7);
  k.add(cap, {
    pos: [x + Math.sin(lean * 0.6) * h * 0.5, capY, z - Math.sin(lean) * h * 0.5], scl: [1, it.tall ? 0.85 : 0.55, 1], rot: [lean, seed, lean * 0.6],
    color: col(it.c), jitter: 0.12,
    colorFn: (wx, wy, wz, lx, ly, lz) => {
      if (ly < -cr * 0.15) return col(it.c2);                    // gills underneath
      if (it.spots) { const a = Math.sin(lx * 160 + seed) * Math.sin(lz * 150 - seed) * Math.sin(ly * 120); if (a > 0.55 && ly > cr * 0.2) return 0xfaf2e0; }
      return null;
    },
    emit: it.glow ? (lx, ly) => ly > -cr * 0.1 ? 0.7 : 0.3 : 0,
  });
}
function shelf(k, it) {
  k.add(P.cyl(0.07, 0.09, 0.16, 9), { pos: [0, 0.08, 0], color: 0x6a5038, color2: 0x8a6a48, grad: (x, y) => y * 5 + 0.5 });
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1, y = 0.05 + i * 0.045;
    k.add(P.sphere(0.07 - i * 0.012, 10, 5), { pos: [Math.cos(a) * 0.07, y, Math.sin(a) * 0.07], scl: [1, 0.3, 1], color: col(it.c), color2: col(it.c2), grad: (x, yy) => yy > 0 ? 0 : 1 });
  }
}
function herbRosette(k, it, s = 1, seed = 3) {
  const R = rng(seed); const n = 7;
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2 + R() * 0.4;
    const L = (0.13 + R() * 0.06) * s;
    k.add(P.leaf(0.05 * s, L, 0.5), { rot: [-0.95 - R() * 0.3, a, 0], order: 'YXZ', color: col(it.c2), color2: col(it.c), grad: (x, y) => y / L, jitter: 0.08 });
  }
  if (it.id === 'dewleaf') for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2 + 0.3, d = (0.05 + R() * 0.04) * s;
    k.add(P.sphere(0.009 * s, 6, 4), { pos: [Math.cos(a) * d, (0.05 + R() * 0.03) * s, Math.sin(a) * d], color: 0xe8fbff, emit: 0.35 });
  }
  if (it.id === 'snowmint') for (let i = 0; i < 4; i++) k.add(P.leaf(0.035 * s, 0.1 * s, 0.2), { rot: [-0.3, i * 1.6, 0], order: 'YXZ', color: col(it.c), color2: 0xffffff, grad: (x, y) => y * 6 });
}
function flower(k, it, s = 1, seed = 5) {
  const R = rng(seed); const H = 0.22 * s;
  k.add(P.cyl(0.006 * s, 0.009 * s, H, 5), { pos: [0, H / 2, 0], color: 0x4f8a2a });
  for (let i = 0; i < 3; i++) k.add(P.leaf(0.04 * s, 0.12 * s, 0.4), { rot: [-1.0, i * 2.1 + R(), 0], order: 'YXZ', color: 0x3f7a2a, color2: 0x7ab840, grad: (x, y) => y * 8 });
  const np = it.id === 'sunpetal' ? 10 : 6;
  for (let i = 0; i < np; i++) {
    const a = i / np * Math.PI * 2;
    k.add(P.leaf(0.045 * s, 0.07 * s, -0.3, 3), { pos: [0, H, 0], rot: [-1.2, a, 0], order: 'YXZ', color: col(it.c2), color2: col(it.c), grad: (x, y) => y / (0.03 * s), jitter: 0.06 });
  }
  k.add(P.sphere(0.018 * s, 8, 6), { pos: [0, H + 0.008, 0], scl: [1, 0.6, 1], color: it.id === 'sunpetal' ? 0x8a4a1a : 0xffe070 });
}
function reed(k, it, s = 1) {
  const R = rng(7);
  for (let i = 0; i < 6; i++) {
    const a = R() * 6.28, L = (0.28 + R() * 0.16) * s;
    k.add(P.leaf(0.022 * s, L, 0.25), { pos: [Math.cos(a) * 0.02, 0, Math.sin(a) * 0.02], rot: [-0.18 - R() * 0.2, a, 0], order: 'YXZ', color: col(it.c2), color2: col(it.c), grad: (x, y) => y / L });
  }
  for (let i = 0; i < 2; i++) k.add(P.capsule(0.012 * s, 0.05 * s, 3, 6), { pos: [i * 0.03 - 0.015, 0.36 * s, 0.01], rot: [0.15, 0, i * 0.3 - 0.15], color: 0xb89a5a });
}
function root(k, it, s = 1) {
  k.add(P.sphere(0.06 * s, 12, 8), { pos: [-0.025 * s, 0.05 * s, 0], scl: [1, 1.1, 0.9], color: col(it.c), color2: col(it.c2), grad: (x, y) => 0.5 - y * 10 });
  k.add(P.sphere(0.06 * s, 12, 8), { pos: [0.025 * s, 0.05 * s, 0], scl: [1, 1.1, 0.9], color: col(it.c), color2: col(it.c2), grad: (x, y) => 0.5 - y * 10 });
  k.add(P.cone(0.06 * s, 0.07 * s, 10), { pos: [0, 0.0, 0], rot: [Math.PI, 0, 0], color: col(it.c) });
  for (let i = 0; i < 4; i++) k.add(P.leaf(0.04 * s, 0.14 * s, 0.3), { pos: [0, 0.1 * s, 0], rot: [-0.4, i * 1.57, 0], order: 'YXZ', color: 0x3f8a3a, color2: 0x8ad050, grad: (x, y) => y * 7 });
}
function fruit(k, it, s = 1, x = 0, y = 0, z = 0) {
  const r = 0.055 * s;
  k.add(P.sphere(r, 14, 10), { pos: [x, y + r * 0.9, z], scl: [1, 0.92, 1], color: col(it.c), color2: col(it.c2), grad: (lx, ly, lz) => 0.45 + lx / r * 0.35 - ly / r * 0.25, jitter: 0.06 });
  k.add(P.cyl(0.004 * s, 0.005 * s, 0.03 * s, 4), { pos: [x, y + r * 1.8, z], rot: [0.2, 0, 0.2], color: 0x5a3a20 });
  k.add(P.leaf(0.03 * s, 0.05 * s, 0.2, 3), { pos: [x, y + r * 1.82, z], rot: [-1.1, 0.6, 0], order: 'YXZ', color: 0x4f9a2a });
}
function berries(k, it, s = 1) {
  const R = rng(11);
  for (let i = 0; i < 9; i++) {
    const a = R() * 6.28, d = R() * 0.03 * s, y = 0.02 * s + R() * 0.04 * s;
    k.add(P.sphere(0.017 * s, 8, 6), { pos: [Math.cos(a) * d, y, Math.sin(a) * d], color: col(R() > 0.3 ? it.c : it.c2) });
  }
  k.add(P.leaf(0.04 * s, 0.07 * s, 0.2, 3), { pos: [0, 0.07 * s, 0], rot: [-0.8, 0.3, 0], order: 'YXZ', color: 0x3f7a2a });
}
function berryBush(k, it) {
  const R = rng(19);
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * 6.28 + R() * 0.5, d = 0.16 + R() * 0.14, r = 0.2 + R() * 0.1;
    k.add(P.ico(r, 1), { pos: [Math.cos(a) * d, 0.2 + R() * 0.14, Math.sin(a) * d], scl: [1, 0.8, 1], color: 0x3f7a3a, color2: 0x6aa84a, grad: (x, y) => y * 3 + 0.5, flat: true, jitter: 0.15 });
  }
  k.add(P.ico(0.24, 1), { pos: [0, 0.4, 0], color: 0x4a8a3a, color2: 0x7ab850, grad: (x, y) => y * 3 + 0.5, flat: true });
  for (let i = 0; i < 26; i++) {
    const a = R() * 6.28, el = R() * 1.2, d = 0.34 + R() * 0.06;
    k.add(P.sphere(0.028, 7, 5), { pos: [Math.cos(a) * Math.cos(el) * d, 0.24 + Math.sin(el) * d * 0.8, Math.sin(a) * Math.cos(el) * d], color: col(R() > 0.3 ? it.c : it.c2) });
  }
}
function pepper(k, it, s = 1) {
  const g = P.cone(0.026 * s, 0.11 * s, 8);
  k.add(g, { pos: [0, 0.026 * s, 0], rot: [0, 0, -Math.PI / 2 + 0.25], color: col(it.c), jitter: 0.06 });
  k.add(P.cyl(0.01 * s, 0.014 * s, 0.03 * s, 6), { pos: [-0.06 * s, 0.04 * s, 0], rot: [0, 0, 0.8], color: col(it.c2) });
}
function pepperPlant(k, it) {
  const R = rng(23);
  for (let i = 0; i < 7; i++) k.add(P.leaf(0.06, 0.2, 0.4), { rot: [-0.6 - R() * 0.4, i * 0.9, 0], order: 'YXZ', color: 0x3a7a2a, color2: 0x7ab840, grad: (x, y) => y * 5 });
  for (let i = 0; i < 5; i++) {
    const a = i * 1.3, d = 0.08 + R() * 0.06;
    k.add(P.cone(0.022, 0.09, 7), { pos: [Math.cos(a) * d, 0.12 + R() * 0.06, Math.sin(a) * d], rot: [Math.PI, 0, R() * 0.4], color: col(it.c) });
  }
}
function melon(k, it, s = 1) {
  const r = 0.11 * s;
  k.add(P.sphere(r, 16, 10), { pos: [0, r * 0.8, 0], scl: [1.25, 0.85, 1], color: col(it.c), jitter: 0.05,
    colorFn: (wx, wy, wz, lx, ly, lz) => Math.sin(Math.atan2(lz, lx) * 9) > 0.35 ? 0x3a7a3a : null });
  k.add(P.cyl(0.008, 0.01, 0.04, 5), { pos: [0, r * 1.6, 0], color: 0x6a5a2a });
}
function fish(k, it, s = 1) {
  const L = 0.15 * s;
  k.add(P.sphere(L, 14, 8), { pos: [0, 0, 0], scl: [1, 0.36, 0.16], color: col(it.c), color2: col(it.c2), grad: (x, y) => 0.5 - y / (L * 0.36) * 1.4, jitter: 0.06,
    colorFn: (wx, wy, wz, lx, ly, lz) => (lx > L * 0.7 && Math.abs(ly) < L * 0.12 && lz > 0.0 ? 0x1a1a22 : null) });
  const tail = new THREE.BufferGeometry();
  tail.setAttribute('position', new THREE.Float32BufferAttribute([-L * 0.85, 0, 0, -L * 1.35, L * 0.32, 0, -L * 1.35, -L * 0.32, 0], 3));
  tail.setIndex([0, 1, 2]); tail.computeVertexNormals();
  k.add(tail, { color: col(it.c), color2: col(it.c2), grad: (x) => -x / L - 1 });
  const fin = new THREE.BufferGeometry();
  fin.setAttribute('position', new THREE.Float32BufferAttribute([L * 0.3, L * 0.3, 0, -L * 0.3, L * 0.32, 0, -L * 0.05, L * 0.55, 0], 3));
  fin.setIndex([0, 1, 2]); fin.computeVertexNormals();
  k.add(fin, { color: col(it.c) });
}
function meat(k, it, s = 1) {
  k.add(P.sphere(0.1 * s, 12, 9), { pos: [0, 0.07 * s, 0], scl: [1.25, 0.75, 0.95], color: col(it.c), color2: 0xf0d0c0, grad: (x, y) => y > 0.05 * s ? 0.3 : 0, jitter: 0.1 });
  k.add(P.cyl(0.018 * s, 0.018 * s, 0.14 * s, 6), { pos: [0.15 * s, 0.07 * s, 0], rot: [0, 0, 1.57], color: col(it.c2) });
  k.add(P.sphere(0.026 * s, 8, 6), { pos: [0.22 * s, 0.07 * s, 0], color: col(it.c2) });
}
function egg(k, it, s = 1, x = 0, z = 0, ry = 0) {
  const r = 0.035 * s;
  k.add(P.sphere(r, 12, 9), { pos: [x, r * 1.2, z], scl: [1, 1.3, 1], rot: [0.3, ry, 0.2], color: col(it.c),
    colorFn: (wx, wy, wz) => (Math.sin(wx * 400) * Math.sin(wz * 410) * Math.sin(wy * 390) > 0.6 ? col(it.c2) : null) });
}
function nest(k, it) {
  const R = rng(31);
  for (let i = 0; i < 40; i++) {
    const a = R() * 6.28;
    k.add(P.cyl(0.006, 0.006, 0.22, 3), { pos: [Math.cos(a) * 0.12, 0.04 + R() * 0.04, Math.sin(a) * 0.12], rot: [R() * 0.6, a + 1.57, 1.57 + (R() - 0.5) * 0.5], order: 'YXZ', color: R() > 0.5 ? 0xa8884a : 0x7a603a });
  }
  k.add(P.cyl(0.13, 0.08, 0.05, 10), { pos: [0, 0.03, 0], color: 0x8a6a3a });
  egg(k, it, 1, -0.03, 0, 0.3); egg(k, it, 1, 0.035, 0.02, 1); egg(k, it, 1, 0.0, -0.04, 2);
}
function wheat(k, it, s = 1) {
  for (let i = 0; i < 7; i++) {
    const a = i * 0.9, d = 0.012 * s;
    k.add(P.cyl(0.003 * s, 0.003 * s, 0.24 * s, 3), { pos: [Math.cos(a) * d, 0.12 * s, Math.sin(a) * d], rot: [Math.sin(a) * 0.12, 0, Math.cos(a) * 0.12], color: col(it.c2) });
    k.add(P.capsule(0.009 * s, 0.05 * s, 3, 5), { pos: [Math.cos(a) * d * 3, 0.26 * s, Math.sin(a) * d * 3], rot: [Math.sin(a) * 0.25, 0, Math.cos(a) * 0.25], color: col(it.c) });
  }
  k.add(P.torus(0.02 * s, 0.006 * s, 4, 10), { pos: [0, 0.09 * s, 0], rot: [1.57, 0, 0], color: 0xa83a2a });
}
function sack(k, c, c2, s = 1) {
  k.add(P.sphere(0.07 * s, 12, 8), { pos: [0, 0.06 * s, 0], scl: [1, 0.9, 1], color: col(c2), jitter: 0.12 });
  k.add(P.cyl(0.03 * s, 0.045 * s, 0.04 * s, 8), { pos: [0, 0.13 * s, 0], color: col(c2) });
  k.add(P.torus(0.032 * s, 0.006 * s, 4, 10), { pos: [0, 0.12 * s, 0], rot: [1.57, 0, 0], color: 0x8a5a3a });
  k.add(P.sphere(0.035 * s, 8, 6), { pos: [0, 0.16 * s, 0], scl: [1, 0.5, 1], color: col(c) });
}
function crystal(k, c, c2, x, y, z, h, r, rx, rz, emit = 0.2) {
  k.add(P.cyl(r * 0.25, r, h * 0.75, 6), { pos: [x, y + h * 0.375, z], rot: [rx, 0, rz], color: col(c), color2: col(c2), grad: (lx, ly) => ly / h + 0.3, flat: true, emit, jitter: 0.04 });
  k.add(P.cone(r * 0.25, h * 0.25, 6), { pos: [x + Math.sin(rz) * -h * 0.75 * 0.5 * 2 * 0.5, y + h * 0.75 + h * 0.12, z + Math.sin(rx) * h * 0.375], rot: [rx, 0, rz], color: col(c2), flat: true, emit });
}
function gem(k, it, s = 1) {
  k.add(P.rock(0.06 * s, 2, 0.3, 0), { pos: [0, 0.03 * s, 0], color: 0x7a7468, flat: true });
  crystal(k, it.c, it.c2, 0, 0.02 * s, 0, 0.11 * s, 0.03 * s, 0.1, -0.2, 0.25);
  crystal(k, it.c, it.c2, 0.025 * s, 0.01 * s, 0.01 * s, 0.07 * s, 0.022 * s, 0.3, 0.5, 0.25);
}
function flint(k, it, s = 1) { k.add(P.rock(0.06 * s, 5, 0.4, 0), { pos: [0, 0.04 * s, 0], scl: [1.2, 0.8, 1], color: col(it.c), color2: col(it.c2), grad: (x, y) => y * 10 + 0.4, flat: true }); }
function horn(k, it, s = 1) {
  const n = 6;
  for (let i = 0; i < n; i++) {
    const t = i / n, r = 0.03 * s * (1 - t * 0.8);
    k.add(P.cyl(r * 0.8, r, 0.05 * s, 7), { pos: [Math.sin(t * 1.6) * 0.12 * s, 0.02 * s + (1 - Math.cos(t * 1.6)) * 0.1 * s, 0], rot: [0, 0, -t * 1.6 - 1.4], color: col(it.c), color2: col(it.c2), grad: () => t });
  }
}
function fang(k, it, s = 1) { k.add(P.cone(0.025 * s, 0.13 * s, 7), { pos: [0, 0.025 * s, 0], rot: [0, 0, 1.4], color: col(it.c), color2: col(it.c2), grad: (x, y) => 0.5 - y * 5 }); }
function plate(k, it, s = 1) { k.add(P.sphere(0.11 * s, 12, 6), { pos: [0, 0.02 * s, 0], scl: [1, 0.3, 1.25], color: col(it.c), color2: col(it.c2), grad: (x, y) => y * 30 }); }
function core(k, it, s = 1) {
  k.add(P.ico(0.06 * s, 0), { pos: [0, 0.07 * s, 0], color: col(it.c), flat: true, emit: 0.9 });
  k.add(P.torus(0.07 * s, 0.014 * s, 5, 12), { pos: [0, 0.07 * s, 0], rot: [1.2, 0, 0.3], color: col(it.c2) });
}
function essence(k, it, s = 1) { k.add(P.ico(0.05 * s, 1), { pos: [0, 0.06 * s, 0], color: col(it.c), color2: col(it.c2), grad: (x, y) => 0.5 - y * 10, emit: 0.95 }); }
function mossstone(k, it, s = 1) { k.add(P.rock(0.08 * s, 3, 0.25, 1), { pos: [0, 0.06 * s, 0], color: col(it.c), colorFn: (x, y, z, lx, ly) => ly > 0.02 * s ? col(it.c2) : null }); }
function sigil(k, it, s = 1) {
  k.add(P.cyl(0.07 * s, 0.07 * s, 0.015 * s, 16), { pos: [0, 0.01 * s, 0], color: 0x8a7a5a });
  k.add(P.torus(0.055 * s, 0.008 * s, 5, 16), { pos: [0, 0.02 * s, 0], rot: [1.57, 0, 0], color: col(it.c), emit: 0.8 });
  k.add(P.oct(0.025 * s), { pos: [0, 0.03 * s, 0], scl: [1, 0.4, 1], color: col(it.c2), emit: 0.9 });
}
function honey(k, it, s = 1) {
  k.add(P.cyl(0.05 * s, 0.045 * s, 0.09 * s, 10), { pos: [0, 0.045 * s, 0], color: col(it.c), color2: col(it.c2), grad: (x, y) => y * 8 + 0.3, emit: 0.15 });
  k.add(P.cyl(0.054 * s, 0.054 * s, 0.02 * s, 10), { pos: [0, 0.095 * s, 0], color: 0xe8d8b8 });
}
function bottle(k, c, c2, s = 1) {
  k.add(P.lathe([[0, 0], [0.04, 0], [0.045, 0.02], [0.045, 0.07], [0.025, 0.095], [0.014, 0.11], [0.014, 0.13], [0, 0.13]].map(([a, b]) => [a * s, b * s]), 12),
    { color: col(c), color2: col(c2), grad: (x, y) => y / (0.13 * s) * 1.2 - 0.2, emit: 0.25 });
  k.add(P.cyl(0.016 * s, 0.013 * s, 0.025 * s, 8), { pos: [0, 0.135 * s, 0], color: 0x9a7048 });
}
function block(k, c, c2, s = 1) {
  k.add(P.box(0.1 * s, 0.06 * s, 0.07 * s), { pos: [0, 0.03 * s, 0], color: col(c) });
  k.add(P.box(0.13 * s, 0.01 * s, 0.1 * s), { pos: [0, 0.005 * s, 0], color: col(c2) });
}

export function ingredientGeometry(id, variant = 'item') {
  const key = id + ':' + variant;
  if (cache.has(key)) return cache.get(key);
  const it = ITEMS[id] || ITEMS.dewleaf;
  const k = new Kit();
  const world = variant === 'world';
  switch (it.shape) {
    case 'mushroom':
      if (world) { mushroom(k, it, 0, 0, 1.15, 0.05, 1); mushroom(k, it, 0.085, 0.04, 0.75, -0.25, 2); mushroom(k, it, -0.05, 0.075, 0.55, 0.3, 3); }
      else mushroom(k, it, 0, 0, 1.2, 0, 1);
      break;
    case 'shelf': shelf(k, it); break;
    case 'herb': herbRosette(k, it, world ? 1.4 : 1); break;
    case 'flower': if (world) { flower(k, it, 1.3, 5); } else flower(k, it, 1); break;
    case 'reed': reed(k, it, world ? 1.3 : 0.8); break;
    case 'root': root(k, it, world ? 1.2 : 1); break;
    case 'fruit': fruit(k, it, world ? 1.2 : 1); break;
    case 'berries': if (world) berryBush(k, it); else berries(k, it, 1.4); break;
    case 'pepper': if (world) pepperPlant(k, it); else pepper(k, it, 1.2); break;
    case 'melon': melon(k, it, world ? 1.3 : 0.8); break;
    case 'fish': fish(k, it, 1.0); break;
    case 'meat': meat(k, it, 1); break;
    case 'egg': if (world) nest(k, it); else egg(k, it, 1.3); break;
    case 'wheat': wheat(k, it, 1); break;
    case 'salt': case 'sugar': sack(k, it.c, it.c2, 1); break;
    case 'butter': block(k, it.c, it.c2, 1); break;
    case 'milk': bottle(k, it.c, it.c2, 1); break;
    case 'honey': honey(k, it, 1); break;
    case 'gem': gem(k, it, world ? 1.4 : 1); break;
    case 'flint': flint(k, it, 1); break;
    case 'horn': horn(k, it, 1); break;
    case 'fang': fang(k, it, 1); break;
    case 'shellplate': plate(k, it, 1); break;
    case 'core': core(k, it, 1); break;
    case 'essence': essence(k, it, 1); break;
    case 'mossstone': mossstone(k, it, 1); break;
    case 'sigil': sigil(k, it, 1); break;
    default: k.add(P.sphere(0.05, 10, 8), { pos: [0, 0.05, 0], color: col(it.c || '#ccc') });
  }
  const g = k.build();
  cache.set(key, g);
  return g;
}

// ------------------------------------------------------------------ dishes
export function dishGeometry(d) {
  const key = 'dish:' + d.kind + d.c + d.c2;
  if (cache.has(key)) return cache.get(key);
  const k = new Kit();
  const c = col(d.c), c2 = col(d.c2);
  const R = rng(d.kind.length * 7 + (c & 255));
  const bowl = (r = 0.11, food = c) => {
    k.add(P.lathe([[0, 0], [r * 0.45, 0], [r * 0.5, 0.012], [r * 0.85, 0.035], [r, 0.07], [r * 1.02, 0.078], [r * 0.95, 0.078], [r * 0.82, 0.04], [0, 0.03]], 18),
      { color: 0xd8c8a8, color2: 0x8a6a48, grad: (x, y) => y < 0.02 ? 1 : 0.15, jitter: 0.05 });
    k.add(P.cyl(r * 0.9, r * 0.9, 0.01, 18), { pos: [0, 0.064, 0], color: food, jitter: 0.12 });
  };
  switch (d.kind) {
    case 'bowl':
      bowl();
      for (let i = 0; i < 6; i++) { const a = R() * 6.28, rr = R() * 0.06; k.add(P.ico(0.016 + R() * 0.01, 0), { pos: [Math.cos(a) * rr, 0.072, Math.sin(a) * rr], color: R() > 0.5 ? c2 : 0xf0e0c0, flat: true }); }
      k.add(P.leaf(0.02, 0.04, 0.1, 2), { pos: [0.02, 0.075, 0.01], rot: [-1.3, 0.5, 0], order: 'YXZ', color: 0x4f9a2a });
      break;
    case 'skewer':
      k.add(P.cyl(0.004, 0.004, 0.34, 4), { pos: [0, 0.03, 0], rot: [0, 0, 1.45], color: 0xc8a070 });
      for (let i = 0; i < 4; i++) k.add(P.ico(0.034, 1), { pos: [-0.09 + i * 0.06, 0.03 + i * 0.005, 0], scl: [0.8, 1, 1], color: i % 2 ? c2 : c, flat: true, jitter: 0.15 });
      break;
    case 'pie':
      k.add(P.cyl(0.12, 0.1, 0.05, 20), { pos: [0, 0.025, 0], color: 0xe0a860, color2: 0xa86a30, grad: (x, y) => 0.5 - y * 20 });
      k.add(P.torus(0.11, 0.018, 6, 22), { pos: [0, 0.05, 0], rot: [1.57, 0, 0], color: 0xe8b870, jitter: 0.15 });
      k.add(P.cyl(0.1, 0.1, 0.01, 20), { pos: [0, 0.052, 0], color: c, colorFn: (x, y, z) => Math.abs(Math.sin((x - z) * 60)) < 0.18 || Math.abs(Math.sin((x + z) * 60)) < 0.18 ? 0xe8b870 : null });
      break;
    case 'plate':
      k.add(P.cyl(0.14, 0.11, 0.018, 20), { pos: [0, 0.009, 0], color: 0xece0c8, color2: 0x9ab0c0, grad: (x, y, z) => Math.hypot(x, z) > 0.12 ? 1 : 0 });
      for (let i = 0; i < 5; i++) { const a = i * 1.25, rr = 0.04 + R() * 0.03; k.add(P.ico(0.03 + R() * 0.012, 1), { pos: [Math.cos(a) * rr, 0.035, Math.sin(a) * rr], scl: [1.2, 0.7, 1], color: i % 2 ? c2 : c, flat: true, jitter: 0.15 }); }
      break;
    case 'bread':
      k.add(P.sphere(0.1, 14, 8), { pos: [0, 0.02, 0], scl: [1.2, 0.35, 1], color: c, color2: c2, grad: (x, y, z) => Math.hypot(x, z) * 9 - 0.2 + (Math.sin(x * 90) * Math.sin(z * 90) > 0.6 ? 0.6 : 0) });
      break;
    case 'bottle': bottle(k, d.c, d.c2, 1.3); break;
    case 'mash':
      bowl(0.11, c);
      k.add(P.sphere(0.07, 10, 7), { pos: [0, 0.07, 0], scl: [1, 0.45, 1], color: c, colorFn: (x, y, z) => Math.sin(x * 80) * Math.sin(z * 70) > 0.5 ? c2 : null, jitter: 0.25 });
      break;
    case 'omelette':
      k.add(P.cyl(0.14, 0.11, 0.018, 20), { pos: [0, 0.009, 0], color: 0xece0c8 });
      k.add(P.sphere(0.09, 14, 8, 0), { pos: [0, 0.02, 0], scl: [1.4, 0.4, 0.8], color: c, jitter: 0.08 });
      for (let i = 0; i < 4; i++) k.add(P.leaf(0.015, 0.03, 0.1, 2), { pos: [-0.04 + i * 0.03, 0.055, 0], rot: [-1.4, i, 0], order: 'YXZ', color: c2 });
      break;
    case 'pudding':
      k.add(P.cyl(0.12, 0.1, 0.014, 20), { pos: [0, 0.007, 0], color: 0xece0c8 });
      k.add(P.cyl(0.05, 0.07, 0.08, 16), { pos: [0, 0.054, 0], color: c, color2: c2, grad: (x, y) => y > 0.03 ? 1 : 0 });
      break;
    case 'cup':
      k.add(P.lathe([[0, 0], [0.04, 0], [0.05, 0.08], [0.046, 0.08], [0.036, 0.008], [0, 0.008]], 14), { color: 0xd8b890, jitter: 0.05 });
      k.add(P.cyl(0.044, 0.044, 0.006, 14), { pos: [0, 0.07, 0], color: c });
      k.add(P.torus(0.022, 0.006, 4, 10, Math.PI), { pos: [0.052, 0.042, 0], rot: [0, 0, -1.57], color: 0xd8b890 });
      break;
  }
  const g = k.build();
  cache.set(key, g);
  return g;
}

// ------------------------------------------------------------------ campfire, pot, camp dressing
export function campfireGeometry(seed = 1) {
  const k = new Kit(); const R = rng(seed);
  // ash + charcoal bed (glowing embers in the centre)
  k.add(P.cyl(0.62, 0.7, 0.05, 20), { pos: [0, 0.01, 0], color: 0x3a3430, jitter: 0.25, jitterScale: 14,
    emit: (x, y, z) => { const d = Math.hypot(x, z); return d < 0.32 ? 0.0 : 0; } });
  // stone ring
  const n = 11;
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2 + R() * 0.15, r = 0.82 + R() * 0.06, s = 0.17 + R() * 0.07;
    k.add(P.rock(s, i * 3 + seed, 0.32, 1), { pos: [Math.cos(a) * r, s * 0.45, Math.sin(a) * r], rot: [R(), R() * 6, R()], color: 0x8a8478, color2: 0x5a5a58, grad: (x, y) => 0.6 - y / s, jitter: 0.12,
      colorFn: (wx, wy, wz, lx, ly) => ly > s * 0.55 && R() > 0.7 ? 0x6a8a4a : null });
  }
  // crossed logs leaning into a cone (charred ends glow)
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2 + 0.3, L = 0.85 + R() * 0.15;
    const m = new THREE.Matrix4().makeRotationY(-a).multiply(new THREE.Matrix4().makeRotationZ(0.95)).setPosition(Math.cos(a) * 0.3, 0.22, Math.sin(a) * 0.3);
    k.add(P.cyl(0.05, 0.065, L, 7), { matrix: m, color: 0x6a4a30, color2: 0x1c1410, grad: (x, y) => y / L * 2.2 + 0.6, jitter: 0.15,
      emit: (x, y) => y > L * 0.28 ? Math.min(1, (y / L - 0.28) * 4) * 0.85 : 0 });
  }
  // embers in the bed
  for (let i = 0; i < 18; i++) {
    const a = R() * 6.28, r = R() * 0.42;
    k.add(P.ico(0.04 + R() * 0.035, 0), { pos: [Math.cos(a) * r, 0.04, Math.sin(a) * r], color: R() > 0.4 ? 0xff7a2a : 0x2a1a14, flat: true, emit: r < 0.32 ? 0.9 : 0.2 });
  }
  return k.build();
}

export function tripodGeometry() {
  const k = new Kit();
  const H = 1.45;
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * Math.PI * 2 + 0.5;
    const bx = Math.cos(a) * 0.95, bz = Math.sin(a) * 0.95;
    const dir = new THREE.Vector3(-bx, H, -bz); const len = dir.length(); dir.normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(bx / 2, H / 2, bz / 2), q, new THREE.Vector3(1, 1, 1));
    k.add(P.cyl(0.028, 0.038, len + 0.12, 6), { matrix: m, color: 0x7a5a3a, color2: 0x4a3420, grad: (x, y) => 0.5 - y / len, jitter: 0.2 });
  }
  k.add(P.torus(0.06, 0.022, 5, 10), { pos: [0, H - 0.02, 0], rot: [1.57, 0, 0], color: 0xa88a5a });   // rope binding
  // chain down to the pot
  for (let i = 0; i < 6; i++) k.add(P.torus(0.022, 0.006, 4, 8), { pos: [0, H - 0.1 - i * 0.07, 0], rot: [0, i * 1.57, 0], color: 0x3a3634 });
  return k.build();
}

export function potGeometry() {
  const k = new Kit();
  // cauldron body (lathe), rim and handle; soup surface is a separate mesh
  const prof = [[0, 0.02], [0.12, 0.0], [0.24, 0.04], [0.31, 0.13], [0.32, 0.22], [0.29, 0.31], [0.27, 0.34], [0.3, 0.355], [0.31, 0.375], [0.27, 0.38], [0.255, 0.36], [0.27, 0.32], [0.3, 0.22], [0.29, 0.13], [0.23, 0.06], [0.12, 0.03], [0, 0.04]];
  k.add(P.lathe(prof, 22), { color: 0x45484e, color2: 0x24262c, grad: (x, y) => 1 - y * 2.6, jitter: 0.18, jitterScale: 6,
    colorFn: (wx, wy, wz, lx, ly) => ly < 0.06 ? 0x1a1a1e : null });
  // three stubby feet
  for (let i = 0; i < 3; i++) { const a = i / 3 * 6.28; k.add(P.cyl(0.03, 0.02, 0.07, 6), { pos: [Math.cos(a) * 0.17, 0.0, Math.sin(a) * 0.17], color: 0x2a2a2e }); }
  // bail handle up to the chain hook
  k.add(P.torus(0.31, 0.011, 4, 20, Math.PI), { pos: [0, 0.37, 0], color: 0x34363a });
  for (const s of [-1, 1]) k.add(P.torus(0.03, 0.01, 4, 8), { pos: [s * 0.3, 0.33, 0], rot: [0, 1.57, 0], color: 0x34363a });
  return k.build();
}

export function campDressing(seed = 7) {
  // log bench, firewood pile, a bedroll and a basket of produce: the cosy camp kit
  const k = new Kit(); const R = rng(seed);
  // log bench (behind the fire)
  k.add(P.cyl(0.2, 0.22, 1.8, 10), { pos: [0, 0.2, -2.0], rot: [0, 0.25, 1.57], order: 'YXZ', color: 0x7a5a3a, jitter: 0.18,
    colorFn: (x, y, z, lx, ly, lz) => Math.abs(ly) > 0.88 ? 0xd8b080 : (Math.sin(lx * 30 + lz * 8) > 0.8 ? 0x5a4028 : null) });
  // firewood pile (right)
  for (let i = 0; i < 7; i++) {
    const row = i < 4 ? 0 : i < 6 ? 1 : 2, idx = row === 0 ? i : row === 1 ? i - 4 : 0;
    const x = 2.5 + (idx - (row === 0 ? 1.5 : row === 1 ? 0.5 : 0)) * 0.17, y = 0.08 + row * 0.14;
    k.add(P.cyl(0.075, 0.08, 0.7, 7), { pos: [x, y, 1.7], rot: [1.57, 0.1 * (R() - 0.5), 0], color: 0x8a6440, jitter: 0.2,
      colorFn: (wx, wy, wz, lx, ly) => Math.abs(ly) > 0.33 ? 0xd8b080 : null });
  }
  // bedroll (left back)
  k.add(P.box(0.8, 0.07, 1.7), { pos: [-2.1, 0.035, -0.6], rot: [0, 0.5, 0], color: 0x7a3a3a, color2: 0xa86a4a, grad: (x, y, z) => Math.abs(Math.sin(z * 9)) > 0.85 ? 1 : 0 });
  k.add(P.cyl(0.18, 0.18, 0.84, 12), { pos: [-2.1 - Math.sin(0.5) * 0.85, 0.18, -0.6 - Math.cos(0.5) * 0.85], rot: [0, 0.5, 1.57], order: 'YXZ', color: 0x5a6a7a, color2: 0x8a3a3a, grad: (x, y, z, lx, ly) => Math.abs(ly) > 0.3 ? 1 : 0 });
  // wicker basket (near the cook)
  const bx = 0.95, bz = 1.25;
  k.add(P.cyl(0.24, 0.19, 0.22, 14, false), { pos: [bx, 0.11, bz], color: 0xb88a50, colorFn: (x, y) => (Math.sin(y * 90) > 0 ? 0xa07840 : null), jitter: 0.12 });
  k.add(P.torus(0.24, 0.025, 5, 16), { pos: [bx, 0.22, bz], rot: [1.57, 0, 0], color: 0x9a7040 });
  k.add(P.torus(0.2, 0.014, 4, 14, Math.PI), { pos: [bx, 0.22, bz], rot: [0, 0.6, 0], color: 0x9a7040 });
  // produce heaped in the basket
  const heap = [['russetpome', 0.06, 0.02], ['russetpome', -0.08, 0.05], ['goldplum', 0.0, -0.08], ['hearthcap', -0.05, -0.04], ['firethorn', 0.1, -0.05]];
  for (const [id, dx, dz] of heap) {
    const it = ITEMS[id];
    if (it.shape === 'fruit') fruit(k, it, 0.95, bx + dx, 0.17, bz + dz);
    else if (it.shape === 'mushroom') mushroom(k, it, bx + dx, bz + dz, 1.1, 0.4, 4);
    else { const m = new THREE.Matrix4().makeRotationZ(0.3).setPosition(bx + dx, 0.22, bz + dz); const kk = new Kit(); pepper(kk, it, 1.3); const g = kk.build(); k.add(g, { matrix: m, keepColors: true }); }
  }
  // a cloth bundle + wooden ladle propped against the bench
  k.add(P.sphere(0.2, 10, 8), { pos: [-0.75, 0.15, -1.75], scl: [1.2, 0.75, 1], color: 0xc8b890, color2: 0x9a8a68, grad: (x, y) => 0.5 - y * 4, jitter: 0.15 });
  k.add(P.cyl(0.015, 0.015, 0.7, 5), { pos: [0.55, 0.32, -1.78], rot: [0.5, 0, -0.35], color: 0xb88a58 });
  k.add(P.sphere(0.05, 8, 6), { pos: [0.67, 0.02, -1.95], scl: [1, 0.5, 1], color: 0xb88a58 });
  return k.build();
}

// lantern: frame + glowing glass (emissive) — hung from the tripod or placed on the bench
export function lanternGeometry() {
  const k = new Kit();
  k.add(P.cyl(0.07, 0.08, 0.02, 8), { pos: [0, 0.01, 0], color: 0x3a3430 });
  k.add(P.cyl(0.055, 0.055, 0.14, 8), { pos: [0, 0.09, 0], color: 0xffc070, emit: 1 });
  for (let i = 0; i < 4; i++) { const a = i * 1.57 + 0.78; k.add(P.cyl(0.007, 0.007, 0.15, 4), { pos: [Math.cos(a) * 0.06, 0.09, Math.sin(a) * 0.06], color: 0x3a3430 }); }
  k.add(P.cone(0.08, 0.06, 8), { pos: [0, 0.19, 0], color: 0x3a3430 });
  k.add(P.torus(0.025, 0.006, 4, 8), { pos: [0, 0.235, 0], color: 0x3a3430 });
  return k.build();
}

// ------------------------------------------------------------------ ore deposit (mineable)
export function oreGeometry(kind, seed = 1) {
  const key = 'ore:' + kind + seed;
  if (cache.has(key)) return cache.get(key);
  const k = new Kit(); const R = rng(seed * 13 + 5);
  const it = ITEMS[kind] || ITEMS.flint;
  k.add(P.rock(0.75, seed, 0.3, 1), { pos: [0, 0.45, 0], scl: [1.1, 0.9, 1], color: 0x8a847a, color2: 0x5a5852, grad: (x, y) => 0.5 - y, flat: true, jitter: 0.12,
    colorFn: (wx, wy, wz, lx, ly, lz) => (Math.abs(Math.sin(lx * 6 + ly * 9 + seed) + Math.sin(lz * 7 - ly * 5)) < 0.25 ? col(it.c) : null) });
  k.add(P.rock(0.4, seed + 3, 0.3, 1), { pos: [0.6, 0.22, 0.3], color: 0x7a766e, flat: true });
  const nc = kind === 'flint' ? 0 : 5;
  for (let i = 0; i < nc; i++) {
    const a = R() * 6.28, el = 0.4 + R() * 0.7;
    crystal(k, it.c, it.c2, Math.cos(a) * 0.55 * Math.cos(el), 0.35 + Math.sin(el) * 0.4, Math.sin(a) * 0.55 * Math.cos(el), 0.25 + R() * 0.2, 0.06 + R() * 0.03, Math.sin(a) * 0.6, -Math.cos(a) * 0.6, 0.35);
  }
  const g = k.build(); cache.set(key, g); return g;
}

// ------------------------------------------------------------------ Windstone Spire (viewpoint tower)
// Slender stone needle wrapped by a pale spiral ribbon, a ring-walk near the top and a floating
// wind crystal. Height ~34 m. Returns {body, crystal} geometries (crystal animates separately).
export function spireGeometry(seed = 1) {
  const k = new Kit(); const R = rng(seed);
  const H = 30;
  // base plinth: stepped octagon
  for (let i = 0; i < 3; i++) k.add(P.cyl(4.2 - i * 0.9, 4.4 - i * 0.9, 0.6, 8), { pos: [0, 0.3 + i * 0.6 - 0.5, 0], rot: [0, 0.39, 0], color: 0xb8ad98, color2: 0x8a8274, grad: (x, y) => 0.5 - y * 2, flat: true, jitter: 0.08 });
  // the needle: stacked tapering drums with slight offsets (hand-built feel)
  const drums = 12;
  for (let i = 0; i < drums; i++) {
    const t0 = i / drums, t1 = (i + 1) / drums;
    const r0 = 2.0 * (1 - t0 * 0.62), r1 = 2.0 * (1 - t1 * 0.62);
    const h = H / drums;
    k.add(P.cyl(r1 * 0.97, r0, h * 0.94, 9), { pos: [(R() - 0.5) * 0.06, 1.3 + h * (i + 0.5), (R() - 0.5) * 0.06], rot: [0, R() * 0.6, 0], color: 0xc9bfa8, color2: 0x9a917f, grad: () => (i % 3 === 0 ? 0.6 : 0.15) + R() * 0.2, flat: true, jitter: 0.07 });
  }
  // spiral ribbon (glowing seam lines run inside it)
  const turns = 2.6, segs = 70;
  for (let i = 0; i < segs; i++) {
    const t = i / segs, a = t * turns * Math.PI * 2, y = 2 + t * (H - 4);
    const r = 2.0 * (1 - (y - 1.3) / H * 0.62) + 0.22;
    const m = new THREE.Matrix4().makeRotationY(-a).setPosition(Math.cos(a) * r, y, Math.sin(a) * r);
    m.multiply(new THREE.Matrix4().makeRotationX(0.28));
    k.add(P.box(0.32, 0.22, 1.15), { matrix: m, color: 0xeee6d2, color2: 0x7ad8e8, grad: (x, yy) => yy < -0.06 ? 1 : 0, emit: (x, yy) => yy < -0.06 ? 0.5 : 0, flat: true, jitter: 0.04 });
  }
  // ring-walk platform near the top + railing posts
  const topY = H + 1.3;
  k.add(P.cyl(2.6, 2.2, 0.5, 12), { pos: [0, topY, 0], color: 0xd8cfba, color2: 0x8a8274, grad: (x, y) => 0.5 - y * 3, flat: true });
  for (let i = 0; i < 12; i++) { const a = i / 12 * 6.28; k.add(P.cyl(0.08, 0.1, 0.9, 5), { pos: [Math.cos(a) * 2.4, topY + 0.7, Math.sin(a) * 2.4], color: 0xbfb6a2 }); }
  k.add(P.torus(2.4, 0.07, 4, 24), { pos: [0, topY + 1.12, 0], rot: [1.57, 0, 0], color: 0xbfb6a2 });
  // pedestal + four curved prongs cradling the crystal
  k.add(P.cyl(0.55, 0.8, 1.0, 8), { pos: [0, topY + 0.75, 0], color: 0xa89e8a, flat: true });
  for (let i = 0; i < 4; i++) {
    const a = i * 1.57 + 0.4;
    for (let j = 0; j < 5; j++) {
      const t = j / 5;
      k.add(P.box(0.18, 0.55, 0.18), { pos: [Math.cos(a) * (0.6 + Math.sin(t * 2.4) * 0.5), topY + 1.4 + t * 2.2, Math.sin(a) * (0.6 + Math.sin(t * 2.4) * 0.5)], rot: [0, -a, Math.cos(t * 2.4) * -0.6], order: 'YXZ', color: 0xcfc6b0, flat: true });
    }
  }
  const body = k.build();
  const kc = new Kit();
  kc.add(P.oct(0.9), { scl: [0.8, 1.6, 0.8], color: 0x7fe0ff, color2: 0xffffff, grad: (x, y) => y + 0.3, flat: true, emit: 0.85 });
  const crystal = kc.build();
  return { body, crystal, height: H, topY, crystalY: topY + 3.0 };
}

// ------------------------------------------------------------------ Summit Beacon
export function beaconGeometry() {
  const k = new Kit(); const R = rng(77);
  for (let i = 0; i < 4; i++) k.add(P.cyl(7 - i * 1.4, 7.3 - i * 1.4, 0.8, 10), { pos: [0, 0.4 + i * 0.8 - 0.6, 0], rot: [0, 0.3, 0], color: 0xb0a690, color2: 0x7f786a, grad: (x, y) => 0.5 - y, flat: true, jitter: 0.1 });
  const top = 2.6;
  // four leaning monoliths
  for (let i = 0; i < 4; i++) {
    const a = i * 1.57 + 0.78;
    k.add(P.box(1.1, 7.5, 0.8), { pos: [Math.cos(a) * 3.4, top + 3.3, Math.sin(a) * 3.4], rot: [0, -a, 0.12], order: 'YXZ', color: 0xc2b8a2, color2: 0x8a8274, grad: (x, y) => 0.4 - y * 0.08, flat: true, jitter: 0.08,
      colorFn: (wx, wy, wz, lx, ly, lz) => (Math.abs(lx) < 0.12 && ly > -2.5 && ly < 2.8 && lz < -0.3 ? 0xffb347 : null), emit: (lx, ly, lz) => (Math.abs(lx) < 0.12 && ly > -2.5 && ly < 2.8 && lz < -0.3 ? 0.6 : 0) });
  }
  // great brazier bowl
  k.add(P.cyl(0.6, 1.0, 1.6, 10), { pos: [0, top + 0.8, 0], color: 0x9a907c, flat: true });
  k.add(P.lathe([[0, 0], [1.0, 0.0], [1.9, 0.5], [2.3, 1.2], [2.2, 1.3], [1.7, 0.75], [0, 0.6]], 16), { pos: [0, top + 1.5, 0], color: 0x6a645c, color2: 0x3a3632, grad: (x, y) => y > 0.7 ? 1 : 0.2, jitter: 0.12 });
  for (let i = 0; i < 16; i++) { const a = i / 16 * 6.28; k.add(P.box(0.25, 0.3, 0.12), { pos: [Math.cos(a) * 2.28, top + 2.75, Math.sin(a) * 2.28], rot: [0, -a, 0], color: 0xd8a040, emit: 0.2 }); }
  // coals
  for (let i = 0; i < 20; i++) { const a = R() * 6.28, r = R() * 1.5; k.add(P.ico(0.2 + R() * 0.15, 0), { pos: [Math.cos(a) * r, top + 2.2, Math.sin(a) * r], color: 0x2a2220, flat: true }); }
  return { geo: k.build(), fireY: top + 2.3 };
}
