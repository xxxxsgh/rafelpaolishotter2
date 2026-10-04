// Boot: build ctx, init every system in order, run the loop.
//
// SYSTEM CONTRACT — each src/systems/<name>/index.js exports:
//   export async function init(ctx) { ...; return api }
// where api may include update(dt) (called every frame in SYSTEM_ORDER) and any
// methods other systems need. The api is published as ctx.systems[name].
// A system that throws during init is logged and skipped; the game keeps running.
import * as THREE from 'three';
import { Engine } from './core/engine.js';
import { Input } from './core/input.js';
import { Events } from './core/events.js';
import { world } from './world/heightfield.js';
import { installDebug } from './core/debug.js';

export const SYSTEM_ORDER = [
  'sky',         // sky dome, sun/moon, day-night, weather, lighting, fog, post-processing
  'terrain',     // terrain meshes, LOD, materials, rocks, ruins placement
  'water',       // rivers, lakes, ocean, waterfalls
  'vegetation',  // grass, flowers, trees, wind
  'physics',     // rigid bodies, colliders, puzzle objects, shrines
  'player',      // character, animation, camera, climbing, gliding, swimming
  'combat',      // weapons, durability, enemies, camps, AI
  'gameplay',    // items, cooking, inventory, quests, save
  'ui',          // HUD, menus, map
  'audio',       // music, ambience, sfx
];

async function boot() {
  const canvas = document.getElementById('game');
  const engine = new Engine(canvas);
  const ctx = {
    THREE, engine,
    scene: engine.scene, camera: engine.camera, renderer: engine.renderer,
    uniforms: engine.uniforms,
    params: engine.params,
    input: new Input(canvas),
    events: new Events(),
    world,
    systems: {},
    hud: document.getElementById('hud'),
    focus: new THREE.Vector3(0, 0, 0),   // streaming centre; player keeps it updated
    paused: false,
  };
  window.__ctx = ctx;

  for (const name of SYSTEM_ORDER) {
    try {
      const mod = await import(`./systems/${name}/index.js`);
      const api = (await mod.init(ctx)) || {};
      ctx.systems[name] = api;
      if (api.update) engine.add(name, dt => api.update(dt));
    } catch (e) {
      console.error(`[${name}] init failed`, e);
    }
  }

  installDebug(ctx);
  const boot = document.getElementById('boot');
  if (boot && ctx.shotMode) boot.remove();
  else if (boot) { boot.style.opacity = 0; setTimeout(() => boot.remove(), 900); }
  ctx.events.emit('ready', ctx);
  window.__ready = true;
  engine.start(null, () => ctx.input.endFrame());
}

boot();
