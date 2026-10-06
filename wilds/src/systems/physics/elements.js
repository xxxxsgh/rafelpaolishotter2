// Elemental interactions: fire (spreads over dry grass + wooden props, makes updrafts, scorches
// the ground), explosions, wind pushing light props, ice melting, impact damage / breaking.
//
// Events emitted: fireStart {position}, fireSpread {position, radius}, grassBurnt {x, z, radius},
//   fireOut {position}, explosion {position, radius}, propBroken {type, position}, propIgnited {type, position}
import * as THREE from 'three';
import { FX } from './fx.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const MAX_FIRES = 160;

export class Elements {
  constructor(ctx, phys, props, fx) {
    this.ctx = ctx; this.phys = phys; this.props = props; this.fx = fx;
    this.fires = [];                // {x,y,z,r,life,fuel,int,grass, prop, age, spreadT}
    this.burnt = new Map();         // cell key (2 m) -> time burnt
    this.updrafts = new Map();      // 8 m cell -> {handle, t}
    this.scorch = this._makeScorch();
    this.overlap = [];
    this.emitAcc = 0;
    // (no PointLights: toggling scene lights would recompile every lit material)
    this.flashT = 0;
    this.nearestFire = null;
    phys.listeners.push((a, b, speed, p) => this.onImpact(a, b, speed, p));
  }

