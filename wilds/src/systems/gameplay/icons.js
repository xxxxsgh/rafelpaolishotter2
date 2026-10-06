// Hand-painted-looking item icons drawn on a canvas (cached data URLs). Soft gradients,
// a warm key light from the upper left, a thin dark ink line and a few highlight strokes.
// getIcon(id | dish | weaponInfo) -> dataURL (128x128, transparent background).
import { ITEMS, EFFECTS } from './items.js';

const cache = new Map();
const S = 128;
const INK = 'rgba(34,26,40,0.85)';

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (k > 0) { r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k; }
  else { r *= 1 + k; g *= 1 + k; b *= 1 + k * 0.7; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
function blob(g, x, y, rx, ry, c, opts = {}) {
  const gr = g.createRadialGradient(x - rx * 0.35, y - ry * 0.4, Math.min(rx, ry) * 0.1, x, y, Math.max(rx, ry) * 1.05);
  gr.addColorStop(0, shade(c, 0.35)); gr.addColorStop(0.55, c); gr.addColorStop(1, shade(c, -0.35));
  g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, rx, ry, opts.rot || 0, 0, Math.PI * 2); g.fill();
  if (opts.ink !== false) { g.strokeStyle = INK; g.lineWidth = opts.lw || 2.5; g.stroke(); }
}
function hilite(g, x, y, r, a0 = 3.6, a1 = 4.6, w = 3) {
  g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = w; g.lineCap = 'round';
  g.beginPath(); g.arc(x, y, r, a0, a1); g.stroke();
}
function path(g, pts, c, close = true, ink = true, lw = 2.5) {
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (p.length === 4) g.quadraticCurveTo(p[0], p[1], p[2], p[3]); else g.lineTo(p[0], p[1]);
  }
  if (close) g.closePath();
  if (c) { g.fillStyle = c; g.fill(); }
  if (ink) { g.strokeStyle = INK; g.lineWidth = lw; g.stroke(); }
}
function grad(g, x0, y0, x1, y1, c0, c1) { const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, c0); gr.addColorStop(1, c1); return gr; }
function shadow(g, y = 108, w = 34) {
  const gr = g.createRadialGradient(64, y, 2, 64, y, w);
  gr.addColorStop(0, 'rgba(20,24,40,0.35)'); gr.addColorStop(1, 'rgba(20,24,40,0)');
  g.fillStyle = gr; g.beginPath(); g.ellipse(64, y, w, w * 0.28, 0, 0, 7); g.fill();
}
function leaf(g, x, y, len, w, ang, c) {
  g.save(); g.translate(x, y); g.rotate(ang);
  path(g, [[0, 0], [w, -len * 0.4, 0, -len], [-w, -len * 0.4, 0, 0]], grad(g, 0, 0, 0, -len, shade(c, -0.25), shade(c, 0.2)), true, true, 2);
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(0, -2); g.lineTo(0, -len * 0.85); g.stroke();
  g.restore();
}

