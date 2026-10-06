// combat system — weapons with durability, enemies, camps, AI, hero melee/bow/shield.
//
// API (ctx.systems.combat):
//   damagePlayer(amount, {source, knockback:Vector3, type, position}) -> true | false | 'block' | 'parry' | 'dodge'
//   getEnemies() -> live enemies [{id, kind, tier, pos, hp, maxHp, state, alerted, camp}]
//   spawnEnemy(kind, x, z, opts) ('gnarl' {tier: moss|ember|dusk|bone, weapon}, 'shellback', 'stonewarden', 'wisp' {element})
//   spawnCamp(x, z, opts) -> camp     (opts: {name, roster:[{kind,tier,weapon,station}], tents, tower, walls, seed})
//   equip(weaponUid|id), unequip(slot), addWeapon(id), getInventoryWeapons(), getEquipped()
//   damageArea(x, y, z, radius, amount, opts)  (for other systems' explosions / hazards)
//   queryColliders(x, z, r, out) -> camp prop colliders (terrain collider shape format)
//   camps, enemies, weapons (catalogue), arrows / blastcaps counts on getInventoryWeapons()
// Events emitted: hit {target, kind, damage, position, material}, enemyKilled {kind, tier, position, camp},
//   enemyAlert, enemyWindup, enemyTaunt, enemyPoof, sneakStrike, swing, parry, block, flurryStart, flurryEnd,
//   lockOn, weaponLow, weaponBroke {weapon, slot}, weaponEquipped, weaponAdded, weaponDrawn, weaponSheathed,
//   arrowShot, arrowHit, boltCast, slam, explosion, fuseLit, bombKicked, bombThrown, itemPickup, campCleared, chestOpened
// Listens: 'equipWeapon' {uid|id} (UI), 'shot'.
//
// Camps clear the vegetation's ground cover inside their palisade by extending the shared
// world.getPathMask (camp ground counts as trampled path) before the field map is rebuilt.
import * as THREE from 'three';
import { createVfx, Trail } from './vfx.js';
import { createEnemies } from './enemies.js';
import { createItems } from './items.js';
import { createProjectiles } from './projectiles.js';
import { createHero } from './hero.js';
import { buildCamp } from './camps.js';
import { fireLight } from './toon.js';
import { WEAPONS, makeWeapon } from './weapons.js';

// Hand-placed camp targets (refined at runtime to the flattest nearby ground)
const CAMP_TARGETS = [
  { name: 'Bramblehorn Camp', x: 120, z: 190, seed: 11, entrance: 2.4, roster: [
    { kind: 'gnarl', tier: 'moss', weapon: 'spiked_bough', station: 'eat' },
    { kind: 'gnarl', tier: 'moss', weapon: 'gnarl_cleaver', station: 'eat' },
    { kind: 'gnarl', tier: 'ember', weapon: 'gnarl_pike', station: 'sleep' },
    { kind: 'gnarl', tier: 'moss', weapon: 'horn_bow', station: 'tower' },
    { kind: 'gnarl', tier: 'moss', weapon: 'gnarl_pike', station: 'patrol' },
  ], bombs: 2, barrels: 1 },
  { name: 'Ashen Ridge Camp', x: -165, z: 150, seed: 23, roster: [
    { kind: 'gnarl', tier: 'ember', weapon: 'spiked_bough', station: 'eat' },
    { kind: 'gnarl', tier: 'ember', weapon: 'gnarl_cleaver', station: 'eat' },
    { kind: 'gnarl', tier: 'dusk', weapon: 'boulder_maul', station: 'guard' },
    { kind: 'shellback', station: 'guard' },
    { kind: 'gnarl', tier: 'ember', weapon: 'horn_bow', station: 'tower' },
  ], bombs: 2, barrels: 1 },
  { name: 'Thornwall Camp', x: 335, z: -45, seed: 31, roster: [
    { kind: 'gnarl', tier: 'moss', weapon: 'gnarl_cleaver', station: 'sleep' },
    { kind: 'gnarl', tier: 'moss', weapon: 'thorn_spear', station: 'patrol' },
    { kind: 'gnarl', tier: 'ember', weapon: 'horn_bow', station: 'tower' },
    { kind: 'gnarl', tier: 'moss', station: 'eat' },
  ], bombs: 3 },
  { name: 'Redrock Hold', x: 1090, z: 650, seed: 47, roster: [
    { kind: 'gnarl', tier: 'dusk', weapon: 'boulder_maul', station: 'eat' },
    { kind: 'gnarl', tier: 'bone', weapon: 'ember_saber', station: 'guard' },
    { kind: 'gnarl', tier: 'dusk', weapon: 'horn_bow', station: 'tower' },
    { kind: 'shellback', variant: 'amber', station: 'patrol' },
    { kind: 'gnarl', tier: 'dusk', weapon: 'thorn_spear', station: 'sleep' },
  ], bombs: 2, barrels: 2 },
  { name: 'Mirefen Camp', x: -420, z: -300, seed: 53, roster: [
    { kind: 'gnarl', tier: 'ember', weapon: 'thorn_spear', station: 'patrol' },
    { kind: 'gnarl', tier: 'moss', weapon: 'spiked_bough', station: 'sleep' },
    { kind: 'gnarl', tier: 'ember', weapon: 'ash_bow', station: 'tower' },
  ], bombs: 2 },
  { name: 'Cinder Hollow', x: 620, z: 480, seed: 61, roster: [
    { kind: 'gnarl', tier: 'dusk', weapon: 'gnarl_cleaver', station: 'eat' },
    { kind: 'gnarl', tier: 'ember', weapon: 'spiked_bough', station: 'eat' },
    { kind: 'shellback', station: 'guard' },
    { kind: 'gnarl', tier: 'dusk', weapon: 'horn_bow', station: 'tower' },
  ], bombs: 2, barrels: 1 },
];

