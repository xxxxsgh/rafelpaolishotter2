// Temperature + timed food effects (buffs).
//
// Temperature (°C) comes from altitude lapse, biome, time of day, weather, water and nearby
// fires. Beyond the comfort band the hero takes a quarter heart every few seconds unless a
// matching resistance (warmth / chill from food) covers it.
//   state: 'freezing' | 'cold' | 'mild' | 'hot' | 'scorching'
// Buffs: warmth, chill, might, guard, swift with level 1..3 and a remaining time.
//   swift scales the player's move speeds, guard refunds part of incoming damage, might is
//   exposed as getAttackMultiplier() for combat; warmth / chill widen the comfort band.
import { EFFECTS } from './items.js';

export function createStatus(ctx, deps) {
  const { events, world } = ctx;
  const buffs = new Map();     // effect -> {level, time, max}
  const temp = { value: 18, state: 'mild', cold: 2, hot: 34, dmgT: 0, nearFire: 0 };
  let baseSpeeds = null, speedK = 1, acc = 0;

  function addBuff(effect, level, seconds) {
    if (!EFFECTS[effect]?.timed) return;
    const cur = buffs.get(effect);
    // a stronger dish replaces; an equal one extends
    if (cur && cur.level > level) return;
    buffs.set(effect, { level, time: seconds, max: seconds });
    events.emit('buff', { effect, level, time: seconds });
  }
  const lvl = e => buffs.get(e)?.level || 0;

  function ambient(p) {
    const h = Math.max(0, p.y);
    let t = 24 - h * 0.06;
    const biome = world.getBiome(p.x, p.z);
    const sky = ctx.systems.sky;
    const day = sky?.getDaylight?.() ?? 1;
    const dayK = (day - 0.5);
    if (biome === 'mesa') t += 6 + 10 * day;
    else if (biome === 'meadow_dry') t += 2 + 4 * day;
    else if (biome === 'snow') t -= 8;
    else if (biome === 'alpine') t -= 3;
    else if (biome === 'shore') t += 1;
    t += dayK * 8;
    const w = sky?.getWeather?.();
    if (w === 'rain') t -= 4; else if (w === 'storm') t -= 6; else if (w === 'snow') t -= 10; else if (w === 'fog') t -= 2;
    if (ctx.systems.player?.state === 'swim') t -= 4;
    if (temp.nearFire > 0 && t < 24) t = Math.min(24, t + temp.nearFire);   // a fire comforts, it doesn't overheat
    if (ctx.indoor) t = 20;
    return t;
  }

  function update(dt) {
    const pl = ctx.systems.player;
    // buffs tick
    for (const [k, b] of buffs) { b.time -= dt; if (b.time <= 0) { buffs.delete(k); events.emit('buffEnd', { effect: k }); } }
    // swift: scale move speeds
    if (pl?.cfg) {
      if (!baseSpeeds) baseSpeeds = { walk: pl.cfg.walk, run: pl.cfg.run, sprint: pl.cfg.sprint, swim: pl.cfg.swim, climb: pl.cfg.climb };
      const k = 1 + 0.14 * lvl('swift');
      if (k !== speedK) { speedK = k; for (const key in baseSpeeds) pl.cfg[key] = baseSpeeds[key] * k; }
    }
    acc += dt;
    if (acc < 0.25 || !pl) return;
    const step = acc; acc = 0;
    temp.nearFire = deps.fireWarmth?.(pl.position) || 0;
    const target = ambient(pl.position);
    temp.value += (target - temp.value) * Math.min(1, step * 0.8);
    temp.cold = 2 - 16 * lvl('warmth');
    temp.hot = 34 + 14 * lvl('chill');
    const v = temp.value;
    const st = v < temp.cold - 14 ? 'freezing' : v < temp.cold ? 'cold' : v > temp.hot + 14 ? 'scorching' : v > temp.hot ? 'hot' : 'mild';
    if (st !== temp.state) { const from = temp.state; temp.state = st; events.emit('temperature', { state: st, from, value: v }); }
    if ((st !== 'mild') && pl.state !== 'dead' && !ctx.shotMode && !ctx.paused) {
      temp.dmgT += step;
      const every = st === 'freezing' || st === 'scorching' ? 2.2 : 4.5;
      if (temp.dmgT >= every) {
        temp.dmgT = 0;
        const type = st === 'cold' || st === 'freezing' ? 'cold' : 'heat';
        if (pl.health > 1) { pl.health = pl.health - 1; events.emit('damage', { amount: 1, health: pl.health, source: type, type, target: 'player' }); }
        else pl.damage?.(1, { source: type, type });
      }
    } else temp.dmgT = Math.max(0, temp.dmgT - step);
  }

  // guard: refund part of incoming damage
  events.on('damage', e => {
    if (!e || e.target !== 'player' || e.type === 'cold' || e.type === 'heat') return;
    const g = lvl('guard'); if (!g || !e.amount) return;
    const refund = Math.floor(e.amount * 0.2 * g + 0.25);
    if (refund > 0) setTimeout(() => ctx.systems.player?.heal?.(refund), 0);
  });

  return {
    temp, buffs, addBuff, update,
    getAttackMultiplier: () => 1 + 0.2 * lvl('might'),
    getDefenseMultiplier: () => 1 - 0.2 * lvl('guard'),
    getSpeedMultiplier: () => speedK,
    serialize() { return [...buffs].map(([k, b]) => [k, b.level, b.time, b.max]); },
    restore(a) { buffs.clear(); for (const [k, l, t, m] of a || []) buffs.set(k, { level: l, time: t, max: m }); },
  };
}
