// Windstone Spires (climbable viewpoint towers that reveal the map) and the Summit Beacon
// (the main quest's final goal). Both add static colliders by extending the terrain's
// collider query (same shape format), so the hero can climb the spires and stand on top.
import * as THREE from 'three';
import { spireGeometry, beaconGeometry } from './models.js';
import { toonMesh } from './toon.js';
import { makeFlame } from './fx.js';

export const SPIRE_SITES = [
  { id: 'plateau', name: 'Meadowheart Spire', target: [330, 420], reveal: 760 },
  { id: 'wildwood', name: 'Wildwood Spire', target: [-760, 600], reveal: 760 },
  { id: 'redrock', name: 'Redrock Spire', target: [820, 560], reveal: 760 },
  { id: 'highmoor', name: 'Highmoor Spire', target: [-420, -620], reveal: 760 },
];

const BEAM_VERT = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const BEAM_FRAG = /* glsl */`uniform float uTime; uniform float uAmt; uniform vec3 uCol; varying vec2 vUv;
void main(){
  float edge = pow(sin(vUv.x * 3.14159), 2.0);
  float fall = pow(1.0 - vUv.y, 1.6);
  float flow = 0.75 + 0.25 * sin(vUv.y * 40.0 - uTime * 3.0 + vUv.x * 6.0);
  gl_FragColor = vec4(uCol * edge * fall * flow * uAmt, 1.0);
}`;

function findFlat(world, x, z, maxR = 60, minNy = 0.9) {
  const n = { x: 0, y: 1, z: 0 };
  let best = null, bs = -1;
  for (let r = 0; r <= maxR; r += 4) {
    const na = r === 0 ? 1 : Math.max(8, Math.round(r * 0.8));
    for (let i = 0; i < na; i++) {
      const a = i / na * Math.PI * 2, qx = x + Math.cos(a) * r, qz = z + Math.sin(a) * r;
      const h = world.getHeight(qx, qz);
      if (h < 2) continue;
      if ((world.getWaterSurface?.(qx, qz) ?? -1e9) > h - 0.2) continue;
      let flat = 1;
      for (let k = 0; k < 6; k++) { const b = k / 6 * 6.28; world.getNormal(qx + Math.cos(b) * 4, qz + Math.sin(b) * 4, n); flat = Math.min(flat, n.y); }
      const score = flat - r * 0.0015;
      if (flat > minNy) return { x: qx, z: qz, h };
      if (score > bs) { bs = score; best = { x: qx, z: qz, h }; }
    }
  }
  return best || { x, z, h: world.getHeight(x, z) };
}

