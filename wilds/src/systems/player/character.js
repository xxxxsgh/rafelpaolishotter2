// Procedural hero: a young wanderer in a hooded deep-teal travel cloak, rust scarf,
// cream tunic, leather satchel and boots. Every part is a smooth lathe/ellipsoid/tube,
// merged into ONE skinned mesh (auto-weighted by distance to bone segments) so the
// body is a single draw call + one inverted-hull outline pass.
//
// Model space: feet at y=0, facing +Z, left side = +X.
import { makeToonMaterial, makeOutlineMaterial } from './toon.js';

export const BONES = ['root', 'hips', 'spine', 'chest', 'neck', 'head',
  'uArmL', 'fArmL', 'handL', 'uArmR', 'fArmR', 'handR',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];
const PARENT = { hips: 'root', spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  uArmL: 'chest', fArmL: 'uArmL', handL: 'fArmL', uArmR: 'chest', fArmR: 'uArmR', handR: 'fArmR',
  thighL: 'hips', shinL: 'thighL', footL: 'shinL', thighR: 'hips', shinR: 'thighR', footR: 'shinR' };
// bind-pose joint positions (model space)
const J = {
  root: [0, 0, 0], hips: [0, 0.90, 0], spine: [0, 1.0, 0], chest: [0, 1.17, -0.005], neck: [0, 1.37, -0.01], head: [0, 1.445, 0],
  uArmL: [0.185, 1.325, -0.01], fArmL: [0.195, 1.06, -0.005], handL: [0.2, 0.82, 0.0],
  thighL: [0.092, 0.865, 0], shinL: [0.094, 0.46, 0.005], footL: [0.095, 0.075, -0.005],
};
for (const k of ['uArm', 'fArm', 'hand', 'thigh', 'shin', 'foot']) { const p = J[k + 'L']; J[k + 'R'] = [-p[0], p[1], p[2]]; }
// segment end for distance-based weights
const SEG_END = { root: [0, 0.4, 0], hips: J.spine, spine: J.chest, chest: J.neck, neck: J.head, head: [0, 1.66, 0],
  uArmL: J.fArmL, fArmL: J.handL, handL: [0.2, 0.7, 0.01], uArmR: J.fArmR, fArmR: J.handR, handR: [-0.2, 0.7, 0.01],
  thighL: J.shinL, shinL: J.footL, footL: [0.095, 0.03, 0.14], thighR: J.shinR, shinR: J.footR, footR: [-0.095, 0.03, 0.14] };

export const PALETTE = {
  cloak: 0x1d5a5e, cloakLight: 0x2a7372, lining: 0xc79a52, tunic: 0xd9caa2, tunicShade: 0xc2b088,
  trousers: 0x5d5148, boot: 0x4a3122, bootCuff: 0x7d5a3a, sole: 0x2c211b, belt: 0x5a3a24, brass: 0xd8a84a,
  satchel: 0x8f5b33, satchelDark: 0x6b4026, skin: 0xf1c7a2, cheek: 0xeaa58c, hair: 0x5e3b29, eye: 0x1d2433,
  scarf: 0xc4502b, scarfStripe: 0xf0d9a8, bracer: 0x6e4a2f, glove: 0x7a5236,
};

