// Static colliders for rocks, boulders and ruins, with a uniform-grid spatial hash.
// Shapes (all world space, plain objects so any physics/player code can consume them):
//   { type:'sphere', x, y, z, r, kind }
//   { type:'box', x, y, z, hx, hy, hz, rotY, kind }       oriented about Y (centre + half extents)
//   { type:'cylinder', x, y, z, r, hy, kind }              vertical axis, centre + half height
export class Colliders {
  constructor(cell = 32) { this.list = []; this.cell = cell; this.grid = new Map(); this._stamp = 0; }
  _radius(c) {
    if (c.type === 'sphere' || c.type === 'cylinder') return c.r;
    return Math.hypot(c.hx, c.hz);
  }
  add(c) {
    c._id = this.list.length;
    c._m = 0;
    this.list.push(c);
    const r = this._radius(c), s = this.cell;
    const x0 = Math.floor((c.x - r) / s), x1 = Math.floor((c.x + r) / s);
    const z0 = Math.floor((c.z - r) / s), z1 = Math.floor((c.z + r) / s);
    for (let gz = z0; gz <= z1; gz++) for (let gx = x0; gx <= x1; gx++) {
      const k = gx * 73856093 ^ gz * 19349663;
      let a = this.grid.get(k); if (!a) this.grid.set(k, a = []); a.push(c);
    }
    return c;
  }
  query(x, z, r, out = []) {
    out.length = 0;
    const s = this.cell, st = ++this._stamp;
    const x0 = Math.floor((x - r) / s), x1 = Math.floor((x + r) / s);
    const z0 = Math.floor((z - r) / s), z1 = Math.floor((z + r) / s);
    for (let gz = z0; gz <= z1; gz++) for (let gx = x0; gx <= x1; gx++) {
      const a = this.grid.get(gx * 73856093 ^ gz * 19349663);
      if (!a) continue;
      for (const c of a) {
        if (c._m === st) continue; c._m = st;
        const rr = this._radius(c) + r;
        if ((c.x - x) ** 2 + (c.z - z) ** 2 <= rr * rr) out.push(c);
      }
    }
    return out;
  }
}
