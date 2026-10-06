// Lightweight rigid-body engine for Windborne.
//
// Shapes: 'sphere' {r}, 'box' {hx,hy,hz}, 'capsule' {r, hh} (segment along local Y, half length hh).
// Dynamic bodies (mass > 0), kinematic bodies (kinematic:true, moved by code, velocity used by the
// solver) and static colliders (plain objects from terrain/ruins or our own sanctum geometry).
// Terrain contact samples the analytic heightfield. Sequential-impulse solver with warm-started
// normal impulses, Coulomb friction, restitution, Baumgarte bias + split position projection,
// per-body sleeping with wake propagation, buoyancy + river drag in water.
//
// No per-step allocations in the hot path: contacts live in two swapping pools.
import * as THREE from 'three';
import { boxBox } from './boxbox.js';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _m3 = new THREE.Matrix3();
const nrmOut = { x: 0, y: 1, z: 0 };
const riverOut = {};

let NEXT_ID = 1;

export class Body {
  constructor(o = {}) {
    this.id = NEXT_ID++;
    this.shape = o.shape || 'box';
    this.r = o.r ?? 0.5;
    this.hh = o.hh ?? 0.5;
    this.hx = o.hx ?? 0.5; this.hy = o.hy ?? 0.5; this.hz = o.hz ?? 0.5;
    this.pos = new THREE.Vector3().copy(o.position || _v1.set(0, 0, 0));
    this.quat = new THREE.Quaternion().copy(o.quaternion || _q1.identity());
    this.prevPos = this.pos.clone(); this.prevQuat = this.quat.clone();
    this.vel = new THREE.Vector3(); this.angVel = new THREE.Vector3();
    this.force = new THREE.Vector3(); this.torque = new THREE.Vector3();
    this.kinematic = !!o.kinematic;
    this.mass = this.kinematic ? 0 : (o.mass ?? 1);
    this.invMass = this.mass > 0 ? 1 / this.mass : 0;
    this.friction = o.friction ?? 0.6;
    this.restitution = o.restitution ?? 0.15;
    this.linDamp = o.linearDamping ?? 0.04;
    this.angDamp = o.angularDamping ?? 0.08;
    this.rollResist = o.rollResist ?? 0.0;      // extra angular damping while in contact
    this.density = o.density ?? 1.5;           // relative to water (logs/crates < 1 float)
    this.material = o.material || 'stone';     // 'wood' | 'stone' | 'metal' | 'ice' | 'explosive'
    this.gravityScale = o.gravityScale ?? 1;
    this.sleeping = false; this.sleepT = 0;
    this.canSleep = o.canSleep ?? true;
    this.group = o.group ?? 0;                 // 0 world; >0 = sanctum id (only collides inside)
    this.mesh = o.mesh || null;
    this.userData = o.userData || {};
    this.onContact = o.onContact || null;      // (body, other, impulse) on strong impacts
    this.collider = { type: 'box', x: 0, y: 0, z: 0, hx: 0, hy: 0, hz: 0, rotY: 0, r: 0, kind: 'physics', body: this };
    this.invI = new THREE.Vector3();           // local inverse inertia (diagonal)
    this.invIW = new Float32Array(9);          // world inverse inertia
    this.R = new Float32Array(9);              // rotation matrix (column major like Matrix3.elements)
    this.inWater = 0;
    this.contactCount = 0; this.groundN = 0;
    this.maxImpact = 0;
    this.world = null;
    this.updateMass();
    this.updateDerived();
  }
  get boundR() {
    if (this.shape === 'sphere') return this.r;
    if (this.shape === 'capsule') return this.hh + this.r;
    return Math.hypot(this.hx, this.hy, this.hz);
  }
  updateMass() {
    const m = this.mass;
    if (m <= 0) { this.invI.set(0, 0, 0); return; }
    let ix, iy, iz;
    if (this.shape === 'sphere') { ix = iy = iz = 0.4 * m * this.r * this.r; }
    else if (this.shape === 'capsule') {
      const L = 2 * this.hh, r = this.r;
      iy = 0.5 * m * r * r;
      ix = iz = m * (3 * r * r + L * L) / 12 + m * r * r * 0.25;
    } else {
      const x = 2 * this.hx, y = 2 * this.hy, z = 2 * this.hz;
      ix = m * (y * y + z * z) / 12; iy = m * (x * x + z * z) / 12; iz = m * (x * x + y * y) / 12;
    }
    this.invI.set(1 / ix, 1 / iy, 1 / iz);
  }
  setMass(m) { this.mass = m; this.invMass = m > 0 ? 1 / m : 0; this.updateMass(); this.updateDerived(); }
  updateDerived() {
    _m3.setFromMatrix4(_mat4.makeRotationFromQuaternion(this.quat));
    const e = _m3.elements, R = this.R;
    for (let i = 0; i < 9; i++) R[i] = e[i];
    // invIW = R * diag(invI) * R^T
    const a = this.invI.x, b = this.invI.y, c = this.invI.z, W = this.invIW;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      // element (row i, col j); column major: idx = col*3+row
      W[j * 3 + i] = R[i] * R[j] * a + R[3 + i] * R[3 + j] * b + R[6 + i] * R[6 + j] * c;
    }
    // player-facing collider (approximate, Y-rotation only)
    const C = this.collider;
    C.x = this.pos.x; C.y = this.pos.y; C.z = this.pos.z;
    if (this.shape === 'sphere') { C.type = 'sphere'; C.r = this.r; }
    else {
      C.type = 'box';
      // world AABB half extents projected through the rotation
      let hx, hy, hz;
      if (this.shape === 'capsule') {
        const ax = Math.abs(R[3]) * this.hh, ay = Math.abs(R[4]) * this.hh, az = Math.abs(R[5]) * this.hh;
        hx = ax + this.r; hy = ay + this.r; hz = az + this.r;
        C.rotY = 0; C.hx = hx * 0.85; C.hy = hy; C.hz = hz * 0.85;
      } else {
        // yaw from the local X axis projected on the ground; extents from that frame
        const yaw = Math.atan2(-R[2], R[0]);
        const cy = Math.cos(yaw), sy = Math.sin(yaw);
        // world axis directions of the yaw frame
        const ex = this.hx, ey = this.hy, ez = this.hz;
        C.rotY = yaw; C.hx = projExt(R, ex, ey, ez, cy, 0, -sy); C.hy = projExt(R, ex, ey, ez, 0, 1, 0); C.hz = projExt(R, ex, ey, ez, sy, 0, cy);
      }
    }
  }
  wake() { if (this.sleeping) { this.sleeping = false; this.sleepT = 0; } }
  applyImpulse(imp, point) {
    if (this.invMass === 0) return;
    this.wake();
    this.vel.addScaledVector(imp, this.invMass);
    if (point) {
      _v4.subVectors(point, this.pos).cross(imp);
      mulInvI(this, _v4, _v4);
      this.angVel.add(_v4);
    }
  }
  // world-space point to local / axis helpers
  axis(i, out) { const R = this.R; return out.set(R[i * 3], R[i * 3 + 1], R[i * 3 + 2]); }
}
const _mat4 = new THREE.Matrix4();
function projExt(R, ex, ey, ez, ux, uy, uz) {
  return Math.abs(R[0] * ux + R[1] * uy + R[2] * uz) * ex + Math.abs(R[3] * ux + R[4] * uy + R[5] * uz) * ey + Math.abs(R[6] * ux + R[7] * uy + R[8] * uz) * ez;
}

