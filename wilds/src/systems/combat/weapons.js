// Weapon catalogue + procedural weapon models (all original designs).
// Weapon local frame: grip at the origin, blade/shaft along +Z, edge facing +Y.
// Bows: limbs along +Z/-Z, string offset towards +Y. Shields: face normal along -Y.
import * as THREE from 'three';
import { Builder, G } from './geo.js';
import { makeToon, makeOutline } from './toon.js';

const STEEL = 0xc9d3d6, STEEL_D = 0x8d9aa0, LEATHER = 0x6b4128, WOOD = 0x8a5a32, WOOD_D = 0x5e3a20, BONE = 0xece0c0, BRASS = 0xd8a84a;

export const WEAPONS = {
  wayfarer_blade: { name: "Wayfarer's Blade", type: 'sword', dmg: 5, dur: 26, reach: 1.9, tier: 2 },
  gnarl_cleaver:  { name: 'Gnarl Cleaver', type: 'sword', dmg: 4, dur: 14, reach: 1.8, tier: 1 },
  ember_saber:    { name: 'Ember Saber', type: 'sword', dmg: 9, dur: 22, reach: 2.0, tier: 4, element: 'fire' },
  thorn_spear:    { name: 'Thornwood Spear', type: 'spear', dmg: 4, dur: 22, reach: 2.8, tier: 2 },
  gnarl_pike:     { name: 'Fang Pike', type: 'spear', dmg: 3, dur: 12, reach: 2.6, tier: 1 },
  spiked_bough:   { name: 'Spiked Bough', type: 'club', dmg: 6, dur: 12, reach: 2.2, tier: 1 },
  boulder_maul:   { name: 'Boulder Maul', type: 'club', dmg: 11, dur: 18, reach: 2.3, tier: 3 },
  warden_hammer:  { name: "Warden's Knuckle", type: 'club', dmg: 18, dur: 30, reach: 2.5, tier: 5 },
  ash_bow:        { name: 'Ashwood Bow', type: 'bow', dmg: 4, dur: 30, tier: 2 },
  horn_bow:       { name: 'Hornbone Bow', type: 'bow', dmg: 5, dur: 20, tier: 2 },
  bark_shield:    { name: 'Barkplate Shield', type: 'shield', dmg: 0, dur: 14, tier: 1 },
  shell_shield:   { name: 'Carapace Shield', type: 'shield', dmg: 0, dur: 28, tier: 3 },
};
for (const [id, d] of Object.entries(WEAPONS)) d.id = id;

let uid = 1;
export function makeWeapon(id, dur) {
  const def = WEAPONS[id];
  if (!def) return null;
  return { uid: uid++, id, def, dur: dur ?? def.dur, maxDur: def.dur };
}

// ---------------------------------------------------------------- models
function blade(b, len, w, color, o = {}) {
  // tapered, slightly leaf-shaped blade with a fuller line, extruded thin
  const pts = [[-w * 0.5, 0], [-w * 0.55, len * 0.35], [-w * 0.45, len * 0.8], [0, len], [w * 0.45, len * 0.8], [w * 0.55, len * 0.35], [w * 0.5, 0]];
  const g = G.extrude(pts, o.depth ?? 0.018, 0.006);
  // shape in XY: rotate so length goes +Z and width is Y (edge up)
  b.add(g, { pos: [0, 0, o.z0 ?? 0], rot: [Math.PI / 2, Math.PI / 2, 0], color, color2: o.edge ?? 0xf4fbff,
    grad: (x, y) => Math.abs(x) > w * 0.32 ? 1 : 0, emit: o.emit ?? 0, jitter: 0.04 });
  if (o.fuller !== false) b.add(G.box(0.006, w * 0.18, len * 0.6), { pos: [0, 0, (o.z0 ?? 0) + len * 0.38], color: STEEL_D, jitter: 0 });
}
function grip(b, len, r = 0.022, color = LEATHER) {
  b.add(G.cyl(r, r, len, 8), { pos: [0, 0, -len * 0.3], rot: [Math.PI / 2, 0, 0], color, colorFn: (x, y, z) => (Math.sin(z * 120) > 0.6 ? 0x4a2c1a : null) });
}

