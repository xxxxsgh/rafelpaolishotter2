// Projectiles: arrows (hero + archers; stick into terrain, can be parried back), Wisp
// elemental bolts (glowing, slightly homing), Stonewarden boulders (ballistic lob, ring impact).
import * as THREE from 'three';
import { arrowGeometry } from './weapons.js';
import { makeToon } from './toon.js';
import { G } from './geo.js';

export function createProjectiles(ctx, sys) {
  const { scene, world, events } = ctx;
  const fx = sys.fx;
  const arrows = [], bolts = [], boulders = [];
  const arrowMat = makeToon(ctx, { rim: 1.2 });
  const aGeo = arrowGeometry();
  const rockMat = makeToon(ctx, { rim: 0.8 });
  const rockGeo = (() => { const g = G.rock(0.7, 1, 0.25, 9); const c = new Float32Array(g.attributes.position.count * 3).fill(0.6); g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.setAttribute('emit', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count), 1)); return g; })();
  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _z = new THREE.Vector3(0, 0, 1);
  const player = () => ctx.systems.player;

  function arrow(from, to, o = {}) {
    let a = arrows.find(x => !x.alive);
    if (!a) {
      if (arrows.length > 60) { a = arrows.reduce((m, x) => (x.t > m.t ? x : m), arrows[0]); }
      else { a = { mesh: new THREE.Mesh(aGeo, arrowMat), pos: new THREE.Vector3(), vel: new THREE.Vector3(), prev: new THREE.Vector3() }; a.mesh.castShadow = true; scene.add(a.mesh); arrows.push(a); }
    }
    _d.subVectors(to, from).normalize();
    if (o.spread) { _d.x += (Math.random() - 0.5) * o.spread; _d.y += (Math.random() - 0.5) * o.spread; _d.z += (Math.random() - 0.5) * o.spread; _d.normalize(); }
    const sp = o.speed ?? 40;
    // compensate gravity a bit over the flight time
    const dist = from.distanceTo(to);
    const tf = dist / sp;
    a.pos.copy(from); a.prev.copy(from);
    a.vel.copy(_d).multiplyScalar(sp); a.vel.y += 0.5 * 9.8 * 0.6 * tf;
    a.owner = o.owner || 'player'; a.dmg = o.dmg ?? 4; a.alive = true; a.stuck = false; a.t = 0; a.mesh.visible = true;
    a.stuckTo = null; a.stuckEnemy = null;
    orient(a);
    return a;
  }
  function orient(a) {
    _v.copy(a.vel).normalize();
    _q.setFromUnitVectors(_z, _v);
    a.mesh.quaternion.copy(_q);
    a.mesh.position.copy(a.pos);
  }
  function segPointDist(a, b, p) {
    _v2.subVectors(b, a);
    const l2 = _v2.lengthSq();
    let t = l2 > 0 ? _v.subVectors(p, a).dot(_v2) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return _v.copy(a).addScaledVector(_v2, t).distanceTo(p);
  }

  function updateArrows(dt) {
    const pl = player();
    for (const a of arrows) {
      if (!a.alive) continue;
      a.t += dt;
      if (a.stuck) {
        if (a.stuckTo) { a.stuckTo.localToWorld(a.mesh.position.copy(a.local)); }
        if (a.t > 8 || (a.stuckEnemy && a.stuckEnemy.poofed)) { a.alive = false; a.mesh.visible = false; }
        continue;
      }
      a.prev.copy(a.pos);
      a.vel.y -= 9.8 * 0.6 * dt;
      a.pos.addScaledVector(a.vel, dt);
      orient(a);
      if (a.owner === 'player' && Math.random() < 0.6) fx.spawnAdd({ x: a.pos.x, y: a.pos.y, z: a.pos.z, life: 0.25, size: 0.06, size1: 0.01, cell: 0, r: 1, g: 0.95, b: 0.85, a: 0.5 });
      // hits
      if (a.owner === 'player') {
        let hit = null, best = 1e9, head = false;
        for (const e of sys.enemies.list) {
          if (e.dead || e.c.root.visible === false) continue;
          e.lockPoint.getWorldPosition(_d);
          const r = e.c.radius * 1.1 + 0.15;
          const d = segPointDist(a.prev, a.pos, _d);
          if (d < r + e.c.height * 0.25 && d < best) {
            best = d; hit = e;
            e.c.headTop.getWorldPosition(_d);
            head = e.kind === 'gnarl' && segPointDist(a.prev, a.pos, _d) < 0.38;
          }
        }
        if (hit) {
          _d.copy(a.vel).normalize();
          sys.enemies.hurt(hit, a.dmg, { source: 'player', type: 'arrow', headshot: head, point: a.pos.clone(), dir: _d.clone(), knock: _d.clone().multiplyScalar(3), from: a.prev });
          stickTo(a, hit.c.model); a.stuckEnemy = hit;
          continue;
        }
        if (sys.items?.strike(a.pos, 0.3, _d.copy(a.vel).normalize(), { type: 'arrow' })) { a.alive = false; a.mesh.visible = false; continue; }
      } else if (pl && pl.state !== 'dead') {
        _d.copy(pl.position); _d.y += 1.0;
        if (segPointDist(a.prev, a.pos, _d) < 0.55) {
          _v2.copy(a.vel).normalize();
          const r = sys.damagePlayer(a.dmg, { source: a.owner, type: 'arrow', knockback: _v2.clone().multiplyScalar(2.5), position: a.prev, projectile: a });
          if (r === 'parry' || r === 'block') {
            // deflect: parry sends it back at the shooter, block glances off
            if (r === 'parry' && a.owner?.pos) { _v.copy(a.owner.pos); _v.y += 1; const sp = a.vel.length(); a.vel.subVectors(_v, a.pos).normalize().multiplyScalar(sp); a.owner = 'player'; a.dmg *= 2; }
            else { a.vel.multiplyScalar(-0.25); a.vel.y = 4; a.owner = 'none'; }
            fx.sparks(a.pos, null, 12);
            continue;
          }
          if (r) { a.alive = false; a.mesh.visible = false; continue; }
        }
      }
      // terrain / props / water
      const g = world.getHeight(a.pos.x, a.pos.z);
      if (a.pos.y < g || sys.queryColliders(a.pos.x, a.pos.z, 0.05).some(c => a.pos.y < (c.y ?? 0) + (c.hy ?? 1))) {
        a.pos.y = Math.max(a.pos.y, g); a.stuck = true; a.t = 0; a.mesh.position.copy(a.pos);
        fx.dust(a.pos, 2, 0.3);
        events.emit('arrowHit', { position: a.pos.clone(), surface: 'ground' });
      }
      const ws = sys.waterHeight(a.pos.x, a.pos.z);
      if (ws !== null && a.pos.y < ws) { a.alive = false; a.mesh.visible = false; events.emit('splash', { position: a.pos.clone(), size: 0.3 }); }
      if (a.t > 6) { a.alive = false; a.mesh.visible = false; }
    }
  }
  function stickTo(a, obj) {
    a.stuck = true; a.t = 0;
    obj.updateMatrixWorld();
    a.local = obj.worldToLocal(a.pos.clone());
    a.stuckTo = obj;
    // keep world orientation relative to the body
    a.mesh.position.copy(a.pos);
  }

  // ---------------------------------------------------------------- wisp bolts
  function bolt(e, target) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: fx.glowTex, color: e.c.K.edge, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.scale.setScalar(0.9);
    s.position.copy(e.pos);
    scene.add(s);
    const v = new THREE.Vector3().subVectors(target, e.pos); v.y += 1.0; v.normalize().multiplyScalar(9);
    bolts.push({ s, pos: s.position, vel: v, t: 0, owner: e, element: e.element, dmg: e.dmg });
    events.emit('boltCast', { element: e.element, position: e.pos.clone() });
  }
  function updateBolts(dt) {
    const pl = player();
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i];
      b.t += dt;
      if (pl) {
        _v.copy(pl.position); _v.y += 1.0;
        _v.sub(b.pos).normalize().multiplyScalar(9);
        b.vel.lerp(_v, Math.min(1, dt * 1.1));
      }
      b.pos.addScaledVector(b.vel, dt);
      if (Math.random() < 0.8) fx.element(b.pos, b.element, 1, 0.4);
      let done = b.t > 4 || b.pos.y < world.getHeight(b.pos.x, b.pos.z);
      if (pl && !done && b.pos.distanceTo(_d.copy(pl.position).setY(pl.position.y + 1)) < 0.7) {
        const r = sys.damagePlayer(b.dmg, { source: b.owner, type: b.element, knockback: _v2.copy(b.vel).normalize().multiplyScalar(3), position: b.pos });
        done = true;
        if (r === 'parry' && b.owner && !b.owner.dead) sys.enemies.hurt(b.owner, 99, { source: 'player', type: 'reflect', point: b.owner.pos.clone() });
      }
      if (done) { fx.element(b.pos, b.element, 18, 3); scene.remove(b.s); b.s.material.dispose(); bolts.splice(i, 1); }
    }
  }

  // ---------------------------------------------------------------- boulders
  function boulder(from, target, o = {}) {
    const m = new THREE.Mesh(rockGeo, rockMat); m.castShadow = true;
    m.position.copy(from); scene.add(m);
    const T = 1.25;
    const v = new THREE.Vector3((target.x - from.x) / T, 0, (target.z - from.z) / T);
    v.y = (target.y - from.y + 0.5 * 20 * T * T) / T;
    boulders.push({ m, pos: m.position, vel: v, t: 0, owner: o.owner, dmg: o.dmg ?? 5 });
  }
  function updateBoulders(dt) {
    const pl = player();
    for (let i = boulders.length - 1; i >= 0; i--) {
      const b = boulders[i];
      b.t += dt; b.vel.y -= 20 * dt; b.pos.addScaledVector(b.vel, dt);
      b.m.rotation.x += dt * 5; b.m.rotation.z += dt * 3;
      const g = world.getHeight(b.pos.x, b.pos.z);
      if (b.pos.y < g + 0.4 || b.t > 4) {
        b.pos.y = g;
        fx.ring(b.pos.x, g, b.pos.z, 3.5, 0xf0e0c0, 0.45); fx.dust(b.pos, 12, 1.0);
        sys.shake(0.5, b.pos);
        events.emit('slam', { position: b.pos.clone(), radius: 3, kind: 'boulder' });
        if (pl && pl.position.distanceTo(b.pos) < 2.8) {
          _v.subVectors(pl.position, b.pos).setY(0).normalize();
          sys.damagePlayer(b.dmg, { source: b.owner, type: 'crush', knockback: _v2.set(_v.x * 9, 6, _v.z * 9), position: b.pos });
        }
        sys.items?.impulse(b.pos, 3.5, 6);
        scene.remove(b.m); boulders.splice(i, 1);
      }
    }
  }

  return {
    arrow, bolt, boulder,
    update(dt) { updateArrows(dt); updateBolts(dt); updateBoulders(dt); },
  };
}