function mulInvI(b, v, out) {
  const W = b.invIW, x = v.x, y = v.y, z = v.z;
  return out.set(W[0] * x + W[3] * y + W[6] * z, W[1] * x + W[4] * y + W[7] * z, W[2] * x + W[5] * y + W[8] * z);
}

// ---------------------------------------------------------------------------
// static shape signed distance: returns distance (negative inside), writes outward normal + surface point
const sd = { d: 0, nx: 0, ny: 1, nz: 0 };
function sdBoxWorld(cx, cy, cz, R, hx, hy, hz, px, py, pz) {
  // R: column-major rotation (columns = local axes in world)
  const dx = px - cx, dy = py - cy, dz = pz - cz;
  const lx = dx * R[0] + dy * R[1] + dz * R[2];
  const ly = dx * R[3] + dy * R[4] + dz * R[5];
  const lz = dx * R[6] + dy * R[7] + dz * R[8];
  const qx = Math.abs(lx) - hx, qy = Math.abs(ly) - hy, qz = Math.abs(lz) - hz;
  let nx, ny, nz, d;
  if (qx > 0 || qy > 0 || qz > 0) {
    const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
    d = Math.hypot(ox, oy, oz);
    nx = ox * Math.sign(lx) / d; ny = oy * Math.sign(ly) / d; nz = oz * Math.sign(lz) / d;
  } else {
    if (qx > qy && qx > qz) { d = qx; nx = Math.sign(lx) || 1; ny = 0; nz = 0; }
    else if (qy > qz) { d = qy; nx = 0; ny = Math.sign(ly) || 1; nz = 0; }
    else { d = qz; nx = 0; ny = 0; nz = Math.sign(lz) || 1; }
  }
  sd.d = d;
  sd.nx = R[0] * nx + R[3] * ny + R[6] * nz;
  sd.ny = R[1] * nx + R[4] * ny + R[7] * nz;
  sd.nz = R[2] * nx + R[5] * ny + R[8] * nz;
  return d;
}
const Rtmp = new Float32Array(9);
function yawR(rotY) {
  // rotation about Y by rotY, matching terrain colliders (local = rotate(world - c) by rotY):
  // terrain boxLocal: lx = dx*cos - dz*sin, lz = dx*sin + dz*cos  => local X axis in world = (cos, 0, -sin)
  const c = Math.cos(rotY || 0), s = Math.sin(rotY || 0);
  Rtmp[0] = c; Rtmp[1] = 0; Rtmp[2] = -s;
  Rtmp[3] = 0; Rtmp[4] = 1; Rtmp[5] = 0;
  Rtmp[6] = s; Rtmp[7] = 0; Rtmp[8] = c;
  return Rtmp;
}
function sdStatic(c, px, py, pz) {
  if (c.type === 'sphere') {
    const dx = px - c.x, dy = py - c.y, dz = pz - c.z, l = Math.hypot(dx, dy, dz) || 1e-6;
    sd.nx = dx / l; sd.ny = dy / l; sd.nz = dz / l; sd.d = l - c.r; return sd.d;
  }
  if (c.type === 'cylinder') {
    const dx = px - c.x, dz = pz - c.z, rl = Math.hypot(dx, dz) || 1e-6, dy = py - c.y;
    const qr = rl - c.r, qy = Math.abs(dy) - c.hy;
    if (qr > 0 || qy > 0) {
      const a = Math.max(qr, 0), b = Math.max(qy, 0), d = Math.hypot(a, b);
      sd.nx = dx / rl * a / d; sd.nz = dz / rl * a / d; sd.ny = Math.sign(dy) * b / d; sd.d = d;
    } else if (qr > qy) { sd.nx = dx / rl; sd.nz = dz / rl; sd.ny = 0; sd.d = qr; }
    else { sd.nx = 0; sd.nz = 0; sd.ny = Math.sign(dy) || 1; sd.d = qy; }
    return sd.d;
  }
  if (c.type === 'box') return sdBoxWorld(c.x, c.y, c.z, c.R || yawR(c.rotY), c.hx, c.hy, c.hz, px, py, pz);
  sd.d = 1e9; return 1e9;
}
// signed distance to a body's shape
function sdBody(b, px, py, pz) {
  const p = b.pos;
  if (b.shape === 'sphere') {
    const dx = px - p.x, dy = py - p.y, dz = pz - p.z, l = Math.hypot(dx, dy, dz) || 1e-6;
    sd.nx = dx / l; sd.ny = dy / l; sd.nz = dz / l; sd.d = l - b.r; return sd.d;
  }
  if (b.shape === 'capsule') {
    const R = b.R, ax = R[3], ay = R[4], az = R[5];
    const t = Math.max(-b.hh, Math.min(b.hh, (px - p.x) * ax + (py - p.y) * ay + (pz - p.z) * az));
    const dx = px - (p.x + ax * t), dy = py - (p.y + ay * t), dz = pz - (p.z + az * t);
    const l = Math.hypot(dx, dy, dz) || 1e-6;
    sd.nx = dx / l; sd.ny = dy / l; sd.nz = dz / l; sd.d = l - b.r; return sd.d;
  }
  return sdBoxWorld(p.x, p.y, p.z, b.R, b.hx, b.hy, b.hz, px, py, pz);
}