const BUILD = {
  wayfarer_blade(b) {
    grip(b, 0.22, 0.022, 0x2f5c5e);
    b.add(G.sphere(0.035, 8, 6), { pos: [0, 0, -0.2], color: BRASS });
    b.add(G.box(0.05, 0.26, 0.05), { pos: [0, 0, 0.06], color: BRASS, color2: 0xa0742a, grad: (x, y) => Math.abs(y) * 4 });
    b.add(G.sphere(0.03, 8, 6), { pos: [0, 0, 0.07], color: 0x3fd0c0, emit: 0.6 });
    blade(b, 0.82, 0.075, STEEL, { z0: 0.08 });
  },
  gnarl_cleaver(b) {
    grip(b, 0.24, 0.026, 0x5a3a22);
    b.add(G.cyl(0.04, 0.04, 0.04, 6), { pos: [0, 0, 0.04], rot: [Math.PI / 2, 0, 0], color: 0x3a2a22 });
    // chunky bone slab with jagged tooth edge
    const pts = [[-0.03, 0], [-0.05, 0.42], [0.02, 0.62], [0.16, 0.6], [0.13, 0.5], [0.16, 0.42], [0.12, 0.34], [0.15, 0.25], [0.11, 0.16], [0.13, 0.06], [0.04, 0]];
    b.add(G.extrude(pts, 0.03, 0.008), { pos: [0, 0, 0.06], rot: [Math.PI / 2, Math.PI / 2, 0], color: BONE, color2: 0x9a8a6a, grad: (x, y) => 1 - x * 7, jitter: 0.1 });
    b.add(G.cyl(0.012, 0.012, 0.06, 5), { pos: [0, 0.05, 0.3], rot: [0, 0, Math.PI / 2], color: 0x3a2a22 });
  },
  ember_saber(b) {
    grip(b, 0.22, 0.022, 0x3a1e1a);
    b.add(G.torus(0.06, 0.015, 6, 12, Math.PI), { pos: [0, 0.02, 0.05], rot: [0, Math.PI / 2, 0], color: BRASS });
    // curved blade: series of short tapered boxes along an arc
    for (let i = 0; i < 10; i++) {
      const t = i / 10, z = 0.1 + t * 0.85, y = Math.sin(t * 1.4) * 0.08 * t;
      b.add(G.box(0.014, 0.07 * (1 - t * 0.55), 0.1), { pos: [0, y, z], rot: [-t * 0.35, 0, 0], color: 0xd9dbd8, color2: 0xff9a3a, grad: (x, yy) => yy > 0.015 ? 1 : 0, emit: v => 0, jitter: 0 });
    }
    b.add(G.box(0.006, 0.012, 0.86), { pos: [0, 0.035, 0.53], rot: [-0.18, 0, 0], color: 0xffa040, emit: 1, jitter: 0 });
  },
  thorn_spear(b) {
    b.add(G.cyl(0.024, 0.026, 2.0, 7), { pos: [0, 0, 0.35], rot: [Math.PI / 2, 0, 0], color: WOOD, colorFn: (x, y, z) => Math.sin(z * 9) > 0.92 ? WOOD_D : null });
    b.add(G.cyl(0.03, 0.03, 0.16, 8), { pos: [0, 0, 0], rot: [Math.PI / 2, 0, 0], color: LEATHER });
    b.add(G.cyl(0.032, 0.032, 0.06, 8), { pos: [0, 0, 1.3], rot: [Math.PI / 2, 0, 0], color: 0x2f5c5e });
    const pts = [[-0.045, 0], [-0.06, 0.12], [0, 0.34], [0.06, 0.12], [0.045, 0]];
    b.add(G.extrude(pts, 0.02, 0.006), { pos: [0, 0, 1.34], rot: [Math.PI / 2, Math.PI / 2, 0], color: STEEL, color2: 0xf4fbff, grad: (x) => Math.abs(x) > 0.03 ? 1 : 0, jitter: 0.04 });
    // thorn barbs
    for (let i = 0; i < 4; i++) b.add(G.cone(0.012, 0.06, 4), { pos: [0, (i % 2 ? 1 : -1) * 0.03, 0.9 + i * 0.1], rot: [(i % 2 ? -1 : 1) * 1.1, 0, 0], color: WOOD_D });
  },
  gnarl_pike(b) {
    b.add(G.cyl(0.026, 0.03, 1.9, 6), { pos: [0, 0, 0.32], rot: [Math.PI / 2, 0, 0], color: 0x7a5a3a });
    b.add(G.cone(0.05, 0.36, 5), { pos: [0, 0, 1.42], rot: [Math.PI / 2, 0, 0], color: BONE, jitter: 0.12, flat: true });
    b.add(G.cyl(0.04, 0.04, 0.1, 6), { pos: [0, 0, 1.22], rot: [Math.PI / 2, 0, 0], color: 0x3a2a22 });
    for (let i = 0; i < 3; i++) b.add(G.box(0.01, 0.08, 0.14), { pos: [0.02 * (i - 1), -0.05, 1.15 - i * 0.03], rot: [0.3, 0, (i - 1) * 0.4], color: [0xc04a3a, 0xf0e0b0, 0x2a2a2a][i] }); // rag tassels
  },
  spiked_bough(b) {
    b.add(G.cyl(0.04, 0.085, 1.1, 8), { pos: [0, 0, 0.42], rot: [Math.PI / 2, 0, 0], color: WOOD, colorFn: (x, y, z) => Math.sin(z * 14 + x * 30) > 0.85 ? WOOD_D : null });
    b.add(G.cyl(0.042, 0.042, 0.22, 8), { pos: [0, 0, -0.05], rot: [Math.PI / 2, 0, 0], color: LEATHER });
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4, z = 0.55 + (i % 3) * 0.13;
      b.add(G.cone(0.02, 0.1, 4), { pos: [Math.cos(a) * 0.075, Math.sin(a) * 0.075, z], rot: [0, 0, a - Math.PI / 2], color: BONE });
    }
  },
  boulder_maul(b) {
    b.add(G.cyl(0.035, 0.04, 1.25, 7), { pos: [0, 0, 0.42], rot: [Math.PI / 2, 0, 0], color: WOOD });
    b.add(G.cyl(0.042, 0.042, 0.3, 8), { pos: [0, 0, 0.0], rot: [Math.PI / 2, 0, 0], color: LEATHER });
    b.add(G.rock(0.22, 1, 0.25, 4), { pos: [0, 0, 1.1], scl: [1.1, 0.9, 1.25], color: 0x9a9286, jitter: 0.12 });
    b.add(G.torus(0.13, 0.02, 5, 12), { pos: [0, 0, 0.95], color: 0x5a3a22 });
    b.add(G.torus(0.1, 0.018, 5, 12), { pos: [0, 0, 1.25], rot: [0.3, 0.2, 0], color: 0x5a3a22 });
  },
  warden_hammer(b) {
    b.add(G.cyl(0.05, 0.06, 1.3, 8), { pos: [0, 0, 0.45], rot: [Math.PI / 2, 0, 0], color: 0x6f6a60, flat: true });
    b.add(G.box(0.36, 0.3, 0.34), { pos: [0, 0, 1.2], color: 0x9c9584, flat: true, colorFn: (x, y, z, lx, ly) => ly > 0.12 ? 0x6f9c3a : null });
    b.add(G.box(0.38, 0.05, 0.06), { pos: [0, 0.0, 1.38], color: 0xffb24a, emit: 1, jitter: 0 });
    b.add(G.box(0.38, 0.05, 0.06), { pos: [0, 0.0, 1.02], color: 0xffb24a, emit: 1, jitter: 0 });
  },
  ash_bow(b) { bowBody(b, 0xa8774a, 0x2f5c5e, 0.72); },
  horn_bow(b) { bowBody(b, BONE, 0x7a2c2c, 0.66); },
  bark_shield(b) {
    // round shield of lashed planks: face normal -Y, rim band, crossed straps, iron boss
    b.add(G.cyl(0.31, 0.31, 0.04, 20), { pos: [0, 0, 0], color: WOOD, colorFn: (x, y, z, lx, ly, lz) => {
      const plank = Math.floor((lx + 0.31) / 0.124);
      if (Math.abs(((lx + 0.31) % 0.124) - 0.062) > 0.056) return WOOD_D;
      return plank % 2 ? 0x9a6a3a : null;
    }, jitter: 0.1 });
    b.add(G.torus(0.31, 0.022, 5, 24), { rot: [Math.PI / 2, 0, 0], color: 0x6b6f72 });
    b.add(G.box(0.62, 0.012, 0.05), { pos: [0, -0.024, 0], rot: [0, 0.6, 0], color: LEATHER });
    b.add(G.box(0.62, 0.012, 0.05), { pos: [0, -0.024, 0], rot: [0, -0.6, 0], color: LEATHER });
    b.add(G.sphere(0.075, 12, 8), { pos: [0, -0.03, 0], scl: [1, 0.55, 1], color: 0x8a9094 });
    b.add(G.cyl(0.03, 0.03, 0.02, 8), { pos: [0, -0.07, 0], color: 0xd8a84a });
  },
  shell_shield(b) {
    b.add(G.sphere(0.36, 16, 10), { pos: [0, 0.1, 0], scl: [1, 0.35, 1.15], color: 0x2a4f6e, color2: 0x4fa3a6, grad: (x, y, z) => -y * 4 + 0.3,
      colorFn: (x, y, z) => Math.abs(Math.sin(z * 18)) < 0.1 ? 0x1b2530 : null });
    b.add(G.cone(0.04, 0.12, 6), { pos: [0, -0.04, 0], rot: [Math.PI, 0, 0], color: 0x1e2430 });
  },
};
function bowBody(b, color, wrap, half) {
  // recurve limbs: tapered segments along an arc in the YZ plane (bulging to -Y)
  const N = 7;
  for (const s of [1, -1]) {
    for (let i = 0; i < N; i++) {
      const t0 = i / N, t1 = (i + 1) / N;
      const z0 = s * t0 * half, z1 = s * t1 * half;
      const y0 = -Math.sin(t0 * 1.3) * 0.12 + Math.max(0, t0 - 0.8) * 0.4, y1 = -Math.sin(t1 * 1.3) * 0.12 + Math.max(0, t1 - 0.8) * 0.4;
      const len = Math.hypot(z1 - z0, y1 - y0);
      const r = 0.022 * (1 - t0 * 0.5);
      b.add(G.cyl(r * 0.8, r, len, 6), { pos: [0, (y0 + y1) / 2, (z0 + z1) / 2], rot: [Math.atan2(z1 - z0, y1 - y0), 0, 0], color });
    }
  }
  b.add(G.cyl(0.03, 0.03, 0.16, 8), { pos: [0, -0.005, 0], rot: [Math.PI / 2, 0, 0], color: wrap });
  // string drawn as a thin box from tip to tip
  b.add(G.box(0.006, 0.006, half * 2 * 0.98), { pos: [0, 0.04 + 0.0, 0], color: 0xf3ead2, jitter: 0 });
}