export async function init(ctx) {
  const { scene, world, events, engine } = ctx;
  const shotMode = ctx.params?.has?.('shot');
  const sys = {
    time: 0, enemyTime: 1, camps: [], noiseBurst: 0, playerHidden: false,
    hitStopT: 0, slowT: 0, slowScale: 1, lockTarget: null,
  };
  sys.fx = createVfx(ctx);
  sys.trail = new Trail(20, 0x8fd8ff);
  scene.add(sys.trail.mesh);

  // ---------------------------------------------------------------- shared helpers
  const colliders = [];
  const grid = new Map(); const CELL = 16;
  const gkey = (gx, gz) => gx * 73856093 ^ gz * 19349663;
  function addCollider(c) {
    colliders.push(c);
    const r = c.r || Math.hypot(c.hx || 0, c.hz || 0);
    for (let gz = Math.floor((c.z - r) / CELL); gz <= Math.floor((c.z + r) / CELL); gz++)
      for (let gx = Math.floor((c.x - r) / CELL); gx <= Math.floor((c.x + r) / CELL); gx++) {
        const k = gkey(gx, gz); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(c);
      }
  }
  const qOut = [];
  let stamp = 0;
  sys.queryColliders = (x, z, r, out = qOut) => {
    out.length = 0; stamp++;
    for (let gz = Math.floor((z - r) / CELL); gz <= Math.floor((z + r) / CELL); gz++)
      for (let gx = Math.floor((x - r) / CELL); gx <= Math.floor((x + r) / CELL); gx++) {
        const a = grid.get(gkey(gx, gz)); if (!a) continue;
        for (const c of a) {
          if (c._s === stamp) continue; c._s = stamp;
          const rr = (c.r || Math.hypot(c.hx, c.hz)) + r;
          if ((c.x - x) ** 2 + (c.z - z) ** 2 <= rr * rr) out.push(c);
        }
      }
    return out;
  };
  const pushTmp = [];
  // push a point (feet) out of camp props; returns true when moved
  sys.pushOut = (p, rad) => {
    const cs = sys.queryColliders(p.x, p.z, rad + 0.5, pushTmp);
    let moved = false;
    for (const c of cs) {
      if (c.y !== undefined && c.hy !== undefined && p.y > c.y + c.hy - 0.05) continue;   // standing on top
      if (c.type === 'cylinder' || c.type === 'sphere') {
        const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), m = c.r + rad;
        if (d < m && d > 1e-4) { p.x = c.x + dx / d * m; p.z = c.z + dz / d * m; moved = true; }
      } else {
        const cs_ = Math.cos(c.rotY || 0), sn = Math.sin(c.rotY || 0);
        const dx = p.x - c.x, dz = p.z - c.z;
        // local frame: rotY rotates +Z toward +X (yaw convention)
        let lx = dx * cs_ - dz * sn, lz = dx * sn + dz * cs_;
        const ex = c.hx + rad, ez = c.hz + rad;
        if (Math.abs(lx) < ex && Math.abs(lz) < ez) {
          if (ex - Math.abs(lx) < ez - Math.abs(lz)) lx = Math.sign(lx || 1) * ex; else lz = Math.sign(lz || 1) * ez;
          p.x = c.x + lx * cs_ + lz * sn; p.z = c.z - lx * sn + lz * cs_;
          moved = true;
        }
      }
    }
    return moved;
  };
  sys.waterHeight = (x, z) => {
    const w = ctx.systems.water;
    if (w?.getWaterHeight) { const h = w.getWaterHeight(x, z); return h === undefined ? null : h; }
    return world.getWaterSurface ? world.getWaterSurface(x, z) : null;
  };
  sys.hitStop = (t) => { sys.hitStopT = Math.max(sys.hitStopT, t); };
  sys.slowmo = (t, scale = 0.35) => { sys.slowT = Math.max(sys.slowT, t); sys.slowScale = Math.min(sys.slowScale === 1 ? scale : sys.slowScale, scale); };
  sys.shake = (a, at) => {
    const pl = ctx.systems.player;
    if (!pl?.camera?.shake) return;
    const d = at ? at.distanceTo?.(pl.position) ?? 0 : 0;
    pl.camera.shake(a * Math.max(0, 1 - d / 30));
  };
  sys.noise = (r) => { sys.noiseBurst = Math.max(sys.noiseBurst, r); };

  sys.items = createItems(ctx, sys);
  sys.projectiles = createProjectiles(ctx, sys);
  sys.enemies = createEnemies(ctx, sys);
  sys.hero = createHero(ctx, sys);
  sys.damagePlayer = (a, o) => sys.hero.damagePlayer(a, o);

  // sleeping 'Z's
  const zTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    g.font = 'italic 900 52px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 6; g.strokeStyle = 'rgba(30,30,50,.8)'; g.strokeText('z', 32, 34); g.fillStyle = '#eef4ff'; g.fillText('z', 32, 34);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const zs = [];
  for (let i = 0; i < 12; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: zTex, transparent: true, depthWrite: false })); s.visible = false; scene.add(s); zs.push({ s, t: 0 }); }
  let zi = 0;
  sys.spawnZ = (e) => {
    const z = zs[zi++ % zs.length];
    e.c.headTop.getWorldPosition(z.s.position);
    z.s.position.y += 0.1; z.t = 0; z.s.visible = true; z.x0 = z.s.position.x; z.y0 = z.s.position.y;
  };
  function updateZ(dt) {
    for (const z of zs) {
      if (!z.s.visible) continue;
      z.t += dt;
      if (z.t > 2.4) { z.s.visible = false; continue; }
      z.s.position.y = z.y0 + z.t * 0.35; z.s.position.x = z.x0 + Math.sin(z.t * 3) * 0.12;
      const s = 0.16 + z.t * 0.12; z.s.scale.set(s, s, 1);
      z.s.material.opacity = Math.min(1, z.t * 3) * (1 - z.t / 2.4);
    }
  }

  // ---------------------------------------------------------------- camps
  function refineSite(x, z) {
    let best = null, bs = 1e9;
    for (let r = 0; r <= 40; r += 8) {
      const n = r === 0 ? 1 : Math.round(r * 0.8);
      for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2, qx = x + Math.cos(a) * r, qz = z + Math.sin(a) * r;
        let mn = 1e9, mx = -1e9, wet = false;
        for (let k = 0; k < 10; k++) for (const rr of [6, 12, 15]) {
          const sx = qx + Math.cos(k * 0.628) * rr, sz = qz + Math.sin(k * 0.628) * rr, h = world.getHeight(sx, sz);
          mn = Math.min(mn, h); mx = Math.max(mx, h);
          if ((world.getRiverMask?.(sx, sz) || 0) > 0.02 || h < 2) wet = true;
        }
        if (wet) continue;
        const s = (mx - mn) + r * 0.02;
        if (s < bs) { bs = s; best = { x: qx, z: qz }; }
      }
    }
    return best;
  }
  const campClearings = [];
  function spawnCamp(x, z, o = {}) {
    const site = { x, z, seed: o.seed ?? Math.floor(Math.random() * 1e6), r: o.r ?? 13, entrance: o.entrance, tents: o.tents, tower: o.tower, walls: o.walls };
    const camp = buildCamp(ctx, site, { glowTex: sys.fx.glowTex });
    camp.id = sys.camps.length; camp.name = o.name || 'Camp'; camp.roster = o.roster || []; camp.populated = false; camp.cleared = false; camp.alerted = false;
    camp.bombs = o.bombs ?? 2; camp.barrels = o.barrels ?? 0;
    scene.add(camp.group);
    for (const c of camp.colliders) addCollider(c);
    campClearings.push({ x: camp.x, z: camp.z, r: camp.r + 1.5 });
    sys.camps.push(camp);
    return camp;
  }
  function populate(camp) {
    if (camp.populated) return;
    camp.populated = true;
    const S = camp.stations;
    const used = { eat: 0, sleep: 0, guard: 0, patrol: 0 };
    for (const r of camp.roster) {
      let st = null, state = 'idle', y = null, yaw = 0;
      const pick = (arr, k) => { const p = arr[used[k]++ % Math.max(1, arr.length)]; return p; };
      if (r.station === 'eat' && S.eat.length) { const p = pick(S.eat, 'eat'); st = { ...p, type: 'sit' }; state = 'sit'; yaw = p.yaw; }
      else if (r.station === 'sleep' && S.sleep.length) { const p = pick(S.sleep, 'sleep'); st = { ...p, type: 'sleep' }; state = 'sleep'; yaw = p.yaw; }
      else if (r.station === 'tower' && S.tower) { st = { ...S.tower, type: 'tower' }; state = 'tower'; y = S.tower.y; yaw = S.tower.yaw; }
      else if (r.station === 'guard' && S.guard.length) { const p = pick(S.guard, 'guard'); st = { ...p, type: 'guard' }; state = 'guard'; yaw = p.yaw; }
      else { const p = S.patrol[used.patrol++ % S.patrol.length]; st = { ...p, type: 'patrol' }; state = 'patrol'; }
      const e = sys.enemies.spawn(r.kind, st.x, st.z, { tier: r.tier, variant: r.variant, weapon: r.weapon, camp, station: st, state, y, yaw });
      if (state === 'sit') {
        e.pos.x = st.x; e.pos.z = st.z;
        if (e.kind === 'gnarl') {
          // weapon leant behind the bench, a haunch in hand
          const bx = st.x - Math.sin(st.yaw) * 1.1 + Math.cos(st.yaw) * 0.5, bz = st.z - Math.cos(st.yaw) * 1.1 - Math.sin(st.yaw) * 0.5;
          sys.enemies.stash(e, new THREE.Vector3(bx, 0, bz));
          sys.enemies.giveFood(e);
        }
      }
    }
    for (let i = 0; i < camp.bombs; i++) { const s = camp.blastSpots[i % camp.blastSpots.length]; sys.items.spawnBomb(s.x + (i * 0.7) % 1.4, s.z + (i * 0.45) % 1, { camp }); }
    for (let i = 0; i < camp.barrels; i++) { const s = camp.blastSpots[(i + 1) % camp.blastSpots.length]; sys.items.spawnBarrel(s.x + 1.2, s.z - 0.8); }
  }
  for (const T of CAMP_TARGETS) {
    const s = refineSite(T.x, T.z);
    if (!s) continue;
    try { spawnCamp(s.x, s.z, T); } catch (e) { console.error('[combat] camp failed', T.name, e); }
  }

  // camp ground counts as trampled path -> vegetation leaves it bare (see header note)
  if (world.getPathMask && !world.__campPatched) {
    const orig = world.getPathMask;
    world.getPathMask = (x, z) => {
      let m = orig(x, z);
      for (let i = 0; i < campClearings.length; i++) {
        const c = campClearings[i];
        const d2 = (x - c.x) ** 2 + (z - c.z) ** 2;
        if (d2 < c.r * c.r) { const k = 1 - Math.sqrt(d2) / c.r; m = Math.max(m, Math.min(1, k * 2.2)); }
      }
      return m;
    };
    world.__campPatched = true;
    const veg = ctx.systems.vegetation;
    const fp = ctx.focus || ctx.systems.player?.position;
    try { if (veg?.field?.rebuild && fp) veg.field.rebuild(fp.x, fp.z); } catch (e) { /* vegetation optional */ }
  }

  // Stonewarden: dormant guardian at the nearest ruin to the start
  {
    const ruins = (ctx.systems.terrain?.ruinSites || []).filter(r => r.name !== 'fragment');
    const near = ruins.slice().sort((a, b) => Math.hypot(a.x - 150, a.z - 250) - Math.hypot(b.x - 150, b.z - 250))[0];
    if (near) {
      const a = 0.7, x = near.x + Math.cos(a) * (near.r * 0.4 + 6), z = near.z + Math.sin(a) * (near.r * 0.4 + 6);
      sys.warden = sys.enemies.spawn('stonewarden', x, z, { state: 'dormant', yaw: Math.atan2(150 - x, 250 - z) });
    }
    // wisps drift around the other ruins
    const els = ['ember', 'frost', 'storm'];
    ruins.slice(1, 4).forEach((r, i) => {
      for (let k = 0; k < 2; k++) sys.enemies.spawn('wisp', r.x + Math.cos(k * 3) * (r.r * 0.5 + 4), r.z + Math.sin(k * 3) * (r.r * 0.5 + 4), { element: els[(i + k) % 3], state: 'idle' });
    });
  }

  // ---------------------------------------------------------------- chests & clears
  sys.onEnemyKilled = (e) => {
    const camp = e.camp; if (!camp || camp.cleared) return;
    if (!sys.enemies.list.some(o => o.camp === camp && !o.dead)) {
      camp.cleared = true;
      events.emit('campCleared', { id: camp.id, name: camp.name, position: new THREE.Vector3(camp.chest.x, camp.y, camp.chest.z) });
    }
  };
  sys.openChest = (camp) => {
    const ch = camp.chest; if (ch.opened) return;
    if (!camp.cleared) { events.emit('chestLocked', { id: camp.id }); return; }
    ch.opened = true; ch.openT = 0;
    const p = new THREE.Vector3(ch.x, camp.y + 0.8, ch.z);
    const pool = ['wayfarer_blade', 'thorn_spear', 'boulder_maul', 'ember_saber', 'shell_shield', 'horn_bow'];
    const w = makeWeapon(pool[(camp.id * 3 + 1) % pool.length]);
    setTimeout(() => {
      sys.items.dropWeapon(w, p, new THREE.Vector3(0, 4, 0));
      sys.items.dropMaterial('arrow_bundle', p, new THREE.Vector3(0.8, 3.5, 0.4));
      sys.fx.sparks(p, null, 20, [1, 0.9, 0.5], 1.2);
    }, 450);
    events.emit('chestOpened', { id: camp.id, weapon: w.def.name, position: p });
  };

  // equip requests from the UI
  events.on('equipWeapon', (o) => { sys.hero.equip(o?.uid ?? o?.id ?? o); });

  // ---------------------------------------------------------------- per frame
  function update(dt) {
    // unscaled frame time (the engine scales dt by timeScale, which hit-stop / slow-mo drive)
    const realDt = Math.min(0.1, engine.timeScale > 0 ? dt / engine.timeScale : 1 / 60);
    // time scale: hit-stop beats slow-mo beats normal
    if (sys.freezeTime) engine.timeScale = 0.0001;
    else if (sys.hitStopT > 0) { sys.hitStopT -= realDt; engine.timeScale = 0.04; }
    else if (sys.slowT > 0) { sys.slowT -= realDt; engine.timeScale = sys.slowScale; }
    else if (engine.timeScale !== 1 && (engine.timeScale === 0.04 || engine.timeScale === sys.slowScale)) { engine.timeScale = 1; sys.slowScale = 1; }
    sys.time += dt;
    sys.noiseBurst = Math.max(0, sys.noiseBurst - realDt * 20);
    const pl = ctx.systems.player;
    const edt = dt * sys.enemyTime;

    // camps: stream population, LOD visibility, fire FX
    const pp = pl?.position;
    let nearFire = null, nfd = 70;
    for (const camp of sys.camps) {
      const d = pp ? Math.hypot(pp.x - camp.x, pp.z - camp.z) : 0;
      camp.group.visible = d < 700;
      camp.outline.visible = d < 140;
      if (d < 170 && !camp.populated) populate(camp);
      if (d < 140) {
        const s = camp.stations.fire;
        sys.fx.fire(s.x, s.y, s.z, dt, 1);
        for (const t of camp.stations.torches || []) sys.fx.torch(t.x, t.y, t.z, dt);
        const fl = 0.85 + Math.sin(sys.time * 13) * 0.07 + Math.sin(sys.time * 31) * 0.05;
        camp.glow.material.opacity = 0.35 * fl; camp.core.material.opacity = 0.8 * fl;
        camp.core.scale.set(1.6 * fl, 2.3 * fl, 1);
        if (d < nfd) { nfd = d; nearFire = camp; camp.flicker = fl; }
      }
      const ch = camp.chest;
      if (ch.opened && ch.openT < 1) { ch.openT = Math.min(1, ch.openT + dt * 2.5); ch.lid.rotation.x = -1.9 * (1 - Math.pow(1 - ch.openT, 3)); }
      if (camp.cleared && !ch.opened) ch.mat.uniforms.uFlash.value.setRGB(0.25 + 0.15 * Math.sin(sys.time * 4), 0.18, 0.05);
      else ch.mat.uniforms.uFlash.value.setRGB(0, 0, 0);
    }

    if (fireLight.value) {
      if (nearFire) { const f = nearFire.stations.fire; fireLight.value.set(f.x, f.y + 0.8, f.z, 1.6 * nearFire.flicker); }
      else fireLight.value.w = 0;
    }
    sys.hero.update(dt, realDt);
    sys.enemies.update(edt, realDt);
    sys.items.update(dt);
    sys.projectiles.update(edt);
    sys.fx.update(dt);
    updateZ(dt);
    // keep the hero out of camp props (the player system only knows terrain/physics colliders)
    if (pl && (pl.state === 'ground' || pl.state === 'air') && pl.position) {
      if (sys.pushOut(pl.position, pl.radius || 0.32)) { pl.group?.position.copy(pl.position); }
    }
  }

  // ---------------------------------------------------------------- screenshot setups
  function setupShot(name) {
    const pl = ctx.systems.player;
    const camp = sys.camps[0];
    if (!camp || !pl) return;
    populate(camp);
    // pre-warm campfire smoke so the column is already standing
    for (let i = 0; i < 140; i++) { const s = camp.stations.fire; sys.fx.fire(s.x, s.y, s.z, 0.05, 1); for (const t of camp.stations.torches || []) sys.fx.torch(t.x, t.y, t.z, 0.05); sys.fx.update(0.05); }
    const ent = camp.entrance;
    const ex = Math.sin(ent), ez = Math.cos(ent);
    if (name === 'combat' && ctx.params.get('cv') === 'boss' && sys.warden) {
      // dev variant: the Stonewarden wakes in its ruin
      const w = sys.warden;
      const yaw0 = w.yaw;
      const hx = w.pos.x + Math.sin(yaw0) * 9, hz = w.pos.z + Math.cos(yaw0) * 9;
      pl.debugPlace({ x: hx, z: hz, yaw: Math.atan2(w.pos.x - hx, w.pos.z - hz), state: 'combat' });
      const P = pl.position;
      w.yaw = Math.atan2(P.x - w.pos.x, P.z - w.pos.z); w.c.root.rotation.y = w.yaw;
      sys.enemies.alert(w); sys.freezeAI = true; w.state = 'combat'; w.anim.setBase('combat'); w.anim.play('slam', 0.5); w.exposed = 0;
      sys.hero.setDrawn(true);
      const yaw = Math.atan2(w.pos.x - P.x, w.pos.z - P.z);
      const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), right = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
      const cpos = new THREE.Vector3(P.x - fwd.x * 4 + right.x * 2.5, 0, P.z - fwd.z * 4 + right.z * 2.5);
      cpos.y = Math.max(world.getHeight(cpos.x, cpos.z), P.y) + 1.6;
      ctx.cameraOverride = { pos: cpos, target: new THREE.Vector3(w.pos.x, w.pos.y + 3.2, w.pos.z) };
      ctx.focus.copy(cpos); ctx.camera.position.copy(cpos); ctx.camera.lookAt(ctx.cameraOverride.target);
      return;
    }
    if (name === 'combat') {
      // the hero fights inside the camp: a gnarl takes a hit, another winds up, a shellback looms
      const hx = camp.x + ex * 4.0, hz = camp.z + ez * 4.0;
      const yaw = Math.atan2(camp.x - hx, camp.z - hz) - 0.35;
      pl.debugPlace({ x: hx, z: hz, yaw, state: 'combat' });
      const P = pl.position;
      const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), right = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
      const live = sys.enemies.list.filter(e => e.camp === camp);
      sys.freezeAI = true;
      for (const e of live) { e.alerted = true; e.awareness = 1.2; e.state = 'combat'; if (e.station?.type !== 'tower') e.yOverride = null; e.anim?.setBase('combat'); }
      const place = (e, f, r, face = true) => {
        e.pos.set(P.x + fwd.x * f + right.x * r, 0, P.z + fwd.z * f + right.z * r); e.pos.y = world.getHeight(e.pos.x, e.pos.z);
        if (face) e.yaw = Math.atan2(P.x - e.pos.x, P.z - e.pos.z);
        e.c.root.position.copy(e.pos); e.c.root.rotation.y = e.yaw;
      };
      const g = live.filter(e => e.kind === 'gnarl' && e.station?.type !== 'tower');
      // the eaters grabbed their weapons
      for (const it of sys.items.list.slice()) if (it.type === 'weapon' && Math.hypot(it.pos.x - camp.x, it.pos.z - camp.z) < camp.r) sys.items.take(it);
      const kit = ['spiked_bough', 'gnarl_cleaver', 'gnarl_pike', 'spiked_bough'];
      g.forEach((e, k) => { if (!e.weapon) sys.enemies.giveWeapon(e, makeWeapon(kit[k % kit.length])); if (e.food) { e.food.parent?.remove(e.food); e.food = null; } });
      if (g[0]) { place(g[0], 1.75, 0.35); g[0].hp = g[0].maxHp = 40; }
      if (g[1]) place(g[1], 2.9, -1.9);
      if (g[2]) place(g[2], 5.6, -3.6);
      if (g[3]) { place(g[3], 6.5, 2.6); g[3].anim.play('taunt', 0.8); }
      const sb = sys.enemies.spawn('shellback', P.x + fwd.x * 8 + right.x * 0.6, P.z + fwd.z * 8 + right.z * 0.6, { camp, state: 'combat' });
      sb.alerted = true; sb.yaw = Math.atan2(P.x - sb.pos.x, P.z - sb.pos.z); sb.anim.setBase('combat'); sb.c.root.rotation.y = sb.yaw;
      sys.hero.setDrawn(true);
      sys.hero.setLock(g[0] || null);
      const n = +(ctx.params.get('frames') || 30);
      const cv = ctx.params.get('cv');    // dev variants: bow | guard | boss
      let i = 0;
      engine.add('combat-shot', () => {
        i++;
        if (i === 1 && g[1]) g[1].anim.play('swing', 0.72);
        if (cv === 'bow') { if (i === 1) sys.hero.st.forceAim = true; }
        else if (cv === 'guard') { if (i === 1) { pl.playAction('shield', { hold: true }); } }
        else if (i === Math.max(2, n - 7)) sys.hero.startSwing(0, { speed: 0.8 });
      });
      // freeze-frame one beat after the blade connects (sparks, flash and trail held for the capture)
      let froze = false;
      events.on('hit', () => { if (froze) return; froze = true; let k = 0; engine.add('combat-shot-freeze', () => { if (++k === 2) sys.freezeTime = true; }); });
      const cpos = new THREE.Vector3(P.x - fwd.x * 2.9 + right.x * 3.3, 0, P.z - fwd.z * 2.9 + right.z * 3.3);
      cpos.y = Math.max(world.getHeight(cpos.x, cpos.z), P.y) + 1.9;
      const tgt = new THREE.Vector3(P.x + fwd.x * 3.0 - right.x * 0.6, P.y + 1.2, P.z + fwd.z * 3.0 - right.z * 0.6);
      ctx.cameraOverride = { pos: cpos, target: tgt };
      ctx.camera.fov = 52; ctx.camera.updateProjectionMatrix();
    } else if (name === 'camp') {
      // establishing shot from just outside the entrance; hero crouched in the grass watching
      const hx = camp.x + ex * (camp.r + 1.5), hz = camp.z + ez * (camp.r + 1.5);
      const yaw = Math.atan2(camp.x - hx, camp.z - hz);
      pl.debugPlace({ x: hx, z: hz, yaw, state: 'idle' });
      const P = pl.position;
      const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), right = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
      sys.playerHidden = true;
      const cpos = new THREE.Vector3(P.x - fwd.x * 4.2 + right.x * 1.9, 0, P.z - fwd.z * 4.2 + right.z * 1.9);
      cpos.y = Math.max(world.getHeight(cpos.x, cpos.z), P.y) + 2.5;
      const tgt = new THREE.Vector3(camp.x, camp.y + 2.4, camp.z);
      ctx.cameraOverride = { pos: cpos, target: tgt };
      ctx.camera.fov = 52; ctx.camera.updateProjectionMatrix();
      // one sentry spots the hero: '?' over its head
      const patrol = sys.enemies.list.find(e => e.camp === camp && e.state === 'patrol');
      if (patrol) { patrol.awareness = 0.7; patrol.yaw = Math.atan2(P.x - patrol.pos.x, P.z - patrol.pos.z); }
    }
    ctx.focus.copy(ctx.cameraOverride.pos);
    ctx.camera.position.copy(ctx.cameraOverride.pos); ctx.camera.lookAt(ctx.cameraOverride.target);
    if (ctx.params.get('ct')) ctx.systems.sky?.setTime?.(+ctx.params.get('ct'));   // dev: time-of-day override
  }
  events.on('shot', ({ name }) => { if (name === 'combat' || name === 'camp') { try { setupShot(name); } catch (e) { console.error('[combat] shot setup failed', e); } } });

  const api = {
    sys, camps: sys.camps, weapons: WEAPONS,
    get enemies() { return sys.enemies.list; },
    damagePlayer: (a, o) => sys.hero.damagePlayer(a, o),
    getEnemies: () => sys.enemies.list.filter(e => !e.dead).map(e => ({ id: e.id, kind: e.kind, tier: e.tier, pos: e.pos, hp: e.hp, maxHp: e.maxHp, state: e.state, alerted: e.alerted, camp: e.camp?.id ?? null })),
    spawnEnemy: (kind, x, z, o) => sys.enemies.spawn(kind, x, z, o),
    spawnCamp: (x, z, o = {}) => { const c = spawnCamp(x, z, o); return c; },
    equip: q => sys.hero.equip(q),
    unequip: slot => sys.hero.unequip(slot),
    addWeapon: (id, dur) => sys.hero.addWeapon(makeWeapon(id, dur)),
    getInventoryWeapons: () => sys.hero.getInventoryWeapons(),
    getEquipped: () => sys.hero.getInventoryWeapons().equipped,
    addArrows: n => { sys.hero.inv.arrows += n; },
    addBlastcaps: n => { sys.hero.inv.blastcaps += n; },
    queryColliders: (x, z, r, out) => sys.queryColliders(x, z, r, out || []),
    damageArea(x, y, z, r, amount, o = {}) {
      const p = new THREE.Vector3(x, y, z);
      for (const e of sys.enemies.list) if (!e.dead && e.pos.distanceTo(p) < r + e.c.radius) sys.enemies.hurt(e, amount, { ...o, from: p, point: e.pos.clone() });
      sys.items.impulse(p, r, 5);
    },
    setupShot,
    update,
  };
  window.__combat = api;
  return api;
}
