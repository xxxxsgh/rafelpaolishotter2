// Procedural creature models. Every creature is ONE rigidly-skinned mesh (parts glued to
// bones) + an inverted-hull outline sharing the skeleton: 2 draw calls per creature.
// Model space: feet at y=0, facing +Z, creature's left = +X.
//
// Roster (all original designs):
//   Gnarl       squat, horned, big-eared camp raider. Tiers: moss, ember, dusk, bone.
//   Shellback   hunched beetle brute: domed carapace, single forward horn, mandibles, plated fists.
//   Stonewarden moss-grown ancient construct: floating boulder arms, glowing amber core + visor.
//   Wisp        floating elemental orb (ember / frost / storm) — custom glow shader, no rig.
import * as THREE from 'three';
import { Builder, G, vnoise3, mulberry } from './geo.js';
import { makeToon, makeOutline } from './toon.js';

export const RIG = ['root', 'hips', 'chest', 'head', 'jaw', 'uArmL', 'fArmL', 'handL', 'uArmR', 'fArmR', 'handR', 'thighL', 'shinL', 'thighR', 'shinR', 'tail'];
export const B = Object.fromEntries(RIG.map((n, i) => [n, i]));
const PARENT = { hips: 'root', chest: 'hips', head: 'chest', jaw: 'head', uArmL: 'chest', fArmL: 'uArmL', handL: 'fArmL',
  uArmR: 'chest', fArmR: 'uArmR', handR: 'fArmR', thighL: 'hips', shinL: 'thighL', thighR: 'hips', shinR: 'thighR', tail: 'hips' };

export const GNARL_TIERS = {
  moss:  { skin: 0x8fae4a, belly: 0xd8d08a, snout: 0xb3b860, horn: 0xeee0bd, cloth: 0x7a5232, hair: 0x3b3326, eye: 0xffd24a, hp: 6, dmg: 1, speed: 1.0, scale: 1.0 },
  ember: { skin: 0xd9663b, belly: 0xf0c08a, snout: 0xe48a5f, horn: 0xf3e6c4, cloth: 0x4d3b2a, hair: 0x2c1d17, eye: 0xfff09a, hp: 10, dmg: 2, speed: 1.05, scale: 1.04 },
  dusk:  { skin: 0x6c63b8, belly: 0xc7b9e0, snout: 0x8a7fcf, horn: 0xf1dcae, cloth: 0x9a3b35, hair: 0x1d1b2a, eye: 0x9fffe0, hp: 18, dmg: 3, speed: 1.1, scale: 1.08 },
  bone:  { skin: 0xe8e0cc, belly: 0xf6f0de, snout: 0xd8cbb0, horn: 0x2a2526, cloth: 0x2d3a46, hair: 0x5a1f22, eye: 0xff5a3c, hp: 30, dmg: 4, speed: 1.12, scale: 1.12, stripes: 0x4a3a3e },
};

function makeSkeleton(J) {
  const bones = RIG.map(n => { const b = new THREE.Bone(); b.name = n; return b; });
  for (let i = 0; i < RIG.length; i++) {
    const n = RIG[i], p = PARENT[n];
    const jp = J[n] || J[p] || [0, 0, 0];
    if (p) {
      const pp = J[p];
      bones[i].position.set(jp[0] - pp[0], jp[1] - pp[1], jp[2] - pp[2]);
      bones[B[p]].add(bones[i]);
    } else bones[i].position.set(jp[0], jp[1], jp[2]);
  }
  return bones;
}

// wraps builder output into a skinned creature
function finishCreature(ctx, b, J, opts) {
  const geo = b.build({ skin: true });
  const bones = makeSkeleton(J);
  const root = new THREE.Group();
  const model = new THREE.Group();        // squash / tilt / death tumble
  root.add(model);
  const mat = makeToon(ctx, { rim: opts.rim ?? 1.1, emitColor: opts.emitColor ?? 0xffffff });
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.add(bones[0]);
  model.add(mesh);
  mesh.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  mesh.bind(skeleton);
  mesh.castShadow = true; mesh.receiveShadow = true;
  const outMat = makeOutline(ctx, { width: opts.outline ?? 0.0026, color: opts.ink ?? 0x1f1820, dissolve: mat.uniforms.uDissolve });
  const outline = new THREE.SkinnedMesh(geo, outMat);
  outline.bind(skeleton, mesh.bindMatrix);
  model.add(outline);
  const r = opts.boundR ?? 2;
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, r * 0.5, 0), r);
  outline.boundingSphere = mesh.boundingSphere;
  const bmap = Object.fromEntries(RIG.map((n, i) => [n, bones[i]]));
  // weapon socket in the right hand: blade along local +Z when the arm hangs (see weapons.js)
  const socketR = new THREE.Object3D(); socketR.position.set(...(opts.socket || [0, -0.06, 0.02])); bmap.handR.add(socketR);
  const socketL = new THREE.Object3D(); socketL.position.set(-(opts.socket || [0, -0.06, 0.02])[0], (opts.socket || [0, -0.06, 0.02])[1], 0.02); bmap.handL.add(socketL);
  const head = new THREE.Object3D(); head.position.set(0, opts.headTop ?? 0.4, 0); bmap.head.add(head);
  // rest pose rotations (bind pose = zero)
  return { root, model, mesh, outline, bones: bmap, boneList: bones, material: mat, outlineMat: outMat, socketR, socketL, headTop: head, J };
}

