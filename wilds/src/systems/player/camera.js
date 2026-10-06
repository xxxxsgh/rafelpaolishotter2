// Third-person orbit camera: mouse/gamepad orbit, wheel zoom, terrain collision, auto
// recentre behind the hero while moving, FOV kick (sprint/glide), lock-on framing, state
// specific framing (climb/glide/swim), and a "framed" mode for screenshot presets.
export function createCamera(ctx) {
  const { THREE, camera, world, input } = ctx;
  const st = {
    yaw: Math.PI, pitch: 0.28, dist: 4.6, zoom: 4.6, fov: 55,
    idleT: 0, lockTarget: null, framed: null, shake: 0,
    sens: 0.0026,
  };
  const target = new THREE.Vector3(), desired = new THREE.Vector3(), camPos = new THREE.Vector3();
  const look = new THREE.Vector3(), tmp = new THREE.Vector3(), lockP = new THREE.Vector3();
  let first = true;

  function wrap(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }

  // player: {pos (feet), yaw, speed, state, vel}
  function update(dt, pl) {
    if (st.framed) { applyFramed(); return; }
    const k = Math.min(1, dt * 60);
    const lk = input.look();
    const hasLook = Math.abs(lk.dx) + Math.abs(lk.dy) > 0.5;
    if (!ctx.paused) {
      st.yaw -= lk.dx * st.sens;
      st.pitch = Math.max(-0.55, Math.min(1.25, st.pitch + lk.dy * st.sens));
      if (input.wheel) st.zoom = Math.max(2.4, Math.min(9, st.zoom + input.wheel * 0.5));
    }
    st.idleT = hasLook ? 0 : st.idleT + dt;

    // state framing
    let dist = st.zoom, height = 1.45, fovT = 55, side = 0.0;
    const s = pl.state;
    if (s === 'glide') { dist = st.zoom * 1.25 + 0.6; height = 1.2; fovT = 64; }
    else if (s === 'climb') { dist = st.zoom * 1.05 + 0.5; height = 1.0; fovT = 56; }
    else if (s === 'swim') { height = 0.6; }
    else if (s === 'crouch') { height = 1.0; }
    if (pl.sprinting) fovT = 63;
    if (s === 'air' && pl.vel.y < -12) fovT = 60 + Math.min(10, (-pl.vel.y - 12) * 0.5);

    // auto recentre behind the hero when running and the player isn't steering the camera
    const behind = pl.yaw + Math.PI;
    if (st.lockTarget) {
      const lt = st.lockTarget.isVector3 ? st.lockTarget : st.lockTarget.position;
      if (lt) {
        lockP.copy(lt);
        const dx = lockP.x - pl.pos.x, dz = lockP.z - pl.pos.z;
        const want = Math.atan2(dx, dz) + Math.PI;
        st.yaw += wrap(want - st.yaw) * Math.min(1, dt * 6);
        st.pitch += (0.22 - st.pitch) * Math.min(1, dt * 3);
        side = 0.6;
      }
    } else if (st.idleT > 1.2 && pl.speed > 1.5 && (s === 'ground' || s === 'glide' || s === 'swim')) {
      const r = s === 'glide' ? 1.4 : 0.7;
      st.yaw += wrap(behind - st.yaw) * Math.min(1, dt * r * Math.min(1, pl.speed / 6));
      if (s === 'ground') st.pitch += (0.22 - st.pitch) * Math.min(1, dt * 0.5);
    }
    st.yaw = wrap(st.yaw);

    st.dist += (dist - st.dist) * Math.min(1, dt * 3);
    st.fov += (fovT - st.fov) * Math.min(1, dt * 3);

    // focus point (smoothed; vertical smoothing hides step/jump bob)
    tmp.copy(pl.pos); tmp.y += height;
    if (first) { target.copy(tmp); first = false; }
    target.x += (tmp.x - target.x) * Math.min(1, dt * 14);
    target.z += (tmp.z - target.z) * Math.min(1, dt * 14);
    target.y += (tmp.y - target.y) * Math.min(1, dt * (s === 'air' ? 5 : 9));

    const cp = Math.cos(st.pitch), sp = Math.sin(st.pitch);
    const sx = Math.sin(st.yaw), cz = Math.cos(st.yaw);
    // right vector (camera's right when looking at target)
    const rx = -cz, rz = sx;
    desired.set(target.x + sx * cp * st.dist + rx * side, target.y + sp * st.dist, target.z + cz * cp * st.dist + rz * side);
    // terrain collision: march from target to desired, pull in where the ground blocks
    let allowed = 1;
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = target.x + (desired.x - target.x) * t, y = target.y + (desired.y - target.y) * t, z = target.z + (desired.z - target.z) * t;
      const h = world.getHeight(x, z) + 0.35;
      if (y < h) { allowed = Math.max(0.12, (i - 1) / steps); break; }
    }
    camPos.lerpVectors(target, desired, allowed);
    const gh = world.getHeight(camPos.x, camPos.z) + 0.3;
    if (camPos.y < gh) camPos.y = gh;
    // shake
    if (st.shake > 0) {
      st.shake = Math.max(0, st.shake - dt * 2.5);
      const a = st.shake * st.shake * 0.12, t = ctx.uniforms.uTime.value;
      camPos.x += Math.sin(t * 61) * a; camPos.y += Math.sin(t * 53 + 1) * a; camPos.z += Math.sin(t * 47 + 2) * a;
    }
    if (!ctx.cameraOverride) {
      camera.position.copy(camPos);
      look.copy(target);
      if (st.lockTarget) look.lerp(lockP, 0.25);
      camera.lookAt(look);
      if (Math.abs(camera.fov - st.fov) > 0.01) { camera.fov = st.fov; camera.updateProjectionMatrix(); }
    }
  }

  function applyFramed() {
    if (ctx.cameraOverride) return;
    const f = st.framed;
    camera.position.copy(f.pos);
    camera.lookAt(f.target);
    if (camera.fov !== f.fov) { camera.fov = f.fov; camera.updateProjectionMatrix(); }
  }

  return {
    state: st, update,
    get position() { return camPos; },
    // Pin the camera for screenshots: {pos, target, fov}
    frame(pos, tgt, fov = 50) {
      st.framed = { pos: pos.clone(), target: tgt.clone(), fov };
      applyFramed();
    },
    unframe() {
      if (!st.framed) return;
      // continue orbiting from the framed viewpoint
      const f = st.framed; st.framed = null;
      tmp.subVectors(f.pos, f.target);
      st.yaw = Math.atan2(tmp.x, tmp.z);
      first = true;
    },
    snapBehind(yaw) { st.yaw = yaw + Math.PI; first = true; },
    setLockTarget(t) { st.lockTarget = t || null; },
    shake(a = 0.5) { st.shake = Math.max(st.shake, a); },
  };
}
