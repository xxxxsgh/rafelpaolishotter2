// Enemies: spawning, perception, AI state machine, attacks, damage, death.
//
// Perception: sight cone (range shrinks at night / when the hero crouches or stands in tall grass),
// line-of-sight against the terrain, hearing from the hero's speed. Awareness builds up
// ('?' over the head), then the creature ALERTS ('!' + startled hop) and shouts to its camp.
// Combat: attack tokens (max 2 melee attackers at once), the rest circle and jeer; archers keep
// range or stay on the lookout; unarmed Gnarls fetch dropped weapons; Gnarls near a blastcap or
// blast barrel kick it at the hero; weak Gnarls flee when their friends fall; Shellbacks charge
// with their horn and are armoured from the front; the Stonewarden slams shockwaves and exposes
// its glowing core after a slam; Wisps hover at range and loose elemental bolts.
import * as THREE from 'three';
import { buildGnarl, buildShellback, buildStonewarden, buildWisp, GNARL_TIERS, WISP_KINDS } from './models.js';
import { createCreatureAnimator } from './anim.js';
import { WEAPONS, buildWeaponMesh, makeWeapon } from './weapons.js';

export const SPECIES = {
  gnarl:       { walk: 1.7, run: 4.6, turn: 7, sight: 26, fov: 1.15, hear: 1.0, reach: 1.25, poise: 0, mass: 1, hp: 6, dmg: 1, cd: 1.5 },
  shellback:   { walk: 1.3, run: 3.4, turn: 3.2, sight: 22, fov: 1.0, hear: 0.8, reach: 2.4, poise: 7, mass: 4, hp: 45, dmg: 4, cd: 2.2 },
  stonewarden: { walk: 1.2, run: 2.5, turn: 1.8, sight: 30, fov: 1.5, hear: 0.6, reach: 3.8, poise: 999, mass: 30, hp: 160, dmg: 6, cd: 2.6 },
  wisp:        { walk: 2.0, run: 4.2, turn: 6, sight: 20, fov: 3.2, hear: 1.0, reach: 1.0, poise: 0, mass: 0.6, hp: 5, dmg: 2, cd: 2.6 },
};
const LOOT = {
  gnarl: ['gnarl_horn', 'gnarl_fang'], shellback: ['shell_plate', 'beetle_horn'], stonewarden: ['warden_core', 'mossy_stone'], wisp: ['wisp_essence'],
};

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Vector3();
const wrap = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
let nextId = 1;

