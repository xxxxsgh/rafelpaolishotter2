// CDLOD-style quadtree terrain streaming.
// Nodes are built (in workers when available) as fixed-resolution grids; selection is by
// camera distance to node AABB; vertices geomorph towards the parent level in the vertex
// shader so LOD transitions don't pop, and skirts hide any residual T-junction cracks.
import { buildChunk, buildIndex } from './chunkBuilder.js';

export class TerrainLOD {
  constructor(ctx, mats, opts = {}) {
    const { THREE } = ctx;
    this.ctx = ctx; this.THREE = THREE; this.mats = mats;
    this.N = opts.N ?? 64;
    this.rootSize = opts.rootSize ?? 4096;
    this.maxDepth = opts.maxDepth ?? 6;          // leaf = 4096 / 64 = 64 m, 1 m spacing
    this.K = opts.K ?? 1.3;                      // split when dist < size * K
    this.sync = !!opts.sync;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    ctx.scene.add(this.group);
    this.cache = new Map();                      // key -> rec
    this.frame = 0;
    this.index = new THREE.BufferAttribute(buildIndex(this.N), 1);
    this.pending = new Map();                    // id -> rec
    this.queue = [];
    this.nextId = 1;
    this.selected = [];
    this.maxCache = 600;
    this.budgetSync = opts.budgetSync ?? 2;      // main-thread builds per frame when no workers
    this.workers = [];
    this.inflight = 0;
    if (!this.sync && typeof Worker !== 'undefined') {
      const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
      for (let i = 0; i < n; i++) {
        try {
          const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
          w.onmessage = (e) => this._onResult(e.data);
          w.onerror = (e) => { console.warn('[terrain] worker error', e.message); this._workerFailed = true; };
          this.workers.push(w);
        } catch (e) { console.warn('[terrain] workers unavailable, building on main thread'); break; }
      }
    }
    for (let d = 0; d < this.mats.length; d++) {
      const S = this.rootSize / (1 << d);
      const end = 2 * S * this.K, start = end * 0.62;
      this.mats[d].uniforms.uMorphRange.value.set(d === 0 ? 1e7 : start, d === 0 ? 1e7 + 1 : end);
    }
    // Root + first levels synchronously so something is always drawable.
    this._buildSync(0, 0, 0);
    for (let d = 1; d <= 2; d++) {
      const n = 1 << d;
      for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) this._buildSync(d, ix, iz);
    }
  }

  key(d, ix, iz) { return d * 1e8 + iz * 1e4 + ix; }

  _nodeBounds(d, ix, iz) {
    const S = this.rootSize / (1 << d);
    return { S, x0: -this.rootSize / 2 + ix * S, z0: -this.rootSize / 2 + iz * S };
  }

  _buildSync(d, ix, iz) {
    const k = this.key(d, ix, iz);
    let rec = this.cache.get(k);
    if (rec && rec.mesh) return rec;
    const { S, x0, z0 } = this._nodeBounds(d, ix, iz);
    const r = buildChunk(x0, z0, S, this.N);
    rec = rec || { d, ix, iz, key: k };
    this._finish(rec, r);
    this.cache.set(k, rec);
    return rec;
  }

  _finish(rec, r) {
    const THREE = this.THREE;
    const { S, x0, z0 } = this._nodeBounds(rec.d, rec.ix, rec.iz);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(r.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(r.nor, 3));
    g.setAttribute('aMorph', new THREE.BufferAttribute(r.morph, 4));
    g.setAttribute('aSurf', new THREE.BufferAttribute(r.surf, 4));
    g.setIndex(this.index);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(x0, r.minY, z0), new THREE.Vector3(x0 + S, r.maxY, z0 + S));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    const mesh = new THREE.Mesh(g, this.mats[Math.min(rec.d, this.mats.length - 1)]);
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = true;
    mesh.castShadow = rec.d >= 4;
    mesh.visible = false;
    mesh.name = `terrain-${rec.d}-${rec.ix}-${rec.iz}`;
    this.group.add(mesh);
    rec.mesh = mesh; rec.minY = r.minY; rec.maxY = r.maxY; rec.state = 'ready';
  }

  _onResult(data) {
    if (data.ready) return;
    const rec = this.pending.get(data.id);
    this.pending.delete(data.id);
    this.inflight--;
    if (!rec) return;
    if (data.error) { console.error('[terrain] chunk build failed', data.error); rec.state = 'failed'; return; }
    if (rec.evicted) return;
    this._finish(rec, data);
  }

  _request(d, ix, iz, pri) {
    const k = this.key(d, ix, iz);
    let rec = this.cache.get(k);
    if (rec) { rec.last = this.frame; if (rec.state === 'queued') rec.pri = Math.min(rec.pri, pri); return; }
    rec = { d, ix, iz, key: k, state: 'queued', pri, last: this.frame };
    this.cache.set(k, rec);
    this.queue.push(rec);
  }

  _ready(d, ix, iz) {
    const rec = this.cache.get(this.key(d, ix, iz));
    return rec && rec.state === 'ready' ? rec : null;
  }

  _dist(cam, x0, z0, S, minY, maxY) {
    const dx = Math.max(x0 - cam.x, 0, cam.x - (x0 + S));
    const dz = Math.max(z0 - cam.z, 0, cam.z - (z0 + S));
    const dy = Math.max(minY - cam.y, 0, cam.y - maxY);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  _visit(cam, d, ix, iz, minY, maxY) {
    const rec = this._ready(d, ix, iz);
    if (rec) { rec.last = this.frame; minY = rec.minY; maxY = rec.maxY; }
    const { S, x0, z0 } = this._nodeBounds(d, ix, iz);
    const dist = this._dist(cam, x0, z0, S, minY, maxY);
    if (d < this.maxDepth && dist < S * this.K) {
      const cd = d + 1, cx = ix * 2, cz = iz * 2;
      let all = true;
      for (let c = 0; c < 4; c++) {
        const ccx = cx + (c & 1), ccz = cz + (c >> 1);
        const cr = this._ready(cd, ccx, ccz);
        if (!cr) {
          all = false;
          const b = this._nodeBounds(cd, ccx, ccz);
          this._request(cd, ccx, ccz, cd * 10000 + this._dist(cam, b.x0, b.z0, b.S, minY, maxY));
        } else cr.last = this.frame;
      }
      if (all) {
        for (let c = 0; c < 4; c++) this._visit(cam, cd, cx + (c & 1), cz + (c >> 1), minY, maxY);
        return;
      }
    }
    if (rec) this.selected.push(rec);
  }

  update(cam) {
    this.frame++;
    for (const r of this.selected) r.mesh.visible = false;
    this.selected.length = 0;
    this._visit(cam, 0, 0, 0, -50, 600);
    for (const r of this.selected) r.mesh.visible = true;
    this._pump();
    if (this.cache.size > this.maxCache) this._evict();
  }

  // Build everything the current view wants (used for screenshots / teleports).
  settle(cam, maxIter = 12) {
    for (let i = 0; i < maxIter; i++) {
      this.update(cam);
      if (!this.queue.length && !this.pending.size) break;
      for (const rec of this.queue) {
        if (rec.state !== 'queued') continue;
        const { S, x0, z0 } = this._nodeBounds(rec.d, rec.ix, rec.iz);
        this._finish(rec, buildChunk(x0, z0, S, this.N));
      }
      this.queue.length = 0;
    }
    this.update(cam);
  }

  _pump() {
    if (!this.queue.length) return;
    // drop stale requests
    this.queue = this.queue.filter(r => {
      if (r.state !== 'queued') return false;
      if (this.frame - r.last > 2) { this.cache.delete(r.key); return false; }
      return true;
    });
    this.queue.sort((a, b) => a.pri - b.pri);
    const useWorkers = this.workers.length && !this._workerFailed && !this.sync;
    if (useWorkers) {
      const maxIn = this.workers.length * 2;
      while (this.queue.length && this.inflight < maxIn) {
        const rec = this.queue.shift();
        const { S, x0, z0 } = this._nodeBounds(rec.d, rec.ix, rec.iz);
        const id = this.nextId++;
        rec.state = 'building';
        this.pending.set(id, rec);
        this.inflight++;
        this.workers[id % this.workers.length].postMessage({ id, x0, z0, size: S, N: this.N });
      }
    } else {
      const t0 = performance.now();
      let n = 0;
      while (this.queue.length && (n < this.budgetSync || this.sync) && (performance.now() - t0 < 8 || this.sync)) {
        const rec = this.queue.shift();
        const { S, x0, z0 } = this._nodeBounds(rec.d, rec.ix, rec.iz);
        this._finish(rec, buildChunk(x0, z0, S, this.N));
        n++;
      }
    }
  }

  _evict() {
    const recs = [...this.cache.values()].filter(r => r.state === 'ready' && r.d > 2 && this.frame - r.last > 30);
    recs.sort((a, b) => a.last - b.last);
    const remove = this.cache.size - this.maxCache * 0.8;
    for (let i = 0; i < recs.length && i < remove; i++) {
      const r = recs[i];
      this.group.remove(r.mesh);
      r.mesh.geometry.dispose();
      r.mesh = null; r.evicted = true;
      this.cache.delete(r.key);
    }
  }
}
