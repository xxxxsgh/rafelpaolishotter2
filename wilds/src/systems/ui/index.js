// ui system — HUD, inventory, world map, pause/settings, title screen.
//
// API (ctx.systems.ui):
//   open(name, opts)    'inventory' {tab, select} | 'map' | 'pause' {pane} | 'title'
//   close()             close the current screen (resumes the game)
//   current             name of the open screen or null
//   toast(text)         short notice on the right edge
//   prompt(text, key)   context prompt above the hero ('E', 'Pick up Mushroom'); prompt(null) hides
//   banner(title, sub, kicker)   large centred banner (region discovered, quest step…)
//   settings            {quality, sensitivity, invertY, volume, hud}
//   revealDebug(list)   add fog-of-war reveal circles [{x,z,r}] (shots / debugging)
//   map                 map data (painted canvases, markers(), isRevealed(x,z))
// Listens: damage, weaponBroke, weaponLow, spireActivated (map refresh), shot.
// Emits:   uiOpen {name}, uiClose {name}, settingsChanged {settings}.
// Input:   Esc (pause / back), Tab or I (inventory), M (map). Pointer-lock loss while playing opens pause.
import { createMapData, createWorldMap } from './map.js';
import { createHud } from './hud.js';
import { createInventory, createPause, createTitle, loadSettings, SETTINGS_KEY } from './menus.js';

