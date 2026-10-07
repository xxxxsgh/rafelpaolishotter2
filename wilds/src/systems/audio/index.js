// audio system — everything synthesised with WebAudio (no files).
//
//   core.js        bus graph, master compressor + limiter, procedural reverbs, noise/texture buffers
//   instruments.js felt piano, plucked string, glass bell, flute, pads, bass, percussion
//   music.js       adaptive score: sparse exploration phrases (day / dusk / night), combat layer,
//                  sanctum pads, stingers, leitmotif at dawn & dusk
//   ambience.js    wind (strength + altitude + gusts), rustle, birds, crickets, frogs, owls, rain,
//                  thunder (distance-delayed), river, lake, ocean surf, waterfalls, campfire crackle
//   sfx.js         footsteps by surface, traversal, glider, combat, creatures, items, cooking, UI
//
// The AudioContext is created on the first user gesture (browser autoplay rules).
// KeyN toggles mute (persisted). In shot mode audio stays off unless ?audio=1.
//
// API (ctx.systems.audio):
//   started, muted, toggleMute(), setMuted(b), setVolume(0..1), setBusVolume('music'|'sfx'|'amb'|'ui', v)
//   play(name, opts)   fire any Sfx method by name, e.g. play('ui', {type:'click'}), play('clang', {position})
//   ui(type)           'click' | 'open' | 'close' | 'select' | 'error'
//   sting(name)        'shrine' | 'discovery' | 'quest' | 'victory' | 'death'
//   core               the bus graph (A) once started; null before
// Listens to (besides the documented events): enemyAlert, enemyWindup, enemyTaunt, swing, parry, block,
//   weaponLow, arrowShot, arrowHit, explosion, fuseLit, slam, boltCast, lockOn, chestOpened, campCleared,
//   cookStart, eat, questComplete, spireActivated, beaconLit, sanctumEnter/Exit/GateOpen, plate,
//   runeToggle, propIgnited, fireStart, propBroken, physicsImpact, iceMelted, mantle, climbSlip,
//   climbEnd, swimStart, splash, heal, playerDied, uiOpen, uiClose, uiClick {type}.
import { createCore, clamp, smooth } from './core.js';
import { Music } from './music.js';
import { Ambience } from './ambience.js';
import { Sfx } from './sfx.js';

const MUTE_KEY = 'windborne.audio.muted';

