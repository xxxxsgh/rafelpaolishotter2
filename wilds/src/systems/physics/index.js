// physics system — rigid bodies, interactable props, elemental interactions, Sanctums, Lodestone rune.
//
// API (ctx.systems.physics):
//   world                         the PhysicsWorld (engine.js)
//   addBody(opts) -> Body         {shape:'box'|'sphere'|'capsule', hx,hy,hz | r | r,hh, mass, kinematic, position, quaternion,
//                                  friction, restitution, material, group}
//   removeBody(body)
//   raycast(origin, dir, maxDist=100, {bodies, statics, terrain, filter, group}) -> {body, collider, terrain, point, normal, distance} | null
//   overlapSphere(pos, r, out=[]) -> bodies
//   applyImpulse(body, impulse(Vector3), point?)
//   explode(pos, radius=5, {force, fire}) ; ignite(x, y, z) ; extinguish(x, z, r)
//   strike(pos, dir, force=1, radius=1.2) -> bodies hit (melee/arrow hits push props, break crates)
//   spawnProp(type, {position, quaternion, scale}) -> prop   (crate, crateBig, barrel, boom, boulder, log, ironBlock, ironSlab, ironBall, ice, stoneCube)
//   queryColliders(x, z, r, out) -> colliders (props + sanctum architecture) in the terrain collider format
//   sanctums: list [{id, name, kind, x, z, solved}], enterSanctum(id), exitSanctum(), activeSanctum
//   rune: Lodestone ({active, held, setActive(bool)})
// Events emitted: shrineSolved {id, name, kind}, sanctumEnter/sanctumExit {id, name}, sanctumGateOpen {id}, plate {sanctum, pressed},
//   fireStart/fireSpread/grassBurnt/fireOut, explosion {position, radius}, propBroken, propIgnited, physicsImpact {position, speed, material},
//   iceMelted, runeToggle, runeGrab, interactPrompt {text}, itemPickup (chest reward).
// Sets ctx.indoor = {kind:'sanctum', id} while inside a sanctum (null outside) so sky/audio can react.
// Colliders marked noClimb:true (sanctum ward walls) should not be climbable.
import * as THREE from 'three';
import { PhysicsWorld, Body } from './engine.js';
import { createShared } from './materials.js';
import { Props, findSpot, groundQuat } from './props.js';
import { Particles } from './fx.js';
import { Elements } from './elements.js';
import { Sanctums } from './sanctum.js';
import { Lodestone } from './rune.js';
import { rng } from './geometry.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();

