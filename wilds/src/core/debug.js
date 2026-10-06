// Debug + screenshot hooks. tools/shot.mjs loads index.html?shot=<preset> and
// waits for window.__shotReady before capturing.
//
// Presets are deliberately data so any system can tune its own viewpoint.
// Fields: time (hours 0-24), weather ('clear'|'cloudy'|'rain'|'storm'|'fog'|'snow'),
//   player {x, z, yaw, state}  -> ctx.systems.player.debugPlace(player)
//   cam {x, y?, z, tx, ty?, tz} -> ctx.cameraOverride (y/ty default to ground + offset)
//   hud (bool, default false), extra(ctx) optional hook.
export const SHOT_PRESETS = {
  vista:    { time: 9.5,  weather: 'clear',  cam: { x: 170, z: 520, h: 14, tx: 20, tz: -700, th: 110 } },
  meadow:   { time: 16.5, weather: 'clear',  cam: { x: 120, z: 340, h: 2.2, tx: 260, tz: 120, th: 6 } },
  forest:   { time: 11,   weather: 'clear',  cam: { x: -772, z: 792, h: 2.0, tx: -700, tz: 818, th: 7 } },
  grove:    { time: 15,   weather: 'clear',  cam: { x: 128, z: 140, h: 2.4, tx: 160, tz: 95, th: 6 } },
  river:    { time: 8,    weather: 'clear',  cam: { x: 922, z: 20, h: 5, tx: 965, tz: 260, th: 2 } },
  mountain: { time: 18.2, weather: 'clear',  cam: { x: -150, z: -450, h: 12, tx: -260, tz: -1290, th: -60 } },
  ruins:    { time: 10.5, weather: 'clear',  cam: { x: 60, z: -95, h: 3, tx: 40, tz: -170, th: 12 } },
  cliffs:   { time: 14,   weather: 'clear',  cam: { x: 110, z: -610, h: 3, tx: 40, tz: -485, th: 22 } },
  canyon:   { time: 16,   weather: 'clear',  cam: { x: 1085, z: 640, h: 5, tx: 1150, tz: 880, th: 12 } },
  beach:    { time: 10,   weather: 'clear',  cam: { x: -1570, z: 540, h: 3, tx: -1760, tz: 680, th: 0 } },
  lake:     { time: 16.5, weather: 'clear',  cam: { x: -662, z: 128, h: 3.5, tx: -1000, tz: 205, th: 2 } },
  falls:    { time: 10.5, weather: 'clear',  cam: { x: 572, z: -96, h: 3, tx: 500, tz: -48, th: 16 } },
  coast:    { time: 11,   weather: 'clear',  cam: { x: -1480, z: 470, y: 95, tx: -1720, tz: 700, ty: 0 } },
  rainlake: { time: 13,   weather: 'rain',   cam: { x: -680, z: 140, h: 2.5, tx: -800, tz: 175, th: -1 } },
  seaglow:  { time: 18.3, weather: 'clear',  cam: { x: 1490, z: 200, h: 4, tx: 1900, tz: 170, th: 8 } },
  lakenight:{ time: 22.5, weather: 'clear',  cam: { x: -662, z: 128, h: 3.5, tx: -1000, tz: 205, th: 6 } },
  delta:    { time: 15,   weather: 'clear',  cam: { x: 1060, z: 760, y: 230, tx: 1330, tz: 1180, ty: 0 } },
  sunset:   { time: 19.0, weather: 'cloudy', cam: { x: -200, z: 0, h: 12, tx: 400, tz: 100, th: 20 } },
  night:    { time: 23.5, weather: 'clear',  cam: { x: 100, z: 100, h: 6, tx: 420, tz: 40, th: 110 } },
  storm:    { time: 14,   weather: 'storm',  cam: { x: 200, z: 300, h: 8, tx: 400, tz: 0, th: 10 },
              // sky: fire a lightning strike just before capture so the bolt + flash are in frame
              extra: ctx => { const n = +(ctx.params.get('frames') || 90); let i = 0; ctx.engine.add('storm-shot', () => { if (++i === n - 3) ctx.systems.sky?.strikeLightning?.(); }); } },
  player:   { time: 10,   weather: 'clear',  player: { x: 150, z: 250, yaw: 0.6, state: 'idle' }, hud: true },
  run:      { time: 13,   weather: 'clear',  player: { x: 150, z: 250, yaw: 0.6, state: 'run' } },
  climb:    { time: 15,   weather: 'clear',  player: { x: 150, z: 250, yaw: 0.6, state: 'climb' } },
  glide:    { time: 12,   weather: 'clear',  player: { x: 150, z: 250, yaw: 0.6, state: 'glide' } },
  combat:   { time: 15,   weather: 'clear',  player: { x: 150, z: 250, yaw: 0.6, state: 'combat' }, hud: true },   // combat: setupShot stages a camp fight
  camp:     { time: 17.6, weather: 'clear',  player: { x: 150, z: 250, yaw: 0.6, state: 'camp' } },   // combat: setupShot frames the nearest enemy camp
  shrine:   { time: 12,   weather: 'clear',  player: { x: 150, z: 250, yaw: 0.6, state: 'shrine' },
              // physics: teleport into the Sanctum of Balance interior and frame the hall
              extra: ctx => ctx.systems.physics?.debugShot?.('shrine') },
  sanctum:  { time: 17.6, weather: 'clear',  player: { x: 150, z: 250, yaw: 0.6, state: 'idle' },
              extra: ctx => ctx.systems.physics?.debugShot?.('sanctum-gate') },
  props:    { time: 16.8, weather: 'clear',  player: { x: 150, z: 250, yaw: 0.6, state: 'idle' },
              extra: ctx => ctx.systems.physics?.debugShot?.('props') },
  lodestone:{ time: 12,   weather: 'clear',  player: { x: 150, z: 250, yaw: 0.6, state: 'idle' },
              extra: ctx => ctx.systems.physics?.debugShot?.('sanctum-lodestone') },
  cooking:  { time: 21,   weather: 'clear',  player: { x: 150, z: 250, yaw: 0.6, state: 'cooking' }, hud: true,
              // gameplay: build the hero's camp in front of them, freeze the pot mid-boil, frame across the fire
              extra: ctx => ctx.systems.gameplay?.debugShot?.('cooking') },
  hud:      { time: 10,   weather: 'clear',  player: { x: 150, z: 250, yaw: 0.6, state: 'idle' }, hud: true,
              // ui: a lived-in HUD — a little hurt, a prompt up, a pickup notice
              extra: ctx => ctx.systems.ui?.debugShot?.('hud') },
  title:    { time: 17.4, weather: 'clear',  player: { x: 150, z: 250, yaw: 0.6, state: 'idle' }, hud: true, ui: 'title' },
  inventory:{ time: 10,   weather: 'clear',  player: { x: 150, z: 250, yaw: 0.6, state: 'idle' }, hud: true, ui: 'inventory',
              extra: ctx => ctx.systems.gameplay?.debugShot?.('inventory') },
  spire:    { time: 16.5, weather: 'clear',  player: { x: 150, z: 250, yaw: 0.6, state: 'idle' },
              extra: ctx => ctx.systems.gameplay?.debugShot?.('spire') },
  forage:   { time: 11,   weather: 'clear',  player: { x: 150, z: 250, yaw: 0.6, state: 'idle' },
              extra: ctx => ctx.systems.gameplay?.debugShot?.('forage') },
  map:      { time: 10,   weather: 'clear',  player: { x: 150, z: 250, yaw: 0.6, state: 'idle' }, hud: true, ui: 'map' },
};