// ---------------------------------------------------------------------------
class Contact {
  constructor() {
    this.a = null; this.b = null; this.key = 0;
    this.p = new THREE.Vector3(); this.n = new THREE.Vector3();
    this.rA = new THREE.Vector3(); this.rB = new THREE.Vector3();
    this.t1 = new THREE.Vector3(); this.t2 = new THREE.Vector3();
    this.rAn = new THREE.Vector3(); this.rBn = new THREE.Vector3();
    this.rAt1 = new THREE.Vector3(); this.rBt1 = new THREE.Vector3();
    this.rAt2 = new THREE.Vector3(); this.rBt2 = new THREE.Vector3();
    this.pen = 0; this.kN = 0; this.kT1 = 0; this.kT2 = 0;
    this.jn = 0; this.jt1 = 0; this.jt2 = 0; this.bias = 0; this.bounce = 0;
    this.mu = 0.5; this.vb = new THREE.Vector3(); this.ft = new THREE.Vector3();  // kinematic/static surface velocity
  }
}

const MAX_CONTACTS = 4096;
const MARGIN = 0.03;   // speculative contact margin

export class PhysicsWorld {
  constructor({ world, gravity = -17, getStatics = null, getWater = null }) {
    this.hf = world;                       // heightfield api (getHeight/getNormal/getWaterSurface)
    this.gravity = gravity;
    this.bodies = [];
    this.getStatics = getStatics;          // (x, z, r, out, group) -> static colliders
    this.getWater = getWater;              // (x, z) -> surface y or null
    this.fixed = 1 / 60;
    this.acc = 0;
    this.iterations = 16;
    this.wf = 0.4;                         // warm-start fraction (lower = steadier stacks)
    this.slop = 0.01;
    this.focus = new THREE.Vector3();
    this.activeRadius = 140;
    this.activeGroup = 0;                  // group currently simulated besides world (sanctum id)
    this.alpha = 1;
    this.poolA = []; this.poolB = []; this.nC = 0; this.nPrev = 0;
    for (let i = 0; i < MAX_CONTACTS; i++) { this.poolA.push(new Contact()); this.poolB.push(new Contact()); }
    this.contacts = this.poolA; this.prev = this.poolB;
    this.prevMap = new Map(); this.curMap = new Map();
    this.active = [];
    this.statOut = [];
    this.grid = new Map(); this.gridPool = []; this.cell = 4;
    this.pairStamp = 0;
    this.listeners = [];                  // impact listeners (body, other, speed, point)
    this.windForce = new THREE.Vector3();
    this.stepCount = 0;
    this._mu = -1; this._feat0 = 0;
    this._emitBB = (px, py, pz, nx, ny, nz, pen, feat) => this.addContact(this._a, this._b, px, py, pz, nx, ny, nz, pen, this._feat0 | feat, 0, 0, 0, this._b ? -1 : this._mu);
  }
  add(b) { b.world = this; this.bodies.push(b); return b; }
  remove(b) { const i = this.bodies.indexOf(b); if (i >= 0) this.bodies.splice(i, 1); b.world = null; }

  isActive(b) {
    if (b.group) return b.group === this.activeGroup;
    const dx = b.pos.x - this.focus.x, dz = b.pos.z - this.focus.z;
    return dx * dx + dz * dz < this.activeRadius * this.activeRadius;
  }

  step(dt, preStep) {
    this.acc = Math.min(this.acc + dt, this.fixed * 4);
    let n = 0;
    while (this.acc >= this.fixed) {
      for (const b of this.bodies) { b.prevPos.copy(b.pos); b.prevQuat.copy(b.quat); }
      preStep?.(this.fixed);
      this.substep(this.fixed);
      this.acc -= this.fixed; n++;
    }
    this.alpha = this.acc / this.fixed;
    return n;
  }