// ---------------------------------------------------------------- GNARL
export function buildGnarl(ctx, tierName = 'moss', seed = 1) {
  const T = GNARL_TIERS[tierName] || GNARL_TIERS.moss;
  const rnd = mulberry(seed * 7919 + 13);
  const J = {
    root: [0, 0, 0], hips: [0, 0.52, 0], chest: [0, 0.7, 0.01], head: [0, 1.0, 0.06], jaw: [0, 0.98, 0.2],
    uArmL: [0.3, 0.9, 0.02], fArmL: [0.36, 0.66, 0.04], handL: [0.38, 0.44, 0.07],
    thighL: [0.15, 0.5, 0], shinL: [0.17, 0.27, 0.03], tail: [0, 0.5, -0.2],
  };
  for (const k of ['uArm', 'fArm', 'hand', 'thigh', 'shin']) { const p = J[k + 'L']; J[k + 'R'] = [-p[0], p[1], p[2]]; }
  const b = new Builder();
  const mottle = new THREE.Color(T.skin).multiplyScalar(0.8).getHex();
  const skinFn = (stripeCol) => (x, y, z, lx, ly, lz) => {
    // painterly mottling + optional war-paint stripes for the bone tier
    if (stripeCol && Math.sin(y * 26 + Math.sin(x * 9) * 1.4) > 0.72) return stripeCol;
    if (vnoise3(x * 11 + seed, y * 11, z * 11) > 0.74) return mottle;
    return null;
  };
  const S = T.skin;
  // --- torso: pear-shaped belly
  b.add(G.sphere(1, 18, 14), { pos: [0, 0.68, 0.0], scl: [0.34, 0.36, 0.31], color: S, color2: T.belly, grad: (x, y, z) => (z > 0.2 ? (z - 0.2) * 1.6 : 0) * (y < 0.4 ? 1 : 0.4), bone: B.chest, colorFn: skinFn(T.stripes) });
  b.add(G.sphere(1, 16, 12), { pos: [0, 0.82, -0.04], scl: [0.32, 0.22, 0.27], color: S, bone: B.chest, colorFn: skinFn(T.stripes) });
  // shoulder hump + mane spikes down the back
  for (let i = 0; i < 6; i++) {
    const a = (i / 5 - 0.5) * 1.6;
    b.add(G.cone(0.05, 0.2 + rnd() * 0.08, 5), { pos: [Math.sin(a) * 0.12, 0.98 - i * 0.045, -0.12 - i * 0.03], rot: [-0.9 - i * 0.12, 0, Math.sin(a) * 0.5], color: T.hair, bone: B.chest, jitter: 0.2 });
  }
  // loincloth + belt
  b.add(G.cyl(0.29, 0.33, 0.08, 14), { pos: [0, 0.54, 0], color: 0x5a3d26, bone: B.hips });
  b.add(G.cyl(0.32, 0.36, 0.22, 12, true), { pos: [0, 0.43, 0], color: T.cloth, bone: B.hips, colorFn: (x, y, z, lx, ly) => (ly < -0.08 && Math.sin(Math.atan2(lx, 0.001 + z) * 9) > 0.3 ? null : null) });
  b.add(G.box(0.2, 0.26, 0.04), { pos: [0, 0.36, 0.3], rot: [0.12, 0, 0], color: T.cloth, bone: B.hips });
  b.add(G.sphere(0.05, 8, 6), { pos: [0, 0.55, 0.31], color: 0xcfb07a, bone: B.hips });
  // trophy strap across the chest with a little tooth necklace
  b.add(G.torus(0.33, 0.022, 6, 20), { pos: [0, 0.75, 0], rot: [Math.PI / 2 + 0.1, 0.55, 0], scl: [1, 0.95, 1], color: 0x6a4428, bone: B.chest });
  for (let i = 0; i < 5; i++) {
    const a = -0.6 + i * 0.3;
    b.add(G.cone(0.022, 0.08, 5), { pos: [Math.sin(a) * 0.27, 0.8 - Math.abs(a) * 0.05, Math.cos(a) * 0.27], rot: [Math.PI, 0, 0], color: 0xf0e4c4, bone: B.chest });
  }
  // --- head: wide, slightly flattened, with snout, brow, ears, horns, tusks
  const H = [0, 1.12, 0.08];
  b.add(G.sphere(1, 18, 14), { pos: H, scl: [0.27, 0.24, 0.25], color: S, bone: B.head, colorFn: skinFn(T.stripes) });
  b.add(G.sphere(1, 14, 10), { pos: [0, 1.06, 0.27], scl: [0.15, 0.1, 0.12], color: T.snout, bone: B.head });
  b.add(G.sphere(0.03, 6, 5), { pos: [0.055, 1.08, 0.38], color: 0x2b1d1d, bone: B.head });
  b.add(G.sphere(0.03, 6, 5), { pos: [-0.055, 1.08, 0.38], color: 0x2b1d1d, bone: B.head });
  // angry V brows
  const dark = new THREE.Color(S).multiplyScalar(0.72).getHex();
  for (const sx of [1, -1]) b.add(G.sphere(1, 10, 6), { pos: [0.095 * sx, 1.215, 0.265], scl: [0.105, 0.035, 0.06], rot: [0.25, 0, 0.42 * sx], color: dark, bone: B.head });
  for (const sx of [1, -1]) {
    // glowing almond eyes with slit pupils
    b.add(G.sphere(1, 10, 8), { pos: [0.098 * sx, 1.165, 0.283], scl: [0.05, 0.03, 0.03], rot: [0, 0, 0.25 * sx], color: T.eye, emit: 0.9, bone: B.head, jitter: 0 });
    b.add(G.sphere(1, 6, 5), { pos: [0.092 * sx, 1.165, 0.307], scl: [0.011, 0.026, 0.01], color: 0x120c10, bone: B.head, jitter: 0 });
    // long drooping ears with a brass ring
    b.add(G.cone(0.085, 0.44, 7), { pos: [0.33 * sx, 1.13, 0.0], rot: [0.25, 0, -1.95 * sx], scl: [1, 1, 0.42], color: S, color2: T.snout, grad: (x, y) => y > -0.05 && Math.abs(x) < 0.05 ? 0.7 : 0, bone: B.head });
    b.add(G.torus(0.03, 0.008, 5, 10), { pos: [0.44 * sx, 1.06, 0.02], rot: [0, Math.PI / 2, 0], color: 0xd9b45a, bone: B.head, jitter: 0 });
    // horns sweeping out and back from the temples
    const hl = 0.3 * (0.85 + rnd() * 0.3);
    b.add(G.horn(hl, 0.055, -0.16), { pos: [0.15 * sx, 1.28, 0.1], rot: [-0.35, 0, -0.55 * sx], color: T.horn, color2: 0x7a6a52, grad: (x, y) => 1 - y * 3.2, bone: B.head, jitter: 0.06,
      colorFn: (x, y, z, lx, ly) => (Math.sin(ly * 70) > 0.75 ? 0x9a8a6a : null) });
  }
  // central nub horn + top-knot
  b.add(G.cone(0.035, 0.1, 6), { pos: [0, 1.33, 0.2], rot: [0.55, 0, 0], color: T.horn, bone: B.head });
  b.add(G.cone(0.08, 0.24, 6), { pos: [0, 1.37, -0.03], rot: [-0.7, 0, 0], color: T.hair, bone: B.head, jitter: 0.2 });
  b.add(G.cone(0.06, 0.18, 6), { pos: [0, 1.31, -0.14], rot: [-1.2, 0, 0], color: T.hair, bone: B.head, jitter: 0.2 });
  // --- jaw: jutting underbite, dark grin line, big tusks
  b.add(G.sphere(1, 14, 8), { pos: [0, 0.985, 0.27], scl: [0.19, 0.075, 0.15], color: S, bone: B.jaw });
  b.add(G.sphere(1, 12, 6), { pos: [0, 1.025, 0.33], scl: [0.15, 0.02, 0.08], color: 0x3a1418, bone: B.jaw, jitter: 0 });
  for (const sx of [1, -1]) b.add(G.cone(0.034, 0.13, 6), { pos: [0.105 * sx, 1.07, 0.37], rot: [0.2, 0, -0.18 * sx], color: 0xf6ecd2, bone: B.jaw, jitter: 0 });
  for (let i = -1; i <= 1; i += 2) b.add(G.cone(0.014, 0.035, 4), { pos: [0.035 * i, 1.04, 0.395], color: 0xf6ecd2, bone: B.jaw, jitter: 0 });
  // --- arms (long, apish)
  for (const [s, sx] of [['L', 1], ['R', -1]]) {
    b.add(G.sphere(1, 12, 8), { pos: [0.29 * sx, 0.89, 0.02], scl: [0.11, 0.1, 0.1], color: S, bone: B['uArm' + s] });
    b.add(G.capsule(0.07, 0.16, 4, 9), { pos: [0.33 * sx, 0.78, 0.03], rot: [0, 0, 0.12 * sx], color: S, bone: B['uArm' + s] });
    b.add(G.capsule(0.085, 0.14, 4, 9), { pos: [0.37 * sx, 0.55, 0.05], color: S, bone: B['fArm' + s] });
    b.add(G.cyl(0.095, 0.09, 0.08, 9), { pos: [0.37 * sx, 0.5, 0.05], color: 0x6a4428, bone: B['fArm' + s] });  // wrist wrap
    b.add(G.sphere(1, 10, 8), { pos: [0.385 * sx, 0.4, 0.07], scl: [0.08, 0.075, 0.085], color: S, bone: B['hand' + s] });
    for (let f = 0; f < 3; f++) b.add(G.cone(0.022, 0.07, 5), { pos: [(0.36 + f * 0.025) * sx, 0.34, 0.11], rot: [2.6, 0, 0], color: 0x2e2622, bone: B['hand' + s] });
    // legs: short, bowed, big three-toed feet
    b.add(G.capsule(0.1, 0.12, 4, 9), { pos: [0.16 * sx, 0.4, 0.0], rot: [0, 0, 0.1 * sx], color: S, bone: B['thigh' + s] });
    b.add(G.capsule(0.08, 0.1, 4, 9), { pos: [0.17 * sx, 0.17, 0.03], color: S, bone: B['shin' + s] });
    b.add(G.sphere(1, 12, 8), { pos: [0.17 * sx, 0.05, 0.1], scl: [0.11, 0.06, 0.17], color: S, color2: T.snout, grad: (x, y) => y < 0 ? 0.5 : 0, bone: B['shin' + s] });
    for (let f = -1; f <= 1; f++) b.add(G.cone(0.022, 0.06, 5), { pos: [(0.17 + f * 0.05) * sx, 0.03, 0.26], rot: [Math.PI / 2, 0, 0], color: 0x2e2622, bone: B['shin' + s] });
  }
  // stubby tail
  b.add(G.cone(0.06, 0.24, 7), { pos: [0, 0.48, -0.32], rot: [-2.1, 0, 0], color: S, bone: B.tail });
  const c = finishCreature(ctx, b, J, { outline: 0.0028, boundR: 1.6, headTop: 0.48, socket: [0, -0.1, 0.06] });
  c.kind = 'gnarl'; c.tier = tierName; c.height = 1.45; c.radius = 0.42;
  c.model.scale.setScalar(T.scale);
  return c;
}