const DRAW = {
  mushroom(g, it) {
    shadow(g);
    const tall = it.tall;
    path(g, [[54, 104], [52, 74, 58, tall ? 50 : 62], [70, tall ? 50 : 62], [76, 74, 74, 104], [64, 110, 54, 104]], grad(g, 50, 0, 78, 0, shade(it.c2, 0.1), shade(it.c2, -0.25)));
    const cy = tall ? 50 : 60, rx = tall ? 26 : 38, ry = tall ? 30 : 24;
    g.beginPath(); g.moveTo(64 - rx, cy + 6); g.quadraticCurveTo(64 - rx, cy - ry * 1.5, 64, cy - ry * 1.4); g.quadraticCurveTo(64 + rx, cy - ry * 1.5, 64 + rx, cy + 6);
    g.quadraticCurveTo(64, cy + 14, 64 - rx, cy + 6);
    const gr = g.createRadialGradient(50, cy - ry, 4, 64, cy - 4, rx * 1.3);
    gr.addColorStop(0, shade(it.c, 0.4)); gr.addColorStop(0.5, it.c); gr.addColorStop(1, shade(it.c, -0.4));
    g.fillStyle = gr; g.fill(); g.strokeStyle = INK; g.lineWidth = 2.5; g.stroke();
    if (it.spots) for (const [x, y, r] of [[50, cy - 14, 5], [70, cy - 20, 6], [80, cy - 4, 4], [58, cy - 2, 3.5], [40, cy - 2, 3]]) { g.fillStyle = '#fbf2e2'; g.beginPath(); g.ellipse(x, y, r, r * 0.8, 0, 0, 7); g.fill(); }
    if (it.glow) { g.globalCompositeOperation = 'lighter'; const gg = g.createRadialGradient(64, cy - 8, 2, 64, cy - 8, 50); gg.addColorStop(0, 'rgba(220,255,140,0.45)'); gg.addColorStop(1, 'rgba(220,255,140,0)'); g.fillStyle = gg; g.fillRect(0, 0, S, S); g.globalCompositeOperation = 'source-over'; }
    hilite(g, 60, cy, ry * 0.9, 3.5, 4.3, 3.5);
  },
  shelf(g, it) {
    shadow(g);
    path(g, [[46, 108], [44, 60], [84, 60], [82, 108]], grad(g, 44, 0, 84, 0, '#7a5a3a', '#4a3424'));
    for (const [y, rx] of [[62, 40], [80, 32], [96, 26]]) blob(g, 66, y, rx, 9, it.c);
  },
  herb(g, it) {
    shadow(g);
    for (let i = 0; i < 7; i++) leaf(g, 64, 104, 54 + (i % 2) * 10, 11, -1.2 + i * 0.4, i % 2 ? it.c : it.c2);
  },
  reed(g, it) {
    shadow(g);
    for (let i = 0; i < 5; i++) leaf(g, 60 + i * 2, 108, 80 + (i % 2) * 8, 5, -0.3 + i * 0.15, i % 2 ? it.c : it.c2);
    blob(g, 70, 24, 5, 12, '#b89a5a'); blob(g, 56, 30, 4.5, 11, '#b89a5a');
  },
  flower(g, it) {
    shadow(g);
    g.strokeStyle = '#3f7a2a'; g.lineWidth = 4; g.beginPath(); g.moveTo(64, 108); g.quadraticCurveTo(60, 80, 64, 50); g.stroke();
    leaf(g, 63, 92, 30, 8, -0.9, '#4f8a2a'); leaf(g, 63, 84, 26, 7, 0.8, '#4f8a2a');
    const n = it.id === 'sunpetal' ? 12 : 6;
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2;
      g.save(); g.translate(64, 44); g.rotate(a);
      path(g, [[0, 0], [n > 8 ? 7 : 12, -12, 0, n > 8 ? -26 : -24], [n > 8 ? -7 : -12, -12, 0, 0]], grad(g, 0, 0, 0, -24, it.c2, it.c), true, true, 1.8);
      g.restore();
    }
    blob(g, 64, 44, 8, 8, it.id === 'sunpetal' ? '#8a4a1a' : '#ffe070');
  },
  root(g, it) {
    shadow(g);
    for (let i = 0; i < 4; i++) leaf(g, 64, 50, 34, 9, -0.9 + i * 0.6, '#3f8a3a');
    g.beginPath(); g.moveTo(64, 102); g.bezierCurveTo(30, 80, 34, 44, 52, 46); g.bezierCurveTo(60, 46, 64, 54, 64, 58); g.bezierCurveTo(64, 54, 68, 46, 76, 46); g.bezierCurveTo(94, 44, 98, 80, 64, 102);
    const gr = g.createRadialGradient(52, 58, 3, 64, 70, 40); gr.addColorStop(0, shade(it.c, 0.45)); gr.addColorStop(0.6, it.c); gr.addColorStop(1, shade(it.c, -0.35));
    g.fillStyle = gr; g.fill(); g.strokeStyle = INK; g.lineWidth = 2.5; g.stroke();
    hilite(g, 52, 62, 10, 3.4, 4.6, 3);
  },
  fruit(g, it) {
    shadow(g);
    blob(g, 64, 70, 32, 30, it.c);
    g.strokeStyle = '#5a3a20'; g.lineWidth = 4; g.beginPath(); g.moveTo(64, 44); g.quadraticCurveTo(66, 32, 70, 26); g.stroke();
    leaf(g, 68, 34, 24, 8, 1.1, '#4f9a2a');
    hilite(g, 56, 64, 18, 3.5, 4.5, 4);
  },
  berries(g, it) {
    shadow(g);
    leaf(g, 64, 50, 30, 10, -0.6, '#3f7a2a'); leaf(g, 64, 50, 26, 9, 0.7, '#4f8a2a');
    for (const [x, y, r] of [[50, 78, 13], [74, 80, 14], [62, 62, 12], [62, 94, 12], [84, 64, 10], [42, 60, 10]]) { blob(g, x, y, r, r, it.c); hilite(g, x - 2, y - 2, r * 0.6, 3.6, 4.6, 2.5); }
  },
  pepper(g, it) {
    shadow(g);
    g.save(); g.translate(64, 66); g.rotate(-0.6);
    path(g, [[-8, -30], [14, -26, 10, 10], [6, 30, -2, 40], [-14, 20, -14, -10], [-14, -28, -8, -30]], grad(g, -14, 0, 14, 0, shade(it.c, 0.3), shade(it.c, -0.35)));
    path(g, [[-8, -30], [-4, -40], [2, -44]], null, false, true, 0); g.strokeStyle = it.c2; g.lineWidth = 6; g.beginPath(); g.moveTo(-6, -30); g.quadraticCurveTo(-2, -42, 6, -46); g.stroke();
    hilite(g, -2, 0, 14, 2.8, 3.6, 3);
    g.restore();
  },
  melon(g, it) {
    shadow(g);
    blob(g, 64, 70, 40, 32, it.c);
    g.strokeStyle = 'rgba(30,70,40,0.75)'; g.lineWidth = 5;
    for (let i = -2; i <= 2; i++) { g.beginPath(); g.ellipse(64, 70, Math.abs(i) * 9 + 3, 31, 0, -1.4, 1.4); if (i < 0) { g.save(); g.scale(-1, 1); g.restore(); } g.stroke(); }
    hilite(g, 52, 60, 20, 3.5, 4.4, 4);
  },
  fish(g, it) {
    shadow(g, 104, 40);
    g.save(); g.translate(64, 64); g.rotate(-0.25);
    path(g, [[-30, 0], [-44, -16], [-42, 0], [-44, 16]], it.c);
    path(g, [[-34, 0], [-20, -20, 10, -18], [36, -14, 40, 0], [36, 14, 10, 16], [-20, 18, -34, 0]], grad(g, 0, -18, 0, 16, shade(it.c, 0.1), shade(it.c2, 0.1)));
    path(g, [[-4, -17], [6, -30], [14, -16]], shade(it.c, -0.2));
    g.fillStyle = INK; g.beginPath(); g.arc(26, -4, 3.2, 0, 7); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 3; g.beginPath(); g.moveTo(-14, -4); g.quadraticCurveTo(8, -10, 28, -6); g.stroke();
    g.restore();
  },
  meat(g, it) {
    shadow(g);
    g.save(); g.translate(64, 64); g.rotate(-0.5);
    blob(g, 34, 0, 8, 8, it.c2); blob(g, 40, 6, 7, 7, it.c2);
    path(g, [[8, -5], [34, -4], [34, 4], [8, 5]], it.c2);
    blob(g, -10, 0, 30, 24, it.c);
    g.strokeStyle = 'rgba(255,240,230,0.7)'; g.lineWidth = 4; g.beginPath(); g.arc(-12, 0, 16, 3.6, 5.2); g.stroke();
    g.restore();
  },
  egg(g, it) {
    shadow(g);
    blob(g, 64, 66, 26, 34, it.c);
    g.fillStyle = it.c2; for (const [x, y, r] of [[56, 52, 3], [72, 60, 2.5], [60, 78, 3.5], [76, 82, 2], [50, 70, 2]]) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
    hilite(g, 58, 58, 16, 3.5, 4.4, 3.5);
  },
  wheat(g, it) {
    shadow(g);
    for (let i = -3; i <= 3; i++) {
      g.strokeStyle = it.c2; g.lineWidth = 2.5; g.beginPath(); g.moveTo(64 + i * 2, 108); g.lineTo(64 + i * 7, 40); g.stroke();
      for (let k = 0; k < 4; k++) blob(g, 64 + i * 7 + (k % 2 ? 3 : -3), 40 - k * 7, 4, 7, it.c, { lw: 1.5 });
    }
    g.fillStyle = '#a83a2a'; g.fillRect(56, 82, 16, 6);
  },
  salt(g, it) { DRAW.sack(g, it); },
  sugar(g, it) { DRAW.sack(g, it); },
  sack(g, it) {
    shadow(g);
    path(g, [[40, 104], [30, 80, 44, 56], [52, 48], [76, 48], [86, 56, 96, 80], [88, 104]], grad(g, 30, 0, 96, 0, '#d8c8a8', '#9a8a68'));
    g.fillStyle = '#8a5a3a'; g.fillRect(50, 46, 28, 6);
    blob(g, 64, 40, 18, 8, it.c);
    for (let i = 0; i < 5; i++) blob(g, 54 + i * 5, 36 - (i % 2) * 3, 3, 3, '#ffffff', { lw: 1 });
  },
  butter(g, it) {
    shadow(g);
    path(g, [[30, 84], [64, 98], [98, 84], [64, 72]], '#d8c8a8');
    path(g, [[38, 64], [64, 54], [90, 64], [90, 80], [64, 90], [38, 80]], grad(g, 38, 0, 90, 0, shade(it.c, 0.3), shade(it.c, -0.2)));
    path(g, [[38, 64], [64, 74], [90, 64], [64, 54]], shade(it.c, 0.35));
  },
  milk(g, it) { DRAW.bottleShape(g, it.c, it.c2, false); },
  honey(g, it) {
    shadow(g);
    path(g, [[38, 56], [90, 56], [92, 104], [36, 104]], grad(g, 36, 0, 92, 0, shade(it.c, 0.35), shade(it.c, -0.3)));
    path(g, [[34, 44], [94, 44], [94, 58], [34, 58]], '#e8d8b8');
    g.fillStyle = shade(it.c, 0.1); g.beginPath(); g.moveTo(46, 58); g.quadraticCurveTo(48, 72, 52, 66); g.quadraticCurveTo(56, 76, 60, 58); g.fill();
    hilite(g, 52, 80, 14, 2.6, 3.6, 3);
  },
  bottleShape(g, c, c2, glow = true) {
    shadow(g);
    path(g, [[54, 26], [74, 26], [74, 36], [54, 36]], '#9a7048');
    path(g, [[56, 36], [72, 36], [72, 50], [90, 66, 90, 84], [90, 106, 64, 106], [38, 106, 38, 84], [38, 66, 56, 50]], grad(g, 0, 50, 0, 106, shade(c2, 0.2), c));
    if (glow) { g.globalCompositeOperation = 'lighter'; const gg = g.createRadialGradient(64, 84, 2, 64, 84, 40); gg.addColorStop(0, 'rgba(255,255,255,0.35)'); gg.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gg; g.fillRect(0, 0, S, S); g.globalCompositeOperation = 'source-over'; }
    hilite(g, 58, 84, 18, 2.6, 3.7, 4);
  },
  gem(g, it) {
    shadow(g);
    blob(g, 64, 96, 34, 12, '#7a7468');
    const cr = (x, y, w, h, a) => { g.save(); g.translate(x, y); g.rotate(a); path(g, [[-w, 0], [-w, -h], [0, -h - w * 1.4], [w, -h], [w, 0]], grad(g, -w, 0, w, 0, shade(it.c2, 0.1), shade(it.c, -0.2))); g.strokeStyle = 'rgba(255,255,255,0.65)'; g.lineWidth = 2; g.beginPath(); g.moveTo(-w * 0.3, -2); g.lineTo(-w * 0.3, -h); g.stroke(); g.restore(); };
    cr(48, 98, 9, 34, -0.35); cr(80, 98, 8, 30, 0.4); cr(64, 96, 12, 50, 0);
    g.globalCompositeOperation = 'lighter'; const gg = g.createRadialGradient(64, 60, 2, 64, 60, 40); gg.addColorStop(0, it.c + '55'); gg.addColorStop(1, it.c + '00'); g.fillStyle = gg; g.fillRect(0, 0, S, S); g.globalCompositeOperation = 'source-over';
  },
  flint(g, it) {
    shadow(g);
    path(g, [[32, 90], [40, 56], [66, 40], [92, 54], [98, 84], [70, 102]], grad(g, 30, 40, 98, 100, shade(it.c2, 0.1), shade(it.c, -0.3)));
    path(g, [[40, 56], [66, 40], [92, 54], [66, 66]], shade(it.c2, 0.25));
  },
  horn(g, it) {
    shadow(g);
    g.lineCap = 'round';
    for (let i = 0; i < 12; i++) { const t = i / 11; g.strokeStyle = shade(t < 0.5 ? it.c2 : it.c, (t - 0.5) * 0.4); g.lineWidth = 22 * (1 - t * 0.85); g.beginPath(); const a = 3.4 - t * 2.4; g.arc(70, 76, 34, a, a - 0.25, true); g.stroke(); }
  },
  fang(g, it) { shadow(g); path(g, [[44, 40], [86, 44], [80, 60, 60, 108], [50, 70, 44, 40]], grad(g, 44, 0, 86, 0, shade(it.c, 0.2), shade(it.c2, -0.1))); hilite(g, 60, 60, 14, 3.2, 4.2, 3); },
  shellplate(g, it) { shadow(g); blob(g, 64, 68, 40, 28, it.c); g.strokeStyle = shade(it.c2, 0.1); g.lineWidth = 4; for (let i = -1; i <= 1; i++) { g.beginPath(); g.moveTo(64 + i * 18, 44); g.quadraticCurveTo(64 + i * 24, 68, 64 + i * 18, 92); g.stroke(); } },
  core(g, it) {
    shadow(g);
    g.globalCompositeOperation = 'lighter'; const gg = g.createRadialGradient(64, 62, 2, 64, 62, 50); gg.addColorStop(0, 'rgba(255,190,90,0.7)'); gg.addColorStop(1, 'rgba(255,190,90,0)'); g.fillStyle = gg; g.fillRect(0, 0, S, S); g.globalCompositeOperation = 'source-over';
    g.strokeStyle = it.c2; g.lineWidth = 7; g.beginPath(); g.ellipse(64, 62, 36, 14, -0.3, 0, 7); g.stroke();
    path(g, [[64, 32], [86, 62], [64, 92], [42, 62]], grad(g, 42, 32, 86, 92, '#fff0c0', it.c));
  },
  essence(g, it) {
    g.globalCompositeOperation = 'lighter';
    const gg = g.createRadialGradient(64, 62, 2, 64, 62, 52); gg.addColorStop(0, 'rgba(255,255,240,1)'); gg.addColorStop(0.25, it.c); gg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gg; g.fillRect(0, 0, S, S);
    g.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 6; i++) { const a = i * 1.05; g.fillStyle = 'rgba(255,250,220,0.9)'; g.beginPath(); g.arc(64 + Math.cos(a) * 34, 62 + Math.sin(a) * 30, 2.5, 0, 7); g.fill(); }
  },
  mossstone(g, it) { shadow(g); blob(g, 64, 72, 36, 28, it.c); g.fillStyle = it.c2; g.beginPath(); g.ellipse(60, 56, 30, 14, -0.1, 3.1, 6.3); g.fill(); g.strokeStyle = INK; g.lineWidth = 2; g.stroke(); },
  sigil(g, it) {
    g.globalCompositeOperation = 'lighter'; const gg = g.createRadialGradient(64, 64, 2, 64, 64, 56); gg.addColorStop(0, 'rgba(255,180,90,0.5)'); gg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gg; g.fillRect(0, 0, S, S); g.globalCompositeOperation = 'source-over';
    blob(g, 64, 64, 40, 40, '#8a7a5a');
    g.strokeStyle = it.c; g.lineWidth = 5; g.beginPath(); g.arc(64, 64, 30, 0, 7); g.stroke();
    path(g, [[64, 40], [80, 64], [64, 88], [48, 64]], grad(g, 48, 40, 80, 88, '#e0ffff', it.c2));
    g.strokeStyle = it.c; g.lineWidth = 3; for (let i = 0; i < 4; i++) { const a = i * 1.57 + 0.78; g.beginPath(); g.moveTo(64 + Math.cos(a) * 18, 64 + Math.sin(a) * 18); g.lineTo(64 + Math.cos(a) * 28, 64 + Math.sin(a) * 28); g.stroke(); }
  },
  sail(g, it) {
    shadow(g);
    path(g, [[16, 70], [40, 34, 64, 30], [88, 34, 112, 70], [64, 58]], grad(g, 0, 30, 0, 70, it.c, shade(it.c, -0.2)));
    g.strokeStyle = it.c2; g.lineWidth = 4; for (const x of [40, 64, 88]) { g.beginPath(); g.moveTo(64, 96); g.lineTo(x, x === 64 ? 58 : 50); g.stroke(); }
    path(g, [[54, 92], [74, 92], [74, 104], [54, 104]], '#7a5a3a');
  },
  chart(g, it) {
    shadow(g);
    path(g, [[26, 34], [102, 30], [98, 96], [30, 100]], grad(g, 26, 30, 102, 100, '#f4ead2', '#d8c8a0'));
    g.strokeStyle = it.c2; g.lineWidth = 2; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(38, 84); g.quadraticCurveTo(60, 50, 88, 46); g.stroke(); g.setLineDash([]);
    g.strokeStyle = '#c0402a'; g.lineWidth = 3; g.beginPath(); g.moveTo(82, 40); g.lineTo(92, 50); g.moveTo(92, 40); g.lineTo(82, 50); g.stroke();
    blob(g, 46, 56, 9, 6, '#8ab070', { lw: 1.5 }); blob(g, 70, 76, 11, 7, '#7ab0d0', { lw: 1.5 });
  },
  // ------------------------------------------------ dishes
  bowl(g, d) {
    shadow(g, 104, 44);
    path(g, [[22, 62], [106, 62], [100, 90, 74, 100], [64, 102], [54, 102], [28, 90, 22, 62]], grad(g, 22, 0, 106, 0, '#e8dcc0', '#9a7a58'));
    blob(g, 64, 62, 42, 12, d.c);
    for (const [x, y, r] of [[50, 60, 6], [70, 58, 7], [80, 64, 5], [58, 66, 5], [44, 64, 4]]) blob(g, x, y, r, r * 0.7, d.c2, { lw: 1.5 });
    leaf(g, 70, 60, 14, 5, 0.8, '#4f9a2a');
    DRAW._steam(g);
  },
  skewer(g, d) {
    shadow(g, 100, 44);
    g.strokeStyle = '#c8a070'; g.lineWidth = 4; g.beginPath(); g.moveTo(16, 102); g.lineTo(112, 30); g.stroke();
    for (let i = 0; i < 4; i++) blob(g, 36 + i * 20, 86 - i * 15, 13, 11, i % 2 ? d.c2 : d.c, { rot: -0.6 });
    DRAW._steam(g);
  },
  pie(g, d) {
    shadow(g, 102, 44);
    path(g, [[18, 66], [110, 66], [104, 90], [24, 90]], grad(g, 0, 66, 0, 90, '#e0a860', '#a86a30'));
    blob(g, 64, 66, 46, 16, '#e8b870');
    blob(g, 64, 64, 38, 12, d.c, { lw: 1.5 });
    g.strokeStyle = '#f0c880'; g.lineWidth = 4; for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(64 + i * 14 - 8, 56); g.lineTo(64 + i * 14 + 8, 72); g.stroke(); }
    DRAW._steam(g);
  },
  plate(g, d) {
    shadow(g, 100, 46);
    blob(g, 64, 80, 52, 18, '#ece0c8');
    blob(g, 64, 78, 40, 13, '#d8ccb4', { ink: false });
    for (const [x, y, r] of [[48, 70, 12], [70, 66, 13], [84, 76, 10], [58, 82, 10], [74, 84, 9]]) blob(g, x, y, r, r * 0.75, Math.round(x) % 2 ? d.c : d.c2);
    DRAW._steam(g);
  },
  bread(g, d) {
    shadow(g, 100, 44);
    blob(g, 64, 74, 48, 22, d.c);
    g.strokeStyle = d.c2; g.lineWidth = 4; for (let i = -1; i <= 1; i++) { g.beginPath(); g.moveTo(52 + i * 20, 64); g.quadraticCurveTo(58 + i * 20, 74, 54 + i * 20, 86); g.stroke(); }
    hilite(g, 54, 74, 30, 3.6, 4.4, 4);
  },
  bottle(g, d) { DRAW.bottleShape(g, d.c, d.c2 || '#ffffff', true); },
  mash(g, d) {
    shadow(g, 104, 44);
    path(g, [[22, 62], [106, 62], [100, 90, 74, 100], [64, 102], [54, 102], [28, 90, 22, 62]], grad(g, 22, 0, 106, 0, '#c8bca8', '#7a6a58'));
    blob(g, 64, 58, 40, 18, d.c);
    for (const [x, y, r] of [[48, 54, 7], [72, 50, 6], [62, 60, 5]]) blob(g, x, y, r, r * 0.8, d.c2, { lw: 1.2 });
    g.strokeStyle = 'rgba(140,170,120,0.6)'; g.lineWidth = 3; for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(48 + i * 14, 40); g.bezierCurveTo(40 + i * 14, 30, 58 + i * 14, 24, 50 + i * 14, 12); g.stroke(); }
  },
  omelette(g, d) {
    shadow(g, 100, 46);
    blob(g, 64, 80, 52, 18, '#ece0c8');
    path(g, [[24, 78], [44, 50, 80, 56], [108, 64, 100, 80], [64, 92, 24, 78]], grad(g, 0, 50, 0, 90, shade(d.c, 0.3), shade(d.c, -0.15)));
    for (let i = 0; i < 5; i++) blob(g, 44 + i * 11, 64 - (i % 2) * 4, 3, 2, d.c2, { lw: 1 });
    DRAW._steam(g);
  },
  pudding(g, d) {
    shadow(g, 102, 44);
    blob(g, 64, 92, 46, 14, '#ece0c8');
    path(g, [[40, 92], [48, 48], [80, 48], [88, 92]], grad(g, 40, 0, 88, 0, shade(d.c, 0.25), shade(d.c, -0.2)));
    blob(g, 64, 48, 16, 6, d.c2);
    g.fillStyle = d.c2; g.beginPath(); g.moveTo(50, 50); g.quadraticCurveTo(52, 62, 56, 56); g.quadraticCurveTo(64, 66, 70, 52); g.quadraticCurveTo(76, 62, 78, 50); g.fill();
    hilite(g, 54, 70, 14, 2.6, 3.6, 3);
  },
  cup(g, d) {
    shadow(g, 104, 36);
    g.strokeStyle = '#a8885a'; g.lineWidth = 7; g.beginPath(); g.arc(92, 72, 12, -1.4, 1.4); g.stroke();
    path(g, [[34, 46], [94, 46], [88, 100], [40, 100]], grad(g, 34, 0, 94, 0, '#e8c8a0', '#9a7448'));
    blob(g, 64, 46, 30, 8, d.c);
    DRAW._steam(g);
  },
  _steam(g) {
    g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 3; g.lineCap = 'round';
    for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(48 + i * 16, 40); g.bezierCurveTo(40 + i * 16, 30, 58 + i * 16, 22, 50 + i * 16, 10); g.stroke(); }
  },
  // ------------------------------------------------ gear (combat-owned)
  sword(g, w) {
    shadow(g, 108, 30);
    g.save(); g.translate(64, 64); g.rotate(0.78);
    path(g, [[-5, 20], [-6, -36], [0, -50], [6, -36], [5, 20]], grad(g, -6, 0, 6, 0, '#f0f4f8', '#8a9aac'));
    path(g, [[-18, 20], [18, 20], [18, 26], [-18, 26]], '#b8863a');
    path(g, [[-4, 26], [4, 26], [4, 46], [-4, 46]], '#6a3a2a');
    blob(g, 0, 50, 6, 6, '#d8a040');
    g.restore();
  },
  spear(g) { g.save(); g.translate(64, 64); g.rotate(0.78); path(g, [[-2.5, 56], [-2.5, -30], [2.5, -30], [2.5, 56]], '#9a6a3a'); path(g, [[-7, -28], [0, -56], [7, -28]], grad(g, -7, 0, 7, 0, '#f0f4f8', '#8a9aac')); g.restore(); },
  club(g) { g.save(); g.translate(64, 64); g.rotate(0.78); path(g, [[-4, 50], [-12, -40], [0, -50], [12, -40], [4, 50]], grad(g, -12, 0, 12, 0, '#a87a4a', '#5a3a22')); for (const [x, y] of [[-10, -30], [9, -20], [-8, -8], [10, 0]]) path(g, [[x, y], [x + (x > 0 ? 8 : -8), y - 2], [x, y + 5]], '#d8d0c0', true, true, 1.5); g.restore(); },
  bowGear(g) {
    shadow(g, 108, 30);
    g.strokeStyle = '#7a4a2a'; g.lineWidth = 7; g.lineCap = 'round'; g.beginPath(); g.arc(30, 64, 52, -1.0, 1.0); g.stroke();
    g.strokeStyle = 'rgba(240,235,220,0.9)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(30 + Math.cos(-1) * 52, 64 + Math.sin(-1) * 52); g.lineTo(30 + Math.cos(1) * 52, 64 + Math.sin(1) * 52); g.stroke();
    g.fillStyle = '#d8a040'; g.fillRect(76, 58, 10, 12);
  },
  shieldGear(g) {
    shadow(g, 108, 34);
    path(g, [[30, 30], [98, 30], [98, 66, 64, 104], [30, 66, 30, 30]], grad(g, 30, 30, 98, 104, '#a8784a', '#5a3a24'));
    g.strokeStyle = '#c8c0b0'; g.lineWidth = 5; g.beginPath(); g.moveTo(30, 30); g.lineTo(98, 30); g.stroke();
    blob(g, 64, 58, 10, 10, '#c8c0b0');
  },
};

export function getIcon(x) {
  let key, fn, arg;
  if (typeof x === 'string') {
    const it = ITEMS[x];
    key = 'i:' + x; arg = it || { c: '#ccc', c2: '#888' }; fn = DRAW[arg.shape] || DRAW.flint;
  } else if (x && x.kind && x.c) { key = 'd:' + x.kind + x.c + x.c2; arg = x; fn = DRAW[x.kind] || DRAW.bowl; }
  else if (x && x.type) {
    const t = x.type; key = 'w:' + t;
    fn = t === 'bow' ? DRAW.bowGear : t === 'shield' ? DRAW.shieldGear : t === 'spear' ? DRAW.spear : t === 'club' ? DRAW.club : DRAW.sword; arg = x;
  } else return '';
  if (cache.has(key)) return cache.get(key);
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.lineJoin = 'round'; g.lineCap = 'round';
  try { fn(g, arg); } catch (e) { /* never break UI on an icon */ }
  const url = cv.toDataURL();
  cache.set(key, url);
  return url;
}
export function effectIconColor(effect) { return EFFECTS[effect]?.color || '#fff'; }