  // ---------------------------------------------------------------------------
  substep(h) {
    this.stepCount++;
    const act = this.active; act.length = 0;
    for (const b of this.bodies) if (this.isActive(b)) act.push(b);
    // integrate velocities
    for (const b of act) {
      if (b.invMass === 0 || b.sleeping) continue;
      b.vel.y += this.gravity * b.gravityScale * h;
      b.vel.addScaledVector(b.force, b.invMass * h);
      if (b.torque.lengthSq() > 0) { mulInvI(b, b.torque, _v1); b.angVel.addScaledVector(_v1, h); }
      // buoyancy + drag
      if (this.getWater && (this.stepCount + b.id) % 4 === 0) {
        const ws = this.getWater(b.pos.x, b.pos.z);
        b.waterY = ws;
      }
      if (b.waterY !== undefined && b.waterY !== null && b.waterY > b.pos.y - b.boundR) {
        const sub = Math.min(1, (b.waterY - (b.pos.y - b.boundR * 0.7)) / (b.boundR * 1.4));
        if (sub > 0) {
          b.inWater = sub;
          b.vel.y += -this.gravity * h * sub / Math.max(0.2, b.density) * 1.0;
          const drag = Math.exp(-h * 1.6 * sub);
          b.vel.multiplyScalar(drag); b.angVel.multiplyScalar(Math.exp(-h * 1.2 * sub));
          // river current
          const ri = this.hf.getRiverInfo?.(b.pos.x, b.pos.z, riverOut);
          if (ri && ri.dist < ri.halfWidth) { b.vel.x += ri.dirX * 2.2 * h * sub; b.vel.z += ri.dirZ * 2.2 * h * sub; }
        }
      } else b.inWater = 0;
      const ld = Math.exp(-b.linDamp * h), ad = Math.exp(-(b.angDamp + (b.contactCount ? b.rollResist : 0)) * h);
      b.vel.multiplyScalar(ld); b.angVel.multiplyScalar(ad);
      // clamp
      const v2 = b.vel.lengthSq(); if (v2 > 3600) b.vel.multiplyScalar(60 / Math.sqrt(v2));
      const w2 = b.angVel.lengthSq(); if (w2 > 900) b.angVel.multiplyScalar(30 / Math.sqrt(w2));
    }
    // ---------- collision detection ----------
    const tmp = this.prev; this.prev = this.contacts; this.contacts = tmp;
    this.nPrev = this.nC; this.nC = 0;
    const tm = this.prevMap; this.prevMap = this.curMap; this.curMap = tm; this.curMap.clear();
    for (const b of act) { b.contactCount = 0; b.groundN = 0; }
    this.buildGrid(act);
    for (const a of act) {
      if (a.invMass === 0 && !a.kinematic) continue;
      const aDyn = a.invMass > 0;
      if (aDyn && !a.sleeping) {
        this.collideTerrain(a);
        this.collideStatics(a);
      }
      // pairs via grid
      this.pairStamp++;
      const r = a.boundR;
      const x0 = Math.floor((a.pos.x - r) / this.cell), x1 = Math.floor((a.pos.x + r) / this.cell);
      const z0 = Math.floor((a.pos.z - r) / this.cell), z1 = Math.floor((a.pos.z + r) / this.cell);
      for (let gz = z0; gz <= z1; gz++) for (let gx = x0; gx <= x1; gx++) {
        const cellArr = this.grid.get(gx * 92837111 ^ gz * 689287499);
        if (!cellArr) continue;
        for (const b of cellArr) {
          if (b === a || b._ps === this.pairStamp) continue; b._ps = this.pairStamp;
          if (b.id < a.id && (b.invMass > 0 || b.kinematic)) continue;   // handle each pair once (from lower id)
          if (a.group !== b.group) continue;
          const bDyn = b.invMass > 0;
          if (!aDyn && !bDyn) continue;
          if (!isAwake(a) && !isAwake(b)) continue;
          const rr = r + b.boundR;
          if (a.pos.distanceToSquared(b.pos) > rr * rr) continue;
          this.collidePair(a, b);
        }
      }
    }
    // ---------- solve ----------
    this.preSolve(h);
    for (let it = 0; it < this.iterations; it++) this.solveVel();
    this.finishSolve();
    // integrate positions
    for (const b of act) {
      if (b.invMass === 0 || b.sleeping) continue;
      b.pos.addScaledVector(b.vel, h);
      const w = b.angVel, wl = w.length();
      if (wl > 1e-6) {
        _q1.setFromAxisAngle(_v1.copy(w).divideScalar(wl), wl * h);
        b.quat.premultiply(_q1).normalize();
      }
    }
    // position projection (removes residual penetration without adding velocity)
    for (let i = 0; i < this.nC; i++) {
      const c = this.contacts[i];
      const corr = this.noProj ? 0 : Math.max(0, c.pen - this.slop * 2) * 0.35;
      if (corr <= 0) continue;
      const a = c.a, b = c.b;
      const ia = a.sleeping ? 0 : a.invMass, ib = b && !b.sleeping ? b.invMass : 0;
      const s = ia + ib; if (s <= 0) continue;
      a.pos.addScaledVector(c.n, corr * ia / s);
      if (b && ib) b.pos.addScaledVector(c.n, -corr * ib / s);
    }
    // derived + sleeping
    for (const b of act) {
      if (b.invMass === 0) { if (b.kinematic) b.updateDerived(); continue; }
      if (b.sleeping) continue;
      b.updateDerived();
      b.force.set(0, 0, 0); b.torque.set(0, 0, 0);
      const e = b.vel.lengthSq() + b.angVel.lengthSq() * 0.5 * b.boundR;
      if (b.canSleep && e < 0.02 && b.contactCount > 0) {
        b.sleepT += h;
        if (b.sleepT > 0.7) { b.sleeping = true; b.vel.set(0, 0, 0); b.angVel.set(0, 0, 0); }
      } else b.sleepT = 0;
      // fell through the world: put back on the surface
      const gh = this.hf.getHeight(b.pos.x, b.pos.z);
      if (!b.group && b.pos.y < gh - b.boundR * 2 - 1) { b.pos.y = gh + b.boundR + 0.2; b.vel.set(0, 0, 0); }
      if (b.group && b.pos.y < (b.killY ?? -1e9)) b.userData.onFellOut?.(b);
    }
  }

  buildGrid(act) {
    for (const arr of this.grid.values()) { arr.length = 0; this.gridPool.push(arr); }
    this.grid.clear();
    for (const b of act) {
      const r = b.boundR;
      const x0 = Math.floor((b.pos.x - r) / this.cell), x1 = Math.floor((b.pos.x + r) / this.cell);
      const z0 = Math.floor((b.pos.z - r) / this.cell), z1 = Math.floor((b.pos.z + r) / this.cell);
      for (let gz = z0; gz <= z1; gz++) for (let gx = x0; gx <= x1; gx++) {
        const k = gx * 92837111 ^ gz * 689287499;
        let arr = this.grid.get(k);
        if (!arr) { arr = this.gridPool.pop() || []; this.grid.set(k, arr); }
        arr.push(b);
      }
    }
  }

