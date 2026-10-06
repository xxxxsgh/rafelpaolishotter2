// World collectibles, streamed in 48 m chunks around the focus:
//   * pickables by biome (mushroom clusters, herbs, flowers, reeds, berry bushes, pepper plants,
//     melons, nests, roots) — instanced per model, twinkling sparkles so they read in the grass
//   * small fruit trees with pickable fruit hanging in the canopy
//   * ore deposits (strike them, blast them, or press interact) that burst into minerals + shards
//   * fish circling in shallow water, caught by hand when you get close
//   * loose drops (crate loot, ore bursts) that bounce and are auto-collected
// Placement is deterministic per chunk; collected keys are remembered (and saved) and respawn
// after a while, so the world restocks.
import * as THREE from 'three';
import { ITEMS } from './items.js';
import { ingredientGeometry, oreGeometry } from './models.js';
import { Kit, P, rng, hash2 } from './geo.js';

const CHUNK = 48, RADIUS = 3;
const RESPAWN_MS = 25 * 60 * 1000;
const TABLE = {
  meadow:     [['dewleaf', 3], ['sunpetal', 2], ['bravebloom', 1.1], ['hearthcap', 0.6], ['duskberry', 1], ['tree:russetpome', 0.55], ['speckledegg', 0.45], ['ore:flint', 0.3], ['windreed', 0.4]],
  meadow_dry: [['firethorn', 2], ['sunpetal', 1], ['emberbell', 1], ['tree:goldplum', 0.45], ['ore:flint', 0.45], ['ore:amberite', 0.25], ['bravebloom', 0.5]],
  forest:     [['hearthcap', 2.4], ['swiftstool', 1.2], ['stoutshelf', 1], ['lanterncap', 1.1], ['duskberry', 1], ['dewleaf', 1], ['speckledegg', 0.3], ['tree:russetpome', 0.25]],
  mesa:       [['frostmelon', 1.5], ['firethorn', 1], ['emberbell', 1], ['ore:amberite', 0.6], ['ore:emberstone', 0.25], ['ore:flint', 0.5]],
  alpine:     [['snowmint', 2], ['frostgill', 1.5], ['heartroot', 0.25], ['ore:skyglass', 0.5], ['ore:flint', 0.5]],
  snow:       [['frostgill', 1], ['snowmint', 1], ['ore:rimeopal', 0.4], ['heartroot', 0.2], ['ore:skyglass', 0.3]],
  shore:      [['windreed', 2], ['ore:hearthsalt', 0.5], ['ore:flint', 0.3]],
};
const ORE_DROPS = {
  flint: [['flint', 2, 4], ['amberite', 0, 1]],
  amberite: [['amberite', 1, 2], ['flint', 1, 2]],
  emberstone: [['emberstone', 1, 1], ['amberite', 0, 2], ['flint', 1, 2]],
  skyglass: [['skyglass', 1, 1], ['flint', 1, 3]],
  rimeopal: [['rimeopal', 1, 1], ['skyglass', 0, 1], ['flint', 1, 2]],
  hearthsalt: [['hearthsalt', 2, 4]],
};
// world-size multiplier per model family: pickables must read above knee-high grass
const WSCALE = { mushroom: 2.1, shelf: 2.0, herb: 2.3, flower: 2.0, reed: 1.6, root: 1.9, pepper: 1.9, melon: 1.5, berries: 1.25, egg: 1.6, fruit: 1.3 };
const FISH_BY_KIND = { river: ['silverfin', 'silverfin', 'mossback'], lake: ['ribboncarp', 'silverfin', 'mossback'], ocean: ['silverfin'] };

