// Inventory data model.
//   stacks: Map itemId -> count (materials + key items)
//   dishes: array of cooked dish objects (food tab), each unique (effects/hearts differ)
//   shards: currency
// Weapons / bows / shields are owned by combat (durability lives there); list() mirrors them
// through combat.getInventoryWeapons() so a UI can show every tab from one call.
import { ITEMS, CATEGORIES } from './items.js';

export function createInventory(ctx) {
  const stacks = new Map();
  const dishes = [];
  let shards = 0;
  const MAX_STACK = 999, MAX_DISHES = 60;
  const listeners = new Set();
  const changed = (what) => { for (const fn of listeners) fn(what); ctx.events.emit('inventoryChanged', { what }); };

  const inv = {
    CATEGORIES,
    get shards() { return shards; },
    addShards(n) { shards = Math.max(0, shards + Math.round(n)); ctx.events.emit('shards', { shards, delta: n }); changed('shards'); return shards; },
    spendShards(n) { if (shards < n) return false; shards -= n; ctx.events.emit('shards', { shards, delta: -n }); changed('shards'); return true; },
    add(id, n = 1, meta) {
      if (id === 'arrow_bundle') { ctx.systems.combat?.addArrows?.(5 * n); return true; }   // arrows live in combat's quiver
      if (id === 'dish' && meta) return inv.addDish(meta);
      if (!ITEMS[id]) {
        // unknown ids from other systems become generic materials so nothing is lost
        ITEMS[id] = { id, name: meta?.name || id, cat: meta?.kind === 'key' ? 'key' : 'materials', tags: [], value: 1, shape: 'flint', c: '#c8c0b0', c2: '#888', desc: meta?.desc || '', edible: false };
      }
      stacks.set(id, Math.min(MAX_STACK, (stacks.get(id) || 0) + n));
      changed(id);
      return true;
    },
    remove(id, n = 1) {
      const c = stacks.get(id) || 0;
      if (c < n) return false;
      if (c === n) stacks.delete(id); else stacks.set(id, c - n);
      changed(id);
      return true;
    },
    count(id) { return stacks.get(id) || 0; },
    has(id, n = 1) { return (stacks.get(id) || 0) >= n; },
    addDish(d) { if (dishes.length >= MAX_DISHES) return false; dishes.push(d); changed('food'); return true; },
    removeDish(uid) { const i = dishes.findIndex(d => d.uid === uid); if (i < 0) return null; const [d] = dishes.splice(i, 1); changed('food'); return d; },
    get dishes() { return dishes; },
    // edible / cookable materials currently held
    cookables() {
      const out = [];
      for (const [id, n] of stacks) { const it = ITEMS[id]; if (it && it.cat === 'materials') out.push({ id, count: n, item: it }); }
      const order = ['mushroom', 'herb', 'fruit', 'fish', 'meat', 'egg', 'grain', 'dairy', 'sweet', 'spice', 'monster', 'mineral'];
      const rank = it => { const i = order.findIndex(t => it.tags.includes(t)); return i < 0 ? 99 : i; };
      out.sort((a, b) => rank(a.item) - rank(b.item) || a.item.name.localeCompare(b.item.name));
      return out;
    },
    // entries for a tab: [{key, id, name, count, desc, cat, value, item|dish|weapon, equipped}]
    list(cat) {
      const out = [];
      if (cat === 'weapons' || cat === 'bows' || cat === 'shields') {
        const w = ctx.systems.combat?.getInventoryWeapons?.();
        const arr = w?.[cat] || [];
        const eq = ctx.systems.combat?.getEquipped?.() || w?.equipped || {};
        for (const x of arr) {
          const info = x.def ? { uid: x.uid, id: x.id, name: x.def.name, type: x.def.type, dmg: x.def.dmg, dur: x.dur, maxDur: x.maxDur } : x;
          const eqv = Object.values(eq).some(e => e && (e.uid === info.uid || e === x));
          out.push({ key: info.uid || info.id, id: info.id, name: info.name, count: 1, cat, weapon: info, equipped: eqv, desc: info.dmg ? `Power ${info.dmg} · durability ${Math.ceil(info.dur ?? 0)}/${info.maxDur ?? '?'}` : '' });
        }
        return out;
      }
      if (cat === 'food') {
        for (const d of dishes) out.push({ key: d.uid, id: 'dish', name: d.name, count: 1, cat, dish: d, desc: d.desc, value: d.value });
        return out;
      }
      for (const [id, n] of stacks) {
        const it = ITEMS[id]; if (!it || it.cat !== cat) continue;
        out.push({ key: id, id, name: it.name, count: n, cat, item: it, desc: it.desc, value: it.value });
      }
      if (cat === 'materials') {
        const order = ['mushroom', 'herb', 'fruit', 'fish', 'meat', 'egg', 'grain', 'dairy', 'sweet', 'spice', 'mineral', 'monster'];
        const rank = it => { const i = order.findIndex(t => it.tags.includes(t)); return i < 0 ? 99 : i; };
        out.sort((a, b) => rank(a.item) - rank(b.item) || a.name.localeCompare(b.name));
      }
      return out;
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    serialize() { return { stacks: Object.fromEntries(stacks), dishes: dishes.slice(), shards }; },
    restore(o) {
      stacks.clear(); dishes.length = 0;
      for (const k in o?.stacks || {}) stacks.set(k, o.stacks[k]);
      for (const d of o?.dishes || []) dishes.push(d);
      shards = o?.shards || 0;
      changed('all');
    },
    clear() { stacks.clear(); dishes.length = 0; shards = 0; changed('all'); },
  };
  return inv;
}
