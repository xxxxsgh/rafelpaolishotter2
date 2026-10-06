// The hero's side of combat: weapon inventory + durability, draw/sheath, melee combos with
// hit-stop and slash trails, charged spin attack, bow aiming (over-the-shoulder camera,
// crosshair, ballistic arrows), shield guard + parry, perfect dodge -> flurry slow-mo,
// lock-on with reticle, blastcap throwing, pickups and loot chests.
//
// Facing: the player system owns yaw, so auto-aim towards a target is applied as a small
// per-frame visual offset on the hero model (player resets it every frame) and in hit tests.
import * as THREE from 'three';
import { WEAPONS, makeWeapon, buildWeaponMesh } from './weapons.js';

const COMBOS = {
  sword: [{ a: 'attack', w: [0.26, 0.6], m: 1 }, { a: 'attack2', w: [0.24, 0.6], m: 1 }, { a: 'attack', w: [0.26, 0.6], m: 1.1 }, { a: 'attack3', w: [0.33, 0.62], m: 1.7, fin: true }],
  spear: [{ a: 'thrust', w: [0.28, 0.55], m: 1, speed: 1.3 }, { a: 'thrust', w: [0.28, 0.55], m: 1, speed: 1.4 }, { a: 'thrust', w: [0.28, 0.55], m: 1.1, speed: 1.5 }, { a: 'attack', w: [0.26, 0.6], m: 1.5, fin: true }],
  club: [{ a: 'attack3', w: [0.33, 0.62], m: 1, speed: 0.72 }, { a: 'attack', w: [0.28, 0.62], m: 1.3, speed: 0.7, fin: true }],
  fist: [{ a: 'attack', w: [0.28, 0.55], m: 1, speed: 1.3 }, { a: 'attack2', w: [0.28, 0.55], m: 1, speed: 1.3 }],
};
const ARC = { sword: 1.25, spear: 0.5, club: 1.45, fist: 0.9 };
const REACH = { fist: 1.1 };
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _d = new THREE.Vector3();
const wrap = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