export function createLandmarks(ctx, res) {
  const { scene, world, events } = ctx;
  const root = new THREE.Group(); root.name = 'gameplay-landmarks'; scene.add(root);
  const colliders = [];
  const spires = [];
  const crystalMatOff = res.makeToon({ rim: 1.2, emitColor: 0x8aa0b0 });
  const crystalMatOn = res.makeToon({ rim: 1.4, emitColor: 0xbff4ff, emitBoost: 1.2 });

  SPIRE_SITES.forEach((def, i) => {
    const spot = findFlat(world, def.target[0], def.target[1], 80);
    const g = spireGeometry(i + 3);
    const grp = new THREE.Group();
    grp.position.set(spot.x, spot.h - 0.4, spot.z);
    grp.rotation.y = i * 0.7;
    grp.add(toonMesh(ctx, g.body, res.mat, res.outline));
    const crystal = new THREE.Mesh(g.crystal, crystalMatOff);
    crystal.position.y = g.crystalY; crystal.castShadow = true;
    grp.add(crystal);
    root.add(grp);
    const base = spot.h - 0.4;
    const s = { ...def, x: spot.x, z: spot.z, y: base, top: base + g.topY + 0.25, group: grp, crystal, crystalY: g.crystalY, active: false, t: i };
    spires.push(s);
    colliders.push({ type: 'cylinder', x: spot.x, y: base + 0.5, z: spot.z, r: 3.9, hy: 1.0, kind: 'spire' });
    colliders.push({ type: 'cylinder', x: spot.x, y: base + 1.3 + g.height / 2, z: spot.z, r: 1.75, hy: g.height / 2, kind: 'spire' });
    colliders.push({ type: 'cylinder', x: spot.x, y: base + g.topY, z: spot.z, r: 2.6, hy: 0.25, kind: 'spire' });
  });

  // ---------------- summit beacon
  let bx = -260, bz = -1290, bh = -1e9;
  const F = world.FEATURES?.SUMMIT; if (F) { bx = F.x; bz = F.z; }
  { // climb to the local maximum, then find a flat-ish shoulder for the plinth
    const n = { x: 0, y: 1, z: 0 };
    let cx = bx, cz = bz;
    for (let step = 40; step >= 2; step /= 2) for (let it = 0; it < 12; it++) {
      let best = world.getHeight(cx, cz), bxx = cx, bzz = cz;
      for (let k = 0; k < 8; k++) { const a = k / 8 * 6.28; const h = world.getHeight(cx + Math.cos(a) * step, cz + Math.sin(a) * step); if (h > best) { best = h; bxx = cx + Math.cos(a) * step; bzz = cz + Math.sin(a) * step; } }
      if (bxx === cx && bzz === cz) break;
      cx = bxx; cz = bzz;
    }
    bx = cx; bz = cz; bh = world.getHeight(cx, cz);
    world.getNormal(cx, cz, n);
  }
  const bg = beaconGeometry();
  const beacon = { x: bx, z: bz, y: bh - 1.2, lit: false, group: new THREE.Group(), t: 0, flames: [] };
  beacon.group.position.set(bx, bh - 1.2, bz);
  beacon.group.add(toonMesh(ctx, bg.geo, res.mat, res.outline));
  root.add(beacon.group);
  for (let i = 0; i < 5; i++) {
    const f = makeFlame(ctx, { scale: i === 0 ? 7 : 4.5, seed: i * 1.9, hot: 0xfff8d0, mid: 0xffb040, cool: 0xe0501a });
    const a = i * 1.3; f.position.set(i ? Math.cos(a) * 0.9 : 0, bg.fireY, i ? Math.sin(a) * 0.9 : 0);
    f.visible = false; beacon.group.add(f); beacon.flames.push(f);
  }
  // ember glow before it is lit: small flame
  const ember = makeFlame(ctx, { scale: 1.4, seed: 7, hot: 0xffd090, mid: 0xff7a2a, cool: 0x9a2a10 });
  ember.position.set(0, bg.fireY - 0.2, 0); beacon.group.add(ember);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 6, 900, 16, 1, true), new THREE.ShaderMaterial({
    uniforms: { uTime: ctx.uniforms.uTime, uAmt: { value: 0 }, uCol: { value: new THREE.Color(1.0, 0.72, 0.38) } },
    vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  }));
  beam.position.y = bg.fireY + 450; beam.visible = false; beam.frustumCulled = false; beam.renderOrder = 14;
  beacon.group.add(beam);
  beacon.fireY = bg.fireY;
  beacon.light = res.lights?.add({ position: new THREE.Vector3(bx, bh - 1.2 + bg.fireY + 2, bz), color: 0xff9a40, radius: 34, intensity: 2.4, haze: 0.05 });
  if (beacon.light) beacon.light.on = false;
  colliders.push({ type: 'cylinder', x: bx, y: bh - 1.2 + 1.2, z: bz, r: 6.5, hy: 1.6, kind: 'beacon' });
  colliders.push({ type: 'cylinder', x: bx, y: bh - 1.2 + bg.fireY - 0.8, z: bz, r: 2.2, hy: 1.4, kind: 'beacon' });

  // ---------------- colliders: extend the terrain query (player + physics both go through it)
  const T = ctx.systems.terrain;
  if (T?.queryColliders && !T.__gameplayPatched) {
    const orig = T.queryColliders;
    T.queryColliders = (x, z, r, out) => {
      const a = orig(x, z, r, out) || out || [];
      for (let i = 0; i < colliders.length; i++) {
        const c = colliders[i];
        const rr = c.r + r;
        if ((c.x - x) ** 2 + (c.z - z) ** 2 <= rr * rr) a.push(c);
      }
      return a;
    };
    T.__gameplayPatched = true;
  }
  // keep grass / trees off the plinths
  if (world.getPathMask && !world.__gameplayLandmarkPatched) {
    const orig = world.getPathMask;
    world.getPathMask = (x, z) => {
      let m = orig(x, z);
      for (const s of spires) { const d2 = (x - s.x) ** 2 + (z - s.z) ** 2; if (d2 < 36) m = Math.max(m, 1 - Math.sqrt(d2) / 6 * 0.4); }
      return m;
    };
    world.__gameplayLandmarkPatched = true;
  }

  function activate(s, silent = false) {
    if (s.active) return false;
    s.active = true;
    s.crystal.material = crystalMatOn;
    if (!silent) {
      const p = new THREE.Vector3(s.x, s.y + s.crystalY, s.z);
      for (let i = 0; i < 60; i++) { const a = Math.random() * 6.28, sp = 3 + Math.random() * 6; res.add.spawn({ x: p.x, y: p.y, z: p.z, vx: Math.cos(a) * sp, vy: (Math.random() - 0.3) * 5, vz: Math.sin(a) * sp, life: 1.6 + Math.random(), size: 0.5, size1: 0.05, r: 0.6, g: 0.95, b: 1, a: 1, cell: 2, drag: 1.5, grav: 0.5, spin: 2 }); }
      events.emit('spireActivated', { id: s.id, name: s.name, position: p });
    }
    events.emit('mapReveal', { id: s.id, name: s.name, x: s.x, z: s.z, r: s.reveal });
    return true;
  }
  function lightBeacon(silent = false) {
    if (beacon.lit) return false;
    beacon.lit = true;
    for (const f of beacon.flames) f.visible = true;
    ember.visible = false; beam.visible = true;
    if (beacon.light) beacon.light.on = true;
    if (!silent) events.emit('beaconLit', { position: new THREE.Vector3(beacon.x, beacon.y + beacon.fireY, beacon.z) });
    return true;
  }

  let emitAcc = 0;
  return {
    spires, beacon, colliders, activate, lightBeacon,
    nearestSpireTop(pos) {
      for (const s of spires) {
        if (s.active) continue;
        const d2 = (pos.x - s.x) ** 2 + (pos.z - s.z) ** 2;
        if (d2 < 3.2 * 3.2 && pos.y > s.top - 1.5 && pos.y < s.top + 3) return s;
      }
      return null;
    },
    nearBeacon(pos) { return (pos.x - beacon.x) ** 2 + (pos.z - beacon.z) ** 2 < 9 * 9 && pos.y > beacon.y - 3; },
    update(dt) {
      const cp = ctx.camera.position;
      for (const s of spires) {
        s.t += dt;
        const near = (cp.x - s.x) ** 2 + (cp.z - s.z) ** 2 < 1500 * 1500;
        s.group.visible = near;
        if (!near) continue;
        s.crystal.rotation.y += dt * (s.active ? 0.9 : 0.25);
        s.crystal.position.y = s.crystalY + Math.sin(s.t * 1.3) * (s.active ? 0.25 : 0.08);
      }
      beacon.t += dt;
      const bd2 = (cp.x - beacon.x) ** 2 + (cp.z - beacon.z) ** 2;
      if (beacon.lit) {
        beam.material.uniforms.uAmt.value = 0.55 + 0.1 * Math.sin(beacon.t * 1.7);
        for (let i = 0; i < beacon.flames.length; i++) beacon.flames[i].material.uniforms.uScale.value = (i === 0 ? 7 : 4.5) * (1 + 0.07 * Math.sin(beacon.t * (5 + i) + i));
        if (bd2 < 250 * 250) {
          emitAcc += dt * 20;
          while (emitAcc > 1) { emitAcc--; const a = Math.random() * 6.28, r = Math.random() * 1.6; res.add.spawn({ x: beacon.x + Math.cos(a) * r, y: beacon.y + beacon.fireY + 1, z: beacon.z + Math.sin(a) * r, vx: (Math.random() - 0.5) * 2, vy: 4 + Math.random() * 4, vz: (Math.random() - 0.5) * 2, life: 2 + Math.random() * 2, size: 0.25, size1: 0.05, r: 1, g: 0.75, b: 0.35, a: 1, cell: 1, drag: 0.6, grav: -0.5 }); }
        }
      }
    },
    serialize() { return { spires: spires.filter(s => s.active).map(s => s.id), beacon: beacon.lit }; },
    restore(o) { for (const id of o?.spires || []) { const s = spires.find(q => q.id === id); if (s) activate(s, true); } if (o?.beacon) lightBeacon(true); },
  };
}