  // ---------------------------------------------------------------------------
  addContact(a, b, px, py, pz, nx, ny, nz, pen, feat, vbx = 0, vby = 0, vbz = 0, mu = -1) {
    if (this.nC >= MAX_CONTACTS) return;
    if (pen > 1.5) pen = 1.5;
    const c = this.contacts[this.nC++];
    c.a = a; c.b = b;
    c.p.set(px, py, pz); c.n.set(nx, ny, nz); c.pen = pen;
    c.vb.set(vbx, vby, vbz);
    c.mu = mu >= 0 ? mu : Math.sqrt(a.friction * (b ? b.friction : 0.7));
    c.restitution = Math.max(a.restitution, b ? b.restitution : 0.1);
    c.key = a.id * 8192 + (b ? b.id % 8000 : 8191 - (feat >> 8 & 255));
    a.contactCount++; if (ny > 0.6) a.groundN++;
    if (b) { b.contactCount++; if (-ny > 0.6) b.groundN++; }
    // wake on contact with a moving body
    if (b && b.sleeping && (a.vel.lengthSq() + a.angVel.lengthSq() > 0.2 || (a.kinematic && isAwake(a)))) b.wake();
    if (b && a.sleeping && (b.vel.lengthSq() + b.angVel.lengthSq() > 0.2 || (b.kinematic && isAwake(b)))) a.wake();
  }

  // probe (sphere at p with radius pr) of body a against a static collider
  collideTerrain(a) {
    const hf = this.hf;
    const p = a.pos, r = a.boundR;
    const hc = hf.getHeight(p.x, p.z);
    if (p.y - r > hc + r + 1.5) return;
    hf.getNormal(p.x, p.z, nrmOut);
    this._a = a; this._mode = 0;
    this.probeShape(a, 0, true);
  }

  collideStatics(a) {
    if (!this.getStatics) return;
    const list = this.getStatics(a.pos.x, a.pos.z, a.boundR + 0.5, this.statOut, a.group);
    if (!list || !list.length) return;
    const p = a.pos;
    for (let si = 0; si < list.length; si++) {
      const c = list[si];
      if (c.body === a) continue;
      // vertical cull
      const top = c.type === 'sphere' ? c.y + c.r : c.y + (c.hyB ?? c.hy);
      const bot = c.type === 'sphere' ? c.y - c.r : c.y - (c.hyB ?? c.hy);
      if (p.y - a.boundR > top || p.y + a.boundR < bot) continue;
      const sid = (c._sid ??= (c._id ?? si) % 200 + 3800);
      const feat0 = (sid % 255) << 8;
      const mu = c.friction ?? -1;
      if (a.shape === 'box' && c.type === 'box') {
        const R = c.R || yawR(c.rotY);
        const Rc = Rtmp2; for (let i = 0; i < 9; i++) Rc[i] = R[i];
        P1[0] = a.pos.x; P1[1] = a.pos.y; P1[2] = a.pos.z; H1[0] = a.hx; H1[1] = a.hy; H1[2] = a.hz;
        P2[0] = c.x; P2[1] = c.y; P2[2] = c.z; H2[0] = c.hx; H2[1] = c.hy; H2[2] = c.hz;
        this._a = a; this._b = null; this._feat0 = feat0; this._mu = mu;
        boxBox(P1, a.R, H1, P2, Rc, H2, this._emitBB);
        continue;
      }
      this._a = a; this._c = c; this._feat0 = feat0; this._mu = mu;
      this.probeShape(a, 1);
    }
  }

  // probe dispatcher: mode 0 terrain, 1 static collider, 2 a->b body, 3 b->a body
  probe(mode, x, y, z, pr, feat) {
    const a = this._a;
    if (mode === 0) {
      const h = this.hf.getHeight(x, z);
      const d = (y - h) * nrmOut.y;
      if (d < pr + MARGIN) this.addContact(a, null, x - nrmOut.x * pr, y - nrmOut.y * pr, z - nrmOut.z * pr, nrmOut.x, nrmOut.y, nrmOut.z, pr - d, feat);
    } else if (mode === 1) {
      const d = sdStatic(this._c, x, y, z);
      if (d < pr + MARGIN) this.addContact(a, null, x - sd.nx * pr, y - sd.ny * pr, z - sd.nz * pr, sd.nx, sd.ny, sd.nz, pr - d, this._feat0 | feat, 0, 0, 0, this._mu);
    } else if (mode === 2) {
      const d = sdBody(this._b, x, y, z);
      if (d < pr + MARGIN) this.addContact(a, this._b, x - sd.nx * pr, y - sd.ny * pr, z - sd.nz * pr, sd.nx, sd.ny, sd.nz, pr - d, feat);
    } else {
      const d = sdBody(a, x, y, z);
      if (d < pr + MARGIN) this.addContact(a, this._b, x - sd.nx * pr, y - sd.ny * pr, z - sd.nz * pr, -sd.nx, -sd.ny, -sd.nz, pr - d, 64 + feat);
    }
  }
  // run the probe over a body's sample points (corners only for terrain)
  probeShape(a, mode, cornersOnly = false) {
    const p = a.pos;
    if (a.shape === 'sphere') { this.probe(mode, p.x, p.y, p.z, a.r, 1); return; }
    const R = a.R;
    if (a.shape === 'capsule') {
      const ax = R[3] * a.hh, ay = R[4] * a.hh, az = R[5] * a.hh;
      this.probe(mode, p.x + ax, p.y + ay, p.z + az, a.r, 1);
      this.probe(mode, p.x - ax, p.y - ay, p.z - az, a.r, 2);
      this.probe(mode, p.x, p.y, p.z, a.r, 3);
      return;
    }
    let f = 1;
    for (let i = -1; i <= 1; i += 2) for (let j = -1; j <= 1; j += 2) for (let k = -1; k <= 1; k += 2) {
      this.probe(mode, p.x + R[0] * a.hx * i + R[3] * a.hy * j + R[6] * a.hz * k,
            p.y + R[1] * a.hx * i + R[4] * a.hy * j + R[7] * a.hz * k,
            p.z + R[2] * a.hx * i + R[5] * a.hy * j + R[8] * a.hz * k, 0, f++);
    }
    if (cornersOnly) return;
    // edge midpoints
    for (let ax = 0; ax < 3; ax++) {
      const u = (ax + 1) % 3, v = (ax + 2) % 3;
      const hu = u === 0 ? a.hx : u === 1 ? a.hy : a.hz, hv = v === 0 ? a.hx : v === 1 ? a.hy : a.hz;
      for (let i = -1; i <= 1; i += 2) for (let j = -1; j <= 1; j += 2) {
        this.probe(mode, p.x + R[u * 3] * hu * i + R[v * 3] * hv * j,
              p.y + R[u * 3 + 1] * hu * i + R[v * 3 + 1] * hv * j,
              p.z + R[u * 3 + 2] * hu * i + R[v * 3 + 2] * hv * j, 0, f++);
      }
    }
  }