const geoCache = new Map();
export function weaponGeometry(id) {
  if (geoCache.has(id)) return geoCache.get(id);
  const b = new Builder();
  (BUILD[id] || BUILD.wayfarer_blade)(b);
  const g = b.build();
  geoCache.set(id, g);
  return g;
}

// A renderable weapon: mesh + outline, its own material (for the low-durability pulse)
export function buildWeaponMesh(ctx, id) {
  const geo = weaponGeometry(id);
  const mat = makeToon(ctx, { rim: 1.3, emitColor: 0xffffff });
  const out = makeOutline(ctx, { width: 0.0018, color: 0x1d1a22, dissolve: mat.uniforms.uDissolve });
  const g = new THREE.Group();
  const m = new THREE.Mesh(geo, mat); m.castShadow = true;
  const o = new THREE.Mesh(geo, out);
  g.add(m, o);
  g.userData = { mat, weaponId: id };
  // tip/base in local space (for trails + hit sampling)
  const def = WEAPONS[id];
  const bb = geo.boundingBox;
  g.userData.tipZ = def.type === 'bow' || def.type === 'shield' ? 0 : bb.max.z;
  g.userData.baseZ = def.type === 'spear' ? bb.max.z - 0.5 : Math.max(0.1, bb.max.z * 0.25);
  return g;
}

// Arrow geometry (shared by player + archers): shaft along +Z, tip at z=+0.8
let arrowGeo = null;
export function arrowGeometry() {
  if (arrowGeo) return arrowGeo;
  const b = new Builder();
  b.add(G.cyl(0.011, 0.011, 0.8, 5), { pos: [0, 0, 0.4], rot: [Math.PI / 2, 0, 0], color: 0xc8a06a, jitter: 0 });
  b.add(G.cone(0.03, 0.09, 5), { pos: [0, 0, 0.84], rot: [Math.PI / 2, 0, 0], color: STEEL, jitter: 0 });
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * Math.PI * 2;
    b.add(G.box(0.004, 0.05, 0.14), { pos: [Math.cos(a) * 0.022, Math.sin(a) * 0.022, 0.07], rot: [0, 0, a + Math.PI / 2], color: i ? 0xf0ead8 : 0xc4502b, jitter: 0 });
  }
  arrowGeo = b.build();
  return arrowGeo;
}
