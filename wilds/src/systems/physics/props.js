// Interactable physics props: crates, barrels, explosive barrels, boulders, logs, iron blocks,
// iron balls, ice blocks. Each prop = rigid body + painterly mesh + ink outline.
import * as THREE from 'three';
import { Body } from './engine.js';
import { makeMaterial, makeOutlineMaterial, outlineGeometry, cloneMaterial } from './materials.js';
import * as G from './geometry.js';

const _m = new THREE.Matrix4();

export const PROP_DEFS = {
  crate:     { shape: 'box', hx: 0.5, hy: 0.5, hz: 0.5, mass: 14, material: 'wood', density: 0.55, friction: 0.65, restitution: 0.1, hp: 30, flammable: true },
  crateBig:  { shape: 'box', hx: 0.7, hy: 0.7, hz: 0.7, mass: 30, material: 'wood', density: 0.55, friction: 0.65, restitution: 0.1, hp: 45, flammable: true },
  barrel:    { shape: 'capsule', r: 0.42, hh: 0.14, mass: 18, material: 'wood', density: 0.6, friction: 0.5, restitution: 0.12, hp: 25, flammable: true, rollResist: 0.6 },
  boom:      { shape: 'capsule', r: 0.42, hh: 0.14, mass: 20, material: 'explosive', density: 0.7, friction: 0.5, restitution: 0.12, hp: 8, flammable: true, explosive: true, rollResist: 0.6 },
  boulder:   { shape: 'sphere', r: 1.2, mass: 900, material: 'stone', density: 2.6, friction: 0.8, restitution: 0.08, rollResist: 0.15, hp: Infinity },
  log:       { shape: 'capsule', r: 0.34, hh: 1.7, mass: 60, material: 'wood', density: 0.5, friction: 0.7, restitution: 0.05, hp: 80, flammable: true, rollResist: 0.4 },
  ironBlock: { shape: 'box', hx: 0.6, hy: 0.6, hz: 0.6, mass: 60, material: 'metal', density: 7, friction: 0.45, restitution: 0.05, hp: Infinity, magnetic: true },
  ironSlab:  { shape: 'box', hx: 1.6, hy: 0.2, hz: 0.8, mass: 70, material: 'metal', density: 7, friction: 0.5, restitution: 0.03, hp: Infinity, magnetic: true },
  ironBall:  { shape: 'sphere', r: 0.42, mass: 40, material: 'metal', density: 7, friction: 0.4, restitution: 0.2, hp: Infinity, magnetic: true, rollResist: 0.05 },
  ice:       { shape: 'box', hx: 0.6, hy: 0.6, hz: 0.6, mass: 30, material: 'ice', density: 0.9, friction: 0.03, restitution: 0.05, hp: 20, melts: true },
  stoneCube: { shape: 'box', hx: 0.65, hy: 0.65, hz: 0.65, mass: 120, material: 'stone', density: 2.5, friction: 0.8, restitution: 0.03, hp: Infinity },
};

export class Props {
  constructor(ctx, phys, shared) {
    this.ctx = ctx; this.phys = phys; this.shared = shared;
    this.list = [];
    this.geos = {}; this.outlines = {}; this.mats = {};
    this.ink = makeOutlineMaterial(ctx, shared, { width: 0.022 });
    this.inkThin = makeOutlineMaterial(ctx, shared, { width: 0.014 });
    this.root = new THREE.Group(); this.root.name = 'physics-props';
    ctx.scene.add(this.root);
    const mk = (k, kind, o) => (this.mats[k] = makeMaterial(ctx, shared, kind, o));
    mk('wood', 'WOOD', { tint: 0xffffff });
    mk('barrel', 'BARREL', { tint2: [1, 0, 0] });
    mk('boom', 'BARREL', { tint: 0xffffff, tint2: [1, 1, 0] });
    mk('stone', 'STONE', { tint: 0xffffff, tint2: [1, 1, 0] });
    mk('bark', 'BARK', { tint2: [0.36, 1, 0] });
    mk('metal', 'METAL', { tint2: [1, 1, 0], glowCol: 0x5ef2d6 });
    mk('ice', 'ICE', {});
    mk('sanctumStone', 'SANCTUM', { tint: 0xb8b0a0, tint2: [1, 1, 0] });
  }

