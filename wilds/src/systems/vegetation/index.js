// vegetation system — grass, wildflowers, reeds, ferns, bushes, trees and wind.
// See src/main.js for the contract and DESIGN.md for ownership.
//
// API (ctx.systems.vegetation):
//   update(dt)
//   getTreeColliders(x, z, r, out=[]) -> [{x, z, y, r, h, id}] trunks near a point (cylinders)
//   getTreeColliders()               -> every currently-streamed trunk collider
//   cutTree(id | {x,z}) -> bool       fells a tree (hides it, emits 'treeCut' {x,z,species})
//   field                             camera-centred height/suitability map (FieldMap)
//   group                             THREE.Group root of every vegetation mesh
//   quality                           0.5 .. 1.5 density scale (read at init via ?veg=)
// Events emitted: 'treeCut' {x, y, z, species}.
import * as THREE from 'three';
import { FieldMap } from './fieldmap.js';
import { createGroundCover } from './groundcover.js';
import { makeNoiseTexture } from './common.js';
import { createTrees } from './trees.js';

export async function init(ctx) {
  const { scene, world, camera } = ctx;
  const quality = Math.max(0.25, Math.min(2, +(ctx.params.get('veg') || 1)));
  const noiseTex = ctx.systems.terrain?.noiseTex || makeNoiseTexture();
  const group = new THREE.Group(); group.name = 'vegetation';
  scene.add(group);

  const field = new FieldMap(world);
  const startPos = ctx.cameraOverride?.pos || ctx.focus || camera.position;
  field.rebuild(startPos.x, startPos.z);

  let layers = [];
  try {
    layers = createGroundCover(ctx, field, noiseTex, quality);
    for (const l of layers) group.add(l.group);
  } catch (e) { console.error('[vegetation] ground cover failed', e); }

  let trees = null;
  try {
    trees = createTrees(ctx, { noiseTex, group, quality });
  } catch (e) { console.error('[vegetation] trees failed', e); }

  const shotMode = ctx.params.has('shot');
  const camPos = new THREE.Vector3();

  const api = {
    group, field, quality, trees,
    getTreeColliders: (x, z, r, out) => trees ? trees.getColliders(x, z, r, out) : (out || []),
    cutTree: (q) => trees ? trees.cutTree(q) : false,
    update(dt) {
      // stream around the camera (ground cover is view dependent) and the focus (trees)
      camPos.copy(ctx.cameraOverride?.pos || camera.position);
      if (shotMode && ctx.cameraOverride) {
        camera.position.copy(ctx.cameraOverride.pos);
        camera.lookAt(ctx.cameraOverride.target);
        camera.updateMatrixWorld();
      }
      // keep the shared player position fresh for grass bending (player may also write it)
      const pp = ctx.systems.player?.position;
      if (pp && pp.isVector3) ctx.uniforms.uPlayerPos.value.copy(pp);
      field.update(camPos.x, camPos.z, shotMode ? 1e9 : 1.5);
      if (!late) lateUpdate(dt);
    },
  };
  // View-dependent culling runs after every system has moved the camera this frame
  // (the player updates after us), so instance lists never lag a frame behind.
  let late = false;
  function lateUpdate(dt) {
    camPos.copy(ctx.cameraOverride?.pos || camera.position);
    for (const l of layers) l.update(camera);
    trees?.update(dt, camPos, camera);
  }
  ctx.events.on('ready', () => {
    late = true;
    ctx.engine.add('vegetation-late', dt => lateUpdate(dt));
  });
  return api;
}