export async function init(ctx) {
  const { world } = ctx;
  const shared = createShared(ctx);
  const terrainOut = [];
  let sanctums = null;
  const getStatics = (x, z, r, out, group) => {
    out.length = 0;
    if (group > 0) return sanctums ? sanctums.queryStatics(x, z, r, out, group) : out;
    const t = ctx.systems.terrain?.queryColliders?.(x, z, r, terrainOut);
    if (t) for (let i = 0; i < t.length; i++) out.push(t[i]);
    if (sanctums) for (const c of sanctums.worldStatics) {
      const rr = (c.type === 'box' ? Math.hypot(c.hx, c.hz) : c.r) + r;
      if ((c.x - x) ** 2 + (c.z - z) ** 2 <= rr * rr) out.push(c);
    }
    return out;
  };
  const getWater = (x, z) => {
    const w = ctx.systems.water?.getWaterHeight?.(x, z);
    if (w !== undefined) return w;
    const s = world.getWaterSurface?.(x, z);
    return s > -1e8 ? s : null;
  };
  const phys = new PhysicsWorld({ world, getStatics, getWater });
  const fx = new Particles(ctx);
  const props = new Props(ctx, phys, shared);
  const elements = new Elements(ctx, phys, props, fx);
  sanctums = new Sanctums(ctx, phys, props, fx, shared);
  const rune = new Lodestone(ctx, phys, props, fx, shared);

  placeWorldProps(ctx, props, sanctums);

  // ------------------------------------------------------------------ player <-> props
  const near = [];
  const pushDir = new THREE.Vector3();
  function playerInteract(dt) {
    const pl = ctx.systems.player;
    if (!pl?.position) return;
    const p = pl.position;
    const mv = ctx.input?.move?.() || { x: 0, y: 0 };
    const moving = Math.hypot(mv.x, mv.y) > 0.3 || (pl.velocity && Math.hypot(pl.velocity.x, pl.velocity.z) > 1.2);
    if (!moving || pl.state === 'climb' || pl.state === 'glide') return;
    pushDir.set(Math.sin(pl.yaw), 0, Math.cos(pl.yaw));
    _v.set(p.x, p.y + 0.6, p.z);
    phys.overlapSphere(_v, 1.0, near, phys.activeGroup);
    for (const b of near) {
      if (b.invMass === 0 || rune.held?.body === b) continue;
      _v2.subVectors(b.pos, p); _v2.y = 0;
      const d = _v2.length(); if (d < 1e-3) continue;
      _v2.divideScalar(d);
      if (_v2.dot(pushDir) < 0.45) continue;
      if (b.pos.y - b.boundR > p.y + 1.2 || b.pos.y + b.boundR < p.y + 0.15) continue;   // standing on it / far above
      // push: light props slide, heavy ones barely budge (boulders on slopes start rolling)
      const strength = Math.min(b.mass, 140) * 5.5 * dt;
      b.applyImpulse(_v.copy(pushDir).multiplyScalar(strength), _v2.copy(b.pos).addScaledVector(pushDir, -b.boundR * 0.4));
    }
  }

  // ------------------------------------------------------------------ API
  const colOut = [], bodyNear = [];
  const api = {
    world: phys, props, elements, fx, sanctumsMgr: sanctums, rune, shared,
    addBody(o = {}) { const b = new Body(o); phys.add(b); if (o.mesh) b.mesh = o.mesh; return b; },
    removeBody(b) { phys.remove(b); },
    raycast(origin, dir, maxDist = 100, opts = {}) { return phys.raycast(origin, dir, maxDist, opts); },
    overlapSphere(pos, r, out = []) { return phys.overlapSphere(pos, r, out, phys.activeGroup); },
    applyImpulse(b, imp, point) { b?.applyImpulse(imp, point); },
    explode(pos, radius = 5, o = {}) { elements.explode(pos, radius, { group: phys.activeGroup || undefined, ...o }); },
    ignite(x, y, z, o) { return elements.ignite(x, y, z, o); },
    extinguish(x, z, r = 3) { elements.extinguish(x, z, r); },
    strike(pos, dir, force = 1, radius = 1.2) {
      const hit = phys.overlapSphere(pos, radius, [], phys.activeGroup);
      for (const b of hit) {
        if (b.invMass === 0) continue;
        _v.copy(dir).normalize(); _v.y = Math.max(_v.y, 0.25);
        b.applyImpulse(_v.multiplyScalar(Math.min(b.mass, 120) * 6 * force), pos);
        const p = b.userData.prop;
        if (p) { elements.damageProp(p, 12 * force); if (p.def.explosive && force > 0.5) p.fuse = p.fuse < 0 ? 0.4 : p.fuse; }
      }
      return hit;
    },
    spawnProp(type, o = {}) { return props.spawn(type, o); },
    queryColliders(x, z, r, out = colOut) {
      out.length = 0;
      const g = phys.activeGroup;
      if (g > 0) sanctums.queryStatics(x, z, r, out, g);
      else for (const c of sanctums.worldStatics) {
        const rr = (c.type === 'box' ? Math.hypot(c.hx, c.hz) : c.r) + r;
        if ((c.x - x) ** 2 + (c.z - z) ** 2 <= rr * rr) out.push(c);
      }
      if (g > 0) for (const c of sanctums.list[g - 1].statics) { /* already added */ }
      for (const b of phys.bodies) {
        if (b.group !== g || rune.held?.body === b) continue;
        const rr = b.boundR + r;
        const dx = b.pos.x - x, dz = b.pos.z - z;
        if (dx * dx + dz * dz > rr * rr) continue;
        out.push(b.collider);
      }
      return out;
    },
    get sanctums() { return sanctums.list.map(s => ({ id: s.id, name: s.name, kind: s.kind, x: s.x, z: s.z, y: s.y, solved: s.solved })); },
    get activeSanctum() { return sanctums.active ? sanctums.active.id : 0; },
    enterSanctum(id, o) { const s = sanctums.list.find(q => q.id === id || q.kind === id); if (s) sanctums.enter(s, o); },
    exitSanctum(o) { sanctums.exit(o); },
    debugShot(name) { debugShot(ctx, api, name); },
    update(dt) {
      if (ctx.paused) return;
      phys.focus.copy(ctx.focus);
      playerInteract(dt);
      phys.step(dt);
      props.sync(phys.alpha, ctx.camera.position);
      elements.update(dt);
      sanctums.update(dt);
      rune.update(dt);
      fx.update(dt);
    },
  };
  // other systems may hit props: combat 'hit' events with a position + direction
  ctx.events.on('hit', e => { if (e?.position && e?.direction) api.strike(e.position, e.direction, e.force ?? 1); });
  ctx.events.on('fireArrow', e => { if (e?.position) elements.ignite(e.position.x, e.position.y, e.position.z); });
  return api;
}