  geo(type, variant = 0) {
    const key = type + ':' + variant;
    if (this.geos[key]) return this.geos[key];
    let g;
    switch (type) {
      case 'crate': g = G.crateGeometry(1); break;
      case 'crateBig': g = G.crateGeometry(1.4); break;
      case 'barrel': g = G.barrelGeometry(0.42, 1.1); this._recolour(g, 0xc0412e, 0x9c6a3e); break;
      case 'boom': g = G.barrelGeometry(0.42, 1.1); break;
      case 'boulder': g = G.boulderGeometry(1, 11 + variant * 7, 0xa8a090); break;
      case 'log': g = G.logGeometry(0.34, 1.7, 3 + variant); break;
      case 'ironBlock': g = G.metalBoxGeometry(1.2, 1.2, 1.2); break;
      case 'ironSlab': g = G.metalBoxGeometry(3.2, 0.4, 1.6); break;
      case 'ironBall': g = G.sphereGeometry(0.42, 0x667a88, 3); break;
      case 'ice': g = G.iceGeometry(1.2); break;
      case 'stoneCube': g = G.roundedBox(1.3, 1.3, 1.3, 0.1, 2, 0xb6ad9c, 1); break;
    }
    g.computeBoundingSphere();
    this.geos[key] = g;
    this.outlines[key] = outlineGeometry(g);
    return g;
  }
  _recolour(g, from, to) {
    const c = g.getAttribute('color'), f = new THREE.Color(from), t = new THREE.Color(to);
    for (let i = 0; i < c.count; i++) if (Math.abs(c.getX(i) - f.r) < 0.02 && Math.abs(c.getY(i) - f.g) < 0.02) c.setXYZ(i, t.r, t.g, t.b);
  }
  materialFor(type) {
    const d = PROP_DEFS[type];
    if (type === 'barrel') return cloneMaterial(this.mats.barrel);
    if (type === 'boom') return cloneMaterial(this.mats.boom);
    if (type === 'log') return cloneMaterial(this.mats.bark);
    if (d.material === 'wood') return cloneMaterial(this.mats.wood);
    if (d.material === 'metal') return cloneMaterial(this.mats.metal);
    if (type === 'ice') return cloneMaterial(this.mats.ice);
    if (type === 'stoneCube') return this.mats.sanctumStone;
    return this.mats.stone;
  }

  // spawn a prop. opts: position, quaternion, scale (boulder radius), group, sleeping, variant
  spawn(type, opts = {}) {
    const def = PROP_DEFS[type];
    if (!def) throw new Error('unknown prop ' + type);
    const scale = opts.scale ?? 1;
    const bo = { ...def, position: opts.position, quaternion: opts.quaternion, group: opts.group ?? 0 };
    if (def.shape === 'sphere') bo.r = def.r * scale;
    if (type === 'boulder') bo.mass = def.mass * scale ** 3;
    const body = new Body(bo);
    body.userData.type = type;
    const g = this.geo(type, opts.variant ?? 0);
    const mat = this.materialFor(type);
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    const ol = new THREE.Mesh(this.outlines[type + ':' + (opts.variant ?? 0)], type === 'boulder' ? this.ink : this.inkThin);
    mesh.add(ol);
    if (scale !== 1) mesh.scale.setScalar(scale);
    if (type === 'boulder') { body.r *= 0.97; }
    (opts.parent || this.root).add(mesh);
    mesh.position.copy(body.pos); mesh.quaternion.copy(body.quat);
    const prop = {
      type, def, body, mesh, outline: ol, mat,
      hp: def.hp, burn: 0, burning: 0, fuse: -1, melt: 0, heat: 0, wet: 0,
      alive: true, group: body.group, userData: opts.userData || {},
    };
    body.userData.prop = prop;
    body.mesh = mesh;
    this.phys.add(body);
    if (opts.sleeping) { body.sleeping = true; }
    this.list.push(prop);
    return prop;
  }

  remove(prop) {
    if (!prop.alive) return;
    prop.alive = false;
    this.phys.remove(prop.body);
    prop.mesh.parent?.remove(prop.mesh);
    const i = this.list.indexOf(prop); if (i >= 0) this.list.splice(i, 1);
    if (prop.mat !== this.mats.stone && prop.mat !== this.mats.sanctumStone) prop.mat.dispose();
  }

  // interpolate render transforms; visibility culling by distance
  sync(alpha, camPos) {
    for (const p of this.list) {
      const b = p.body, m = p.mesh;
      const d2 = camPos.distanceToSquared(b.pos);
      m.visible = p.group > 0 ? p.group === this.phys.activeGroup : d2 < 330 * 330;
      if (!m.visible) continue;
      p.outline.visible = d2 < 140 * 140;
      if (b.sleeping || b.invMass === 0) { m.position.copy(b.pos); m.quaternion.copy(b.quat); continue; }
      m.position.lerpVectors(b.prevPos, b.pos, alpha);
      m.quaternion.slerpQuaternions(b.prevQuat, b.quat, alpha);
    }
  }
}

// ---------------------------------------------------------------------------
// world placement helpers
export function findSpot(world, cx, cz, R, rand, { minN = 0.9, maxN = 1.01, minH = 1.5, tries = 60 } = {}) {
  const n = { x: 0, y: 1, z: 0 };
  for (let i = 0; i < tries; i++) {
    const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * R;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    const h = world.getHeight(x, z);
    if (h < minH) continue;
    const ws = world.getWaterSurface?.(x, z) ?? -Infinity;
    if (ws > h - 0.3) continue;
    world.getNormal(x, z, n);
    if (n.y < minN || n.y > maxN) continue;
    return { x, z, h, nx: n.x, ny: n.y, nz: n.z };
  }
  return null;
}

const _up = new THREE.Vector3(0, 1, 0), _nv = new THREE.Vector3(), _q = new THREE.Quaternion(), _qy = new THREE.Quaternion();
export function groundQuat(nx, ny, nz, yaw, out = new THREE.Quaternion()) {
  _nv.set(nx, ny, nz).normalize();
  _q.setFromUnitVectors(_up, _nv);
  _qy.setFromAxisAngle(_up, yaw);
  return out.copy(_q).multiply(_qy);
}