// ---------------------------------------------------------------- SHELLBACK
export function buildShellback(ctx, variant = 'teal', seed = 2) {
  const P = variant === 'amber'
    ? { shell: 0x9a5a22, shellHi: 0xe0a24a, plate: 0xd8b07a, body: 0x4a3426, eye: 0x9fffd8, horn: 0x2e2420 }
    : { shell: 0x2a4f6e, shellHi: 0x4fa3a6, plate: 0xc9b282, body: 0x3a3340, eye: 0xffb347, horn: 0x1e2430 };
  const J = {
    root: [0, 0, 0], hips: [0, 1.0, -0.05], chest: [0, 1.35, 0.05], head: [0, 1.55, 0.62], jaw: [0, 1.45, 0.85],
    uArmL: [0.62, 1.75, 0.2], fArmL: [0.78, 1.25, 0.35], handL: [0.82, 0.8, 0.48],
    thighL: [0.32, 0.98, -0.05], shinL: [0.36, 0.52, 0.06], tail: [0, 0.95, -0.4],
  };
  for (const k of ['uArm', 'fArm', 'hand', 'thigh', 'shin']) { const p = J[k + 'L']; J[k + 'R'] = [-p[0], p[1], p[2]]; }
  const b = new Builder();
  // carapace: one long glossy dome sloping down toward the head, split into two wing cases
  const shellFn = (x, y, z, lx, ly, lz) => {
    if (Math.abs(lx) < 0.035 && ly > -0.2) return 0x141c26;                    // elytra seam
    if (ly < -0.42) return P.plate;                                           // pale rim
    if (Math.abs(Math.sin(lx * 7.0)) < 0.05 && ly > -0.1) return 0x1b2a38;     // ribbing
    return null;
  };
  b.add(G.sphere(1, 26, 18), { pos: [0, 1.62, -0.18], scl: [0.8, 0.56, 0.98], rot: [0.32, 0, 0], color: P.shell, color2: P.shellHi,
    grad: (x, y, z) => Math.max(0, y - 0.25) * 1.6 + Math.max(0, -z - 0.3) * 0.3, bone: B.chest, colorFn: shellFn, jitter: 0.05 });
  // glossy highlight streaks (lighter paint strokes along each wing case)
  for (const sx of [1, -1]) b.add(G.sphere(1, 10, 6), { pos: [0.32 * sx, 2.02, -0.25], scl: [0.08, 0.04, 0.5], rot: [0.32, 0, -0.25 * sx], color: P.shellHi, emit: 0.15, bone: B.chest, jitter: 0 });
  // pronotum: the armoured shoulder shield in front of the shell
  b.add(G.sphere(1, 18, 12), { pos: [0, 1.72, 0.42], scl: [0.62, 0.36, 0.42], rot: [0.15, 0, 0], color: P.shell, color2: P.shellHi, grad: (x, y) => Math.max(0, y) * 1.8, bone: B.chest,
    colorFn: (x, y, z, lx, ly, lz) => ly < -0.6 ? P.plate : null });
  // great thorax horn sweeping forward over the head
  b.add(G.horn(0.95, 0.1, -0.4, 12, 8), { pos: [0, 1.95, 0.45], rot: [1.25, 0, 0], color: P.horn, color2: P.shellHi, grad: (x, y) => y * 0.9 - 0.25, bone: B.chest, jitter: 0.04 });
  // spines along the lower rim
  for (let i = 0; i < 5; i++) for (const sx of [1, -1]) {
    const t = i / 4;
    b.add(G.cone(0.055, 0.2, 5), { pos: [0.74 * sx * (0.85 + 0.15 * Math.sin(t * Math.PI)), 1.42 + t * 0.12, 0.3 - t * 1.0], rot: [0, 0, -1.9 * sx], color: P.horn, bone: B.chest });
  }
  // plated belly
  for (let i = 0; i < 4; i++) b.add(G.sphere(1, 14, 8), { pos: [0, 1.48 - i * 0.17, 0.4 - i * 0.06], scl: [0.4 - i * 0.04, 0.11, 0.2], color: P.plate, bone: i < 2 ? B.chest : B.hips,
    colorFn: (x, y, z, lx, ly, lz) => ly < -0.6 ? 0x8a7450 : null });
  b.add(G.sphere(1, 16, 12), { pos: [0, 1.1, 0.0], scl: [0.46, 0.42, 0.4], color: P.body, bone: B.hips });
  // head: low and forward under the pronotum, short upturned horn, mandibles, four glowing eyes
  b.add(G.sphere(1, 14, 10), { pos: [0, 1.5, 0.8], scl: [0.27, 0.21, 0.26], color: P.body, bone: B.head });
  b.add(G.horn(0.42, 0.065, -0.12, 8, 7), { pos: [0, 1.6, 0.98], rot: [0.5, 0, 0], color: P.horn, color2: P.shellHi, grad: (x, y) => y * 2 - 0.2, bone: B.head });
  for (const sx of [1, -1]) {
    for (let e = 0; e < 2; e++) b.add(G.sphere(0.045, 8, 6), { pos: [0.17 * sx + e * 0.03 * sx, 1.56 - e * 0.07, 0.92 - e * 0.05], color: P.eye, emit: 0.95, bone: B.head, jitter: 0 });
    b.add(G.horn(0.32, 0.045, 0.2, 8, 6), { pos: [0.13 * sx, 1.4, 0.92], rot: [1.5, 0, 0.75 * sx], color: P.horn, bone: B.jaw });
    // antennae
    b.add(G.horn(0.4, 0.015, -0.2, 6, 4), { pos: [0.12 * sx, 1.62, 0.95], rot: [0.9, 0, -0.5 * sx], color: P.horn, bone: B.head, jitter: 0 });
  }
  // arms: massive plated forearms ending in crushing three-claw fists
  for (const [s, sx] of [['L', 1], ['R', -1]]) {
    b.add(G.sphere(1, 12, 10), { pos: [0.62 * sx, 1.72, 0.2], scl: [0.24, 0.22, 0.24], color: P.shell, color2: P.shellHi, grad: (x, y) => y * 1.5, bone: B['uArm' + s] });
    b.add(G.capsule(0.13, 0.32, 4, 10), { pos: [0.7 * sx, 1.5, 0.27], rot: [0.3, 0, 0.3 * sx], color: P.body, bone: B['uArm' + s] });
    b.add(G.capsule(0.2, 0.3, 4, 10), { pos: [0.8 * sx, 1.05, 0.4], rot: [0.2, 0, 0], color: P.shell, color2: P.shellHi, grad: (x, y, z) => z * 2 + 0.3, bone: B['fArm' + s] });
    for (let k = 0; k < 3; k++) b.add(G.cone(0.04, 0.14, 5), { pos: [0.98 * sx, 1.0 + k * 0.14, 0.38], rot: [0, 0, -1.4 * sx], color: P.horn, bone: B['fArm' + s] });
    b.add(G.sphere(1, 12, 10), { pos: [0.83 * sx, 0.72, 0.5], scl: [0.19, 0.17, 0.2], color: P.body, bone: B['hand' + s] });
    for (let f = -1; f <= 1; f++) b.add(G.horn(0.22, 0.045, 0.1, 6, 5), { pos: [(0.83 + f * 0.09) * sx, 0.64, 0.62], rot: [2.2, 0, 0], color: P.horn, bone: B['hand' + s] });
    // legs: thick, short, armoured shins
    b.add(G.capsule(0.19, 0.3, 4, 10), { pos: [0.34 * sx, 0.78, -0.02], color: P.body, bone: B['thigh' + s] });
    b.add(G.capsule(0.16, 0.26, 4, 10), { pos: [0.36 * sx, 0.32, 0.08], color: P.shell, color2: P.shellHi, grad: (x, y, z) => z * 3, bone: B['shin' + s] });
    b.add(G.sphere(1, 12, 8), { pos: [0.36 * sx, 0.07, 0.2], scl: [0.2, 0.09, 0.3], color: P.body, bone: B['shin' + s] });
    for (let f = -1; f <= 1; f++) b.add(G.cone(0.045, 0.12, 5), { pos: [(0.36 + f * 0.1) * sx, 0.05, 0.47], rot: [Math.PI / 2, 0, 0], color: P.horn, bone: B['shin' + s] });
  }
  const c = finishCreature(ctx, b, J, { outline: 0.0022, boundR: 3, headTop: 0.65, socket: [0, -0.12, 0.08] });
  c.kind = 'shellback'; c.height = 2.6; c.radius = 0.85;
  return c;
}