// ---------------------------------------------------------------------------
function placeWorldProps(ctx, props, sanctums) {
  const world = ctx.world;
  const R = rng(4242);
  const put = (type, spot, o = {}) => {
    if (!spot) return null;
    const def = props.constructor && null;
    const yaw = o.yaw ?? R() * Math.PI * 2;
    const q = new THREE.Quaternion();
    let y = spot.h;
    if (type === 'boulder') { const r = 1.2 * (o.scale ?? 1); y += r * 0.9; }
    else if (type === 'log') { q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)); y += 0.34; }
    else if (type === 'barrel' || type === 'boom') { groundQuat(spot.nx ?? 0, spot.ny ?? 1, spot.nz ?? 0, yaw, q); y += 0.56; }
    else {
      groundQuat(spot.nx ?? 0, spot.ny ?? 1, spot.nz ?? 0, yaw, q);
      const hy = { crate: 0.5, crateBig: 0.7, ironBlock: 0.6, ironSlab: 0.2, ice: 0.6, stoneCube: 0.65, ironBall: 0.42 }[type] ?? 0.5;
      y += hy + 0.01;
    }
    y += o.lift ?? 0;
    return props.spawn(type, { position: new THREE.Vector3(spot.x, y, spot.z), quaternion: q, scale: o.scale, variant: o.variant, sleeping: o.sleeping ?? true });
  };
  const at = (x, z) => ({ x, z, h: world.getHeight(x, z), nx: 0, ny: 1, nz: 0 });
  // supply cache near the starting meadow
  const camp = findSpot(world, 196, 288, 16, R, { minN: 0.97 });
  if (camp) {
    const { x, z } = camp;
    props.campSpot = camp;
    put('crate', at(x, z), { yaw: 0.3 });
    put('crate', at(x, z), { yaw: 0.5, lift: 1.0 });
    put('crate', at(x + 1.3, z + 0.2), { yaw: 0.1 });
    put('crateBig', at(x - 1.5, z + 1.2), { yaw: 0.8 });
    put('barrel', at(x + 1.0, z - 1.4));
    put('boom', at(x + 2.2, z - 0.6));
    put('log', at(x - 1.0, z - 2.6), { yaw: 0.2 });
    put('log', at(x - 1.0, z - 3.4), { yaw: 0.25 });
    put('log', at(x - 1.0, z - 3.0), { yaw: 0.22, lift: 0.6 });
  }
  // boulders perched on the plateau rim / slopes
  const P = world.FEATURES?.PLATEAU || { x: 60, z: 140, r: 560 };
  let nb = 0;
  for (let i = 0; i < 80 && nb < 9; i++) {
    const a = R() * Math.PI * 2, r = P.r * (0.86 + R() * 0.12);
    const s = findSpot(world, P.x + Math.cos(a) * r, P.z + Math.sin(a) * r, 25, R, { minN: 0.8, maxN: 0.95, tries: 12 });
    if (s) { put('boulder', s, { scale: 0.8 + R() * 0.7, variant: nb % 3 }); nb++; }
  }
  // ruins: iron relics
  const ruin = findSpot(world, 52, -130, 22, R, { minN: 0.93 });
  if (ruin) {
    put('ironBlock', at(ruin.x, ruin.z));
    put('ironBlock', at(ruin.x + 1.4, ruin.z + 0.4), { lift: 0 });
    put('ironBall', at(ruin.x - 2, ruin.z + 1.5));
    put('crate', at(ruin.x + 2.8, ruin.z - 1.2));
  }
  // forest: fallen logs
  for (let i = 0; i < 6; i++) { const s = findSpot(world, -820, 820, 90, R, { minN: 0.9 }); if (s) put('log', s, { variant: i % 3 }); }
  // mesa: explosive cache
  const mesa = findSpot(world, 1030, 930, 60, R, { minN: 0.95 });
  if (mesa) {
    put('boom', at(mesa.x, mesa.z)); put('boom', at(mesa.x + 1.0, mesa.z + 0.3)); put('boom', at(mesa.x + 0.4, mesa.z + 1.0));
    put('crate', at(mesa.x - 1.5, mesa.z)); put('crate', at(mesa.x - 1.5, mesa.z), { lift: 1.0 });
  }
  // snowfield: ice blocks (melt in sun / near fire)
  for (let i = 0; i < 3; i++) { const s = findSpot(world, -260, -1150, 160, R, { minN: 0.9, minH: 260 }); if (s) put('ice', s); }
  // lakeshore: barrels and a log that floats
  const lake = findSpot(world, -640, 150, 50, R, { minN: 0.95 });
  if (lake) { put('barrel', lake); put('log', at(lake.x + 2, lake.z + 1)); }
  // a few crates at each sanctum entrance
  for (const s of sanctums.list) {
    const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
    const px = s.x + 8.5 * c + 3 * sn, pz = s.z - 8.5 * sn + 3 * c;
    put('crate', at(px, pz)); put('barrel', at(px + 1.2 * c, pz - 1.2 * sn));
  }
}