  collidePair(a, b) {
    // a probes against b, then b probes against a (normals flipped) — handles all shape pairs
    this._a = a; this._b = b;
    if (a.shape === 'sphere') { this.probe(2, a.pos.x, a.pos.y, a.pos.z, a.r, 1); return; }
    if (b.shape === 'sphere') { this.probe(3, b.pos.x, b.pos.y, b.pos.z, b.r, 1); return; }
    if (a.shape === 'capsule' && b.shape === 'capsule') {
      segSeg(a, b);
      this.probe(2, _ssA.x, _ssA.y, _ssA.z, a.r, 9);
      this.probeShape(a, 2);
      return;
    }
    if (a.shape === 'box' && b.shape === 'box') {
      P1[0] = a.pos.x; P1[1] = a.pos.y; P1[2] = a.pos.z; H1[0] = a.hx; H1[1] = a.hy; H1[2] = a.hz;
      P2[0] = b.pos.x; P2[1] = b.pos.y; P2[2] = b.pos.z; H2[0] = b.hx; H2[1] = b.hy; H2[2] = b.hz;
      this._feat0 = 0;
      boxBox(P1, a.R, H1, P2, b.R, H2, this._emitBB);
      return;
    }
    this.probeShape(a, 2);
    this.probeShape(b, 3);
  }

  // ---------------------------------------------------------------------------
  preSolve(h) {
    const prevMap = this.prevMap, prev = this.prev;
    let lastK = -1;
    for (let i = 0; i < this.nPrev; i++) { const k = prev[i].key; prev[i].used = false; if (k !== lastK) { prevMap.set(k, i); lastK = k; } }
    for (let i = 0; i < this.nC; i++) {
      const c = this.contacts[i], a = c.a, b = c.b;
      c.rA.subVectors(c.p, a.pos);
      if (b) c.rB.subVectors(c.p, b.pos); else c.rB.set(0, 0, 0);
      // relative velocity
      relVel(c, _v1);
      const vn = _v1.dot(c.n);
      // tangents
      _v2.copy(_v1).addScaledVector(c.n, -vn);
      if (_v2.lengthSq() > 1e-6) c.t1.copy(_v2).normalize();
      else { if (Math.abs(c.n.x) < 0.57) c.t1.set(1, 0, 0); else c.t1.set(0, 1, 0); c.t1.addScaledVector(c.n, -c.t1.dot(c.n)).normalize(); }
      c.t2.crossVectors(c.n, c.t1);
      c.kN = effMass(c, c.n, c.rAn, c.rBn);
      c.kT1 = effMass(c, c.t1, c.rAt1, c.rBt1);
      c.kT2 = effMass(c, c.t2, c.rAt2, c.rBt2);
      c.bounce = vn < -1.4 && c.pen > -0.01 ? -c.restitution * vn : 0;
      if (c.pen < 0) c.bounce = -1e9;
      // penetrating: Baumgarte push-out; separated (speculative): allow closing the gap this step
      c.bias = c.pen >= 0 ? Math.min(4, (this.beta ?? 0.2) / h * Math.max(0, c.pen - this.slop)) : c.pen / h;
      // impact reporting
      if (vn < -2.5 && c.pen > -0.01) {
        const sp = -vn;
        if (sp > a.maxImpact) a.maxImpact = sp;
        if (b && sp > b.maxImpact) b.maxImpact = sp;
        for (const l of this.listeners) l(a, b, sp, c.p);
      }
      // warm start
      let pi = prevMap.get(c.key);
      c.jn = 0; c.jt1 = 0; c.jt2 = 0;
      if (pi !== undefined && !this.noWarm) {
        // nearest previous contact of the same pair (feature order is not stable)
        let bd = 0.0064, bj = -1;
        for (let j = pi; j < this.nPrev && prev[j].key === c.key; j++) {
          if (prev[j].used) continue;
          const d2 = prev[j].p.distanceToSquared(c.p);
          if (d2 < bd) { bd = d2; bj = j; }
        }
        pi = bj;
      } else pi = -1;
      if (pi >= 0) {
        const pc = prev[pi]; pc.used = true;
        c.jn = pc.jn * (this.wf ?? 0.9);
        if (c.jn > 0) applyImp(c, c.n, c.rAn, c.rBn, c.jn);
        c.jt1 = this.noFW ? 0 : pc.ft.dot(c.t1) * 0.9; c.jt2 = this.noFW ? 0 : pc.ft.dot(c.t2) * 0.9;
        const lim = c.mu * c.jn;
        c.jt1 = Math.max(-lim, Math.min(lim, c.jt1)); c.jt2 = Math.max(-lim, Math.min(lim, c.jt2));
        if (c.jt1) applyImp(c, c.t1, c.rAt1, c.rBt1, c.jt1);
        if (c.jt2) applyImp(c, c.t2, c.rAt2, c.rBt2, c.jt2);
      }
    }
    prevMap.clear();
  }

