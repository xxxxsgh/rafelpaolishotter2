// Canvas painting helpers for the UI: hearts, glyphs (map markers, tabs, weather), small utilities.
// Everything is drawn procedurally; nothing is loaded.

export const GOLD = '#f4dfae', GOLD_D = '#c9a86a', INK = '#1a1712';

export function makeCanvas(w, h = w, dpr = 2) {
  const c = document.createElement('canvas');
  c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { c, g, w, h, dpr };
}

// ---------------------------------------------------------------- hearts
// An original "ember-leaf" heart: two rounded lobes with a small pointed crest between them and a
// long tapering tip, framed in a thin gold line. Fill is in quarters, clockwise wedges from the top.
function heartPath(g, s) {
  const c = s / 2;
  g.beginPath();
  g.moveTo(c, s * 0.3);                                           // crest notch
  g.bezierCurveTo(c + s * 0.05, s * 0.12, c + s * 0.28, s * 0.04, c + s * 0.38, s * 0.16);
  g.bezierCurveTo(c + s * 0.5, s * 0.3, c + s * 0.44, s * 0.52, c + s * 0.28, s * 0.67);
  g.bezierCurveTo(c + s * 0.16, s * 0.78, c + s * 0.06, s * 0.86, c, s * 0.95);   // long tip
  g.bezierCurveTo(c - s * 0.06, s * 0.86, c - s * 0.16, s * 0.78, c - s * 0.28, s * 0.67);
  g.bezierCurveTo(c - s * 0.44, s * 0.52, c - s * 0.5, s * 0.3, c - s * 0.38, s * 0.16);
  g.bezierCurveTo(c - s * 0.28, s * 0.04, c - s * 0.05, s * 0.12, c, s * 0.3);
  g.closePath();
}
export function drawHeart(g, s, fill, opts = {}) {
  g.clearRect(0, 0, s, s);
  const c = s / 2, pad = s * 0.06;
  g.save();
  g.translate(pad, pad); const S = s - pad * 2;
  // empty socket
  heartPath(g, S);
  g.fillStyle = 'rgba(12,16,20,0.55)'; g.fill();
  if (fill > 0) {
    g.save();
    heartPath(g, S); g.clip();
    if (fill < 1) {   // quarter wedges, clockwise from the crest
      g.beginPath(); g.moveTo(S / 2, S * 0.52);
      g.arc(S / 2, S * 0.52, S, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * fill); g.closePath(); g.clip();
    }
    const gr = g.createLinearGradient(0, 0, S * 0.4, S);
    const hue = opts.gold ? ['#fff3c8', '#f2c75a', '#a8721e'] : ['#ffb2a0', '#f2504a', '#a01e2c'];
    gr.addColorStop(0, hue[0]); gr.addColorStop(0.45, hue[1]); gr.addColorStop(1, hue[2]);
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    // facet: a soft diagonal plane on the right lobe + a gleam on the left
    g.fillStyle = 'rgba(80,0,20,0.22)';
    g.beginPath(); g.moveTo(S / 2, S * 0.3); g.lineTo(S * 0.98, S * 0.3); g.lineTo(S / 2, S); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = S * 0.055; g.lineCap = 'round';
    g.beginPath(); g.arc(S * 0.3, S * 0.3, S * 0.13, Math.PI * 1.05, Math.PI * 1.55); g.stroke();
    g.restore();
  }
  heartPath(g, S);
  g.lineWidth = Math.max(1, S * 0.05);
  g.strokeStyle = fill > 0 ? 'rgba(255,236,196,0.95)' : 'rgba(232,204,150,0.55)';
  g.stroke();
  g.restore();
  void c;
}
export function heartCanvas(px, fill, opts) {
  const { c, g } = makeCanvas(px, px, 2);
  drawHeart(g, px, fill, opts);
  return c;
}

