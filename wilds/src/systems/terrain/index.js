// terrain system — world generation (src/world/heightfield.js), CDLOD terrain rendering,
// rocks, ruins and landmarks. See src/main.js for the contract.
//
// API (ctx.systems.terrain):
//   getHeight(x,z), getNormal(x,z,out), getBiome(x,z), getSurface(x,z)
//   raycast(origin, dir, maxDist=1000) -> {point, normal, distance} | null   (heightfield only)
//   getColliders() -> array of colliders (see colliders.js for shape format)
//   queryColliders(x, z, r, out=[]) -> colliders whose bounds touch the circle
//   settle() -> force-build all LOD chunks for the current camera (teleports)
//   group (THREE.Group of terrain chunks), props (THREE.Group of rocks/ruins)
import { makeNoiseTexture } from './noiseTex.js';
import { makeTerrainMaterials } from './material.js';
import { TerrainLOD } from './quadtree.js';
import { Colliders } from './colliders.js';
import { buildProps } from './props.js';
import { buildRuins } from './ruins.js';

export async function init(ctx) {
  const { THREE, world, camera } = ctx;
  const noiseTex = makeNoiseTexture(THREE);
  const LEVELS = 8;   // root 4096 m -> leaf 32 m (1 m vertex spacing)
  const { mats, camPos } = makeTerrainMaterials(ctx, noiseTex, LEVELS);
  const shotMode = ctx.params?.has?.('shot');
  const lod = new TerrainLOD(ctx, mats, { N: 32, maxDepth: LEVELS - 1, K: 2.4, sync: shotMode });

  const colliders = new Colliders();
  const props = new THREE.Group(); props.name = 'terrain-props';
  ctx.scene.add(props);
  let propApi = null, ruinApi = null;
  try { ruinApi = buildRuins(ctx, { group: props, colliders, noiseTex }); } catch (e) { console.error('[terrain] ruins failed', e); }
  try { propApi = buildProps(ctx, { group: props, colliders, noiseTex, avoid: ruinApi?.sites || [] }); } catch (e) { console.error('[terrain] props failed', e); }

  const tmpN = { x: 0, y: 1, z: 0 };
  function raycast(origin, dir, maxDist = 1000) {
    const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const dx = dir.x / len, dy = dir.y / len, dz = dir.z / len;
    let t = 0, prevT = 0;
    let prevD = origin.y - world.getHeight(origin.x, origin.z);
    if (prevD < 0) return null;
    while (t < maxDist) {
      const step = Math.max(0.25, Math.min(8, prevD * 0.5));
      t = Math.min(maxDist, t + step);
      const x = origin.x + dx * t, y = origin.y + dy * t, z = origin.z + dz * t;
      const d = y - world.getHeight(x, z);
      if (d <= 0) {
        let a = prevT, b = t;
        for (let i = 0; i < 12; i++) {
          const m = (a + b) * 0.5;
          const mx = origin.x + dx * m, mz = origin.z + dz * m;
          if (origin.y + dy * m - world.getHeight(mx, mz) > 0) a = m; else b = m;
        }
        const px = origin.x + dx * b, pz = origin.z + dz * b;
        const point = new THREE.Vector3(px, world.getHeight(px, pz), pz);
        world.getNormal(px, pz, tmpN);
        return { point, normal: new THREE.Vector3(tmpN.x, tmpN.y, tmpN.z), distance: b };
      }
      if (t >= maxDist) break;
      prevT = t; prevD = d;
    }
    return null;
  }

  const api = {
    group: lod.group, props, lod, noiseTex,
    getHeight: world.getHeight, getNormal: world.getNormal, getBiome: world.getBiome, getSurface: world.getSurface,
    raycast,
    getColliders: () => colliders.list,
    queryColliders: (x, z, r, out) => colliders.query(x, z, r, out),
    ruinSites: ruinApi?.sites || [],
    settle() { camPos.value.copy(camera.position); lod.settle(camera.position); },
    update(dt) {
      camPos.value.copy(camera.position);
      if (shotMode && ctx.cameraOverride) {
        camPos.value.copy(ctx.cameraOverride.pos);
        if (!api._settledFor || api._settledFor.distanceToSquared(ctx.cameraOverride.pos) > 1) {
          lod.settle(ctx.cameraOverride.pos);
          api._settledFor = ctx.cameraOverride.pos.clone();
        }
      }
      else if (!shotMode && (!api._lastCam || api._lastCam.distanceToSquared(camPos.value) > 150 * 150)) {
        // first frame / teleport: build the view synchronously so nothing pops in
        lod.settle(camPos.value, 6);
      }
      (api._lastCam ||= new THREE.Vector3()).copy(camPos.value);
      lod.update(camPos.value);
      propApi?.update?.(camPos.value);
    },
  };
  return api;
}