// ---------------------------------------------------------------- STONEWARDEN
export function buildStonewarden(ctx, seed = 3) {
  const rnd = mulberry(seed * 104729 + 5);
  const J = {
    root: [0, 0, 0], hips: [0, 2.0, 0], chest: [0, 2.6, 0], head: [0, 4.0, 0.25], jaw: [0, 3.9, 0.5],
    uArmL: [1.5, 3.6, 0.1], fArmL: [2.0, 2.6, 0.3], handL: [2.15, 1.5, 0.5],
    thighL: [0.75, 1.9, 0], shinL: [0.8, 1.0, 0.1], tail: [0, 2.2, -0.8],
  };
  for (const k of ['uArm', 'fArm', 'hand', 'thigh', 'shin']) { const p = J[k + 'L']; J[k + 'R'] = [-p[0], p[1], p[2]]; }
  const b = new Builder();
  const STONE = 0x9c9584, STONE_D = 0x6f6a60, MOSS = 0x6f9c3a, MOSS2 = 0x9cbf4a, GLOW = 0xffb24a;
  // moss settles on upward-facing tops of each stone (world-space y relative to part centre)
  const mossy = (cy, thr = 0.35) => (x, y, z, lx, ly, lz) => {
    const n = vnoise3(x * 2.2, y * 2.2, z * 2.2);
    if (ly > thr - n * 0.45) return n > 0.55 ? MOSS2 : MOSS;
    if (Math.abs(Math.sin(lx * 7 + lz * 3)) < 0.05) return STONE_D;   // carved seams
    return null;
  };
  // torso: one huge carved boulder with a glowing core
  b.add(G.rock(1, 2, 0.18, 1), { pos: [0, 3.0, 0], scl: [1.35, 1.15, 0.95], color: STONE, bone: B.chest, colorFn: mossy(0, 0.45), jitter: 0.1 });
  b.add(G.rock(1, 1, 0.2, 2), { pos: [0, 2.05, 0], scl: [0.9, 0.55, 0.7], color: STONE_D, bone: B.hips, colorFn: mossy(0, 0.5) });
  // amber core inset in the chest + rune ring
  b.add(G.sphere(0.32, 16, 12), { pos: [0, 3.05, 0.86], color: GLOW, emit: 1, bone: B.chest, jitter: 0 });
  b.add(G.torus(0.45, 0.07, 6, 20), { pos: [0, 3.05, 0.84], color: 0x5d574e, bone: B.chest });
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2;
    b.add(G.box(0.08, 0.22, 0.05), { pos: [Math.cos(a) * 0.68, 3.05 + Math.sin(a) * 0.68, 0.8], rot: [0, 0, a], color: GLOW, emit: 0.8, bone: B.chest, jitter: 0 });
  }
  // shoulder stones with moss caps and hanging vines
  for (const [s, sx] of [['L', 1], ['R', -1]]) {
    b.add(G.rock(1, 1, 0.22, 4 + sx), { pos: [1.45 * sx, 3.75, 0.05], scl: [0.75, 0.6, 0.7], color: STONE, bone: B['uArm' + s], colorFn: mossy(0, 0.2) });
    // upper arm: floating stone (gap from shoulder = construct magic)
    b.add(G.rock(1, 1, 0.2, 7 + sx), { pos: [1.85 * sx, 3.0, 0.2], scl: [0.45, 0.55, 0.45], color: STONE_D, bone: B['uArm' + s], colorFn: mossy(0, 0.4) });
    b.add(G.rock(1, 1, 0.2, 9 + sx), { pos: [2.05 * sx, 2.1, 0.38], scl: [0.48, 0.6, 0.48], color: STONE, bone: B['fArm' + s], colorFn: mossy(0, 0.45) });
    // fist: huge blocky boulder with glowing knuckle runes
    b.add(G.rock(1, 1, 0.16, 11 + sx), { pos: [2.15 * sx, 1.1, 0.55], scl: [0.72, 0.62, 0.68], color: STONE, bone: B['hand' + s], colorFn: mossy(0, 0.5), flat: false });
    for (let k = 0; k < 3; k++) b.add(G.box(0.12, 0.05, 0.05), { pos: [(2.0 + k * 0.15) * sx, 1.0, 1.18], color: GLOW, emit: 0.85, bone: B['hand' + s], jitter: 0 });
    // vines dangling from the shoulder
    for (let v = 0; v < 3; v++) b.add(G.cyl(0.025, 0.015, 0.8 + rnd() * 0.6, 4), { pos: [(1.2 + v * 0.25) * sx, 3.2 - v * 0.1, 0.4 - v * 0.2], rot: [0.1, 0, 0.05 * sx], color: 0x4f7a2c, bone: B['uArm' + s] });
    // legs: two stacked pillars
    b.add(G.rock(1, 1, 0.14, 13 + sx), { pos: [0.8 * sx, 1.5, 0.0], scl: [0.48, 0.55, 0.48], color: STONE_D, bone: B['thigh' + s], colorFn: mossy(0, 0.6) });
    b.add(G.rock(1, 1, 0.14, 15 + sx), { pos: [0.82 * sx, 0.72, 0.1], scl: [0.46, 0.55, 0.46], color: STONE, bone: B['shin' + s], colorFn: mossy(0, 0.45) });
    b.add(G.rock(1, 1, 0.12, 17 + sx), { pos: [0.84 * sx, 0.18, 0.22], scl: [0.55, 0.22, 0.7], color: STONE_D, bone: B['shin' + s], colorFn: mossy(0, 0.5) });
  }
  // head: a squat carved block with a glowing visor slit and a moss crown + tiny sapling
  b.add(G.box(0.95, 0.7, 0.8), { pos: [0, 4.2, 0.3], rot: [0.05, 0, 0], color: STONE, bone: B.head, colorFn: mossy(0, 0.2), flat: true });
  b.add(G.box(0.7, 0.1, 0.06), { pos: [0, 4.2, 0.72], color: GLOW, emit: 1, bone: B.head, jitter: 0 });
  b.add(G.sphere(1, 12, 8), { pos: [0, 4.58, 0.25], scl: [0.55, 0.16, 0.45], color: MOSS, bone: B.head, jitter: 0.2 });
  b.add(G.cyl(0.025, 0.04, 0.5, 5), { pos: [0.18, 4.85, 0.18], rot: [0, 0, -0.2], color: 0x6a4a2c, bone: B.head });
  b.add(G.ico(0.22, 0), { pos: [0.25, 5.12, 0.18], color: MOSS2, bone: B.head, flat: true });
  // back: overgrown with a shrubby moss hump
  b.add(G.sphere(1, 12, 8), { pos: [0, 3.7, -0.55], scl: [1.0, 0.45, 0.55], color: MOSS, bone: B.chest, jitter: 0.25 });
  const c = finishCreature(ctx, b, J, { outline: 0.002, boundR: 5.5, headTop: 0.9, emitColor: 0xffd38a, socket: [0, -0.4, 0.3] });
  c.kind = 'stonewarden'; c.height = 5.2; c.radius = 1.7;
  return c;
}