// ---------------------------------------------------------------- glyphs
// glyph(g, kind, x, y, r, opts) — markers in the same hairline-gold language
export function glyph(g, kind, x, y, r, o = {}) {
  g.save(); g.translate(x, y);
  const ink = o.ink || 'rgba(24,18,12,0.9)';
  const lw = o.lw || Math.max(1, r * 0.16);
  g.lineJoin = 'round'; g.lineCap = 'round';
  const fillStroke = (f, s = ink) => { g.fillStyle = f; g.fill(); g.strokeStyle = s; g.lineWidth = lw; g.stroke(); };
  switch (kind) {
    case 'player': {
      g.rotate(o.rot || 0);
      g.beginPath(); g.moveTo(0, -r * 1.25); g.lineTo(r * 0.85, r * 0.9); g.lineTo(0, r * 0.45); g.lineTo(-r * 0.85, r * 0.9); g.closePath();
      g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = r * 0.6;
      fillStroke(o.fill || '#fff6dc', '#2a2216');
      g.shadowBlur = 0;
      g.beginPath(); g.moveTo(0, -r * 1.25); g.lineTo(0, r * 0.45); g.strokeStyle = 'rgba(200,150,60,.8)'; g.lineWidth = lw * 0.8; g.stroke();
      break;
    }
    case 'spire': {   // slender stone needle with a crystal
      const on = o.active;
      g.beginPath(); g.moveTo(-r * 0.42, r); g.lineTo(-r * 0.2, -r * 0.5); g.lineTo(r * 0.2, -r * 0.5); g.lineTo(r * 0.42, r); g.closePath();
      fillStroke(on ? '#e9dcc0' : '#b8ab90');
      g.beginPath(); g.moveTo(0, -r * 1.25); g.lineTo(r * 0.32, -r * 0.72); g.lineTo(0, -r * 0.4); g.lineTo(-r * 0.32, -r * 0.72); g.closePath();
      if (on) { g.shadowColor = '#9ff0ff'; g.shadowBlur = r * 0.9; }
      fillStroke(on ? '#a8f2ff' : '#7f909a');
      break;
    }
    case 'sanctum': { // hexagonal seal with an inner eye-ring
      g.beginPath(); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + Math.PI / 6; g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); } g.closePath();
      if (!o.solved) { g.shadowColor = '#ffa040'; g.shadowBlur = r * 0.8; }
      fillStroke(o.solved ? '#d9cfb8' : '#f0a04a');
      g.shadowBlur = 0;
      g.beginPath(); g.arc(0, 0, r * 0.42, 0, Math.PI * 2); fillStroke(o.solved ? '#f4ecd8' : '#ffe2a8');
      g.beginPath(); g.arc(0, 0, r * 0.14, 0, Math.PI * 2); g.fillStyle = ink; g.fill();
      break;
    }
    case 'camp': {    // crossed stakes over a little tent
      g.beginPath(); g.moveTo(-r, r * 0.8); g.lineTo(0, -r * 0.7); g.lineTo(r, r * 0.8); g.closePath(); fillStroke(o.cleared ? '#cbbf9f' : '#c8584a');
      g.beginPath(); g.moveTo(-r * 0.75, -r * 1.05); g.lineTo(r * 0.45, r * 0.15); g.moveTo(r * 0.75, -r * 1.05); g.lineTo(-r * 0.45, r * 0.15); g.strokeStyle = ink; g.lineWidth = lw; g.stroke();
      g.beginPath(); g.moveTo(0, r * 0.8); g.lineTo(0, r * 0.15); g.stroke();
      break;
    }
    case 'fire': {
      g.beginPath(); g.moveTo(0, -r * 1.1); g.bezierCurveTo(r * 0.9, -r * 0.3, r * 0.8, r * 0.8, 0, r * 0.85); g.bezierCurveTo(-r * 0.8, r * 0.8, -r * 0.9, -r * 0.1, -r * 0.2, -r * 0.4);
      g.bezierCurveTo(-r * 0.15, -r * 0.65, -r * 0.05, -r * 0.8, 0, -r * 1.1); g.closePath();
      fillStroke(o.lit === false ? '#b8a890' : '#ff9a3a');
      g.beginPath(); g.ellipse(0, r * 0.35, r * 0.28, r * 0.42, 0, 0, Math.PI * 2); g.fillStyle = o.lit === false ? '#e0d4bc' : '#ffe28a'; g.fill();
      break;
    }
    case 'quest': {   // gold diamond with an inner spark
      g.rotate(Math.PI / 4);
      g.beginPath(); g.rect(-r * 0.72, -r * 0.72, r * 1.44, r * 1.44);
      g.shadowColor = '#ffe2a0'; g.shadowBlur = r;
      fillStroke('#ffd77a', '#3a2a10');
      g.shadowBlur = 0;
      g.beginPath(); g.rect(-r * 0.28, -r * 0.28, r * 0.56, r * 0.56); g.fillStyle = '#fff8e0'; g.fill();
      break;
    }
    case 'beacon': {
      g.beginPath(); g.moveTo(-r * 0.7, r); g.lineTo(-r * 0.45, -r * 0.2); g.lineTo(r * 0.45, -r * 0.2); g.lineTo(r * 0.7, r); g.closePath(); fillStroke('#d8ccb0');
      g.beginPath(); g.moveTo(0, -r * 1.2); g.bezierCurveTo(r * 0.5, -r * 0.8, r * 0.4, -r * 0.3, 0, -r * 0.25); g.bezierCurveTo(-r * 0.4, -r * 0.3, -r * 0.5, -r * 0.8, 0, -r * 1.2);
      if (o.lit) { g.shadowColor = '#ffb050'; g.shadowBlur = r; }
      fillStroke(o.lit ? '#ffb050' : '#9a8c78');
      break;
    }
    case 'pin': {
      g.beginPath(); g.moveTo(0, r * 1.1); g.bezierCurveTo(-r * 0.2, r * 0.3, -r * 0.8, 0, -r * 0.8, -r * 0.5); g.arc(0, -r * 0.5, r * 0.8, Math.PI, 0); g.bezierCurveTo(r * 0.8, 0, r * 0.2, r * 0.3, 0, r * 1.1);
      fillStroke(o.fill || '#7fd0e0');
      g.beginPath(); g.arc(0, -r * 0.5, r * 0.3, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
      break;
    }
    case 'peak': {
      g.beginPath(); g.moveTo(-r, r * 0.6); g.lineTo(-r * 0.15, -r * 0.8); g.lineTo(r * 0.2, -r * 0.2); g.lineTo(r * 0.45, -r * 0.5); g.lineTo(r, r * 0.6); g.closePath(); fillStroke('#e8e2d4');
      break;
    }
    default: {
      g.beginPath(); g.arc(0, 0, r * 0.6, 0, Math.PI * 2); fillStroke(o.fill || '#e8dcc0');
    }
  }
  g.restore();
}
export function glyphCanvas(kind, px, o) {
  const { c, g } = makeCanvas(px, px, 2);
  glyph(g, kind, px / 2, px / 2 + (kind === 'spire' ? px * 0.04 : 0), px * 0.36, o);
  return c;
}

