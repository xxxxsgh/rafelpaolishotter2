// Small procedural modelling kit for gameplay props (ingredients, dishes, pots, campfires,
// spires, the summit beacon). Primitives are transformed, vertex-coloured with optional
// gradients / painterly value jitter and an emissive amount, then merged into ONE indexed
// BufferGeometry with `position, normal, color, emit` attributes (see toon.js).
import * as THREE from 'three';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color(), _c2 = new THREE.Color();

export function hash(n) { const h = Math.sin(n * 127.1 + 311.7) * 43758.5453; return h - Math.floor(h); }
export function hash2(x, z) { const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return h - Math.floor(h); }
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function vnoise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const h = (a, b, c) => { const v = Math.sin((ix + a) * 127.1 + (iy + b) * 311.7 + (iz + c) * 74.7) * 43758.5453; return v - Math.floor(v); };
  const L = (a, b, t) => a + (b - a) * t;
  return L(L(L(h(0, 0, 0), h(1, 0, 0), ux), L(h(0, 1, 0), h(1, 1, 0), ux), uy),
           L(L(h(0, 0, 1), h(1, 0, 1), ux), L(h(0, 1, 1), h(1, 1, 1), ux), uy), uz);
}

export class Kit {
  constructor() { this.parts = []; }
  // o: {pos, rot, scl, order, color, color2, grad(x,y,z local)->0..1, colorFn(wx,wy,wz,lx,ly,lz)->hex|null, emit, jitter, flat}
  add(geo, o = {}) {
    if (o.flat) { geo = geo.index ? geo.toNonIndexed() : geo; geo.computeVertexNormals(); }
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const pos = o.pos || [0, 0, 0], rot = o.rot || [0, 0, 0];
    const scl = o.scl === undefined ? [1, 1, 1] : (typeof o.scl === 'number' ? [o.scl, o.scl, o.scl] : o.scl);
    _q.setFromEuler(_e.set(rot[0], rot[1], rot[2], o.order || 'XYZ'));
    _m.compose(_p.set(pos[0], pos[1], pos[2]), _q, _s.set(scl[0], scl[1], scl[2]));
    if (o.matrix) _m.premultiply(o.matrix);
    const P = geo.attributes.position, n = P.count;
    const local = new Float32Array(P.array.length); local.set(P.array);
    geo.applyMatrix4(_m);
    if (o.keepColors && geo.attributes.color) { this.parts.push(geo); return this; }
    const col = new Float32Array(n * 3), em = new Float32Array(n);
    _c.set(o.color ?? 0xffffff); if (o.color2 !== undefined) _c2.set(o.color2);
    const jit = o.jitter ?? 0.1, js = o.jitterScale ?? 9;
    for (let i = 0; i < n; i++) {
      const lx = local[i * 3], ly = local[i * 3 + 1], lz = local[i * 3 + 2];
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      let r = _c.r, g = _c.g, b = _c.b;
      if (o.color2 !== undefined && o.grad) {
        const t = Math.max(0, Math.min(1, o.grad(lx, ly, lz)));
        r += (_c2.r - r) * t; g += (_c2.g - g) * t; b += (_c2.b - b) * t;
      }
      if (o.colorFn) { const cc = o.colorFn(x, y, z, lx, ly, lz); if (cc !== null && cc !== undefined) { const t = new THREE.Color(cc); r = t.r; g = t.g; b = t.b; } }
      const k = 1 + (vnoise(x * js, y * js, z * js) - 0.5) * 2 * jit;
      col[i * 3] = r * k; col[i * 3 + 1] = g * k; col[i * 3 + 2] = b * k;
      em[i] = typeof o.emit === 'function' ? o.emit(lx, ly, lz) : (o.emit || 0);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('emit', new THREE.BufferAttribute(em, 1));
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'color', 'emit'].includes(k)) geo.deleteAttribute(k);
    if (!geo.index) { const idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i; geo.setIndex(new THREE.BufferAttribute(idx, 1)); }
    this.parts.push(geo);
    return this;
  }
  build() {
    let nv = 0, ni = 0;
    for (const g of this.parts) { nv += g.attributes.position.count; ni += g.index.count; }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), em = new Float32Array(nv);
    const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let ov = 0, oi = 0;
    for (const g of this.parts) {
      const c = g.attributes.position.count;
      pos.set(g.attributes.position.array, ov * 3); nor.set(g.attributes.normal.array, ov * 3);
      col.set(g.attributes.color.array, ov * 3); em.set(g.attributes.emit.array, ov);
      const I = g.index.array; for (let i = 0; i < I.length; i++) idx[oi + i] = I[i] + ov;
      ov += c; oi += I.length; g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.setAttribute('emit', new THREE.BufferAttribute(em, 1));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    out.computeBoundingSphere(); out.computeBoundingBox();
    this.parts = [];
    return out;
  }
}

// ---------------------------------------------------------------- primitives
export const P = {
  sphere: (r, w = 12, h = 8) => new THREE.SphereGeometry(r, w, h),
  hemi: (r, w = 14, h = 6) => new THREE.SphereGeometry(r, w, h, 0, Math.PI * 2, 0, Math.PI / 2),
  cyl: (rt, rb, h, s = 10, open = false) => new THREE.CylinderGeometry(rt, rb, h, s, 1, open),
  cone: (r, h, s = 8) => new THREE.ConeGeometry(r, h, s),
  box: (x, y, z) => new THREE.BoxGeometry(x, y, z),
  torus: (r, t, rs = 6, ts = 16, arc = Math.PI * 2) => new THREE.TorusGeometry(r, t, rs, ts, arc),
  ico: (r, d = 0) => new THREE.IcosahedronGeometry(r, d),
  dodec: (r) => new THREE.DodecahedronGeometry(r, 0),
  oct: (r) => new THREE.OctahedronGeometry(r, 0),
  lathe: (pts, s = 16) => new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), s),
  capsule: (r, l, cs = 4, rs = 8) => new THREE.CapsuleGeometry(r, l, cs, rs),
  // lumpy rock: icosphere with low-frequency displacement
  rock(r, seed = 1, rough = 0.28, detail = 1) {
    const g = new THREE.IcosahedronGeometry(r, detail);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 1 + (vnoise(x / r * 1.6 + seed, y / r * 1.6, z / r * 1.6 - seed) - 0.5) * 2 * rough;
      p.setXYZ(i, x * k, y * k * 0.82, z * k);
    }
    g.computeVertexNormals();
    return g;
  },
  // flat leaf blade (double-sided via two faces), pointing +y, width w, length l, bend
  leaf(w, l, bend = 0.15, segs = 4) {
    const pos = [], idx = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs, ww = w * Math.sin(Math.PI * Math.min(1, t * 0.95 + 0.05)) * (1 - t * 0.35);
      const y = t * l, z = bend * l * t * t;
      pos.push(-ww / 2, y, z, ww / 2, y, z);
    }
    for (let i = 0; i < segs; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    return g;
  },
};
