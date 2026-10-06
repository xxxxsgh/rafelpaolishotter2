// World items owned by combat: dropped weapons, monster-part loot, blastcap bombs and blast
// barrels (kickable, throwable, chain-reacting explosives), plus camp loot chests.
import * as THREE from 'three';
import { Builder, G } from './geo.js';
import { makeToon, makeOutline } from './toon.js';
import { buildWeaponMesh, makeWeapon, WEAPONS } from './weapons.js';
import { blastBarrelGeometry, blastcapGeometry } from './camps.js';

export const MATERIALS = {
  gnarl_horn:   { name: 'Gnarl Horn', color: 0xeee0bd },
  gnarl_fang:   { name: 'Gnarl Fang', color: 0xf6ecd2 },
  shell_plate:  { name: 'Shellback Plate', color: 0x2a4f6e },
  beetle_horn:  { name: 'Beetle Horn', color: 0x1e2430 },
  warden_core:  { name: 'Warden Core', color: 0xffb24a, emit: 1 },
  mossy_stone:  { name: 'Mossy Heartstone', color: 0x7a9a4a },
  wisp_essence: { name: 'Wisp Essence', color: 0xfff1b0, emit: 1 },
  roast_haunch: { name: 'Roast Haunch', color: 0x8a4a28 },
  arrow_bundle: { name: 'Arrow Bundle', color: 0xc8a06a },
};

function materialGeometry(id) {
  const b = new Builder();
  const M = MATERIALS[id] || MATERIALS.gnarl_horn;
  if (id === 'gnarl_horn' || id === 'beetle_horn') b.add(G.horn(0.28, 0.05, 0.1), { rot: [0, 0, 1.2], color: M.color, color2: 0x8a7a62, grad: (x, y) => 1 - y * 3 });
  else if (id === 'gnarl_fang') b.add(G.cone(0.04, 0.16, 6), { rot: [0, 0, 1.4], color: M.color });
  else if (id === 'shell_plate') b.add(G.sphere(0.16, 10, 6), { scl: [1, 0.3, 1.3], color: M.color, color2: 0x4fa3a6, grad: (x, y) => y * 8 });
  else if (id === 'warden_core') { b.add(G.ico(0.12, 0), { color: M.color, emit: 1, flat: true }); b.add(G.torus(0.13, 0.025, 5, 12), { color: 0x6f6a60 }); }
  else if (id === 'mossy_stone') b.add(G.rock(0.13, 1, 0.25, 3), { color: 0x9c9584, colorFn: (x, y) => y > 0.03 ? 0x6f9c3a : null });
  else if (id === 'wisp_essence') b.add(G.ico(0.09, 1), { color: M.color, emit: 1 });
  else if (id === 'roast_haunch') { b.add(G.sphere(0.12, 10, 8), { scl: [1.3, 0.9, 0.9], color: M.color }); b.add(G.cyl(0.025, 0.025, 0.14, 6), { pos: [0.18, 0, 0], rot: [0, 0, 1.57], color: 0xeee2c4 }); }
  else for (let i = 0; i < 5; i++) b.add(G.cyl(0.01, 0.01, 0.6, 4), { pos: [(i - 2) * 0.02, 0.02, 0], rot: [1.57, 0, 0.1 * (i - 2)], color: M.color });
  return b.build();
}