// ---------------------------------------------------------------- tab icons (gold line art)
export function tabIcon(kind, px = 22) {
  const { c, g } = makeCanvas(px, px, 2);
  const s = px;
  g.strokeStyle = GOLD; g.fillStyle = 'rgba(244,223,174,0.18)'; g.lineWidth = 1.3; g.lineJoin = 'round'; g.lineCap = 'round';
  g.beginPath();
  switch (kind) {
    case 'weapons': g.moveTo(s * 0.22, s * 0.78); g.lineTo(s * 0.74, s * 0.26); g.lineTo(s * 0.82, s * 0.18); g.lineTo(s * 0.8, s * 0.3); g.lineTo(s * 0.28, s * 0.82); g.closePath(); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(s * 0.16, s * 0.6); g.lineTo(s * 0.4, s * 0.84); g.moveTo(s * 0.12, s * 0.88); g.lineTo(s * 0.24, s * 0.76); break;
    case 'bows': g.moveTo(s * 0.3, s * 0.12); g.quadraticCurveTo(s * 0.95, s * 0.5, s * 0.3, s * 0.88); g.stroke(); g.beginPath(); g.moveTo(s * 0.3, s * 0.12); g.lineTo(s * 0.3, s * 0.88);
      g.moveTo(s * 0.12, s * 0.5); g.lineTo(s * 0.78, s * 0.5); g.moveTo(s * 0.7, s * 0.43); g.lineTo(s * 0.8, s * 0.5); g.lineTo(s * 0.7, s * 0.57); break;
    case 'shields': g.moveTo(s * 0.5, s * 0.1); g.lineTo(s * 0.84, s * 0.22); g.quadraticCurveTo(s * 0.84, s * 0.68, s * 0.5, s * 0.9); g.quadraticCurveTo(s * 0.16, s * 0.68, s * 0.16, s * 0.22); g.closePath(); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(s * 0.5, s * 0.22); g.lineTo(s * 0.5, s * 0.76); break;
    case 'materials': g.moveTo(s * 0.5, s * 0.88); g.lineTo(s * 0.5, s * 0.5); g.stroke(); g.beginPath(); g.ellipse(s * 0.5, s * 0.42, s * 0.32, s * 0.2, 0, Math.PI, 0); g.closePath(); g.fill(); g.stroke();
      g.beginPath(); g.ellipse(s * 0.5, s * 0.88, s * 0.18, s * 0.04, 0, 0, Math.PI * 2); break;
    case 'food': g.ellipse(s * 0.5, s * 0.58, s * 0.38, s * 0.16, 0, 0, Math.PI); g.closePath(); g.fill(); g.stroke(); g.beginPath();
      g.moveTo(s * 0.38, s * 0.42); g.quadraticCurveTo(s * 0.3, s * 0.3, s * 0.4, s * 0.18); g.moveTo(s * 0.58, s * 0.42); g.quadraticCurveTo(s * 0.5, s * 0.3, s * 0.6, s * 0.18); break;
    case 'key': g.arc(s * 0.34, s * 0.36, s * 0.18, 0, Math.PI * 2); g.fill(); g.stroke(); g.beginPath(); g.moveTo(s * 0.46, s * 0.48); g.lineTo(s * 0.84, s * 0.86);
      g.moveTo(s * 0.68, s * 0.7); g.lineTo(s * 0.78, s * 0.6); g.moveTo(s * 0.76, s * 0.78); g.lineTo(s * 0.86, s * 0.68); break;
  }
  g.stroke();
  return c;
}

