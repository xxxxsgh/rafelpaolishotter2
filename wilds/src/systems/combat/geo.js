// Tiny procedural modelling kit: primitives are transformed, vertex-coloured (with optional
// per-vertex colour functions for painterly breakup), tagged with an emissive amount and a
// rigid bone index, then merged into ONE indexed BufferGeometry. Used for creatures
// (skinned, one draw call + outline each), weapons and camp props.
import * as THREE from 'three';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _nm = new THREE.Matrix3();
const _c = new THREE.Color(), _c2 = new THREE.Color(), _c3 = new THREE.Color();

// deterministic hash noise for colour breakup
export function hash3(x, y, z) {
  let h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
export function vnoise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const L = (a, b, t) => a + (b - a) * t;
  const h = (a, b, c) => hash3(ix + a, iy + b, iz + c);
  return L(L(L(h(0, 0, 0), h(1, 0, 0), ux), L(h(0, 1, 0), h(1, 1, 0), ux), uy),
           L(L(h(0, 0, 1), h(1, 0, 1), ux), L(h(0, 1, 1), h(1, 1, 1), ux), uy), uz);
}
export function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export class Builder {
  constructor() { this.parts = []; }
  // geo: BufferGeometry (consumed). o: {pos:[x,y,z], rot:[x,y,z], scl:[x,y,z]|n, color, color2, grad:fn(local p)->t,
  //   colorFn:(world p)->hex|null, emit, bone, jitter (0..1 value noise amount), flat}
  add(geo, o = {}) {
    if (!geo.index) geo = indexify(geo);
    if (geo.attributes.uv) geo.deleteAttribute('uv');
    if (o.flat) { if (geo.index) geo = geo.toNonIndexed(); geo.computeVertexNormals(); geo = indexify(geo); }
    const pos = o.pos || [0, 0, 0], rot = o.rot || [0, 0, 0];
    const scl = o.scl === undefined ? [1, 1, 1] : (typeof o.scl === 'number' ? [o.scl, o.scl, o.scl] : o.scl);
    _q.setFromEuler(_e.set(rot[0], rot[1], rot[2], o.order || 'XYZ'));
    _m.compose(_p.set(pos[0], pos[1], pos[2]), _q, _s.set(scl[0], scl[1], scl[2]));
    if (o.matrix) _m.premultiply(o.matrix);
    const P = geo.attributes.position, N = geo.attributes.normal;
    const n = P.count;
    const local = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { local[i * 3] = P.getX(i); local[i * 3 + 1] = P.getY(i); local[i * 3 + 2] = P.getZ(i); }
    geo.applyMatrix4(_m);
    const col = new Float32Array(n * 3), em = new Float32Array(n), bi = new Uint16Array(n * 4), bw = new Float32Array(n * 4);
    _c.set(o.color ?? 0xffffff);
    if (o.color2 !== undefined) _c2.set(o.color2);
    const jit = o.jitter ?? 0.12;
    for (let i = 0; i < n; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      let r = _c.r, g = _c.g, b = _c.b;
      if (o.color2 !== undefined && o.grad) {
        const t = Math.max(0, Math.min(1, o.grad(local[i * 3], local[i * 3 + 1], local[i * 3 + 2])));
        r += (_c2.r - r) * t; g += (_c2.g - g) * t; b += (_c2.b - b) * t;
      }
      if (o.colorFn) {
        const cc = o.colorFn(x, y, z, local[i * 3], local[i * 3 + 1], local[i * 3 + 2]);
        if (cc !== null && cc !== undefined) { _c3.set(cc); r = _c3.r; g = _c3.g; b = _c3.b; }
      }
      if (jit > 0) {
        const k = 1 + (vnoise3(x * 3.1 + 7, y * 3.1, z * 3.1) - 0.5) * jit * 2;
        r *= k; g *= k; b *= k;
      }
      col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b;
      em[i] = typeof o.emit === 'function' ? o.emit(local[i * 3], local[i * 3 + 1], local[i * 3 + 2]) : (o.emit || 0);
      bi[i * 4] = o.bone || 0; bw[i * 4] = 1;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('emit', new THREE.BufferAttribute(em, 1));
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(bi, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(bw, 4));
    if (!N) geo.computeVertexNormals();
    this.parts.push(geo);
    return geo;
  }
  build({ skin = false } = {}) {
    const geo = mergeAll(this.parts, skin);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    return geo;
  }
}

export function indexify(geo) {
  if (geo.index) return geo;
  const n = geo.attributes.position.count;
  const idx = new (n > 65535 ? Uint32Array : Uint16Array)(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}

function mergeAll(parts, skin) {
  let nv = 0, ni = 0;
  for (const g of parts) { nv += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), em = new Float32Array(nv);
  const si = skin ? new Uint16Array(nv * 4) : null, sw = skin ? new Float32Array(nv * 4) : null;
  const idx = new (nv > 65535 ? Uint32Array : Uint16Array)(ni);
  let vo = 0, io = 0;
  for (const g of parts) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array.subarray ? toF32(g.attributes.position) : g.attributes.position.array, vo * 3);
    nor.set(toF32(g.attributes.normal), vo * 3);
    col.set(g.attributes.color.array, vo * 3);
    em.set(g.attributes.emit.array, vo);
    if (skin) { si.set(g.attributes.skinIndex.array, vo * 4); sw.set(g.attributes.skinWeight.array, vo * 4); }
    const ia = g.index.array;
    for (let i = 0; i < ia.length; i++) idx[io + i] = ia[i] + vo;
    vo += n; io += ia.length;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('emit', new THREE.BufferAttribute(em, 1));
  if (skin) { geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4)); }
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere(); geo.computeBoundingBox();
  return geo;
}
function toF32(attr) {
  if (attr.array instanceof Float32Array && attr.itemSize === 3 && !attr.isInterleavedBufferAttribute) return attr.array;
  const a = new Float32Array(attr.count * 3);
  for (let i = 0; i < attr.count; i++) { a[i * 3] = attr.getX(i); a[i * 3 + 1] = attr.getY(i); a[i * 3 + 2] = attr.getZ(i); }
  return a;
}