export function installDebug(ctx) {
  const { world } = ctx;
  const api = {
    ctx,
    setTime: h => ctx.systems.sky?.setTime?.(h),
    setWeather: w => ctx.systems.sky?.setWeather?.(w),
    teleport: (x, z) => ctx.systems.player?.debugPlace?.({ x, z }),
    presets: SHOT_PRESETS,
    applyShot(name) {
      const p = SHOT_PRESETS[name];
      if (!p) throw new Error('unknown preset ' + name);
      ctx.shotMode = true;
      if (p.time !== undefined) api.setTime(p.time);
      if (p.weather) api.setWeather(p.weather);
      if (p.player) ctx.systems.player?.debugPlace?.(p.player);
      if (p.cam) {
        const c = p.cam;
        const y = c.y ?? Math.max(world.getHeight(c.x, c.z), world.WATER_LEVEL) + (c.h ?? 2);
        const ty = c.ty ?? Math.max(world.getHeight(c.tx, c.tz), world.WATER_LEVEL) + (c.th ?? 0);
        ctx.cameraOverride = { pos: new ctx.THREE.Vector3(c.x, y, c.z), target: new ctx.THREE.Vector3(c.tx, ty, c.tz) };
        ctx.focus.set(c.x, y, c.z);
        ctx.camera.position.copy(ctx.cameraOverride.pos);
        ctx.camera.lookAt(ctx.cameraOverride.target);
      } else ctx.cameraOverride = null;
      ctx.hud.style.display = p.hud ? '' : 'none';
      if (p.ui) ctx.systems.ui?.open?.(p.ui);
      p.extra?.(ctx);
      ctx.events.emit('shot', { name, preset: p });
    },
  };
  window.__game = api;

  const shot = ctx.params.get('shot');
  if (shot) {
    api.applyShot(shot);
    // Warm-up: let streaming/LOD/shadows settle, then signal readiness.
    const frames = +(ctx.params.get('frames') || 90);
    let n = 0;
    ctx.engine.add('shot-warmup', () => {
      if (ctx.cameraOverride) { ctx.camera.position.copy(ctx.cameraOverride.pos); ctx.camera.lookAt(ctx.cameraOverride.target); }
      if (++n === frames) window.__shotReady = true;
    });
  }
}
