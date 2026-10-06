// Box-box contact generation: SAT over 15 axes, then reference-face clipping (face
// contacts, up to 8 points) or closest points between edges (edge-edge contact).
// Rotation matrices are column-major Float32Array(9) (columns = box axes in world).
// emit(px,py,pz, nx,ny,nz, pen, feature) with the normal pointing from B to A.

const MARGIN = 0.03;
export const STATS = { edge: 0, faceA: 0, faceB: 0 };
const T = [0, 0, 0], EN = [0, 0, 0], PA = [0, 0, 0], PB = [0, 0, 0], UA = [0, 0, 0], UB = [0, 0, 0];
const SG = [1, 1, -1, 1, -1, -1, 1, -1];
const C = new Float64Array(9), AC = new Float64Array(9);
const poly = new Float64Array(48), poly2 = new Float64Array(48);

function col(R, i, k) { return R[i * 3 + k]; }

export function boxBox(pa, Ra, ha, pb, Rb, hb, emit) {
  // T in A's frame
  const tx = pb[0] - pa[0], ty = pb[1] - pa[1], tz = pb[2] - pa[2];
  for (let i = 0; i < 3; i++) T[i] = tx * col(Ra, i, 0) + ty * col(Ra, i, 1) + tz * col(Ra, i, 2);
  // C[i][j] = Ai . Bj
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const v = col(Ra, i, 0) * col(Rb, j, 0) + col(Ra, i, 1) * col(Rb, j, 1) + col(Ra, i, 2) * col(Rb, j, 2);
    C[i * 3 + j] = v; AC[i * 3 + j] = Math.abs(v) + 1e-6;
  }
  let best = -Infinity, bestAxis = -1, bestN0 = 0, bestN1 = 0, bestN2 = 0;   // normal in world, from A to B
  // face axes of A
  for (let i = 0; i < 3; i++) {
    const ra = ha[i], rb = hb[0] * AC[i * 3] + hb[1] * AC[i * 3 + 1] + hb[2] * AC[i * 3 + 2];
    const s = Math.abs(T[i]) - (ra + rb);
    if (s > MARGIN) return 0;
    if (s > best) { best = s; bestAxis = i; const sg = T[i] < 0 ? -1 : 1; bestN0 = col(Ra, i, 0) * sg; bestN1 = col(Ra, i, 1) * sg; bestN2 = col(Ra, i, 2) * sg; }
  }
  // face axes of B
  for (let j = 0; j < 3; j++) {
    const tb = T[0] * C[j] + T[1] * C[3 + j] + T[2] * C[6 + j];
    const ra = ha[0] * AC[j] + ha[1] * AC[3 + j] + ha[2] * AC[6 + j], rb = hb[j];
    const s = Math.abs(tb) - (ra + rb);
    if (s > MARGIN) return 0;
    if (s > best + 0.002) { best = s; bestAxis = 3 + j; const sg = tb < 0 ? -1 : 1; bestN0 = col(Rb, j, 0) * sg; bestN1 = col(Rb, j, 1) * sg; bestN2 = col(Rb, j, 2) * sg; }
  }
  // edge axes Ai x Bj
  let edgeI = -1, edgeJ = -1;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const i1 = (i + 1) % 3, i2 = (i + 2) % 3, j1 = (j + 1) % 3, j2 = (j + 2) % 3;
    const ra = ha[i1] * AC[i2 * 3 + j] + ha[i2] * AC[i1 * 3 + j];
    const rb = hb[j1] * AC[i * 3 + j2] + hb[j2] * AC[i * 3 + j1];
    const tl = T[i2] * C[i1 * 3 + j] - T[i1] * C[i2 * 3 + j];
    // axis length in A frame
    const n = EN;
    n[i1] = -C[i2 * 3 + j]; n[i2] = C[i1 * 3 + j]; n[i] = 0;
    const len = Math.hypot(n[0], n[1], n[2]);
    if (len < 1e-4) continue;
    const s = (Math.abs(tl) - (ra + rb)) / len;
    if (s > MARGIN) return 0;
    if (s > best + 0.02) {
      best = s; bestAxis = 6 + i * 3 + j; edgeI = i; edgeJ = j;
      const sg = tl < 0 ? -1 : 1;
      const lx = n[0] / len * sg, ly = n[1] / len * sg, lz = n[2] / len * sg;
      bestN0 = col(Ra, 0, 0) * lx + col(Ra, 1, 0) * ly + col(Ra, 2, 0) * lz;
      bestN1 = col(Ra, 0, 1) * lx + col(Ra, 1, 1) * ly + col(Ra, 2, 1) * lz;
      bestN2 = col(Ra, 0, 2) * lx + col(Ra, 1, 2) * ly + col(Ra, 2, 2) * lz;
    }
  }
  const depth = -best;
  if (bestAxis >= 6) {
    // edge-edge: find the specific edges (support in -n for A... n points A->B)
    const pA = PA, pB = PB; pA[0] = pa[0]; pA[1] = pa[1]; pA[2] = pa[2]; pB[0] = pb[0]; pB[1] = pb[1]; pB[2] = pb[2];
    for (let k = 0; k < 3; k++) {
      if (k !== edgeI) { const d = col(Ra, k, 0) * bestN0 + col(Ra, k, 1) * bestN1 + col(Ra, k, 2) * bestN2; const s = d > 0 ? ha[k] : -ha[k]; pA[0] += col(Ra, k, 0) * s; pA[1] += col(Ra, k, 1) * s; pA[2] += col(Ra, k, 2) * s; }
      if (k !== edgeJ) { const d = col(Rb, k, 0) * bestN0 + col(Rb, k, 1) * bestN1 + col(Rb, k, 2) * bestN2; const s = d > 0 ? -hb[k] : hb[k]; pB[0] += col(Rb, k, 0) * s; pB[1] += col(Rb, k, 1) * s; pB[2] += col(Rb, k, 2) * s; }
    }
    const ua = UA, ub = UB; for (let k = 0; k < 3; k++) { ua[k] = col(Ra, edgeI, k); ub[k] = col(Rb, edgeJ, k); }
    const rx = pB[0] - pA[0], ry = pB[1] - pA[1], rz = pB[2] - pA[2];
    const d1 = ua[0] * rx + ua[1] * ry + ua[2] * rz, d2 = ub[0] * rx + ub[1] * ry + ub[2] * rz;
    const k = ua[0] * ub[0] + ua[1] * ub[1] + ua[2] * ub[2];
    const den = 1 - k * k;
    let sa = 0, sb = 0;
    if (den > 1e-5) { sa = (d1 - k * d2) / den; sb = (k * d1 - d2) / den; }
    sa = Math.max(-ha[edgeI], Math.min(ha[edgeI], sa)); sb = Math.max(-hb[edgeJ], Math.min(hb[edgeJ], sb));
    const qx = (pA[0] + ua[0] * sa + pB[0] + ub[0] * sb) * 0.5, qy = (pA[1] + ua[1] * sa + pB[1] + ub[1] * sb) * 0.5, qz = (pA[2] + ua[2] * sa + pB[2] + ub[2] * sb) * 0.5;
    STATS.edge++;
    emit(qx, qy, qz, -bestN0, -bestN1, -bestN2, depth, 50);
    return 1;
  }
  // face contact: reference box R (whose face), incident box I
  if (bestAxis < 3) STATS.faceA++; else STATS.faceB++;
  let refP, refR, refH, incP, incR, incH, nx = bestN0, ny = bestN1, nz = bestN2, flip;
  let fi;
  if (bestAxis < 3) { refP = pa; refR = Ra; refH = ha; incP = pb; incR = Rb; incH = hb; fi = bestAxis; flip = false; }
  else { refP = pb; refR = Rb; refH = hb; incP = pa; incR = Ra; incH = ha; fi = bestAxis - 3; nx = -nx; ny = -ny; nz = -nz; flip = true; }
  // now n points from ref box towards incident box
  // incident face: axis of inc most anti-parallel to n
  let minD = Infinity, ii = 0, isg = 1;
  for (let k = 0; k < 3; k++) {
    const d = col(incR, k, 0) * nx + col(incR, k, 1) * ny + col(incR, k, 2) * nz;
    if (-Math.abs(d) < minD) { minD = -Math.abs(d); ii = k; isg = d > 0 ? -1 : 1; }
  }
  // incident face corners
  const u = (ii + 1) % 3, v = (ii + 2) % 3;
  const cx = incP[0] + col(incR, ii, 0) * incH[ii] * isg, cy = incP[1] + col(incR, ii, 1) * incH[ii] * isg, cz = incP[2] + col(incR, ii, 2) * incH[ii] * isg;
  const ux = col(incR, u, 0) * incH[u], uy = col(incR, u, 1) * incH[u], uz = col(incR, u, 2) * incH[u];
  const vx = col(incR, v, 0) * incH[v], vy = col(incR, v, 1) * incH[v], vz = col(incR, v, 2) * incH[v];
  let n = 4;
  for (let k = 0; k < 4; k++) {
    poly[k * 3] = cx + ux * SG[k * 2] + vx * SG[k * 2 + 1];
    poly[k * 3 + 1] = cy + uy * SG[k * 2] + vy * SG[k * 2 + 1];
    poly[k * 3 + 2] = cz + uz * SG[k * 2] + vz * SG[k * 2 + 1];
  }
  // clip against the 4 side planes of the reference face
  const ru = (fi + 1) % 3, rv = (fi + 2) % 3;
  let src = poly, dst = poly2;
  for (let pass = 0; pass < 4; pass++) {
    const ax = pass < 2 ? ru : rv, h = refH[ax], s = pass & 1 ? -1 : 1;
    const ax0 = col(refR, ax, 0), ax1 = col(refR, ax, 1), ax2 = col(refR, ax, 2);
    const cd = refP[0] * ax0 + refP[1] * ax1 + refP[2] * ax2;
    {
      // keep points with s*(p.ax - cd) <= h
      let m = 0;
      for (let k = 0; k < n; k++) {
        const k2 = (k + 1) % n;
        const da = s * (src[k * 3] * ax0 + src[k * 3 + 1] * ax1 + src[k * 3 + 2] * ax2 - cd) - h;
        const db = s * (src[k2 * 3] * ax0 + src[k2 * 3 + 1] * ax1 + src[k2 * 3 + 2] * ax2 - cd) - h;
        if (da <= 0) { dst[m * 3] = src[k * 3]; dst[m * 3 + 1] = src[k * 3 + 1]; dst[m * 3 + 2] = src[k * 3 + 2]; m++; }
        if (((da < 0 && db > 0) || (da > 0 && db < 0)) && m < 15) {
          const t = da / (da - db);
          dst[m * 3] = src[k * 3] + (src[k2 * 3] - src[k * 3]) * t;
          dst[m * 3 + 1] = src[k * 3 + 1] + (src[k2 * 3 + 1] - src[k * 3 + 1]) * t;
          dst[m * 3 + 2] = src[k * 3 + 2] + (src[k2 * 3 + 2] - src[k * 3 + 2]) * t;
          m++;
        }
      }
      n = m; const tmp = src; src = dst; dst = tmp;
      if (n === 0) return 0;
    }
  }
  // reference face plane
  const fx = col(refR, fi, 0), fy = col(refR, fi, 1), fz = col(refR, fi, 2);
  const fs = fx * nx + fy * ny + fz * nz > 0 ? 1 : -1;
  const planeD = (refP[0] * fx + refP[1] * fy + refP[2] * fz) * fs + refH[fi];
  let cnt = 0;
  for (let k = 0; k < n; k++) {
    const px = src[k * 3], py = src[k * 3 + 1], pz = src[k * 3 + 2];
    // drop near-duplicates produced by clipping along nearly coincident edges
    let dup = false;
    for (let j = 0; j < k; j++) { const dx = src[j * 3] - px, dy = src[j * 3 + 1] - py, dz = src[j * 3 + 2] - pz; if (dx * dx + dy * dy + dz * dz < 0.0009) { dup = true; break; } }
    if (dup) continue;
    const sep = (px * fx + py * fy + pz * fz) * fs - planeD;
    if (sep < MARGIN) {
      const pen = -sep;
      // contact point halfway (on incident surface); normal from B to A
      const ox = flip ? nx : -nx, oy = flip ? ny : -ny, oz = flip ? nz : -nz;
      emit(px, py, pz, ox, oy, oz, pen, 20 + k);
      cnt++;
    }
  }
  return cnt;
}
