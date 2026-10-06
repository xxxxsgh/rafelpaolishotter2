// The Lodestone rune: an original rune-stone device that lets the player seize and carry iron
// objects at a distance. T toggles the rune; while active, look at an iron object (it glows),
// press E / left mouse to seize it, mouse wheel to pull / push, E again to release.
import * as THREE from 'three';
import { FX } from './fx.js';
import { makeMaterial } from './materials.js';

const BEAM_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const BEAM_FRAG = /* glsl */`
uniform float uTime; uniform vec3 uCol; uniform float uAmp; varying vec2 vUv;
void main() {
  float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
  float pulse = 0.55 + 0.45 * sin(vUv.y * 40.0 - uTime * 14.0);
  float knots = smoothstep(0.75, 1.0, sin(vUv.y * 9.0 - uTime * 5.0));
  float a = pow(across, 1.6) * (0.5 + 0.5 * pulse + knots) * uAmp;
  gl_FragColor = vec4(uCol * a, a);
}`;

export class Lodestone {
  constructor(ctx, phys, props, fx, shared) {
    this.ctx = ctx; this.phys = phys; this.props = props; this.fx = fx;
    this.active = false; this.target = null; this.held = null; this.dist = 6;
    this.hold = new THREE.Vector3();
    // the rune-stone carried in the hand: a hexagonal slate with a glowing iron glyph
    const stone = new THREE.Group();
    const slate = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.035, 6).rotateX(Math.PI / 2), makeMaterial(ctx, shared, 'SANCTUM', { tint: 0x6e7c80 }));
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.045), makeMaterial(ctx, shared, 'GLOW', { tint: 0x6ff5da }));
    gem.position.z = 0.025;
    stone.add(slate, gem);
    stone.visible = false;
    this.stone = stone; this.gem = gem;
    this.attached = false;
    // tether beam: a camera-facing ribbon rebuilt each frame (2 quads along a bent path)
    const SEG = 16;
    const pos = new Float32Array((SEG + 1) * 2 * 3), uv = new Float32Array((SEG + 1) * 2 * 2), idx = [];
    for (let i = 0; i <= SEG; i++) {
      uv[i * 4] = 0; uv[i * 4 + 1] = i / SEG; uv[i * 4 + 2] = 1; uv[i * 4 + 3] = i / SEG;
      if (i < SEG) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    this.beam = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: { uTime: ctx.uniforms.uTime, uCol: { value: new THREE.Color(0x5ff2d8) }, uAmp: { value: 1 } },
      vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, side: THREE.DoubleSide,
    }));
    this.beam.frustumCulled = false; this.beam.visible = false; this.beam.renderOrder = 13;
    ctx.scene.add(this.beam);
    this.SEG = SEG;
    this.ray = new THREE.Vector3(); this.from = new THREE.Vector3();
  }

  attach() {
    if (this.attached) return;
    const hand = this.ctx.systems.player?.handL;
    if (hand) { hand.add(this.stone); this.stone.position.set(0, -0.02, 0.06); this.attached = true; }
  }

  setActive(v) {
    this.active = v;
    this.attach();
    this.stone.visible = v;
    if (!v) this.release();
    this.ctx.events.emit('runeToggle', { rune: 'lodestone', active: v });
  }
  grab(prop) {
    if (!prop) return;
    this.held = prop;
    const b = prop.body;
    b.wake(); b.gravityScale = 0; b.canSleep = false;
    this.dist = Math.max(3, Math.min(18, this.ctx.camera.position.distanceTo(b.pos)));
    this.ctx.events.emit('runeGrab', { type: prop.type });
  }
  release() {
    const p = this.held; if (!p) return;
    p.body.gravityScale = 1; p.body.canSleep = true;
    if (p.mat.uniforms.uGlow) p.mat.uniforms.uGlow.value = 0;
    this.held = null;
  }

  // shot helper: hold a prop at a point
  debugHold(prop, point) {
    this.setActive(true); this.grab(prop);
    this.debugPoint = point.clone();
  }

  update(dt) {
    const input = this.ctx.input, cam = this.ctx.camera;
    if (input?.justPressed?.('KeyT')) this.setActive(!this.active);
    if (!this.active) { this.beam.visible = false; if (this.target) { this.setGlow(this.target, 0); this.target = null; } return; }
    cam.getWorldDirection(this.ray);
    // target: closest magnetic body under the crosshair
    let tgt = null;
    if (!this.held) {
      const hit = this.phys.raycast(cam.position, this.ray, 45, { filter: b => b.userData.prop?.def.magnetic, group: this.phys.activeGroup, terrain: false, statics: true });
      if (hit?.body) tgt = hit.body.userData.prop;
      // forgiving cone: nearest magnetic prop near the aim line
      if (!tgt) {
        let best = 0.996;
        for (const p of this.props.list) {
          if (!p.def.magnetic || p.group !== this.phys.activeGroup) continue;
          const d = this.from.subVectors(p.body.pos, cam.position); const l = d.length();
          if (l > 40) continue;
          const c = d.dot(this.ray) / l;
          if (c > best) { best = c; tgt = p; }
        }
      }
    }
    if (this.target !== tgt) { if (this.target && this.target !== this.held) this.setGlow(this.target, 0); this.target = tgt; }
    if (this.target && !this.held) this.setGlow(this.target, 0.55 + 0.25 * Math.sin(this.ctx.uniforms.uTime.value * 6));
    if (input?.justPressed?.('interact') || input?.justPressed?.('attack')) {
      if (this.held) this.release(); else if (this.target) this.grab(this.target);
    }
    const p = this.held;
    if (p && p.alive) {
      if (input?.wheel) this.dist = Math.max(2.5, Math.min(22, this.dist - input.wheel * 0.8));
      const b = p.body;
      if (this.debugPoint) this.hold.copy(this.debugPoint);
      else this.hold.copy(cam.position).addScaledVector(this.ray, this.dist);
      // critically damped spring toward the hold point
      const k = 7, kd = 0.86;
      b.vel.x = b.vel.x * kd + (this.hold.x - b.pos.x) * k * (1 - kd) * 6;
      b.vel.y = b.vel.y * kd + (this.hold.y - b.pos.y) * k * (1 - kd) * 6;
      b.vel.z = b.vel.z * kd + (this.hold.z - b.pos.z) * k * (1 - kd) * 6;
      b.angVel.multiplyScalar(0.9);
      b.wake();
      this.setGlow(p, 1);
      // beam from the hand to the object
      const pl = this.ctx.systems.player;
      if (pl?.handL) pl.handL.getWorldPosition(this.from); else this.from.copy(cam.position);
      this.updateBeam(this.from, b.pos, cam);
      if (Math.random() < dt * 30) {
        const t = Math.random();
        this.fx.emit(FX.MOTE, this.from.x + (b.pos.x - this.from.x) * t, this.from.y + (b.pos.y - this.from.y) * t + Math.sin(t * 3.14) * 0.4, this.from.z + (b.pos.z - this.from.z) * t,
          (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, 0.16, 0.7, 0.35, 1, 0.85, 1);
      }
    } else { this.beam.visible = false; if (p) this.held = null; }
    this.gem.material.uniforms.uGlow.value = this.held ? 1.5 : 0.4;
  }

  setGlow(p, v) { if (p?.mat?.uniforms?.uGlow) { p.mat.uniforms.uGlow.value = v; p.mat.uniforms.uGlowCol.value.set(0x5ef2d6); } }

  updateBeam(a, b, cam) {
    const pos = this.beam.geometry.getAttribute('position'), arr = pos.array, S = this.SEG;
    const t = this.ctx.uniforms.uTime.value;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, L = Math.hypot(dx, dy, dz) || 1;
    for (let i = 0; i <= S; i++) {
      const u = i / S;
      const sag = Math.sin(u * Math.PI) * L * 0.08;
      const wob = Math.sin(u * 12 - t * 8) * 0.04 * Math.sin(u * Math.PI);
      const x = a.x + dx * u + wob, y = a.y + dy * u + sag, z = a.z + dz * u - wob;
      // camera-facing side vector
      const vx = x - cam.position.x, vy = y - cam.position.y, vz = z - cam.position.z;
      let sx = dy * vz - dz * vy, sy = dz * vx - dx * vz, sz = dx * vy - dy * vx;
      const sl = Math.hypot(sx, sy, sz) || 1, w = 0.07 + 0.05 * Math.sin(u * Math.PI);
      sx = sx / sl * w; sy = sy / sl * w; sz = sz / sl * w;
      arr[i * 6] = x - sx; arr[i * 6 + 1] = y - sy; arr[i * 6 + 2] = z - sz;
      arr[i * 6 + 3] = x + sx; arr[i * 6 + 4] = y + sy; arr[i * 6 + 5] = z + sz;
    }
    pos.needsUpdate = true;
    this.beam.visible = true;
  }
}
