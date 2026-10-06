// player system — the hero, controller, animation, camera, climbing, gliding, swimming.
//
// API (ctx.systems.player):
//   position (Vector3, feet), velocity (Vector3), state ('ground'|'air'|'glide'|'climb'|'swim'|'mantle'|'dead'|'pose'),
//   yaw, stamina / maxStamina, health / maxHealth, exhausted, crouching, grounded
//   heal(n), damage(n, {source, knockback:Vector3, type}), kill()
//   playAction(name, {hold, speed}) -> duration   ('attack','attack2','attack3','spin','thrust','shield','bash','bow',
//                                                   'throw','hit','eat','interact','wave','cook');  releaseAction()
//   addUpdraft({x, z, y?, radius=4, height=40, strength=9, duration?}) -> {remove(), setPosition(x,y,z), data}
//   setLockTarget(Object3D|Vector3|null), camera (orbit camera api), setGuard(bool)
//   handR / handL / back (Object3D attach points for weapons, shields, bows)
//   group (THREE.Group root of the character), teleport(x, z, yaw), debugPlace({x, z, yaw, state})
//   setInputEnabled(bool), freeze(bool)
// Events emitted: footstep {position, surface, speed, foot}, jump, land {position, height, hard}, glideStart, glideEnd,
//   climbStart, climbEnd, climbSlip, swimStart, swimEnd, mantle, damage {amount, health, source}, playerDied, playerRespawn,
//   staminaExhausted, heal {amount, health}
import { buildCharacter } from './character.js';
import { createAnimator } from './anim.js';
import { createCloth } from './cloth.js';
import { createGlider } from './glider.js';
import { createCamera } from './camera.js';
import { createHud } from './hud.js';

const CFG = {
  walk: 2.3, run: 5.0, sprint: 7.9, crouch: 1.8, exhaustedRun: 2.6,
  accel: 14, decel: 18, airAccel: 4, gravity: 22, jumpV: 6.8, maxFall: 52,
  glideFwd: 8.6, glideSink: 1.75, glideTurn: 1.6,
  swim: 2.4, swimFast: 4.6, climb: 1.55, climbJump: 1.7,
  radius: 0.32, height: 1.72, stepH: 0.5, walkable: 0.68, climbable: 0.62,
  stamina: 100, drainSprint: 16, drainClimb: 9, drainClimbIdle: 1.2, drainGlide: 4.5, drainSwim: 12, drainClimbJump: 18,
  regen: 34, regenDelay: 0.6,
  fallSafe: 9, fallLethal: 30,
  health: 12,
};
const SURF_KINDS = ['grass', 'dirt', 'rock', 'sand', 'snow'];