// ---------------------------------------------------------------- WISP
const WISP_V = /* glsl */`
varying vec3 vN; varying vec3 vV; varying vec3 vP;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  vP = position;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const WISP_F = /* glsl */`
uniform vec3 uCore; uniform vec3 uEdge; uniform float uTime; uniform float uFlash; uniform float uFade;
varying vec3 vN; varying vec3 vV; varying vec3 vP;
#include <fog_pars_fragment>
float h(vec3 p){ p = fract(p*0.3183+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vn(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
void main() {
  float f = 1.0 - clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
  float swirl = vn(vP * 4.0 + vec3(0.0, uTime * 1.6, uTime * 0.7)) * 0.6 + vn(vP * 9.0 - vec3(uTime * 2.0)) * 0.4;
  vec3 col = mix(uCore * 1.8, uEdge, smoothstep(0.0, 0.85, f + swirl * 0.35 - 0.15));
  col += uEdge * pow(f, 3.0) * 1.5;
  col += vec3(uFlash);
  float a = mix(0.95, 0.55, f) * uFade;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;
export const WISP_KINDS = {
  ember: { core: 0xfff1b0, edge: 0xff6a1f, mote: 0xffa040, hp: 5 },
  frost: { core: 0xf2ffff, edge: 0x58c8ff, mote: 0xbff0ff, hp: 5 },
  storm: { core: 0xfffbd0, edge: 0xa070ff, mote: 0xffe86a, hp: 6 },
};
export function buildWisp(ctx, kind = 'ember') {
  const K = WISP_KINDS[kind] || WISP_KINDS.ember;
  const root = new THREE.Group();
  const model = new THREE.Group(); root.add(model);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsLib.fog, uCore: { value: new THREE.Color(K.core) }, uEdge: { value: new THREE.Color(K.edge) }, uTime: ctx.uniforms.uTime, uFlash: { value: 0 }, uFade: { value: 1 } },
    vertexShader: WISP_V, fragmentShader: WISP_F, transparent: true, fog: true, depthWrite: false,
  });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 3), mat);
  core.position.y = 0; model.add(core);
  // inner shell of crystalline shards orbiting the core
  const shardMat = makeToon(ctx, { rim: 1.4, emitColor: K.edge });
  const sb = new Builder();
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * Math.PI * 2;
    sb.add(G.cone(0.08, 0.32, 4), { pos: [Math.cos(a) * 0.6, Math.sin(a * 2) * 0.12, Math.sin(a) * 0.6], rot: [0, -a, -Math.PI / 2], order: 'YXZ', color: K.edge, emit: 0.5, jitter: 0, flat: true });
  }
  const shards = new THREE.Mesh(sb.build(), shardMat);
  shards.castShadow = true;
  model.add(shards);
  const glowTex = ctx.__combatGlowTex;
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: K.edge, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.7 }));
  halo.scale.setScalar(2.4); model.add(halo);
  const headTop = new THREE.Object3D(); headTop.position.y = 0.8; model.add(headTop);
  return { root, model, core, shards, halo, material: mat, shardMat, kind: 'wisp', element: kind, height: 1, radius: 0.5, headTop, K };
}
