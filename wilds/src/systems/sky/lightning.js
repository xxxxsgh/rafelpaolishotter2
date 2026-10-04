// Lightning bolts: a branching jagged ribbon rebuilt on each strike (rare, so
// allocation-free buffers are reused), plus a flash envelope that the sky,
// lighting and post grade read.
import * as THREE from 'three';

const MAX_SEG = 220;

export function createLightning(scene) {
  const pos = new Float32Array(MAX_SEG * 6 * 3);
  const alpha = new Float32Array(MAX_SEG * 6);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aA', new THREE.BufferAttribute(alpha, 1));
  const uniforms = { uI: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `attribute float aA; varying float vA; void main(){ vA = aA; gl_Position = projectionMatrix * viewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform float uI; varying float vA; void main(){ gl_FragColor = vec4(vec3(0.75,0.85,1.0) * 9.0 * uI * vA, 1.0); }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = 15000;
  scene.add(mesh);

  let seg = 0;
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), side = new THREE.Vector3(), toCam = new THREE.Vector3();
  function addSeg(a, b, w, al, cam) {
    if (seg >= MAX_SEG) return;
    toCam.subVectors(cam, a).normalize();
    side.subVectors(b, a).cross(toCam).normalize().multiplyScalar(w);
    const o = seg * 18;
    const P = [a.x - side.x, a.y - side.y, a.z - side.z, a.x + side.x, a.y + side.y, a.z + side.z,
      b.x + side.x, b.y + side.y, b.z + side.z, b.x - side.x, b.y - side.y, b.z - side.z];
    const idx = [0, 1, 2, 0, 2, 3];
    for (let k = 0; k < 6; k++) { const j = idx[k] * 3; pos[o + k * 3] = P[j]; pos[o + k * 3 + 1] = P[j + 1]; pos[o + k * 3 + 2] = P[j + 2]; alpha[seg * 6 + k] = al; }
    seg++;
  }
  function branch(start, dir, len, w, al, depth, cam) {
    const a = tmpA.copy(start);
    const steps = depth === 0 ? 34 : 12;
    const stepLen = len / steps;
    const cur = new THREE.Vector3().copy(a);
    for (let i = 0; i < steps; i++) {
      const nxt = new THREE.Vector3(
        cur.x + dir.x * stepLen + (Math.random() - 0.5) * stepLen * 1.3,
        cur.y + dir.y * stepLen,
        cur.z + dir.z * stepLen + (Math.random() - 0.5) * stepLen * 1.3);
      addSeg(cur, nxt, w * (1 - i / steps * 0.5), al, cam);
      if (depth < 2 && Math.random() < (depth === 0 ? 0.14 : 0.07)) {
        const bd = new THREE.Vector3(dir.x + (Math.random() - 0.5) * 1.6, dir.y * 0.7, dir.z + (Math.random() - 0.5) * 1.6).normalize();
        branch(nxt, bd, len * 0.35 * Math.random() + len * 0.1, w * 0.5, al * 0.6, depth + 1, cam);
      }
      cur.copy(nxt);
    }
  }

  const state = { t: 9, flash: 0, pos: new THREE.Vector3() };
  return {
    state,
    strike(camPos, camDir, groundY) {
      // somewhere in front of the camera, 500-1500 m away
      const ang = Math.atan2(camDir.z, camDir.x) + (Math.random() - 0.5) * 1.3;
      const dist = 500 + Math.random() * 1000;
      const gx = camPos.x + Math.cos(ang) * dist, gz = camPos.z + Math.sin(ang) * dist;
      const gy = groundY(gx, gz);
      const top = new THREE.Vector3(gx + (Math.random() - 0.5) * 200, Math.max(gy + 500, 750), gz + (Math.random() - 0.5) * 200);
      seg = 0;
      const dir = new THREE.Vector3(gx - top.x, gy - top.y, gz - top.z);
      const len = dir.length(); dir.normalize();
      branch(top, dir, len, 2.6, 1, 0, camPos);
      for (let i = seg * 6; i < MAX_SEG * 6; i++) alpha[i] = 0;
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aA.needsUpdate = true;
      geo.setDrawRange(0, seg * 6);
      state.t = 0;
      state.pos.set(gx, gy, gz);
      return { position: state.pos.clone(), distance: dist, delay: dist / 343 };
    },
    update(dt) {
      state.t += dt;
      const t = state.t;
      // flicker envelope: main stroke + 2 return strokes
      let f = 0;
      if (t < 0.9) f = Math.exp(-t * 14) + 0.7 * Math.exp(-Math.abs(t - 0.16) * 30) + 0.5 * Math.exp(-Math.abs(t - 0.34) * 26);
      state.flash = Math.min(1.4, f);
      mesh.visible = t < 0.5;
      uniforms.uI.value = mesh.visible ? Math.min(1, f * 1.4) : 0;
      return state.flash;
    },
  };
}
