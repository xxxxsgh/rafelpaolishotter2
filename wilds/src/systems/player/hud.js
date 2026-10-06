// Stamina wheel that floats beside the hero (screen-projected), fading in while stamina is
// in use. Original look: a thin warm-gold ring on a soft dark track with a feather notch;
// turns ember-red and pulses while exhausted. Drawn to a tiny canvas only when it changes.
export function createHud(ctx) {
  const { THREE, camera } = ctx;
  const S = 64, dpr = 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S * dpr;
  cv.className = 'wb-stamina';
  Object.assign(cv.style, {
    position: 'absolute', left: '0', top: '0', width: S + 'px', height: S + 'px', pointerEvents: 'none',
    opacity: '0', transition: 'opacity .35s', filter: 'drop-shadow(0 1px 3px rgba(0,0,0,.45))', zIndex: 5,
  });
  ctx.hud?.appendChild(cv);
  const g = cv.getContext('2d');
  const proj = new THREE.Vector3();
  let lastV = -1, lastEx = null, alpha = 0, shownT = 0;

  function draw(v, ex, pulse) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, S, S);
    const c = S / 2, r = 22;
    g.lineCap = 'round';
    g.lineWidth = 7; g.strokeStyle = 'rgba(18,28,32,0.55)';
    g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.stroke();
    const col = ex ? `rgba(${220 + 35 * pulse | 0},${90 + 30 * pulse | 0},60,1)` : v > 0.3 ? '#f2d68a' : '#f0a85a';
    g.lineWidth = 5; g.strokeStyle = col;
    g.beginPath(); g.arc(c, c, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.001, v)); g.stroke();
    // inner hairline + feather notch
    g.lineWidth = 1; g.strokeStyle = 'rgba(255,248,230,0.5)';
    g.beginPath(); g.arc(c, c, r - 6, 0, Math.PI * 2); g.stroke();
    g.fillStyle = col;
    g.beginPath(); g.moveTo(c, c - r - 6); g.lineTo(c + 3, c - r + 1); g.lineTo(c, c - r + 4); g.lineTo(c - 3, c - r + 1); g.closePath(); g.fill();
  }

  return {
    el: cv,
    update(dt, o) {
      if (!cv.isConnected) { ctx.hud?.appendChild(cv); }
      const v = o.stamina / o.max;
      const want = o.visible ? 1 : 0;
      shownT = o.visible ? 1.2 : Math.max(0, shownT - dt);
      const target = shownT > 0 ? 1 : 0;
      alpha += (target - alpha) * Math.min(1, dt * 6);
      cv.style.opacity = alpha.toFixed(2);
      if (alpha < 0.01) return;
      const pulse = o.exhausted ? 0.5 + 0.5 * Math.sin(performance.now() / 120) : 0;
      if (Math.abs(v - lastV) > 0.002 || o.exhausted !== lastEx || o.exhausted) { draw(v, o.exhausted, pulse); lastV = v; lastEx = o.exhausted; }
      // beside the hero's shoulder
      proj.set(o.pos.x, o.pos.y + 1.3, o.pos.z).project(camera);
      const w = ctx.renderer.domElement.clientWidth, h = ctx.renderer.domElement.clientHeight;
      const x = (proj.x * 0.5 + 0.5) * w + Math.min(110, 46 + w * 0.03), y = (-proj.y * 0.5 + 0.5) * h - S / 2;
      cv.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
      void want;
    },
  };
}
