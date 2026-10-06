// gameplay system — items, foraging, cooking, inventory, temperature, food effects, quests,
// Windstone Spires (map reveal), the Summit Beacon, and save/load.
//
// API (ctx.systems.gameplay):
//   inventory                      data model (see inventory.js): add/remove/count/list(cat)/dishes/shards/cookables()
//   addItem(id, n=1, meta)         add to the pack (other systems: combat loot, sanctum sigils). id 'dish' + meta = dish object
//   removeItem(id, n) / hasItem(id, n) / countItem(id)
//   addShards(n) / spendShards(n) / shards
//   items, effects, categories     catalogues (items.js)
//   getIcon(id | dish | weaponInfo) -> dataURL     painted icon for any item (UI)
//   cook(ids) -> dish (pure recipe evaluation, no side effects) ; cookAt(campfire, ids) runs the full pot animation
//   eat(key, cat='food')           eat a dish (uid) or an edible material (id): heals via player.heal, applies effects
//   campfires                      [{id, pos, lit, startCook...}]  nearestCampfire(pos, r)
//   temperature -> {value °C, state 'freezing'|'cold'|'mild'|'hot'|'scorching'}   buffs (Map effect -> {level,time,max})
//   getAttackMultiplier() / getDefenseMultiplier() / getSpeedMultiplier()   (food effects, for combat)
//   quests: list, current(), objectives() -> [{id,label,x,z,kind}] (map/compass markers)
//   spires [{id,name,x,z,active,reveal}], revealed -> [{id,x,z,r}] (map fog-of-war), beacon {x,z,lit}
//   openInventory(tab) / closeInventory()  fallback inventory screen (ui system may provide its own)
//   save() / load() / hasSave() / deleteSave()   (localStorage 'windborne.save.v1'; F5 quick-save, F9 quick-load)
//   dropLoot(pos, kind)            spill loot (physics crates)      onWeaponAdded(info) (combat hook)
//   debugShot(name)                'cooking' | 'inventory' framing for tools/shot.mjs presets
// Events emitted: itemPickup {id, name, kind, count, source:'forage'|'drop'}, inventoryChanged, shards {shards, delta},
//   cookStart {ingredients}, cook {dish, ingredients}, eat {item, hp, effect}, buff {effect, level, time}, buffEnd,
//   temperature {state, from, value}, questUpdate, questComplete, spireActivated {id,name,position}, mapReveal {id,x,z,r},
//   beaconLit, oreBroken {id, position}, gameSaved, gameLoaded.
// Cross-system notes: campfire clearings and spire plinths extend world.getPathMask (vegetation leaves them bare);
//   spire + beacon colliders are appended to terrain.queryColliders (same collider format) so they are solid/climbable.
import * as THREE from 'three';
import { ITEMS, EFFECTS, CATEGORIES, cook as cookRecipe, setCookSeed, describeDish } from './items.js';
import { makeToon, makeOutline } from './toon.js';
import { Particles, Sparkles } from './fx.js';
import { createFireLights } from './firelight.js';
import { createCampfireKit } from './campfire.js';
import { createInventory } from './inventory.js';
import { createForage } from './forage.js';
import { createLandmarks } from './landmarks.js';
import { createQuests } from './quests.js';
import { createStatus } from './status.js';
import { createHud } from './hud.js';
import { getIcon } from './icons.js';

const SAVE_KEY = 'windborne.save.v1';
const CAMPFIRE_SITES = [
  { id: 'meadow', target: [168, 268], dressing: true },
  { id: 'ruins', target: [92, -40] },
  { id: 'wildwood', target: [-640, 700], dressing: true },
  { id: 'mirrormere', target: [-760, 300] },
  { id: 'redrock', target: [930, 640], dressing: true },
  { id: 'highmoor', target: [-330, -720] },
  { id: 'summit-trail', target: [-250, -1080] },
  { id: 'eastriver', target: [880, 130] },
  { id: 'westshore', target: [-1420, 520] },
];