export async function init(ctx) {
  const { THREE, scene, world, input, events, uniforms: U } = ctx;
  const water = () => ctx.systems.water;
  const shotMode = ctx.params?.has?.('shot');

  // ---------------- character ----------------
  const rig = buildCharacter(ctx);
  const group = new THREE.Group(); group.name = 'player';
  group.rotation.order = 'YXZ';
  const model = new THREE.Group();          // squash/stretch + body offsets live here
  group.add(model);
  model.add(rig.mesh);
  scene.add(group);
  const anim = createAnimator(rig);
  const cloth = createCloth(ctx, rig);
  scene.add(cloth.cloak, cloth.scarf);
  const glider = createGlider(ctx);
  model.add(glider.group);
  glider.group.position.set(0, 1.92, 0.04);
  const cam = createCamera(ctx);
  const hud = createHud(ctx);
  const allMats = [rig.material, ...cloth.materials];

  // soft contact shadow under the feet (painterly AO blob; the sun shadow does the rest)
  const blob = (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const g = cv.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    grd.addColorStop(0, 'rgba(20,40,60,0.55)'); grd.addColorStop(0.5, 'rgba(20,40,60,0.28)'); grd.addColorStop(1, 'rgba(20,40,60,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(cv);
    const m = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, fog: true });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1).rotateX(-Math.PI / 2), m);
    mesh.renderOrder = 1; mesh.name = 'player-contact-shadow';
    scene.add(mesh);
    return mesh;
  })();

  // ---------------- state ----------------
  const p = new THREE.Vector3(150, 0, 250);      // feet
  const vel = new THREE.Vector3();
  const lastSafe = new THREE.Vector3();
  let yaw = 0, yawVel = 0, state = 'ground', grounded = true, airT = 0, peakY = 0, jumpT = 0;
  let stamina = CFG.stamina, exhausted = false, staminaDelay = 0, staminaUseT = 0;
  let health = CFG.health, invuln = 0, deadT = 0;
  let crouching = false, sprinting = false, guard = false;
  let phase = 0, swimPhase = 0, climbPhase = 0, lastStepSide = 0;
  let squash = 0, squashV = 0, lean = 0, bodyPitch = 0, bodyRoll = 0;
  let hold = null;                // debug pose lock {state, speed}
  let inputEnabled = true, frozen = false;
  let pushT = 0, wallGrabCooldown = 0, slipT = 0, slipping = 0;
  const climb = { n: new THREE.Vector3(0, 0, 1), c: new THREE.Vector3(), coll: null, jumpT: 0, jumpDir: new THREE.Vector3(), look: 0 };
  const mantle = { from: new THREE.Vector3(), to: new THREE.Vector3(), t: 0, dur: 0.6 };
  const updrafts = new Set();
  const nrm = { x: 0, y: 1, z: 0 }, nrm2 = { x: 0, y: 1, z: 0 }, surf = {};
  const tv = new THREE.Vector3(), tv2 = new THREE.Vector3(), tv3 = new THREE.Vector3(), wish = new THREE.Vector3();
  const upV = new THREE.Vector3(0, 1, 0), clothVel = new THREE.Vector3(), prevP = new THREE.Vector3();
  const collOut = [], physOut = [];
  const contact = { hit: false, nx: 0, nz: 0, top: 0, coll: null };
  const footLift = [0, 0];

  // ---------------- world queries ----------------
  function queryColliders(x, z, r) {
    let a = ctx.systems.terrain?.queryColliders?.(x, z, r, collOut);
    if (!a) { collOut.length = 0; a = collOut; }
    const b = ctx.systems.physics?.queryColliders?.(x, z, r, physOut);
    if (b && b.length) { for (const c of b) a.push(c); }
    return a;
  }
  function boxLocal(c, x, z, out) {
    const dx = x - c.x, dz = z - c.z, cs = Math.cos(c.rotY || 0), sn = Math.sin(c.rotY || 0);
    out.x = dx * cs - dz * sn; out.z = dx * sn + dz * cs;
    return out;
  }
  const lp = { x: 0, z: 0 };
  // top surface of a collider under (x,z), or -Infinity
  function colliderTop(c, x, z, pad = 0) {
    if (c.type === 'sphere') {
      const d2 = (x - c.x) ** 2 + (z - c.z) ** 2;
      return d2 < c.r * c.r ? c.y + Math.sqrt(c.r * c.r - d2) : -Infinity;
    }
    if (c.type === 'cylinder') {
      const d2 = (x - c.x) ** 2 + (z - c.z) ** 2;
      return d2 < (c.r + pad) ** 2 ? c.y + c.hy : -Infinity;
    }
    if (c.type === 'box') {
      boxLocal(c, x, z, lp);
      return Math.abs(lp.x) < c.hx + pad && Math.abs(lp.z) < c.hz + pad ? c.y + c.hy : -Infinity;
    }
    return -Infinity;
  }
  function colliderBottom(c) { return c.type === 'sphere' ? c.y - c.r : c.y - (c.hy || 0); }
  function terrainH(x, z) { return world.getHeight(x, z); }
  // ground under the feet: terrain + any collider top within step reach
  function groundAt(x, z, yRef) {
    let h = terrainH(x, z);
    const list = queryColliders(x, z, 0.5);
    for (const c of list) {
      const t = colliderTop(c, x, z, 0.05);
      if (t > h && t <= yRef + CFG.stepH + 0.05) h = t;
    }
    return h;
  }
  // horizontal capsule push-out; records the strongest contact (for climbing)
  function resolveColliders(pos) {
    contact.hit = false;
    const list = queryColliders(pos.x, pos.z, CFG.radius + 1);
    const R = CFG.radius;
    for (const c of list) {
      const top = c.type === 'sphere' ? c.y + c.r : c.y + c.hy;
      const bot = colliderBottom(c);
      if (top <= pos.y + CFG.stepH || bot >= pos.y + CFG.height) continue;
      let nx = 0, nz = 0, pen = 0;
      if (c.type === 'sphere') {
        const cy = Math.max(pos.y + R, Math.min(pos.y + CFG.height - R, c.y));
        const dx = pos.x - c.x, dy = cy - c.y, dz = pos.z - c.z;
        const d = Math.hypot(dx, dy, dz), rr = c.r + R;
        if (d >= rr) continue;
        const dh = Math.hypot(dx, dz) || 1e-4;
        nx = dx / dh; nz = dz / dh; pen = (rr - d) * (d / Math.max(dh, 0.05)) ;
        pen = Math.min(pen, rr);
      } else if (c.type === 'cylinder') {
        const dx = pos.x - c.x, dz = pos.z - c.z, d = Math.hypot(dx, dz) || 1e-4, rr = c.r + R;
        if (d >= rr) continue;
        nx = dx / d; nz = dz / d; pen = rr - d;
      } else if (c.type === 'box') {
        boxLocal(c, pos.x, pos.z, lp);
        const qx = Math.max(-c.hx, Math.min(c.hx, lp.x)), qz = Math.max(-c.hz, Math.min(c.hz, lp.z));
        let dx = lp.x - qx, dz = lp.z - qz, d = Math.hypot(dx, dz);
        let lnx, lnz;
        if (d > 1e-5) { if (d >= R) continue; lnx = dx / d; lnz = dz / d; pen = R - d; }
        else {   // centre inside the box: exit via nearest face
          const ex = c.hx - Math.abs(lp.x), ez = c.hz - Math.abs(lp.z);
          if (ex < ez) { lnx = Math.sign(lp.x) || 1; lnz = 0; pen = ex + R; } else { lnx = 0; lnz = Math.sign(lp.z) || 1; pen = ez + R; }
        }
        const cs = Math.cos(c.rotY || 0), sn = Math.sin(c.rotY || 0);
        nx = lnx * cs + lnz * sn; nz = -lnx * sn + lnz * cs;
      } else continue;
      pos.x += nx * pen; pos.z += nz * pen;
      if (!contact.hit || top > contact.top) { contact.hit = true; contact.nx = nx; contact.nz = nz; contact.top = top; contact.coll = c; }
    }
    return contact.hit;
  }
  function waterAt(x, z) { const w = water(); return w?.getWaterHeight ? w.getWaterHeight(x, z) : (world.getWaterSurface ? (() => { const s = world.getWaterSurface(x, z); return s > -1e8 ? s : null; })() : null); }

  // ---------------- climbing surface ----------------
  // project climb centre onto the surface; returns false when there is no climbable surface
  function projectClimb(c, n) {
    if (climb.coll) {
      const k = climb.coll;
      if (k.type === 'box') {
        boxLocal(k, c.x, c.z, lp);
        // choose the face we are on from the stored normal
        const cs = Math.cos(k.rotY || 0), sn = Math.sin(k.rotY || 0);
        const lnx = n.x * cs - n.z * sn, lnz = n.x * sn + n.z * cs;
        let qx = Math.max(-k.hx, Math.min(k.hx, lp.x)), qz = Math.max(-k.hz, Math.min(k.hz, lp.z));
        if (Math.abs(lnx) > Math.abs(lnz)) qx = Math.sign(lnx) * k.hx; else qz = Math.sign(lnz) * k.hz;
        // wrap around corners when sliding past an edge
        if (Math.abs(lp.z) > k.hz + 0.05 && Math.abs(lnx) > Math.abs(lnz)) { qz = Math.sign(lp.z) * k.hz; qx = Math.max(-k.hx, Math.min(k.hx, lp.x)); }
        if (Math.abs(lp.x) > k.hx + 0.05 && Math.abs(lnz) >= Math.abs(lnx)) { qx = Math.sign(lp.x) * k.hx; qz = Math.max(-k.hz, Math.min(k.hz, lp.z)); }
        let dx = lp.x - qx, dz = lp.z - qz; const d = Math.hypot(dx, dz) || 1;
        dx /= d; dz /= d;
        n.set(dx * cs + dz * sn, 0, -dx * sn + dz * cs);
        const wx = qx * cs + qz * sn + k.x, wz = -qx * sn + qz * cs + k.z;
        c.x = wx + n.x * CFG.radius; c.z = wz + n.z * CFG.radius;
        return true;
      }
      if (k.type === 'cylinder' || k.type === 'sphere') {
        let dx = c.x - k.x, dz = c.z - k.z;
        let dy = k.type === 'sphere' ? c.y - k.y : 0;
        const d = Math.hypot(dx, dy, dz) || 1;
        n.set(dx / d, dy / d, dz / d);
        const r = k.r + CFG.radius;
        c.set(k.x + n.x * r, k.type === 'sphere' ? k.y + n.y * r : c.y, k.z + n.z * r);
        if (k.type === 'cylinder') n.y = 0;
        return true;
      }
      return false;
    }
    for (let i = 0; i < 4; i++) {
      world.getNormal(c.x, c.z, nrm);
      // blend with a wider-footprint normal so we glide over small bumps
      world.getNormal(c.x - nrm.x * 0.6, c.z - nrm.z * 0.6, nrm2);
      n.set(nrm.x + nrm2.x, nrm.y + nrm2.y, nrm.z + nrm2.z).normalize();
      const h = terrainH(c.x, c.z);
      const d = (c.y - h) * n.y;              // approx distance along the normal
      c.addScaledVector(n, 0.36 - d);
    }
    return true;
  }
  function canClimbTerrainAt(x, y, z) {
    world.getNormal(x, z, nrm);
    return nrm.y < CFG.climbable && terrainH(x, z) > y - 0.2;
  }
  function startClimb(coll, nx, ny, nz) {
    if (exhausted || stamina < 1) return false;
    climb.coll = coll;
    climb.n.set(nx, ny, nz).normalize();
    climb.c.copy(p); climb.c.y += 0.95;
    if (!projectClimb(climb.c, climb.n)) return false;
    state = 'climb'; vel.set(0, 0, 0); airT = 0;
    glider.stow();
    anim.setLayer('climb', 10);
    events.emit('climbStart', { position: p.clone(), surface: coll ? coll.kind || 'ruin' : 'rock' });
    return true;
  }
  function startMantle(tx, ty, tz) {
    state = 'mantle';
    mantle.from.copy(p); mantle.to.set(tx, ty, tz); mantle.t = 0;
    mantle.dur = 0.35 + Math.min(0.4, Math.max(0, ty - p.y) * 0.25);
    anim.setLayer('crouch', 8);
    events.emit('mantle', { position: mantle.to.clone() });
  }

  // ---------------- stamina / health ----------------
  function useStamina(n) {
    if (n <= 0) return;
    stamina = Math.max(0, stamina - n);
    staminaDelay = CFG.regenDelay; staminaUseT = 0;
    if (stamina <= 0 && !exhausted) { exhausted = true; events.emit('staminaExhausted', {}); }
  }
  function regenStamina(dt, rate = 1) {
    staminaUseT += dt;
    if (staminaDelay > 0) { staminaDelay -= dt; return; }
    stamina = Math.min(CFG.stamina, stamina + CFG.regen * rate * dt * (exhausted ? 0.7 : 1));
    if (exhausted && stamina >= CFG.stamina) exhausted = false;
  }
  function damage(amount, info = {}) {
    if (state === 'dead' || invuln > 0 || amount <= 0 || hold) return false;
    health = Math.max(0, health - amount);
    invuln = info.iframes ?? 0.7;
    if (info.knockback) { vel.add(info.knockback); if (state === 'ground' && info.knockback.y > 0) { state = 'air'; grounded = false; } }
    if (state !== 'climb' && state !== 'glide') anim.play('hit');
    flash = 1;
    cam.shake(Math.min(1, 0.3 + amount * 0.15));
    events.emit('damage', { amount, health, source: info.source || null, type: info.type || 'generic', target: 'player' });
    if (health <= 0) die();
    return true;
  }
  function heal(amount) {
    if (state === 'dead') return;
    const before = health;
    health = Math.min(CFG.health, health + amount);
    if (health > before) events.emit('heal', { amount: health - before, health });
  }
  function die() {
    state = 'dead'; deadT = 0; glider.stow();
    anim.setLayer('fall', 4);
    events.emit('playerDied', { position: p.clone() });
  }
  function respawn() {
    p.copy(lastSafe); vel.set(0, 0, 0);
    p.y = groundAt(p.x, p.z, p.y + 50);
    health = CFG.health; stamina = CFG.stamina; exhausted = false;
    state = 'ground'; invuln = 2;
    anim.setLayer('idle'); anim.snap();
    cloth.reset();
    events.emit('playerRespawn', { position: p.clone() });
  }
  let flash = 0;

  // ---------------- input helpers ----------------
  const mv = { x: 0, y: 0 };
  function readMove() {
    if (!inputEnabled || ctx.paused || frozen) { mv.x = 0; mv.y = 0; return mv; }
    const m = input.move(); mv.x = m.x; mv.y = m.y; return mv;
  }
  const pressed = a => inputEnabled && !ctx.paused && !frozen && input.justPressed(a);
  const held = a => inputEnabled && !ctx.paused && !frozen && input.held(a);
  // camera-relative wish direction (world XZ)
  function wishDir(m, out) {
    const cy = cam.state.yaw;
    const fx = -Math.sin(cy), fz = -Math.cos(cy);   // camera forward
    const rx = -fz, rz = fx;
    out.set(fx * m.y + rx * m.x, 0, fz * m.y + rz * m.x);
    return out;
  }
  function turnToward(target, dt, rate) {
    let d = target - yaw;
    while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    const step = Math.sign(d) * Math.min(Math.abs(d), rate * dt);
    yaw += step; yawVel = step / Math.max(dt, 1e-4);
    if (yaw > Math.PI) yaw -= Math.PI * 2; if (yaw < -Math.PI) yaw += Math.PI * 2;
  }

  // ---------------- footsteps ----------------
  function surfaceAt(x, z) {
    const s = waterAt(x, z);
    if (s !== null && s > terrainH(x, z) - 0.02) return 'water';
    if (!world.getSurface) return 'grass';
    world.getSurface(x, z, surf);
    let best = 'grass', bw = -1;
    for (const k of SURF_KINDS) if ((surf[k] || 0) > bw) { bw = surf[k] || 0; best = k; }
    return best;
  }
  function footstep(side, speed) {
    events.emit('footstep', { position: p, surface: surfaceAt(p.x, p.z), speed, foot: side ? 'R' : 'L', state });
  }

  // ---------------- state updates ----------------
  function updateGround(dt) {
    const m = readMove();
    const mag = Math.min(1, Math.hypot(m.x, m.y));
    wishDir(m, wish);
    if (pressed('crouch')) crouching = !crouching;
    const wantSprint = held('sprint') && mag > 0.3 && !exhausted && !crouching;
    sprinting = wantSprint;
    let speed = crouching ? CFG.crouch : mag < 0.55 ? CFG.walk * mag / 0.55 : CFG.walk + (CFG.run - CFG.walk) * (mag - 0.55) / 0.45;
    if (sprinting) speed = CFG.sprint;
    if (exhausted) speed = Math.min(speed, CFG.exhaustedRun);
    if (guard) speed = Math.min(speed, CFG.walk);
    // shallow water slows you
    const ws = waterAt(p.x, p.z);
    const wdepth = ws !== null ? ws - p.y : 0;
    if (wdepth > 0.15) speed *= 1 - Math.min(0.45, wdepth * 0.5);

    world.getNormal(p.x, p.z, nrm);
    const steep = nrm.y < CFG.walkable;
    // target velocity
    const tvx = wish.x * speed, tvz = wish.z * speed;
    const a = mag > 0.05 ? CFG.accel : CFG.decel;
    vel.x += (tvx - vel.x) * Math.min(1, a * dt);
    vel.z += (tvz - vel.z) * Math.min(1, a * dt);
    if (mag > 0.05) turnToward(Math.atan2(wish.x, wish.z), dt, sprinting ? 7 : 11);
    else yawVel *= 0.8;
    // slope: walking up a too-steep slope is blocked -> try to climb; standing on one slides
    if (steep) {
      const into = wish.x * nrm.x + wish.z * nrm.z;      // < 0 = pushing uphill
      if (into < -0.3 && mag > 0.3) {
        pushT += dt;
        const k = (vel.x * nrm.x + vel.z * nrm.z);
        if (k < 0) { vel.x -= nrm.x * k; vel.z -= nrm.z * k; }
        if (pushT > 0.12 && wallGrabCooldown <= 0 && startClimb(null, nrm.x, nrm.y, nrm.z)) return;
      }
      const slide = (CFG.walkable - nrm.y) * 30;
      vel.x += nrm.x * slide * dt; vel.z += nrm.z * slide * dt;
    } else pushT = Math.max(0, pushT - dt);

    prevP.copy(p);
    p.x += vel.x * dt; p.z += vel.z * dt;
    if (resolveColliders(p)) {
      const into = wish.x * contact.nx + wish.z * contact.nz;
      if (into < -0.5 && mag > 0.3 && contact.top > p.y + 0.9) {
        // low obstacle: vault/mantle when it's below chest; otherwise climb
        if (contact.top < p.y + 1.6 && pressed('jump')) {
          startMantle(p.x - contact.nx * 0.5, contact.top, p.z - contact.nz * 0.5); return;
        }
        pushT += dt;
        if (pushT > 0.2 && wallGrabCooldown <= 0 && isClimbable(contact.coll) && startClimb(contact.coll, contact.nx, 0, contact.nz)) return;
      }
    }
    // terrain wall (step higher than step height) blocks horizontal motion
    const gh = groundAt(p.x, p.z, p.y);
    if (gh > p.y + CFG.stepH) {
      world.getNormal(p.x, p.z, nrm);
      p.x = prevP.x; p.z = prevP.z;
      if (mag > 0.3 && wallGrabCooldown <= 0 && startClimb(null, nrm.x, nrm.y, nrm.z)) return;
    }
    const g2 = groundAt(p.x, p.z, p.y);
    const snap = 0.3 + Math.hypot(vel.x, vel.z) * dt * 1.6;
    if (g2 >= p.y - snap) { p.y = g2; vel.y = 0; grounded = true; }
    else { state = 'air'; grounded = false; airT = 0; peakY = p.y; vel.y = 0; return; }

    // deep water -> swim
    if (ws !== null && ws - g2 > 1.25 && ws - p.y > 1.05) { enterSwim(ws); return; }

    if (pressed('jump') && !guard) {
      vel.y = CFG.jumpV + (sprinting ? 0.4 : 0);
      state = 'air'; grounded = false; airT = 0; peakY = p.y; jumpT = 0;
      crouching = false;
      events.emit('jump', { position: p.clone(), sprint: sprinting });
      return;
    }
    if (sprinting) useStamina(CFG.drainSprint * dt); else regenStamina(dt);
    if (!steep && (ws === null || ws < p.y)) lastSafe.copy(p);

    // animation params
    const hs = Math.hypot(vel.x, vel.z);
    const stride = crouching ? 0.9 : hs < 3 ? 1.25 : 1.25 + (hs - 3) * 0.14;
    const before = phase;
    phase += hs / stride * Math.PI * dt;
    if (Math.floor(before / Math.PI) !== Math.floor(phase / Math.PI) && hs > 0.4) { lastStepSide ^= 1; footstep(lastStepSide, hs); }
    if (phase > 1000) phase -= Math.PI * 300;
    anim.params.phase = phase;
    anim.params.speedN = hs < CFG.walk ? 0 : hs < CFG.run ? (hs - CFG.walk) / (CFG.run - CFG.walk) : 1 + (hs - CFG.run) / (CFG.sprint - CFG.run);
    anim.params.move = Math.min(1, hs / CFG.crouch);
    if (crouching) anim.setLayer('crouch', 8);
    else if (guard) anim.setLayer(hs > 0.5 ? 'locomotion' : 'guard', 8);
    else if (hs > 0.35 || mag > 0.1) anim.setLayer('locomotion', 10);
    else anim.setLayer('idle', 6);
  }
  function isClimbable(c) { return !!c && c.climbable !== false && c.kind !== 'tree-trunk-small'; }

  function updateAir(dt) {
    const m = readMove();
    wishDir(m, wish);
    airT += dt; jumpT += dt;
    vel.y = Math.max(-CFG.maxFall, vel.y - CFG.gravity * dt);
    const hs = Math.hypot(vel.x, vel.z);
    const maxH = Math.max(hs, CFG.run);
    vel.x += wish.x * CFG.airAccel * dt * 2; vel.z += wish.z * CFG.airAccel * dt * 2;
    const nh = Math.hypot(vel.x, vel.z);
    if (nh > maxH) { vel.x *= maxH / nh; vel.z *= maxH / nh; }
    if (Math.hypot(m.x, m.y) > 0.1) turnToward(Math.atan2(wish.x, wish.z), dt, 5);
    prevP.copy(p);
    p.addScaledVector(vel, dt);
    peakY = Math.max(peakY, p.y);
    // walls while airborne: grab
    if (resolveColliders(p) && wallGrabCooldown <= 0 && isClimbable(contact.coll) && contact.top > p.y + 1.0) {
      const into = wish.x * contact.nx + wish.z * contact.nz;
      if (into < -0.3 || vel.y < 0) { if (startClimb(contact.coll, contact.nx, 0, contact.nz)) return; }
    }
    const gh = groundAt(p.x, p.z, p.y);
    const ws = waterAt(p.x, p.z);
    if (ws !== null && p.y < ws - 0.9 && ws - gh > 1.25) { enterSwim(ws); return; }
    if (p.y <= gh) {
      world.getNormal(p.x, p.z, nrm);
      if (nrm.y < CFG.climbable && wallGrabCooldown <= 0 && gh > prevP.y + 0.2) {
        p.x = prevP.x; p.z = prevP.z; p.y = Math.max(p.y, prevP.y);
        if (startClimb(null, nrm.x, nrm.y, nrm.z)) return;
      }
      land(gh);
      return;
    }
    // terrain wall ahead at chest height -> grab
    if (wallGrabCooldown <= 0 && airT > 0.1) {
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      const hx = p.x + fx * 0.45, hz = p.z + fz * 0.45;
      const hh = terrainH(hx, hz);
      if (hh > p.y + 1.0 && canClimbTerrainAt(hx, p.y + 1, hz)) {
        if (startClimb(null, nrm.x, nrm.y, nrm.z)) return;
      }
    }
    // deploy the wing
    if (pressed('jump') && airT > 0.18 && p.y - gh > 1.6 && !exhausted && stamina > 0) {
      state = 'glide'; glider.deploy();
      vel.y = Math.max(vel.y, -3);
      events.emit('glideStart', { position: p.clone() });
      return;
    }
    regenStamina(dt, 0.0);
    anim.params.vy = vel.y; anim.params.airT = airT;
    anim.setLayer(vel.y > -1.5 && airT < 0.6 ? 'jump' : 'fall', 7);
  }

  function land(gh) {
    const drop = peakY - gh;
    p.y = gh; grounded = true; state = 'ground';
    const hard = drop > 4;
    squashV -= Math.min(6, 1 + drop * 0.6) * (hard ? 1.3 : 0.8);
    vel.y = 0;
    events.emit('land', { position: p.clone(), height: drop, hard, surface: surfaceAt(p.x, p.z) });
    if (hard) cam.shake(Math.min(0.8, drop * 0.04));
    if (drop > CFG.fallSafe && !hold) {
      const ws = waterAt(p.x, p.z);
      if (ws === null || ws < gh + 0.4) {
        const t = (drop - CFG.fallSafe) / (CFG.fallLethal - CFG.fallSafe);
        damage(t >= 1 ? 999 : Math.max(1, Math.round(t * CFG.health * 0.85)), { source: 'fall', type: 'fall', iframes: 0.1 });
      }
    }
  }

  function updateGlide(dt) {
    const m = readMove();
    airT += dt;
    // steer: stick x turns, stick y nudges airspeed
    const turn = -m.x * CFG.glideTurn;
    yaw += turn * dt; yawVel = turn;
    if (Math.abs(m.y) > 0.1 || Math.abs(m.x) > 0.1) {
      wishDir(m, wish);
      if (m.y > 0.2) turnToward(Math.atan2(wish.x, wish.z), dt, 1.2);
    }
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const fwd = CFG.glideFwd * (1 + 0.15 * Math.max(0, m.y)) * (m.y < -0.2 ? 0.6 : 1);
    const ws = U.uWindStrength.value, wd = U.uWindDir.value;
    vel.x += (fx * fwd + wd.x * ws * 1.3 - vel.x) * Math.min(1, dt * 1.8);
    vel.z += (fz * fwd + wd.y * ws * 1.3 - vel.z) * Math.min(1, dt * 1.8);
    let lift = 0;
    for (const u of updrafts) {
      const d = u.data; const dx = p.x - d.x, dz = p.z - d.z;
      const r2 = d.radius * d.radius, dd = dx * dx + dz * dz;
      if (dd < r2 && p.y < d.y + d.height && p.y > d.y - 2) lift += d.strength * (1 - dd / r2 * 0.6) * (1 - Math.max(0, (p.y - d.y) / d.height) ** 2);
    }
    const sink = -CFG.glideSink;
    const targetVy = lift > 0 ? Math.min(lift, 14) : sink;
    vel.y += (targetVy - vel.y) * Math.min(1, dt * (lift > 0 ? 1.8 : 2.4));
    prevP.copy(p);
    p.addScaledVector(vel, dt);
    useStamina(CFG.drainGlide * dt * (lift > 0 ? 0.3 : 1));
    const gh = groundAt(p.x, p.z, p.y);
    const wsurf = waterAt(p.x, p.z);
    if (resolveColliders(p) && isClimbable(contact.coll) && contact.top > p.y + 1) {
      endGlide(); if (startClimb(contact.coll, contact.nx, 0, contact.nz)) return;
    }
    if (wsurf !== null && p.y < wsurf - 0.5 && wsurf - gh > 1.25) { endGlide(); enterSwim(wsurf); return; }
    if (p.y <= gh + 0.02) {
      world.getNormal(p.x, p.z, nrm);
      if (nrm.y < CFG.climbable) {
        p.x = prevP.x; p.z = prevP.z; p.y = Math.max(prevP.y, gh);
        endGlide(); if (startClimb(null, nrm.x, nrm.y, nrm.z)) return;
      }
      endGlide(); peakY = gh; land(gh); return;
    }
    if (pressed('jump') || pressed('crouch') || exhausted) {
      endGlide(); state = 'air'; peakY = p.y; airT = 0.5; return;
    }
    anim.params.bank = Math.max(-1, Math.min(1, -turn / CFG.glideTurn));
    anim.setLayer('glide', 9);
  }
  function endGlide() { glider.stow(); events.emit('glideEnd', { position: p.clone() }); state = 'air'; }

  function enterSwim(ws) {
    state = 'swim'; glider.stow(); crouching = false;
    vel.y = Math.min(0, vel.y) * 0.2;
    events.emit('swimStart', { position: p.clone(), surface: ws });
    anim.setLayer('swim', 6);
  }
  function updateSwim(dt) {
    const m = readMove();
    const mag = Math.min(1, Math.hypot(m.x, m.y));
    wishDir(m, wish);
    const fast = held('sprint') && !exhausted && mag > 0.3;
    let speed = (fast ? CFG.swimFast : CFG.swim) * mag;
    if (exhausted) speed *= 0.5;
    vel.x += (wish.x * speed - vel.x) * Math.min(1, dt * 3);
    vel.z += (wish.z * speed - vel.z) * Math.min(1, dt * 3);
    const flow = water()?.getFlow?.(p.x, p.z, tv3);
    if (flow) { vel.x += flow.x * dt * 0.8; vel.z += flow.z * dt * 0.8; }
    if (mag > 0.1) turnToward(Math.atan2(wish.x, wish.z), dt, 5);
    prevP.copy(p);
    p.x += vel.x * dt; p.z += vel.z * dt;
    resolveColliders(p);
    const ws = waterAt(p.x, p.z);
    const gh = terrainH(p.x, p.z);
    if (ws === null || ws - gh < 1.1) {   // reached the shallows
      if (ws === null || gh >= p.y - 0.4) { state = 'ground'; p.y = Math.max(gh, p.y); events.emit('swimEnd', { position: p.clone() }); return; }
    }
    // steep bank in front: climb out
    world.getNormal(p.x, p.z, nrm);
    if (gh > ws - 1.0 && nrm.y < CFG.climbable && mag > 0.3) {
      p.x = prevP.x; p.z = prevP.z;
      if (startClimb(null, nrm.x, nrm.y, nrm.z)) return;
    }
    const targetY = (ws ?? p.y) - 1.18 + Math.sin(ctx.uniforms.uTime.value * 2.2) * 0.03;
    p.y += (targetY - p.y) * Math.min(1, dt * 5);
    if (fast) useStamina(CFG.drainSwim * dt);
    else if (mag > 0.1 && exhausted) useStamina(0);
    else regenStamina(dt, 0.6);
    if (exhausted && stamina <= 0.01) {
      sinkT += dt;
      if (sinkT > 2.5) { sinkT = 0; damage(4, { source: 'drown', type: 'drown' }); if (state !== 'dead') respawn(); }
    } else sinkT = 0;
    const hs = Math.hypot(vel.x, vel.z);
    const before = swimPhase;
    swimPhase += dt * (1.6 + hs * 0.9);
    if (Math.floor(before / Math.PI) !== Math.floor(swimPhase / Math.PI) && hs > 0.5) events.emit('footstep', { position: p, surface: 'swim', speed: hs, state });
    anim.params.phase = swimPhase; anim.params.move = Math.min(1, hs / 1.5);
    anim.setLayer('swim', 6);
  }
  let sinkT = 0;

  function updateClimb(dt) {
    const m = readMove();
    climb.jumpT = Math.max(0, climb.jumpT - dt);
    const n = climb.n;
    // tangent basis on the surface
    const upT = tv.copy(upV).addScaledVector(n, -n.y);
    if (upT.lengthSq() < 1e-4) upT.set(0, 0, 1);
    upT.normalize();
    const rightT = tv2.set(-n.x, -n.y, -n.z).cross(upT).normalize();
    let mx = m.x, my = m.y;
    const moving = Math.hypot(mx, my) > 0.1;
    if (climb.jumpT > 0) {
      climb.c.addScaledVector(climb.jumpDir, CFG.climbJump / 0.35 * dt);
    } else if (slipping > 0) {
      slipping -= dt;
      climb.c.addScaledVector(upT, -1.6 * dt);
    } else if (moving) {
      const sp = CFG.climb * (exhausted ? 0.5 : 1);
      climb.c.addScaledVector(rightT, mx * sp * dt).addScaledVector(upT, my * sp * dt);
      useStamina(CFG.drainClimb * dt);
      // rain makes rock slick: periodic slips while climbing up
      if (U.uRain.value > 0.25 && my > 0.2) {
        slipT += dt * U.uRain.value;
        if (slipT > 1.6) { slipT = 0; slipping = 0.45; events.emit('climbSlip', { position: p.clone() }); }
      }
    } else useStamina(CFG.drainClimbIdle * dt);
    // climb jump
    if (pressed('jump') && climb.jumpT <= 0) {
      if (my < -0.5 || (!moving && held('crouch'))) { dropOff(true); return; }
      if (stamina > 2) {
        climb.jumpDir.copy(upT).multiplyScalar(my > 0.1 || !moving ? 1 : 0).addScaledVector(rightT, mx).normalize();
        if (climb.jumpDir.lengthSq() < 0.5) climb.jumpDir.copy(upT);
        climb.jumpT = 0.35; useStamina(CFG.drainClimbJump);
        events.emit('jump', { position: p.clone(), climb: true });
      }
    }
    if (pressed('crouch')) { dropOff(false); return; }
    if (exhausted && stamina <= 0.01) { dropOff(false); return; }

    const ok = projectClimb(climb.c, n);
    if (!ok) { dropOff(false); return; }
    p.copy(climb.c); p.y -= 0.95;

    // top out?
    if (climb.coll) {
      const k = climb.coll, top = k.type === 'sphere' ? k.y + k.r : k.y + k.hy;
      if (climb.c.y > top - 0.35 && (my > 0 || climb.jumpT > 0)) {
        startMantle(climb.c.x - n.x * 0.7, top, climb.c.z - n.z * 0.7); events.emit('climbEnd', { position: p.clone(), top: true }); return;
      }
      if (climb.c.y < colliderBottom(k) + 0.8) { // reached the floor
        const g = groundAt(p.x, p.z, p.y + 0.3);
        if (p.y <= g + 0.1) { p.y = g; toGround(); return; }
      }
    } else {
      // walkable surface just above -> mantle over the lip
      const ax = climb.c.x - n.x * 0.5 + upT.x * 0.6, az = climb.c.z - n.z * 0.5 + upT.z * 0.6;
      world.getNormal(ax, az, nrm2);
      const lipH = terrainH(ax, az);
      if (nrm2.y > CFG.walkable && lipH < climb.c.y + 0.9 && (my > 0 || climb.jumpT > 0)) {
        startMantle(ax, lipH, az); events.emit('climbEnd', { position: p.clone(), top: true }); return;
      }
      if (n.y > CFG.walkable + 0.05) { toGround(); return; }
      // feet at the floor while climbing down
      const fh = terrainH(p.x + n.x * 0.3, p.z + n.z * 0.3);
      world.getNormal(p.x + n.x * 0.3, p.z + n.z * 0.3, nrm2);
      if (my < 0 && nrm2.y > CFG.walkable && p.y <= fh + 0.15) { p.y = fh; p.x += n.x * 0.3; p.z += n.z * 0.3; toGround(); return; }
    }
    // face the wall
    turnToward(Math.atan2(-n.x, -n.z), dt, 14);
    const before = climbPhase;
    if (moving || climb.jumpT > 0) climbPhase += dt * (climb.jumpT > 0 ? 9 : 4.2);
    if (Math.floor(before / Math.PI) !== Math.floor(climbPhase / Math.PI)) events.emit('footstep', { position: p, surface: 'climb', speed: 1, state });
    anim.params.phase = climbPhase;
    anim.params.move = moving || climb.jumpT > 0 ? 1 : 0;
    anim.params.look = mx * 0.6;
    anim.setLayer('climb', 10);
  }
  function dropOff(kick) {
    state = 'air'; airT = 0.3; peakY = p.y; wallGrabCooldown = 0.45;
    vel.set(climb.n.x * (kick ? 3.2 : 1.2), kick ? 3 : 0, climb.n.z * (kick ? 3.2 : 1.2));
    p.x += climb.n.x * 0.1; p.z += climb.n.z * 0.1;
    events.emit('climbEnd', { position: p.clone(), top: false });
  }
  function toGround() {
    state = 'ground'; grounded = true; vel.set(0, 0, 0); wallGrabCooldown = 0.3;
    p.y = groundAt(p.x, p.z, p.y + 0.3);
    events.emit('climbEnd', { position: p.clone(), top: false });
  }
  function updateMantle(dt) {
    mantle.t += dt / mantle.dur;
    const t = Math.min(1, mantle.t);
    const up = Math.min(1, t * 1.7), fw = Math.max(0, (t - 0.35) / 0.65);
    const e = fw * fw * (3 - 2 * fw);
    p.x = mantle.from.x + (mantle.to.x - mantle.from.x) * e;
    p.z = mantle.from.z + (mantle.to.z - mantle.from.z) * e;
    p.y = mantle.from.y + (mantle.to.y - mantle.from.y) * (1 - (1 - up) * (1 - up));
    anim.params.phase = 0; anim.params.move = 0;
    anim.setLayer(t < 0.45 ? 'climb' : 'crouch', 12);
    if (t >= 1) {
      p.y = groundAt(p.x, p.z, p.y + 0.2);
      state = 'ground'; grounded = true; vel.set(0, 0, 0); squashV -= 1.5;
    }
  }
  function updateDead(dt) {
    deadT += dt;
    vel.y -= CFG.gravity * dt;
    p.y = Math.max(groundAt(p.x, p.z, p.y), p.y + vel.y * dt);
    if (deadT > 3.2) respawn();
  }

  // ---------------- debug / screenshot placement ----------------
  function findFlat(x, z, maxR = 60) {
    for (let r = 0; r <= maxR; r += 3) {
      const nA = r === 0 ? 1 : Math.max(6, Math.round(r * 1.2));
      for (let i = 0; i < nA; i++) {
        const a = i / nA * Math.PI * 2, qx = x + Math.cos(a) * r, qz = z + Math.sin(a) * r;
        world.getNormal(qx, qz, nrm);
        const h = terrainH(qx, qz);
        const ws = waterAt(qx, qz);
        if (nrm.y > 0.93 && (ws === null || ws < h - 0.1) && queryColliders(qx, qz, 1.2).length === 0) return tv3.set(qx, h, qz);
      }
    }
    return tv3.set(x, terrainH(x, z), z);
  }
  function findPath(x, z, maxR = 220) {
    if (!world.getPathMask) return null;
    for (let r = 0; r <= maxR; r += 3) {
      const nA = r === 0 ? 1 : Math.max(8, Math.round(r * 1.2));
      for (let i = 0; i < nA; i++) {
        const a = i / nA * Math.PI * 2, qx = x + Math.cos(a) * r, qz = z + Math.sin(a) * r;
        if (world.getPathMask(qx, qz) < 0.8) continue;
        world.getNormal(qx, qz, nrm);
        if (nrm.y < 0.93) continue;
        // direction along the path: the tangent where the mask stays high
        let bestA = 0, bv = -1;
        for (let k = 0; k < 16; k++) {
          const b = k / 16 * Math.PI * 2;
          const v = world.getPathMask(qx + Math.sin(b) * 6, qz + Math.cos(b) * 6) + world.getPathMask(qx + Math.sin(b) * 12, qz + Math.cos(b) * 12);
          if (v > bv) { bv = v; bestA = b; }
        }
        return { x: qx, z: qz, h: terrainH(qx, qz), yaw: bestA };
      }
    }
    return null;
  }
  function findCliff(x, z) {
    // nearest tall steep terrain wall (prefers sunlit faces so the climber reads well)
    const sun = ctx.systems.sky?.getSunDir?.() || U.uSunDir.value;
    let best = null, bs = Infinity, foundR = Infinity;
    for (let r = 4; r < 700 && r < foundR + 80; r += 6) {
      const nA = Math.max(8, Math.round(r * 0.9));
      for (let i = 0; i < nA; i++) {
        const a = i / nA * Math.PI * 2, qx = x + Math.cos(a) * r, qz = z + Math.sin(a) * r;
        world.getNormal(qx, qz, nrm);
        if (nrm.y > 0.32) continue;
        const h = terrainH(qx, qz);
        const ws = waterAt(qx, qz); if (ws !== null && ws > h - 2) continue;
        const hu = terrainH(qx - nrm.x * 3, qz - nrm.z * 3);
        const hu2 = terrainH(qx - nrm.x * 8, qz - nrm.z * 8);
        const hd = terrainH(qx + nrm.x * 4, qz + nrm.z * 4);
        if (hu - h < 5 || hu2 - h < 12 || h - hd < 1.5) continue;
        const lit = (nrm.x * sun.x + nrm.z * sun.z) / Math.max(0.2, Math.hypot(sun.x, sun.z));
        const score = r - lit * 90;
        if (foundR === Infinity) foundR = r;
        if (score < bs) { bs = score; best = { x: qx, z: qz, nx: nrm.x, ny: nrm.y, nz: nrm.z, h }; }
      }
    }
    return best;
  }
  function findGlideSpot(x, z) {
    let best = null, bs = -Infinity;
    for (let gx = -500; gx <= 500; gx += 25) for (let gz = -500; gz <= 500; gz += 25) {
      const qx = x + gx, qz = z + gz, h = terrainH(qx, qz);
      if (h < 25) continue;
      for (let k = 0; k < 8; k++) {
        const a = k / 8 * Math.PI * 2, dx = Math.sin(a), dz = Math.cos(a);
        let minAhead = Infinity, maxAhead = -Infinity;
        for (const d of [40, 90, 160, 260]) { const hh = terrainH(qx + dx * d, qz + dz * d); minAhead = Math.min(minAhead, hh); maxAhead = Math.max(maxAhead, hh); }
        const ws = waterAt(qx + dx * 90, qz + dz * 90);
        const drop = h - minAhead;
        const score = drop - Math.max(0, maxAhead - h + 10) * 2 - Math.hypot(gx, gz) * 0.04 + (ws !== null ? 10 : 0);
        if (score > bs) { bs = score; best = { x: qx, z: qz, h, yaw: a }; }
      }
    }
    return best;
  }
  function frameCamera(dist, height, sideAngle, tgtH = 1.1, fov = 50, shift = 0) {
    // camera on a circle around the hero at angle relative to facing (0 = behind);
    // shift slides the aim sideways so the hero sits off-centre (rule of thirds)
    const a = yaw + Math.PI + sideAngle;
    const pos = tv.set(p.x + Math.sin(a) * dist, p.y + height, p.z + Math.cos(a) * dist);
    const gh = terrainH(pos.x, pos.z) + 0.5; if (pos.y < gh) pos.y = gh;
    const rx = -Math.cos(a), rz = Math.sin(a);   // camera right
    cam.frame(pos, tv2.set(p.x + rx * shift, p.y + tgtH, p.z + rz * shift), fov);
  }

  function debugPlace(o = {}) {
    const st = o.state || 'idle';
    let x = o.x ?? p.x, z = o.z ?? p.z;
    yaw = o.yaw ?? yaw;
    vel.set(0, 0, 0); glider.snap(0); glider.group.visible = false;
    if (health <= 0) health = CFG.health;
    hold = { state: st, t: 0 };
    state = 'pose'; crouching = false; guard = false;
    anim.params.speedN = 0; anim.params.move = 0;
    let layer = 'idle';
    const camSet = [3.6, 1.2, 0.5, 1.1, 48, 0];   // dist, height, side, targetH, fov, shift
    if (st === 'climb') {
      const c = findCliff(x, z);
      if (c) {
        // start a few metres up the wall
        climb.coll = null; climb.n.set(c.nx, c.ny, c.nz);
        climb.c.set(c.x, c.h + 0.95, c.z);
        projectClimb(climb.c, climb.n);
        for (let i = 0; i < 6; i++) {
          upward(climb.c, climb.n, 0.5); projectClimb(climb.c, climb.n);
        }
        p.copy(climb.c); p.y -= 0.95;
        yaw = Math.atan2(-climb.n.x, -climb.n.z);
      } else { const f = findFlat(x, z); p.copy(f); }
      layer = 'climb'; anim.params.move = 1; anim.params.phase = 1.1;
      hold.anim = 'climb';
      Object.assign(camSet, [5.6, -0.4, 0.8, 1.6, 55, 0.7]);
    } else if (st === 'glide') {
      const g = findGlideSpot(x, z);
      if (g) { p.set(g.x, g.h + 16, g.z); yaw = g.yaw; } else { p.set(x, terrainH(x, z) + 30, z); }
      glider.snap(1); glider.group.visible = true;
      layer = 'glide';
      Object.assign(camSet, [5.2, 2.0, 0.42, 1.6, 55, 0]);
    } else {
      const f = findFlat(x, z); p.copy(f);
      if (st === 'run') {
        const pa = findPath(x, z);
        if (pa) { p.set(pa.x, pa.h, pa.z); yaw = pa.yaw; }
        layer = 'locomotion'; anim.params.speedN = 1.15; Object.assign(camSet, [4.0, 1.5, 2.2, 0.95, 46]);
      }
      else if (st === 'combat') { layer = 'guard'; Object.assign(camSet, [3.6, 1.1, 2.4, 1.0, 46]); }
      else if (st === 'camp') { layer = 'sit'; Object.assign(camSet, [3.0, 1.0, 2.5, 0.6, 46]); }
      else if (st === 'cooking') { layer = 'kneel'; Object.assign(camSet, [2.8, 1.1, 2.4, 0.7, 46]); }
      else if (st === 'shrine') { layer = 'look'; Object.assign(camSet, [3.4, 1.0, 0.35, 1.3, 50]); }
      else { layer = 'idle'; Object.assign(camSet, [2.9, 2.05, 2.35, 1.1, 44, 0.55]); }
    }
    hold.layer = layer;
    anim.setLayer(layer); anim.snap();
    lastSafe.copy(p);
    syncTransforms(0);
    anim.update(0, 0, null);
    // pre-roll the cloth with the airflow of the pose
    holdVel(clothVel);
    cloth.settle(2.5, { velocity: clothVel, ground: p.y, lift: st === 'glide' ? 0.15 : 0 });
    frameCamera(...camSet);
    hold.cam = camSet;
    ctx.focus.copy(p); U.uPlayerPos.value.copy(p);
    if (ctx.systems.terrain?.settle && !shotMode) ctx.systems.terrain.settle();
    return { position: p.clone(), yaw };
  }
  function upward(c, n, d) {
    const upT = tv2.copy(upV).addScaledVector(n, -n.y).normalize();
    c.addScaledVector(upT, d);
  }
  function holdVel(out) {
    out.set(0, 0, 0);
    if (!hold) return out;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    if (hold.state === 'run') out.set(fx * 5.4, 0, fz * 5.4);
    else if (hold.state === 'glide') out.set(fx * CFG.glideFwd, -CFG.glideSink, fz * CFG.glideFwd);
    return out;
  }
  function updateHold(dt) {
    hold.t += dt;
    if (hold.layer === 'locomotion') { phase += dt * 5.4 / 1.5 * Math.PI; anim.params.phase = phase; }
    if (hold.layer === 'climb') { anim.params.phase = 1.1 + Math.sin(hold.t * 0.5) * 0.1; }
    // any player input releases the pose
    if (!shotMode && inputEnabled) {
      const m = input.move();
      if (Math.hypot(m.x, m.y) > 0.1 || input.justPressed('jump')) releaseHold();
    }
  }
  function releaseHold() {
    const was = hold?.state; hold = null;
    cam.unframe();
    if (was === 'glide') { state = 'glide'; glider.deploy(); }
    else if (was === 'climb') { state = 'climb'; }
    else { state = 'ground'; }
  }

  // ---------------- transforms ----------------
  function syncTransforms(dt) {
    // body orientation per state
    let pitchT = 0, rollT = 0;
    const hs = Math.hypot(vel.x, vel.z);
    const s = hold ? hold.state : state;
    if (s === 'climb' && climb.n) pitchT = Math.asin(Math.max(-1, Math.min(1, climb.n.y))) * 0.9;
    else if (s === 'glide') { pitchT = 0.18; rollT = -anim.params.bank * 0.35; }
    else if (s === 'swim') pitchT = Math.min(1, hs / 2) * 1.15;
    else if (state === 'ground') rollT = Math.max(-0.25, Math.min(0.25, -yawVel * hs * 0.012));
    const k = dt > 0 ? Math.min(1, dt * 8) : 1;
    bodyPitch += (pitchT - bodyPitch) * k;
    bodyRoll += (rollT - bodyRoll) * k;
    group.position.copy(p);
    // pitch around the chest so climbing/swimming tilt about the body's centre
    group.rotation.set(0, yaw, 0);
    model.rotation.set(bodyPitch, 0, bodyRoll);
    model.position.set(0, 0.95 * (1 - Math.cos(bodyPitch)), -Math.sin(bodyPitch) * 0.95 * (s === 'swim' ? 0.2 : s === 'climb' ? 1.0 : 0.4));
    if (s === 'swim') model.position.y += 0.35 * Math.min(1, bodyPitch);
    // squash & stretch spring
    squashV += (-squash * 140 - squashV * 14) * Math.min(dt, 0.05);
    squash += squashV * Math.min(dt, 0.05);
    squash = Math.max(-0.28, Math.min(0.2, squash));
    const sy = 1 + squash, sxz = 1 / Math.sqrt(Math.max(0.6, sy));
    model.scale.set(sxz, sy, sxz);
    group.updateMatrixWorld(true);
  }

  // ---------------- main update ----------------
  function update(dt) {
    dt = Math.min(dt, 1 / 20);
    const t = U.uTime.value;
    invuln = Math.max(0, invuln - dt);
    wallGrabCooldown = Math.max(0, wallGrabCooldown - dt);
    if (hold) updateHold(dt);
    else if (!frozen) {
      if (state === 'ground') updateGround(dt);
      else if (state === 'air') updateAir(dt);
      else if (state === 'glide') updateGlide(dt);
      else if (state === 'climb') updateClimb(dt);
      else if (state === 'swim') updateSwim(dt);
      else if (state === 'mantle') updateMantle(dt);
      else if (state === 'dead') updateDead(dt);
      else if (state === 'pose') state = 'ground';
      if (state !== 'ground') sprinting = false;
      guard = state === 'ground' && (guardExternal || (held('shield') && !crouching));
    }
    // keep the world bounded
    const half = world.WORLD_SIZE / 2 - 20;
    p.x = Math.max(-half, Math.min(half, p.x)); p.z = Math.max(-half, Math.min(half, p.z));

    // foot planting on uneven ground
    footLift[0] = footLift[1] = 0;
    if (!hold && state === 'ground' || hold && (hold.layer === 'idle' || hold.layer === 'guard' || hold.layer === 'look')) {
      const cs = Math.cos(yaw), sn = Math.sin(yaw);
      const hL = terrainH(p.x + cs * 0.1, p.z - sn * 0.1), hR = terrainH(p.x - cs * 0.1, p.z + sn * 0.1);
      const lo = Math.min(hL, hR), base = p.y;
      const drop = Math.max(0, base - lo);
      if (drop < 0.4) {
        footLift[0] = Math.max(0, hL - lo) * 0.9; footLift[1] = Math.max(0, hR - lo) * 0.9;
      }
    }
    syncTransforms(dt);
    if (footLift[0] + footLift[1] > 0.005) {
      // lower the whole body to the lower foot, lift the other with knee bend
      const cs = Math.cos(yaw), sn = Math.sin(yaw);
      const hL = terrainH(p.x + cs * 0.1, p.z - sn * 0.1), hR = terrainH(p.x - cs * 0.1, p.z + sn * 0.1);
      model.position.y += Math.min(hL, hR) - p.y;
      group.updateMatrixWorld(true);
    }
    anim.update(dt, t, footLift);

    // cloth + glider
    if (hold) holdVel(clothVel); else clothVel.copy(vel);
    const groundY = state === 'climb' || state === 'glide' ? -1e9 : terrainH(p.x, p.z);
    cloth.update(dt, { velocity: clothVel, ground: groundY, lift: (hold ? hold.state : state) === 'glide' ? 0.15 : 0 });
    glider.update(dt, { t, bank: anim.params.bank || 0, speed: Math.hypot(clothVel.x, clothVel.z) });

    // contact shadow
    const gh = groundAt(p.x, p.z, p.y + 0.1);
    const above = p.y - gh;
    blob.position.set(p.x, gh + 0.03, p.z);
    world.getNormal(p.x, p.z, nrm);
    blob.quaternion.setFromUnitVectors(upV, tv.set(nrm.x, nrm.y, nrm.z));
    const bs = Math.max(0, 1 - above / 6);
    blob.visible = bs > 0.02 && state !== 'swim' && !(hold && hold.state === 'climb') && state !== 'climb';
    blob.scale.setScalar(0.7 + 0.5 * (1 - bs));
    blob.material.opacity = bs;

    // damage flash / invulnerability blink
    flash = Math.max(0, flash - dt * 3);
    for (const m of allMats) m.uniforms.uTint.value.setRGB(flash * 0.5, flash * 0.12, flash * 0.08);
    rig.mesh.visible = !(invuln > 0 && state !== 'dead' && flash <= 0 && Math.sin(t * 40) > 0.6);

    // expiring updrafts
    for (const u of updrafts) if (u.until && t > u.until) updrafts.delete(u);

    // camera
    camInfo.pos = p; camInfo.yaw = yaw; camInfo.state = hold ? hold.state : (crouching && state === 'ground' ? 'crouch' : state);
    camInfo.speed = Math.hypot(vel.x, vel.z); camInfo.vel = vel; camInfo.sprinting = sprinting;
    cam.update(dt, camInfo);

    ctx.focus.copy(p);
    U.uPlayerPos.value.copy(p);
    hud.update(dt, { stamina, max: CFG.stamina, exhausted, pos: p, draining: staminaUseT < 0.05, visible: stamina < CFG.stamina - 0.01 });
  }
  const camInfo = { pos: p, yaw: 0, state: 'ground', speed: 0, vel, sprinting: false };
  let guardExternal = false;

  // ---------------- spawn ----------------
  function teleport(x, z, y = null, yw = null) {
    p.set(x, 0, z);
    p.y = y ?? groundAt(x, z, 1e4);
    vel.set(0, 0, 0); state = 'ground'; hold = null;
    if (health <= 0) health = CFG.health;
    if (yw !== null) yaw = yw;
    lastSafe.copy(p);
    syncTransforms(0);
    anim.update(0, 0, null);
    cloth.reset();
    cam.snapBehind(yaw);
    ctx.focus.copy(p); U.uPlayerPos.value.copy(p);
  }
  {
    const f = findFlat(150, 250, 30);
    teleport(f.x, f.z, null, 0.6);
  }

  const api = {
    group, rig, camera: cam, cfg: CFG,
    get position() { return p; },
    get velocity() { return vel; },
    get state() { return hold ? hold.state : state; },
    get yaw() { return yaw; },
    get stamina() { return stamina; }, set stamina(v) { stamina = Math.max(0, Math.min(CFG.stamina, v)); },
    get maxStamina() { return CFG.stamina; },
    get health() { return health; }, set health(v) { health = Math.max(0, Math.min(CFG.health, v)); },
    get maxHealth() { return CFG.health; },
    get exhausted() { return exhausted; },
    get crouching() { return crouching; },
    get grounded() { return state === 'ground'; },
    get gliding() { return state === 'glide'; },
    get climbing() { return state === 'climb'; },
    get swimming() { return state === 'swim'; },
    handR: rig.handPropR, handL: rig.handPropL, back: rig.backProp,
    radius: CFG.radius, height: CFG.height,
    getPosition: () => p,
    heal, damage,
    kill: () => damage(9999, { source: 'kill' }),
    playAction: (name, opts) => anim.play(name, opts),
    releaseAction: () => anim.release(),
    get action() { return anim.action; },
    setGuard(v) { guardExternal = !!v; },
    setLockTarget: t => cam.setLockTarget(t),
    addUpdraft(o = {}) {
      const data = { x: o.x ?? 0, z: o.z ?? 0, y: o.y ?? terrainH(o.x ?? 0, o.z ?? 0), radius: o.radius ?? 4, height: o.height ?? 40, strength: o.strength ?? 9 };
      const h = { data, until: o.duration ? U.uTime.value + o.duration : 0, remove: () => updrafts.delete(h), setPosition(x, y, z) { data.x = x; data.y = y; data.z = z; } };
      updrafts.add(h);
      return h;
    },
    get updrafts() { return updrafts; },
    teleport: (x, z, yw) => teleport(x, z, null, yw ?? null),
    debugPlace,
    releaseHold,
    setInputEnabled(v) { inputEnabled = !!v; },
    freeze(v) { frozen = !!v; },
    addStamina(n) { stamina = Math.min(CFG.stamina, stamina + n); if (stamina > 0) exhausted = false; },
    update,
  };
  window.__player = api;
  return api;
}
