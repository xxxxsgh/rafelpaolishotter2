// Rocks, boulders, crags, standing stones and big rock formations.
// Chiselled procedural rock meshes (convex plane-cut + noise), instanced per variant and
// streamed: every few metres of camera movement the instance buffers are refilled with
// only the rocks within view range (big ones far, pebbles near), nearest first.
import { mulberry32, Simplex } from '../../core/noise.js';
import { makePropMaterial } from './propMaterial.js';

function rockGeometry(THREE, seed, { planes = 11, squash = [1, 1, 1], noise = 0.08, detail = 3, sharp = 0.75 } = {}) {
  const rand = mulberry32(seed);
  const sn = new Simplex(seed);
  const g = new THREE.IcosahedronGeometry(1, detail);
  const pos = g.attributes.position;
  const P = [];
  for (let i = 0; i < planes; i++) {
    const u = rand() * 2 - 1, a = rand() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    P.push([s * Math.cos(a), u * 0.85 + (i === 0 ? 0 : 0), s * Math.sin(a), 0.72 + rand() * 0.25]);
  }
  P.push([0, -1, 0, 0.45]); // flat base
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    let r = 1.0;
    for (const [nx, ny, nz, d] of P) {
      const dd = v.x * nx + v.y * ny + v.z * nz;
      if (dd > 1e-3) r = Math.min(r, d / dd);
    }
    r = 1.0 * (1 - sharp) + r * sharp;
    r *= 1 + noise * sn.noise3(v.x * 2.1, v.y * 2.1, v.z * 2.1) + noise * 0.4 * sn.noise3(v.x * 5, v.y * 5, v.z * 5);
    pos.setXYZ(i, v.x * r * squash[0], v.y * r * squash[1], v.z * r * squash[2]);
  }
  g.computeVertexNormals();
  // vertex colour: darker toward the base (ground AO), slight per-facet value variation
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / squash[1];
    const c = 0.72 + 0.28 * Math.min(1, Math.max(0, (y + 0.45) / 0.9)) + (sn.noise3(pos.getX(i) * 3, pos.getY(i) * 3, pos.getZ(i) * 3)) * 0.05;
    col[i * 3] = c; col[i * 3 + 1] = c; col[i * 3 + 2] = c;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