export async function init(ctx) {
  const shotMode = !!ctx.params?.has?.('shot');
  const host = ctx.hud || document.body;
  const root = document.createElement('div'); root.className = 'wb-ui';
  host.appendChild(root);

  const md = createMapData(ctx);
  md.requestWorld();
  const hud = createHud(ctx, md, root);

  const mkScreen = cls => { const s = document.createElement('div'); s.className = 'wb-screen ' + cls; root.appendChild(s); return s; };
  const invScreen = mkScreen('wb-inv');
  const mapScreen = mkScreen('wb-map');
  const pauseScreen = mkScreen('wb-pause');
  const inventory = createInventory(ctx, invScreen);
  const worldMap = createWorldMap(ctx, md, mapScreen);
  const settings = loadSettings();
  const title = createTitle(ctx, root);

  // ------------------------------------------------ settings
  const baseLook = ctx.input.look.bind(ctx.input);
  ctx.input.look = () => {
    const l = baseLook();
    const s = settings.sensitivity || 1;
    return { dx: l.dx * s, dy: l.dy * s * (settings.invertY ? -1 : 1) };
  };
  let appliedQuality = null;
  function applySettings(save = true) {
    root.classList.toggle('wb-minimal', settings.hud === 'minimal');
    hud.layer.querySelector('.wb-nav').style.display = settings.hud === 'minimal' ? 'none' : '';
    hud.layer.querySelector('.wb-compass').style.display = settings.hud === 'minimal' ? 'none' : '';
    ctx.systems.audio?.setVolume?.(settings.volume);
    if (!shotMode && settings.quality !== appliedQuality) {
      appliedQuality = settings.quality;
      const r = ctx.renderer;
      const pr = settings.quality === 'low' ? 0.66 : settings.quality === 'medium' ? 1 : Math.min(devicePixelRatio || 1, 2);
      try {
        r.setPixelRatio(pr);
        const sun = ctx.systems.sky?.sunLight;
        if (sun?.shadow) {
          const n = settings.quality === 'low' ? 1024 : settings.quality === 'medium' ? 2048 : Math.max(2048, sun.shadow.mapSize.x);
          if (sun.shadow.mapSize.x !== n) { sun.shadow.mapSize.set(n, n); sun.shadow.map?.dispose?.(); sun.shadow.map = null; }
        }
        ctx.engine.resize();
      } catch (e) { console.warn('[ui] quality change failed', e); }
    }
    if (save && !shotMode) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ } }
    ctx.events.emit('settingsChanged', { settings });
  }

  // ------------------------------------------------ screen state
  const screens = { inventory: { el: invScreen, ctl: inventory }, map: { el: mapScreen, ctl: worldMap }, pause: { el: pauseScreen, ctl: null } };
  let current = null, savedTimeScale = null, openedAt = 0;
  function freezeWorld(on) {
    const pl = ctx.systems.player, sky = ctx.systems.sky;
    ctx.paused = on;
    pl?.setInputEnabled?.(!on);
    if (sky) {
      if (on && savedTimeScale === null) { savedTimeScale = sky.timeScale; sky.timeScale = 0; }
      else if (!on && savedTimeScale !== null) { sky.timeScale = savedTimeScale; savedTimeScale = null; }
    }
  }
  function open(name, opts = {}) {
    if (name === 'title') { showTitle(); return; }
    const s = screens[name]; if (!s) return;
    if (current && current !== name) close(true);
    current = name; openedAt = performance.now();
    s.el.classList.add('on');
    hud.layer.classList.add('wb-hide');
    freezeWorld(true);
    if (document.pointerLockElement) document.exitPointerLock?.();
    if (name === 'map' && shotMode && !md.debugReveal.length) api.revealDebug(SHOT_REVEAL);
    if (name === 'inventory' && shotMode && !opts.tab) {
      const d = ctx.systems.gameplay?.inventory?.dishes || [];
      const pick = d.find(x => x.effect === 'warmth') || d[0];
      opts = { tab: 'food', select: pick?.uid };
    }
    s.ctl?.open?.(opts);
    ctx.events.emit('uiOpen', { name });
  }
  function close(swap = false) {
    if (!current) return;
    const s = screens[current];
    s.el.classList.remove('on');
    s.ctl?.close?.();
    ctx.events.emit('uiClose', { name: current });
    current = null;
    if (!swap) { hud.layer.classList.remove('wb-hide'); freezeWorld(false); }
  }
  const pause = createPause(ctx, pauseScreen, settings, {
    resume: () => close(),
    apply: () => applySettings(),
    toTitle: () => { close(); showTitle(); },
  });
  screens.pause.ctl = pause;

  function showTitle() {
    hud.layer.classList.add('wb-hide');
    freezeWorld(true);
    ctx.paused = false;            // let the world animate under the title
    title.show(() => { hud.layer.classList.remove('wb-hide'); freezeWorld(false); });
  }

  // ------------------------------------------------ input
  const gameplayModal = () => !!ctx.systems.gameplay?._hud?.modalOpen;
  addEventListener('keydown', e => {
    if (shotMode) return;
    if (title.active) {
      if (['F5', 'F9', 'F12'].includes(e.code)) return;
      e.preventDefault(); title.start(); return;
    }
    if ((e.defaultPrevented && e.code === 'Escape') || gameplayModal()) return;   // input.js preventDefaults Tab itself
    const k = e.code;
    if (current) {
      if (k === 'Escape') { e.preventDefault(); if (performance.now() - openedAt > 250) close(); return; }
      if (current === 'inventory' && (k === 'Tab' || k === 'KeyI')) { e.preventDefault(); close(); return; }
      if (current === 'map' && k === 'KeyM') { e.preventDefault(); close(); return; }
      if (current === 'map' && k === 'KeyC') { worldMap.center(); return; }
      if (current !== 'map' && (k === 'KeyM')) { open('map'); return; }
      if (current !== 'inventory' && (k === 'Tab' || k === 'KeyI')) { e.preventDefault(); open('inventory'); return; }
      if (screens[current].ctl?.key?.(e)) e.preventDefault();
      return;
    }
    if (ctx.systems.player?.state === 'dead') return;
    if (k === 'Escape') { e.preventDefault(); open('pause'); }
    else if (k === 'Tab' || k === 'KeyI') { e.preventDefault(); open('inventory'); }
    else if (k === 'KeyM') { e.preventDefault(); open('map'); }
  }, false);
  root.addEventListener('mousedown', e => { if (title.active) { e.preventDefault(); title.start(); } });
  let lockedOnce = false;
  document.addEventListener('pointerlockchange', () => {
    const locked = !!document.pointerLockElement;
    if (locked) { lockedOnce = true; return; }
    if (lockedOnce && !current && !title.active && !gameplayModal() && !shotMode) open('pause');
  });
  addEventListener('resize', () => worldMap.resize());

  // other systems' world-reveal moments refresh the chart
  ctx.events.on('spireActivated', () => { md.revealVersion++; });
  ctx.events.on('mapReveal', () => { md.revealVersion++; });
  setInterval(() => md.persist(), 30000);

  applySettings(false);
  if (!shotMode) ctx.events.on('ready', () => showTitle());

  const api = {
    open, close,
    get current() { return current; },
    toast: t => hud.toast(t),
    prompt: (t, k) => hud.prompt(t, k),
    banner: (t, s, k) => hud.banner(t, s, k),
    settings,
    map: md,
    revealDebug(list) { md.debugReveal.push(...list); md.revealVersion++; },
    showTitle,
    debugShot(name) {
      if (name === 'hud') {
        const pl = ctx.systems.player;
        if (pl) pl.health = Math.max(1, (pl.maxHealth || 12) - 3);
        hud.prompt('Pick up Hearthcap');
        hud.toast('Russet Pome ×3');
        hud.toast('Dewleaf');
      }
    },
    update(dt) {
      // UI animates in real time even while the world is frozen
      title.update(dt);
      if (!title.active) hud.update(dt);
      if (current === 'map') worldMap.update(dt);
    },
  };
  return api;
}

// regions shown as charted in screenshots (stands in for having climbed a couple of spires)
const SHOT_REVEAL = [{ x: 330, z: 420, r: 760 }, { x: -420, z: -520, r: 640 }, { x: 760, z: 380, r: 520 }];