// ---------- primitive shortcuts ----------
export const G = {
  sphere: (r = 1, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h),
  box: (x = 1, y = 1, z = 1) => new THREE.BoxGeometry(x, y, z),
  cyl: (rt = 0.5, rb = 0.5, h = 1, s = 10, open = false) => new THREE.CylinderGeometry(rt, rb, h, s, 1, open),
  cone: (r = 0.5, h = 1, s = 10) => new THREE.ConeGeometry(r, h, s),
  torus: (r = 1, t = 0.2, rs = 8, ts = 16, arc = Math.PI * 2) => new THREE.TorusGeometry(r, t, rs, ts, arc),
  ico: (r = 1, d = 0) => new THREE.IcosahedronGeometry(r, d),
  dodec: (r = 1, d = 0) => new THREE.DodecahedronGeometry(r, d),
  capsule: (r = 0.3, l = 1, cs = 4, rs = 10) => new THREE.CapsuleGeometry(r, l, cs, rs),
  lathe: (pts, s = 14) => new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), s),
  // curved horn / tusk: a tapered tube along a quadratic bezier
  horn(len = 0.4, r0 = 0.06, bend = 0.15, seg = 8, rs = 7) {
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, len * 0.55, bend * 0.4), new THREE.Vector3(0, len, bend));
    const g = new THREE.TubeGeometry(curve, seg, r0, rs, false);
    // taper
    const P = g.attributes.position;
    const tmp = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < P.count; i++) {
      const ring = Math.floor(i / (rs + 1)); const t = ring / seg;
      curve.getPoint(t, c);
      tmp.fromBufferAttribute(P, i).sub(c).multiplyScalar(Math.max(0.05, 1 - t * 0.95)).add(c);
      P.setXYZ(i, tmp.x, tmp.y, tmp.z);
    }
    g.computeVertexNormals();
    // cap base
    return g;
  },
  // lumpy rock: icosahedron displaced by noise
  rock(r = 1, detail = 1, amt = 0.25, seed = 1) {
    const g = new THREE.IcosahedronGeometry(r, detail);
    const P = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i);
      const k = 1 + (vnoise3(v.x * 1.7 + seed * 3.3, v.y * 1.7, v.z * 1.7) - 0.5) * amt * 2;
      v.multiplyScalar(k); P.setXYZ(i, v.x, v.y, v.z);
    }
    g.deleteAttribute('normal');
    const ng = g.index ? g.toNonIndexed() : g; ng.computeVertexNormals();
    return ng;
  },
  // flat blade polygon extruded (sword blades, cleavers, spear heads)
  extrude(shapePts, depth = 0.02, bevel = 0.006) {
    const s = new THREE.Shape(shapePts.map(p => new THREE.Vector2(p[0], p[1])));
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 6 });
    g.translate(0, 0, -depth / 2);
    return g;
  },
};
