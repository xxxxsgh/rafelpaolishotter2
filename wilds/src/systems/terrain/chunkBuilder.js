// Builds vertex data for one terrain quadtree node. Pure JS (no three) so it runs in
// a module worker or on the main thread.
//
// Layout: (N+1)^2 grid vertices followed by 4N skirt vertices (perimeter ring, lowered).
// Attributes:
//   position  vec3  world-space
//   normal    vec3  fine normal
//   aMorph    vec4  (dh to the parent-level surface, parent-level normal xyz) — CDLOD geomorph
//   aSurf     vec4  (river/wet mask, forest factor, mesa factor, cavity/AO)
import { getHeight, getRiverMask, forestFactor, mesaFactor } from '../../world/heightfield.js';

export function perimeter(N) {
  // indices of grid vertices around the edge, in order (counter-clockwise loop)
  const idx = [];
  const V = N + 1;
  for (let i = 0; i < N; i++) idx.push(i);                    // top row  (z = 0), x increasing
  for (let j = 0; j < N; j++) idx.push(j * V + N);            // right col (x = N), z increasing
  for (let i = N; i > 0; i--) idx.push(N * V + i);            // bottom row, x decreasing
  for (let j = N; j > 0; j--) idx.push(j * V);                // left col, z decreasing
  return idx;
}

export function buildIndex(N) {
  const V = N + 1;
  const tris = [];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * V + i, b = a + 1, c = a + V, d = c + 1;
      // diagonal a-d everywhere (keeps fine surface == parent surface at full morph)
      tris.push(a, c, d, a, d, b);
    }
  }
  const per = perimeter(N), base = V * V, P = per.length;
  for (let k = 0; k < P; k++) {
    const a = per[k], b = per[(k + 1) % P], sa = base + k, sb = base + (k + 1) % P;
    tris.push(a, b, sa, b, sb, sa);
  }
  return new Uint16Array(tris);
}

export function buildChunk(x0, z0, size, N) {
  const V = N + 1, B = 2, G = N + 1 + 2 * B;     // height grid with 2-sample border
  const s = size / N;
  const H = new Float32Array(G * G);
  for (let j = 0; j < G; j++) {
    const z = z0 + (j - B) * s;
    for (let i = 0; i < G; i++) H[j * G + i] = getHeight(x0 + (i - B) * s, z);
  }
  const h = (i, j) => H[(j + B) * G + (i + B)];
  const per = perimeter(N);
  const count = V * V + per.length;
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3);
  const morph = new Float32Array(count * 4), surf = new Float32Array(count * 4);
  let minY = 1e9, maxY = -1e9;

  // coarse (parent-level) normals at even vertices, spacing 2s
  const cn = (i, j, out, o) => {
    const hx = h(i + 2, j) - h(i - 2, j), hz = h(i, j + 2) - h(i, j - 2);
    const l = Math.hypot(hx, 4 * s, hz);
    out[o] = -hx / l; out[o + 1] = 4 * s / l; out[o + 2] = -hz / l;
  };
  const tA = new Float32Array(3), tB = new Float32Array(3);

  for (let j = 0; j < V; j++) {
    for (let i = 0; i < V; i++) {
      const k = j * V + i;
      const x = x0 + i * s, z = z0 + j * s, y = h(i, j);
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      const hx = h(i + 1, j) - h(i - 1, j), hz = h(i, j + 1) - h(i, j - 1);
      const l = Math.hypot(hx, 2 * s, hz);
      nor[k * 3] = -hx / l; nor[k * 3 + 1] = 2 * s / l; nor[k * 3 + 2] = -hz / l;
      // morph target
      const oi = i & 1, oj = j & 1;
      let ph;
      if (!oi && !oj) { ph = y; cn(i, j, tA, 0); morph[k * 4 + 1] = tA[0]; morph[k * 4 + 2] = tA[1]; morph[k * 4 + 3] = tA[2]; }
      else {
        let ai, aj, bi, bj;
        if (oi && !oj) { ai = i - 1; aj = j; bi = i + 1; bj = j; }
        else if (!oi && oj) { ai = i; aj = j - 1; bi = i; bj = j + 1; }
        else { ai = i - 1; aj = j - 1; bi = i + 1; bj = j + 1; }
        ph = 0.5 * (h(ai, aj) + h(bi, bj));
        cn(ai, aj, tA, 0); cn(bi, bj, tB, 0);
        const nx = tA[0] + tB[0], ny = tA[1] + tB[1], nz = tA[2] + tB[2], nl = Math.hypot(nx, ny, nz);
        morph[k * 4 + 1] = nx / nl; morph[k * 4 + 2] = ny / nl; morph[k * 4 + 3] = nz / nl;
      }
      morph[k * 4] = ph - y;
      // surface hints
      const lap = (h(i + 1, j) + h(i - 1, j) + h(i, j + 1) + h(i, j - 1)) * 0.25 - y;
      surf[k * 4] = getRiverMask(x, z);
      surf[k * 4 + 1] = forestFactor(x, z);
      surf[k * 4 + 2] = mesaFactor(x, z);
      surf[k * 4 + 3] = Math.max(-1, Math.min(1, lap / (0.35 + s * 0.08)));
    }
  }
  // skirts
  const skirt = Math.max(2, s * 1.5);
  const base = V * V;
  for (let p = 0; p < per.length; p++) {
    const src = per[p], dst = base + p;
    pos[dst * 3] = pos[src * 3]; pos[dst * 3 + 1] = pos[src * 3 + 1] - skirt; pos[dst * 3 + 2] = pos[src * 3 + 2];
    for (let c = 0; c < 3; c++) nor[dst * 3 + c] = nor[src * 3 + c];
    for (let c = 0; c < 4; c++) { morph[dst * 4 + c] = morph[src * 4 + c]; surf[dst * 4 + c] = surf[src * 4 + c]; }
  }
  return { pos, nor, morph, surf, minY: minY - skirt, maxY };
}