export function buildProps(ctx, { group, colliders, noiseTex, avoid = [] }) {
  const { THREE, world } = ctx;
  const mat = makePropMaterial(ctx, noiseTex, { kind: 'rock' });
  const variants = [
    { name: 'boulder', geo: rockGeometry(THREE, 1, { planes: 12, squash: [1, 0.8, 1] }) },
    { name: 'boulder2', geo: rockGeometry(THREE, 2, { planes: 9, squash: [1.2, 0.7, 0.9], noise: 0.1 }) },
    { name: 'flat', geo: rockGeometry(THREE, 3, { planes: 10, squash: [1.4, 0.45, 1.1] }) },
    { name: 'crag', geo: rockGeometry(THREE, 4, { planes: 8, squash: [0.7, 1.9, 0.75], noise: 0.12, sharp: 0.9 }) },
    { name: 'slab', geo: rockGeometry(THREE, 5, { planes: 7, squash: [0.6, 1.6, 0.28], noise: 0.06, sharp: 0.95 }) },
    { name: 'spire', geo: rockGeometry(THREE, 6, { planes: 9, squash: [0.55, 3.2, 0.6], noise: 0.14, sharp: 0.9 }) },
  ];
  const V = Object.fromEntries(variants.map((v, i) => [v.name, i]));
  const items = [];   // {v, x, y, z, s(vec3), yaw, tx, tz, col, range}
  const rand = mulberry32(9001);
  const nrm = { x: 0, y: 1, z: 0 };
  const surf = {};
  const blocked = (x, z, pad) => avoid.some(s => (s.x - x) ** 2 + (s.z - z) ** 2 < (s.r + pad) ** 2);
  const mesaTint = new THREE.Color(0xd99060), alpTint = new THREE.Color(0xc8ccd2), baseTint = new THREE.Color(1, 1, 1);

  function add(v, x, z, scale, opts = {}) {
    const y = world.getHeight(x, z);
    if (y < -1) return;
    const sx = scale * (opts.sx ?? (0.85 + rand() * 0.3)), sy = scale * (opts.sy ?? (0.8 + rand() * 0.4)), sz = scale * (opts.sz ?? (0.85 + rand() * 0.3));
    world.getNormal(x, z, nrm);
    const lean = opts.lean ?? 0.6;
    const it = {
      v, x, y: y - scale * (opts.sink ?? 0.12), z, sx, sy, sz, yaw: rand() * Math.PI * 2,
      tx: (opts.tx ?? nrm.z * lean) + (rand() - 0.5) * 0.15, tz: (opts.tz ?? -nrm.x * lean) + (rand() - 0.5) * 0.15,
      col: opts.col || baseTint, range: Math.min(2600, 280 + scale * scale * 60 + (opts.landmark ? 3000 : 0)),
    };
    items.push(it);
    const r = Math.max(sx, sz) * 0.85;
    if (scale > 0.6) {
      if (v === V.crag || v === V.slab || v === V.spire) colliders.add({ type: 'cylinder', kind: 'rock', x, z, y: it.y + sy * 0.9, r: r * 0.8, hy: sy });
      else colliders.add({ type: 'sphere', kind: 'rock', x, y: it.y + sy * 0.25, z, r });
    }
    return it;
  }

  // scattered placement over the island
  const CELL = 16;
  for (let gz = -1700; gz < 1700; gz += CELL) {
    for (let gx = -1800; gx < 1800; gx += CELL) {
      const x = gx + rand() * CELL, z = gz + rand() * CELL;
      const r0 = rand();
      if (r0 > 0.13) continue;
      const h = world.getHeight(x, z);
      if (h < 0.5) continue;
      world.getSurface(x, z, surf);
      world.getNormal(x, z, nrm);
      const slope = 1 - nrm.y;
      const biome = world.getBiome(x, z);
      let p = 0.004;
      if (biome === 'forest') p = 0.018;
      if (biome === 'alpine') p = 0.05;
      if (biome === 'snow') p = 0.02;
      if (biome === 'mesa') p = 0.03;
      if (biome === 'shore') p = 0.02;
      if (slope > 0.12 && slope < 0.4) p += 0.05 * surf.rock + 0.02;   // talus at cliff feet
      if (world.getRiverMask(x, z) > 0.1) p = 0.0;
      else if ((world.getRiverInfo(x, z)?.dist ?? 999) < 22) p += 0.03; // river boulders on banks
      if (r0 > p) continue;
      if (blocked(x, z, 6)) continue;
      const tint = biome === 'mesa' ? mesaTint : (biome === 'alpine' || biome === 'snow') ? alpTint : baseTint;
      const big = rand();
      const s = big > 0.96 ? 3 + rand() * 3 : big > 0.75 ? 1.4 + rand() * 1.4 : 0.4 + rand() * 0.9;
      const v = slope > 0.25 && rand() < 0.5 ? V.crag : [V.boulder, V.boulder2, V.flat][Math.floor(rand() * 3)];
      add(v, x, z, s, { col: tint });
      // cluster of smaller rocks
      const nSmall = Math.floor(rand() * (s > 1.5 ? 6 : 3));
      for (let k = 0; k < nSmall; k++) {
        const a = rand() * Math.PI * 2, d = s * (1.1 + rand() * 1.6);
        add([V.boulder, V.boulder2, V.flat][Math.floor(rand() * 3)], x + Math.cos(a) * d, z + Math.sin(a) * d, s * (0.15 + rand() * 0.3), { col: tint });
      }
    }
  }

  // landmark formations
  const F = world.FEATURES || {};
  // (a) "giant's marbles" — huge rounded boulders on the plateau meadow
  if (F.PLATEAU) {
    const cx = F.PLATEAU.x - 210, cz = F.PLATEAU.z + 160;
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4, d = 6 + i * 3.5;
      add(i % 2 ? V.boulder : V.boulder2, cx + Math.cos(a) * d, cz + Math.sin(a) * d, 4 + rand() * 5, { landmark: true, lean: 0.1 });
    }
  }
  // (b) spires in the mesa country
  if (F.MESA) {
    for (let i = 0; i < 26; i++) {
      const a = rand() * Math.PI * 2, d = 120 + rand() * 380;
      const x = F.MESA.x + Math.cos(a) * d, z = F.MESA.z + Math.sin(a) * d;
      if ((world.getRiverInfo(x, z)?.dist ?? 999) < 30 || world.getHeight(x, z) < 2) continue;
      add(V.spire, x, z, 6 + rand() * 9, { col: mesaTint, landmark: true, lean: 0.05, sink: 0.25 });
      for (let k = 0; k < 4; k++) add(V.crag, x + (rand() - 0.5) * 20, z + (rand() - 0.5) * 20, 2 + rand() * 3, { col: mesaTint });
    }
  }
  // (c) standing stones dotted along ridgelines of the lowlands (single menhirs)
  for (let i = 0, placed = 0; i < 400 && placed < 18; i++) {
    const x = (rand() - 0.5) * 2800, z = (rand() - 0.2) * 2400;
    const h = world.getHeight(x, z);
    if (h < 10 || h > 160) continue;
    world.getNormal(x, z, nrm); if (nrm.y < 0.95) continue;
    // must be locally high
    if (world.getHeight(x + 40, z) > h || world.getHeight(x - 40, z) > h || world.getHeight(x, z + 40) > h || world.getHeight(x, z - 40) > h) continue;
    if (blocked(x, z, 20)) continue;
    add(V.slab, x, z, 2.2 + rand() * 1.5, { lean: 0.05, sink: 0.2, landmark: true });
    placed++;
  }
  // (d) jagged crag clusters along the mountain foothills
  if (F.SPINE) {
    for (let i = 0; i < 60; i++) {
      const seg = Math.floor(rand() * (F.SPINE.length - 1));
      const t = rand(), a = F.SPINE[seg], b = F.SPINE[seg + 1];
      const side = 250 + rand() * 300;
      const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
      const x = a[0] + dx * t - dz / l * side, z = a[1] + dz * t + dx / l * side;
      const h = world.getHeight(x, z);
      if (h < 20) continue;
      add(V.crag, x, z, 4 + rand() * 6, { col: alpTint, landmark: true, lean: 0.3 });
    }
  }

  // ---- instanced, streamed rendering
  const byVar = variants.map(() => []);
  for (const it of items) byVar[it.v].push(it);
  const meshes = variants.map((vr, i) => {
    const m = new THREE.InstancedMesh(vr.geo, mat, Math.max(1, byVar[i].length));
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, byVar[i].length) * 3), 3);
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.count = 0; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
    m.name = 'rocks-' + vr.name;
    group.add(m);
    return m;
  });
  // precompute matrices
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
  for (const it of items) {
    e.set(it.tx, it.yaw, it.tz, 'XYZ'); q.setFromEuler(e);
    mtx.compose(p.set(it.x, it.y, it.z), q, s.set(it.sx, it.sy, it.sz));
    it.m = mtx.toArray(new Float32Array(16));
  }
  const last = new THREE.Vector3(1e9, 0, 0);
  const lists = variants.map(() => []);
  function refresh(cam) {
    for (let v = 0; v < variants.length; v++) {
      const src = byVar[v], mesh = meshes[v], arr = mesh.instanceMatrix.array, carr = mesh.instanceColor.array;
      let n = 0;
      for (let i = 0; i < src.length; i++) {
        const it = src[i];
        const d2 = (it.x - cam.x) ** 2 + (it.z - cam.z) ** 2;
        if (d2 > it.range * it.range) continue;
        arr.set(it.m, n * 16);
        carr[n * 3] = it.col.r; carr[n * 3 + 1] = it.col.g; carr[n * 3 + 2] = it.col.b;
        n++;
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    }
  }
  return {
    items, meshes, count: items.length,
    update(cam) {
      if (last.distanceToSquared(cam) < 64) return;
      last.copy(cam);
      refresh(cam);
    },
  };
}