function fruitTreeGeometry(seed, fruitId) {
  const k = new Kit(); const R = rng(seed);
  const H = 2.2 + R() * 0.5;
  k.add(P.cyl(0.08, 0.14, H, 7), { pos: [0, H / 2, 0], rot: [0.04, 0, -0.05], color: 0x7a5a3a, color2: 0x5a4028, grad: (x, y) => 0.5 - y / H, jitter: 0.2 });
  for (let i = 0; i < 3; i++) { const a = i * 2.1 + R(); k.add(P.cyl(0.03, 0.06, 0.9, 5), { pos: [Math.cos(a) * 0.3, H * 0.75 + 0.2, Math.sin(a) * 0.3], rot: [Math.sin(a) * 0.8, 0, -Math.cos(a) * 0.8], color: 0x6a4a30 }); }
  const blobs = [[0, H + 0.45, 0, 1.0], [0.6, H + 0.1, 0.2, 0.75], [-0.55, H + 0.15, -0.15, 0.75], [0.1, H + 0.2, -0.6, 0.7], [-0.15, H + 0.05, 0.6, 0.7]];
  const fg = fruitId === 'goldplum' ? [0x5f8a3a, 0x9ac050] : [0x4a8a3a, 0x8ac050];
  for (const [x, y, z, r] of blobs) k.add(P.ico(r, 1), { pos: [x, y, z], scl: [1, 0.82, 1], color: fg[0], color2: fg[1], grad: (lx, ly) => ly / r * 0.8 + 0.45, flat: true, jitter: 0.16, jitterScale: 3 });
  const geo = k.build();
  // fruit hang points on the canopy underside / sides
  const spots = [];
  for (let i = 0; i < 5; i++) {
    const b = blobs[1 + (i % 4)], a = R() * 6.28;
    spots.push(new THREE.Vector3(b[0] + Math.cos(a) * b[3] * 0.8, b[1] - b[3] * 0.45 - 0.08, b[2] + Math.sin(a) * b[3] * 0.8));
  }
  return { geo, spots };
}