export function createItems(ctx, sys) {
  const { scene, world, events } = ctx;
  const fx = sys.fx;
  const list = [];
  const root = new THREE.Group(); root.name = 'combat-items'; scene.add(root);
  const matCache = new Map();
  const toonShared = makeToon(ctx, { rim: 1.2 });
  const outShared = makeOutline(ctx, { width: 0.0018 });
  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
  const player = () => ctx.systems.player;

  function addItem(it) { it.alive = true; it.t = 0; it.rest = false; list.push(it); root.add(it.mesh); return it; }

  function dropWeapon(w, pos, vel) {
    if (!w) return null;
    const mesh = buildWeaponMesh(ctx, w.id);
    mesh.position.copy(pos);
    return addItem({ type: 'weapon', weapon: w, mesh, pos: mesh.position, vel: vel.clone(), radius: 0.12, spin: new THREE.Vector3(Math.random() * 8, Math.random() * 4, 0), flatten: true });
  }
  function dropMaterial(id, pos, vel) {
    let g = matCache.get(id); if (!g) { g = materialGeometry(id); matCache.set(id, g); }
    const mesh = new THREE.Group();
    const m = new THREE.Mesh(g, toonShared); m.castShadow = true;
    mesh.add(m, new THREE.Mesh(g, outShared));
    mesh.position.copy(pos);
    return addItem({ type: 'material', id, mesh, pos: mesh.position, vel: vel.clone(), radius: 0.1, spin: new THREE.Vector3(Math.random() * 6, Math.random() * 6, 0), flatten: true });
  }
  function spawnBomb(x, z, o = {}) {
    const g = blastcapGeometry();
    const mat = makeToon(ctx, { rim: 1.1, emitColor: 0xffd090 });
    const mesh = new THREE.Group();
    const m = new THREE.Mesh(g, mat); m.castShadow = true;
    mesh.add(m, new THREE.Mesh(g, outShared));
    mesh.position.set(x, o.y ?? world.getHeight(x, z), z);
    return addItem({ type: 'bomb', mesh, mat, pos: mesh.position, vel: o.vel ? o.vel.clone() : new THREE.Vector3(), radius: 0.22, fuse: o.fuse ?? -1, roll: true, camp: o.camp || null });
  }
  function spawnBarrel(x, z, o = {}) {
    const g = blastBarrelGeometry();
    const mat = makeToon(ctx, { rim: 0.9 });
    const mesh = new THREE.Group();
    const m = new THREE.Mesh(g, mat); m.castShadow = true;
    mesh.add(m, new THREE.Mesh(g, outShared));
    mesh.position.set(x, world.getHeight(x, z), z);
    mesh.rotation.y = Math.random() * 6;
    return addItem({ type: 'barrel', mesh, mat, pos: mesh.position, vel: new THREE.Vector3(), radius: 0.4, fuse: -1, heavy: true });
  }

  function light(it, fuse) {
    if (it.fuse >= 0) { it.fuse = Math.min(it.fuse, fuse); return; }
    it.fuse = fuse;
    events.emit('fuseLit', { position: it.pos.clone() });
  }
  function explode(it) {
    if (!it.alive) return;
    it.alive = false; root.remove(it.mesh);
    const p = _v.copy(it.pos); p.y += 0.3;
    const R = it.type === 'barrel' ? 5 : 4;
    fx.explosion(p, it.type === 'barrel' ? 1.3 : 1);
    sys.shake(0.8, p);
    events.emit('explosion', { position: p.clone(), radius: R });
    sys.noise?.(14);
    // hurt everything nearby
    const pl = player();
    if (pl) {
      const d = pl.position.distanceTo(p);
      if (d < R) {
        _v2.subVectors(pl.position, p).setY(0).normalize();
        sys.damagePlayer(Math.ceil(3 * (1 - d / R)) + 1, { type: 'explosion', source: 'explosion', knockback: _v2.set(_v2.x * 12, 7, _v2.z * 12), position: p });
      }
    }
    for (const e of sys.enemies.list) {
      if (e.dead) continue;
      const d = e.pos.distanceTo(p);
      if (d < R + e.c.radius) {
        _v2.subVectors(e.pos, p).setY(0).normalize();
        sys.enemies.hurt(e, 12 * (1 - d / (R + e.c.radius)) + 3, { type: 'explosion', from: p, knock: _v2.multiplyScalar(14), strong: true, point: e.lockPoint.getWorldPosition(new THREE.Vector3()) });
      }
    }
    // chain reaction
    for (const o of list) if (o.alive && (o.type === 'bomb' || o.type === 'barrel') && o.pos.distanceTo(p) < R) light(o, 0.15 + Math.random() * 0.25);
    impulse(p, R + 2, 7);
    ctx.systems.physics?.applyExplosion?.(p, R, 12);
  }

  function impulse(p, R, s) {
    for (const it of list) {
      if (!it.alive) continue;
      const d = it.pos.distanceTo(p);
      if (d < R && d > 0.01) {
        const k = (1 - d / R) * s / (it.heavy ? 3 : 1);
        it.vel.x += (it.pos.x - p.x) / d * k; it.vel.z += (it.pos.z - p.z) / d * k; it.vel.y += k * 0.7;
        it.rest = false;
        if (it.type === 'bomb' && k > 2) light(it, 1.0);
      }
    }
  }
  // enemy kicks a bomb at the hero
  function kick(it, enemy, target) {
    if (!it || !it.alive) return;
    const dx = target.x - it.pos.x, dz = target.z - it.pos.z, d = Math.hypot(dx, dz) || 1;
    const sp = Math.min(13, 4 + d * 0.9);
    it.vel.set(dx / d * sp, it.heavy ? 1.5 : 3.5, dz / d * sp);
    it.rest = false;
    light(it, it.heavy ? 1.6 : 1.4);
    fx.dust(it.pos, 3, 0.5);
    events.emit('bombKicked', { position: it.pos.clone(), by: enemy?.id });
  }
  // player weapon / arrow strikes items
  function strike(p, r, dir, info = {}) {
    let any = false;
    for (const it of list) {
      if (!it.alive) continue;
      if (it.pos.distanceTo(p) > r + it.radius + 0.3) continue;
      if (it.type === 'bomb' || it.type === 'barrel') {
        if (info.type === 'arrow' || info.strong || it.type === 'bomb') light(it, it.type === 'barrel' ? 0.05 : 0.9);
        it.vel.x += (dir?.x || 0) * (it.heavy ? 2 : 8); it.vel.z += (dir?.z || 0) * (it.heavy ? 2 : 8); it.vel.y += it.heavy ? 0.5 : 3;
        it.rest = false; any = true;
      }
    }
    return any;
  }
  function throwBomb(from, dir, speed = 13) {
    return spawnBomb(from.x, from.z, { y: from.y, vel: new THREE.Vector3(dir.x * speed, dir.y * speed + 3.5, dir.z * speed), fuse: 3.2 });
  }

  function nearestWeapon(p, r) {
    let best = null, bd = r * r;
    for (const it of list) if (it.alive && it.type === 'weapon' && it.rest && !it.claimed) { const d = it.pos.distanceToSquared(p); if (d < bd) { bd = d; best = it; } }
    return best;
  }
  function nearestBomb(p, r) {
    let best = null, bd = r * r;
    for (const it of list) if (it.alive && (it.type === 'bomb' || it.type === 'barrel') && it.rest && it.fuse < 0) { const d = it.pos.distanceToSquared(p); if (d < bd) { bd = d; best = it; } }
    return best;
  }
  function nearestLit(p, r) {
    let best = null, bd = r * r;
    for (const it of list) if (it.alive && it.fuse >= 0 && it.fuse < 2.2) { const d = it.pos.distanceToSquared(p); if (d < bd) { bd = d; best = it; } }
    return best;
  }
  function take(it) {
    if (!it || !it.alive) return null;
    it.alive = false; root.remove(it.mesh);
    if (it.type === 'weapon') return it.weapon;
    return it;
  }
  function nearestPickup(p, r = 1.8) {
    let best = null, bd = r * r;
    for (const it of list) if (it.alive && (it.type === 'weapon' || it.type === 'bomb') && it.fuse < 0) { const d = it.pos.distanceToSquared(p); if (d < bd) { bd = d; best = it; } }
    return best;
  }

  function update(dt) {
    const pl = player();
    const t = ctx.uniforms.uTime.value;
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      if (!it.alive) { list.splice(i, 1); continue; }
      it.t += dt;
      // fuse
      if (it.fuse >= 0) {
        it.fuse -= dt;
        const blink = Math.sin(it.t * (it.fuse < 0.8 ? 40 : 16)) > 0;
        it.mat?.uniforms.uFlash.value.setRGB(blink ? 0.9 : 0, blink ? 0.4 : 0, 0);
        if (Math.random() < dt * 30) fx.spawnAdd({ x: it.pos.x, y: it.pos.y + (it.type === 'barrel' ? 0.95 : 0.42), z: it.pos.z, vx: (Math.random() - 0.5) * 2, vy: 2 + Math.random() * 2, vz: (Math.random() - 0.5) * 2, life: 0.3, size: 0.06, stretch: 0.03, r: 1, g: 0.8, b: 0.4, a: 1, grav: 5 });
        if (it.fuse <= 0) { explode(it); continue; }
      }
      if (!it.rest) {
        it.vel.y -= 18 * dt;
        it.pos.addScaledVector(it.vel, dt);
        const g = world.getHeight(it.pos.x, it.pos.z) + (it.type === 'weapon' ? 0.05 : 0);
        if (it.spin && it.pos.y > g + 0.05) { it.mesh.rotation.x += it.spin.x * dt; it.mesh.rotation.y += it.spin.y * dt; }
        if (it.pos.y <= g) {
          it.pos.y = g;
          if (it.vel.y < -3) { it.vel.y *= -0.35; if (it.type !== 'material') fx.dust(it.pos, 2, 0.35); }
          else it.vel.y = 0;
          const fr = it.roll ? 0.985 : 0.8;
          it.vel.x *= Math.pow(fr, dt * 60); it.vel.z *= Math.pow(fr, dt * 60);
          if (it.flatten) { it.mesh.rotation.x += (Math.PI / 2 * Math.sign(Math.sin(it.mesh.rotation.x) || 1) - it.mesh.rotation.x) * Math.min(1, dt * 10); }
          if (it.roll) {
            const sp = Math.hypot(it.vel.x, it.vel.z);
            it.mesh.rotation.z -= it.vel.x / it.radius * dt * 0.5; it.mesh.rotation.x += it.vel.z / it.radius * dt * 0.5;
            if (sp < 0.4) it.mesh.rotation.set(0, it.mesh.rotation.y, 0);
            // slopes
            world.getNormal(it.pos.x, it.pos.z, _n);
            it.vel.x += _n.x * 9 * dt; it.vel.z += _n.z * 9 * dt;
          }
          if (Math.hypot(it.vel.x, it.vel.y, it.vel.z) < 0.25) { it.vel.set(0, 0, 0); it.rest = true; if (it.flatten) it.mesh.rotation.x = Math.PI / 2; }
        }
        // bombs bump props
        if (it.type !== 'weapon') sys.pushOut(it.pos, it.radius);
      }
      // glints on loot so it reads in grass
      if ((it.type === 'weapon' || it.type === 'material') && it.rest) {
        it.glint = (it.glint ?? Math.random() * 2) - dt;
        if (it.glint <= 0) { it.glint = 1.6 + Math.random(); fx.spawnAdd({ x: it.pos.x, y: it.pos.y + 0.18, z: it.pos.z, life: 0.5, size: 0.25, size1: 0.6, cell: 2, r: 1, g: 0.95, b: 0.8, a: 0.9 }); }
        // materials: auto-collect when the hero walks over them
        if (it.type === 'material' && pl && it.t > 0.6 && pl.position.distanceToSquared(it.pos) < 1.4) collect(it);
      }
    }
  }
  const _n = { x: 0, y: 1, z: 0 };
  function collect(it) {
    it.alive = false; root.remove(it.mesh);
    const M = MATERIALS[it.id];
    const gp = ctx.systems.gameplay;
    let added = false;
    try { if (gp?.addItem) { gp.addItem(it.id, 1, { name: M?.name, kind: 'material', source: 'combat' }); added = true; } } catch (e) { /* gameplay optional */ }
    if (!added && it.id === 'arrow_bundle') sys.hero.inv.arrows += 5;
    events.emit('itemPickup', { id: it.id, name: M?.name || it.id, kind: 'material', count: 1, position: it.pos.clone() });
    fx.spawnAdd({ x: it.pos.x, y: it.pos.y + 0.3, z: it.pos.z, life: 0.35, size: 0.4, size1: 1.0, cell: 2, r: 1, g: 0.9, b: 0.6, a: 1 });
  }

  return { list, dropWeapon, dropMaterial, spawnBomb, spawnBarrel, throwBomb, kick, strike, impulse, explode, light, nearestWeapon, nearestBomb, nearestLit, nearestPickup, take, collect, update };
}