  finishSolve() {
    for (let i = 0; i < this.nC; i++) { const c = this.contacts[i]; c.ft.copy(c.t1).multiplyScalar(c.jt1).addScaledVector(c.t2, c.jt2); }
  }
  solveVel() {
    for (let i = 0; i < this.nC; i++) {
      const c = this.contacts[i];
      relVel(c, _v1);
      // normal
      const vn = _v1.dot(c.n);
      let dj = (-vn + (c.bounce > c.bias ? c.bounce : c.bias)) / c.kN;
      const jn0 = c.jn; c.jn = Math.max(0, jn0 + dj); dj = c.jn - jn0;
      if (dj !== 0) applyImp(c, c.n, c.rAn, c.rBn, dj);
      // friction
      const lim = c.mu * c.jn;
      relVel(c, _v1);
      let vt = _v1.dot(c.t1);
      let dt1 = -vt / c.kT1; const j1 = c.jt1; c.jt1 = Math.max(-lim, Math.min(lim, j1 + dt1)); dt1 = c.jt1 - j1;
      if (dt1 !== 0) applyImp(c, c.t1, c.rAt1, c.rBt1, dt1);
      vt = _v1.dot(c.t2);
      let dt2 = -vt / c.kT2; const j2 = c.jt2; c.jt2 = Math.max(-lim, Math.min(lim, j2 + dt2)); dt2 = c.jt2 - j2;
      if (dt2 !== 0) applyImp(c, c.t2, c.rAt2, c.rBt2, dt2);
    }
  }

  // ---------------------------------------------------------------------------
  // queries
  raycast(origin, dir, maxDist = 100, opts = {}) {
    // returns {body, collider, point, normal, distance} or null
    let best = maxDist, hitB = null, hitC = null;
    const nrm = _rcN;
    const groupOk = b => opts.group === undefined ? true : b.group === opts.group;
    if (opts.bodies !== false) {
      for (const b of this.bodies) {
        if (opts.filter && !opts.filter(b)) continue;
        if (!groupOk(b)) continue;
        // bounding sphere reject
        _v1.subVectors(b.pos, origin);
        const t0 = _v1.dot(dir), r = b.boundR;
        if (t0 < -r || t0 - r > best) continue;
        if (_v1.lengthSq() - t0 * t0 > r * r) continue;
        const t = rayBody(b, origin, dir, best, _v3);
        if (t !== null && t < best) { best = t; hitB = b; nrm.copy(_v3); hitC = null; }
      }
    }
    if (opts.statics !== false && this.getStatics) {
      // march query along the ray in 6 m steps for static colliders
      const step = 6;
      const seen = _rcSeen; seen.clear();
      for (let s = 0; s <= best + step; s += step) {
        const px = origin.x + dir.x * s, pz = origin.z + dir.z * s;
        const list = this.getStatics(px, pz, step, this.statOut, opts.group ?? this.activeGroup);
        for (const c of list) {
          if (seen.has(c) || c.body) continue; seen.add(c);
          const t = rayStatic(c, origin, dir, best, _v3);
          if (t !== null && t < best) { best = t; hitC = c; hitB = null; nrm.copy(_v3); }
        }
        if (s > best) break;
      }
    }
    if (opts.terrain !== false && !(opts.group > 0)) {
      const t = rayTerrain(this.hf, origin, dir, best);
      if (t !== null && t < best) {
        best = t; hitB = null; hitC = null;
        this.hf.getNormal(origin.x + dir.x * t, origin.z + dir.z * t, nrmOut);
        nrm.set(nrmOut.x, nrmOut.y, nrmOut.z);
        return { body: null, collider: null, terrain: true, distance: t, point: new THREE.Vector3().copy(origin).addScaledVector(dir, t), normal: nrm.clone() };
      }
    }
    if (!hitB && !hitC) return null;
    return { body: hitB, collider: hitC, terrain: false, distance: best, point: new THREE.Vector3().copy(origin).addScaledVector(dir, best), normal: nrm.clone() };
  }

  overlapSphere(pos, r, out = [], group) {
    out.length = 0;
    for (const b of this.bodies) {
      if (group !== undefined && b.group !== group) continue;
      const rr = r + b.boundR;
      if (b.pos.distanceToSquared(pos) > rr * rr) continue;
      if (sdBody(b, pos.x, pos.y, pos.z) < r) out.push(b);
    }
    return out;
  }
}
const Rtmp2 = new Float32Array(9);
const P1 = [0, 0, 0], P2 = [0, 0, 0], H1 = [0, 0, 0], H2 = [0, 0, 0];
const _rcN = new THREE.Vector3();
const _rcSeen = new Set();
const _ssA = new THREE.Vector3(), _ssB = new THREE.Vector3();

function segSeg(a, b) {
  const Ra = a.R, Rb = b.R;
  const p1x = a.pos.x - Ra[3] * a.hh, p1y = a.pos.y - Ra[4] * a.hh, p1z = a.pos.z - Ra[5] * a.hh;
  const d1x = Ra[3] * 2 * a.hh, d1y = Ra[4] * 2 * a.hh, d1z = Ra[5] * 2 * a.hh;
  const p2x = b.pos.x - Rb[3] * b.hh, p2y = b.pos.y - Rb[4] * b.hh, p2z = b.pos.z - Rb[5] * b.hh;
  const d2x = Rb[3] * 2 * b.hh, d2y = Rb[4] * 2 * b.hh, d2z = Rb[5] * 2 * b.hh;
  const rx = p1x - p2x, ry = p1y - p2y, rz = p1z - p2z;
  const A = d1x * d1x + d1y * d1y + d1z * d1z, E = d2x * d2x + d2y * d2y + d2z * d2z;
  const F = d2x * rx + d2y * ry + d2z * rz, C = d1x * rx + d1y * ry + d1z * rz;
  const B = d1x * d2x + d1y * d2y + d1z * d2z;
  const den = A * E - B * B;
  let s = den > 1e-8 ? Math.max(0, Math.min(1, (B * F - C * E) / den)) : 0;
  let t = (B * s + F) / E;
  if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -C / A)); }
  else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (B - C) / A)); }
  _ssA.set(p1x + d1x * s, p1y + d1y * s, p1z + d1z * s);
  _ssB.set(p2x + d2x * t, p2y + d2y * t, p2z + d2z * t);
}