export function createEnemies(ctx, sys) {
  const { scene, world, events } = ctx;
  const list = [];
  const root = new THREE.Group(); root.name = 'enemies'; scene.add(root);
  const fx = sys.fx;
  const player = () => ctx.systems.player;
  let attackers = 0;
  // small floating health bars (shown once a creature is hurt or locked)
  const barBgMat = new THREE.SpriteMaterial({ color: 0x1a1418, transparent: true, opacity: 0.75, depthWrite: false, fog: false });
  const barFgMats = { gnarl: 0xff6a3c, shellback: 0xffb347, stonewarden: 0xffc94a, wisp: 0x9fe8ff };
  function makeBar(kind) {
    const g = new THREE.Group(); g.visible = false;
    const bg = new THREE.Sprite(barBgMat); bg.renderOrder = 18;
    const fg = new THREE.Sprite(new THREE.SpriteMaterial({ color: barFgMats[kind] || 0xff6a3c, transparent: true, depthWrite: false, fog: false })); fg.renderOrder = 19;
    g.add(bg, fg); scene.add(g);
    return { g, bg, fg };
  }
  function updateBar(e) {
    const b = e.bar; if (!b) return;
    const pl = player();
    const show = !e.dead && (e.hp < e.maxHp || sys.hero?.st.lock === e) && pl && e.pos.distanceToSquared(pl.position) < 900;
    b.g.visible = show;
    if (!show) return;
    e.c.headTop.getWorldPosition(b.g.position);
    b.g.position.y += e.kind === 'stonewarden' ? 0.5 : 0.32;
    const W = e.kind === 'stonewarden' ? 1.6 : e.kind === 'shellback' ? 1.0 : 0.6, H = W * 0.09;
    const f = Math.max(0.001, e.hp / e.maxHp);
    b.bg.scale.set(W + 0.04, H + 0.04, 1);
    b.fg.scale.set(W * f, H, 1); b.fg.center.set(0.5 / f, 0.5);
  }

  function spawn(kind, x, z, o = {}) {
    let c;
    if (kind === 'gnarl') c = buildGnarl(ctx, o.tier || 'moss', nextId);
    else if (kind === 'shellback') c = buildShellback(ctx, o.variant || 'teal', nextId);
    else if (kind === 'stonewarden') c = buildStonewarden(ctx, nextId);
    else c = buildWisp(ctx, o.element || 'ember');
    const sp = SPECIES[kind];
    const T = kind === 'gnarl' ? GNARL_TIERS[o.tier || 'moss'] : null;
    const e = {
      id: nextId++, kind, tier: o.tier || o.variant || o.element || null, c, sp,
      pos: new THREE.Vector3(x, world.getHeight(x, z), z), vel: new THREE.Vector3(), yaw: o.yaw ?? Math.random() * 6.28,
      hp: T ? T.hp : (kind === 'wisp' ? WISP_KINDS[o.element || 'ember'].hp : sp.hp), maxHp: 0,
      dmg: T ? T.dmg : sp.dmg, speedMul: T ? T.speed : 1,
      camp: o.camp || null, station: o.station || null, home: o.station ? o.station.type : 'idle',
      state: o.state || 'idle', stateT: Math.random() * 3, awareness: 0, alerted: false, lastSeen: new THREE.Vector3(), seenT: 99,
      weapon: null, weaponMesh: null, archer: false, cool: 1 + Math.random(), strikeAt: -1, strikeReach: 0,
      orbit: Math.random() * 6.28, orbitDir: Math.random() < 0.5 ? 1 : -1, tauntT: 2 + Math.random() * 4,
      flash: 0, dead: false, deadT: 0, tumble: new THREE.Vector3(), tumbleV: new THREE.Vector3(), stagger: 0, exposed: 0,
      hover: 2.0 + Math.random() * 0.8, perceiveT: Math.random() * 0.2, indicator: null, indT: 0, indKind: null,
      lockPoint: new THREE.Object3D(), alertDelay: -1, pathT: 0, kickTarget: null, fetch: null, fleeT: 0, sleepZ: 0,
      yOverride: o.y ?? null, charging: 0, castT: 0, attacking: false, seed: Math.random() * 10,
    };
    e.maxHp = e.hp;
    e.anim = kind === 'wisp' ? null : createCreatureAnimator(c, { seed: e.seed, seatDrop: kind === 'gnarl' ? 0.3 : kind === 'shellback' ? 0.55 : 1.1, amp: kind === 'stonewarden' ? 0.85 : 1 });
    c.root.position.copy(e.pos);
    c.root.rotation.y = e.yaw;
    e.lockPoint.position.set(0, c.height * 0.6, 0); c.root.add(e.lockPoint);
    root.add(c.root);
    if (o.weapon) giveWeapon(e, makeWeapon(o.weapon));
    e.indicator = fx.makeIndicator(); scene.add(e.indicator);
    e.bar = makeBar(kind);
    list.push(e);
    if (e.state === 'dormant') { e.anim?.setBase('dormant'); }
    return e;
  }

  function giveWeapon(e, w) {
    if (!w || e.kind !== 'gnarl') return;
    dropWeaponMesh(e);
    e.weapon = w;
    e.archer = w.def.type === 'bow';
    const m = buildWeaponMesh(ctx, w.id);
    if (e.archer) { e.c.socketL.add(m); m.rotation.set(0, 0, 0); }
    else {
      e.c.socketR.add(m);
      // gnarls hold weapons blade-forward-up
      m.rotation.set(-0.35, 0, 0);
      if (w.def.type === 'spear') m.position.z = -0.45;
    }
    e.weaponMesh = m;
    e.anim.e.armed = true;
  }
  function dropWeaponMesh(e) {
    if (e.weaponMesh) { e.weaponMesh.parent?.remove(e.weaponMesh); e.weaponMesh = null; }
  }
  // set the weapon aside at a spot (eaters lean their weapons near the fire; they fetch them when alerted)
  function stash(e, pos) {
    if (!e.weapon) return;
    const w = e.weapon;
    dropWeaponMesh(e);
    e.weapon = null; e.archer = false; if (e.anim) e.anim.e.armed = false;
    const it = sys.items?.dropWeapon(w, pos, _v.set(0, 0, 0));
    if (it) { it.rest = true; it.mesh.rotation.set(Math.PI / 2, Math.random() * 6, 0); it.pos.y = world.getHeight(pos.x, pos.z) + 0.05; }
  }
  let foodGeo = null;
  function giveFood(e) {
    if (!foodGeo) {
      const g = new THREE.SphereGeometry(0.09, 8, 6); g.scale(1.3, 0.9, 0.9);
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3); for (let i = 0; i < n; i++) { col[i * 3] = 0.6; col[i * 3 + 1] = 0.32; col[i * 3 + 2] = 0.16; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('emit', new THREE.BufferAttribute(new Float32Array(n), 1));
      foodGeo = g;
    }
    const m = new THREE.Mesh(foodGeo, e.c.material); m.position.set(0, -0.02, 0.06);
    e.c.socketR.add(m); e.food = m;
  }
  function disarm(e, fling = 3) {
    if (!e.weapon) return;
    const w = e.weapon;
    const wp = new THREE.Vector3(); (e.weaponMesh || e.c.root).getWorldPosition(wp);
    dropWeaponMesh(e);
    e.weapon = null; e.archer = false; if (e.anim) e.anim.e.armed = false;
    sys.items?.dropWeapon(w, wp, _v.set((Math.random() - 0.5) * fling, 3, (Math.random() - 0.5) * fling));
  }

  // ---------------------------------------------------------------- indicators
  function showIndicator(e, kind) {
    const s = e.indicator;
    if (e.indKind === kind && s.visible) return;
    e.indKind = kind; e.indT = 0;
    s.material.map = kind === '!' ? fx.texBang : fx.texQ;
    s.material.needsUpdate = true;
    s.visible = true;
  }
  function updateIndicator(e, dt) {
    const s = e.indicator;
    if (!s.visible) return;
    e.indT += dt;
    const life = e.indKind === '!' ? 1.4 : 99;
    if (e.indKind === '?' && (e.awareness < 0.2 || e.alerted)) { s.visible = false; return; }
    if (e.indT > life || e.dead) { s.visible = false; return; }
    e.c.headTop.getWorldPosition(s.position);
    s.position.y += 0.15;
    const pop = e.indT < 0.12 ? e.indT / 0.12 * 1.35 : e.indT < 0.25 ? 1.35 - (e.indT - 0.12) / 0.13 * 0.35 : 1;
    const dist = s.position.distanceTo(ctx.camera.position);
    const base = Math.max(0.45, dist * 0.045);
    const k = e.indKind === '?' ? 0.6 + e.awareness * 0.4 : 1;
    s.scale.set(base * pop * k, base * pop * k, 1);
    s.material.opacity = e.indKind === '!' ? Math.min(1, (life - e.indT) * 3) : 0.5 + e.awareness * 0.5;
  }

  // ---------------------------------------------------------------- perception
  function dayAmount() {
    const s = ctx.uniforms.uSkyColor.value;
    const l = s.r * 0.299 + s.g * 0.587 + s.b * 0.114;
    return Math.min(1, Math.max(0, (l - 0.04) / 0.26));
  }
  function lineOfSight(ax, ay, az, bx, by, bz) {
    for (let i = 1; i < 8; i++) {
      const t = i / 8, x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
      if (world.getHeight(x, z) > y + 0.1) return false;
    }
    return true;
  }
  function perceive(e, dt) {
    const pl = player();
    if (!pl || pl.state === 'dead' || sys.playerHidden) { e.awareness = Math.max(0, e.awareness - dt * 0.3); return; }
    const pp = pl.position;
    const dx = pp.x - e.pos.x, dz = pp.z - e.pos.z, dy = pp.y - e.pos.y;
    const d = Math.hypot(dx, dz);
    if (d > 45) { e.awareness = Math.max(0, e.awareness - dt * 0.4); return; }
    const sp = e.sp;
    const day = dayAmount();
    let range = sp.sight * (0.5 + 0.5 * day) * (pl.crouching ? 0.55 : 1);
    if (e.state === 'sleep' || e.state === 'dormant') range = 0;
    if (e.station?.type === 'tower') range *= 1.3;
    let gain = 0;
    if (d < range) {
      const ang = Math.abs(wrap(Math.atan2(dx, dz) - e.yaw));
      if (ang < sp.fov || d < 2.2) {
        const ey = e.pos.y + (e.c.height || 1.2) * 0.85;
        if (lineOfSight(e.pos.x, ey, e.pos.z, pp.x, pp.y + 1.2, pp.z)) {
          gain += (1.3 - d / range) * (e.alerted ? 6 : 1.6) * (ang < sp.fov * 0.5 ? 1.4 : 0.8);
          e.lastSeen.copy(pp); e.seenT = 0;
        }
      }
    }
    // hearing: louder when running/sprinting, nearly silent when sneaking
    const spd = Math.hypot(pl.velocity.x, pl.velocity.z);
    let noise = pl.crouching ? spd * 0.35 : spd * (spd > 6 ? 2.1 : 1.3);
    if (pl.state === 'air') noise += 2;
    noise += sys.noiseBurst || 0;
    const hearR = noise * sp.hear * (e.state === 'sleep' ? 0.45 : 1);
    if (d < hearR) { gain += (1 - d / hearR) * 1.2; if (!e.alerted) e.lastSeen.copy(pp); }
    if (gain > 0) e.awareness = Math.min(1.2, e.awareness + gain * dt);
    else e.awareness = Math.max(0, e.awareness - dt * (e.alerted ? 0.08 : 0.25));
    if (Math.abs(dy) > 25) e.awareness = Math.min(e.awareness, 0.5);
  }

  function alert(e, shout = true, delay = 0) {
    if (e.dead || e.alerted) return;
    if (delay > 0) { e.alertDelay = delay; return; }
    const wasSleeping = e.state === 'sleep';
    e.alerted = true; e.awareness = 1.2;
    if (e.food) { e.food.parent?.remove(e.food); e.food = null; }
    const pl = player(); if (pl) e.lastSeen.copy(pl.position);
    showIndicator(e, '!');
    if (e.kind === 'stonewarden') { setState(e, 'waking'); e.anim.play('roar', 0.8); }
    else if (e.kind === 'wisp') setState(e, 'combat');
    else { setState(e, 'alerting'); e.anim.play(wasSleeping ? 'wake' : 'alert', wasSleeping ? 1.2 : 1); }
    events.emit('enemyAlert', { id: e.id, kind: e.kind, position: e.pos.clone(), camp: e.camp?.id ?? null });
    if (shout && e.camp) {
      for (const o of list) if (o !== e && !o.dead && !o.alerted && o.camp === e.camp) alert(o, false, 0.25 + Math.random() * 0.7);
      e.camp.alerted = true;
    } else if (shout) {
      for (const o of list) if (o !== e && !o.dead && !o.alerted && o.pos.distanceToSquared(e.pos) < 400) alert(o, false, 0.4 + Math.random() * 0.6);
    }
  }

  function setState(e, s) { e.state = s; e.stateT = 0; }

  // ---------------------------------------------------------------- movement helpers
  function faceToward(e, x, z, dt, rate) {
    const want = Math.atan2(x - e.pos.x, z - e.pos.z);
    const d = wrap(want - e.yaw);
    e.yaw = wrap(e.yaw + Math.sign(d) * Math.min(Math.abs(d), (rate ?? e.sp.turn) * dt));
    return Math.abs(d);
  }
  function steer(e, tx, tz, speed, dt, stopDist = 0.2) {
    let dx = tx - e.pos.x, dz = tz - e.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < stopDist) { e.vel.x *= 0.8; e.vel.z *= 0.8; return d; }
    dx /= d; dz /= d;
    // separation from other creatures
    for (const o of list) {
      if (o === e || o.dead) continue;
      const ox = e.pos.x - o.pos.x, oz = e.pos.z - o.pos.z, od = Math.hypot(ox, oz), rr = (e.c.radius + o.c.radius) * 1.4;
      if (od < rr && od > 1e-3) { dx += ox / od * (1 - od / rr) * 1.5; dz += oz / od * (1 - od / rr) * 1.5; }
    }
    // avoid camp props
    const cols = sys.queryColliders(e.pos.x, e.pos.z, 2.5);
    for (const c of cols) {
      const cx = e.pos.x - c.x, cz = e.pos.z - c.z, cd = Math.hypot(cx, cz);
      const r = (c.r || Math.max(c.hx, c.hz)) + e.c.radius + 0.8;
      if (cd < r && cd > 1e-3) { dx += cx / cd * (1 - cd / r) * 1.2; dz += cz / cd * (1 - cd / r) * 1.2; }
    }
    const l = Math.hypot(dx, dz) || 1;
    const sp = speed * Math.min(1, d / 1.2 + 0.3);
    e.vel.x += (dx / l * sp - e.vel.x) * Math.min(1, dt * 6);
    e.vel.z += (dz / l * sp - e.vel.z) * Math.min(1, dt * 6);
    faceToward(e, e.pos.x + e.vel.x, e.pos.z + e.vel.z, dt);
    return d;
  }
  function integrate(e, dt) {
    if (e.yOverride !== null && e.station?.type === 'tower') e.vel.set(0, 0, 0);    // archers hold the platform
    const nx = e.pos.x + e.vel.x * dt, nz = e.pos.z + e.vel.z * dt;
    const ws = sys.waterHeight(nx, nz);
    const gh = world.getHeight(nx, nz);
    if (e.kind !== 'wisp' && ws !== null && ws > gh + 0.7) { e.vel.x *= -0.2; e.vel.z *= -0.2; }
    else { e.pos.x = nx; e.pos.z = nz; }
    // push out of props (box / cylinder)
    if (e.kind !== 'wisp' && e.yOverride === null) sys.pushOut(e.pos, e.c.radius);
    if (e.kind === 'wisp') {
      const g = world.getHeight(e.pos.x, e.pos.z);
      const want = Math.max(g, ws ?? -1e9) + e.hover + Math.sin(ctx.uniforms.uTime.value * 1.7 + e.seed) * 0.25;
      e.pos.y += (want - e.pos.y) * Math.min(1, dt * 3);
    } else if (e.yOverride !== null) e.pos.y = e.yOverride;
    else e.pos.y = world.getHeight(e.pos.x, e.pos.z);
  }

  // ---------------------------------------------------------------- attacks
  function weaponReach(e) {
    if (e.kind !== 'gnarl') return e.sp.reach;
    if (!e.weapon) return 1.0;
    return e.weapon.def.type === 'spear' ? 2.3 : e.weapon.def.type === 'club' ? 1.8 : 1.5;
  }
  function startAttack(e, name, speed = 1) {
    const dur = e.anim.play(name, speed);
    const A = e.anim.action;
    e.attacking = true; e.attackName = name; e.attackHit = false;
    e.strikeAt = sys.time + dur * (A.hit ?? 0.6);
    e.strikeReach = weaponReach(e) + e.c.radius + 0.4;
    // telegraph glint on the weapon / fist
    const src = e.weaponMesh || e.c.socketR;
    src.getWorldPosition(_v);
    if (e.weaponMesh && e.weapon.def.type !== 'bow') { _v2.set(0, 0, e.weaponMesh.userData.tipZ * 0.85); e.weaponMesh.localToWorld(_v2); _v.copy(_v2); }
    fx.spawnAdd({ x: _v.x, y: _v.y, z: _v.z, life: 0.35, size: 0.5, size1: 1.0, cell: 2, r: 1, g: 0.95, b: 0.8, a: 0.9, rot: 0.4 });
    events.emit('enemyWindup', { id: e.id, kind: e.kind, attack: name, position: e.pos.clone() });
    return dur;
  }
  function resolveStrike(e) {
    const pl = player(); if (!pl) return;
    const pp = pl.position;
    const dx = pp.x - e.pos.x, dz = pp.z - e.pos.z, d = Math.hypot(dx, dz), dy = pp.y - e.pos.y;
    const ang = Math.abs(wrap(Math.atan2(dx, dz) - e.yaw));
    const name = e.attackName;
    let hit = false, dmg = e.dmg, kb = 4;
    if (e.kind === 'gnarl' && e.weapon) dmg += Math.ceil((e.weapon.def.dmg || 2) * 0.35);
    if (name === 'slam') {
      const R = e.kind === 'stonewarden' ? 5.2 : 2.6;
      _v.set(e.pos.x + Math.sin(e.yaw) * e.sp.reach * 0.6, 0, e.pos.z + Math.cos(e.yaw) * e.sp.reach * 0.6);
      _v.y = world.getHeight(_v.x, _v.z);
      fx.ring(_v.x, _v.y, _v.z, R * 1.15, e.kind === 'stonewarden' ? 0xffc070 : 0xf0e6d0, 0.55);
      fx.dust(_v, e.kind === 'stonewarden' ? 16 : 9, e.kind === 'stonewarden' ? 1.2 : 0.8);
      sys.shake(e.kind === 'stonewarden' ? 0.9 : 0.45, _v);
      events.emit('slam', { position: _v.clone(), radius: R, kind: e.kind });
      const sd = Math.hypot(pp.x - _v.x, pp.z - _v.z);
      hit = sd < R && Math.abs(pp.y - _v.y) < 1.8;
      kb = e.kind === 'stonewarden' ? 11 : 7;
      if (e.kind === 'stonewarden') { e.exposed = 2.6; }
      // the shockwave also sets off bombs and knocks loose items
      sys.items?.impulse(_v, R, 6);
    } else if (name === 'sweep') {
      hit = d < e.strikeReach + 0.8 && ang < 1.6 && Math.abs(dy) < 2.5; kb = 9;
    } else if (name === 'kick') {
      hit = d < 1.6 && ang < 1.0; dmg = 1; kb = 5;
    } else {
      const arc = name === 'thrust' ? 0.55 : 1.05;
      hit = d < e.strikeReach && ang < arc && Math.abs(dy) < 1.8;
      kb = e.kind === 'shellback' ? 8 : (e.weapon?.def.type === 'club' ? 6 : 4);
    }
    if (hit) {
      _d.set(dx, 0, dz).normalize();
      const res = sys.damagePlayer(dmg, { source: e, knockback: _v2.set(_d.x * kb, kb * 0.35, _d.z * kb), type: 'melee', position: e.pos });
      if (res === 'parry') { staggerEnemy(e, 1.4); }
    }
  }
  function staggerEnemy(e, t = 1.2) {
    if (e.dead) return;
    e.attacking = false; e.strikeAt = -1; e.charging = 0;
    if (e.kind === 'stonewarden') { e.exposed = Math.max(e.exposed, 3); e.anim.play('stagger', 0.6); }
    else if (e.anim) e.anim.play('stagger', 1.3 / t);
    e.stagger = t;
    if (e.kind === 'gnarl' && Math.random() < 0.35) disarm(e, 4);
  }

  // ---------------------------------------------------------------- damage
  function hurt(e, dmg, info = {}) {
    if (e.dead || dmg <= 0) return false;
    const pl = player();
    let mult = 1, sneak = false, armored = false;
    const fromX = info.from?.x ?? pl?.position.x ?? e.pos.x, fromZ = info.from?.z ?? pl?.position.z ?? e.pos.z;
    const toSrc = Math.atan2(fromX - e.pos.x, fromZ - e.pos.z);
    const facing = Math.abs(wrap(toSrc - e.yaw)) < 0.9;
    if (!e.alerted && e.awareness < 0.9 && info.source === 'player' && info.type !== 'explosion') { mult *= 3; sneak = true; }
    if (e.kind === 'shellback' && facing && e.stagger <= 0 && e.charging <= 0 && info.type !== 'explosion') { mult *= 0.35; armored = true; }
    if (e.kind === 'stonewarden') mult *= e.exposed > 0 ? 2.2 : 0.55;
    if (e.kind === 'wisp' && info.type === 'arrow') mult *= 2;
    if (info.headshot) mult *= 2;
    const amount = dmg * mult;
    e.hp -= amount;
    e.flash = 1;
    if (info.point) {
      if (armored || e.kind === 'stonewarden') fx.sparks(info.point, info.dir, 18, [1, 0.9, 0.6], 1.1);
      else if (e.kind === 'wisp') fx.element(info.point, e.element, 16, 3);
      else fx.sparks(info.point, info.dir, 10, [1, 0.8, 0.45], 0.9);
    }
    events.emit('hit', { target: 'enemy', id: e.id, kind: e.kind, damage: amount, position: (info.point || e.pos).clone?.() || e.pos.clone(),
      material: armored || e.kind === 'stonewarden' ? 'stone' : e.kind === 'wisp' ? 'energy' : 'flesh', sneak, armored, strong: !!info.strong });
    if (sneak) events.emit('sneakStrike', { id: e.id, position: e.pos.clone() });
    // knockback (mass-scaled), stagger unless poise holds
    if (info.knock) {
      const m = e.sp.mass;
      e.vel.x += info.knock.x / m; e.vel.z += info.knock.z / m;
    }
    if (e.hp <= 0) { die(e, info); return true; }
    if (!e.alerted) alert(e, true);
    else if (e.state !== 'combat' && e.state !== 'alerting') setState(e, 'combat');
    const poise = e.sp.poise;
    if (!armored && amount >= poise) {
      if (info.strong || amount > poise + 4) staggerEnemy(e, info.strong ? 1.1 : 0.7);
      else if (e.anim && !e.attacking) e.anim.play('hit');
      else if (e.anim && e.kind === 'gnarl') { e.anim.play('hit'); e.attacking = false; e.strikeAt = -1; }
    }
    if (e.kind === 'gnarl' && info.strong && Math.random() < 0.2) disarm(e, 5);
    return true;
  }

  function die(e, info = {}) {
    e.dead = true; e.deadT = 0; e.hp = 0;
    e.attacking = false; e.strikeAt = -1;
    if (e.indicator) e.indicator.visible = false;
    if (e.bar) e.bar.g.visible = false;
    const k = info.knock || _v.set(0, 0, 0);
    e.vel.set(k.x * 0.9 / Math.sqrt(e.sp.mass), (e.kind === 'stonewarden' ? 0.5 : 3.5 + Math.random() * 1.5), k.z * 0.9 / Math.sqrt(e.sp.mass));
    // tumble axis perpendicular to the hit direction
    const l = Math.hypot(k.x, k.z) || 1;
    e.tumbleV.set(k.z / l * (5 + Math.random() * 3), (Math.random() - 0.5) * 4, -k.x / l * (5 + Math.random() * 3));
    if (e.kind === 'stonewarden') e.tumbleV.multiplyScalar(0.12);
    if (e.anim) { e.anim.stop(); e.anim.setBase('limp'); e.anim.e.limp = 1; e.anim.e.wobble = 0.5; }
    if (e.weapon && e.kind === 'gnarl') disarm(e, 2.5);
    if (sys.lockTarget === e) sys.clearLock?.();
    events.emit('enemyKilled', { id: e.id, kind: e.kind, tier: e.tier, position: e.pos.clone(), camp: e.camp?.id ?? null });
    sys.onEnemyKilled?.(e);
  }

  function finishDeath(e) {
    _v.copy(e.pos); _v.y += (e.c.height || 1) * 0.4;
    const scale = e.kind === 'stonewarden' ? 3 : e.kind === 'shellback' ? 1.8 : e.kind === 'wisp' ? 0.9 : 1.1;
    if (e.kind === 'wisp') fx.element(_v, e.element, 40, 5);
    fx.poof(_v, scale, e.kind === 'wisp' ? [0.95, 0.92, 0.85] : [0.66, 0.6, 0.74]);
    events.emit('enemyPoof', { id: e.id, kind: e.kind, position: _v.clone() });
    // loot
    const pool = LOOT[e.kind] || [];
    const n = e.kind === 'stonewarden' ? 4 : e.kind === 'gnarl' ? 1 + (Math.random() < 0.5 ? 1 : 0) : 2;
    for (let i = 0; i < n; i++) sys.items?.dropMaterial(pool[i % pool.length], _v, _v2.set((Math.random() - 0.5) * 3, 3 + Math.random() * 2, (Math.random() - 0.5) * 3));
    if (e.kind === 'stonewarden') sys.items?.dropWeapon(makeWeapon('warden_hammer'), _v, _v2.set(0, 5, 0));
    if (e.kind === 'shellback' && Math.random() < 0.6) sys.items?.dropWeapon(makeWeapon('shell_shield'), _v, _v2.set(1, 4, 0));
  }

  function remove(e) {
    e.c.root.parent?.remove(e.c.root);
    e.indicator?.parent?.remove(e.indicator);
    if (e.bar) { e.bar.g.parent?.remove(e.bar.g); e.bar.fg.material.dispose(); }
    e.c.mesh?.geometry?.dispose(); e.c.material?.dispose?.(); e.c.outlineMat?.dispose?.();
    const i = list.indexOf(e); if (i >= 0) list.splice(i, 1);
  }

  // ---------------------------------------------------------------- AI tick
  function aliveInCamp(e) { let n = 0; for (const o of list) if (!o.dead && o.camp === e.camp) n++; return n; }

  function think(e, dt) {
    const pl = player();
    const pp = pl?.position;
    const sp = e.sp;
    e.stateT += dt;
    e.seenT += dt;
    e.cool -= dt;
    if (e.alertDelay > 0) { e.alertDelay -= dt; if (e.alertDelay <= 0) { e.alertDelay = -1; alert(e, false); } }
    e.perceiveT -= dt;
    if (e.perceiveT <= 0) { perceive(e, 0.2); e.perceiveT = 0.2; }
    if (!e.alerted && e.state !== 'dormant') {
      if (e.awareness >= 1) alert(e, true);
      else if (e.awareness > 0.35 && e.state !== 'sleep') showIndicator(e, '?');
    }
    if (e.kind === 'stonewarden' && e.state === 'dormant') {
      const d = pp ? Math.hypot(pp.x - e.pos.x, pp.z - e.pos.z) : 1e9;
      if (d < 11 || e.awareness > 1) alert(e, false);
      return;
    }
    if (e.stagger > 0) { e.stagger -= dt; e.vel.multiplyScalar(Math.exp(-dt * 5)); return; }
    // strike resolution
    if (e.attacking) {
      if (!e.attackHit && sys.time >= e.strikeAt && e.strikeAt > 0) {
        e.attackHit = true;
        if (e.attackName === 'draw') fireArrow(e);
        else if (e.attackName === 'throw') throwRock(e);
        else if (e.attackName === 'kick' && e.kickTarget) { sys.items?.kick(e.kickTarget, e, pp); e.kickTarget = null; }
        else if (e.attackName === 'pickup' && e.fetch) { const w = sys.items?.take(e.fetch); if (w) giveWeapon(e, w); e.fetch = null; }
        else resolveStrike(e);
      }
      if (!e.anim.action || e.anim.progress >= 1) { e.attacking = false; e.strikeAt = -1; if (e.tokens) { attackers = Math.max(0, attackers - 1); e.tokens = false; } }
      e.vel.multiplyScalar(Math.exp(-dt * 8));
      if (e.attackName === 'swing' || e.attackName === 'thrust' || e.attackName === 'sweep') {
        // small lunge into the strike, keep tracking the target during windup
        if (sys.time < e.strikeAt) faceToward(e, pp.x, pp.z, dt, sp.turn * 0.6);
        else if (sys.time < e.strikeAt + 0.12) { e.vel.x += Math.sin(e.yaw) * dt * 25; e.vel.z += Math.cos(e.yaw) * dt * 25; }
      }
      return;
    }
    if (e.charging > 0) { updateCharge(e, dt); return; }
    switch (e.state) {
      case 'sleep': case 'sit': e.vel.set(0, 0, 0); break;
      case 'idle': case 'guard': case 'tower':
        if (e.kind === 'wisp') {
          // drift lazily around the spawn point
          e.home = e.home || e.pos.clone();
          const a = e.stateT * 0.25 + e.seed;
          steer(e, e.home.x + Math.cos(a) * 5, e.home.z + Math.sin(a * 1.3) * 5, e.sp.walk * 0.6, dt, 0.3);
          break;
        }
        e.vel.multiplyScalar(0.8);
        if (e.station?.yaw !== undefined) faceToward(e, e.pos.x + Math.sin(e.station.yaw + Math.sin(e.stateT * 0.3 + e.seed) * 0.9), e.pos.z + Math.cos(e.station.yaw + Math.sin(e.stateT * 0.3 + e.seed) * 0.9), dt, 1);
        break;
      case 'patrol': {
        const pts = e.camp?.stations.patrol;
        if (!pts || !pts.length) { setState(e, 'idle'); break; }
        e.patrolI = e.patrolI ?? Math.floor(Math.random() * pts.length);
        const p = pts[e.patrolI];
        if (steer(e, p.x, p.z, sp.walk * 0.8, dt, 0.8) < 0.9) { e.patrolI = (e.patrolI + 1) % pts.length; if (Math.random() < 0.3) { setState(e, 'patrolPause'); } }
        break;
      }
      case 'patrolPause': e.vel.multiplyScalar(0.8); if (e.stateT > 2.5) setState(e, 'patrol'); break;
      case 'alerting':
        e.vel.multiplyScalar(0.85);
        if (pp) faceToward(e, pp.x, pp.z, dt, 6);
        if (!e.anim.action) { setState(e, 'combat'); if (e.station?.type === 'sit' || e.station?.type === 'sleep') e.yOverride = null; }
        break;
      case 'waking':
        if (pp) faceToward(e, pp.x, pp.z, dt, 1.2);
        if (e.stateT > 0.2) e.anim.setBase('idle');
        if (!e.anim.action && e.stateT > 1.5) setState(e, 'combat');
        break;
      case 'combat': combat(e, dt); break;
      case 'search':
        if (steer(e, e.lastSeen.x, e.lastSeen.z, sp.walk, dt, 1.5) < 1.6) { e.yaw += dt * 1.2 * e.orbitDir; }
        if (e.awareness > 0.9) setState(e, 'combat');
        else if (e.stateT > 9) { e.alerted = false; setState(e, 'return'); }
        break;
      case 'return': {
        const st = e.station;
        if (!st) { setState(e, 'idle'); break; }
        if (steer(e, st.x, st.z, sp.walk, dt, 0.6) < 0.7) {
          if (st.type === 'sleep' || st.type === 'sit') setState(e, 'idle'); else setState(e, st.type === 'patrol' ? 'patrol' : st.type);
        }
        break;
      }
      case 'flee': {
        if (!pp) break;
        _v.set(e.pos.x - pp.x, 0, e.pos.z - pp.z).normalize();
        steer(e, e.pos.x + _v.x * 6, e.pos.z + _v.z * 6, sp.run * e.speedMul, dt);
        if (e.stateT > 6) setState(e, 'combat');
        break;
      }
    }
  }

  function combat(e, dt) {
    const pl = player(); if (!pl) return;
    const pp = pl.position, sp = e.sp;
    const dx = pp.x - e.pos.x, dz = pp.z - e.pos.z, d = Math.hypot(dx, dz);
    if (pl.state === 'dead') { setState(e, 'return'); e.alerted = false; return; }
    if (e.seenT > 8 && d > 12) { setState(e, 'search'); return; }
    if (d > 60) { setState(e, 'return'); e.alerted = false; return; }

    if (e.kind === 'wisp') { wispCombat(e, dt, d); return; }

    // tower archer stays on the platform
    if (e.yOverride !== null && e.station?.type === 'tower') {
      faceToward(e, pp.x, pp.z, dt, 4);
      if (e.archer && e.cool <= 0 && d < 34) { startAttack(e, 'draw', 1); e.cool = 2.6 + Math.random() * 1.6; }
      return;
    }
    // weak gnarls flee when their camp is nearly wiped out
    if (e.kind === 'gnarl' && e.tier === 'moss' && e.hp < e.maxHp * 0.5 && e.camp && aliveInCamp(e) <= 1 && e.fleeT <= 0) { e.fleeT = 1; setState(e, 'flee'); return; }
    // fetch a dropped weapon
    if (e.kind === 'gnarl' && !e.weapon && sys.items) {
      if (!e.fetch || !e.fetch.alive) e.fetch = sys.items.nearestWeapon(e.pos, 14);
      if (e.fetch && d > 3) {
        const f = e.fetch;
        if (steer(e, f.pos.x, f.pos.z, sp.run * e.speedMul, dt, 0.5) < 0.9) { e.vel.set(0, 0, 0); startAttack(e, 'pickup'); }
        return;
      }
    }
    // scatter from lit bombs
    if (sys.items && e.kind !== 'stonewarden') {
      const lit = sys.items.nearestLit?.(e.pos, 4.5);
      if (lit) {
        _v.set(e.pos.x - lit.pos.x, 0, e.pos.z - lit.pos.z).normalize();
        steer(e, e.pos.x + _v.x * 5, e.pos.z + _v.z * 5, sp.run * e.speedMul, dt);
        if (!e.panicked) { e.panicked = true; if (e.anim && Math.random() < 0.5) e.anim.play('alert', 1.4); }
        return;
      }
      e.panicked = false;
    }
    // kick a bomb at the hero
    if (e.kind === 'gnarl' && sys.items && d < 16 && e.cool <= 0.5) {
      const b = sys.items.nearestBomb(e.pos, 7);
      if (b) {
        // approach the bomb from the side opposite the hero
        _v.set(b.pos.x - pp.x, 0, b.pos.z - pp.z).normalize();
        const kx = b.pos.x + _v.x * 0.7, kz = b.pos.z + _v.z * 0.7;
        if (steer(e, kx, kz, sp.run * e.speedMul, dt, 0.25) < 0.45) {
          faceToward(e, b.pos.x, b.pos.z, dt, 20);
          e.kickTarget = b; startAttack(e, 'kick'); e.cool = 2.5;
        }
        return;
      }
    }
    // archers on the ground keep range
    if (e.archer) {
      faceToward(e, pp.x, pp.z, dt, 5);
      if (d < 7) { _v.set(-dx, 0, -dz).normalize(); steer(e, e.pos.x + _v.x * 4, e.pos.z + _v.z * 4, sp.run * e.speedMul * 0.8, dt); faceToward(e, pp.x, pp.z, dt, 8); }
      else if (d > 22) steer(e, pp.x, pp.z, sp.run * e.speedMul, dt, 18);
      else { e.vel.multiplyScalar(0.85); if (e.cool <= 0) { startAttack(e, 'draw', 1); e.cool = 2.6 + Math.random() * 1.5; } }
      return;
    }
    // shellback horn charge from mid range
    if (e.kind === 'shellback' && d > 6 && d < 15 && e.cool <= 0 && Math.random() < dt * 1.2) {
      e.charging = 1.6; e.anim.play('charge', 1, true); e.cool = sp.cd + 1.5;
      e.chargeDir = Math.atan2(dx, dz); e.yaw = e.chargeDir; events.emit('enemyWindup', { id: e.id, kind: e.kind, attack: 'charge', position: e.pos.clone() });
      e.strikeAt = sys.time + Math.min(1.6, d / 8); e.strikeReach = 2;
      return;
    }
    // stonewarden throws boulders at range
    if (e.kind === 'stonewarden' && d > 11 && e.cool <= 0) { faceToward(e, pp.x, pp.z, dt, 3); startAttack(e, 'throw', 0.8); e.cool = sp.cd + 1; return; }

    const reach = weaponReach(e) + e.c.radius + 0.25;
    const canAttack = e.tokens || attackers < (e.kind === 'gnarl' ? 2 : 3);
    if (canAttack && e.cool <= 0) {
      if (!e.tokens) { e.tokens = true; attackers++; }
      if (d > reach) steer(e, pp.x, pp.z, sp.run * e.speedMul, dt, reach * 0.8);
      else {
        e.vel.multiplyScalar(0.7);
        const off = faceToward(e, pp.x, pp.z, dt, sp.turn * 1.5);
        if (off < 0.5) {
          let name = 'swing', speed = 1;
          if (e.kind === 'gnarl') { name = e.weapon?.def.type === 'spear' ? 'thrust' : 'swing'; speed = e.weapon?.def.type === 'club' ? 0.85 : 1.1 + (e.tier === 'bone' ? 0.25 : e.tier === 'dusk' ? 0.15 : 0); }
          else if (e.kind === 'shellback') name = Math.random() < 0.55 ? 'slam' : 'sweep';
          else if (e.kind === 'stonewarden') { name = d < 3.5 ? 'slam' : (Math.random() < 0.5 ? 'sweep' : 'slam'); speed = 0.65; }
          startAttack(e, name, speed);
          e.cool = sp.cd * (0.7 + Math.random() * 0.6) / (e.tier === 'bone' ? 1.4 : 1);
        }
      }
    } else {
      // circle at a respectful distance, occasionally jeer
      if (e.tokens && e.cool > 0.6) { e.tokens = false; attackers = Math.max(0, attackers - 1); }
      e.orbit += dt * 0.35 * e.orbitDir;
      const R = 4.2 + (e.id % 3) * 0.9;
      const ox = pp.x - Math.sin(Math.atan2(dx, dz) + e.orbit * 0.4) * R, oz = pp.z - Math.cos(Math.atan2(dx, dz) + e.orbit * 0.4) * R;
      steer(e, ox, oz, sp.walk * 1.3, dt, 0.6);
      faceToward(e, pp.x, pp.z, dt, sp.turn);
      e.tauntT -= dt;
      if (e.tauntT <= 0 && e.kind === 'gnarl' && d < 9) { e.anim.play('taunt'); e.tauntT = 4 + Math.random() * 5; events.emit('enemyTaunt', { id: e.id, position: e.pos.clone() }); }
      if (Math.random() < dt * 0.15) e.orbitDir *= -1;
    }
  }

  function updateCharge(e, dt) {
    e.charging -= dt;
    const speed = 9;
    e.vel.x = Math.sin(e.chargeDir) * speed; e.vel.z = Math.cos(e.chargeDir) * speed;
    e.anim.e.phase += dt * 14;
    if (Math.random() < dt * 20) fx.dust(_v.set(e.pos.x, e.pos.y, e.pos.z), 1, 0.6);
    const pl = player();
    if (pl && !e.chargeHit) {
      const d = Math.hypot(pl.position.x - e.pos.x, pl.position.z - e.pos.z);
      if (d < 1.7) {
        e.chargeHit = true;
        _d.set(Math.sin(e.chargeDir), 0, Math.cos(e.chargeDir));
        const r = sys.damagePlayer(e.dmg + 1, { source: e, knockback: _v2.set(_d.x * 12, 5, _d.z * 12), type: 'charge', position: e.pos });
        if (r === 'parry') { endCharge(e); staggerEnemy(e, 2); return; }
      }
    }
    // smash into props or terrain walls -> dizzy
    const ahead = world.getHeight(e.pos.x + Math.sin(e.chargeDir) * 1.5, e.pos.z + Math.cos(e.chargeDir) * 1.5);
    const hitWall = ahead > e.pos.y + 1.2 || sys.queryColliders(e.pos.x + Math.sin(e.chargeDir) * 1.2, e.pos.z + Math.cos(e.chargeDir) * 1.2, 0.4).length > 0;
    if (hitWall) {
      endCharge(e); staggerEnemy(e, 2.5); sys.shake(0.5, e.pos);
      fx.dust(e.pos, 8, 0.9); fx.sparks(_v.set(e.pos.x, e.pos.y + 1.6, e.pos.z), null, 14);
      return;
    }
    if (e.charging <= 0) endCharge(e);
  }
  function endCharge(e) { e.charging = 0; e.chargeHit = false; e.anim.stop(); e.strikeAt = -1; e.vel.multiplyScalar(0.2); }

  function wispCombat(e, dt, d) {
    const pp = player().position;
    e.orbit += dt * 0.6 * e.orbitDir;
    const R = 8.5;
    const a = Math.atan2(e.pos.x - pp.x, e.pos.z - pp.z) + dt * 0.5 * e.orbitDir;
    steer(e, pp.x + Math.sin(a) * R, pp.z + Math.cos(a) * R, e.sp.run, dt, 0.5);
    e.castT -= dt;
    if (e.cool <= 0 && d < 22) { e.castT = 0.8; e.cool = e.sp.cd + Math.random(); }
    if (e.castT > 0 && e.castT - dt <= 0) sys.projectiles?.bolt(e, pp);
    if (d < 1.2 && e.cool < e.sp.cd - 0.8) {
      sys.damagePlayer(e.dmg, { source: e, type: e.element, knockback: _v2.set((pp.x - e.pos.x) * 3, 3, (pp.z - e.pos.z) * 3), position: e.pos });
      e.cool = e.sp.cd;
    }
  }

  function fireArrow(e) {
    const pl = player(); if (!pl) return;
    const src = e.weaponMesh || e.c.socketL;
    src.getWorldPosition(_v);
    _v2.copy(pl.position); _v2.y += 1.1;
    // lead the target a little
    const t = _v.distanceTo(_v2) / 30;
    _v2.x += pl.velocity.x * t * 0.7; _v2.z += pl.velocity.z * t * 0.7;
    sys.projectiles?.arrow(_v, _v2, { owner: e, speed: 30, dmg: e.dmg + 1, spread: e.tier === 'moss' ? 0.06 : 0.035 });
    events.emit('arrowShot', { owner: 'enemy', position: _v.clone() });
  }
  function throwRock(e) {
    const pl = player(); if (!pl) return;
    e.c.socketR.getWorldPosition(_v);
    sys.projectiles?.boulder(_v, pl.position, { owner: e, dmg: e.dmg });
  }

  // ---------------------------------------------------------------- per-frame
  function update(dt, realDt) {
    const pl = player();
    const t = ctx.uniforms.uTime.value;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      const c = e.c;
      // distance culling: freeze far creatures (their camp may be hidden)
      const far = pl ? e.pos.distanceToSquared(pl.position) > 180 * 180 : false;
      c.root.visible = !far && !e.hidden;
      if (far || e.hidden) { if (e.bar) e.bar.g.visible = false; continue; }
      if (e.dead) { updateDead(e, dt); continue; }
      if (!sys.freezeAI) { think(e, dt); integrate(e, dt); }
      // pose by state
      if (e.anim) {
        const a = e.anim;
        const hs = Math.hypot(e.vel.x, e.vel.z);
        let base = 'idle';
        if (e.state === 'sleep') base = 'sleep';
        else if (e.state === 'sit') base = 'sit';
        else if (e.state === 'dormant') base = 'dormant';
        else if (hs > 0.35) base = 'loco';
        else if (e.alerted) base = e.kind === 'shellback' && e.stagger <= 0 && e.state === 'combat' ? 'combat' : 'combat';
        a.setBase(base);
        a.e.speedN = Math.min(1, Math.max(0, (hs - e.sp.walk) / (e.sp.run - e.sp.walk)));
        const stride = e.kind === 'stonewarden' ? 2.6 : e.kind === 'shellback' ? 1.5 : 0.75;
        a.e.phase += hs / stride * Math.PI * dt;
        a.update(dt, t);
        // lay down sleepers
        const m = c.model;
        if (e.state === 'sleep') { m.rotation.x += (-Math.PI / 2 - m.rotation.x) * Math.min(1, dt * 6); m.position.y = (e.kind === 'gnarl' ? 0.32 : 0.6) * c.model.scale.y; m.position.z = 0.6; }
        else { m.rotation.x *= Math.max(0, 1 - dt * 6); m.position.y *= Math.max(0, 1 - dt * 6); m.position.z *= Math.max(0, 1 - dt * 6); }
        if (e.state === 'sleep') {
          e.sleepZ -= dt;
          if (e.sleepZ <= 0) { e.sleepZ = 1.6 + Math.random(); sys.spawnZ?.(e); }
        }
      } else {
        // wisp: bob, spin shards, pulse
        c.shards.rotation.y += dt * 1.8;
        c.shards.rotation.x = Math.sin(t * 0.7 + e.seed) * 0.3;
        const s = 1 + Math.sin(t * 6 + e.seed) * 0.05 + (e.castT > 0 ? (0.8 - e.castT) * 0.6 : 0);
        c.core.scale.setScalar(s);
        c.halo.material.opacity = 0.55 + Math.sin(t * 4 + e.seed) * 0.15 + (e.castT > 0 ? 0.3 : 0);
        if (Math.random() < dt * 14) fx.element(_v.set(e.pos.x, e.pos.y, e.pos.z), e.element, 1, 0.6);
        faceToward(e, e.pos.x + e.vel.x, e.pos.z + e.vel.z, dt);
      }
      // stonewarden core glow when exposed
      if (e.kind === 'stonewarden') {
        e.exposed = Math.max(0, e.exposed - dt);
        const tgtB = e.state === 'dormant' ? -0.6 : e.exposed > 0 ? 1.6 + Math.sin(t * 14) * 0.5 : 0.25;
        c.material.uniforms.uEmitBoost.value += (tgtB - c.material.uniforms.uEmitBoost.value) * Math.min(1, dt * 5);
      }
      // hit flash
      e.flash = Math.max(0, e.flash - dt * 5);
      if (e.kind === 'wisp') c.material.uniforms.uFlash.value = e.flash * 0.8;
      else c.material.uniforms.uFlash.value.setScalar(e.flash * 0.55);
      c.root.position.copy(e.pos);
      c.root.rotation.y = e.yaw;
      updateIndicator(e, realDt);
      updateBar(e);
    }
  }

  function updateDead(e, dt) {
    const c = e.c;
    e.deadT += dt;
    if (e.kind !== 'wisp') {
      e.vel.y -= 20 * dt;
      e.pos.addScaledVector(e.vel, dt);
      const g = world.getHeight(e.pos.x, e.pos.z);
      if (e.pos.y < g) {
        e.pos.y = g;
        if (e.vel.y < -2) { fx.dust(e.pos, 3, 0.5); e.vel.y *= -0.3; }
        else e.vel.y = 0;
        e.vel.x *= 0.82; e.vel.z *= 0.82; e.tumbleV.multiplyScalar(0.8);
      }
      // tumble towards lying flat, then stop
      c.model.rotation.x += e.tumbleV.x * dt;
      c.model.rotation.z += e.tumbleV.z * dt;
      const flat = Math.min(1.45, Math.abs(c.model.rotation.x) + Math.abs(c.model.rotation.z));
      if (flat >= 1.45) e.tumbleV.multiplyScalar(Math.exp(-dt * 8));
      c.model.position.y = Math.sin(Math.min(1.45, flat)) * c.radius * 0.6;
      if (e.anim) { e.anim.e.wobble = Math.max(0, 0.5 - e.deadT * 0.6); e.anim.update(dt, ctx.uniforms.uTime.value); }
    } else {
      e.pos.y -= dt * 0.5;
      c.core.scale.multiplyScalar(1 + dt * 2);
      c.material.uniforms.uFade.value = Math.max(0, 1 - e.deadT * 2.5);
    }
    c.root.position.copy(e.pos);
    const dissolveStart = e.kind === 'stonewarden' ? 2.2 : 1.1;
    if (e.deadT > dissolveStart && c.material.uniforms.uDissolve) c.material.uniforms.uDissolve.value = Math.min(1, (e.deadT - dissolveStart) / 0.45);
    if (e.deadT > dissolveStart + 0.25 && !e.poofed) { e.poofed = true; finishDeath(e); }
    if (e.deadT > dissolveStart + 0.6) remove(e);
  }

  return {
    list, spawn, hurt, alert, staggerEnemy, giveWeapon, disarm, stash, giveFood, update, remove,
    get attackers() { return attackers; },
    live: () => list.filter(e => !e.dead),
  };
}