export async function init(ctx) {
  const { THREE, events, world, uniforms, camera } = ctx;
  let A = null, music = null, amb = null, sfx = null;
  let muted = false, volume = 0.8;
  try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* storage blocked */ }

  // ------------------------------------------------------------ state objects (reused, no per-frame allocs)
  const envState = {
    wind: 0.6, altitude: 0, y: 0, daylight: 1, night: 0, rain: 0, storm: 0, grass: 1, forest: 0, snow: 0,
    river: 0, ocean: 0, lake: 0, falls: null, fallsAmt: 0, fire: null, fireAmt: 0, glide: 0, indoor: 0,
    underwater: false, lx: 0, ly: 0, lz: 0, demo: false,
  };
  const musicState = { night: 0, dusk: 0, combat: false, intensity: 0, sanctum: false, restScale: 1, victory: false, silent: false };
  const fallsPos = { x: 0, y: 0, z: 0 }, firePos = { x: 0, y: 0, z: 0 };
  const surf = {}, riv = {};
  const fwd = new THREE.Vector3(), up = new THREE.Vector3(), lpos = new THREE.Vector3();
  let sampleT = 0, stormS = 0, sanctum = false, combatS = 0, lastHurt = 0, stepGate = 0;

  // ------------------------------------------------------------ start / mute
  let toast = null, toastTimer = 0;
  function showToast(text) {
    if (ctx.shotMode) return;
    if (!toast) {
      toast = document.createElement('div');
      toast.style.cssText = 'position:fixed;right:22px;bottom:22px;padding:7px 14px;border-radius:14px;font:500 12px/1.2 system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#f2ead8;background:rgba(20,28,32,.42);border:1px solid rgba(242,234,216,.25);backdrop-filter:blur(4px);pointer-events:none;transition:opacity .5s;opacity:0;z-index:50';
      document.body.appendChild(toast);
    }
    toast.textContent = text; toast.style.opacity = '1';
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.style.opacity = '0'; }, 1400);
  }
  function applyGain() {
    if (!A) return;
    const t = A.ac.currentTime;
    A.out.gain.cancelScheduledValues(t);
    A.out.gain.setTargetAtTime(muted ? 0 : 1, t, 0.08);
    A.master.gain.setTargetAtTime(0.85 * volume / 0.8, t, 0.1);
  }
  function start() {
    if (A) { if (A.ac.state === 'suspended') A.ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      const ac = new AC({ latencyHint: 'interactive' });
      A = createCore(ac);
      music = new Music(A); amb = new Ambience(A); sfx = new Sfx(A);
      music.pendingTheme = true;   // open with the leitmotif
      A.out.gain.value = 0;
      applyGain();
      api.core = A; api.started = true;
      if (ac.state === 'suspended') ac.resume();
    } catch (e) { console.warn('[audio] could not start', e); A = null; }
  }
  const gesture = () => { start(); if (A && A.ac.state === 'running') for (const ev of ['pointerdown', 'keydown', 'touchstart']) removeEventListener(ev, gesture, true); };
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) addEventListener(ev, gesture, true);
  addEventListener('keydown', e => {
    if (e.code !== 'KeyN' || e.repeat || e.target?.tagName === 'INPUT') return;
    api.toggleMute();
  });
  document.addEventListener('visibilitychange', () => {
    if (!A) return;
    if (document.hidden) A.ac.suspend(); else A.ac.resume();
  });

  // ------------------------------------------------------------ helpers
  const now = () => A.ac.currentTime + 0.005;
  const player = () => ctx.systems.player;
  // distance gate so far-away one-shots don't waste nodes
  const near = (pos, r = 90) => !pos || !camera || camera.position.distanceToSquared(pos) < r * r;
  const on = (name, fn) => events.on(name, p => { if (!A || muted) return; try { fn(p || {}); } catch (e) { console.warn('[audio] ' + name, e); } });

  // ------------------------------------------------------------ events: traversal
  on('footstep', p => {
    const t = now();
    if (t - stepGate < 0.09) return; stepGate = t;
    sfx.footstep(t, p.surface, p.speed ?? 3, null);
  });
  on('jump', p => sfx.jump(now()));
  on('land', p => sfx.land(now(), p.height ?? 1, p.surface, p.hard));
  on('glideStart', () => sfx.gliderOpen(now()));
  on('glideEnd', () => sfx.gliderClose(now()));
  on('climbStart', () => sfx.grab(now()));
  on('mantle', () => sfx.mantle(now()));
  on('climbSlip', () => sfx.slip(now()));
  on('swimStart', p => sfx.splash(now(), null, 0.8));
  on('splash', p => near(p.position) && sfx.splash(now(), p.position, 0.6));
  // ------------------------------------------------------------ events: combat
  on('swing', p => sfx.swing(now(), p.weapon?.type, p.step ?? 0, p.finisher || p.spin));
  on('hit', p => {
    const t = now();
    if (p.target === 'enemy') { sfx.hit(t, p.position, { damage: p.damage, crit: p.sneak || p.crit }); if (A.rng() < 0.7) sfx.grunt(t + 0.03, p.position, 'hurt', p.kind === 'brute' ? 1.4 : 1); }
    else sfx.hit(t, p.position, { damage: p.damage, metal: false });
  });
  on('damage', p => { if (p.target !== 'player') return; const t = now(); if (t - lastHurt < 0.25) return; lastHurt = t; sfx.hurt(t, p.amount ?? 1); });
  on('block', p => sfx.block(now(), p.position, p.heavy));
  on('parry', p => sfx.parry(now(), p.position));
  on('weaponBroke', p => sfx.weaponBreak(now(), player()?.position));
  on('weaponLow', () => sfx.weaponLow(now()));
  on('aimStart', () => sfx.bowDraw(now()));
  on('arrowShot', p => near(p.position) && sfx.arrowShot(now(), p.owner === 'player' ? null : p.position));
  on('arrowHit', p => near(p.position) && sfx.arrowHit(now(), p.position));
  on('explosion', p => near(p.position, 300) && sfx.explosion(now(), p.position, p.radius));
  on('fuseLit', p => near(p.position) && sfx.fuse(now(), p.position));
  on('slam', p => near(p.position, 150) && sfx.slam(now(), p.position, p.radius));
  on('boltCast', p => near(p.position) && sfx.zap(now(), p.position, p.element));
  on('lockOn', () => sfx.lockOn(now()));
  on('enemyAlert', p => { if (near(p.position, 80)) sfx.grunt(now(), p.position, 'alert', p.kind === 'brute' ? 1.4 : 1); musicState.victory = false; });
  on('enemyWindup', p => near(p.position, 60) && A.rng() < 0.6 && sfx.grunt(now(), p.position, 'windup', p.kind === 'brute' ? 1.4 : 1));
  on('enemyTaunt', p => near(p.position, 60) && sfx.grunt(now(), p.position, 'taunt'));
  on('enemyKilled', p => { const t = now(); sfx.grunt(t, p.position, 'death', p.kind === 'brute' ? 1.4 : 1); sfx.poof(t + 0.9, p.position); if (combatS > 0) musicState.victory = true; });
  on('flurryStart', () => { const t = now(); A.burst(t, 0.6, A.sfx, { noise: 'pink', bp: 300, bpTo: 2400, q: 1, gain: 0.25, attack: 0.5, shape: 'swell' }); });
  on('campCleared', () => { musicState.victory = false; music.sting('victory', now() + 0.3); });
  on('chestOpened', p => sfx.chest(now(), p.position));
  on('chestLocked', () => sfx.ui(now(), 'error'));
  // ------------------------------------------------------------ events: items, cooking, progress
  on('itemPickup', p => sfx.pickup(now(), p.kind));
  on('cookStart', () => sfx.cookStart(now()));
  on('cook', p => { const d = p.dish; const ok = !(d && (d.dubious || d.id === 'dubious' || /dubious|burnt|mush/i.test(d.name || ''))); sfx.cook(now(), ok); });
  on('eat', () => sfx.eat(now()));
  on('heal', p => (p.amount ?? 1) > 0 && sfx.heal(now()));
  on('questComplete', () => music.sting('quest', now() + 0.1));
  on('spireActivated', () => music.sting('discovery', now()));
  on('beaconLit', p => { sfx.whoomp(now(), p.position); music.sting('discovery', now() + 0.6); });
  on('shrineSolved', () => music.sting('shrine', now()));
  on('playerDied', () => music.sting('death', now()));
  on('staminaExhausted', () => { const t = now(); sfx.heartbeat(t); sfx.heartbeat(t + 0.9); });
  // ------------------------------------------------------------ events: physics / sanctum
  on('sanctumEnter', () => { sanctum = true; });
  on('sanctumExit', () => { sanctum = false; });
  on('sanctumGateOpen', p => sfx.stoneGrind(now(), p.position || player()?.position));
  on('plate', p => sfx.plate(now(), p.position || null, p.pressed));
  on('runeToggle', p => sfx.rune(now(), p.active));
  on('runeGrab', () => sfx.rune(now(), true));
  on('propIgnited', p => near(p.position) && sfx.whoomp(now(), p.position));
  on('fireStart', p => near(p.position) && sfx.whoomp(now(), p.position));
  on('propBroken', p => near(p.position) && sfx.woodBreak(now(), p.position));
  on('oreBroken', p => near(p.position) && sfx.impact(now(), p.position, 9, 'stone'));
  on('iceMelted', p => near(p.position) && sfx.sizzle(now(), p.position));
  let impactGate = 0;
  on('physicsImpact', p => { const t = now(); if (t - impactGate < 0.04 || !near(p.position, 60)) return; impactGate = t; sfx.impact(t, p.position, p.speed ?? 4, p.material); });
  // ------------------------------------------------------------ events: ui + weather
  on('uiOpen', () => sfx.ui(now(), 'open'));
  on('uiClose', () => sfx.ui(now(), 'close'));
  on('uiClick', p => sfx.ui(now(), p.type || 'click'));
  on('equipWeapon', () => sfx.ui(now(), 'select'));
  on('lightning', p => {
    const delay = clamp(p.delay ?? (p.distance ?? 1000) / 343, 0.05, 9);
    camera.getWorldPosition(lpos);
    amb.thunder(now() + delay, p.distance ?? 1000, p.position, lpos);
  });
  on('timeChange', p => { const h = Math.floor(p.hour ?? 0); if (h === 6 || h === 18) music.queueTheme(A.ac.currentTime); });

  // ------------------------------------------------------------ environment sampling (5 Hz)
  function sampleEnv() {
    const pl = player();
    const p = pl?.position || ctx.focus;
    const x = p.x, z = p.z;
    const gh = world.getHeight(x, z);
    envState.y = p.y; envState.altitude = Math.max(0, p.y - Math.max(gh, world.WATER_LEVEL ?? 0));
    if (world.getSurface) { world.getSurface(x, z, surf); envState.grass = surf.grass ?? 1; envState.snow = surf.snow ?? 0; }
    envState.forest = world.forestFactor ? world.forestFactor(x, z) : 0;
    // river
    let river = 0;
    const ri = world.getRiverInfo?.(x, z, riv);
    if (ri) river = 1 - smooth(ri.halfWidth * 0.5, ri.halfWidth + 70, ri.dist);
    envState.river = river;
    // lakes
    let lake = 0;
    if (world.LAKES) for (const L of world.LAKES) { const d = Math.hypot(x - L.x, z - L.z) - L.r; lake = Math.max(lake, 1 - smooth(-5, 60, d)); }
    envState.lake = lake * (1 - river * 0.5);
    // ocean: probe a ring around the player
    const water = ctx.systems.water;
    let ocean = 0;
    if (water?.getWaterKind) {
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2;
        for (const [rad, w] of [[25, 1], [70, 0.7], [140, 0.4]]) {
          if (water.getWaterKind(x + Math.cos(a) * rad, z + Math.sin(a) * rad) === 'ocean') { ocean = Math.max(ocean, w); break; }
        }
      }
      if (water.getWaterKind(x, z) === 'ocean') ocean = 1;
    } else if (gh < -2) ocean = 1;
    envState.ocean = ocean * clamp(1 - envState.altitude / 120, 0, 1);
    // waterfalls
    const falls = water?.falls || world.WATERFALLS;
    let bd = 1e9, bf = null;
    if (falls) for (const f of falls) { const fx = f.bx ?? f.x, fz = f.bz ?? f.z; const d = (fx - x) ** 2 + (fz - z) ** 2; if (d < bd) { bd = d; bf = f; } }
    if (bf && bd < 320 * 320) {
      fallsPos.x = bf.bx ?? bf.x; fallsPos.z = bf.bz ?? bf.z; fallsPos.y = (bf.by ?? bf.bottom ?? world.getHeight(fallsPos.x, fallsPos.z)) + 2;
      envState.falls = fallsPos; envState.fallsAmt = 1;
    } else envState.fallsAmt = 0;
    // fires: gameplay campfires (lit) and enemy camp fires
    let fd = 40 * 40, ff = null;
    const fires = ctx.systems.gameplay?.campfires;
    if (fires) for (const f of fires) { if (!f.lit || !f.pos) continue; const d = (f.pos.x - x) ** 2 + (f.pos.z - z) ** 2; if (d < fd) { fd = d; ff = f.pos; } }
    const camps = ctx.systems.combat?.camps;
    if (camps) for (const c of camps) { if (c.x === undefined) continue; const d = (c.x - x) ** 2 + (c.z - z) ** 2; if (d < fd) { fd = d; firePos.x = c.x; firePos.y = (c.y ?? 0) + 0.5; firePos.z = c.z; ff = firePos; } }
    if (ff) { if (ff !== firePos) { firePos.x = ff.x; firePos.y = ff.y + 0.4; firePos.z = ff.z; } envState.fire = firePos; envState.fireAmt = 1; } else envState.fireAmt = 0;
    // combat awareness
    const enemies = ctx.systems.combat?.enemies;
    let count = 0, nearest = 1e9;
    if (enemies) for (const e of enemies) {
      if (e.dead || !e.alerted || !e.pos) continue;
      const d = Math.hypot(e.pos.x - x, e.pos.z - z);
      if (d < 50) { count++; if (d < nearest) nearest = d; }
    }
    musicState.combat = count > 0;
    musicState.intensity = clamp(count / 4 + (nearest < 14 ? 0.35 : 0), 0, 1);
    combatS = count;
  }

  // ------------------------------------------------------------ per-frame
  function update(dt) {
    if (!A || A.ac.state !== 'running') return;
    const t = A.ac.currentTime;
    // listener follows the camera
    camera.getWorldPosition(lpos);
    camera.getWorldDirection(fwd);
    up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const L = A.ac.listener;
    if (L.positionX) {
      L.positionX.value = lpos.x; L.positionY.value = lpos.y; L.positionZ.value = lpos.z;
      L.forwardX.value = fwd.x; L.forwardY.value = fwd.y; L.forwardZ.value = fwd.z;
      L.upX.value = up.x; L.upY.value = up.y; L.upZ.value = up.z;
    } else { L.setPosition(lpos.x, lpos.y, lpos.z); L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z); }
    envState.lx = lpos.x; envState.ly = lpos.y; envState.lz = lpos.z;

    sampleT -= dt;
    if (sampleT <= 0) { sampleT = 0.2; try { sampleEnv(); } catch (e) { if (!sampleEnv.warned) { sampleEnv.warned = true; console.warn('[audio] env sample', e); } } }

    const sky = ctx.systems.sky;
    const day = sky?.getDaylight ? sky.getDaylight() : smooth(-0.1, 0.15, uniforms.uSunDir.value.y);
    envState.daylight = day; envState.night = 1 - day;
    envState.wind = uniforms.uWindStrength?.value ?? 0.6;
    envState.rain = clamp(uniforms.uRain?.value ?? 0, 0, 1);
    const w = sky?.getWeather?.();
    stormS += ((w === 'storm' ? 1 : 0) - stormS) * Math.min(1, dt * 0.3);
    envState.storm = stormS;
    if (w === 'snow') envState.snow = Math.max(envState.snow, 0.8);
    const inSanctum = sanctum || !!ctx.systems.physics?.activeSanctum;
    envState.indoor += ((inSanctum ? 1 : 0) - envState.indoor) * Math.min(1, dt * 2);
    const water = ctx.systems.water;
    envState.underwater = !!water?.isUnderwater?.(lpos);
    const pl = player();
    if (pl?.gliding && pl.velocity) envState.glide = clamp(Math.hypot(pl.velocity.x, pl.velocity.y, pl.velocity.z) / 14, 0, 1.2);
    else envState.glide = 0;

    amb.step(envState, t, 0.3);

    const hour = sky?.getTime?.() ?? 12;
    musicState.night = 1 - smooth(0.2, 0.6, day);
    musicState.dusk = (hour > 17 && hour < 20.5) || (hour > 4.5 && hour < 7) ? 1 : 0;
    musicState.sanctum = inSanctum;
    music.step(musicState, t, 0.35);
    A.sfx.hallSend.gain.setTargetAtTime(inSanctum ? 0.45 : 0, t, 0.5);
    A.hallRet.gain.setTargetAtTime(inSanctum ? 0.8 : 0.0, t, 0.5);
    A.airRet.gain.setTargetAtTime(inSanctum ? 0.25 : 0.55, t, 0.5);
  }

  const api = {
    started: false, core: null,
    get muted() { return muted; },
    setMuted(b) { muted = !!b; try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* ignore */ } applyGain(); showToast(muted ? 'Sound off' : 'Sound on'); },
    toggleMute() { start(); api.setMuted(!muted); },
    setVolume(v) { volume = clamp(+v || 0, 0, 1); applyGain(); },
    setBusVolume(bus, v) { if (!A) return; const b = { music: A.music, sfx: A.sfx, amb: A.ambBus, ui: A.ui }[bus]; b?.gain.setTargetAtTime(clamp(v, 0, 1.5), A.ac.currentTime, 0.1); },
    play(name, o = {}) {
      if (!A || muted || typeof sfx[name] !== 'function') return;
      const t = now();
      switch (name) {
        case 'ui': return sfx.ui(t, o.type);
        case 'footstep': return sfx.footstep(t, o.surface, o.speed, o.position);
        default: return sfx[name](t, o.position, o.a, o.b);
      }
    },
    ui(type = 'click') { if (A && !muted) sfx.ui(now(), type); },
    sting(name) { if (A && !muted) music.sting(name, now()); },
    start,
    update,
  };
  if (ctx.params.get('audio') === '1') start();
  window.__audio = api;
  return api;
}
