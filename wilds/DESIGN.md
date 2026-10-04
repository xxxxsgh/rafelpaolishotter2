# Windborne — design brief & engineering contract

An original third-person open-world action-adventure in Three.js (WebGL2, no build step).
Everything is original: no names, characters, music, logos, UI layouts or assets from any
existing game. Procedural or hand-written assets only (geometry, shaders, canvas textures,
WebAudio synthesis).

## Art direction ("painterly cel")
- Soft, stylised, hand-painted look: broad colour shapes, gentle 2–3 band toon ramp on
  diffuse with a soft terminator, warm key light / cool sky fill, saturated but not garish.
- Strong aerial perspective: distance fog that shifts hue with time of day; far mountains
  go blue-violet and desaturated. Huge readable silhouettes.
- Thin dark ink outline on characters and props (inverted hull or screen-space edge), none
  on terrain/grass. Rim light on characters.
- Grass is the hero: dense, wind-swept, waves of colour rolling across fields (gust maps),
  tips lighter than roots, ground and grass colours blended so fields read as one surface.
- Skies: gradient + painted cumulus, sun disc with bloom, warm golden hour, starry night
  with a moon, rain/storm with darkened grade and lightning.
- Clean UI: minimal, translucent, thin lines, warm off-white on soft shadow.

## Layout
- `index.html` — entry; importmap maps `three` → `lib/three.module.js`, `three/addons/` → `lib/addons/`
  (vendored three r186 subset; copy more addons from `node_modules/three/examples/jsm` into `lib/addons` if needed).
- `src/main.js` — boot + **system contract** (read it). Systems init in `SYSTEM_ORDER`.
- `src/core/` — engine (renderer, shared uniforms, loop), input, events, noise, debug/shot presets.
- `src/world/heightfield.js` — analytic `getHeight/getNormal/getBiome`, the single source of truth for terrain shape.
- `src/systems/<name>/` — one folder per system; **a system only edits its own folder**
  (plus the shared files listed under its ownership below).

## Ownership
| system | folder | also owns |
|---|---|---|
| sky (sky, weather, day/night, lighting, fog, post FX) | `src/systems/sky` | `ctx.renderFn`, tone mapping |
| terrain (world gen, terrain render, rocks, ruins, landmarks) | `src/systems/terrain` | `src/world/heightfield.js` |
| water (rivers, lakes, ocean, waterfalls) | `src/systems/water` | `src/world/water.js` (getWaterHeight API) |
| vegetation (grass, flowers, trees, bushes, wind) | `src/systems/vegetation` | |
| physics (rigid bodies, puzzle objects, shrines) | `src/systems/physics` | |
| player (character model, animation, camera, climbing, gliding, swimming) | `src/systems/player` | |
| combat (weapons, durability, enemies, camps, AI) | `src/systems/combat` | |
| gameplay (items, cooking, inventory, quests, save) | `src/systems/gameplay` | |
| ui (HUD, menus, map, title) | `src/systems/ui` | `src/ui/style.css` |
| audio (music, ambience, sfx via WebAudio) | `src/systems/audio` | |
| shared | — | `src/core/debug.js` presets: anyone may edit **their own** preset entries |

## Cross-system conventions
- Shared shader uniforms live in `ctx.uniforms` (time, wind, sun, sky/ground colour, fog, rain, wetness, player pos).
  Reference those objects directly in custom shaders. sky writes sun/fog/sky colours; vegetation reads wind.
- Fog (owned by sky): sky patches three's `fog_*` shader chunks, so any material with `fog: true`
  (built-ins, or ShaderMaterials that merge `THREE.UniformsLib.fog` and `#include <fog_pars_*>/<fog_*>`)
  automatically gets height fog, sun in-scatter matching the sky dome, and drifting cloud shadows.
  Prefer that over hand-rolled fog. If you must roll your own: `fog = 1 - exp(-uFogDensity * dist)`, colour `uFogColor`.
  `uSunDir`/`uSunColor` are the key light (sun by day, moon by night); `ctx.systems.sky.getSunDir()` is the true sun.
- `ctx.focus` (Vector3) is the streaming centre — the player keeps it updated.
- `ctx.cameraOverride = {pos, target}` — when set, the player camera must not move the camera.
- Events (`ctx.events`): `damage`, `hit`, `itemPickup`, `cook`, `enemyKilled`, `weaponBroke`, `footstep`,
  `jump`, `land`, `glideStart`, `glideEnd`, `climbStart`, `swimStart`, `lightning`, `shrineSolved`,
  `weatherChange`, `timeChange`. Payloads are plain objects. Add new ones freely; document them here.
- Expose APIs other systems need on your returned api (e.g. `physics.addBody`, `player.position`,
  `water.getWaterHeight(x,z)`, `combat.damagePlayer`), and guard calls to others with `?.` —
  every system must still run if another one failed to init.
- Debug: `window.__game.applyShot(name)`; screenshots via `node tools/shot.mjs <preset...> --out shots/<dir>`.
  `shots/` is git-ignored.
- Performance target: 60 fps on a mid-range laptop GPU at 1080p. Instancing, LOD, chunk streaming,
  frustum culling; no per-frame allocations in hot loops. SwiftShader screenshots are slow — that's fine.
