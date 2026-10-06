// Enemy camps: trampled-earth clearing, palisade wall sections of sharpened lashed logs,
// horned-skull totems with rag banners, hide tents, a stone-ringed campfire with a roasting
// spit, a lookout tower with ladder and hide canopy, a loot chest, barrels/crates, blast
// barrels and blastcap mushroom bombs. All static parts of a camp merge into ONE mesh
// (+ outline); animated bits (chest lid, fire glow, barrels) are separate.
// Camps also publish simple colliders and AI "stations" (sleep / eat / patrol / tower / guard).
import * as THREE from 'three';
import { Builder, G, mulberry, vnoise3 } from './geo.js';
import { makeToon, makeOutline } from './toon.js';

const BARK = 0x7a5534, BARK_D = 0x553a24, WOOD_CUT = 0xd9b47a, HIDE = 0xc9a477, HIDE_D = 0xa47c52, ROPE = 0xc8ac78;
const BONE = 0xeee2c4, STONE = 0x9a958a, CLOTH_R = 0xb8402f, CHAR = 0x2a211c;

// proxy builder that places a prop at (x, y, z) with yaw inside the camp frame
function placer(b, x, y, z, yaw = 0, s = 1) {
  const M = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(s, s, s));
  return { add: (g, o = {}) => b.add(g, { ...o, matrix: o.matrix ? o.matrix.clone().premultiply(M) : M }) };
}

// sharpened log standing on y=0
function stake(b, h, r, tilt = 0, rotY = 0, rnd = Math.random) {
  const lean = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(tilt, rotY, (rnd() - 0.5) * 0.06));
  const knot = rnd() * 10;
  b.add(G.cyl(r, r * 1.05, h, 6, true), { pos: [0, h / 2, 0], matrix: lean, color: BARK, colorFn: (x, y, z, lx, ly, lz) => Math.sin(ly * 6 + knot + Math.atan2(lx, lz) * 2) > 0.93 ? BARK_D : null, jitter: 0.16 });
  b.add(G.cone(r, r * 2.6, 6), { pos: [0, h + r * 1.3, 0], matrix: lean, color: WOOD_CUT, color2: BARK, grad: (x, y) => 0.5 - y * 2, jitter: 0.1 });
}

export function skull(b, o = {}) {
  const s = o.s ?? 1, y = o.y ?? 0;
  const col = o.color ?? 0xe6d6b0;
  const crack = (x, yy, z, lx, ly, lz) => (Math.abs(vnoise3(lx * 9, ly * 9, lz * 9) - 0.5) < 0.025 ? 0x8a7a5a : null);
  b.add(G.sphere(1, 16, 12), { pos: [0, y + 0.02 * s, -0.04 * s], scl: [0.3 * s, 0.27 * s, 0.32 * s], color: col, colorFn: crack, jitter: 0.12 });
  b.add(G.sphere(1, 12, 8), { pos: [0, y + 0.08 * s, 0.2 * s], scl: [0.28 * s, 0.09 * s, 0.12 * s], color: col, jitter: 0.1 });            // brow
  b.add(G.sphere(1, 12, 10), { pos: [0, y - 0.1 * s, 0.3 * s], scl: [0.16 * s, 0.13 * s, 0.26 * s], color: col, colorFn: crack, jitter: 0.12 }); // snout
  for (const sx of [1, -1]) {
    // deep eye sockets with a faint ember glint
    b.add(G.sphere(1, 10, 8), { pos: [0.12 * sx * s, y + 0.0, 0.24 * s], scl: [0.085 * s, 0.075 * s, 0.07 * s], color: 0x1e1418, jitter: 0 });
    b.add(G.sphere(1, 6, 5), { pos: [0.12 * sx * s, y + 0.0, 0.28 * s], scl: [0.02 * s, 0.02 * s, 0.015 * s], color: 0xff5a2a, emit: 0.6, jitter: 0 });
    b.add(G.sphere(1, 6, 5), { pos: [0.05 * sx * s, y - 0.1 * s, 0.55 * s], scl: [0.03 * s, 0.035 * s, 0.03 * s], color: 0x2a1e1e, jitter: 0 });   // nostrils
    // big ram-curl horns sweeping back and down
    b.add(G.horn(0.75 * s, 0.085 * s, -0.55 * s, 12, 8), { pos: [0.2 * sx * s, y + 0.14 * s, 0.0], rot: [-0.2, 0, -1.25 * sx], color: o.horn ?? 0xcdb88e, color2: 0x6a5a44, grad: (xx, yy) => 1 - yy * 1.8, jitter: 0.05,
      colorFn: (xx, yy, zz, lx, ly, lz) => (Math.sin(ly * 60) > 0.7 ? 0xa8946c : null) });
    b.add(G.cone(0.03 * s, 0.14 * s, 5), { pos: [0.11 * sx * s, y - 0.22 * s, 0.4 * s], rot: [Math.PI - 0.15, 0, 0.1 * sx], color: 0xf2e8cc });  // tusks
  }
  for (let i = -2; i <= 2; i++) b.add(G.cone(0.016 * s, 0.05 * s, 4), { pos: [i * 0.03 * s, y - 0.21 * s, 0.5 * s - Math.abs(i) * 0.03 * s], rot: [Math.PI, 0, 0], color: 0xf2e8cc, jitter: 0 });
}