// ---------------------------------------------------------------- weather glyphs (for the sky dial)
export function weatherGlyph(g, kind, x, y, r, night) {
  g.save(); g.translate(x, y);
  g.lineWidth = Math.max(1, r * 0.14); g.lineCap = 'round'; g.strokeStyle = GOLD; g.fillStyle = 'rgba(244,223,174,0.25)';
  const cloud = (ox, oy, k) => {
    g.beginPath();
    g.arc(ox - r * 0.38 * k, oy + r * 0.1 * k, r * 0.32 * k, Math.PI * 0.5, Math.PI * 1.5);
    g.arc(ox - r * 0.05 * k, oy - r * 0.15 * k, r * 0.4 * k, Math.PI * 1.1, Math.PI * 1.95);
    g.arc(ox + r * 0.38 * k, oy + r * 0.08 * k, r * 0.34 * k, Math.PI * 1.4, Math.PI * 0.5);
    g.closePath(); g.fillStyle = 'rgba(20,26,30,0.9)'; g.fill(); g.stroke();
  };
  if (kind === 'clear' || kind === 'cloudy') {
    if (night) { g.beginPath(); g.arc(0, 0, r * 0.62, 0.6, Math.PI * 2 - 0.6 + 0.0001, false); g.arc(r * 0.32, -r * 0.18, r * 0.5, Math.PI * 2 - 1.2, 1.2, true); g.closePath(); g.fill(); g.stroke(); }
    else { g.beginPath(); g.arc(0, 0, r * 0.38, 0, Math.PI * 2); g.fill(); g.stroke(); for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; g.beginPath(); g.moveTo(Math.cos(a) * r * 0.58, Math.sin(a) * r * 0.58); g.lineTo(Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82); g.stroke(); } }
    if (kind === 'cloudy') cloud(r * 0.25, r * 0.3, 0.85);
  } else if (kind === 'rain' || kind === 'storm') {
    cloud(0, -r * 0.15, 1);
    if (kind === 'storm') { g.beginPath(); g.moveTo(r * 0.05, r * 0.25); g.lineTo(-r * 0.15, r * 0.6); g.lineTo(r * 0.08, r * 0.6); g.lineTo(-r * 0.1, r * 0.98); g.stroke(); }
    else for (let i = -1; i <= 1; i++) { g.beginPath(); g.moveTo(i * r * 0.32, r * 0.35); g.lineTo(i * r * 0.32 - r * 0.12, r * 0.75); g.stroke(); }
  } else if (kind === 'fog') {
    for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(-r * 0.75 + i * r * 0.12, -r * 0.4 + i * r * 0.4); g.lineTo(r * 0.75 - (2 - i) * r * 0.1, -r * 0.4 + i * r * 0.4); g.stroke(); }
  } else if (kind === 'snow') {
    for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI; g.beginPath(); g.moveTo(Math.cos(a) * r * 0.75, Math.sin(a) * r * 0.75); g.lineTo(-Math.cos(a) * r * 0.75, -Math.sin(a) * r * 0.75); g.stroke(); }
  }
  g.restore();
}

export function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
export function fmtClock(h) { const hh = Math.floor(h) % 24, mm = Math.floor((h - Math.floor(h)) * 60); return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`; }