export function createHero(ctx, sys) {
  const { THREE: T3, input, events, camera, world } = ctx;
  const fx = sys.fx;
  const player = () => ctx.systems.player;
  const inv = { weapons: [], bows: [], shields: [], arrows: 20, blastcaps: 3, equipped: { weapon: null, bow: null, shield: null } };
  const SLOTS = { weapons: 8, bows: 4, shields: 4 };
  const meshes = { weapon: null, bow: null, shield: null };
  const st = {
    drawn: false, idleT: 0, swing: null, step: 0, comboT: 9, queued: false, holdT: 0, charging: false,
    aiming: false, aimT: 0, drawT: 0, lastShield: -9, guard: false, flurryT: 0, flurryTarget: null, flurryHits: 0,
    lock: null, lockVec: new THREE.Vector3(), faceOff: 0, spinA: 0, spin: 0, jumpT: -9, dodgeT: 0, throwT: -1, lowWarned: new Set(),
    shieldHeld: false, hitStop: 0, slowT: 0, slowScale: 1,
  };
  const trail = sys.trail;
  const isPressed = a => !ctx.paused && input.justPressed(a);
  const isHeld = a => !ctx.paused && input.held(a);

  // ---------------------------------------------------------------- HUD (lock reticle, crosshair, flurry vignette)
  const hud = document.createElement('div');
  hud.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
  ctx.hud?.appendChild(hud);
  const reticle = document.createElement('div');
  reticle.style.cssText = 'position:absolute;width:64px;height:64px;margin:-32px 0 0 -32px;display:none;';
  reticle.innerHTML = `<svg viewBox="0 0 64 64" width="64" height="64" style="overflow:visible;filter:drop-shadow(0 0 4px rgba(255,150,60,.9))">
    <g fill="#ffae3d" stroke="#2a1208" stroke-width="2" stroke-linejoin="round">
      <path d="M32 18 L24 6 L40 6 Z"/><path d="M32 46 L40 58 L24 58 Z"/><path d="M18 32 L6 40 L6 24 Z"/><path d="M46 32 L58 24 L58 40 Z"/></g>
    <circle cx="32" cy="32" r="15" fill="none" stroke="#2a1208" stroke-width="4" opacity=".55"/>
    <circle cx="32" cy="32" r="15" fill="none" stroke="#ffd79a" stroke-width="2" stroke-dasharray="7 5"/></svg>`;
  hud.appendChild(reticle);
  const cross = document.createElement('div');
  cross.style.cssText = 'position:absolute;left:50%;top:50%;width:30px;height:30px;margin:-15px 0 0 -15px;display:none;';
  cross.innerHTML = `<svg viewBox="0 0 30 30" width="30" height="30"><g stroke="#fff8e8" stroke-width="2" stroke-linecap="round" style="filter:drop-shadow(0 0 2px #000)">
    <line x1="15" y1="2" x2="15" y2="9"/><line x1="15" y1="21" x2="15" y2="28"/><line x1="2" y1="15" x2="9" y2="15"/><line x1="21" y1="15" x2="28" y2="15"/></g>
    <circle cx="15" cy="15" r="1.6" fill="#ffcf6a"/></svg>`;
  hud.appendChild(cross);
  const vignette = document.createElement('div');
  vignette.style.cssText = 'position:absolute;inset:0;opacity:0;transition:opacity .25s;background:radial-gradient(ellipse at center, rgba(120,200,255,0) 45%, rgba(40,90,160,.45) 100%);mix-blend-mode:multiply;';
  hud.appendChild(vignette);
  const ammo = document.createElement('div');
  ammo.style.cssText = 'position:absolute;left:50%;top:50%;margin:24px 0 0 -40px;width:80px;text-align:center;font:600 13px/1 Georgia,serif;color:#fff6e0;text-shadow:0 1px 3px #000;display:none;letter-spacing:.08em';
  hud.appendChild(ammo);

  // ---------------------------------------------------------------- inventory
  function category(w) { return w.def.type === 'bow' ? 'bows' : w.def.type === 'shield' ? 'shields' : 'weapons'; }
  function slotOf(w) { return w.def.type === 'bow' ? 'bow' : w.def.type === 'shield' ? 'shield' : 'weapon'; }
  function addWeapon(w, autoEquip = true) {
    if (typeof w === 'string') w = makeWeapon(w);
    if (!w) return false;
    const cat = category(w);
    if (inv[cat].length >= SLOTS[cat]) return false;
    inv[cat].push(w);
    events.emit('weaponAdded', { weapon: info(w) });
    if (autoEquip && !inv.equipped[slotOf(w)]) equip(w);
    try { ctx.systems.gameplay?.onWeaponAdded?.(info(w)); } catch (e) { /* optional */ }
    return true;
  }
  function info(w) { return w ? { uid: w.uid, id: w.id, name: w.def.name, type: w.def.type, dmg: w.def.dmg, dur: w.dur, maxDur: w.maxDur } : null; }
  function findWeapon(q) {
    if (!q) return null;
    if (q.uid) q = q.uid;
    for (const cat of ['weapons', 'bows', 'shields']) for (const w of inv[cat]) if (w.uid === q || w.id === q || w === q) return w;
    return null;
  }
  function equip(q) {
    const w = findWeapon(q);
    if (!w) return false;
    const slot = slotOf(w);
    inv.equipped[slot] = w;
    rebuildMesh(slot);
    events.emit('weaponEquipped', { slot, weapon: info(w) });
    return true;
  }
  function unequip(slot) { inv.equipped[slot] = null; rebuildMesh(slot); }
  function rebuildMesh(slot) {
    if (meshes[slot]) { meshes[slot].parent?.remove(meshes[slot]); meshes[slot] = null; }
    const w = inv.equipped[slot];
    if (w) { meshes[slot] = buildWeaponMesh(ctx, w.id); }
    attach();
  }
  // place meshes in hands or on the back depending on drawn/aim/guard state
  function attach() {
    const pl = player(); if (!pl) return;
    const mw = meshes.weapon, mb = meshes.bow, ms = meshes.shield;
    const wantWeaponHand = st.drawn && !st.aiming;
    if (mw) {
      const parent = wantWeaponHand ? pl.handR : pl.back;
      if (mw.parent !== parent) parent?.add(mw);
      if (wantWeaponHand) { mw.position.set(0, -0.02, 0.02); mw.rotation.set(-0.15, 0, 0); if (inv.equipped.weapon.def.type === 'spear') mw.position.z = -0.55; }
      else { mw.position.set(-0.16, 0.26, -0.05); mw.rotation.set(Math.PI / 2 + 0.15, 0, 0.55, 'ZYX'); if (inv.equipped.weapon.def.type === 'spear') mw.position.set(-0.1, 0.9, -0.08); }
    }
    if (mb) {
      const parent = st.aiming ? pl.handL : pl.back;
      if (mb.parent !== parent) parent?.add(mb);
      if (st.aiming) { mb.position.set(0, -0.02, 0.02); mb.rotation.set(0, 0, 0); }
      else { mb.position.set(0.08, 0.12, -0.1); mb.rotation.set(Math.PI / 2, 0, -0.6, 'ZYX'); }
    }
    if (ms) {
      const inHand = st.drawn && !st.aiming;
      const parent = inHand ? pl.handL : pl.back;
      if (ms.parent !== parent) parent?.add(ms);
      if (inHand) { ms.position.set(0.07, 0.02, 0.02); ms.rotation.set(0, 0, Math.PI / 2); }
      else { ms.position.set(0, 0.0, -0.1); ms.rotation.set(Math.PI / 2, 0, 0); }
    }
  }
  function cyc(cat, slot) { const a = inv[cat]; if (a.length < 2) return; const i = a.indexOf(inv.equipped[slot]); equip(a[(i + 1) % a.length]); }
  function setDrawn(v) { if (st.drawn === v) return; st.drawn = v; attach(); events.emit(v ? 'weaponDrawn' : 'weaponSheathed', {}); }

  function wear(slot, n = 1) {
    const w = inv.equipped[slot]; if (!w) return;
    w.dur -= n;
    const low = Math.max(2, Math.round(w.maxDur * 0.2));
    if (w.dur <= low && !st.lowWarned.has(w.uid) && w.dur > 0) { st.lowWarned.add(w.uid); events.emit('weaponLow', { weapon: info(w) }); }
    if (w.dur <= 0) breakWeapon(slot);
  }
  function breakWeapon(slot) {
    const w = inv.equipped[slot]; if (!w) return;
    const m = meshes[slot];
    if (m) {
      m.updateMatrixWorld(true);
      _v.set(0, 0, (m.userData.tipZ || 0.5) * 0.6); m.localToWorld(_v);
      const c = w.def.type === 'shield' ? [0.6, 0.45, 0.3] : w.def.type === 'bow' ? [0.75, 0.55, 0.35] : [0.82, 0.86, 0.9];
      fx.shatter(_v, c, 26);
    }
    const cat = category(w);
    inv[cat].splice(inv[cat].indexOf(w), 1);
    inv.equipped[slot] = null;
    rebuildMesh(slot);
    sys.slowmo(0.3, 0.35);
    sys.shake(0.35);
    events.emit('weaponBroke', { weapon: info(w), slot });
    // re-arm with the best remaining weapon of that kind after a beat
    setTimeout(() => {
      if (inv.equipped[slot]) return;
      const best = inv[cat].slice().sort((a, b) => b.def.dmg - a.def.dmg || b.dur - a.dur)[0];
      if (best) equip(best);
    }, 650);
  }

  // ---------------------------------------------------------------- targeting helpers
  function enemiesNear(r) { const pl = player(); return sys.enemies.list.filter(e => !e.dead && e.c.root.visible && e.pos.distanceToSquared(pl.position) < r * r); }
  function camForward(out) { camera.getWorldDirection(out); return out; }
  function pickLock() {
    const pl = player(); if (!pl) return null;
    camForward(_d); _d.y = 0; _d.normalize();
    let best = null, bs = -1e9;
    for (const e of enemiesNear(22)) {
      _v.subVectors(e.pos, pl.position); const d = _v.length(); _v.y = 0; _v.normalize();
      const s = _v.dot(_d) * 2 - d / 22;
      if (s > bs && _v.dot(_d) > 0.2) { bs = s; best = e; }
    }
    return best;
  }
  function setLock(e) {
    st.lock = e;
    const pl = player();
    if (e) { e.lockPoint.getWorldPosition(st.lockVec); pl?.setLockTarget?.(st.lockVec); events.emit('lockOn', { id: e.id }); setDrawn(true); }
    else { pl?.setLockTarget?.(null); reticle.style.display = 'none'; }
  }
  sys.clearLock = () => setLock(null);
  function autoTarget(maxD = 4.5, maxA = 1.1) {
    const pl = player();
    if (st.lock && !st.lock.dead) return st.lock;
    let best = null, bs = 1e9;
    for (const e of enemiesNear(maxD)) {
      const a = Math.abs(wrap(Math.atan2(e.pos.x - pl.position.x, e.pos.z - pl.position.z) - pl.yaw));
      const s = a * 2 + e.pos.distanceTo(pl.position) * 0.3;
      if (a < maxA && s < bs) { bs = s; best = e; }
    }
    return best;
  }

  // ---------------------------------------------------------------- melee
  function weaponType() { const w = inv.equipped.weapon; return w ? w.def.type : 'fist'; }
  function startSwing(step, opts = {}) {
    const pl = player();
    const type = weaponType();
    const combo = COMBOS[type];
    const s = combo[step % combo.length];
    const speed = (s.speed || 1) * (opts.speed || 1);
    const dur = pl.playAction(s.a, { speed }) || 0.5;
    st.swing = { s, t: 0, dur, hit: new Set(), hitAny: false, spin: false, strong: type === 'club' || s.fin, target: autoTarget() };
    st.step = step; st.comboT = 0; st.queued = false;
    setDrawn(true);
    // lunge towards the target
    const tg = st.swing.target;
    if (tg) {
      _v.subVectors(tg.pos, pl.position); _v.y = 0; const d = _v.length();
      if (d > 1.2 && d < 4.5) { _v.normalize(); pl.velocity.x += _v.x * Math.min(5, d * 1.4); pl.velocity.z += _v.z * Math.min(5, d * 1.4); }
    } else { pl.velocity.x += Math.sin(pl.yaw) * 1.6; pl.velocity.z += Math.cos(pl.yaw) * 1.6; }
    events.emit('swing', { weapon: info(inv.equipped.weapon), step, finisher: !!s.fin, position: pl.position.clone() });
  }
  function startSpin() {
    const pl = player();
    if (pl.stamina < 15) return;
    pl.stamina = pl.stamina - 25;
    const dur = pl.playAction('spin', { speed: 0.85 }) || 0.8;
    st.swing = { s: { a: 'spin', w: [0.05, 0.95], m: 1.3 }, t: 0, dur, hit: new Set(), hitAny: false, spin: true, strong: true, target: null, hits2: new Set() };
    st.spin = dur; st.spinA = 0;
    events.emit('swing', { weapon: info(inv.equipped.weapon), spin: true, position: pl.position.clone() });
  }
  function weaponSegment(outBase, outTip) {
    const m = meshes.weapon;
    const pl = player();
    if (m && m.parent === pl.handR) {
      m.updateMatrixWorld(true);
      outBase.set(0, 0, m.userData.baseZ); m.localToWorld(outBase);
      outTip.set(0, 0, m.userData.tipZ); m.localToWorld(outTip);
      return true;
    }
    pl.handR?.getWorldPosition(outTip); outBase.copy(outTip);
    return false;
  }
  function meleeHits(sw) {
    const pl = player();
    const type = weaponType();
    const w = inv.equipped.weapon;
    const reach = (w ? w.def.reach : REACH.fist) + (sw.spin ? 0.2 : 0);
    const arc = sw.spin ? Math.PI : ARC[type];
    const yaw = pl.yaw + st.faceOff + (sw.spin ? st.spinA : 0);
    const hitSet = sw.spin && sw.t > sw.dur * 0.5 ? sw.hits2 : sw.hit;
    let any = false;
    for (const e of sys.enemies.list) {
      if (e.dead || hitSet.has(e) || !e.c.root.visible) continue;
      const dx = e.pos.x - pl.position.x, dz = e.pos.z - pl.position.z;
      const d = Math.hypot(dx, dz) - e.c.radius;
      if (d > reach) continue;
      const dy = (e.pos.y + e.c.height * 0.5) - (pl.position.y + 1);
      if (Math.abs(dy) > e.c.height * 0.6 + 1) continue;
      const a = Math.abs(wrap(Math.atan2(dx, dz) - yaw));
      if (a > arc && d > 0.4) continue;
      hitSet.add(e);
      e.lockPoint.getWorldPosition(_v);
      _v.lerp(_v2.set(pl.position.x, e.lockPoint.getWorldPosition(_v3).y, pl.position.z), 0.35);
      _d.set(dx, 0, dz).normalize();
      const base = w ? w.def.dmg : 1;
      const dmg = base * sw.s.m * (ctx.systems.gameplay?.getAttackMultiplier?.() || 1);   // food buffs
      const kb = (type === 'club' ? 9 : type === 'spear' ? 3 : 4.5) + (sw.s.fin ? 4 : 0) + (sw.spin ? 3 : 0);
      sys.enemies.hurt(e, dmg, { source: 'player', type: 'melee', point: _v.clone(), dir: _d.clone(), knock: _d.clone().multiplyScalar(kb), strong: sw.strong, from: pl.position });
      any = true;
      if (w?.def.element === 'fire') fx.element(_v, 'ember', 14, 3);
    }
    // weapons also strike bombs / barrels
    _v.set(pl.position.x + Math.sin(yaw) * reach * 0.7, pl.position.y + 0.6, pl.position.z + Math.cos(yaw) * reach * 0.7);
    if (sys.items?.strike(_v, reach * 0.6, _d.set(Math.sin(yaw), 0, Math.cos(yaw)), { strong: sw.strong })) any = true;
    if (any) {
      sys.hitStop(sw.s.fin || type === 'club' ? 0.095 : 0.055);
      pl.camera?.shake?.(type === 'club' || sw.s.fin ? 0.4 : 0.22);
      if (!sw.hitAny) { sw.hitAny = true; wear('weapon', 1); }
    }
  }

  // ---------------------------------------------------------------- bow
  function shoot() {
    const pl = player();
    if (!inv.equipped.bow || inv.arrows <= 0) return;
    if (st.drawT < 0.35) return;
    // aim point: ray from the camera centre
    camForward(_d);
    const from = _v.copy(camera.position);
    let dist = 80;
    for (let t = 2; t < 120; t += 1.5) {
      _v2.copy(from).addScaledVector(_d, t);
      if (_v2.y < world.getHeight(_v2.x, _v2.z)) { dist = t; break; }
    }
    for (const e of sys.enemies.list) {
      if (e.dead) continue;
      e.lockPoint.getWorldPosition(_v3);
      const t = _v3.clone().sub(from).dot(_d);
      if (t > 0 && t < dist) { const p = from.clone().addScaledVector(_d, t); if (p.distanceTo(_v3) < e.c.radius + e.c.height * 0.3) dist = t; }
    }
    const target = from.clone().addScaledVector(_d, dist);
    const src = new THREE.Vector3();
    (meshes.bow || pl.handL).getWorldPosition(src);
    src.addScaledVector(_d, 0.35);
    const power = Math.min(1, st.drawT / 0.8);
    sys.projectiles.arrow(src, target, { owner: 'player', speed: 32 + power * 22, dmg: inv.equipped.bow.def.dmg * (0.6 + power * 0.4) });
    inv.arrows--;
    st.drawT = 0;
    wear('bow', 1);
    events.emit('arrowShot', { owner: 'player', position: src.clone(), power });
    pl.playAction('bow', { hold: true, speed: 1.6 });
  }
  function updateAimCamera(dt) {
    const pl = player(); const cs = pl.camera?.state;
    if (!cs) return;
    st.aimT = Math.min(1, st.aimT + dt * 6);
    const yaw = cs.yaw, pitch = Math.max(-0.6, Math.min(0.9, cs.pitch * 0.8));
    const fx_ = -Math.sin(yaw), fz = -Math.cos(yaw);       // look direction (camera sits behind)
    const rx = -fz, rz = fx_;                                 // right
    _v.set(pl.position.x - fx_ * 1.6 + rx * 0.62, pl.position.y + 1.55 + Math.sin(pitch) * 1.2, pl.position.z - fz * 1.6 + rz * 0.62);
    const gh = world.getHeight(_v.x, _v.z) + 0.3; if (_v.y < gh) _v.y = gh;
    camera.position.lerp(_v, st.aimT);
    _v2.set(_v.x + fx_ * Math.cos(pitch) * 20, _v.y - Math.sin(pitch) * 20, _v.z + fz * Math.cos(pitch) * 20);
    camera.lookAt(_v2);
    const fov = camera.fov + (40 - camera.fov) * st.aimT;
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    // turn the body (visually) toward the aim, clamped
    // the bow pose twists the chest ~0.9 rad left, so turn the body right by that much to put the bow on target
    st.faceOffTarget = wrap(Math.atan2(fx_, fz) - pl.yaw - 0.9);
  }

  // ---------------------------------------------------------------- flurry (perfect dodge)
  function startFlurry(target) {
    if (st.flurryT > 0) return;
    st.flurryT = 2.8; st.flurryTarget = target; st.flurryHits = 0;
    sys.enemyTime = 0.1;
    vignette.style.opacity = '1';
    events.emit('flurryStart', { id: target?.id });
    if (target) { target.attacking = false; target.strikeAt = -1; }
  }
  function endFlurry() { st.flurryT = 0; sys.enemyTime = 1; vignette.style.opacity = '0'; events.emit('flurryEnd', { hits: st.flurryHits }); }
  events.on('jump', () => {
    st.jumpT = sys.time;
    const pl = player(); if (!pl) return;
    // side-hop / backflip while locked on: give the jump an evasive push
    if (st.lock) {
      const m = input.move();
      const cs = pl.camera?.state;
      const yaw = cs ? cs.yaw + Math.PI : pl.yaw;
      const fx_ = Math.sin(yaw), fz = Math.cos(yaw);
      let dx = fx_ * m.y + fz * m.x * -1, dz = fz * m.y - fx_ * m.x * -1;
      if (Math.hypot(m.x, m.y) < 0.2) { dx = -Math.sin(pl.yaw); dz = -Math.cos(pl.yaw); }
      const l = Math.hypot(dx, dz) || 1;
      pl.velocity.x += dx / l * 5.5; pl.velocity.z += dz / l * 5.5;
    }
    // perfect dodge: an enemy strike was about to land on us
    for (const e of sys.enemies.list) {
      if (e.dead || e.strikeAt < 0) continue;
      const tl = e.strikeAt - sys.time;
      if (tl > -0.02 && tl < 0.42 && e.pos.distanceTo(pl.position) < e.strikeReach + 1.2) { st.dodgeT = 0.5; startFlurry(e); break; }
    }
  });

  // ---------------------------------------------------------------- damage in (called by enemies/projectiles/explosions)
  function damagePlayer(amount, o = {}) {
    const pl = player(); if (!pl || pl.state === 'dead') return false;
    if (st.dodgeT > 0 || st.flurryT > 0) return 'dodge';
    const src = o.position || o.source?.pos;
    let facing = true;
    if (src) facing = Math.abs(wrap(Math.atan2(src.x - pl.position.x, src.z - pl.position.z) - pl.yaw)) < 1.75;
    // late perfect dodge
    if ((o.type === 'melee' || o.type === 'charge') && sys.time - st.jumpT < 0.22 && o.source?.pos) { st.dodgeT = 0.4; startFlurry(o.source); return 'dodge'; }
    const shield = inv.equipped.shield;
    const blockable = o.type !== 'explosion' && o.type !== 'crush';
    if (shield && facing && blockable && sys.time - st.lastShield < 0.26) {
      // PARRY
      _v.copy(pl.position); _v.y += 1.1;
      if (src) _v.lerp(_v2.set(src.x, pl.position.y + 1.1, src.z), 0.15);
      fx.sparks(_v, null, 26, [1, 0.92, 0.6], 1.5);
      fx.ring(pl.position.x, pl.position.y, pl.position.z, 2.2, 0xfff0c0, 0.3);
      sys.hitStop(0.14); sys.slowmo(0.35, 0.45);
      pl.camera?.shake?.(0.3);
      wear('shield', 1);
      events.emit('parry', { position: _v.clone(), source: o.source?.id ?? null });
      return 'parry';
    }
    if (shield && facing && blockable && st.guard) {
      // BLOCK: chip damage only for heavy blows
      _v.copy(pl.position); _v.y += 1.0;
      fx.sparks(_v, null, 12, [1, 0.85, 0.5], 1);
      const heavy = amount >= 4 || o.type === 'charge';
      if (o.knockback) pl.velocity.add(_v2.copy(o.knockback).multiplyScalar(heavy ? 0.6 : 0.3).setY(0));
      wear('shield', heavy ? 2 : 1);
      events.emit('block', { position: _v.clone(), heavy });
      if (heavy) pl.damage(Math.ceil(amount * 0.25), { source: o.source, type: o.type, iframes: 0.5 });
      return 'block';
    }
    const def = ctx.systems.gameplay?.getDefenseMultiplier?.() || 1;                       // food buffs
    if (def > 1) amount = Math.max(1, Math.round(amount / def));
    const ok = pl.damage(amount, { source: o.source?.kind || o.source, knockback: o.knockback, type: o.type });
    if (ok && st.swing) { st.swing = null; }
    return ok;
  }

  // ---------------------------------------------------------------- per-frame
  function update(dt, realDt) {
    const pl = player(); if (!pl) return;
    if (!hud.isConnected) ctx.hud?.appendChild(hud);   // another system may rebuild the HUD root
    const ps = pl.state;
    const busy = ps === 'climb' || ps === 'glide' || ps === 'swim' || ps === 'mantle' || ps === 'dead' || ps === 'camp' || ps === 'cooking';
    const canFight = ps === 'ground' || ps === 'air';
    st.dodgeT = Math.max(0, st.dodgeT - realDt);
    if (st.flurryT > 0) { st.flurryT -= realDt; if (st.flurryT <= 0) endFlurry(); }

    // sheath when climbing / gliding / swimming
    if (busy && st.drawn) { setDrawn(false); st.swing = null; }
    if (busy && st.aiming) stopAim();

    // ---- lock-on
    if (canFight && isPressed('lockon')) setLock(st.lock ? null : pickLock());
    if (st.lock) {
      if (st.lock.dead || st.lock.pos.distanceTo(pl.position) > 30) setLock(st.lock.dead ? pickLock() : null);
    }
    if (st.lock) {
      st.lock.lockPoint.getWorldPosition(st.lockVec);
      _v.copy(st.lockVec).project(camera);
      if (_v.z < 1 && Math.abs(_v.x) < 1.2 && Math.abs(_v.y) < 1.2) {
        reticle.style.display = 'block';
        reticle.style.left = ((_v.x * 0.5 + 0.5) * innerWidth) + 'px';
        reticle.style.top = ((-_v.y * 0.5 + 0.5) * innerHeight) + 'px';
        reticle.style.transform = `rotate(${(sys.time * 25) % 360}deg) scale(${1 + Math.sin(sys.time * 6) * 0.06})`;
      } else reticle.style.display = 'none';
    }

    // ---- shield guard / parry window
    const shieldDown = canFight && isPressed('shield');
    if (shieldDown) { st.lastShield = sys.time; if (inv.equipped.shield) { setDrawn(true); } }
    st.guard = canFight && isHeld('shield') && !!inv.equipped.shield && pl.state === 'ground';
    if (st.guard && !st.shieldHeld && !st.swing) { pl.playAction('shield', { hold: true }); st.shieldHeld = true; }
    if (!st.guard && st.shieldHeld) { if (pl.action && !st.swing) pl.releaseAction(); st.shieldHeld = false; }

    // ---- bow aim
    if ((canFight || st.forceAim) && inv.equipped.bow && (isHeld('aim') || st.forceAim) && inv.arrows > 0) {
      if (!st.aiming) { st.aiming = true; st.aimT = 0; st.drawT = 0; setDrawn(true); attach(); pl.playAction('bow', { hold: true }); events.emit('aimStart', {}); }
      st.drawT += dt;
      updateAimCamera(realDt);
      cross.style.display = 'block'; ammo.style.display = 'block'; ammo.textContent = `${inv.arrows} →`;
      if (isPressed('attack')) shoot();
    } else if (st.aiming) stopAim();
    if (st.forceAim) st.drawT = 1;

    // ---- melee
    st.comboT += dt;
    if (canFight && !st.aiming) {
      if (isPressed('attack')) {
        st.holdT = 0;
        if (st.flurryT > 0 && st.flurryTarget && !st.flurryTarget.dead) flurryStrike();
        else if (st.swing) { if (st.swing.t > st.swing.dur * 0.3) st.queued = true; }
        else startSwing(st.comboT < 0.45 ? st.step + 1 : 0);
      }
      if (isHeld('attack')) { st.holdT += dt; if (st.holdT > 0.5 && !st.charging && inv.equipped.weapon) { st.charging = true; events.emit('chargeStart', {}); } }
      if (input.justReleased('attack')) {
        if (st.charging && !st.swing) startSpin();
        else if (st.charging) st.queuedSpin = true;
        st.charging = false; st.holdT = 0;
      }
    }
    if (st.charging && meshes.weapon && Math.random() < dt * 25) {
      weaponSegment(_v, _v2);
      fx.spawnAdd({ x: _v2.x, y: _v2.y, z: _v2.z, life: 0.3, size: 0.25, size1: 0.05, cell: 0, r: 1, g: 0.85, b: 0.5, a: 0.9, vy: 0.5 });
    }
    let trailOn = false;
    if (st.swing) {
      const sw = st.swing;
      sw.t += dt;
      const u = sw.t / sw.dur;
      // auto-face towards the target (visual offset, clamped)
      if (sw.target && !sw.target.dead) st.faceOffTarget = Math.max(-0.9, Math.min(0.9, wrap(Math.atan2(sw.target.pos.x - pl.position.x, sw.target.pos.z - pl.position.z) - pl.yaw)));
      if (u >= sw.s.w[0] && u <= sw.s.w[1]) { meleeHits(sw); trailOn = !!meshes.weapon || sw.spin; }
      if (sw.spin) st.spinA = -Math.PI * 2 * Math.min(1, Math.max(0, (u - 0.05) / 0.85));
      if (u >= 1) {
        st.swing = null; st.spinA = 0;
        if (st.queuedSpin) { st.queuedSpin = false; startSpin(); }
        else if (st.queued && canFight) startSwing(st.step + 1);
      }
    } else if (!st.aiming) st.faceOffTarget = st.lock ? Math.max(-0.5, Math.min(0.5, wrap(Math.atan2(st.lockVec.x - pl.position.x, st.lockVec.z - pl.position.z) - pl.yaw))) : 0;
    if (!st.aiming && !st.swing && !st.lock) st.faceOffTarget = 0;
    st.faceOff = wrap(st.faceOff + wrap((st.faceOffTarget || 0) - st.faceOff) * Math.min(1, realDt * 14));
    // facing offset lives on the skinned body mesh (the player never writes its transform, and its
    // cloak/scarf anchors read the body's world matrices, so the cloth stays attached)
    const body = pl.rig?.mesh;
    if (body) body.rotation.y = Math.abs(st.faceOff) > 1e-3 || st.spinA ? st.faceOff + st.spinA : 0;

    // slash trail along the blade
    if (meshes.weapon && meshes.weapon.parent === pl.handR) { weaponSegment(_v, _v2); trail.active = trailOn; trail.update(dt, _v, _v2); }
    else { trail.active = false; trail.update(dt, null, null); }

    // low-durability pulse on the equipped meshes
    for (const slot of ['weapon', 'bow', 'shield']) {
      const w = inv.equipped[slot], m = meshes[slot];
      if (!w || !m) continue;
      const low = w.dur <= Math.max(2, Math.round(w.maxDur * 0.2));
      const k = low ? (0.5 + 0.5 * Math.sin(sys.time * 9)) * 0.55 : 0;
      m.userData.mat.uniforms.uFlash.value.setRGB(k, k * 0.25, k * 0.15);
    }

    // ---- throw blastcap
    if (canFight && isPressed('throw') && inv.blastcaps > 0 && st.throwT < 0) { pl.playAction('throw'); st.throwT = 0.22; }
    if (st.throwT >= 0) {
      st.throwT -= dt;
      if (st.throwT < 0) {
        st.throwT = -1;
        camForward(_d); _d.y = Math.max(_d.y, -0.1) + 0.25; _d.normalize();
        pl.handR.getWorldPosition(_v); _v.y += 0.2;
        sys.items.throwBomb(_v, _d, 12);
        inv.blastcaps--; events.emit('bombThrown', { remaining: inv.blastcaps });
      }
    }

    // ---- weapon switching: 1-8 pick a melee weapon, X / Z / V cycle weapon / shield / bow
    if (!ctx.paused) {
      for (let k = 0; k < 8; k++) if (input.justPressed('Digit' + (k + 1)) && inv.weapons[k]) equip(inv.weapons[k]);
      if (input.justPressed('KeyX')) cyc('weapons', 'weapon');
      if (input.justPressed('KeyZ')) cyc('shields', 'shield');
      if (input.justPressed('KeyV')) cyc('bows', 'bow');
    }
    // ---- pickups / chests
    if (isPressed('interact') && pl.state === 'ground') interact();

    // ---- draw / sheath
    const threat = sys.enemies.list.some(e => e.alerted && !e.dead && e.pos.distanceToSquared(pl.position) < 625);
    if (st.swing || st.aiming || st.lock || threat || st.guard) st.idleT = 0; else st.idleT += dt;
    if (threat && !st.drawn && canFight) setDrawn(true);
    if (st.drawn && st.idleT > 6 && !busy) setDrawn(false);
  }
  function stopAim() {
    st.aiming = false; st.aimT = 0; cross.style.display = 'none'; ammo.style.display = 'none';
    const pl = player(); if (pl?.action) pl.releaseAction();
    attach(); events.emit('aimEnd', {});
  }
  function flurryStrike() {
    const pl = player(); const e = st.flurryTarget;
    const combo = COMBOS[weaponType()];
    pl.playAction(combo[st.flurryHits % combo.length].a, { speed: 2.2 });
    // dash beside the target
    _v.subVectors(e.pos, pl.position); _v.y = 0; const d = _v.length();
    if (d > 1.4) { _v.normalize(); pl.velocity.x += _v.x * Math.min(8, d * 2.5); pl.velocity.z += _v.z * Math.min(8, d * 2.5); }
    e.lockPoint.getWorldPosition(_v2);
    const w = inv.equipped.weapon;
    sys.enemies.hurt(e, (w ? w.def.dmg : 1) * 1.0, { source: 'player', type: 'flurry', point: _v2.clone(), dir: _v.clone(), knock: _v3.set(0, 0, 0) });
    st.flurryHits++;
    trail.active = true;
    fx.sparks(_v2, null, 8, [0.7, 0.9, 1], 0.9);
    sys.hitStop(0.035);
    if (st.flurryHits >= 8 || e.dead) { st.flurryT = Math.min(st.flurryT, 0.25); }
    if (st.flurryHits % 3 === 0) wear('weapon', 1);
  }
  function interact() {
    const pl = player();
    const it = sys.items.nearestPickup(pl.position, 1.8);
    if (it && it.type === 'weapon') {
      const w = it.weapon;
      const cat = category(w);
      if (inv[cat].length >= SLOTS[cat]) {
        // swap with the equipped one
        const cur = inv.equipped[slotOf(w)];
        if (cur) { inv[cat].splice(inv[cat].indexOf(cur), 1); sys.items.dropWeapon(cur, _v.copy(pl.position).setY(pl.position.y + 0.8), _v2.set(Math.sin(pl.yaw) * 2, 2, Math.cos(pl.yaw) * 2)); inv.equipped[slotOf(w)] = null; }
        else return;
      }
      sys.items.take(it);
      addWeapon(w, true);
      if (inv.equipped[slotOf(w)] !== w) equip(w);
      pl.playAction('interact', { speed: 1.4 });
      events.emit('itemPickup', { id: w.id, name: w.def.name, kind: 'weapon', count: 1, position: it.pos.clone(), weapon: info(w) });
      return;
    }
    if (it && it.type === 'bomb') {
      sys.items.take(it); inv.blastcaps++;
      pl.playAction('interact', { speed: 1.4 });
      events.emit('itemPickup', { id: 'blastcap', name: 'Blastcap', kind: 'bomb', count: 1, position: it.pos.clone() });
      return;
    }
    for (const camp of sys.camps) {
      const ch = camp.chest;
      if (!ch.opened && Math.hypot(ch.x - pl.position.x, ch.z - pl.position.z) < 1.9) { sys.openChest(camp); pl.playAction('interact'); return; }
    }
  }

  // ---------------------------------------------------------------- starting kit
  addWeapon('wayfarer_blade'); addWeapon('bark_shield'); addWeapon('ash_bow');

  return {
    inv, st, update, damagePlayer, addWeapon, equip, unequip, info, setDrawn, attach, setLock, startSwing, meshes, weaponSegment,
    getInventoryWeapons() {
      return { weapons: inv.weapons.map(info), bows: inv.bows.map(info), shields: inv.shields.map(info),
        equipped: { weapon: info(inv.equipped.weapon), bow: info(inv.equipped.bow), shield: info(inv.equipped.shield) }, arrows: inv.arrows, blastcaps: inv.blastcaps };
    },
  };
}