export function buildCamp(ctx, site, opts = {}) {
  const { world } = ctx;
  const rnd = mulberry(site.seed || 1);
  const cx = site.x, cz = site.z, cy = world.getHeight(cx, cz);
  const R = site.r || 13;
  const ent = site.entrance ?? rnd() * Math.PI * 2;     // entrance direction (radians, world XZ)
  const group = new THREE.Group(); group.name = 'camp'; group.position.set(cx, cy, cz);
  const H = (lx, lz) => world.getHeight(cx + lx, cz + lz) - cy;
  const b = new Builder();
  const colliders = [];
  const stations = { sleep: [], eat: [], patrol: [], tower: null, guard: [], fire: null };
  const dirOf = a => [Math.sin(a), Math.cos(a)];
  const at = (a, r) => { const [sx, sz] = dirOf(a); return [sx * r, sz * r]; };
  const faceCenter = (x, z) => Math.atan2(-x, -z);

  // ---------------------------------------------------------------- campfire
  {
    const p = placer(b, 0, H(0, 0), 0);
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * Math.PI * 2;
      p.add(G.rock(0.17 + rnd() * 0.05, 0, 0.3, i + site.seed), { pos: [Math.cos(a) * 0.62, 0.07, Math.sin(a) * 0.62], scl: [1.2, 0.8, 1], color: STONE, flat: true, jitter: 0.15 });
    }
    // ash bed + charred crossed logs with ember tips
    p.add(G.cyl(0.55, 0.6, 0.06, 12), { pos: [0, 0.02, 0], color: 0x3b3430, jitter: 0.2, colorFn: (x, y, z) => vnoise3(x * 6, 0, z * 6) > 0.62 ? 0xff7a2a : null, emit: (x, y, z) => vnoise3(x * 6 + 0.5, 0, z * 6) > 0.62 ? 0.8 : 0 });
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * Math.PI * 2 + 0.4;
      p.add(G.cyl(0.07, 0.08, 0.95, 6), { pos: [Math.cos(a) * 0.18, 0.2, Math.sin(a) * 0.18], rot: [0, -a, 1.1], order: 'YXZ', color: CHAR, color2: 0xff8a3a, grad: (x, y) => y > 0.35 ? 1 : 0, emit: (x, y) => y > 0.38 ? 0.9 : 0 });
    }
    // roasting spit with a haunch
    for (const sx of [1, -1]) {
      p.add(G.cyl(0.03, 0.035, 1.25, 5), { pos: [0.85 * sx, 0.62, 0], color: BARK });
      p.add(G.cyl(0.025, 0.025, 0.3, 5), { pos: [0.85 * sx + 0.07 * sx, 1.28, 0], rot: [0, 0, 0.6 * sx], color: BARK });
      p.add(G.cyl(0.025, 0.025, 0.3, 5), { pos: [0.85 * sx - 0.07 * sx, 1.28, 0], rot: [0, 0, -0.6 * sx], color: BARK });
    }
    p.add(G.cyl(0.02, 0.02, 1.95, 5), { pos: [0, 1.2, 0], rot: [0, 0, Math.PI / 2], color: 0x6a4a2c });
    p.add(G.lathe([[0, -0.2], [0.11, -0.17], [0.17, -0.05], [0.16, 0.08], [0.09, 0.18], [0.05, 0.24], [0, 0.25]], 10), { pos: [0, 1.16, 0], rot: [0, 0, Math.PI / 2], color: 0x9a5530, color2: 0x5a2a16, grad: (x, y, z) => vnoise3(x * 20, y * 20, z * 20) > 0.6 ? 1 : 0, jitter: 0.15 });
    p.add(G.cyl(0.03, 0.035, 0.22, 6), { pos: [-0.33, 1.16, 0], rot: [0, 0, Math.PI / 2], color: BONE });
    p.add(G.sphere(0.05, 6, 5), { pos: [-0.45, 1.16, 0], color: BONE });
    // log benches around the fire (eat stations)
    for (let i = 0; i < 3; i++) {
      const a = ent + Math.PI * 0.55 + i * 0.95 + (rnd() - 0.5) * 0.2;
      const [x, z] = at(a, 2.25);
      const yaw = faceCenter(x, z);
      const lp = placer(b, x, H(x, z), z, yaw);
      lp.add(G.cyl(0.22, 0.24, 1.5, 9), { pos: [0, 0.2, 0], rot: [0, 0, Math.PI / 2], color: BARK, jitter: 0.15 });
      for (const sx of [1, -1]) lp.add(G.cyl(0.22, 0.22, 0.02, 9), { pos: [0.755 * sx, 0.2, 0], rot: [0, 0, Math.PI / 2], color: WOOD_CUT, colorFn: (xx, yy, zz, lx, ly, lz) => Math.sin(Math.hypot(lx, lz) * 60) > 0.5 ? 0xb88f58 : null });
      const [ex, ez] = at(a, 2.25);
      stations.eat.push({ x: cx + ex, z: cz + ez, yaw, seat: 0.42 });
    }
    stations.fire = { x: cx, z: cz, y: cy + H(0, 0) };
    colliders.push({ type: 'cylinder', x: cx, z: cz, r: 0.75, hy: 0.25, y: cy + 0.25, kind: 'fire' });
  }

  // ---------------------------------------------------------------- tents
  const tents = [];
  for (let i = 0; i < (site.tents ?? 2); i++) {
    const a = ent + Math.PI + (i - ((site.tents ?? 2) - 1) / 2) * 1.25 + (rnd() - 0.5) * 0.2;
    const [x, z] = at(a, R * 0.55);
    const yaw = faceCenter(x, z);
    const p = placer(b, x, H(x, z), z, yaw);
    const L = 2.8, W = 2.4, Ht = 1.9;
    // two slanted hide panels (A-frame), patchwork + stitched seams
    for (const sx of [1, -1]) {
      const ang = Math.atan2(W / 2, Ht);
      p.add(G.box(0.05, Math.hypot(W / 2, Ht) + 0.1, L), { pos: [sx * W / 4, Ht / 2, -0.1], rot: [0, 0, ang * sx], color: HIDE,
        colorFn: (xx, yy, zz, lx, ly, lz) => {
          if (Math.abs(Math.sin(lz * 3.1)) < 0.04 || Math.abs(Math.sin(ly * 2.6 + 1)) < 0.035) return 0x6a4a30;
          return vnoise3(lz * 1.6 + sx * 5, ly * 1.6, 0) > 0.62 ? HIDE_D : (vnoise3(lz * 2 + 9, ly * 2, sx) > 0.7 ? 0xd9bb8c : null);
        }, jitter: 0.08 });
    }
    // back wall + ridge pole + crossed poles poking out
    p.add(G.extrude([[-W / 2, 0], [W / 2, 0], [0, Ht]], 0.05, 0), { pos: [0, 0, -L / 2 - 0.1], color: HIDE_D });
    p.add(G.cyl(0.05, 0.05, L + 0.7, 6), { pos: [0, Ht + 0.03, -0.1], rot: [Math.PI / 2, 0, 0], color: BARK });
    for (const zz of [L / 2 + 0.1, -L / 2 - 0.25]) for (const sx of [1, -1]) p.add(G.cyl(0.045, 0.05, Ht + 0.9, 6), { pos: [sx * 0.28, (Ht + 0.9) / 2 - 0.05, zz], rot: [0, 0, -sx * 0.5], color: BARK });
    // open door flap folded back
    p.add(G.box(0.04, 1.2, 0.8), { pos: [0.85, 0.75, L / 2 - 0.05], rot: [0, 0.9, 0.6], color: HIDE_D });
    // sleeping rug in front + bone trinkets
    p.add(G.cyl(0.9, 0.9, 0.04, 14), { pos: [0, 0.03, L / 2 + 1.1], scl: [1, 1, 0.65], color: 0x8a5a3a, colorFn: (xx, yy, zz, lx, ly, lz) => Math.hypot(lx, lz) > 0.75 ? 0xd9c08a : (Math.sin(lx * 14) > 0.7 ? 0x6a3a28 : null) });
    p.add(G.cyl(0.03, 0.03, 0.4, 5), { pos: [0, Ht + 0.15, L / 2 + 0.3], color: BONE });
    tents.push({ x: cx + x, z: cz + z, yaw });
    const [rx, rz] = [x + Math.sin(yaw) * (L / 2 + 1.1), z + Math.cos(yaw) * (L / 2 + 1.1)];
    stations.sleep.push({ x: cx + rx, z: cz + rz, yaw: yaw + Math.PI / 2 });
    colliders.push({ type: 'box', x: cx + x - Math.sin(yaw) * 0.1, z: cz + z - Math.cos(yaw) * 0.1, y: cy + H(x, z) + Ht / 2, hx: W / 2, hy: Ht / 2, hz: L / 2, rotY: yaw, kind: 'tent' });
  }

  // ---------------------------------------------------------------- lookout tower
  if (site.tower !== false) {
    const a = ent + Math.PI * 0.62 + (rnd() - 0.5) * 0.3;
    const [x, z] = at(a, R * 0.7);
    const yaw = faceCenter(x, z) + Math.PI / 4;
    const y0 = Math.min(H(x - 1, z - 1), H(x + 1, z + 1), H(x - 1, z + 1), H(x + 1, z - 1)) - 0.2;
    const p = placer(b, x, y0, z, yaw);
    const PH = 4.6, S2 = 1.15;
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      // legs lean inward slightly
      const top = [sx * (S2 - 0.12), sz * (S2 - 0.12)], bot = [sx * (S2 + 0.12), sz * (S2 + 0.12)];
      const len = PH + 2.2;
      const rx = Math.atan2(top[1] - bot[1], len) , rz = -Math.atan2(top[0] - bot[0], len);
      p.add(G.cyl(0.13, 0.15, len, 7), { pos: [(top[0] + bot[0]) / 2, len / 2, (top[1] + bot[1]) / 2], rot: [rx, 0, rz], color: BARK, jitter: 0.16 });
    }
    // cross braces on each face
    for (let f = 0; f < 4; f++) {
      const fa = f * Math.PI / 2;
      const fp = placer(p, Math.sin(fa) * (S2 + 0.05), 0, Math.cos(fa) * (S2 + 0.05), fa);
      for (const s of [1, -1]) fp.add(G.cyl(0.06, 0.06, 3.2, 5), { pos: [0, PH * 0.45, 0], rot: [0, 0, s * 0.72], color: BARK_D });
      fp.add(G.cyl(0.07, 0.07, S2 * 2.3, 5), { pos: [0, PH * 0.12, 0], rot: [0, 0, Math.PI / 2], color: BARK_D });
    }
    // platform of planks + railing
    for (let i = -3; i <= 3; i++) p.add(G.box(0.36, 0.1, S2 * 2.5), { pos: [i * 0.37, PH, 0], color: i % 2 ? 0x9a6a3e : 0x8a5d34, jitter: 0.14 });
    for (let f = 0; f < 4; f++) {
      const fa = f * Math.PI / 2;
      const fp = placer(p, Math.sin(fa) * S2 * 1.2, PH, Math.cos(fa) * S2 * 1.2, fa);
      fp.add(G.cyl(0.05, 0.05, S2 * 2.4, 5), { pos: [0, 0.85, 0], rot: [0, 0, Math.PI / 2], color: BARK });
      for (let k = -2; k <= 2; k++) if (f !== 0 || Math.abs(k) > 0) fp.add(G.cyl(0.04, 0.04, 0.9, 5), { pos: [k * 0.55, 0.45, 0], color: BARK });
    }
    // canopy: hide pyramid on the extended legs + banner
    p.add(G.cone(S2 * 2.0, 1.1, 4), { pos: [0, PH + 2.55, 0], rot: [0, Math.PI / 4, 0], color: HIDE, color2: HIDE_D, grad: (xx, yy) => 0.5 - yy, jitter: 0.1 });
    p.add(G.cyl(0.03, 0.03, 1.4, 5), { pos: [0, PH + 3.6, 0], color: BARK });
    p.add(G.box(0.02, 0.5, 0.8), { pos: [0, PH + 3.85, 0.42], color: CLOTH_R, colorFn: (xx, yy, zz, lx, ly, lz) => lz > 0.25 && Math.sin(ly * 30) > 0 ? null : null });
    // ladder on the face toward camp centre
    const lp = placer(p, 0, 0, S2 + 0.25, 0);
    for (const sx of [1, -1]) lp.add(G.cyl(0.045, 0.045, PH + 0.9, 5), { pos: [sx * 0.3, (PH + 0.9) / 2, 0.15], rot: [-0.06, 0, 0], color: BARK });
    for (let k = 0; k < 9; k++) lp.add(G.cyl(0.03, 0.03, 0.62, 5), { pos: [0, 0.35 + k * 0.52, 0.15 - k * 0.03], rot: [0, 0, Math.PI / 2], color: BARK_D });
    stations.tower = { x: cx + x, z: cz + z, y: cy + y0 + PH + 0.05, yaw: faceCenter(x, z) + Math.PI };
    colliders.push({ type: 'box', x: cx + x, z: cz + z, y: cy + y0 + PH / 2, hx: S2 + 0.15, hy: PH / 2, hz: S2 + 0.15, rotY: yaw, kind: 'tower', climbable: true, top: cy + y0 + PH + 0.05 });
  }

  // ---------------------------------------------------------------- palisade wall sections
  const nSec = site.walls ?? 5;
  const gapA = 0.55;                              // entrance half-gap (radians)
  for (let s = 0; s < nSec; s++) {
    const span = (Math.PI * 2 - gapA * 2) / nSec;
    const a0 = ent + gapA + s * span + span * 0.12, a1 = a0 + span * (0.5 + rnd() * 0.18);
    const n = Math.max(4, Math.round((a1 - a0) * R / 0.36));
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = a0 + (a1 - a0) * (i / (n - 1));
      const rr = R + (rnd() - 0.5) * 0.15;
      const [x, z] = at(a, rr);
      const h = 2.2 + rnd() * 0.6;
      const p = placer(b, x, H(x, z) - 0.25, z, 0);
      const sr = 0.16 + rnd() * 0.03;
      stake(p, h + 0.25, sr, (rnd() - 0.5) * 0.04, a, rnd);
      for (const ry of [0.75 + 0.25, 1.75 + 0.25]) p.add(G.torus(sr + 0.014, 0.03, 3, 7), { pos: [0, ry, 0], rot: [Math.PI / 2, 0, 0], scl: [1, 1, 1.6], color: ROPE, jitter: 0 });
      pts.push([x, z, H(x, z)]);
    }
    // two lashed horizontal rails behind the stakes
    for (const ry of [0.75, 1.75]) {
      for (let i = 0; i < pts.length - 1; i++) {
        const [x0, z0, h0] = pts[i], [x1, z1, h1] = pts[i + 1];
        const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, len = Math.hypot(x1 - x0, z1 - z0) + 0.1;
        const yaw = Math.atan2(x1 - x0, z1 - z0);
        const p = placer(b, mx * 0.985, (h0 + h1) / 2 + ry, mz * 0.985, yaw);
        p.add(G.cyl(0.05, 0.05, len, 5), { pos: [0, 0, 0], rot: [Math.PI / 2, 0, 0], color: BARK_D });
      }
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
      colliders.push({ type: 'box', x: cx + (x0 + x1) / 2, z: cz + (z0 + z1) / 2, y: cy + pts[i][2] + 1.2, hx: 0.22, hy: 1.3, hz: Math.hypot(x1 - x0, z1 - z0) / 2 + 0.1, rotY: Math.atan2(x1 - x0, z1 - z0), kind: 'wall' });
    }
    // a sentry post on each side of the entrance
    if (s === 0 || s === nSec - 1) {
      const a = s === 0 ? ent + gapA + 0.15 : ent - gapA - 0.15;
      const [gx, gz] = at(a, R - 2.2);
      stations.guard.push({ x: cx + gx, z: cz + gz, yaw: ent });
    }
  }

  // ---------------------------------------------------------------- skull totems flanking the entrance
  for (const side of [1, -1]) {
    const a = ent + side * (gapA - 0.12);
    const [x, z] = at(a, R + 0.9);
    const p = placer(b, x, H(x, z), z, ent + side * 0.25);
    p.add(G.cyl(0.1, 0.13, 3.8, 7), { pos: [0, 1.9, 0], color: BARK_D, jitter: 0.15 });
    p.add(G.box(0.9, 0.08, 0.08), { pos: [0, 3.0, 0], color: BARK });
    skull(p, { y: 3.55, s: 1.25 });
    // smaller skulls + dangling feathers / rags on the crossbar
    for (const sx of [1, -1]) {
      const sp = placer(p, 0.4 * sx, 2.75, 0.06, 0, 0.45);
      skull(sp, { y: 0, s: 1 });
      p.add(G.box(0.02, 0.7, 0.16), { pos: [0.22 * sx, 2.62, 0.08], rot: [0, 0, 0.12 * sx], color: sx > 0 ? CLOTH_R : 0xe8d9b0 });
      p.add(G.cone(0.04, 0.32, 4), { pos: [0.44 * sx, 2.45, 0.1], rot: [Math.PI, 0, 0.2 * sx], color: 0x2a2a30 });
    }
    // painted war-banner below
    p.add(G.box(0.03, 1.1, 0.6), { pos: [0, 2.2, 0.16], rot: [0, Math.PI / 2, 0], color: CLOTH_R,
      colorFn: (xx, yy, zz, lx, ly, lz) => (Math.hypot(lz, ly - 0.15) < 0.17 && Math.hypot(lz, ly - 0.15) > 0.1) || (Math.abs(lz) < 0.03 && ly < 0.1) ? 0xf0e0b8 : null });
    colliders.push({ type: 'cylinder', x: cx + x, z: cz + z, y: cy + H(x, z) + 1.9, r: 0.2, hy: 1.9, kind: 'totem' });
    // torch post just inside the gate
    const [tx, tz] = at(ent + side * (gapA + 0.05), R - 1.0);
    const tp = placer(b, tx, H(tx, tz), tz, 0);
    tp.add(G.cyl(0.05, 0.07, 2.1, 6), { pos: [0, 1.05, 0], rot: [0, 0, side * 0.06], color: BARK_D });
    tp.add(G.cyl(0.11, 0.07, 0.28, 7), { pos: [side * 0.065, 2.15, 0], color: 0x5a4632, colorFn: (xx, yy, zz, lx, ly) => Math.sin(ly * 60) > 0.3 ? 0x7a6040 : null });
    tp.add(G.cyl(0.1, 0.1, 0.05, 7), { pos: [side * 0.065, 2.3, 0], color: 0xff9a3a, emit: 1 });
    stations.torches = stations.torches || [];
    stations.torches.push({ x: cx + tx + side * 0.065, y: cy + H(tx, tz) + 2.32, z: cz + tz });
  }

  // ---------------------------------------------------------------- clutter: crates, barrels, bones, weapon rack
  const clutter = (a, r, fn) => { const [x, z] = at(a, r); const p = placer(b, x, H(x, z), z, rnd() * 6.28); fn(p, x, z); };
  for (let i = 0; i < 3; i++) clutter(ent + Math.PI + 2.0 + i * 0.25, R * 0.75 + rnd(), (p, x, z) => {
    const s = 0.7 + rnd() * 0.25;
    p.add(G.box(s, s, s), { pos: [0, s / 2, 0], color: 0x9a6e3e, colorFn: (xx, yy, zz, lx, ly, lz) => (Math.abs(lx) > s * 0.42 || Math.abs(ly) > s * 0.42 || Math.abs(lz) > s * 0.42) ? 0x6a4a28 : (Math.abs(lx - lz) < 0.05 ? 0x6a4a28 : null), jitter: 0.1 });
    colliders.push({ type: 'box', x: cx + x, z: cz + z, y: cy + H(x, z) + s / 2, hx: s / 2, hy: s / 2, hz: s / 2, rotY: 0, kind: 'crate' });
  });
  for (let i = 0; i < 2; i++) clutter(ent + Math.PI - 1.9 - i * 0.22, R * 0.72, (p, x, z) => {
    p.add(G.lathe([[0, 0], [0.3, 0], [0.36, 0.25], [0.38, 0.45], [0.36, 0.65], [0.3, 0.9], [0, 0.9]], 12), { color: 0x8a5d34, colorFn: (xx, yy, zz, lx, ly) => (Math.abs(ly - 0.18) < 0.04 || Math.abs(ly - 0.72) < 0.04) ? 0x4a4a52 : null, jitter: 0.1 });
    colliders.push({ type: 'cylinder', x: cx + x, z: cz + z, y: cy + H(x, z) + 0.45, r: 0.38, hy: 0.45, kind: 'barrel' });
  });
  // tall war banners over the wall: red cloth with a bone-white sigil, notched tail
  for (const a of [ent + Math.PI * 0.8, ent - Math.PI * 0.7]) {
    const [x, z] = at(a, R - 0.8);
    const p = placer(b, x, H(x, z), z, a + Math.PI / 2);
    p.add(G.cyl(0.06, 0.08, 5.2, 6), { pos: [0, 2.6, 0], color: BARK_D });
    p.add(G.cyl(0.035, 0.035, 1.3, 5), { pos: [0, 4.95, 0.6], rot: [Math.PI / 2, 0, 0], color: BARK });
    p.add(G.extrude([[0, 0], [1.2, 0], [1.2, -1.7], [0.6, -1.35], [0, -1.7]], 0.02, 0), { pos: [0, 4.95, -0.02], rot: [0, -Math.PI / 2, 0], color: CLOTH_R,
      colorFn: (xx, yy, zz, lx, ly) => { const d = Math.hypot(lx - 0.6, ly + 0.6); return (d < 0.3 && d > 0.2) || (Math.abs(lx - 0.6) < 0.04 && ly < -0.6 && ly > -1.1) ? 0xf0e0b8 : (ly > -0.08 ? 0x8a2a20 : null); } });
    for (let k = 0; k < 3; k++) p.add(G.cone(0.03, 0.22, 4), { pos: [0, 4.88 - k * 0.05, 0.15 + k * 0.45], rot: [Math.PI, 0, 0], color: k % 2 ? 0xf0e0b8 : 0x2a2a30 });
  }
  // hide-drying rack near the tents
  clutter(ent + Math.PI + 1.5, R * 0.62, (p) => {
    for (const sx of [1, -1]) p.add(G.cyl(0.05, 0.06, 1.9, 5), { pos: [0.9 * sx, 0.95, 0], color: BARK });
    p.add(G.cyl(0.04, 0.04, 2.1, 5), { pos: [0, 1.85, 0], rot: [0, 0, Math.PI / 2], color: BARK_D });
    p.add(G.box(0.7, 1.0, 0.03), { pos: [-0.42, 1.3, 0], rot: [0, 0, 0.04], color: 0xb08a5c, colorFn: (xx, yy, zz, lx, ly) => Math.abs(lx) > 0.3 || ly < -0.42 ? 0x8a6640 : null });
    p.add(G.box(0.6, 0.85, 0.03), { pos: [0.4, 1.38, 0], rot: [0, 0, -0.05], color: 0x9a7448, colorFn: (xx, yy, zz, lx, ly) => vnoise3(lx * 9, ly * 9, 0) > 0.66 ? 0x6a4a30 : null });
  });
  clutter(ent + 1.3, R * 0.45, (p) => {   // bone pile
    for (let i = 0; i < 7; i++) p.add(G.cyl(0.04, 0.04, 0.5, 5), { pos: [(rnd() - 0.5) * 0.6, 0.05 + i * 0.03, (rnd() - 0.5) * 0.6], rot: [Math.PI / 2, rnd() * 3, 0], color: BONE });
    skull(placer(p, 0, 0.12, 0, 0.5, 0.35), { y: 0, s: 1 });
  });
  clutter(ent - 1.25, R * 0.5, (p, x, z) => {     // weapon rack with spears leaning on it
    p.add(G.cyl(0.05, 0.05, 1.8, 5), { pos: [0, 1.0, 0], rot: [0, 0, Math.PI / 2], color: BARK });
    for (const sx of [1, -1]) p.add(G.cyl(0.06, 0.06, 1.25, 5), { pos: [0.8 * sx, 0.62, 0], color: BARK });
    for (let i = 0; i < 4; i++) {
      p.add(G.cyl(0.022, 0.022, 2.1, 5), { pos: [-0.55 + i * 0.36, 1.0, 0.18], rot: [0.32, 0, 0], color: 0x7a5a3a });
      p.add(G.cone(0.04, 0.22, 5), { pos: [-0.55 + i * 0.36, 2.07, -0.17], rot: [0.32, 0, 0], color: i % 2 ? BONE : 0xbfc8cc });
    }
  });

  // ---------------------------------------------------------------- trampled earth clearing (terrain-conforming, ragged edge)
  {
    const g = new THREE.BufferGeometry();
    const RINGS = 18, SEG = 64, RR = R + 3;
    const pos = [], idx = [];
    pos.push(0, H(0, 0) + 0.05, 0);
    for (let r = 1; r <= RINGS; r++) for (let s = 0; s < SEG; s++) {
      const a = s / SEG * Math.PI * 2, rr = RR * r / RINGS;
      const x = Math.sin(a) * rr, z = Math.cos(a) * rr;
      pos.push(x, H(x, z) + 0.05, z);
    }
    for (let s = 0; s < SEG; s++) idx.push(0, 1 + s, 1 + (s + 1) % SEG);
    for (let r = 1; r < RINGS; r++) for (let s = 0; s < SEG; s++) {
      const a = 1 + (r - 1) * SEG + s, bb = 1 + (r - 1) * SEG + (s + 1) % SEG, c = 1 + r * SEG + s, d = 1 + r * SEG + (s + 1) % SEG;
      idx.push(a, c, bb, bb, c, d);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // flatten normals toward up so the decal reads like the terrain under it
    const gc = new THREE.Color(), ga = new THREE.Color(0x7d6446), gb = new THREE.Color(0x9a8058), gr = new THREE.Color(0x5f4c38), gg = new THREE.Color(0x7e8a48), gash = new THREE.Color(0x4a3f36);
    b.add(g, { color: 0x8a7050, colorFn: (x, y, z, lx, ly, lz) => {
      const n = vnoise3(lx * 0.3, 0, lz * 0.3), n2 = vnoise3(lx * 1.1 + 4, 0, lz * 1.1), n3 = vnoise3(lx * 3.5, 7, lz * 3.5);
      const d = Math.hypot(lx, lz);
      gc.copy(ga).lerp(gb, Math.min(1, Math.max(0, (n2 - 0.35) * 2.2)));       // dry pale patches
      gc.lerp(gr, Math.max(0, 0.42 - n) * 1.6);                                   // trodden ruts
      gc.lerp(gash, Math.max(0, 1 - d / 2.4));                                    // ash ring at the fire
      gc.lerp(gg, Math.max(0, (d / RR - 0.62) * 2.4) * (0.4 + n3 * 0.6));        // grass creeping back in
      gc.multiplyScalar(0.9 + n3 * 0.2);
      return gc.getHex();
    }, emit: (lx, ly, lz) => -Math.pow(Math.min(1, Math.hypot(lx, lz) / RR), 3) * 1.05, jitter: 0.14 });
  }

  for (let i = 0; i < 40; i++) {
    const a = rnd() * Math.PI * 2, r = 2 + rnd() * (R - 1.5);
    const x = Math.sin(a) * r, z = Math.cos(a) * r;
    b.add(G.rock(0.05 + rnd() * 0.08, 0, 0.35, i), { pos: [x, H(x, z) + 0.02, z], scl: [1, 0.55, 1], color: 0x9a948a, flat: true, jitter: 0.2 });
  }
  // ---------------------------------------------------------------- merge static
  const geo = b.build();
  const mat = makeToon(ctx, { rim: 0.6, shadowAmt: 0.9, emitColor: 0xffc890 });
  const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true; mesh.receiveShadow = true;
  const outline = new THREE.Mesh(geo, makeOutline(ctx, { width: 0.0016, color: 0x2a2018 }));
  group.add(mesh, outline);

  // fire glow on the ground + flame core sprite
  const glowMat = new THREE.MeshBasicMaterial({ map: opts.glowTex, color: 0xff8a3a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55, fog: true });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), glowMat); glow.rotation.x = -Math.PI / 2; glow.position.set(0, H(0, 0) + 0.12, 0); glow.renderOrder = 4;
  group.add(glow);
  const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: opts.glowTex, color: 0xffa040, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.85 }));
  core.position.set(0, H(0, 0) + 0.55, 0); core.scale.set(1.8, 2.4, 1); group.add(core);

  // loot chest (lid animates open when the camp is cleared)
  const chest = (() => {
    const a = ent + Math.PI + 0.5;
    const [x, z] = at(a, R * 0.32);
    const yaw = faceCenter(x, z);
    const cb = new Builder();
    cb.add(G.box(1.0, 0.55, 0.65), { pos: [0, 0.28, 0], color: 0x8a5a2e, colorFn: (xx, yy, zz, lx, ly, lz) => (Math.abs(lx) > 0.42 || Math.abs(lx) < 0.04) ? 0x3e3a3c : (Math.abs(ly - 0.0) < 0.02 ? 0x5a3a20 : null), jitter: 0.08 });
    const bodyG = cb.build();
    cb.add(G.cyl(0.33, 0.33, 1.0, 10, false), { pos: [0, 0, 0.33], rot: [0, 0, Math.PI / 2], scl: [1, 1, 1], color: 0x9a6a36, colorFn: (xx, yy, zz, lx, ly, lz) => (Math.abs(ly) > 0.42 || Math.abs(ly) < 0.05) ? 0x3e3a3c : null });
    cb.add(G.box(0.12, 0.16, 0.06), { pos: [0, -0.05, 0.68], color: 0xd8a84a });
    const lidG = cb.build();
    const cmat = makeToon(ctx, { rim: 0.9 }), cout = makeOutline(ctx, { width: 0.0018 });
    const grp = new THREE.Group(); grp.position.set(x, H(x, z), z); grp.rotation.y = yaw;
    const body = new THREE.Mesh(bodyG, cmat); body.castShadow = true;
    const lid = new THREE.Group(); lid.position.set(0, 0.55, -0.33);
    const lm = new THREE.Mesh(lidG, cmat); lm.castShadow = true; lm.scale.set(1, 0.42, 1); lm.position.set(0, 0, 0);
    lid.add(lm, new THREE.Mesh(lidG, cout)); lid.children[1].scale.copy(lm.scale);
    grp.add(body, new THREE.Mesh(bodyG, cout), lid);
    group.add(grp);
    colliders.push({ type: 'box', x: cx + x, z: cz + z, y: cy + H(x, z) + 0.4, hx: 0.5, hy: 0.4, hz: 0.33, rotY: yaw, kind: 'chest' });
    return { group: grp, lid, x: cx + x, z: cz + z, opened: false, openT: 0, mat: cmat };
  })();

  // patrol loop: inside the palisade, through the entrance area
  for (let i = 0; i < 6; i++) {
    const a = ent + i / 6 * Math.PI * 2 + 0.3;
    const [x, z] = at(a, R * 0.78);
    stations.patrol.push({ x: cx + x, z: cz + z });
  }

  return { group, mesh, outline, material: mat, x: cx, y: cy, z: cz, r: R, entrance: ent, colliders, stations, chest, glow, core, tents, site,
    blastSpots: [at(ent + Math.PI - 1.6, R * 0.6), at(ent + 0.9, R * 0.62)].map(([x, z]) => ({ x: cx + x, z: cz + z })) };
}

