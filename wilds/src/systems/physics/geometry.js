// Procedural geometry for physics props and sanctum pieces (all built once, shared).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { prepGeometry } from './materials.js';

export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

function tint(geo, color, glow = 0) {
  if (geo.index) geo = geo.toNonIndexed();
  geo.deleteAttribute('color'); geo.deleteAttribute('aGlow');
  return prepGeometry(geo, color, glow);
}
function strip(geo) {
  // keep only position/normal/uv/color/aGlow so geometries merge
  for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv', 'color', 'aGlow'].includes(k)) geo.deleteAttribute(k);
  return geo;
}
export function merge(list) {
  return mergeGeometries(list.map(g => strip(g.index ? g.toNonIndexed() : g)), false);
}

// rounded box with UVs scaled so plank patterns stay square-ish
export function roundedBox(w, h, d, r = 0.06, seg = 2, color = 0xffffff, glow = 0) {
  const g = new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
  return tint(g, color, glow);
}

// wooden crate: plank body + darker frame battens on every edge
export function crateGeometry(s = 1) {
  const parts = [roundedBox(s * 0.94, s * 0.94, s * 0.94, 0.03 * s, 1, 0xb98a54)];
  const t = 0.12 * s, e = s / 2 - t / 2 + 0.005;
  const frame = 0x7d5a36;
  for (const [ax, ay] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    parts.push(roundedBox(s * 1.0, t, t, 0.02, 1, frame).translate(0, ay * e, ax * e));
    parts.push(roundedBox(t, s * 1.0, t, 0.02, 1, frame).translate(ax * e, 0, ay * e));
    parts.push(roundedBox(t, t, s * 1.0, 0.02, 1, frame).translate(ax * e, ay * e, 0));
  }
  // diagonal brace on two faces
  const br = roundedBox(s * 1.2, t * 0.8, t * 0.5, 0.02, 1, frame);
  br.rotateZ(Math.PI / 4);
  parts.push(br.clone().translate(0, 0, s / 2 + 0.01), br.clone().rotateY(Math.PI / 2).translate(s / 2 + 0.01, 0, 0));
  parts.push(br.clone().translate(0, 0, -s / 2 - 0.01), br.clone().rotateY(Math.PI / 2).translate(-s / 2 - 0.01, 0, 0));
  return merge(parts);
}

// barrel: bulged lathe body (UV.x around, UV.y up), dark iron hoops
export function barrelGeometry(r = 0.42, h = 1.1) {
  const pts = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12, y = (t - 0.5) * h;
    pts.push(new THREE.Vector2(r * (0.86 + 0.14 * Math.sin(t * Math.PI)), y));
  }
  const body = new THREE.LatheGeometry(pts, 20);
  const parts = [tint(body, 0xc0412e)];
  const capT = new THREE.CircleGeometry(r * 0.86, 20).rotateX(-Math.PI / 2).translate(0, h / 2 - 0.02, 0);
  const capB = new THREE.CircleGeometry(r * 0.86, 20).rotateX(Math.PI / 2).translate(0, -h / 2 + 0.02, 0);
  parts.push(tint(capT, 0x8c5a34), tint(capB, 0x8c5a34));
  for (const yt of [0.1, 0.32, 0.68, 0.9]) {
    const rr = r * (0.86 + 0.14 * Math.sin(yt * Math.PI)) + 0.012;
    const hoop = new THREE.CylinderGeometry(rr, rr, 0.06, 20, 1, true).translate(0, (yt - 0.5) * h, 0);
    parts.push(tint(hoop, 0x2e2a2c));
  }
  return merge(parts);
}

// boulder: displaced icosphere, slightly flattened, vertex-tinted
export function boulderGeometry(r = 1, seed = 1, color = 0xa49c8e) {
  const g = new THREE.IcosahedronGeometry(r, 3);
  const p = g.getAttribute('position'), R = rng(seed);
  const o1 = [R() * 10, R() * 10, R() * 10], o2 = [R() * 10, R() * 10, R() * 10];
  const v = new THREE.Vector3();
  const n3 = (x, y, z) => Math.sin(x * 1.7 + o1[0]) * Math.sin(y * 1.9 + o1[1]) * Math.sin(z * 1.5 + o1[2]);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    let d = 1 + 0.16 * n3(v.x * 2, v.y * 2, v.z * 2) + 0.06 * n3(v.x * 5 + o2[0], v.y * 5 + o2[1], v.z * 5 + o2[2]);
    // a few flat facets (chiselled look)
    d = Math.min(d, 1.04 - 0.02 * Math.abs(v.x + v.z));
    p.setXYZ(i, v.x * r * d * 1.05, v.y * r * d * 0.9, v.z * r * d);
  }
  g.computeVertexNormals();
  const out = tint(g, color);
  // per-vertex value variation
  const c = out.getAttribute('color');
  for (let i = 0; i < c.count; i += 3) {
    const k = 0.9 + R() * 0.15;
    for (let j = 0; j < 3; j++) c.setXYZ(i + j, c.getX(i + j) * k, c.getY(i + j) * k, c.getZ(i + j) * k);
  }
  out.computeVertexNormals();
  return out;
}

// log: cylinder along local Y (radius r, half length hh) with a couple of branch stubs
export function logGeometry(r = 0.32, hh = 1.6, seed = 3) {
  const R = rng(seed);
  const g = new THREE.CylinderGeometry(r, r * 1.04, hh * 2, 14, 6, false);
  const p = g.getAttribute('position'), v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const a = Math.atan2(v.z, v.x);
    const k = 1 + 0.05 * Math.sin(a * 3 + v.y * 1.3) + 0.03 * Math.sin(v.y * 4.1);
    if (Math.abs(Math.abs(v.y) - hh) > 1e-3 || Math.hypot(v.x, v.z) > r * 0.5) { v.x *= k; v.z *= k; }
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const parts = [tint(g, 0x7a5a3e)];
  for (let i = 0; i < 2; i++) {
    const s = new THREE.CylinderGeometry(r * 0.22, r * 0.3, r * 0.9, 6);
    s.translate(0, r * 0.6, 0).rotateZ((R() - 0.5) * 0.8 + (i ? Math.PI / 2 : -Math.PI / 2)).rotateY(R() * 6.28).translate(0, (R() - 0.5) * hh * 1.2, 0);
    parts.push(tint(s, 0x6e5038));
  }
  return merge(parts);
}

// iron block with bevels (rune glyph inlays are in the METAL shader)
export function metalBoxGeometry(w, h, d) {
  const parts = [roundedBox(w, h, d, Math.min(w, h, d) * 0.08, 2, 0x5d6f7c)];
  // raised corner caps
  const c = Math.min(w, h, d) * 0.18;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    parts.push(roundedBox(c, c, c, c * 0.2, 1, 0x3e4a54).translate(sx * (w / 2 - c * 0.42), sy * (h / 2 - c * 0.42), sz * (d / 2 - c * 0.42)));
  }
  return merge(parts);
}

export function sphereGeometry(r, color = 0x5d6f7c, detail = 3) {
  return tint(new THREE.IcosahedronGeometry(r, detail), color);
}

export function iceGeometry(s = 1) {
  const g = new RoundedBoxGeometry(s, s, s, 2, s * 0.12);
  const p = g.getAttribute('position'), v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + 0.04 * Math.sin(v.x * 7 + v.y * 5) * Math.sin(v.z * 6);
    p.setXYZ(i, v.x * k, v.y * k, v.z * k);
  }
  g.computeVertexNormals();
  return tint(g, 0xffffff);
}
