// Verlet secondary motion: the travel cloak (pinned cloth grid) and the two scarf tails
// (ribbons). Simulated in world space at a fixed substep, colliding with body capsules,
// pushed by the shared wind uniforms + relative airflow. No per-frame allocations.
import { makeToonMaterial } from './toon.js';

function cloakTexture(THREE) {
  const W = 256, H = 256, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  // base: deep teal with soft painterly variation (multiplied by vertex colour = white)
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, '#2a7372'); grd.addColorStop(0.55, '#1f6164'); grd.addColorStop(1, '#1a5559');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  g.globalAlpha = 0.08;
  for (let i = 0; i < 40; i++) {
    g.fillStyle = i % 2 ? '#3d8a84' : '#14474b';
    g.beginPath(); g.ellipse(Math.random() * W, Math.random() * H, 20 + Math.random() * 40, 6 + Math.random() * 12, Math.random(), 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
  // embroidered hem: cream band with a repeating wind-wave motif and rust stitch line
  const hy = H - 34;
  g.fillStyle = '#e8d9b0'; g.fillRect(0, hy, W, 22);
  g.fillStyle = '#b8472a'; g.fillRect(0, hy + 24, W, 4);
  g.strokeStyle = '#1d5a5e'; g.lineWidth = 3;
  for (let x = 0; x < W; x += 32) {
    g.beginPath(); g.moveTo(x + 2, hy + 15); g.bezierCurveTo(x + 8, hy + 2, x + 18, hy + 2, x + 16, hy + 11);
    g.bezierCurveTo(x + 15, hy + 15, x + 10, hy + 14, x + 11, hy + 10); g.stroke();
    g.beginPath(); g.moveTo(x + 18, hy + 18); g.lineTo(x + 30, hy + 18); g.stroke();
  }
  g.fillStyle = '#c79a52'; g.fillRect(0, H - 8, W, 8);
  // back emblem: a stylised feather/compass sigil in faded cream
  g.save(); g.translate(W / 2, H * 0.36); g.globalAlpha = 0.55;
  g.strokeStyle = '#e8d9b0'; g.lineWidth = 4; g.lineCap = 'round';
  g.beginPath(); g.arc(0, 0, 30, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 3;
  g.beginPath(); g.moveTo(0, 26); g.quadraticCurveTo(-4, -2, 0, -40); g.quadraticCurveTo(12, -10, 0, 26); g.stroke();
  for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(0, 14 - i * 11); g.lineTo(-14 + i * 2, 4 - i * 11); g.stroke(); }
  g.beginPath(); g.moveTo(-40, 0); g.lineTo(-33, 0); g.moveTo(33, 0); g.lineTo(40, 0); g.stroke();
  g.restore();
  // side seams
  g.fillStyle = 'rgba(10,40,44,0.35)'; g.fillRect(0, 0, 5, H); g.fillRect(W - 5, 0, 5, H);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function scarfTexture(THREE) {
  const cv = document.createElement('canvas'); cv.width = 32; cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = '#c4502b'; g.fillRect(0, 0, 32, 128);
  g.fillStyle = '#f0d9a8';
  for (let y = 18; y < 128; y += 34) g.fillRect(0, y, 32, 5);
  g.fillStyle = '#8e3320'; g.fillRect(0, 0, 3, 128); g.fillRect(29, 0, 3, 128);
  g.fillStyle = '#f0d9a8'; g.fillRect(0, 118, 32, 10);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createCloth(ctx, rig) {
  const { THREE, uniforms: U } = ctx;
  // ---------------- cloak grid ----------------
  const CW = 9, CH = 12, N = CW * CH;
  const pos = new Float32Array(N * 3), prev = new Float32Array(N * 3);
  const pinLocal = [];   // chest-local anchor positions for top row
  for (let i = 0; i < CW; i++) {
    const t = i / (CW - 1), a = (t - 0.5) * 2.7;
    // around the back of the shoulders, wrapping toward the front at the ends
    pinLocal.push(new THREE.Vector3(Math.sin(a) * 0.235, 0.07 - Math.abs(t - 0.5) * 0.04, -Math.cos(a) * 0.17 - 0.035));
  }
  const topSpace = new THREE.Vector3().subVectors(pinLocal[1], pinLocal[0]).length();
  const rowLen = 0.088;
  const cons = [];   // [a, b, rest, stiffness]
  const id = (i, j) => j * CW + i;
  for (let j = 0; j < CH; j++) for (let i = 0; i < CW; i++) {
    const flare = 1 + (j / (CH - 1)) * 0.8;
    if (i < CW - 1) cons.push(id(i, j), id(i + 1, j), topSpace * flare, 1);
    if (j < CH - 1) cons.push(id(i, j), id(i, j + 1), rowLen, 1);
    if (i < CW - 1 && j < CH - 1) {
      const d = Math.hypot(topSpace * flare, rowLen);
      cons.push(id(i, j), id(i + 1, j + 1), d, 0.5, id(i + 1, j), id(i, j + 1), d, 0.5);
    }
    if (j < CH - 2) cons.push(id(i, j), id(i, j + 2), rowLen * 2, 0.35);
    if (i < CW - 2) cons.push(id(i, j), id(i + 2, j), topSpace * flare * 2 * 0.98, 0.25);
  }
  const C = new Float32Array(cons);
  // rest shape (chest-local): drapes around the back and flares, used as weak shape memory
  const restL = new Float32Array(N * 3), restW = new Float32Array(N * 3), memK = new Float32Array(CH);
  for (let j = 0; j < CH; j++) {
    const v = j / (CH - 1);
    memK[j] = 0.06 * (1 - v) * (1 - v) + 0.006;
    for (let i = 0; i < CW; i++) {
      const a0 = pinLocal[i], u = i / (CW - 1) - 0.5;
      const k = id(i, j) * 3;
      const flare = 1 + v * 0.8;
      restL[k] = a0.x * flare + u * 0.05 * v;
      restL[k + 1] = a0.y - j * rowLen * 0.97;
      restL[k + 2] = a0.z * (1 + v * 0.35) - v * 0.1 - Math.sin(v * Math.PI) * 0.03;
    }
  }
  const NC = C.length / 4;

  const cgeo = new THREE.BufferGeometry();
  const cpos = new THREE.BufferAttribute(new Float32Array(N * 3), 3); cpos.setUsage(THREE.DynamicDrawUsage);
  const cuv = new Float32Array(N * 2), ccol = new Float32Array(N * 3).fill(1);
  for (let j = 0; j < CH; j++) for (let i = 0; i < CW; i++) { cuv[id(i, j) * 2] = i / (CW - 1); cuv[id(i, j) * 2 + 1] = 1 - j / (CH - 1); }
  const cidx = [];
  for (let j = 0; j < CH - 1; j++) for (let i = 0; i < CW - 1; i++) {
    const a = id(i, j), b = id(i + 1, j), c = id(i, j + 1), d = id(i + 1, j + 1);
    cidx.push(a, c, b, b, c, d);
  }
  cgeo.setAttribute('position', cpos);
  cgeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  cgeo.setAttribute('uv', new THREE.BufferAttribute(cuv, 2));
  cgeo.setAttribute('color', new THREE.BufferAttribute(ccol, 3));
  cgeo.setIndex(cidx);
  const cloakMat = makeToonMaterial(ctx, { map: cloakTexture(THREE), side: THREE.DoubleSide, ink: 0.85, sheen: 0.6 });
  const cloak = new THREE.Mesh(cgeo, cloakMat);
  cloak.frustumCulled = false; cloak.castShadow = true; cloak.receiveShadow = true;
  cloak.name = 'player-cloak';

  // ---------------- scarf tails ----------------
  const SN = 9, TAILS = 2, SL = 0.07;
  const spos = new Float32Array(TAILS * SN * 3), sprev = new Float32Array(TAILS * SN * 3);
  const sAnchor = [new THREE.Vector3(0.035, 0.0, -0.085), new THREE.Vector3(-0.02, -0.01, -0.09)];
  const tailLen = [SN, SN - 2];
  const sgeo = new THREE.BufferGeometry();
  const sp = new THREE.BufferAttribute(new Float32Array(TAILS * SN * 2 * 3), 3); sp.setUsage(THREE.DynamicDrawUsage);
  const suv = new Float32Array(TAILS * SN * 2 * 2), scol = new Float32Array(TAILS * SN * 2 * 3).fill(1);
  const sidx = [];
  for (let t = 0; t < TAILS; t++) for (let k = 0; k < SN; k++) {
    const v = (t * SN + k) * 2;
    suv[v * 2] = 0; suv[v * 2 + 1] = k / (SN - 1); suv[v * 2 + 2] = 1; suv[v * 2 + 3] = k / (SN - 1);
    if (k < tailLen[t] - 1) sidx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
  }
  sgeo.setAttribute('position', sp);
  sgeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(TAILS * SN * 2 * 3), 3));
  sgeo.setAttribute('uv', new THREE.BufferAttribute(suv, 2));
  sgeo.setAttribute('color', new THREE.BufferAttribute(scol, 3));
  sgeo.setIndex(sidx);
  const scarf = new THREE.Mesh(sgeo, makeToonMaterial(ctx, { map: scarfTexture(THREE), side: THREE.DoubleSide, ink: 0.7, sheen: 0.3 }));
  scarf.frustumCulled = false; scarf.castShadow = true; scarf.receiveShadow = true;
  scarf.name = 'player-scarf';

  // ---------------- colliders (capsules, world space) ----------------
  const caps = [];   // {a:Vector3, b:Vector3, r}
  for (let i = 0; i < 7; i++) caps.push({ a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0.1 });
  const B = rig.bones;
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3(), tmpD = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  function boneWorld(b, out, lx = 0, ly = 0, lz = 0) { return out.set(lx, ly, lz).applyMatrix4(b.matrixWorld); }
  function updateCaps() {
    boneWorld(B.hips, caps[0].a, 0, -0.08, -0.01); boneWorld(B.chest, caps[0].b, 0, 0.1, -0.02); caps[0].r = 0.19;
    boneWorld(B.thighL, caps[1].a); boneWorld(B.shinL, caps[1].b); caps[1].r = 0.105;
    boneWorld(B.thighR, caps[2].a); boneWorld(B.shinR, caps[2].b); caps[2].r = 0.105;
    boneWorld(B.shinL, caps[3].a); boneWorld(B.footL, caps[3].b); caps[3].r = 0.085;
    boneWorld(B.shinR, caps[4].a); boneWorld(B.footR, caps[4].b); caps[4].r = 0.085;
    boneWorld(B.hips, caps[5].a, 0.19, -0.07, 0.03); boneWorld(B.hips, caps[5].b, 0.19, 0.0, 0.03); caps[5].r = 0.11;   // satchel
    boneWorld(B.spine, caps[6].a, -0.13, 0.06, -0.13); boneWorld(B.spine, caps[6].b, 0.13, 0.06, -0.13); caps[6].r = 0.075; // pack
  }
  function collide(arr, i) {
    const px = arr[i], py = arr[i + 1], pz = arr[i + 2];
    for (let c = 0; c < caps.length; c++) {
      const cp = caps[c];
      const abx = cp.b.x - cp.a.x, aby = cp.b.y - cp.a.y, abz = cp.b.z - cp.a.z;
      const l2 = abx * abx + aby * aby + abz * abz || 1;
      let t = ((px - cp.a.x) * abx + (py - cp.a.y) * aby + (pz - cp.a.z) * abz) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = cp.a.x + abx * t, qy = cp.a.y + aby * t, qz = cp.a.z + abz * t;
      let dx = arr[i] - qx, dy = arr[i + 1] - qy, dz = arr[i + 2] - qz;
      const d2 = dx * dx + dy * dy + dz * dz, r = cp.r + 0.012;
      if (d2 < r * r) {
        const d = Math.sqrt(d2) || 1e-4, k = (r - d) / d;
        arr[i] += dx * k; arr[i + 1] += dy * k; arr[i + 2] += dz * k;
      }
    }
  }

  const anchorW = [];
  for (let i = 0; i < CW; i++) anchorW.push(new THREE.Vector3());
  const sAnchorW = [new THREE.Vector3(), new THREE.Vector3()];
  let groundY = 0, firstRun = true;
  const wind = new THREE.Vector3(), back = new THREE.Vector3(), down = new THREE.Vector3();

  function reset() {
    rig.mesh.updateMatrixWorld(true);
    updateAnchors();
    back.set(0, 0, -1).transformDirection(rig.mesh.matrixWorld);
    pos.set(restW); prev.set(restW);
    for (let t = 0; t < TAILS; t++) for (let s = 0; s < SN; s++) {
      const k = (t * SN + s) * 3;
      tmpA.copy(sAnchorW[t]).addScaledVector(back, s * SL * 0.4); tmpA.y -= s * SL * 0.9;
      spos[k] = sprev[k] = tmpA.x; spos[k + 1] = sprev[k + 1] = tmpA.y; spos[k + 2] = sprev[k + 2] = tmpA.z;
    }
    firstRun = false;
  }
  function updateAnchors() {
    for (let i = 0; i < CW; i++) anchorW[i].copy(pinLocal[i]).applyMatrix4(B.chest.matrixWorld);
    // rest targets follow the hips/yaw (not chest lean) so the cloak keeps hanging with gravity
    const m = B.chest.matrixWorld.elements;
    for (let k = 0; k < N * 3; k += 3) {
      const x = restL[k], y = restL[k + 1], z = restL[k + 2];
      restW[k] = m[0] * x + m[4] * y + m[8] * z + m[12];
      restW[k + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      restW[k + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    }
    for (let t = 0; t < TAILS; t++) sAnchorW[t].copy(sAnchor[t]).applyMatrix4(B.neck.matrixWorld);
  }

  let acc = 0;
  const STEP = 1 / 90;
  // opts: {velocity: Vector3 (character velocity), ground: y, glide: 0..1, gust}
  function update(dt, opts) {
    rig.mesh.updateMatrixWorld(true);
    if (firstRun) reset();
    groundY = opts.ground;
    updateAnchors();
    updateCaps();
    acc += Math.min(dt, 0.1);
    let steps = 0;
    while (acc >= STEP && steps < 6) { acc -= STEP; steps++; step(STEP, opts); }
    if (steps === 6) acc = 0;
    writeMeshes();
  }
  function step(h, opts) {
    const t = U.uTime.value;
    const ws = U.uWindStrength.value, wd = U.uWindDir.value;
    const gust = 0.55 + 0.45 * Math.sin(t * 1.3) * Math.sin(t * 0.37 + 1.0) + (opts.gust || 0);
    // air relative to the cloth: world wind minus character motion
    wind.set(wd.x * ws * 4.0 * gust, 0.25 * ws * gust, wd.y * ws * 4.0 * gust).addScaledVector(opts.velocity, -1);
    const drag = 0.985, g = -9.8 * (1 - (opts.lift || 0));
    const spd = Math.hypot(opts.velocity.x, opts.velocity.y, opts.velocity.z);
    const memAmt = (opts.memory ?? 1) / (1 + spd * 0.45);
    const h2 = h * h;
    // cloak
    for (let j = 0; j < CH; j++) for (let i = 0; i < CW; i++) {
      const k = id(i, j) * 3;
      if (j === 0) { pos[k] = anchorW[i].x; pos[k + 1] = anchorW[i].y; pos[k + 2] = anchorW[i].z; prev[k] = pos[k]; prev[k + 1] = pos[k + 1]; prev[k + 2] = pos[k + 2]; continue; }
      const fl = 0.6 + 0.4 * Math.sin(t * 7.0 + i * 0.9 + j * 0.6);   // flutter
      const air = 2.4 * (0.25 + j / CH) * fl;
      const vx = (pos[k] - prev[k]) * drag, vy = (pos[k + 1] - prev[k + 1]) * drag, vz = (pos[k + 2] - prev[k + 2]) * drag;
      prev[k] = pos[k]; prev[k + 1] = pos[k + 1]; prev[k + 2] = pos[k + 2];
      // aerodynamic push toward relative wind, proportional to velocity deficit
      const ax = (wind.x - vx / h) * air, ay = (wind.y - vy / h) * air * 0.5 + g, az = (wind.z - vz / h) * air;
      pos[k] += vx + ax * h2; pos[k + 1] += vy + ay * h2; pos[k + 2] += vz + az * h2;
      const mk = memK[j] * memAmt;
      pos[k] += (restW[k] - pos[k]) * mk; pos[k + 1] += (restW[k + 1] - pos[k + 1]) * mk * 0.5; pos[k + 2] += (restW[k + 2] - pos[k + 2]) * mk;
    }
    for (let it = 0; it < 4; it++) {
      for (let c = 0; c < NC; c++) {
        const a = C[c * 4] * 3, b = C[c * 4 + 1] * 3, rest = C[c * 4 + 2], st = C[c * 4 + 3];
        const dx = pos[b] - pos[a], dy = pos[b + 1] - pos[a + 1], dz = pos[b + 2] - pos[a + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-5;
        const pinA = a < CW * 3, pinB = b < CW * 3;
        if (st < 0.5 && d < rest) continue;   // bend/shear links resist stretch more than compression
        const diff = (d - rest) / d * st;
        if (pinA && pinB) continue;
        if (pinA) { pos[b] -= dx * diff; pos[b + 1] -= dy * diff; pos[b + 2] -= dz * diff; }
        else if (pinB) { pos[a] += dx * diff; pos[a + 1] += dy * diff; pos[a + 2] += dz * diff; }
        else {
          const hd = diff * 0.5;
          pos[a] += dx * hd; pos[a + 1] += dy * hd; pos[a + 2] += dz * hd;
          pos[b] -= dx * hd; pos[b + 1] -= dy * hd; pos[b + 2] -= dz * hd;
        }
      }
      for (let k = CW * 3; k < N * 3; k += 3) {
        collide(pos, k);
        if (pos[k + 1] < groundY + 0.03) pos[k + 1] = groundY + 0.03;
      }
    }
    // scarf tails
    for (let tl = 0; tl < TAILS; tl++) {
      const base = tl * SN * 3, n = tailLen[tl];
      for (let s = 0; s < n; s++) {
        const k = base + s * 3;
        if (s === 0) { spos[k] = sAnchorW[tl].x; spos[k + 1] = sAnchorW[tl].y; spos[k + 2] = sAnchorW[tl].z; sprev[k] = spos[k]; sprev[k + 1] = spos[k + 1]; sprev[k + 2] = spos[k + 2]; continue; }
        const fl = 0.5 + 0.5 * Math.sin(t * 11 + s * 1.3 + tl * 2.0);
        const air = 2.6 * fl;
        const vx = (spos[k] - sprev[k]) * 0.98, vy = (spos[k + 1] - sprev[k + 1]) * 0.98, vz = (spos[k + 2] - sprev[k + 2]) * 0.98;
        sprev[k] = spos[k]; sprev[k + 1] = spos[k + 1]; sprev[k + 2] = spos[k + 2];
        const ax = (wind.x - vx / h) * air, ay = (wind.y + Math.sin(t * 9 + s) * 0.8 - vy / h) * air * 0.6 + g * 0.8, az = (wind.z - vz / h) * air;
        spos[k] += vx + ax * h2; spos[k + 1] += vy + ay * h2; spos[k + 2] += vz + az * h2;
      }
      for (let it = 0; it < 3; it++) {
        for (let s = 1; s < n; s++) {
          const a = base + (s - 1) * 3, b = base + s * 3;
          const dx = spos[b] - spos[a], dy = spos[b + 1] - spos[a + 1], dz = spos[b + 2] - spos[a + 2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-5;
          const diff = (d - SL) / d;
          if (s === 1) { spos[b] -= dx * diff; spos[b + 1] -= dy * diff; spos[b + 2] -= dz * diff; }
          else {
            spos[a] += dx * diff * 0.5; spos[a + 1] += dy * diff * 0.5; spos[a + 2] += dz * diff * 0.5;
            spos[b] -= dx * diff * 0.5; spos[b + 1] -= dy * diff * 0.5; spos[b + 2] -= dz * diff * 0.5;
          }
        }
        for (let s = 1; s < n; s++) { collide(spos, base + s * 3); const k = base + s * 3; if (spos[k + 1] < groundY + 0.03) spos[k + 1] = groundY + 0.03; }
      }
    }
  }

  function writeMeshes() {
    // cloak: small outward offset from the body so it sits on top of the capelet
    cpos.array.set(pos);
    cpos.needsUpdate = true;
    cgeo.computeVertexNormals();
    // scarf ribbons: width perpendicular to segment, biased to lie flat against airflow
    const arr = sp.array;
    for (let tl = 0; tl < TAILS; tl++) {
      const base = tl * SN, n = tailLen[tl];
      for (let s = 0; s < SN; s++) {
        const si = Math.min(s, n - 1);
        const k = (base + si) * 3;
        const kn = (base + Math.min(si + 1, n - 1)) * 3, kp = (base + Math.max(si - 1, 0)) * 3;
        tmpA.set(spos[kn] - spos[kp], spos[kn + 1] - spos[kp + 1], spos[kn + 2] - spos[kp + 2]).normalize();
        tmpB.set(0, 1, 0).cross(tmpA);
        if (tmpB.lengthSq() < 1e-4) tmpB.set(1, 0, 0);
        tmpB.normalize();
        // twist slowly along the ribbon
        tmpC.crossVectors(tmpA, tmpB);
        const tw = Math.sin(U.uTime.value * 3 + s * 0.6 + tl) * 0.5;
        tmpD.copy(tmpB).multiplyScalar(Math.cos(tw)).addScaledVector(tmpC, Math.sin(tw));
        const w = (0.05 - s * 0.0025) * (tl ? 0.9 : 1);
        const v = (base + s) * 2 * 3;
        arr[v] = spos[k] - tmpD.x * w; arr[v + 1] = spos[k + 1] - tmpD.y * w; arr[v + 2] = spos[k + 2] - tmpD.z * w;
        arr[v + 3] = spos[k] + tmpD.x * w; arr[v + 4] = spos[k + 1] + tmpD.y * w; arr[v + 5] = spos[k + 2] + tmpD.z * w;
      }
    }
    sp.needsUpdate = true;
    sgeo.computeVertexNormals();
  }

  // warm the simulation (teleports / screenshots)
  function settle(seconds, opts) {
    reset();
    const n = Math.ceil(seconds / STEP);
    rig.mesh.updateMatrixWorld(true);
    updateAnchors(); updateCaps();
    for (let i = 0; i < n; i++) step(STEP, opts);
    writeMeshes();
  }

  return { cloak, scarf, update, reset, settle, materials: [cloakMat, scarf.material] };
}