export function buildCharacter(ctx) {
  const { THREE } = ctx;
  const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  const boneIndex = Object.fromEntries(BONES.map((n, i) => [n, i]));
  const segA = BONES.map(n => V3(J[n])), segB = BONES.map(n => V3(SEG_END[n]));

  const parts = [];
  const col = new THREE.Color(), tc = new THREE.Color();
  // ---------- geometry helpers ----------
  function finish(geo, color, bones, opts = {}) {
    geo = geo.index ? geo : indexify(geo);
    const uvA = geo.attributes.uv;
    if (uvA) geo.deleteAttribute('uv');
    const n = geo.attributes.position.count;
    const c = new Float32Array(n * 3);
    col.set(color);
    const c2 = opts.color2 !== undefined ? new THREE.Color(opts.color2) : null;
    const p = geo.attributes.position;
    for (let i = 0; i < n; i++) {
      let r = col.r, g = col.g, b = col.b;
      if (opts.uvFn && uvA) { const cc = opts.uvFn(uvA.getX(i), uvA.getY(i)); if (cc !== null && cc !== undefined) { tc.set(cc); r = tc.r; g = tc.g; b = tc.b; } }
      else if (opts.colorFn) { const cc = opts.colorFn(p.getX(i), p.getY(i), p.getZ(i)); if (cc !== null && cc !== undefined) { tc.set(cc); r = tc.r; g = tc.g; b = tc.b; } }
      else if (c2 && opts.mix) { const t = opts.mix(p.getX(i), p.getY(i), p.getZ(i)); r += (c2.r - r) * t; g += (c2.g - g) * t; b += (c2.b - b) * t; }
      c[i * 3] = r; c[i * 3 + 1] = g; c[i * 3 + 2] = b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    // skin weights: inverse-distance to candidate bone segments, top 2
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    const cand = (Array.isArray(bones) ? bones : [bones]).map(b => boneIndex[b]);
    const v = new THREE.Vector3(), tmp = new THREE.Vector3(), ab = new THREE.Vector3();
    const sharp = opts.sharp ?? 1;
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(p, i);
      let b0 = cand[0], w0 = 0, b1 = cand[0], w1 = 0;
      if (cand.length === 1) { w0 = 1; }
      else {
        for (const bi of cand) {
          ab.subVectors(segB[bi], segA[bi]);
          const t = Math.max(0, Math.min(1, tmp.subVectors(v, segA[bi]).dot(ab) / ab.lengthSq()));
          const d = tmp.copy(segA[bi]).addScaledVector(ab, t).distanceTo(v);
          const w = 1 / Math.pow(d * d + 0.0004, 2 * sharp);
          if (w > w0) { b1 = b0; w1 = w0; b0 = bi; w0 = w; } else if (w > w1) { b1 = bi; w1 = w; }
        }
        const s = w0 + w1; w0 /= s; w1 /= s;
        if (w1 < 0.04) { w0 = 1; w1 = 0; }
      }
      si[i * 4] = b0; si[i * 4 + 1] = b1; sw[i * 4] = w0; sw[i * 4 + 1] = w1;
    }
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    parts.push(geo);
    return geo;
  }
  function indexify(geo) {
    const n = geo.attributes.position.count; const idx = [];
    for (let i = 0; i < n; i++) idx.push(i);
    geo.setIndex(idx); return geo;
  }
  // tapered capsule from a to b (radii ra, rb)
  function capsule(a, b, ra, rb, color, bones, opts = {}) {
    const A = V3(a), B = V3(b), len = A.distanceTo(B);
    const pts = [], seg = 6;
    for (let i = 0; i <= seg; i++) { const t = -Math.PI / 2 + (i / seg) * Math.PI / 2; pts.push(new THREE.Vector2(Math.cos(t) * ra, Math.sin(t) * ra)); }
    for (let i = 0; i <= seg; i++) { const t = (i / seg) * Math.PI / 2; pts.push(new THREE.Vector2(Math.cos(t) * rb, len + Math.sin(t) * rb)); }
    pts[0].x = 0.0001; pts[pts.length - 1].x = 0.0001;
    const g = new THREE.LatheGeometry(pts, opts.radial || 14);
    if (opts.sx || opts.sz) g.scale(opts.sx || 1, 1, opts.sz || 1);
    orient(g, A, B);
    return finish(g, color, bones, opts);
  }
  function orient(g, A, B) {
    const dir = new THREE.Vector3().subVectors(B, A).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    g.applyQuaternion(q); g.translate(A.x, A.y, A.z);
  }
  function lathe(profile, center, color, bones, opts = {}) {
    const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y));
    const g = new THREE.LatheGeometry(pts, opts.radial || 20, opts.phiStart || 0, opts.phiLength || Math.PI * 2);
    g.scale(opts.sx || 1, 1, opts.sz || 1);
    if (opts.rot) g.rotateX(opts.rot);
    g.translate(center[0], center[1], center[2]);
    return finish(g, color, bones, opts);
  }
  function ellipsoid(center, radii, color, bones, opts = {}) {
    const g = new THREE.SphereGeometry(1, opts.ws || 16, opts.hs || 12);
    if (opts.superE) {   // superellipsoid (rounded box)
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const f = x => Math.sign(x) * Math.pow(Math.abs(x), opts.superE);
        p.setXYZ(i, f(p.getX(i)), f(p.getY(i)), f(p.getZ(i)));
      }
      g.computeVertexNormals();
    }
    g.scale(radii[0], radii[1], radii[2]);
    if (opts.rotX) g.rotateX(opts.rotX);
    if (opts.rotY) g.rotateY(opts.rotY);
    if (opts.rotZ) g.rotateZ(opts.rotZ);
    g.translate(center[0], center[1], center[2]);
    return finish(g, color, bones, opts);
  }
  function tube(points, r, color, bones, opts = {}) {
    const curve = new THREE.CatmullRomCurve3(points.map(V3), !!opts.closed);
    const g = new THREE.TubeGeometry(curve, opts.seg || 24, r, opts.radial || 6, !!opts.closed);
    if (opts.flatten) { const p = g.attributes.position; /* noop placeholder for API symmetry */ }
    return finish(g, color, bones, opts);
  }

  const P = PALETTE;
  // ---------- legs + boots ----------
  for (const s of [1, -1]) {
    const L = s > 0 ? 'L' : 'R';
    const th = J['thigh' + L], sh = J['shin' + L], ft = J['foot' + L];
    capsule([th[0], th[1] + 0.02, th[2]], sh, 0.083, 0.06, P.trousers, ['hips', 'thigh' + L, 'shin' + L], { sz: 0.95 });
    capsule(sh, [ft[0], ft[1] + 0.12, ft[2]], 0.06, 0.05, P.trousers, ['thigh' + L, 'shin' + L, 'foot' + L]);
    // boot shaft with folded cuff
    lathe([[0.048, 0], [0.056, 0.05], [0.06, 0.16], [0.064, 0.24], [0.072, 0.25], [0.074, 0.29], [0.068, 0.30], [0.05, 0.302]],
      [ft[0], ft[1] - 0.03, ft[2] - 0.004], P.boot, ['shin' + L, 'foot' + L], { radial: 14, color2: P.bootCuff, mix: (x, y) => y > ft[1] + 0.205 ? 1 : 0 });
    // foot
    ellipsoid([ft[0] + s * 0.004, 0.06, ft[2] + 0.045], [0.056, 0.055, 0.115], P.boot, 'foot' + L, { ws: 14, hs: 10 });
    ellipsoid([ft[0] + s * 0.004, 0.018, ft[2] + 0.045], [0.06, 0.02, 0.122], P.sole, 'foot' + L, { ws: 14, hs: 6 });
    // knee patch
    ellipsoid([sh[0], sh[1] + 0.01, sh[2] + 0.045], [0.045, 0.05, 0.025], P.bracer, ['shin' + L], { ws: 10, hs: 8 });
  }
  // ---------- torso: tunic with a flared hem ----------
  lathe([[0.0, 0.64], [0.178, 0.645], [0.18, 0.66], [0.1795, 0.664], [0.178, 0.668], [0.1775, 0.686], [0.177, 0.692], [0.165, 0.74], [0.152, 0.84], [0.142, 0.95], [0.137, 1.03], [0.148, 1.12], [0.162, 1.21],
    [0.165, 1.27], [0.15, 1.33], [0.11, 1.37], [0.065, 1.395], [0.0, 1.40]], [0, 0, 0], P.tunic,
    ['hips', 'spine', 'chest', 'neck'], { radial: 22, sz: 0.72, colorFn: (x, y) => y < 0.665 ? P.cloak : y < 0.69 ? P.lining : null });
  // belt + buckle + pouch
  lathe([[0.149, 0.885], [0.153, 0.895], [0.153, 0.935], [0.148, 0.945]], [0, 0, 0], P.belt, ['hips', 'spine'], { radial: 22, sz: 0.76 });
  ellipsoid([0, 0.915, 0.118], [0.03, 0.026, 0.012], P.brass, 'hips', { superE: 0.4, ws: 10, hs: 8 });
  ellipsoid([-0.13, 0.86, 0.06], [0.035, 0.045, 0.03], P.satchelDark, 'hips', { superE: 0.5, ws: 10, hs: 8 });
  // neck + head
  capsule([0, 1.36, -0.01], [0, 1.47, 0.0], 0.048, 0.045, P.skin, ['chest', 'neck', 'head']);
  const H = [0, 1.565, 0.012];
  ellipsoid(H, [0.118, 0.13, 0.122], P.skin, 'head', { ws: 22, hs: 16 });
  ellipsoid([0, 1.505, 0.06], [0.085, 0.07, 0.07], P.skin, 'head', { ws: 14, hs: 10 });  // jaw/cheeks
  for (const s of [1, -1]) {
    ellipsoid([s * 0.046, 1.562, 0.117], [0.021, 0.031, 0.012], P.eye, 'head', { ws: 12, hs: 10, rotY: s * 0.35 });
    ellipsoid([s * 0.047, 1.556, 0.124], [0.013, 0.018, 0.007], 0x3d6b5e, 'head', { ws: 10, hs: 8, rotY: s * 0.35 });
    ellipsoid([s * 0.052, 1.574, 0.127], [0.0065, 0.0075, 0.004], 0xffffff, 'head', { ws: 6, hs: 4 });
    ellipsoid([s * 0.072, 1.525, 0.098], [0.02, 0.012, 0.008], P.cheek, 'head', { ws: 8, hs: 6, rotY: s * 0.6 });
    ellipsoid([s * 0.05, 1.605, 0.112], [0.024, 0.006, 0.006], P.hair, 'head', { ws: 8, hs: 4, rotZ: -s * 0.15 });  // brows
  }
  ellipsoid([0, 1.54, 0.128], [0.012, 0.016, 0.012], P.skin, 'head', { ws: 8, hs: 6 });  // nose
  // hair fringe tufts poking from the hood
  for (let i = 0; i < 4; i++) {
    const a = -0.45 + i * 0.3;
    ellipsoid([Math.sin(a) * 0.1, 1.652 - Math.abs(a) * 0.02, Math.cos(a) * 0.098 + 0.012], [0.032, 0.03, 0.014], P.hair, 'head',
      { ws: 8, hs: 6, rotZ: -a * 1.1 + 0.25, rotY: a, rotX: -0.5 });
  }
  ellipsoid([0, 1.64, -0.035], [0.112, 0.085, 0.11], P.hair, 'head', { ws: 16, hs: 12 });
  // ---------- hood: thick shell open at the face, soft drooping point at the back ----------
  {
    const R = 0.172, TL = Math.PI * 0.7;
    const outer = new THREE.SphereGeometry(R, 32, 20, 0, Math.PI * 2, 0, TL);
    const inner = new THREE.SphereGeometry(R - 0.016, 32, 20, 0, Math.PI * 2, 0, TL);
    const ix = inner.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i]; ix[i] = ix[i + 1]; ix[i + 1] = t; }
    // face opening = slanted cut plane (brim reaches forward over the brow, wide at the cheeks)
    const cutF = (x, y, z) => z - y * 0.45 - 0.05 + x * x * 1.2;
    for (const g of [outer, inner]) {
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const back = Math.max(0, -z / R);
        y *= y < 0 ? 1.15 + back * 0.55 : 1.1;
        z *= 1.08; x *= 1.04 - Math.max(0, -y / R) * 0.12;
        z -= back * back * 0.025;
        p.setXYZ(i, x, y, z);
      }
      // drop triangles fully in front of the cut; snap straddling vertices onto the cut so the rim is smooth
      const idx = g.index.array, keep = [], snapV = new Set();
      for (let i = 0; i < idx.length; i += 3) {
        let nIn = 0;
        for (let k = 0; k < 3; k++) { const v = idx[i + k]; if (cutF(p.getX(v), p.getY(v), p.getZ(v)) > 0) nIn++; }
        if (nIn === 3) continue;
        keep.push(idx[i], idx[i + 1], idx[i + 2]);
        if (nIn) for (let k = 0; k < 3; k++) snapV.add(idx[i + k]);
      }
      for (const v of snapV) {
        const x = p.getX(v), y = p.getY(v), z = p.getZ(v);
        const f = cutF(x, y, z);
        if (f > 0) p.setZ(v, z - f);
      }
      g.setIndex(keep);
      g.computeVertexNormals();
      if (g === inner) { const n2 = g.attributes.normal; for (let i = 0; i < n2.count; i++) n2.setXYZ(i, -n2.getX(i), -n2.getY(i), -n2.getZ(i)); }
      g.rotateX(-0.1);
      g.translate(H[0], H[1] + 0.012, H[2] - 0.01);
    }
    // hem band framing the face: colour by distance to the cut (in hood-local space)
    const hoodLocal = (x, y, z) => {
      y -= H[1] + 0.012; z -= H[2] - 0.01;
      const c = Math.cos(0.1), sn = Math.sin(0.1);   // undo rotateX(-0.1)
      return cutF(x, y * c - z * sn, y * sn + z * c);
    };
    finish(outer, P.cloak, ['head'], { colorFn: (x, y, z) => hoodLocal(x, y, z) > -0.03 ? P.cloakLight : null });
    finish(inner, P.lining, 'head', { colorFn: (x, y, z) => hoodLocal(x, y, z) > -0.05 ? P.cloakLight : 0x235e60 });
    // drooping point
    capsule([0, H[1] + 0.12, H[2] - 0.1], [0, H[1] + 0.03, H[2] - 0.27], 0.08, 0.045, P.cloak, ['head'], { radial: 12 });
    capsule([0, H[1] + 0.03, H[2] - 0.27], [0, H[1] - 0.16, H[2] - 0.33], 0.045, 0.014, P.cloak, ['head', 'neck'], { radial: 10 });
  }
  // ---------- capelet / mantle over the shoulders ----------
  lathe([[0.27, 1.175], [0.285, 1.182], [0.287, 1.215], [0.27, 1.3], [0.225, 1.37], [0.135, 1.42], [0.075, 1.44]], [0, 0, -0.02], P.cloak,
    ['chest', 'neck'], { radial: 28, sz: 0.74, colorFn: (x, y) => y < 1.2 ? P.lining : null });
  // ---------- scarf wrap ----------
  lathe([[0.072, 1.33], [0.098, 1.35], [0.104, 1.38], [0.096, 1.42], [0.075, 1.44]], [0, 0, 0.0], P.scarf,
    ['chest', 'neck'], { radial: 20, sz: 0.9, colorFn: (x, y) => Math.abs(y - 1.385) < 0.008 ? P.scarfStripe : null });
  ellipsoid([-0.05, 1.33, 0.085], [0.04, 0.035, 0.03], P.scarf, ['chest', 'neck']);  // knot
  // ---------- arms ----------
  for (const s of [1, -1]) {
    const L = s > 0 ? 'L' : 'R';
    const ua = J['uArm' + L], fa = J['fArm' + L], ha = J['hand' + L];
    capsule([ua[0], ua[1] - 0.035, ua[2]], fa, 0.056, 0.046, P.tunic, ['chest', 'uArm' + L, 'fArm' + L]);
    capsule(fa, [ha[0], ha[1] + 0.02, ha[2]], 0.046, 0.038, P.tunic, ['uArm' + L, 'fArm' + L, 'hand' + L],
      { colorFn: (x, y) => y < fa[1] - 0.09 ? P.bracer : null });
    // bracer cuff
    lathe([[0.044, 0], [0.05, 0.01], [0.05, 0.045], [0.044, 0.055]], [ha[0], ha[1] + 0.03, ha[2]], P.bootCuff, 'fArm' + L, { radial: 12 });
    // hand (mitten + thumb)
    ellipsoid([ha[0], ha[1] - 0.05, ha[2] + 0.005], [0.03, 0.058, 0.04], P.glove, 'hand' + L, { ws: 12, hs: 10 });
    ellipsoid([ha[0] - s * 0.005, ha[1] - 0.04, ha[2] + 0.04], [0.016, 0.03, 0.016], P.skin, 'hand' + L, { ws: 8, hs: 6, rotX: 0.5 });
  }
  // ---------- satchel (left hip) + strap from the right shoulder ----------
  ellipsoid([0.185, 0.83, 0.03], [0.055, 0.105, 0.13], P.satchel, ['hips'], { superE: 0.35, ws: 16, hs: 12 });
  ellipsoid([0.2, 0.89, 0.03], [0.05, 0.055, 0.138], P.satchelDark, ['hips'], { superE: 0.35, ws: 14, hs: 10 });
  ellipsoid([0.245, 0.865, 0.03], [0.006, 0.018, 0.016], P.brass, ['hips'], { ws: 6, hs: 6 });
  tube([[-0.13, 1.3, 0.05], [-0.06, 1.2, 0.13], [0.06, 1.05, 0.125], [0.15, 0.93, 0.08], [0.19, 0.9, 0.03]], 0.011, P.belt,
    ['hips', 'spine', 'chest'], { seg: 20, radial: 5 });
  tube([[-0.13, 1.3, -0.05], [-0.06, 1.2, -0.125], [0.06, 1.05, -0.12], [0.15, 0.93, -0.07], [0.19, 0.9, -0.02]], 0.011, P.belt,
    ['hips', 'spine', 'chest'], { seg: 20, radial: 5 });
  // bedroll / folded wing pack under the cloak top (visible as a hump)
  capsule([-0.13, 1.06, -0.13], [0.13, 1.06, -0.13], 0.052, 0.052, P.lining, ['spine', 'chest'], { radial: 12 });

  // ---------- merge ----------
  const geo = mergeParts(THREE, parts);
  geo.computeBoundingSphere();

  // ---------- skeleton ----------
  const bones = {};
  for (const n of BONES) {
    const b = new THREE.Bone(); b.name = n;
    const p = J[n], pp = PARENT[n] ? J[PARENT[n]] : [0, 0, 0];
    b.position.set(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]);
    bones[n] = b;
    if (PARENT[n]) bones[PARENT[n]].add(b);
  }
  bones.root.updateMatrixWorld(true);
  const boneList = BONES.map(n => bones[n]);
  const skeleton = new THREE.Skeleton(boneList);
  const mat = makeToonMaterial(ctx, { sheen: 0.5, shadowAmt: 0.5 });
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.add(bones.root);
  mesh.bind(skeleton);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  const outline = new THREE.SkinnedMesh(geo, makeOutlineMaterial(ctx));
  outline.bind(skeleton, mesh.bindMatrix);
  outline.frustumCulled = false;
  outline.castShadow = false;
  mesh.add(outline);   // identity child: shares the body's world transform

  // attach points for weapons / shield / glider grips
  const handPropR = new THREE.Object3D(); handPropR.position.set(0, -0.06, 0.02); bones.handR.add(handPropR);
  const handPropL = new THREE.Object3D(); handPropL.position.set(0, -0.06, 0.02); bones.handL.add(handPropL);
  const backProp = new THREE.Object3D(); backProp.position.set(0, 0.0, -0.2); bones.chest.add(backProp);

  return { mesh, outline, geo, skeleton, bones, joints: J, material: mat, handPropR, handPropL, backProp };
}

function mergeParts(THREE, parts) {
  let nv = 0, ni = 0;
  for (const g of parts) { nv += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), colr = new Float32Array(nv * 3);
  const si = new Uint16Array(nv * 4), sw = new Float32Array(nv * 4);
  const idx = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const g of parts) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    colr.set(g.attributes.color.array, vo * 3);
    si.set(g.attributes.skinIndex.array, vo * 4);
    sw.set(g.attributes.skinWeight.array, vo * 4);
    const ia = g.index.array;
    for (let i = 0; i < ia.length; i++) idx[io + i] = ia[i] + vo;
    vo += n; io += ia.length;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colr, 3));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}