function isAwake(x) {
  return x.invMass > 0 ? !x.sleeping : x.kinematic && (x.vel.lengthSq() + x.angVel.lengthSq() > 1e-6);
}
const _rv = new THREE.Vector3();
function relVel(c, out) {
  const a = c.a, b = c.b;
  out.crossVectors(a.angVel, c.rA).add(a.vel);
  if (b) { _rv.crossVectors(b.angVel, c.rB).add(b.vel); out.sub(_rv); }
  else out.sub(c.vb);
  return out;
}
const _em = new THREE.Vector3();
function effMass(c, n, rAn, rBn) {
  const a = c.a, b = c.b;
  rAn.crossVectors(c.rA, n);
  let k = a.sleeping ? 0 : a.invMass;
  if (k > 0) { mulInvI(a, rAn, _em); k += _em.dot(rAn); }
  if (b) {
    rBn.crossVectors(c.rB, n);
    if (b.invMass > 0 && !b.sleeping) { mulInvI(b, rBn, _em); k += b.invMass + _em.dot(rBn); }
  }
  return k > 1e-9 ? k : 1e9;
}
function applyImp(c, n, rAn, rBn, j) {
  const a = c.a, b = c.b;
  if (a.invMass > 0 && !a.sleeping) {
    a.vel.addScaledVector(n, j * a.invMass);
    mulInvI(a, rAn, _em); a.angVel.addScaledVector(_em, j);
  }
  if (b && b.invMass > 0 && !b.sleeping) {
    b.vel.addScaledVector(n, -j * b.invMass);
    mulInvI(b, rBn, _em); b.angVel.addScaledVector(_em, -j);
  }
}

// ---------------------------------------------------------------------------
// ray helpers (dir normalised). Return t or null; normal in outN.
function rayBoxLocal(ox, oy, oz, dx, dy, dz, hx, hy, hz, maxT, nOut) {
  let tmin = -Infinity, tmax = Infinity, axis = -1, sgn = 1;
  const o = [ox, oy, oz], d = [dx, dy, dz], hs = [hx, hy, hz];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (o[i] < -hs[i] || o[i] > hs[i]) return null; continue; }
    let t1 = (-hs[i] - o[i]) / d[i], t2 = (hs[i] - o[i]) / d[i], s = -1;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = i; sgn = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmin < 0 || tmin > maxT || axis < 0) return null;
  nOut[0] = 0; nOut[1] = 0; nOut[2] = 0; nOut[axis] = sgn;
  return tmin;
}
const _nl = [0, 0, 0];
function rayOBB(cx, cy, cz, R, hx, hy, hz, o, d, maxT, outN) {
  const px = o.x - cx, py = o.y - cy, pz = o.z - cz;
  const t = rayBoxLocal(px * R[0] + py * R[1] + pz * R[2], px * R[3] + py * R[4] + pz * R[5], px * R[6] + py * R[7] + pz * R[8],
    d.x * R[0] + d.y * R[1] + d.z * R[2], d.x * R[3] + d.y * R[4] + d.z * R[5], d.x * R[6] + d.y * R[7] + d.z * R[8], hx, hy, hz, maxT, _nl);
  if (t === null) return null;
  outN.set(R[0] * _nl[0] + R[3] * _nl[1] + R[6] * _nl[2], R[1] * _nl[0] + R[4] * _nl[1] + R[7] * _nl[2], R[2] * _nl[0] + R[5] * _nl[1] + R[8] * _nl[2]);
  return t;
}
function raySphere(cx, cy, cz, r, o, d, maxT, outN) {
  const ox = o.x - cx, oy = o.y - cy, oz = o.z - cz;
  const b = ox * d.x + oy * d.y + oz * d.z, c = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - c; if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t < 0 || t > maxT) return null;
  outN.set(ox + d.x * t, oy + d.y * t, oz + d.z * t).divideScalar(r);
  return t;
}
function rayBody(b, o, d, maxT, outN) {
  if (b.shape === 'sphere') return raySphere(b.pos.x, b.pos.y, b.pos.z, b.r, o, d, maxT, outN);
  if (b.shape === 'capsule') {
    // sphere-march (capsules are small)
    let t = 0;
    for (let i = 0; i < 48 && t < maxT; i++) {
      const dd = sdBody(b, o.x + d.x * t, o.y + d.y * t, o.z + d.z * t);
      if (dd < 0.01) { outN.set(sd.nx, sd.ny, sd.nz); return t; }
      t += dd;
    }
    return null;
  }
  return rayOBB(b.pos.x, b.pos.y, b.pos.z, b.R, b.hx, b.hy, b.hz, o, d, maxT, outN);
}
function rayStatic(c, o, d, maxT, outN) {
  if (c.type === 'sphere') return raySphere(c.x, c.y, c.z, c.r, o, d, maxT, outN);
  if (c.type === 'box') return rayOBB(c.x, c.y, c.z, c.R || yawR(c.rotY), c.hx, c.hy, c.hz, o, d, maxT, outN);
  if (c.type === 'cylinder') {
    let t = 0;
    for (let i = 0; i < 40 && t < maxT; i++) {
      const dd = sdStatic(c, o.x + d.x * t, o.y + d.y * t, o.z + d.z * t);
      if (dd < 0.01) { outN.set(sd.nx, sd.ny, sd.nz); return t; }
      t += Math.max(dd, 0.02);
    }
  }
  return null;
}
function rayTerrain(hf, o, d, maxT) {
  let t = 0, prevT = 0, prevD = o.y - hf.getHeight(o.x, o.z);
  if (prevD < 0) return 0;
  const step = 1.0;
  while (t < maxT) {
    t = Math.min(maxT, t + Math.max(step, prevD * 0.5));
    const y = o.y + d.y * t, h = hf.getHeight(o.x + d.x * t, o.z + d.z * t), dd = y - h;
    if (dd < 0) {
      // bisect
      let a = prevT, b = t;
      for (let i = 0; i < 8; i++) { const m = (a + b) / 2; if (o.y + d.y * m - hf.getHeight(o.x + d.x * m, o.z + d.z * m) < 0) b = m; else a = m; }
      return (a + b) / 2;
    }
    prevT = t; prevD = dd;
    if (t >= maxT) break;
  }
  return null;
}

export { sdBody, sdStatic, sd, yawR };