export async function init(ctx) {
  const { scene, world, events, input } = ctx;
  const shotMode = !!ctx.params?.has?.('shot');

  // ---------------------------------------------------------------- shared render resources
  const res = {
    mat: makeToon(ctx, { rim: 1 }),
    matSway: makeToon(ctx, { rim: 0.8, sway: 0.9 }),
    outline: makeOutline(ctx, { width: 0.0022 }),
    makeToon: o => makeToon(ctx, o),
    matCook: (() => { const m = makeToon(ctx, { rim: 1.8, shadowAmt: 0.3 }); m.uniforms.uTint.value.setRGB(1.2, 1.1, 1.0); m.uniforms.uGlow.value.setRGB(0.32, 0.17, 0.08); return m; })(),
    add: new Particles(ctx, { max: 900, additive: true }),
    alpha: new Particles(ctx, { max: 700, additive: false }),
    sparkles: new Sparkles(ctx, 256),
    lights: createFireLights(ctx),
  };
  scene.add(res.add.mesh, res.alpha.mesh, res.sparkles.mesh);

  const inv = createInventory(ctx);
  const hud = createHud(ctx);
  const landmarks = createLandmarks(ctx, res);
  const forage = createForage(ctx, res, inv, hud);
  const { Campfire } = createCampfireKit(ctx, res);

  // ---------------------------------------------------------------- campfires (+ clearings in the grass)
  const clearings = [];
  const campfires = [];
  function flatNear(x, z, maxR = 40) {
    const n = { x: 0, y: 1, z: 0 };
    for (let r = 0; r <= maxR; r += 2.5) {
      const na = r === 0 ? 1 : Math.max(8, Math.round(r * 1.1));
      for (let i = 0; i < na; i++) {
        const a = i / na * Math.PI * 2, qx = x + Math.cos(a) * r, qz = z + Math.sin(a) * r;
        const h = world.getHeight(qx, qz);
        if (h < 1.5 || (world.getWaterSurface?.(qx, qz) ?? -1e9) > h - 0.3) continue;
        let ok = true;
        for (let k = 0; k < 6 && ok; k++) { const b = k / 6 * 6.28; world.getNormal(qx + Math.cos(b) * 2.5, qz + Math.sin(b) * 2.5, n); if (n.y < 0.95) ok = false; }
        if (ok) return { x: qx, z: qz };
      }
    }
    return { x, z };
  }
  function addCampfire(def) {
    const f = new Campfire(def);
    campfires.push(f);
    clearings.push({ x: f.pos.x, z: f.pos.z, r: def.clear ?? (def.dressing ? 4.6 : 3.4) });
    return f;
  }
  for (const s of CAMPFIRE_SITES) {
    const p = flatNear(s.target[0], s.target[1]);
    addCampfire({ id: s.id, x: p.x, z: p.z, yaw: (s.target[0] * 0.013) % 6.28, dressing: s.dressing });
  }
  if (world.getPathMask && !world.__gameplayFirePatched) {
    const orig = world.getPathMask;
    world.getPathMask = (x, z) => {
      let m = orig(x, z);
      for (let i = 0; i < clearings.length; i++) {
        const c = clearings[i];
        const d2 = (x - c.x) ** 2 + (z - c.z) ** 2;
        if (d2 < c.r * c.r) { const k = 1 - Math.sqrt(d2) / c.r; m = Math.max(m, Math.min(1, k * 1.6 + 0.12)); }
      }
      return m;
    };
    world.__gameplayFirePatched = true;
  }
  function rebuildVegetation() {
    const veg = ctx.systems.vegetation;
    const fp = ctx.focus || ctx.systems.player?.position;
    try { if (veg?.field?.rebuild && fp) veg.field.rebuild(fp.x, fp.z); } catch (e) { /* vegetation optional */ }
  }
  rebuildVegetation();
  function nearestCampfire(pos, r = 2.6) {
    let best = null, bd = r * r;
    for (const f of campfires) { const d2 = (f.pos.x - pos.x) ** 2 + (f.pos.z - pos.z) ** 2; if (d2 < bd && Math.abs(f.pos.y - pos.y) < 2.5) { bd = d2; best = f; } }
    return best;
  }
  function fireWarmth(pos) {
    let w = 0;
    for (const f of campfires) { if (!f.lit) continue; const d = Math.hypot(f.pos.x - pos.x, f.pos.z - pos.z); if (d < 7) w = Math.max(w, 20 * (1 - d / 7)); }
    const b = landmarks.beacon; if (b.lit) { const d = Math.hypot(b.x - pos.x, b.z - pos.z); if (d < 18) w = Math.max(w, 28 * (1 - d / 18)); }
    return w;
  }

  const status = createStatus(ctx, { fireWarmth });
  const quests = createQuests(ctx, { inv, landmarks, hud });

  // ---------------------------------------------------------------- toasts / feedback
  events.on('itemPickup', e => {
    if (!e) return;
    const id = e.id || e.item;
    const icon = e.weapon ? getIcon(e.weapon) : ITEMS[id] ? getIcon(id) : getIcon('flint');
    hud.toast(id, e.name || ITEMS[id]?.name || id, e.count || 1, icon);
  });
  events.on('spireActivated', e => { hud.banner(e.name, 'The wind carries the land to your chart', 'main'); scheduleSave(); });
  events.on('beaconLit', () => { hud.banner('The Summit Beacon Burns', 'Its light reaches every corner of the island', 'main'); scheduleSave(); });
  events.on('questComplete', () => scheduleSave());
  events.on('temperature', e => {
    if (e.state === 'cold' && e.from === 'mild') hud.banner('A Biting Chill', 'Warm food or a fire will keep the cold away', 'side', true);
    if (e.state === 'hot' && e.from === 'mild') hud.banner('Sweltering Heat', 'Cooling food will help you endure it', 'side', true);
  });

  // ---------------------------------------------------------------- cooking + eating
  let cooking = null;
  function openCook(fire) {
    const pl = ctx.systems.player;
    pl?.setInputEnabled?.(false);
    hud.prompt(null);
    hud.openCook({
      items: inv.cookables(),
      onCook: ids => cookAt(fire, ids),
      onClose: () => pl?.setInputEnabled?.(true),
    });
  }
  function cookAt(fire, ids, opts = {}) {
    for (const id of ids) inv.remove(id, 1);
    const dish = cookRecipe(ids);
    const pl = ctx.systems.player;
    const from = pl ? pl.position.clone().add(new THREE.Vector3(Math.sin(pl.yaw) * 0.35, 0.9, Math.cos(pl.yaw) * 0.35)) : null;
    pl?.playAction?.('cook', { hold: true });
    hud.tray(ids, true, 'Cooking');
    events.emit('cookStart', { ingredients: ids.slice(), campfire: fire.id });
    cooking = { fire, ids, dish };
    fire.startCook(ids, dish, {
      from,
      onDone: d => {
        inv.addDish(d);
        hud.tray(ids, false);
        hud.dishCard(d);
        pl?.releaseAction?.();
        pl?.setInputEnabled?.(true);
        events.emit('cook', { dish: d, ingredients: ids.slice() });
        cooking = null;
        scheduleSave();
      },
      ...opts,
    });
    return dish;
  }
  function applyFood(f) {
    const pl = ctx.systems.player;
    if (f.hp >= 999) { if (pl) pl.heal(pl.maxHealth); }
    else if (f.hp > 0) pl?.heal?.(f.hp);
    if (f.effect === 'vigor') pl?.addStamina?.(f.stamina || 20);
    else if (f.effect && f.effect !== 'hearty' && f.duration) status.addBuff(f.effect, f.level || 1, f.duration);
    pl?.playAction?.('eat');
    events.emit('eat', { item: f.name, hp: f.hp, effect: f.effect, level: f.level, duration: f.duration });
  }
  function eat(key, cat = 'food') {
    if (cat === 'food') { const d = inv.removeDish(key); if (!d) return false; applyFood(d); return true; }
    const it = ITEMS[key]; if (!it?.edible || !inv.remove(key, 1)) return false;
    // raw ingredients: plain hearts, a short weak effect
    applyFood({ name: it.name, hp: it.hp || 0, effect: it.effect, level: 1, duration: EFFECTS[it.effect]?.timed ? 30 : 0, stamina: 10 });
    return true;
  }
  function useFromInventory(action, cat, key) {
    if (action === 'eat') eat(key, cat);
    else if (action === 'equip') ctx.systems.combat?.equip?.(key);
  }

  // ---------------------------------------------------------------- save / load
  let saveT = 0, savePending = false;
  function scheduleSave() { savePending = true; }
  function serialize() {
    const pl = ctx.systems.player;
    const w = ctx.systems.combat?.getInventoryWeapons?.();
    return {
      v: 1, t: Date.now(),
      inv: inv.serialize(), forage: forage.serialize(), quests: quests.serialize(), landmarks: landmarks.serialize(), buffs: status.serialize(),
      player: pl ? { x: pl.position.x, y: pl.position.y, z: pl.position.z, yaw: pl.yaw, health: pl.health } : null,
      time: ctx.systems.sky?.getTime?.(),
      weapons: w ? [...w.weapons, ...w.bows, ...w.shields].map(x => x.id) : null,
    };
  }
  function save() {
    if (shotMode) return false;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(serialize())); events.emit('gameSaved', {}); savePending = false; saveT = 0; return true; }
    catch (e) { console.warn('[gameplay] save failed', e); return false; }
  }
  function hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; } }
  function load() {
    let o;
    try { o = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { o = null; }
    if (!o || o.v !== 1) return false;
    inv.restore(o.inv); forage.restore(o.forage); quests.restore(o.quests); landmarks.restore(o.landmarks); status.restore(o.buffs);
    const pl = ctx.systems.player;
    if (o.player && pl) { pl.teleport?.(o.player.x, o.player.z, o.player.yaw); if (o.player.health) pl.health = o.player.health; }
    if (typeof o.time === 'number') ctx.systems.sky?.setTime?.(o.time);
    if (o.weapons && ctx.systems.combat?.addWeapon) {
      const have = ctx.systems.combat.getInventoryWeapons?.();
      const owned = have ? [...have.weapons, ...have.bows, ...have.shields].map(x => x.id) : [];
      for (const id of o.weapons) { const i = owned.indexOf(id); if (i >= 0) owned.splice(i, 1); else ctx.systems.combat.addWeapon(id); }
    }
    events.emit('gameLoaded', {});
    hud.banner('Journey Resumed', '', 'side', true);
    return true;
  }
  addEventListener('keydown', e => {
    if (shotMode) return;
    if (e.code === 'F5') { e.preventDefault(); if (save()) hud.banner('Journey Saved', '', 'side', true); }
    else if (e.code === 'F9') { e.preventDefault(); load(); }
  });
  addEventListener('beforeunload', () => { if (!shotMode) save(); });

  // ---------------------------------------------------------------- new game / demo inventory
  function starterKit() {
    inv.add('wind-sail'); inv.add('spire-chart');
    inv.add('hearthsalt', 2); inv.add('russetpome', 3); inv.add('hearthcap', 2);
  }
  function demoKit() {
    starterKit();
    const add = { hearthcap: 6, emberbell: 3, frostgill: 2, swiftstool: 4, lanterncap: 3, dewleaf: 9, sunpetal: 5, bravebloom: 2, snowmint: 3, firethorn: 4,
      russetpome: 7, duskberry: 12, goldplum: 2, silverfin: 3, ribboncarp: 1, roast_haunch: 2, speckledegg: 4, highwheat: 3, churnbutter: 1, canesugar: 2, wildhoney: 1,
      flint: 8, amberite: 2, skyglass: 1, gnarl_horn: 3, gnarl_fang: 2, wisp_essence: 1, 'sanctum-sigil': 2 };
    for (const k in add) inv.add(k, add[k]);
    setCookSeed(7);
    for (const r of [['roast_haunch', 'hearthcap', 'emberbell', 'emberbell'], ['silverfin', 'freshmilk'], ['russetpome', 'highwheat', 'canesugar'], ['swiftstool', 'swiftstool', 'dewleaf'], ['gnarl_horn', 'bravebloom', 'bravebloom'], ['speckledegg', 'dewleaf', 'hearthcap'], ['flint', 'dewleaf']]) {
      const d = cookRecipe(r); if (d) inv.addDish(d);
    }
    inv.addShards(1240);
  }
  if (shotMode) demoKit(); else starterKit();
  events.on('ready', () => {
    if (!shotMode && hasSave()) { try { load(); } catch (e) { console.warn('[gameplay] load failed', e); } }
    forage.stream(true);
    rebuildVegetation();
    const q = quests.current();
    if (!shotMode && q.step) setTimeout(() => hud.banner(q.quest.title, q.step.text, 'main'), 1800);
  });

  // ---------------------------------------------------------------- per-frame
  let statusT = 0;
  const night = () => 1 - (ctx.systems.sky?.getDaylight?.() ?? 1);
  function update(dt) {
    const cam = ctx.camera.position;
    const nightAmt = night();
    const wind = ctx.uniforms.uWindDir.value;
    if (!ctx.paused) {
      forage.update(dt);
      for (const f of campfires) f.update(dt, cam, wind, nightAmt);
      landmarks.update(dt);
      status.update(dt);
    }
    res.lights.update(dt, nightAmt);
    res.add.update(dt, wind);
    res.alpha.update(dt, wind);
    hud.update(dt);

    // interaction
    const pl = ctx.systems.player;
    if (pl && !shotMode && !ctx.paused && !hud.modalOpen && !cooking && pl.state !== 'dead') {
      const p = pl.position;
      let action = null;
      const fire = nearestCampfire(p);
      const ground = pl.state === 'ground' || pl.state === 'pose';
      if (fire && fire.hasPot && ground) action = { key: 'E', verb: fire.lit ? 'Cook' : 'Light', name: 'Campfire', run: () => { if (!fire.lit) fire.setLit(true); else openCook(fire); } };
      if (!action && landmarks.nearBeacon(p) && !landmarks.beacon.lit) {
        const ready = quests.current().step?.id === 'beacon' && inv.has('summit-ember');
        action = ready ? { key: 'E', verb: 'Kindle', name: 'Summit Beacon', run: () => { inv.remove('summit-ember'); landmarks.lightBeacon(); } } : { key: '', verb: 'The beacon is cold', name: 'Four sigils are needed', run: null };
      }
      const sp = landmarks.nearestSpireTop(p);
      if (sp) landmarks.activate(sp);
      if (!action) {
        const it = forage.nearest(p);
        const pr = forage.promptFor(it);
        if (pr) action = { key: 'E', verb: pr.verb, name: pr.name, run: () => forage.collect(it, p) };
      }
      hud.prompt(action && { key: action.key || '•', verb: action.verb, name: action.name });
      if (action?.run && (input.justPressed('interact') || (action.verb === 'Cook' && input.justPressed('cook')))) action.run();
      // fallback inventory key when the ui system has no inventory screen of its own
      if (!ctx.systems.ui?.open && input.justPressed('inventory')) openInventory('materials');
    } else if (!cooking) hud.prompt(null);

    statusT -= dt;
    if (statusT <= 0) {
      statusT = 0.25;
      const show = !shotMode || ctx.hud?.style.display !== 'none';
      hud.status(status.temp, status.buffs, show && (status.temp.state !== 'mild' || status.buffs.size > 0));
    }
    if (!shotMode) { saveT += dt; if ((savePending && saveT > 3) || saveT > 120) save(); }
  }

  function openInventory(tab = 'materials', select) {
    if (hud._invOpen) return hud._invOpen;
    const pl = ctx.systems.player;
    pl?.setInputEnabled?.(false);
    const h = hud.openInventory({ inv, tab, select, onUse: useFromInventory });
    const close = h.close;
    h.close = () => { close(); pl?.setInputEnabled?.(true); };
    return h;
  }

  // ---------------------------------------------------------------- shot framing
  function debugShot(name) {
    const pl = ctx.systems.player;
    if (name === 'cooking' && pl) {
      const p = pl.position.clone(), yaw = pl.yaw;
      const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
      const fp = p.clone().addScaledVector(fwd, 1.3);
      // replace any site campfire close by with the hero's own camp
      for (let i = campfires.length - 1; i >= 0; i--) if (campfires[i].pos.distanceTo(fp) < 12) { campfires[i].dispose(); campfires.splice(i, 1); }
      const fire = addCampfire({ id: 'shot', x: fp.x, z: fp.z, yaw: Math.atan2(fwd.x, fwd.z) + Math.PI, dressing: true, clear: 5.2, fireScale: 1.15 });
      rebuildVegetation();
      setCookSeed(3);
      const ids = ['roast_haunch', 'hearthcap', 'russetpome', 'firethorn', 'dewleaf'];
      const dish = cookRecipe(ids);
      fire.startCook(ids, dish, { from: p.clone().add(new THREE.Vector3(0, 0.8, 0)).addScaledVector(fwd, 0.35), duration: 6 });
      // pick the moment with the most ingredients hopping out of the broth
      let bestT = 2.35, bestS = -1;
      for (let t = 1.7; t < 4.4; t += 0.05) {
        fire.poseCook(t);
        let sc = 0; for (const g of fire.cook.ing) { const hgt = g.mesh.position.y - 0.88; sc += hgt > 0.12 ? 1 + Math.min(hgt, 0.4) : 0; }
        if (sc > bestS) { bestS = sc; bestT = t; }
      }
      shotCookT = bestT;
      fire.boil = 1;
      fire.prewarm(6, ctx.camera.position, ctx.uniforms.uWindDir.value, 1);
      fire.poseCook(bestT);
      cooking = { fire, ids, dish, shot: true };
      // camera: across the fire, looking back at the kneeling cook (face lit by the flames)
      const camPos = fp.clone().addScaledVector(fwd, 1.9).addScaledVector(right, -2.55);
      camPos.y = world.getHeight(camPos.x, camPos.z) + 1.6;
      const tgt = fp.clone().addScaledVector(fwd, -0.55).addScaledVector(right, 0.3);
      tgt.y = fire.pos.y + 0.55;
      ctx.cameraOverride = { pos: camPos, target: tgt };
      ctx.camera.position.copy(camPos); ctx.camera.lookAt(tgt);
      ctx.focus.copy(fp);
      hud.tray(ids, true, 'Cooking');
    } else if (name === 'spire') {
      const s = landmarks.spires[0];
      const a = 2.3, d = 46;
      const cx = s.x + Math.cos(a) * d, cz = s.z + Math.sin(a) * d;
      pl?.teleport?.(s.x + Math.cos(a) * 12, s.z + Math.sin(a) * 12, a + Math.PI);
      const pos = new THREE.Vector3(cx, world.getHeight(cx, cz) + 3, cz);
      const tgt = new THREE.Vector3(s.x, s.y + 17, s.z);
      ctx.cameraOverride = { pos, target: tgt }; ctx.camera.position.copy(pos); ctx.camera.lookAt(tgt); ctx.focus.copy(pos);
      forage.stream(true);
    } else if (name === 'forage') {
      // a forest floor patch rich in pickables: search the streamed chunks around the hero for the densest spot
      forage.stream(true);
      const p0 = pl ? pl.position : ctx.focus;
      let best = null, bn = 0;
      const all = [...forage.chunks.values()].flatMap(c => c.items.filter(i => i.kind !== 'fish' && !i.hanging));
      for (const it of all) {
        if ((it.x - p0.x) ** 2 + (it.z - p0.z) ** 2 > 130 * 130) continue;
        let n = 0; for (const o of all) if ((o.x - it.x) ** 2 + (o.z - it.z) ** 2 < 25) n += o.kind === 'tree' ? 2 : 1;
        if (n > bn) { bn = n; best = it; }
      }
      if (best) {
        const cx = best.x + 2.1, cz = best.z + 1.6;
        const pos = new THREE.Vector3(cx, world.getHeight(cx, cz) + 2.0, cz);
        const tgt = new THREE.Vector3(best.x, world.getHeight(best.x, best.z) + 0.2, best.z);
        pl?.teleport?.(best.x - 2, best.z + 3, 2.4);
        ctx.cameraOverride = { pos, target: tgt }; ctx.camera.position.copy(pos); ctx.camera.lookAt(tgt); ctx.focus.copy(pos);
        forage.stream(true);
        rebuildVegetation();
      }
    } else if (name === 'inventory') {
      if (!ctx.systems.ui?.open) {
        const d = inv.dishes.find(x => x.effect === 'warmth') || inv.dishes[0];
        openInventory('food', d?.uid);
      }
    }
  }
  let shotCookT = 2.35;
  // keep the shot's cooking pose frozen (ingredients mid-hop)
  ctx.engine.add('gameplay-shot-freeze', () => {
    if (cooking?.shot && cooking.fire.cook) cooking.fire.cook.t = shotCookT;
  });

  const api = {
    inventory: inv, items: ITEMS, effects: EFFECTS, categories: CATEGORIES,
    addItem: (id, n = 1, meta) => inv.add(id, n, meta),
    removeItem: (id, n = 1) => inv.remove(id, n),
    hasItem: (id, n = 1) => inv.has(id, n),
    countItem: id => inv.count(id),
    addShards: n => inv.addShards(n), spendShards: n => inv.spendShards(n),
    get shards() { return inv.shards; },
    getIcon, cook: cookRecipe, cookAt, eat, describeDish,
    campfires, nearestCampfire,
    get temperature() { return { value: status.temp.value, state: status.temp.state }; },
    get buffs() { return status.buffs; },
    getAttackMultiplier: status.getAttackMultiplier, getDefenseMultiplier: status.getDefenseMultiplier, getSpeedMultiplier: status.getSpeedMultiplier,
    quests,
    get spires() { return landmarks.spires; },
    get revealed() { return landmarks.spires.filter(s => s.active).map(s => ({ id: s.id, x: s.x, z: s.z, r: s.reveal })); },
    get beacon() { return landmarks.beacon; },
    openInventory, closeInventory: () => hud._invOpen?.close(),
    save, load, hasSave, deleteSave: () => { try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ } },
    dropLoot(pos, kind = 'crate') {
      if (!pos) return;
      const pool = ['highwheat', 'hearthsalt', 'canesugar', 'churnbutter', 'freshmilk', 'speckledegg', 'russetpome', 'gamecut', 'wildhoney', 'flint'];
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) forage.spawnDrop(pool[Math.floor(Math.random() * pool.length)], new THREE.Vector3(pos.x, pos.y + 0.4, pos.z));
      if (Math.random() < 0.6) inv.addShards(1 + Math.floor(Math.random() * 10));
    },
    onWeaponAdded() { /* combat owns weapons; nothing to mirror */ },
    debugShot,
    update,
    _res: res, _hud: hud, _forage: forage, _landmarks: landmarks, _status: status,
  };
  return api;
}