// ---------------------------------------------------------------- explosive props (shared geometry)
let blastBarrelGeo = null, blastcapGeo = null;
export function blastBarrelGeometry() {
  if (blastBarrelGeo) return blastBarrelGeo;
  const b = new Builder();
  b.add(G.lathe([[0, 0], [0.3, 0], [0.36, 0.25], [0.38, 0.45], [0.36, 0.65], [0.3, 0.9], [0, 0.9]], 14), { color: 0xb8402f,
    colorFn: (x, y, z, lx, ly, lz) => {
      if (Math.abs(ly - 0.18) < 0.04 || Math.abs(ly - 0.72) < 0.04) return 0x3a3236;
      // painted flame glyph on two sides
      const a = Math.atan2(lx, lz);
      if (Math.abs(Math.sin(a)) < 0.35 && ly > 0.3 && ly < 0.6 && Math.abs(Math.sin(a * 2) * 0.2 - (ly - 0.45)) < 0.06) return 0xf3d27a;
      return null;
    }, jitter: 0.08 });
  b.add(G.cyl(0.05, 0.05, 0.08, 6), { pos: [0.12, 0.93, 0], color: 0x3a3236 });
  blastBarrelGeo = b.build();
  return blastBarrelGeo;
}
// blastcap: an original volatile puffball mushroom used as a kickable/throwable bomb
export function blastcapGeometry() {
  if (blastcapGeo) return blastcapGeo;
  const b = new Builder();
  b.add(G.cyl(0.07, 0.09, 0.16, 7), { pos: [0, 0.08, 0], color: 0xe8dcc0 });
  b.add(G.sphere(1, 14, 10), { pos: [0, 0.24, 0], scl: [0.22, 0.19, 0.22], color: 0xe2572a, color2: 0xffa040, grad: (x, y) => -y * 6 + 0.2,
    colorFn: (x, y, z, lx, ly, lz) => vnoise3(lx * 26, ly * 26, lz * 26) > 0.7 ? 0xfff0b0 : null, emit: (lx, ly, lz) => vnoise3(lx * 26, ly * 26, lz * 26) > 0.7 ? 0.7 : 0, jitter: 0.05 });
  blastcapGeo = b.build();
  return blastcapGeo;
}