  // ------------------------------------------------------------------ scorch decals (instanced)
  _makeScorch() {
    const max = 600;
    const geo = new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsLib.fog, uTime: this.ctx.uniforms.uTime },
      vertexShader: /* glsl */`
        #include <common>
        #include <fog_pars_vertex>
        varying vec2 vP; varying float vSeed;
        void main() {
          vP = position.xz;
          vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vSeed = fract(instanceMatrix[3].x * 0.173 + instanceMatrix[3].z * 0.311);
          vec4 mvPosition = viewMatrix * w;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        #include <common>
        #include <fog_pars_fragment>
        varying vec2 vP; varying float vSeed;
        float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h12(i), h12(i + vec2(1, 0)), f.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), f.x), f.y); }
        void main() {
          float d = length(vP) + (vn(vP * 3.0 + vSeed * 20.0) - 0.5) * 0.5;
          float a = 1.0 - smoothstep(0.45, 1.0, d);
          if (a < 0.01) discard;
          vec3 c = mix(vec3(0.09, 0.075, 0.06), vec3(0.26, 0.22, 0.17), vn(vP * 6.0 + vSeed * 9.0));
          gl_FragColor = vec4(c, a * 0.85);
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
      transparent: true, depthWrite: false, fog: true,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, max);
    mesh.count = 0; mesh.frustumCulled = false; mesh.renderOrder = 2;
    this.ctx.scene.add(mesh);
    return { mesh, n: 0, max, m: new THREE.Matrix4() };
  }
  addScorch(x, z, r) {
    const S = this.scorch, w = this.ctx.world;
    const h = w.getHeight(x, z);
    const n = {}; w.getNormal(x, z, n);
    const i = S.n % S.max; S.n++;
    _v.set(n.x, n.y, n.z);
    const q = new THREE.Quaternion().setFromUnitVectors(_v2.set(0, 1, 0), _v);
    S.m.compose(_v.set(x, h + 0.06, z), q, _v2.set(r, 1, r));
    S.mesh.setMatrixAt(i, S.m);
    S.mesh.count = Math.min(S.n, S.max);
    S.mesh.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------------ fire
  isFlammableGround(x, z) {
    const w = this.ctx.world;
    const s = w.getSurface?.(x, z, this._surf || (this._surf = {}));
    if (!s) return false;
    if (s.grass < 0.45 || s.snow > 0.2) return false;
    if ((w.getWaterSurface?.(x, z) ?? -Infinity) > w.getHeight(x, z) - 0.2) return false;
    return true;
  }
  burntKey(x, z) { return Math.floor(x / 2.2) * 100003 + Math.floor(z / 2.2); }

  ignite(x, y, z, o = {}) {
    if (this.fires.length >= MAX_FIRES) return null;
    const w = this.ctx.world;
    const gh = w.getHeight(x, z);
    const onGround = y === undefined || y === null || y < gh + 0.6;
    if (onGround) y = gh;
    const grass = onGround && !o.prop && this.isFlammableGround(x, z);
    if (onGround && !o.prop && !grass && !o.force) {
      // fizzle: short flame burst on non-flammable ground
      for (let i = 0; i < 5; i++) this.fx.emit(FX.FLAME, x + (Math.random() - 0.5) * 0.6, y + 0.3, z + (Math.random() - 0.5) * 0.6, 0, 1.5, 0, 0.7, 0.6, 1, 0.5, 0.15, 1);
      return null;
    }
    const key = this.burntKey(x, z);
    if (grass && this.burnt.has(key)) return null;
    if (grass) this.burnt.set(key, this.ctx.uniforms.uTime.value);
    const f = { x, y, z, r: o.radius ?? 1.4, life: 0, fuel: o.fuel ?? (grass ? 5 + Math.random() * 4 : 10), int: 0.2, grass, prop: o.prop || null, age: 0, spreadT: 1 + Math.random() };
    this.fires.push(f);
    if (this.fires.length === 1 || o.announce) this.ctx.events.emit('fireStart', { position: new THREE.Vector3(x, y, z) });
    if (grass) {
      this.ctx.events.emit('fireSpread', { position: new THREE.Vector3(x, y, z), radius: f.r });
      this.ctx.systems.vegetation?.burnArea?.(x, z, 2.4);
    }
    return f;
  }
  igniteProp(p) {
    if (!p.alive || p.burning > 0 || !p.def.flammable || p.wet > 0.3) return;
    if (this.ctx.uniforms.uRain.value > 0.5 && p.group === 0) return;
    p.burning = 1;
    if (p.def.explosive && p.fuse < 0) p.fuse = 2.6;
    p.fire = this.ignite(p.body.pos.x, p.body.pos.y, p.body.pos.z, { prop: p, fuel: p.type === 'log' ? 26 : 14, radius: p.body.boundR + 0.4 });
    this.ctx.events.emit('propIgnited', { type: p.type, position: p.body.pos.clone() });
  }
  extinguish(x, z, r) {
    for (const f of this.fires) if ((f.x - x) ** 2 + (f.z - z) ** 2 < r * r) f.fuel = Math.min(f.fuel, 0.3);
    for (const p of this.props.list) if (p.burning && p.body.pos.distanceToSquared(_v.set(x, p.body.pos.y, z)) < r * r) { p.burning = 0; p.fire && (p.fire.fuel = 0); }
  }

  updateFire(dt) {
    const U = this.ctx.uniforms, ev = this.ctx.events;
    const rain = U.uRain.value, wet = U.uWetness?.value ?? 0;
    const wind = U.uWindDir.value, ws = U.uWindStrength.value;
    const fx = this.fx;
    let cx = 0, cy = 0, cz = 0, ci = 0, nearest = null, nd = 1e9;
    const cam = this.ctx.camera.position;
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.age += dt;
      if (f.prop) {
        if (!f.prop.alive) f.fuel = 0;
        else { f.x = f.prop.body.pos.x; f.y = f.prop.body.pos.y - f.prop.body.boundR * 0.3; f.z = f.prop.body.pos.z; if (f.prop.body.inWater > 0.3) f.fuel = 0; }
      }
      const burnRate = 1 + rain * 4 * (f.prop && f.prop.group ? 0 : 1);
      f.fuel -= dt * burnRate;
      f.int = Math.min(1, f.int + dt * 0.8) * Math.min(1, Math.max(0, f.fuel) / 1.5);
      if (f.fuel <= 0) {
        if (f.grass) { this.addScorch(f.x, f.z, 1.3 + Math.random() * 0.8); ev.emit('grassBurnt', { x: f.x, z: f.z, radius: 2.2 }); }
        this.fires.splice(i, 1);
        if (!this.fires.length) ev.emit('fireOut', { position: new THREE.Vector3(f.x, f.y, f.z) });
        continue;
      }
      // spread across dry grass, biased downwind; slower when wet
      f.spreadT -= dt * (1 + ws * 0.8) * (1 - Math.min(0.9, wet * 0.9 + rain));
      if (f.grass && f.spreadT <= 0 && f.int > 0.5) {
        f.spreadT = 0.7 + Math.random() * 1.1;
        for (let k = 0; k < 2; k++) {
          const a = Math.random() * Math.PI * 2;
          const d = 1.6 + Math.random() * 1.4;
          let dx = Math.cos(a) * d + wind.x * ws * 1.8, dz = Math.sin(a) * d + wind.y * ws * 1.8;
          this.ignite(f.x + dx, null, f.z + dz);
        }
      }
      // ignite flammable props nearby + damage the player
      if (f.int > 0.4 && ((this.ctx.uniforms.uTime.value * 7 + i) | 0) % 6 === 0) {
        _v.set(f.x, f.y + 0.5, f.z);
        const near = this.phys.overlapSphere(_v, f.r + 0.4, this.overlap, f.prop ? f.prop.group : undefined);
        for (const b of near) { const p = b.userData.prop; if (p && p !== f.prop) { if (p.type === 'ice') p.heat = 1; else this.igniteProp(p); } }
        const pl = this.ctx.systems.player;
        if (pl?.position && pl.position.distanceToSquared(_v) < (f.r * 0.8) ** 2 && !pl.gliding) pl.damage?.(2, { source: 'fire', type: 'fire' });
      }
      // particles (budgeted by distance)
      const dc = (f.x - cam.x) ** 2 + (f.z - cam.z) ** 2;
      if (dc < 160 * 160) {
        const rate = f.int * (dc < 40 * 40 ? 1 : 0.4);
        for (let k = Math.floor(rate * dt * 40 + Math.random()); k > 0; k--) {
          const s = (0.35 + Math.random() * 0.45) * (0.6 + f.r * 0.35) * (0.6 + 0.4 * f.int);
          fx.emit(FX.FLAME, f.x + (Math.random() - 0.5) * f.r * 1.1, f.y + 0.1 + Math.random() * 0.25, f.z + (Math.random() - 0.5) * f.r * 1.1,
            wind.x * ws * 0.6, 1.6 + Math.random() * 1.6, wind.y * ws * 0.6, s, 0.45 + Math.random() * 0.35, 1, 0.36 + Math.random() * 0.2, 0.07, 0.85);
        }
        if (Math.random() < rate * dt * 5) fx.emit(FX.SMOKE, f.x, f.y + 1.2, f.z, wind.x * ws * 1.5, 1.6 + Math.random(), wind.y * ws * 1.5, 1.2, 3.2 + Math.random() * 2, 0.32, 0.3, 0.3, 0.55, { grow: 1.4 });
        if (Math.random() < rate * dt * 4) fx.emit(FX.EMBER, f.x + (Math.random() - 0.5), f.y + 0.6, f.z + (Math.random() - 0.5), (Math.random() - 0.5) * 2 + wind.x * ws * 2, 3 + Math.random() * 3, (Math.random() - 0.5) * 2 + wind.y * ws * 2, 0.09, 1.6, 1, 0.55, 0.15, 1, { grav: 1.5, drag: 0.8 });
      }
      cx += f.x * f.int; cy += f.y * f.int; cz += f.z * f.int; ci += f.int;
      if (dc < nd) { nd = dc; nearest = f; }
    }
    // updrafts: one per occupied 8 m cell
    const pl = this.ctx.systems.player;
    const t = U.uTime.value;
    if (pl?.addUpdraft) {
      for (const f of this.fires) {
        if (f.int < 0.5) continue;
        const key = Math.floor(f.x / 8) * 7919 + Math.floor(f.z / 8);
        let u = this.updrafts.get(key);
        if (!u) { u = { handle: pl.addUpdraft({ x: f.x, z: f.z, y: f.y, radius: 4.5, height: 32, strength: 10 }), t }; this.updrafts.set(key, u); }
        u.t = t;
      }
      for (const [k, u] of this.updrafts) if (t - u.t > 1.5) { u.handle?.remove?.(); this.updrafts.delete(k); }
    }
    this.nearestFire = nearest && nd < 60 * 60 ? nearest : null;
    // forget old burnt cells slowly (grass regrows)
    if (this.burnt.size > 4000) { let n = 0; for (const k of this.burnt.keys()) { this.burnt.delete(k); if (++n > 1000) break; } }
  }

  // ------------------------------------------------------------------ explosions
  explode(pos, radius = 5, o = {}) {
    const force = o.force ?? 1;
    const fx = this.fx, ev = this.ctx.events;
    const near = this.phys.overlapSphere(pos, radius, this.overlap, o.group);
    const list = near.slice();
    for (const b of list) {
      _v.subVectors(b.pos, pos); const d = Math.max(0.3, _v.length()); _v.divideScalar(d);
      _v.y += 0.45; _v.normalize();
      const k = (1 - Math.min(1, d / radius)) * force;
      const imp = Math.min(b.mass, 400) * 14 * k;
      b.applyImpulse(_v2.copy(_v).multiplyScalar(imp), _v.multiplyScalar(-0.2 * b.boundR).add(b.pos));
      const p = b.userData.prop;
      if (p) {
        if (p.def.flammable) this.igniteProp(p);
        if (p.def.explosive && p.alive && !p.exploding) { p.fuse = Math.min(p.fuse < 0 ? 0.25 : p.fuse, 0.15 + Math.random() * 0.15); }
        else this.damageProp(p, 40 * k);
      }
    }
    // player
    const pl = this.ctx.systems.player;
    if (pl?.position) {
      _v.copy(pl.position); _v.y += 0.9;
      const d = _v.distanceTo(pos);
      if (d < radius * 1.2) {
        const k = 1 - d / (radius * 1.2);
        const kb = _v2.subVectors(_v, pos).normalize(); kb.y = Math.max(kb.y, 0.5); kb.normalize().multiplyScalar(14 * k);
        if (this.ctx.systems.combat?.damagePlayer) this.ctx.systems.combat.damagePlayer(Math.round(30 * k * force), { source: 'explosion', knockback: kb, type: 'explosion' });
        else pl.damage?.(Math.round(30 * k * force), { source: 'explosion', knockback: kb, type: 'explosion' });
      }
    }
    // enemies / others
    this.ctx.systems.combat?.applyExplosion?.(pos, radius, force);
    // fire ring on the ground
    if (o.fire !== false && !o.group) {
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + Math.random(), r = Math.random() * radius * 0.6;
        this.ignite(pos.x + Math.cos(a) * r, null, pos.z + Math.sin(a) * r);
      }
      this.addScorch(pos.x, pos.z, radius * 0.6);
    }
    // visuals
    fx.emit(FX.FLASH, pos.x, pos.y + 0.5, pos.z, 0, 0, 0, radius * 2.6, 0.35, 1, 0.75, 0.4, 1, { grow: radius * 2 });
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * 6.28, e = Math.random() * 1.2;
      const s = 4 + Math.random() * 7;
      fx.emit(FX.FLAME, pos.x, pos.y + 0.4, pos.z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + 2, Math.sin(a) * Math.cos(e) * s, 1.2 + Math.random() * 1.2, 0.45 + Math.random() * 0.35, 1, 0.5, 0.15, 1, { drag: 3.5 });
    }
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * 6.28, s = 1 + Math.random() * 3;
      fx.emit(FX.SMOKE, pos.x + Math.cos(a) * 0.6, pos.y + 0.8 + Math.random(), pos.z + Math.sin(a) * 0.6, Math.cos(a) * s, 1.5 + Math.random() * 2.5, Math.sin(a) * s, 2.2 + Math.random(), 2.5 + Math.random() * 2, 0.22, 0.2, 0.2, 0.75, { grow: 2.2, drag: 1.2 });
    }
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * 6.28, s = 6 + Math.random() * 10;
      fx.emit(FX.SPARK, pos.x, pos.y + 0.5, pos.z, Math.cos(a) * s * 0.7, 3 + Math.random() * 8, Math.sin(a) * s * 0.7, 0.1, 0.8 + Math.random() * 0.6, 1, 0.7, 0.3, 1, { grav: -12, drag: 0.6 });
    }
    this.flashT = 0.5;
    ev.emit('explosion', { position: pos.clone(), radius });
    this.ctx.systems.audio?.play?.('explosion', { position: pos });
  }

  damageProp(p, dmg) {
    if (!p.alive || !isFinite(p.hp)) return;
    p.hp -= dmg;
    if (p.hp <= 0) this.breakProp(p);
  }
  breakProp(p) {
    if (!p.alive) return;
    const pos = p.body.pos.clone();
    if (p.def.explosive) { p.alive && this.detonate(p); return; }
    // splinters + dust
    const wood = p.def.material === 'wood';
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * 6.28, s = 2 + Math.random() * 4;
      this.fx.emit(FX.DEBRIS, pos.x, pos.y, pos.z, Math.cos(a) * s, 2 + Math.random() * 4, Math.sin(a) * s, 0.25 + Math.random() * 0.2, 1.2 + Math.random() * 0.6,
        wood ? 0.55 : 0.8, wood ? 0.38 : 0.9, wood ? 0.22 : 1.0, 1, { grav: -14, drag: 0.4, spin: (Math.random() - 0.5) * 12, grow: 0 });
    }
    for (let i = 0; i < 6; i++) this.fx.emit(FX.DUST, pos.x, pos.y, pos.z, (Math.random() - 0.5) * 2, 0.8, (Math.random() - 0.5) * 2, 1, 1.4, wood ? 0.72 : 0.85, wood ? 0.62 : 0.92, wood ? 0.5 : 1, 0.5);
    this.props.remove(p);
    this.ctx.events.emit('propBroken', { type: p.type, position: pos, sanctum: p.group || 0 });
    // loot hook for gameplay
    if (p.type === 'crate' || p.type === 'crateBig') this.ctx.systems.gameplay?.dropLoot?.(pos, 'crate');
  }
  detonate(p) {
    if (p.exploding) return;
    p.exploding = true;
    const pos = p.body.pos.clone();
    this.props.remove(p);
    this.explode(pos, 6, { group: p.group || undefined, fire: !p.group });
  }

  // strong impacts: damage, break wooden props, dust puffs, boulder crush
  onImpact(a, b, speed, point) {
    const pa = a.userData.prop, pb = b?.userData?.prop;
    const massA = a.mass, massB = b ? (b.mass || 1e4) : 1e4;
    if (speed > 4) {
      const now = this.ctx.uniforms.uTime.value;
      if (!a._dustT || now - a._dustT > 0.25) {
        a._dustT = now;
        for (let i = 0; i < 3; i++) this.fx.emit(FX.DUST, point.x, point.y + 0.1, point.z, (Math.random() - 0.5) * 2, 0.6, (Math.random() - 0.5) * 2, 0.6 + Math.min(1.5, speed * 0.08), 1.0, 0.78, 0.72, 0.62, Math.min(0.6, speed * 0.05));
        this.ctx.events.emit('physicsImpact', { position: point.clone(), speed, material: a.material, other: b?.material || 'ground' });
      }
    }
    if (pa && speed > 7) this.damageProp(pa, (speed - 6) * 4 * Math.min(4, massB / Math.max(1, massA)));
    if (pb && speed > 7) this.damageProp(pb, (speed - 6) * 4 * Math.min(4, massA / Math.max(1, massB)));
    if (pa?.def.explosive && speed > 9) pa.fuse = pa.fuse < 0 ? 0.05 : Math.min(pa.fuse, 0.05);
  }

  // ------------------------------------------------------------------ per-frame
  update(dt) {
    const U = this.ctx.uniforms;
    const t = U.uTime.value;
    this.updateFire(dt);
    // props: burning, fuses, melting, wind
    const wind = U.uWindDir.value, ws = U.uWindStrength.value;
    const storm = U.uRain.value;
    for (let i = this.props.list.length - 1; i >= 0; i--) {
      const p = this.props.list[i];
      if (!p.alive) continue;
      const b = p.body, m = p.mat.uniforms;
      if (p.burning > 0) {
        p.burn = Math.min(1, p.burn + dt / (p.type === 'log' ? 26 : 14));
        if (m?.uBurn) { m.uBurn.value = p.burn; m.uHeat.value = 1; }
        if (p.burn >= 1 && !p.def.explosive) { this.breakProp(p); continue; }
        if (p.fire && p.fire.fuel <= 0) { p.burning = 0; }
        if (b.inWater > 0.3) { p.burning = 0; if (p.fire) p.fire.fuel = 0; }
      } else if (m?.uHeat && m.uHeat.value > 0) m.uHeat.value = Math.max(0, m.uHeat.value - dt * 0.3);
      if (p.fuse >= 0) {
        p.fuse -= dt;
        if (m?.uGlow) { m.uGlow.value = 0.5 + 0.5 * Math.sin(t * 30); m.uGlowCol.value.setRGB(1, 0.4, 0.1); }
        if (p.fuse <= 0) { this.detonate(p); continue; }
      }
      if (p.def.melts) {
        // ice melts in warm sun, near fire (heat), never in snow/at night
        const sun = U.uSunDir.value.y > 0.1 && p.group === 0 ? 0.004 : 0;
        p.melt += dt * (sun + p.heat * 0.12 + (b.inWater ? 0.02 : 0));
        p.heat = Math.max(0, p.heat - dt * 0.5);
        if (p.melt > 0.02) {
          const s = Math.max(0.2, 1 - p.melt);
          p.mesh.scale.setScalar(s);
          b.hx = b.hy = b.hz = 0.6 * s; b.setMass(30 * s * s * s);
          if (p.heat > 0.2 && Math.random() < dt * 6) this.fx.emit(FX.STEAM, b.pos.x, b.pos.y + 0.4 * s, b.pos.z, 0, 1, 0, 0.6, 1.8, 0.9, 0.95, 1, 0.4);
          if (p.melt >= 0.8) { this.props.remove(p); this.ctx.events.emit('iceMelted', { position: b.pos.clone() }); continue; }
        }
      }
      // wind pushes light props when awake or in strong gusts
      if (p.group === 0 && b.mass < 40 && ws > 0.9 && !b.sleeping) {
        const k = (ws - 0.9) * 8 * (1 + storm) * (b.boundR * b.boundR);
        b.force.x += wind.x * k; b.force.z += wind.y * k;
      }
    }
    if (this.flashT > 0) this.flashT -= dt;
  }
}
