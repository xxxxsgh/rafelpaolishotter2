// The wing: an original parafoil-style glider — an arched fabric canopy of sewn cells with a
// patterned canvas (cream base, teal feather chevrons, rust trailing-edge band), a bent
// wooden grip bar and suspension lines. CPU-animated billow + flutter, unfurl on deploy.
import { makeToonMaterial, makeOutlineMaterial } from './toon.js';

function wingTexture(THREE) {
  const W = 512, H = 128, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#efe4c8'; g.fillRect(0, 0, W, H);
  // leading edge band (teal) and trailing rust band
  g.fillStyle = '#1f6467'; g.fillRect(0, 0, W, 18);
  g.fillStyle = '#c4502b'; g.fillRect(0, H - 20, W, 20);
  g.fillStyle = '#e8b65a'; g.fillRect(0, H - 24, W, 4);
  // cells: subtle seams
  const cells = 12;
  for (let i = 1; i < cells; i++) { g.fillStyle = 'rgba(80,60,40,0.28)'; g.fillRect(i * W / cells - 1, 0, 2, H); }
  // feather chevrons across the middle (symmetrical)
  g.lineWidth = 6; g.lineCap = 'round';
  for (let i = 0; i < cells; i++) {
    const cx = (i + 0.5) * W / cells, side = cx < W / 2 ? -1 : 1;
    g.strokeStyle = i % 3 === 1 ? '#c4502b' : '#2a7372';
    for (let k = 0; k < 2; k++) {
      const y = 46 + k * 26;
      g.beginPath(); g.moveTo(cx - 13, y + side * 0); g.lineTo(cx, y - 10); g.lineTo(cx + 13, y); g.stroke();
    }
  }
  // central sigil
  g.strokeStyle = '#1f6467'; g.lineWidth = 5;
  g.beginPath(); g.arc(W / 2, 64, 22, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(W / 2, 44); g.quadraticCurveTo(W / 2 + 12, 66, W / 2, 86); g.quadraticCurveTo(W / 2 - 12, 66, W / 2, 44); g.stroke();
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export function createGlider(ctx) {
  const { THREE } = ctx;
  const group = new THREE.Group(); group.name = 'player-glider';
  const SPAN = 3.0, CHORD = 1.05, NX = 24, NZ = 6, ARCH = 0.6;
  // canopy as a closed thin aerofoil: top + bottom surfaces
  const verts = (NX + 1) * (NZ + 1);
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(verts * 2 * 3), base = new Float32Array(verts * 2 * 3);
  const uv = new Float32Array(verts * 2 * 2), colr = new Float32Array(verts * 2 * 3);
  const idx = [];
  for (let s = 0; s < 2; s++) for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++) {
    const u = i / NX, v = j / NZ, k = s * verts + j * (NX + 1) + i;
    const a = (u - 0.5) * 2.0;   // -1..1
    const ang = a * 1.05;
    // arched span; aerofoil thickness: thick at front third, thin trailing edge
    const thick = 0.09 * Math.sin(Math.PI * Math.pow(v, 0.6)) * (1 - 0.35 * a * a);
    const x = Math.sin(ang) * SPAN / 2 / Math.sin(1.05);
    const yArc = (Math.cos(ang) - Math.cos(1.05)) / (1 - Math.cos(1.05)) * ARCH;
    const z = (0.4 - v) * CHORD * (1 - 0.25 * a * a);   // tapered tips; leading edge forward (+z)
    const y = yArc + (s === 0 ? thick : -thick * 0.35) - v * 0.06;
    base[k * 3] = x; base[k * 3 + 1] = y; base[k * 3 + 2] = z;
    uv[k * 2] = u; uv[k * 2 + 1] = 1 - v;
    const shade = s === 0 ? 1 : 0.78;
    colr[k * 3] = shade; colr[k * 3 + 1] = shade; colr[k * 3 + 2] = shade;
  }
  for (let s = 0; s < 2; s++) for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const o = s * verts, a = o + j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1;
    if (s === 0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
  }
  // close the leading-edge and side seams
  for (let i = 0; i < NX; i++) { const a = i, b = i + 1, c = verts + i, d = verts + i + 1; idx.push(a, c, b, b, c, d); }
  for (let j = 0; j < NZ; j++) for (const i of [0, NX]) {
    const a = j * (NX + 1) + i, c = a + NX + 1, a2 = verts + a, c2 = verts + c;
    if (i === 0) idx.push(a, c, a2, a2, c, c2); else idx.push(a, a2, c, a2, c2, c);
  }
  pos.set(base);
  const pa = new THREE.BufferAttribute(pos, 3); pa.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', pa);
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(colr, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = makeToonMaterial(ctx, { map: wingTexture(THREE), side: THREE.DoubleSide, rim: 0.8, sheen: 0.5 });
  const canopy = new THREE.Mesh(geo, mat);
  canopy.castShadow = true; canopy.receiveShadow = true; canopy.frustumCulled = false;
  const outline = new THREE.Mesh(geo, makeOutlineMaterial(ctx, { width: 0.0018 }));
  outline.frustumCulled = false;
  const wing = new THREE.Group();
  wing.add(canopy, outline);
  wing.position.set(0, 1.55, 0);   // above the hands (relative to grip group)
  group.add(wing);

  // grip bar + lines
  const wood = makeToonMaterial(ctx, { rim: 0.6 });
  const barGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.32, 0.04, 0), new THREE.Vector3(-0.15, 0, 0.02), new THREE.Vector3(0.15, 0, 0.02), new THREE.Vector3(0.32, 0.04, 0)]), 10, 0.018, 6);
  const bc = new Float32Array(barGeo.attributes.position.count * 3);
  const wc = new THREE.Color(0x7a5232);
  for (let i = 0; i < bc.length; i += 3) { bc[i] = wc.r; bc[i + 1] = wc.g; bc[i + 2] = wc.b; }
  barGeo.setAttribute('color', new THREE.BufferAttribute(bc, 3));
  const bar = new THREE.Mesh(barGeo, wood); bar.castShadow = true;
  group.add(bar);
  const lineMat = new THREE.LineBasicMaterial({ color: 0x3a3028, transparent: true, opacity: 0.75, fog: true });
  const lp = [];
  const anchorsWing = [];
  for (let i = 0; i <= NX; i += 4) anchorsWing.push(i);
  for (const i of anchorsWing) {
    for (const v of [1, 4]) {
      const k = v * (NX + 1) + i;
      lp.push(i < NX / 2 ? -0.3 : 0.3, 0.04, 0, base[k * 3], base[k * 3 + 1] - 0.03 + 1.55, base[k * 3 + 2]);
    }
  }
  const lgeo = new THREE.BufferGeometry();
  const lpa = new THREE.BufferAttribute(new Float32Array(lp), 3); lpa.setUsage(THREE.DynamicDrawUsage);
  lgeo.setAttribute('position', lpa);
  const lines = new THREE.LineSegments(lgeo, lineMat); lines.frustumCulled = false;
  group.add(lines);
  const lineBase = new Float32Array(lp);

  group.visible = false;
  let open = 0, target = 0;
  function update(dt, { t, bank = 0, speed = 8, deploying = false }) {
    open += (target - open) * Math.min(1, dt * (target > open ? 7 : 10));
    if (target === 0 && open < 0.03) { open = 0; group.visible = false; return; }
    group.visible = true;
    const o = THREE.MathUtils.smoothstep(open, 0, 1);
    const flap = Math.min(1.5, speed / 8);
    for (let k = 0; k < verts * 2; k++) {
      const bx = base[k * 3], by = base[k * 3 + 1], bz = base[k * 3 + 2];
      const u = bx / (SPAN / 2), v = 0.4 - bz / CHORD;
      // unfurl: fold span toward centre, roll up
      const fx = bx * (0.15 + 0.85 * o);
      const billow = Math.sin(t * 2.3 + u * 2.5) * 0.025 + Math.sin(t * 7.0 + u * 9 + v * 4) * 0.012 * flap * v;
      const trail = Math.max(0, v - 0.6) * Math.sin(t * 13 + u * 14) * 0.03 * flap;
      pos[k * 3] = fx;
      pos[k * 3 + 1] = by * (0.3 + 0.7 * o) + billow + trail + bank * u * 0.12;
      pos[k * 3 + 2] = bz * (0.4 + 0.6 * o);
    }
    pa.needsUpdate = true;
    geo.computeVertexNormals();
    const la = lpa.array;
    for (let i = 0; i < la.length; i += 6) {
      la[i] = lineBase[i]; la[i + 1] = lineBase[i + 1]; la[i + 2] = lineBase[i + 2];
      la[i + 3] = lineBase[i + 3] * (0.15 + 0.85 * o);
      la[i + 4] = 1.55 + (lineBase[i + 4] - 1.55) * (0.3 + 0.7 * o);
      la[i + 5] = lineBase[i + 5] * (0.4 + 0.6 * o);
    }
    lpa.needsUpdate = true;
    wing.scale.setScalar(0.4 + 0.6 * o);
    wing.position.y = 0.2 + 1.35 * o;
    lines.visible = o > 0.3;
  }
  return {
    group, update,
    deploy() { target = 1; group.visible = true; },
    stow() { target = 0; },
    snap(v) { open = target = v; },
    get open() { return open; },
  };
}