export function createForage(ctx, res, inv, ui) {
  const { scene, world, events } = ctx;
  const root = new THREE.Group(); root.name = 'gameplay-forage'; scene.add(root);
  const collected = new Map();      // key -> timestamp
  const chunks = new Map();         // "cx,cz" -> {items}
  const pools = new Map();          // geoKey -> {mesh, list}
  const mat = res.mat, matSway = res.matSway;
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();
  const treeGeos = [fruitTreeGeometry(11, 'russetpome'), fruitTreeGeometry(23, 'goldplum')];
  let dirty = true, lastCX = null, lastCZ = null;
  // grass thins out in a small ring around each pickable so it reads (extends world.getPathMask)
  const GRID = 2, clearGrid = new Map();
  let genning = false;
  const gkey = (gx, gz) => gx * 73856093 ^ gz * 19349663;
  function gridAdd(it, r) { const k = gkey(Math.floor(it.x / GRID), Math.floor(it.z / GRID)); let a = clearGrid.get(k); if (!a) clearGrid.set(k, a = []); a.push({ x: it.x, z: it.z, r, it }); }
  function gridRemoveChunk(c) { for (const it of c.items) { const k = gkey(Math.floor(it.x / GRID), Math.floor(it.z / GRID)); const a = clearGrid.get(k); if (a) { const i = a.findIndex(e => e.it === it); if (i >= 0) a.splice(i, 1); if (!a.length) clearGrid.delete(k); } } }
  if (world.getPathMask && !world.__gameplayForagePatched) {
    const orig = world.getPathMask;
    world.getPathMask = (x, z) => {
      let m = orig(x, z);
      if (genning || !clearGrid.size) return m;
      const gx = Math.floor(x / GRID), gz = Math.floor(z / GRID);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const a = clearGrid.get(gkey(gx + dx, gz + dz)); if (!a) continue;
        for (const e of a) { const d2 = (x - e.x) ** 2 + (z - e.z) ** 2; if (d2 < e.r * e.r) { const t = Math.max(0, Math.min(1, (Math.sqrt(d2) / e.r - 0.4) / 0.6)); m = Math.max(m, 0.78 * (1 - t * t * (3 - 2 * t))); } }
      }
      return m;
    };
    world.__gameplayForagePatched = true;
  }
  const fishList = [];
  const drops = [];

  function pool(key, geoFn, { sway = false, max = 320, shadow = true } = {}) {
    let p = pools.get(key);
    if (p) return p;
    const geo = geoFn();
    const mesh = new THREE.InstancedMesh(geo, sway ? matSway : mat, max);
    mesh.count = 0; mesh.castShadow = shadow; mesh.receiveShadow = true; mesh.frustumCulled = false;
    root.add(mesh);
    p = { mesh, list: [], max };
    pools.set(key, p);
    return p;
  }
  const isWet = (x, z, h) => { const w = ctx.systems.water?.getWaterHeight?.(x, z) ?? world.getWaterSurface?.(x, z); return w !== null && w !== undefined && w > h - 0.05; };

  function genChunk(cx, cz) {
    const R = rng((cx * 73856093) ^ (cz * 19349663) ^ 0x5eed);
    const items = [];
    const tries = 14;
    for (let i = 0; i < tries; i++) {
      const x = (cx + R()) * CHUNK, z = (cz + R()) * CHUNK;
      const r1 = R(), r2 = R(), rot = R() * Math.PI * 2, sc = 0.85 + R() * 0.35;
      const h = world.getHeight(x, z);
      if (Math.abs(x) > 1950 || Math.abs(z) > 1950) continue;
      const biome = world.getBiome(x, z);
      const tbl = TABLE[biome]; if (!tbl) continue;
      const n = world.getNormal(x, z, _n);
      if (n.y < 0.82) continue;
      if (isWet(x, z, h)) continue;
      if ((world.getPathMask?.(x, z) || 0) > 0.35) continue;
      let tot = 0; for (const e of tbl) tot += e[1];
      let pick = r1 * tot, entry = tbl[0][0];
      for (const e of tbl) { pick -= e[1]; if (pick <= 0) { entry = e[0]; break; } }
      const key = `${cx}:${cz}:${i}`;
      if (entry.startsWith('tree:')) {
        if (biome !== 'meadow' && biome !== 'meadow_dry' && biome !== 'forest') continue;
        const fruit = entry.slice(5); const tg = treeGeos[fruit === 'goldplum' ? 1 : 0];
        items.push({ key, kind: 'tree', id: fruit, x, y: h - 0.05, z, rot, scale: 0.95 + r2 * 0.3, tg });
        const cs = Math.cos(rot), sn = Math.sin(rot), s = 0.95 + r2 * 0.3;
        tg.spots.forEach((sp, j) => {
          const fx = x + (sp.x * cs + sp.z * sn) * s, fz = z + (-sp.x * sn + sp.z * cs) * s;
          items.push({ key: key + ':f' + j, kind: 'pick', id: fruit, x: fx, y: h - 0.05 + sp.y * s, z: fz, rot: R() * 6.28, scale: 1.0, hanging: true, groundY: world.getHeight(fx, fz) });
        });
      } else if (entry.startsWith('ore:')) {
        items.push({ key, kind: 'ore', id: entry.slice(4), x, y: h - 0.12, z, rot, scale: 0.8 + r2 * 0.5, hits: 0 });
      } else {
        items.push({ key, kind: 'pick', id: entry, x, y: h - 0.02, z, rot, scale: sc * (WSCALE[ITEMS[entry].shape] || 1) });
        // a few herbs come in little patches
        if (ITEMS[entry].shape === 'herb' || ITEMS[entry].shape === 'flower') {
          const extra = r2 > 0.55 ? 2 : r2 > 0.3 ? 1 : 0;
          for (let j = 0; j < extra; j++) {
            const ex = x + (R() - 0.5) * 2.2, ez = z + (R() - 0.5) * 2.2;
            items.push({ key: key + ':' + j, kind: 'pick', id: entry, x: ex, y: world.getHeight(ex, ez) - 0.02, z: ez, rot: R() * 6.28, scale: sc * (0.8 + R() * 0.3) * (WSCALE[ITEMS[entry].shape] || 1) });
          }
        }
      }
    }
    // fish in shallow water
    const W = ctx.systems.water;
    if (W?.getWaterHeight) for (let i = 0; i < 4; i++) {
      const x = (cx + R()) * CHUNK, z = (cz + R()) * CHUNK;
      const wy = W.getWaterHeight(x, z); if (wy === null || wy === undefined) continue;
      const depth = wy - world.getHeight(x, z);
      if (depth < 0.5 || depth > 4) continue;
      const kind = W.getWaterKind?.(x, z) || 'river';
      const opts = FISH_BY_KIND[kind] || FISH_BY_KIND.river;
      items.push({ key: `${cx}:${cz}:fish${i}`, kind: 'fish', id: opts[Math.floor(R() * opts.length)], x, y: wy - Math.min(0.35, depth * 0.4), z, rot: R() * 6.28, scale: 1, phase: R() * 6.28, r: 0.8 + R() * 1.2 });
    }
    return { cx, cz, items };
  }
  const _n = { x: 0, y: 1, z: 0 };

  function isCollected(key) {
    const t = collected.get(key);
    if (t === undefined) return false;
    if (Date.now() - t > RESPAWN_MS) { collected.delete(key); return false; }
    return true;
  }

  function stream(force = false) {
    const f = ctx.focus;
    const cx = Math.floor(f.x / CHUNK), cz = Math.floor(f.z / CHUNK);
    if (!force && cx === lastCX && cz === lastCZ && !dirty) return;
    if (cx !== lastCX || cz !== lastCZ || force) {
      lastCX = cx; lastCZ = cz;
      const want = new Set();
      for (let dz = -RADIUS; dz <= RADIUS; dz++) for (let dx = -RADIUS; dx <= RADIUS; dx++) {
        const k = (cx + dx) + ',' + (cz + dz); want.add(k);
        if (!chunks.has(k)) {
          genning = true; const c = genChunk(cx + dx, cz + dz); genning = false;
          for (const it of c.items) if (it.kind === 'pick' && !it.hanging) gridAdd(it, 1.4 + 0.3 * it.scale); else if (it.kind === 'ore') gridAdd(it, 1.6 * it.scale);
          chunks.set(k, c);
        }
      }
      for (const [k, c] of chunks) if (!want.has(k)) { gridRemoveChunk(c); chunks.delete(k); }
    }
    rebuild();
  }

  function rebuild() {
    dirty = false;
    for (const p of pools.values()) p.list.length = 0;
    const fishWanted = [];
    for (const c of chunks.values()) for (const it of c.items) {
      if (it.gone || isCollected(it.key)) { it.gone = true; continue; }
      if (it.kind === 'fish') { fishWanted.push(it); continue; }
      let p;
      if (it.kind === 'tree') p = pool('tree:' + it.id, () => it.tg.geo, { max: 64 });
      else if (it.kind === 'ore') p = pool('ore:' + it.id, () => oreGeometry(it.id, it.id.length), { max: 96 });
      else {
        const sh = ITEMS[it.id].shape;
        const sway = ['herb', 'flower', 'reed', 'root'].includes(sh);
        p = pool('w:' + it.id + (it.hanging ? ':h' : ''), () => ingredientGeometry(it.id, it.hanging ? 'item' : 'world'), { sway, shadow: sh !== 'herb' });
      }
      if (p.list.length < p.max) p.list.push(it);
    }
    for (const p of pools.values()) {
      const L = p.list;
      for (let i = 0; i < L.length; i++) {
        const it = L[i];
        _q.setFromEuler(_e.set(0, it.rot, 0));
        _m.compose(_p.set(it.x, it.y, it.z), _q, _s.setScalar(it.scale));
        p.mesh.setMatrixAt(i, _m);
      }
      p.mesh.count = L.length;
      p.mesh.instanceMatrix.needsUpdate = true;
    }
    syncFish(fishWanted);
    refreshSparkles(true);
  }

  // ------------------------------------------------------------------ fish (individual animated meshes)
  function syncFish(wanted) {
    const keep = new Set(wanted.map(w => w.key));
    for (let i = fishList.length - 1; i >= 0; i--) if (!keep.has(fishList[i].it.key)) { root.remove(fishList[i].mesh); fishList.splice(i, 1); }
    const have = new Set(fishList.map(f => f.it.key));
    for (const it of wanted) {
      if (have.has(it.key) || fishList.length >= 24) continue;
      const mesh = new THREE.Mesh(ingredientGeometry(it.id, 'item'), mat);
      mesh.scale.setScalar(1.6);
      root.add(mesh);
      fishList.push({ it, mesh, t: it.phase, flee: 0 });
    }
  }
  function updateFish(dt, pl) {
    for (const f of fishList) {
      const it = f.it;
      f.t += dt * (0.6 + f.flee * 2.5);
      f.flee = Math.max(0, f.flee - dt * 0.4);
      if (pl) { const d2 = (pl.x - it.x) ** 2 + (pl.z - it.z) ** 2; if (d2 < 9 && ctx.systems.player?.state !== 'swim') f.flee = Math.min(1, f.flee + dt * 2); }
      const a = f.t, r = it.r * (1 + f.flee * 0.8);
      f.mesh.position.set(it.x + Math.cos(a) * r, it.y + Math.sin(f.t * 2.1) * 0.05, it.z + Math.sin(a) * r);
      f.mesh.rotation.set(0, -a + Math.sin(f.t * 9) * 0.25, 0);
    }
  }

  // ------------------------------------------------------------------ sparkles
  let sparkT = 0;
  const sparkList = [];
  function refreshSparkles(force) {
    sparkT -= 1;
    if (!force && sparkT > 0) return;
    sparkT = 20;
    sparkList.length = 0;
    const cp = ctx.camera.position;
    for (const p of pools.values()) for (const it of p.list) {
      if (it.kind === 'tree') continue;
      const d2 = (it.x - cp.x) ** 2 + (it.z - cp.z) ** 2;
      if (d2 > 45 * 45) continue;
      sparkList.push({ x: it.x, y: it.y + (it.kind === 'ore' ? 0.9 : 0.1), z: it.z, phase: hash2(it.x, it.z), d2 });
    }
    for (const d of drops) sparkList.push({ x: d.pos.x, y: d.pos.y + 0.05, z: d.pos.z, phase: d.phase, d2: 0 });
    sparkList.sort((a, b) => a.d2 - b.d2);
    res.sparkles.set(sparkList);
  }

  // ------------------------------------------------------------------ interaction
  const _pp = new THREE.Vector3();
  function nearest(pos, maxD = 1.9) {
    let best = null, bd = maxD * maxD;
    const cx = Math.floor(pos.x / CHUNK), cz = Math.floor(pos.z / CHUNK);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const c = chunks.get((cx + dx) + ',' + (cz + dz)); if (!c) continue;
      for (const it of c.items) {
        if (it.gone || it.kind === 'tree') continue;
        let x = it.x, y = it.y, z = it.z;
        if (it.kind === 'fish') { const f = fishList.find(q => q.it === it); if (!f) continue; x = f.mesh.position.x; y = f.mesh.position.y; z = f.mesh.position.z; }
        const reach = it.kind === 'ore' ? 1.4 : it.hanging ? 1.0 : 0;
        const dy = it.hanging ? Math.max(0, (y - pos.y) - 2.4) : (y - pos.y) * 0.5;
        const d2 = (x - pos.x) ** 2 + (z - pos.z) ** 2 + dy * dy - reach * reach * 0.8;
        if (d2 < bd) { bd = d2; best = it; }
      }
    }
    return best;
  }
  function promptFor(it) {
    if (!it) return null;
    const name = ITEMS[it.id]?.name || it.id;
    if (it.kind === 'ore') return { verb: 'Mine', name: ITEMS[it.id] ? `${ITEMS[it.id].name} Deposit` : 'Ore Deposit' };
    if (it.kind === 'fish') return { verb: 'Catch', name };
    return { verb: 'Pick', name };
  }
  function collect(it, pos) {
    if (it.kind === 'ore') { breakOre(it); return; }
    it.gone = true; collected.set(it.key, Date.now());
    const n = it.kind === 'fish' ? 1 : 1 + (ITEMS[it.id].shape === 'berries' ? 2 : 0) + (ITEMS[it.id].shape === 'egg' ? 2 : 0);
    inv.add(it.id, n);
    _pp.set(it.x, it.y + 0.2, it.z);
    if (it.kind === 'fish') { const f = fishList.find(q => q.it === it); if (f) _pp.copy(f.mesh.position); ctx.systems.water?.splash?.(_pp, 0.5); }
    events.emit('itemPickup', { id: it.id, name: ITEMS[it.id].name, kind: 'material', count: n, position: _pp.clone(), source: 'forage' });
    burstAt(_pp, 10);
    ctx.systems.player?.playAction?.('interact');
    dirty = true;
  }
  function burstAt(p, n = 10, col = [1, 0.92, 0.6]) {
    for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, s = 0.5 + Math.random(); res.add.spawn({ x: p.x, y: p.y, z: p.z, vx: Math.cos(a) * s, vy: 0.8 + Math.random() * 1.4, vz: Math.sin(a) * s, life: 0.6 + Math.random() * 0.4, size: 0.12, size1: 0.02, r: col[0], g: col[1], b: col[2], a: 1, cell: 2, drag: 3, grav: 1.5, spin: 4 }); }
  }
  function breakOre(it) {
    it.gone = true; collected.set(it.key, Date.now());
    const R = rng(Math.floor(hash2(it.x, it.z) * 1e6) + collected.size);
    const pos = new THREE.Vector3(it.x, it.y + 0.6, it.z);
    for (const [id, lo, hi] of ORE_DROPS[it.id] || ORE_DROPS.flint) {
      const n = lo + Math.floor(R() * (hi - lo + 1));
      for (let i = 0; i < n; i++) spawnDrop(id, pos, R);
    }
    inv.addShards?.(3 + Math.floor(R() * 6));
    for (let i = 0; i < 18; i++) { const a = R() * 6.28, s = 1 + R() * 2; res.alpha.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: Math.cos(a) * s, vy: 1 + R() * 2, vz: Math.sin(a) * s, life: 1.2, size: 0.3, size1: 1.2, r: 0.7, g: 0.66, b: 0.6, a: 0.5, cell: 3, drag: 2.5, grav: 1 }); }
    burstAt(pos, 16, [1, 0.85, 0.5]);
    events.emit('oreBroken', { id: it.id, position: pos.clone() });
    events.emit('physicsImpact', { position: pos.clone(), speed: 6, material: 'stone' });
    dirty = true;
  }

  // ------------------------------------------------------------------ loose drops
  const dropMeshes = new Map();
  function spawnDrop(id, pos, R = Math.random) {
    const g = ingredientGeometry(id, 'item');
    const mesh = new THREE.Mesh(g, mat); mesh.castShadow = true;
    mesh.scale.setScalar(1.4);
    mesh.position.copy(pos);
    root.add(mesh);
    const a = R() * 6.28, s = 1 + R() * 1.5;
    drops.push({ id, mesh, pos: mesh.position, vel: new THREE.Vector3(Math.cos(a) * s, 3 + R() * 2, Math.sin(a) * s), t: 0, rest: false, phase: R(), spin: (R() - 0.5) * 12 });
    sparkT = 0;
  }
  function updateDrops(dt, pl) {
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i]; d.t += dt;
      if (!d.rest) {
        d.vel.y -= 18 * dt; d.pos.addScaledVector(d.vel, dt);
        d.mesh.rotation.y += d.spin * dt; d.mesh.rotation.x += d.spin * 0.6 * dt;
        const g = world.getHeight(d.pos.x, d.pos.z);
        if (d.pos.y < g) { d.pos.y = g; if (d.vel.y < -2) { d.vel.y *= -0.35; d.vel.x *= 0.6; d.vel.z *= 0.6; } else { d.rest = true; d.mesh.rotation.x = 0; } }
      }
      if (pl && d.t > 0.7 && (pl.x - d.pos.x) ** 2 + (pl.z - d.pos.z) ** 2 < 1.6 && Math.abs(pl.y - d.pos.y) < 2) {
        inv.add(d.id, 1);
        events.emit('itemPickup', { id: d.id, name: ITEMS[d.id]?.name || d.id, kind: 'material', count: 1, position: d.pos.clone(), source: 'drop' });
        burstAt(d.pos, 6);
        root.remove(d.mesh); drops.splice(i, 1); sparkT = 0;
      } else if (d.t > 300) { root.remove(d.mesh); drops.splice(i, 1); }
    }
  }

  // other systems' hits / explosions crack ore deposits
  function hitAt(p, power = 1) {
    if (!p) return;
    const cx = Math.floor(p.x / CHUNK), cz = Math.floor(p.z / CHUNK);
    const c = chunks.get(cx + ',' + cz); if (!c) return;
    for (const it of c.items) {
      if (it.gone || it.kind !== 'ore') continue;
      const d2 = (it.x - p.x) ** 2 + (it.z - p.z) ** 2;
      if (d2 < (1.4 * it.scale) ** 2 + power * power) {
        it.hits += power;
        burstAt(_pp.set(it.x, it.y + 0.8, it.z), 5, [1, 0.8, 0.5]);
        if (it.hits >= 3) breakOre(it);
      }
    }
  }
  events.on('hit', e => { if (e?.position && (e.target === 'world' || e.material === 'stone' || !e.target)) hitAt(e.position, 1); });
  events.on('swing', e => { const pl = ctx.systems.player; if (!pl) return; const fx = Math.sin(pl.yaw), fz = Math.cos(pl.yaw); hitAt(_pp.set(pl.position.x + fx * 1.2, pl.position.y, pl.position.z + fz * 1.2), 1); });
  events.on('explosion', e => { if (e?.position) hitAt(e.position, 3 + (e.radius || 0)); });

  return {
    root, collected, chunks,
    get drops() { return drops; },
    stream, nearest, promptFor, collect, spawnDrop, hitAt,
    markDirty() { dirty = true; },
    update(dt) {
      stream();
      const pl = ctx.systems.player?.position;
      updateFish(dt, pl);
      updateDrops(dt, pl);
      refreshSparkles(false);
    },
    serialize() { const o = {}; for (const [k, v] of collected) o[k] = v; return o; },
    restore(o) { collected.clear(); for (const k in o || {}) collected.set(k, o[k]); for (const c of chunks.values()) for (const it of c.items) it.gone = false; dirty = true; },
  };
}
