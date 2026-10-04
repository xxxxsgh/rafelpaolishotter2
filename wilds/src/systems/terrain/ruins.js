// Procedural ancient ruins: crumbling masonry walls, broken colonnades, arches, a ruined
// citadel with a tall broken tower, a stone circle, a watchtower and scattered fragments.
// Every site is one merged, vertex-coloured mesh (one draw call) built from jittered
// stone blocks that sit on the terrain; colliders are registered per structural piece.
import { mulberry32 } from '../../core/noise.js';
import { makePropMaterial } from './propMaterial.js';

// --------------------------------------------------------------------------------------
// geometry accumulation
class Builder {
  constructor(rand) { this.p = []; this.n = []; this.c = []; this.rand = rand; }
  // Oriented, slightly irregular block. (cx,cy,cz) centre, half sizes, yaw, pitch/roll tilt.
  block(cx, cy, cz, hx, hy, hz, yaw = 0, tint = 1, tiltX = 0, tiltZ = 0, jit = 0.07) {
    const r = this.rand;
    const corners = [];
    for (let k = 0; k < 8; k++) {
      const sx = (k & 1) ? 1 : -1, sy = (k & 2) ? 1 : -1, sz = (k & 4) ? 1 : -1;
      // chipped corners: pull each corner in a little, more on top
      const j = jit * (sy > 0 ? 1.4 : 0.6);
      corners.push([sx * hx * (1 - r() * j), sy * hy * (1 - r() * j * 0.6), sz * hz * (1 - r() * j)]);
    }
    const cy_ = Math.cos(yaw), sy_ = Math.sin(yaw), cxr = Math.cos(tiltX), sxr = Math.sin(tiltX), czr = Math.cos(tiltZ), szr = Math.sin(tiltZ);
    const W = corners.map(([x, y, z]) => {
      // tilt about X then Z, then yaw
      let y1 = y * cxr - z * sxr, z1 = y * sxr + z * cxr;
      let x2 = x * czr - y1 * szr, y2 = x * szr + y1 * czr;
      return [cx + x2 * cy_ + z1 * sy_, cy + y2, cz - x2 * sy_ + z1 * cy_];
    });
    const faces = [[0, 4, 6, 2], [1, 3, 7, 5], [0, 1, 5, 4], [2, 6, 7, 3], [0, 2, 3, 1], [4, 5, 7, 6]];
    const shade = tint * (0.86 + r() * 0.28);
    const warm = (r() - 0.5) * 0.08;
    for (const f of faces) {
      const a = W[f[0]], b = W[f[1]], c = W[f[2]], d = W[f[3]];
      const ux = c[0] - a[0], uy = c[1] - a[1], uz = c[2] - a[2];
      const vx = d[0] - b[0], vy = d[1] - b[1], vz = d[2] - b[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      for (const v of [a, b, c, a, c, d]) {
        this.p.push(v[0], v[1], v[2]); this.n.push(nx, ny, nz);
        this.c.push(shade * (1 + warm), shade, shade * (1 - warm));
      }
    }
  }
  // wedge/cylinder drum (n-gon prism) for columns
  drum(cx, cy, cz, r0, r1, hy, seg = 10, tint = 1, tiltX = 0, tiltZ = 0, rot = 0) {
    const r = this.rand;
    const shade = tint * (0.88 + r() * 0.22);
    const top = [], bot = [];
    const cxr = Math.cos(tiltX), sxr = Math.sin(tiltX), czr = Math.cos(tiltZ), szr = Math.sin(tiltZ);
    const tf = (x, y, z) => {
      let y1 = y * cxr - z * sxr, z1 = y * sxr + z * cxr;
      return [cx + x * czr - y1 * szr, cy + x * szr + y1 * czr, cz + z1];
    };
    for (let i = 0; i < seg; i++) {
      const a = rot + i / seg * Math.PI * 2;
      const jt = 1 - r() * 0.06, jb = 1 - r() * 0.03;
      top.push(tf(Math.cos(a) * r1 * jt, hy, Math.sin(a) * r1 * jt));
      bot.push(tf(Math.cos(a) * r0 * jb, -hy, Math.sin(a) * r0 * jb));
    }
    const push = (v, n, s) => { this.p.push(v[0], v[1], v[2]); this.n.push(n[0], n[1], n[2]); this.c.push(s, s, s * 0.98); };
    const ctop = tf(0, hy, 0), cbot = tf(0, -hy, 0);
    const up = [ctop[0] - cbot[0], ctop[1] - cbot[1], ctop[2] - cbot[2]]; const ul = Math.hypot(...up); up[0] /= ul; up[1] /= ul; up[2] /= ul;
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      // side (smooth-ish normals: radial)
      const mx = (top[i][0] + top[j][0] + bot[i][0] + bot[j][0]) / 4 - (ctop[0] + cbot[0]) / 2;
      const mz = (top[i][2] + top[j][2] + bot[i][2] + bot[j][2]) / 4 - (ctop[2] + cbot[2]) / 2;
      const ml = Math.hypot(mx, mz) || 1; const n = [mx / ml, 0, mz / ml];
      const s = shade * (0.94 + (i % 2) * 0.08); // fluting
      push(bot[i], n, s); push(top[j], n, s); push(bot[j], n, s);
      push(bot[i], n, s); push(top[i], n, s); push(top[j], n, s);
      push(ctop, up, shade); push(top[j], up, shade); push(top[i], up, shade);
      push(cbot, [-up[0], -up[1], -up[2]], shade); push(bot[i], [-up[0], -up[1], -up[2]], shade); push(bot[j], [-up[0], -up[1], -up[2]], shade);
    }
  }
  geometry(THREE) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

// --------------------------------------------------------------------------------------
// structure generators. `H(x,z)` = terrain height.
function wall(B, H, col, x0, z0, x1, z1, height, thick, opts = {}) {
  const r = B.rand;
  const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
  const ux = dx / len, uz = dz / len, yaw = Math.atan2(-uz, ux);
  const courseH = opts.courseH ?? 0.62;
  const broken = opts.broken ?? 0.6;
  const phase = r() * 100;
  let minG = Infinity, sumTop = 0, cnt = 0;
  const nCourse = Math.ceil(height / courseH);
  for (let c = 0; c < nCourse; c++) {
    let t = (c % 2) * 0.6 - r() * 0.3;
    while (t < len) {
      const bl = Math.min(1.1 + r() * 0.9, len - t + 0.01);
      if (bl < 0.3) break;
      const tm = t + bl / 2;
      const px = x0 + ux * tm, pz = z0 + uz * tm;
      const g = H(px, pz);
      if (c === 0) minG = Math.min(minG, g);
      // broken top profile: smooth noise along the wall + a couple of breaches
      const prof = 0.5 + 0.5 * Math.sin(tm * 0.35 + phase) * Math.sin(tm * 0.13 + phase * 2) + (r() - 0.5) * 0.25;
      const localH = height * (1 - broken * (1 - prof));
      const by = g - 0.35 + c * courseH + courseH / 2;
      if (c * courseH < localH && !(c > 1 && r() < 0.05)) {
        const inset = c * 0.012;
        B.block(px, by, pz, bl / 2 - 0.02, courseH / 2 - 0.015, thick / 2 - inset, yaw, col * (c < 2 ? 0.92 : 1), (r() - 0.5) * 0.02, (r() - 0.5) * 0.02);
        if (c === Math.floor(localH / courseH)) { sumTop += by; cnt++; }
      } else if (c * courseH < height && r() < 0.18) {
        // fallen block lying near the wall
        const side = r() < 0.5 ? -1 : 1, off = thick + 0.5 + r() * 2.5;
        const fx = px - uz * side * off + (r() - 0.5), fz = pz + ux * side * off + (r() - 0.5);
        B.block(fx, H(fx, fz) + courseH * 0.3, fz, bl / 2, courseH / 2, thick / 2.2, yaw + (r() - 0.5) * 1.2, col * 0.9, (r() - 0.5) * 0.5, (r() - 0.5) * 0.5);
      }
      t += bl;
    }
  }
  return { x: (x0 + x1) / 2, z: (z0 + z1) / 2, yaw, len, height, thick, base: minG };
}

function column(B, H, col, x, z, radius, height, opts = {}) {
  const r = B.rand;
  const g = H(x, z);
  // plinth
  B.block(x, g + 0.25, z, radius * 1.45, 0.45, radius * 1.45, r() * 0.2, col * 0.92);
  const broken = opts.broken ?? (r() < 0.6);
  const hTop = broken ? height * (0.35 + r() * 0.6) : height;
  const drumH = 1.1;
  let y = g + 0.7;
  const rot = r() * 6;
  let i = 0;
  while (y < g + 0.7 + hTop - 0.2) {
    const hh = Math.min(drumH, g + 0.7 + hTop - y);
    B.drum(x + (r() - 0.5) * 0.04, y + hh / 2, z + (r() - 0.5) * 0.04, radius * (1 - i * 0.012), radius * (1 - (i + 1) * 0.012), hh / 2, 12, col, 0, 0, rot + i * 0.1);
    y += hh; i++;
  }
  if (!broken) B.block(x, y + 0.3, z, radius * 1.35, 0.3, radius * 1.35, r() * 0.1, col * 1.05);
  else {
    // fallen drums
    const fa = r() * Math.PI * 2, nF = 1 + Math.floor(r() * 3);
    for (let k = 0; k < nF; k++) {
      const d = 2 + k * 2.1 + r();
      const fx = x + Math.cos(fa) * d, fz = z + Math.sin(fa) * d;
      B.drum(fx, H(fx, fz) + radius * 0.8, fz, radius, radius, drumH / 2, 12, col * 0.95, Math.PI / 2 + (r() - 0.5) * 0.2, 0, fa);
    }
  }
  return { x, z, r: radius * 1.2, top: y, base: g };
}

function arch(B, H, col, x, z, yaw, span, pierH, thick, opts = {}) {
  const r = B.rand;
  const ux = Math.cos(yaw), uz = -Math.sin(yaw);
  const pw = 1.1, g0 = Math.min(H(x - ux * span / 2, z - uz * span / 2), H(x + ux * span / 2, z + uz * span / 2));
  const courseH = 0.7;
  const parts = [];
  for (const s of [-1, 1]) {
    const px = x + ux * s * (span / 2 + pw / 2), pz = z + uz * s * (span / 2 + pw / 2);
    const g = H(px, pz);
    let y = g - 0.3;
    while (y < g0 + pierH) {
      B.block(px, y + courseH / 2, pz, pw / 2, courseH / 2 - 0.01, thick / 2, yaw + (r() - 0.5) * 0.03, col * 0.95);
      y += courseH;
    }
    parts.push({ px, pz, g, top: y });
  }
  // voussoirs along a semicircle
  const R = span / 2 + pw / 2, nV = 13;
  const missing = opts.broken ? Math.floor(r() * 3) + 1 : 0;
  const missStart = Math.floor(nV * (0.55 + r() * 0.3));
  const baseY = g0 + pierH;
  for (let i = 0; i < nV; i++) {
    if (i >= missStart && i < missStart + missing) continue;
    const a = Math.PI - (i + 0.5) / nV * Math.PI;
    const cx = x + ux * Math.cos(a) * R, cz = z + uz * Math.cos(a) * R, cy = baseY + Math.sin(a) * R;
    // block oriented radially: emulate with tilt about the wall axis
    const len = Math.PI * R / nV;
    B.block(cx, cy, cz, len / 2 - 0.02, pw / 2, thick / 2, yaw, col * 1.02, 0, a - Math.PI / 2);
  }
  // spandrel courses above the arch (partly collapsed)
  if (!opts.noSpandrel) {
    for (let c = 0; c < 3; c++) {
      const y = baseY + R + pw / 2 + c * courseH + courseH / 2;
      const nb = Math.ceil((span + pw * 2) / 1.6);
      for (let k = 0; k < nb; k++) {
        if (r() < 0.25 + c * 0.25) continue;
        const t = -span / 2 - pw + (k + 0.5) * (span + pw * 2) / nb;
        B.block(x + ux * t, y, z + uz * t, (span + pw * 2) / nb / 2 - 0.02, courseH / 2, thick / 2, yaw, col);
      }
    }
  }
  return { parts, top: baseY + R, x, z, yaw, span, thick, pw, g0 };
}

function tower(B, H, col, x, z, radius, height, opts = {}) {
  const r = B.rand;
  const courseH = 0.75, wallT = opts.wallT ?? 1.4;
  const g = H(x, z);
  const circ = Math.PI * 2 * radius;
  const nB = Math.max(8, Math.round(circ / 1.6));
  const phase = r() * 6;
  const nC = Math.ceil(height / courseH);
  const windows = opts.windows ?? [[0.3, 0.6], [0.55, 2.4], [0.75, 4.2]];
  for (let c = 0; c < nC; c++) {
    const y = g - 0.6 + c * courseH + courseH / 2;
    for (let k = 0; k < nB; k++) {
      const a = (k + (c % 2) * 0.5) / nB * Math.PI * 2;
      // broken crown: height varies around the ring
      const crown = height * (0.72 + 0.28 * (0.5 + 0.5 * Math.sin(a * 2 + phase)) * (0.6 + 0.4 * Math.sin(a * 5 + phase * 3)));
      if (c * courseH > crown) continue;
      // door + windows
      const fy = (c * courseH) / height;
      let skip = false;
      if (opts.door !== false && c * courseH < 3.2 && Math.abs(((a - (opts.doorA ?? 0)) + Math.PI * 3) % (Math.PI * 2) - Math.PI) < 0.22) skip = true;
      for (const [wy, wa] of windows) if (Math.abs(fy - wy) < 0.05 && Math.abs(((a - wa) + Math.PI * 3) % (Math.PI * 2) - Math.PI) < 0.16) skip = true;
      if (skip) continue;
      const bx = x + Math.cos(a) * radius, bz = z + Math.sin(a) * radius;
      B.block(bx, y, bz, circ / nB / 2 - 0.02, courseH / 2 - 0.015, wallT / 2, -a + Math.PI / 2, col * (0.9 + 0.1 * (c % 3 === 0 ? 1 : 0)));
    }
  }
  // string course band
  for (const band of opts.bands ?? [0.42]) {
    const y = g + height * band;
    for (let k = 0; k < nB; k++) {
      const a = (k + 0.25) / nB * Math.PI * 2;
      if (r() < 0.15) continue;
      B.block(x + Math.cos(a) * (radius + 0.2), y, z + Math.sin(a) * (radius + 0.2), circ / nB / 2 + 0.05, 0.18, wallT / 2 + 0.2, -a + Math.PI / 2, col * 1.1);
    }
  }
  // rubble ring at the base
  for (let k = 0; k < nB * 0.8; k++) {
    const a = r() * Math.PI * 2, d = radius + wallT + r() * 5;
    const bx = x + Math.cos(a) * d, bz = z + Math.sin(a) * d;
    B.block(bx, H(bx, bz) + 0.2, bz, 0.4 + r() * 0.4, 0.3, 0.3 + r() * 0.3, r() * 6, col * 0.88, (r() - 0.5) * 0.6, (r() - 0.5) * 0.6);
  }
  return { x, z, r: radius + wallT / 2, height, base: g };
}

function paving(B, H, col, x, z, w, d, yaw, holeChance = 0.25) {
  const r = B.rand;
  const ux = Math.cos(yaw), uz = -Math.sin(yaw), vx = Math.sin(yaw), vz = Math.cos(yaw);
  for (let i = -w / 2; i < w / 2; i += 1.5) {
    for (let j = -d / 2; j < d / 2; j += 1.5) {
      if (r() < holeChance) continue;
      const px = x + ux * (i + 0.75) + vx * (j + 0.75), pz = z + uz * (i + 0.75) + vz * (j + 0.75);
      B.block(px, H(px, pz) + 0.02, pz, 0.72, 0.12, 0.72, yaw + (r() - 0.5) * 0.08, col * 0.85, (r() - 0.5) * 0.06, (r() - 0.5) * 0.06, 0.03);
    }
  }
}

function standingStone(B, H, col, x, z, h, w) {
  const r = B.rand;
  const g = H(x, z);
  const tx = (r() - 0.5) * 0.12, tz = (r() - 0.5) * 0.12;
  B.block(x, g + h / 2 - 0.5, z, w / 2, h / 2, w * 0.28, r() * 6, col, tx, tz, 0.16);
  return { x, z, r: w * 0.55, top: g + h, base: g };
}

// --------------------------------------------------------------------------------------
export function buildRuins(ctx, { group, colliders, noiseTex }) {
  const { THREE, world } = ctx;
  const H = (x, z) => world.getHeight(x, z);
  const mat = makePropMaterial(ctx, noiseTex, { kind: 'ruin' });
  const sites = [];

  function finish(name, B, x, z, radius) {
    const g = B.geometry(THREE);
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true; m.receiveShadow = true; m.name = 'ruin-' + name;
    m.matrixAutoUpdate = false; m.updateMatrix();
    group.add(m);
    sites.push({ name, x, z, r: radius, mesh: m });
  }
  const addWallCollider = (w) => colliders.add({ type: 'box', kind: 'ruin', x: w.x, z: w.z, y: w.base + w.height / 2 - 0.3, hx: w.len / 2, hy: w.height / 2, hz: w.thick / 2, rotY: w.yaw });

  // 1) The citadel on the plateau's northern rise: curtain walls, gatehouse arch, broken keep.
  {
    const cx = 40, cz = -170, R = 44;
    const B = new Builder(mulberry32(11));
    const sides = 7;
    for (let i = 0; i < sides; i++) {
      const a0 = i / sides * Math.PI * 2 + 0.2, a1 = (i + 1) / sides * Math.PI * 2 + 0.2;
      const x0 = cx + Math.cos(a0) * R, z0 = cz + Math.sin(a0) * R, x1 = cx + Math.cos(a1) * R, z1 = cz + Math.sin(a1) * R;
      if (i === 2) {
        // gate: arch in the middle of this side
        const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, yaw = Math.atan2(-(z1 - z0), x1 - x0);
        const ux = (x1 - x0) / Math.hypot(x1 - x0, z1 - z0), uz = (z1 - z0) / Math.hypot(x1 - x0, z1 - z0);
        addWallCollider(wall(B, H, 1, x0, z0, mx - ux * 4.2, mz - uz * 4.2, 7, 2.2, { broken: 0.35 }));
        addWallCollider(wall(B, H, 1, mx + ux * 4.2, mz + uz * 4.2, x1, z1, 7, 2.2, { broken: 0.35 }));
        const a = arch(B, H, 1.04, mx, mz, yaw, 5.0, 4.2, 2.4, { broken: false });
        for (const p of a.parts) colliders.add({ type: 'box', kind: 'ruin', x: p.px, z: p.pz, y: (p.g + p.top) / 2, hx: 0.6, hy: (p.top - p.g) / 2 + 0.3, hz: 1.2, rotY: yaw });
      } else if (i === 5) {
        // collapsed section: two stubs + rubble
        const t = 0.35;
        addWallCollider(wall(B, H, 1, x0, z0, x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, 5, 2.2, { broken: 0.8 }));
        addWallCollider(wall(B, H, 1, x0 + (x1 - x0) * 0.75, z0 + (z1 - z0) * 0.75, x1, z1, 6, 2.2, { broken: 0.6 }));
        for (let k = 0; k < 40; k++) {
          const tt = 0.35 + B.rand() * 0.4, off = (B.rand() - 0.5) * 7;
          const px = x0 + (x1 - x0) * tt - (z1 - z0) / R * off * 0.3, pz = z0 + (z1 - z0) * tt + (x1 - x0) / R * off * 0.3;
          B.block(px, H(px, pz) + 0.2, pz, 0.5 + B.rand() * 0.4, 0.3, 0.4, B.rand() * 6, 0.9, (B.rand() - 0.5) * 0.7, (B.rand() - 0.5) * 0.7);
        }
      } else {
        addWallCollider(wall(B, H, 1, x0, z0, x1, z1, 6.5 + B.rand() * 2, 2.2, { broken: 0.5 }));
      }
      // corner turret
      const t = tower(B, H, 1.02, x0, z0, 3.2, 9 + B.rand() * 4, { door: false, windows: [[0.6, 1.0]], bands: [] });
      colliders.add({ type: 'cylinder', kind: 'ruin', x: t.x, z: t.z, y: t.base + t.height / 2, r: t.r, hy: t.height / 2 });
    }
    // the keep: tall broken tower — the landmark you see from afar
    const k = tower(B, H, 1.05, cx + 6, cz - 4, 7.5, 38, { doorA: 1.9, windows: [[0.3, 0.4], [0.5, 2.4], [0.62, 4.6], [0.8, 1.2]], bands: [0.3, 0.62] });
    colliders.add({ type: 'cylinder', kind: 'ruin', x: k.x, z: k.z, y: k.base + k.height / 2, r: k.r, hy: k.height / 2 });
    paving(B, H, 1, cx, cz + 14, 22, 18, 0.2, 0.35);
    for (let i = 0; i < 6; i++) {
      const a = 2.6 + i * 0.22, px = cx + Math.cos(a) * 26, pz = cz + Math.sin(a) * 26;
      const c = column(B, H, 1.06, px, pz, 0.7, 6.5);
      colliders.add({ type: 'cylinder', kind: 'ruin', x: c.x, z: c.z, y: (c.base + c.top) / 2, r: c.r, hy: (c.top - c.base) / 2 });
    }
    finish('citadel', B, cx, cz, R + 10);
  }

  // 2) Lakeside arcade: a row of arches and a broken colonnade on Mirrormere's east shore.
  {
    const L = world.LAKES[0];
    const ax = L.x + L.r * 1.45, az = L.z + 40;
    const B = new Builder(mulberry32(23));
    const yaw = 1.35;
    const ux = Math.cos(yaw), uz = -Math.sin(yaw);
    for (let i = 0; i < 4; i++) {
      const t = (i - 1.5) * 7.6;
      const a = arch(B, H, 1.03, ax + ux * t, az + uz * t, yaw, 4.6, 3.6, 1.4, { broken: i === 2, noSpandrel: i === 3 });
      for (const p of a.parts) colliders.add({ type: 'box', kind: 'ruin', x: p.px, z: p.pz, y: (p.g + p.top) / 2, hx: 0.6, hy: (p.top - p.g) / 2 + 0.3, hz: 0.7, rotY: yaw });
    }
    for (let i = 0; i < 7; i++) {
      const t = (i - 3) * 5.0, off = 9;
      const px = ax + ux * t + uz * off, pz = az + uz * t - ux * off;
      const c = column(B, H, 1.04, px, pz, 0.6, 6, { broken: i % 3 !== 0 });
      colliders.add({ type: 'cylinder', kind: 'ruin', x: c.x, z: c.z, y: (c.base + c.top) / 2, r: c.r, hy: (c.top - c.base) / 2 });
    }
    paving(B, H, 1, ax + uz * 4.5, az - ux * 4.5, 30, 10, yaw, 0.3);
    finish('lake-arcade', B, ax, az, 30);
  }

  // 3) Stone circle on a hilltop in the south-west woods.
  {
    // find the highest point near the target
    let bx = -930, bz = 700, bh = -1e9;
    for (let i = 0; i < 200; i++) {
      const x = -930 + (Math.random() * 0 + (i % 15) - 7) * 22, z = 700 + (Math.floor(i / 15) - 7) * 22;
      const h = H(x, z); if (h > bh) { bh = h; bx = x; bz = z; }
    }
    const B = new Builder(mulberry32(37));
    const n = 11, R = 13;
    for (let i = 0; i < n; i++) {
      if (i === 4) continue;
      const a = i / n * Math.PI * 2;
      const s = standingStone(B, H, 0.98, bx + Math.cos(a) * R, bz + Math.sin(a) * R, 4.2 + B.rand() * 2.2, 1.6 + B.rand() * 0.6);
      colliders.add({ type: 'cylinder', kind: 'stone', x: s.x, z: s.z, y: (s.base + s.top) / 2, r: s.r, hy: (s.top - s.base) / 2 });
    }
    // lintel trilithon at the centre
    const g = H(bx, bz);
    B.block(bx - 1.8, g + 2.6, bz, 0.7, 3.0, 0.6, 0.3, 0.96, 0, 0, 0.1);
    B.block(bx + 1.8, g + 2.6, bz, 0.7, 3.0, 0.6, 0.3, 0.96, 0, 0, 0.1);
    B.block(bx, g + 6.0, bz, 2.9, 0.5, 0.7, 0.3, 1.02, 0, 0.04, 0.1);
    colliders.add({ type: 'box', kind: 'stone', x: bx, z: bz, y: g + 3.2, hx: 2.6, hy: 3.3, hz: 0.7, rotY: 0.3 });
    finish('stone-circle', B, bx, bz, R + 4);
  }

  // 4) Watchtower on the eastern headland.
  {
    let bx = 1420, bz = 120, bh = -1e9;
    for (let i = 0; i < 225; i++) {
      const x = 1380 + ((i % 15) - 7) * 18, z = 120 + (Math.floor(i / 15) - 7) * 18;
      const h = H(x, z); if (h > bh && h > 6) { bh = h; bx = x; bz = z; }
    }
    const B = new Builder(mulberry32(41));
    const t = tower(B, H, 1.0, bx, bz, 5, 24, { doorA: 3.4, windows: [[0.4, 0.5], [0.7, 3.0]] });
    colliders.add({ type: 'cylinder', kind: 'ruin', x: t.x, z: t.z, y: t.base + t.height / 2, r: t.r, hy: t.height / 2 });
    const w = wall(B, H, 1, bx + 6, bz + 2, bx + 22, bz + 9, 4, 1.4, { broken: 0.7 });
    addWallCollider(w);
    finish('watchtower', B, bx, bz, 25);
  }

  // 5) Meadow colonnade on the plateau (a long avenue of columns, mostly fallen).
  {
    const B = new Builder(mulberry32(53));
    const cx = 250, cz = 330, yaw = -0.5;
    const ux = Math.cos(yaw), uz = -Math.sin(yaw);
    for (let i = 0; i < 9; i++) for (const side of [-1, 1]) {
      const t = (i - 4) * 6.5;
      const px = cx + ux * t + uz * side * 5, pz = cz + uz * t - ux * side * 5;
      const c = column(B, H, 1.05, px, pz, 0.65, 7.5, { broken: B.rand() < 0.7 });
      colliders.add({ type: 'cylinder', kind: 'ruin', x: c.x, z: c.z, y: (c.base + c.top) / 2, r: c.r, hy: (c.top - c.base) / 2 });
    }
    paving(B, H, 1, cx, cz, 60, 7, yaw + Math.PI / 2, 0.45);
    finish('colonnade', B, cx, cz, 35);
  }

  // 6) Broken bridge piers across Brightwater.
  {
    const r = world.RIVERS[0];
    const p = r.points[Math.floor(r.points.length * 0.46)];
    const q = r.points[Math.floor(r.points.length * 0.46) + 2];
    const fx = q.x - p.x, fz = q.z - p.z, fl = Math.hypot(fx, fz);
    const ax = -fz / fl, az = fx / fl;   // across the river
    const B = new Builder(mulberry32(61));
    const yaw = Math.atan2(-az, ax);
    const deckY = p.y + 6;
    // walk out from the channel until the bank reaches deck height
    let half = p.w + 3;
    while (half < 60 && Math.max(H(p.x + ax * half, p.z + az * half), H(p.x - ax * half, p.z - az * half)) < deckY - 1.5) half += 1;
    const span = half * 2;
    for (const s of [-1, 0, 1]) {
      if (s === 0) continue;
      const px = p.x + ax * s * span / 2, pz = p.z + az * s * span / 2;
      const g = Math.min(H(px, pz), p.y);
      for (let y = g - 1; y < deckY; y += 0.8) B.block(px, y + 0.4, pz, 1.6, 0.39, 2.1, yaw + Math.PI / 2, 0.95);
      colliders.add({ type: 'box', kind: 'ruin', x: px, z: pz, y: (g + deckY) / 2, hx: 1.6, hy: (deckY - g) / 2 + 0.5, hz: 2.1, rotY: yaw + Math.PI / 2 });
      // deck stub reaching out over the water, broken mid-span
      for (let k = 0; k < 5; k++) {
        const t = s * (span / 2 - k * 1.6);
        if (k > 2 && s > 0) break;
        B.block(p.x + ax * t, deckY + 0.4, p.z + az * t, 0.78, 0.4, 2.0, yaw, 1.02, (B.rand() - 0.5) * 0.04, 0);
      }
    }
    // central pier in the stream
    for (let y = p.y - 3; y < deckY - 2; y += 0.8) B.block(p.x, y + 0.4, p.z, 1.2, 0.39, 1.8, yaw + Math.PI / 2 + (B.rand() - 0.5) * 0.05, 0.9);
    colliders.add({ type: 'box', kind: 'ruin', x: p.x, z: p.z, y: p.y + 1, hx: 1.2, hy: 4, hz: 1.8, rotY: yaw + Math.PI / 2 });
    finish('bridge', B, p.x, p.z, span);
  }

  // 7) Scattered fragments across the island: wall corners, lone arches, plinths.
  {
    const rand = mulberry32(77);
    const B = new Builder(rand);
    let placed = 0;
    const frag = [];
    for (let tries = 0; tries < 400 && placed < 22; tries++) {
      const x = (rand() - 0.5) * 3000, z = (rand() - 0.5) * 2800;
      const h = H(x, z);
      if (h < 6 || h > 200) continue;
      const nrm = world.getNormal(x, z);
      if (nrm.y < 0.93) continue;
      if (world.getRiverMask(x, z) > 0 || world.getRiverInfo(x, z)?.dist < 30) continue;
      if (sites.some(s => Math.hypot(s.x - x, s.z - z) < s.r + 80) || frag.some(f => Math.hypot(f.x - x, f.z - z) < 160)) continue;
      const kind = placed % 3;
      const yaw = rand() * Math.PI;
      if (kind === 0) {
        const L = 8 + rand() * 6, ux = Math.cos(yaw), uz = -Math.sin(yaw);
        addWallCollider(wall(B, H, 1, x, z, x + ux * L, z + uz * L, 3.5 + rand() * 2, 1.2, { broken: 0.75 }));
        addWallCollider(wall(B, H, 1, x, z, x - uz * L * 0.6, z + ux * L * 0.6, 2.5 + rand() * 2, 1.2, { broken: 0.8 }));
      } else if (kind === 1) {
        const a = arch(B, H, 1.02, x, z, yaw, 3.6, 2.8, 1.1, { broken: rand() < 0.5, noSpandrel: rand() < 0.5 });
        for (const p of a.parts) colliders.add({ type: 'box', kind: 'ruin', x: p.px, z: p.pz, y: (p.g + p.top) / 2, hx: 0.6, hy: (p.top - p.g) / 2 + 0.3, hz: 0.6, rotY: yaw });
      } else {
        for (let i = 0; i < 3; i++) {
          const c = column(B, H, 1.04, x + Math.cos(yaw) * i * 4.5, z - Math.sin(yaw) * i * 4.5, 0.55, 5, { broken: true });
          colliders.add({ type: 'cylinder', kind: 'ruin', x: c.x, z: c.z, y: (c.base + c.top) / 2, r: c.r, hy: (c.top - c.base) / 2 });
        }
        paving(B, H, 1, x + Math.cos(yaw) * 4.5, z - Math.sin(yaw) * 4.5, 14, 6, yaw, 0.5);
      }
      frag.push({ x, z });
      placed++;
    }
    const g = B.geometry(THREE);
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true; m.receiveShadow = true; m.name = 'ruin-fragments';
    group.add(m);
    for (const f of frag) sites.push({ name: 'fragment', x: f.x, z: f.z, r: 15 });
  }

  return { sites, material: mat };
}