// ---------------------------------------------------------------------------
// shot presets (see src/core/debug.js): frame the sanctum interior / entrance / props
function debugShot(ctx, api, name) {
  const S = api.sanctumsMgr;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  if (name === 'shrine' || name === 'sanctum-balance') {
    const s = S.list.find(q => q.kind === 'balance');
    S.enter(s, { instant: true });
    const O = s.origin;
    ctx.systems.player?.teleport?.(O.x + 1.2, O.z + 15.5, Math.PI - 0.15);
    if (ctx.systems.player?.position) ctx.systems.player.position.y = O.y;
    ctx.cameraOverride = { pos: V(O.x + 5.2, O.y + 4.3, O.z + 21.2), target: V(O.x - 1.4, O.y + 3.4, O.z - 9) };
  } else if (name === 'sanctum-lodestone') {
    const s = S.list.find(q => q.kind === 'lodestone');
    S.enter(s, { instant: true });
    const O = s.origin;
    ctx.systems.player?.teleport?.(O.x - 1.5, O.z + 2.5, Math.PI + 0.35);
    if (ctx.systems.player?.position) ctx.systems.player.position.y = O.y;
    const slab = s.props.find(p => p.type === 'ironSlab');
    if (slab) api.rune.debugHold(slab, V(O.x - 3.6, O.y + 2.6, O.z - 4.2));
    ctx.cameraOverride = { pos: V(O.x + 3.8, O.y + 3.4, O.z + 8.5), target: V(O.x - 2.4, O.y + 2.0, O.z - 6) };
  } else if (name === 'props') {
    const c = api.props.campSpot; if (!c) return;
    const h = ctx.world.getHeight(c.x, c.z);
    ctx.systems.player?.teleport?.(c.x + 4.5, c.z + 4.0, -2.4);
    const crate = api.props.list.find(p => p.type === 'crateBig');
    if (crate) api.elements.igniteProp(crate);
    for (let i = 0; i < 6; i++) api.elements.ignite(c.x - 3 - Math.random() * 3, null, c.z + 2 + Math.random() * 3);
    // pre-roll the fire so flames, smoke and spread are established for the capture
    for (let i = 0; i < 40; i++) { api.elements.update(0.1); api.fx.update(0.1); }
    // camera: the side with the highest ground (avoid looking up from below a cliff)
    let best = null;
    for (let a = 0; a < 16; a++) {
      const x = c.x + Math.cos(a * 0.3927) * 11, z = c.z + Math.sin(a * 0.3927) * 11, gh = ctx.world.getHeight(x, z);
      if (!best || gh > best.h) best = { x, z, h: gh };
    }
    ctx.cameraOverride = { pos: V(best.x, Math.max(best.h, h) + 3.4, best.z), target: V(c.x - 0.5, h + 0.9, c.z - 1) };
  } else if (name === 'sanctum-gate' || name === 'sanctum') {
    const s = S.list.find(q => q.kind === 'balance');
    const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
    const fwd = (d, side = 0, h = 0) => V(s.x + sn * d + c * side, s.y + h, s.z + c * d - sn * side);
    ctx.systems.player?.teleport?.(fwd(7.5, 1.6).x, fwd(7.5, 1.6).z, s.yaw + Math.PI);
    const cp = fwd(19, 7.5), tp = fwd(-2, -0.5);
    cp.y = Math.max(ctx.world.getHeight(cp.x, cp.z), s.y) + 2.6; tp.y = s.y + 4.4;
    ctx.cameraOverride = { pos: cp, target: tp };
  }
}
