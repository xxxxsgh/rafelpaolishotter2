// Map data + rendering: painted world images (worker), local minimap tiles, fog of war,
// marker gathering, the HUD minimap/sky dial and the full parchment world map screen.
import { makeCanvas, glyph, GOLD, esc } from './draw.js';

const WORLD_RES = 768;
const TILE_SIZE = 720, TILE_RES = 288, TILE_MOVE = 170;
const FOG_RES = 128;           // explored grid (32 m cells over 4096 m)

export function createMapData(ctx) {
  const world = ctx.world;
  const HALF = (world.WORLD_SIZE || 4096) / 2;
  const md = {
    HALF, ready: false, paint: null, parch: null, tile: null, tileBusy: false,
    explored: new Uint8Array(FOG_RES * FOG_RES), exploredDirty: true, revealVersion: 0,
    debugReveal: [],
  };
  // two painters: one for the big world sheet, one for streaming minimap tiles
  const workers = [null, null];
  let reqId = 0;
  const pending = new Map();
  for (let i = 0; i < 2; i++) {
    try {
      const w = new Worker(new URL('./mapWorker.js', import.meta.url), { type: 'module' });
      w.onmessage = e => { const cb = pending.get(e.data.id); pending.delete(e.data.id); cb?.(e.data); };
      w.onerror = e => { console.warn('[ui] map worker failed', e.message || e); workers[i] = null; };
      workers[i] = w;
    } catch (e) { console.warn('[ui] map worker unavailable', e); }
  }

  const toCanvas = (buf, res) => {
    const c = document.createElement('canvas'); c.width = c.height = res;
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(buf), res, res), 0, 0);
    return c;
  };
  function request(q, cb, wi = 0) {
    const worker = workers[wi] || workers[1 - wi];
    if (!worker) return false;
    const id = ++reqId; pending.set(id, cb); worker.postMessage({ ...q, id }); return true;
  }
  md.requestWorld = () => request({ kind: 'world', x0: -HALF, z0: -HALF, size: HALF * 2, res: WORLD_RES, style: 'both', sketch: true }, m => {
    if (m.error) { console.warn('[ui] map paint failed', m.error); return; }
    md.paint = toCanvas(m.paint, m.res); md.parch = toCanvas(m.parch, m.res); md.sketch = toCanvas(m.sketch, m.res); md.ready = true; md.revealVersion++;
    ctx.events?.emit?.('mapPainted', {});
  });
  md.updateTile = (x, z) => {
    const t = md.tile;
    if (md.tileBusy) return;
    if (t && Math.abs(t.cx - x) < TILE_MOVE && Math.abs(t.cz - z) < TILE_MOVE) return;
    md.tileBusy = true;
    const cx = Math.round(x / 40) * 40, cz = Math.round(z / 40) * 40;
    const ok = request({ kind: 'tile', x0: cx - TILE_SIZE / 2, z0: cz - TILE_SIZE / 2, size: TILE_SIZE, res: TILE_RES, style: 'paint' }, m => {
      md.tileBusy = false;
      if (m.error) return;
      md.tile = { cx, cz, x0: m.x0, z0: m.z0, size: m.size, img: toCanvas(m.paint, m.res) };
    }, 1);
    if (!ok) md.tileBusy = false;
  };

  // ------------------------------------------------ fog of war: towers + where you've walked
  let lastEx = null;
  md.explore = (x, z, r = 150) => {
    if (lastEx && Math.hypot(lastEx.x - x, lastEx.z - z) < 20) return;
    lastEx = { x, z };
    const cell = (HALF * 2) / FOG_RES, rc = Math.ceil(r / cell);
    const ci = Math.floor((x + HALF) / cell), cj = Math.floor((z + HALF) / cell);
    let changed = false;
    for (let j = cj - rc; j <= cj + rc; j++) for (let i = ci - rc; i <= ci + rc; i++) {
      if (i < 0 || j < 0 || i >= FOG_RES || j >= FOG_RES) continue;
      const d = Math.hypot((i + 0.5) * cell - HALF - x, (j + 0.5) * cell - HALF - z);
      if (d < r && !md.explored[j * FOG_RES + i]) { md.explored[j * FOG_RES + i] = 255; changed = true; }
    }
    if (changed) { md.exploredDirty = true; md.revealVersion++; }
  };
  md.reveals = () => {
    const out = (ctx.systems.gameplay?.revealed || []).slice();
    for (const r of md.debugReveal) out.push(r);
    return out;
  };
  md.isRevealed = (x, z) => {
    for (const r of md.reveals()) if ((x - r.x) ** 2 + (z - r.z) ** 2 < (r.r * 0.92) ** 2) return true;
    const cell = (HALF * 2) / FOG_RES;
    const i = Math.floor((x + HALF) / cell), j = Math.floor((z + HALF) / cell);
    return i >= 0 && j >= 0 && i < FOG_RES && j < FOG_RES && md.explored[j * FOG_RES + i] > 0;
  };
  try {   // explored cells persist per browser (convenience only)
    const s = localStorage.getItem('windborne.ui.explored');
    if (s && !ctx.params?.has?.('shot')) { const b = atob(s); for (let i = 0; i < b.length && i < md.explored.length; i++) md.explored[i] = b.charCodeAt(i); }
  } catch { /* storage unavailable */ }
  md.persist = () => {
    if (ctx.params?.has?.('shot')) return;
    try { let s = ''; for (let i = 0; i < md.explored.length; i++) s += String.fromCharCode(md.explored[i]); localStorage.setItem('windborne.ui.explored', btoa(s)); } catch { /* ignore */ }
  };

  // ------------------------------------------------ markers
  md.markers = () => {
    const S = ctx.systems, out = [];
    const gp = S.gameplay;
    for (const s of gp?.spires || []) out.push({ kind: 'spire', x: s.x, z: s.z, label: s.name, active: s.active, always: true });
    const b = gp?.beacon; if (b && b.x !== undefined) out.push({ kind: 'beacon', x: b.x, z: b.z, label: 'Summit Beacon', lit: b.lit, always: true });
    for (const s of S.physics?.sanctums || []) out.push({ kind: 'sanctum', x: s.x, z: s.z, label: s.name || 'Sanctum', solved: s.solved });
    for (const c of S.combat?.camps || []) if (c && c.x !== undefined) out.push({ kind: 'camp', x: c.x, z: c.z, label: c.name || 'Camp', cleared: c.cleared });
    for (const f of gp?.campfires || []) if (f?.pos) out.push({ kind: 'fire', x: f.pos.x, z: f.pos.z, label: 'Campfire', lit: f.lit });
    let objs = [];
    try { objs = gp?.quests?.objectives?.() || []; } catch { objs = []; }
    for (const o of objs) out.push({ kind: 'quest', x: o.x, z: o.z, label: o.label, always: true, quest: true });
    return out;
  };
  md.regionName = (x, z) => {
    let best = null, bd = 1e18;
    const names = [...(world.LANDMARKS || []), ...REGIONS];
    for (const l of names) { const d = (l.x - x) ** 2 + (l.z - z) ** 2; if (d < bd) { bd = d; best = l; } }
    return best ? best.name : '';
  };
  return md;
}

// original region names painted on the chart (positions follow the heightfield's features)
export const REGIONS = [
  { name: 'Wildwood Hills', x: -880, z: 860 },
  { name: 'The Northern Spine', x: 120, z: -1180 },
  { name: 'Westreach Shore', x: -1500, z: 420 },
  { name: 'Eastwind Downs', x: 1180, z: 160 },
  { name: 'Highmoor', x: -460, z: -660 },
  { name: 'Brightwater Vale', x: 760, z: -330 },
  { name: 'Lantern Coast', x: 300, z: 1450 },
];

// ==================================================================== HUD minimap + sky dial
export function createMinimap(ctx, md, parent) {
  const SZ = 196, C = SZ / 2, R = 78, RANGE = 170;   // R px  = RANGE m
  const { c, g } = makeCanvas(SZ, SZ, 2);
  c.className = 'mm';
  parent.appendChild(c);
  const dir = new ctx.THREE.Vector3();
  let acc = 1;
  const markerCache = { t: -1, list: [] };

  function heading() {
    ctx.camera.getWorldDirection(dir);
    return Math.atan2(dir.x, -dir.z);   // clockwise from north
  }
  function draw(hour, daylight) {
    const pl = ctx.systems.player;
    const p = pl?.position || ctx.focus;
    const th = heading();
    g.clearRect(0, 0, SZ, SZ);
    // soft drop shadow disc + glass
    g.save();
    g.beginPath(); g.arc(C, C, R + 4, 0, Math.PI * 2);
    g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 14; g.fillStyle = 'rgba(12,17,21,.55)'; g.fill();
    g.restore();
    // terrain
    g.save();
    g.beginPath(); g.arc(C, C, R, 0, Math.PI * 2); g.clip();
    const scale = R / RANGE;
    g.translate(C, C); g.rotate(-th); g.scale(scale, scale); g.translate(-p.x, -p.z);
    g.imageSmoothingEnabled = true;
    if (md.tile) g.drawImage(md.tile.img, md.tile.x0, md.tile.z0, md.tile.size, md.tile.size);
    else if (md.paint) g.drawImage(md.paint, -md.HALF, -md.HALF, md.HALF * 2, md.HALF * 2);
    else { g.fillStyle = '#6c8a5a'; g.fillRect(p.x - RANGE * 2, p.z - RANGE * 2, RANGE * 4, RANGE * 4); }
    g.restore();
    // painterly vignette + night tint
    g.save();
    g.beginPath(); g.arc(C, C, R, 0, Math.PI * 2); g.clip();
    const vg = g.createRadialGradient(C, C, R * 0.45, C, C, R);
    vg.addColorStop(0, 'rgba(10,16,22,0)'); vg.addColorStop(1, 'rgba(10,16,22,.5)');
    g.fillStyle = vg; g.fillRect(0, 0, SZ, SZ);
    if (daylight < 0.95) { g.fillStyle = `rgba(16,28,60,${(1 - daylight) * 0.38})`; g.fillRect(0, 0, SZ, SZ); }
    // markers
    if (markerCache.t < 0 || performance.now() - markerCache.t > 1000) { markerCache.list = md.markers(); markerCache.t = performance.now(); }
    const cs = Math.cos(-th), sn = Math.sin(-th);
    for (const m of markerCache.list) {
      const dx = m.x - p.x, dz = m.z - p.z;
      let sx = (dx * cs - dz * sn) * scale, sy = (dx * sn + dz * cs) * scale;
      const d = Math.hypot(sx, sy);
      const edge = d > R - 9;
      if (edge && !m.always) continue;
      if (edge) { sx *= (R - 9) / d; sy *= (R - 9) / d; }
      glyph(g, m.kind, C + sx, C + sy, edge ? 5 : 6.2, m);
    }
    // nearby hostiles: small ember diamonds (only those that have noticed you glow)
    const en = ctx.systems.combat?.enemies;
    if (en) for (let i = 0; i < en.length; i++) {
      const e = en[i]; if (!e || e.dead || !e.pos) continue;
      const dx = e.pos.x - p.x, dz = e.pos.z - p.z;
      if (dx * dx + dz * dz > RANGE * RANGE * 0.8) continue;
      const sx = C + (dx * cs - dz * sn) * scale, sy = C + (dx * sn + dz * cs) * scale;
      g.save(); g.translate(sx, sy); g.rotate(Math.PI / 4);
      if (e.alerted) { g.shadowColor = '#ff6040'; g.shadowBlur = 6; }
      g.fillStyle = e.alerted ? '#ff7050' : 'rgba(230,120,90,.85)'; g.fillRect(-2.2, -2.2, 4.4, 4.4);
      g.strokeStyle = 'rgba(30,10,8,.8)'; g.lineWidth = 0.8; g.strokeRect(-2.2, -2.2, 4.4, 4.4);
      g.restore();
    }
    g.restore();
    // player arrow
    const yaw = pl?.yaw ?? 0;
    const hp = Math.atan2(Math.sin(yaw), -Math.cos(yaw));
    glyph(g, 'player', C, C, 6.5, { rot: hp - th });
    // rings
    g.strokeStyle = 'rgba(244,223,174,.85)'; g.lineWidth = 1.2;
    g.beginPath(); g.arc(C, C, R, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(244,223,174,.3)'; g.lineWidth = 1;
    g.beginPath(); g.arc(C, C, R + 4.5, 0, Math.PI * 2); g.stroke();
    // compass ticks rotate with heading
    for (let i = 0; i < 32; i++) {
      const a = i / 32 * Math.PI * 2 - th - Math.PI / 2;
      const big = i % 8 === 0, mid = i % 4 === 0;
      const r0 = R + 1, r1 = R + (big ? 7 : mid ? 5 : 3);
      g.strokeStyle = big ? 'rgba(244,223,174,.95)' : 'rgba(244,223,174,.45)';
      g.beginPath(); g.moveTo(C + Math.cos(a) * r0, C + Math.sin(a) * r0); g.lineTo(C + Math.cos(a) * r1, C + Math.sin(a) * r1); g.stroke();
    }
    // cardinal N with a little diamond
    const an = -th - Math.PI / 2;
    const nx = C + Math.cos(an) * (R + 12.5), ny = C + Math.sin(an) * (R + 12.5);
    g.save(); g.translate(nx, ny);
    g.fillStyle = 'rgba(12,17,21,.85)'; g.beginPath(); g.arc(0, 0, 7, 0, Math.PI * 2); g.fill();
    g.strokeStyle = GOLD; g.lineWidth = 1; g.stroke();
    g.fillStyle = GOLD; g.font = '600 9px "Palatino Linotype", Palatino, "FreeSerif", Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('N', 0, 0.5);
    g.restore();
    // sky dial: sun/moon travelling over an arc at the top of the ring
    const t = ((hour - 6) / 12);                     // 0 at dawn .. 1 at dusk
    const isDay = t >= 0 && t <= 1;
    const tt = isDay ? t : (((hour + 6) % 24) / 12);  // moon: 18 -> 0 .. 6 -> 1
    const a0 = Math.PI * 1.18, a1 = Math.PI * 1.82, ra = R + 22;
    // arc track (only inside canvas: ra must fit) – use a flatter radius
    const rr = Math.min(ra, C - 4);
    g.strokeStyle = 'rgba(244,223,174,.22)'; g.lineWidth = 1; g.setLineDash([2, 3]);
    g.beginPath(); g.arc(C, C + 6, rr, a0, a1); g.stroke(); g.setLineDash([]);
    const aa = a0 + (a1 - a0) * Math.min(1, Math.max(0, tt));
    const bx = C + Math.cos(aa) * rr, by = C + 6 + Math.sin(aa) * rr;
    g.save(); g.translate(bx, by);
    if (isDay) {
      const sg = g.createRadialGradient(0, 0, 0, 0, 0, 9); sg.addColorStop(0, 'rgba(255,230,160,.9)'); sg.addColorStop(1, 'rgba(255,200,100,0)');
      g.fillStyle = sg; g.beginPath(); g.arc(0, 0, 9, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffe6a6'; g.beginPath(); g.arc(0, 0, 3.6, 0, Math.PI * 2); g.fill();
    } else {
      g.fillStyle = '#dfe8f4'; g.beginPath(); g.arc(0, 0, 3.8, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(12,17,21,1)'; g.beginPath(); g.arc(1.8, -1.2, 3.2, 0, Math.PI * 2); g.fill();
    }
    g.restore();
  }
  return {
    el: c,
    update(dt, hour, daylight) {
      const p = ctx.systems.player?.position || ctx.focus;
      md.updateTile(p.x, p.z);
      acc += dt;
      if (acc < 1 / 20) return;   // ~20 Hz is plenty for a minimap
      acc = 0;
      draw(hour, daylight);
    },
    heading,
  };
}

// ==================================================================== compass ribbon
export function createCompass(ctx, md, parent, minimap) {
  const W = 440, H = 34;
  const { c, g } = makeCanvas(W, H, 2);
  parent.appendChild(c);
  let acc = 1, cache = [], ct = -1;
  const FOV = Math.PI * 0.9;   // visible span
  return {
    update(dt) {
      acc += dt; if (acc < 1 / 30) return; acc = 0;
      const th = minimap.heading();
      const p = ctx.systems.player?.position || ctx.focus;
      g.clearRect(0, 0, W, H);
      // fading ribbon line
      const lg = g.createLinearGradient(0, 0, W, 0);
      lg.addColorStop(0, 'rgba(244,223,174,0)'); lg.addColorStop(0.2, 'rgba(244,223,174,.5)'); lg.addColorStop(0.8, 'rgba(244,223,174,.5)'); lg.addColorStop(1, 'rgba(244,223,174,0)');
      g.fillStyle = lg; g.fillRect(0, 22, W, 1);
      const X = a => { let d = a - th; d = Math.atan2(Math.sin(d), Math.cos(d)); return { x: W / 2 + d / (FOV / 2) * (W / 2), d }; };
      const fade = x => Math.max(0, 1 - Math.abs(x - W / 2) / (W / 2)) ** 0.7;
      g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      for (let i = 0; i < 24; i++) {
        const a = i / 24 * Math.PI * 2; const { x, d } = X(a);
        if (Math.abs(d) > FOV / 2) continue;
        const al = fade(x);
        if (i % 6 === 0) {
          g.fillStyle = `rgba(244,223,174,${al})`; g.font = '400 14px "Palatino Linotype", Palatino, "FreeSerif", Georgia, serif';
          g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 4;
          g.fillText('NESW'[i / 6], x, 17); g.shadowBlur = 0;
          g.fillRect(x - 0.5, 20, 1, 6);
        } else {
          g.fillStyle = `rgba(244,223,174,${al * (i % 3 === 0 ? 0.7 : 0.4)})`;
          g.fillRect(x - 0.5, i % 3 === 0 ? 18 : 20, 1, i % 3 === 0 ? 7 : 4);
        }
      }
      if (ct < 0 || performance.now() - ct > 1000) { cache = md.markers().filter(m => m.quest || (m.kind === 'spire' && !m.active) || (m.kind === 'sanctum' && !m.solved)); ct = performance.now(); }
      for (const m of cache) {
        const dist = Math.hypot(m.x - p.x, m.z - p.z);
        if (!m.quest && dist > 600) continue;
        const { x, d } = X(Math.atan2(m.x - p.x, -(m.z - p.z)));
        if (Math.abs(d) > FOV / 2) continue;
        g.globalAlpha = fade(x);
        glyph(g, m.kind, x, 29, 4.2, m);
        g.globalAlpha = 1;
      }
      // centre notch
      g.fillStyle = 'rgba(244,223,174,.95)';
      g.beginPath(); g.moveTo(W / 2, 27); g.lineTo(W / 2 - 3.5, 33); g.lineTo(W / 2 + 3.5, 33); g.closePath(); g.fill();
    },
  };
}

// ==================================================================== full world map screen
export function createWorldMap(ctx, md, screen) {
  const stage = document.createElement('div'); stage.className = 'wb-map-stage';
  const cv = document.createElement('canvas');
  stage.appendChild(cv); screen.appendChild(stage);
  const frame = document.createElement('div'); frame.className = 'wb-map-frame'; screen.appendChild(frame);
  const title = document.createElement('div'); title.className = 'wb-map-title wb-shadow-text';
  title.innerHTML = '<h1><small>Wayfarer’s Chart</small>The Windborne Isle</h1><div class="rg"></div>';
  screen.appendChild(title);
  const quest = document.createElement('div'); quest.className = 'wb-map-quest wb-quest'; screen.appendChild(quest);
  const legend = document.createElement('div'); legend.className = 'wb-map-legend'; screen.appendChild(legend);
  const coord = document.createElement('div'); coord.className = 'wb-map-coord'; screen.appendChild(coord);
  const foot = document.createElement('div'); foot.className = 'wb-foot';
  foot.innerHTML = '<span><i class="wb-key">Drag</i>Pan</span><span><i class="wb-key">Wheel</i>Zoom</span><span><i class="wb-key">Click</i>Place pin</span><span><i class="wb-key">C</i>Centre</span><span><i class="wb-key">M</i>Close</span>';
  screen.appendChild(foot);

  const g = cv.getContext('2d');
  const view = { x: 0, z: 0, s: 0.2 };         // centre (world m), scale (css px per m)
  let W = 0, H = 0, dpr = 1, open = false, t = 0;
  const pins = [];
  let fogCanvas = null, fogVersion = -1, paperPat = null;
  // paper texture for unexplored land + the margin
  const paper = (() => {
    const { c, g: p } = makeCanvas(512, 512, 1);
    p.fillStyle = '#d9c9a0'; p.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 2600; i++) {
      const x = Math.random() * 512, y = Math.random() * 512, r = Math.random() * 18 + 2;
      p.fillStyle = `rgba(${120 + Math.random() * 60 | 0},${95 + Math.random() * 40 | 0},${60 + Math.random() * 30 | 0},${Math.random() * 0.035})`;
      p.beginPath(); p.arc(x, y, r, 0, Math.PI * 2); p.fill();
    }
    p.strokeStyle = 'rgba(110,84,50,.06)'; p.lineWidth = 1;
    for (let i = -512; i < 512; i += 7) { p.beginPath(); p.moveTo(i, 0); p.lineTo(i + 512, 512); p.stroke(); }
    return c;
  })();

  function buildFog() {
    const R = 512;
    if (!fogCanvas) { fogCanvas = document.createElement('canvas'); fogCanvas.width = fogCanvas.height = R; }
    const f = fogCanvas.getContext('2d');
    f.globalCompositeOperation = 'source-over';
    f.clearRect(0, 0, R, R);
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) f.drawImage(paper, i * R / 3, j * R / 3, R / 3 + 0.5, R / 3 + 0.5);
    // uncharted land reads as a pencil sketch of the isle: shape and relief, no colour
    if (md.sketch) { f.globalAlpha = 0.72; f.drawImage(md.sketch, 0, 0, R, R); f.globalAlpha = 1; }
    f.globalCompositeOperation = 'destination-out';
    const k = R / (md.HALF * 2);
    for (const r of md.reveals()) {
      const x = (r.x + md.HALF) * k, y = (r.z + md.HALF) * k, rr = r.r * k;
      const gr = f.createRadialGradient(x, y, rr * 0.72, x, y, rr);
      gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      f.fillStyle = gr; f.beginPath(); f.arc(x, y, rr, 0, Math.PI * 2); f.fill();
    }
    // explored trail
    const ex = document.createElement('canvas'); ex.width = ex.height = FOG_RES;
    const eg = ex.getContext('2d'); const id = eg.createImageData(FOG_RES, FOG_RES);
    for (let i = 0; i < md.explored.length; i++) id.data[i * 4 + 3] = md.explored[i];
    eg.putImageData(id, 0, 0);
    f.filter = 'blur(6px)'; f.drawImage(ex, 0, 0, R, R); f.drawImage(ex, 0, 0, R, R); f.filter = 'none';
    f.globalCompositeOperation = 'source-over';
    fogVersion = md.revealVersion;
  }

  function resize() {
    dpr = Math.min(2, devicePixelRatio || 1);
    W = screen.clientWidth || innerWidth; H = screen.clientHeight || innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  }
  const w2s = (x, z) => [(x - view.x) * view.s + W / 2, (z - view.z) * view.s + H / 2];
  const s2w = (sx, sy) => [(sx - W / 2) / view.s + view.x, (sy - H / 2) / view.s + view.z];
  const SERIF = '"Palatino Linotype", Palatino, "Book Antiqua", "FreeSerif", Georgia, serif';

  function label(text, x, y, size, o = {}) {
    g.font = `${o.italic ? 'italic ' : ''}400 ${size}px ${SERIF}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (o.spacing) { try { g.letterSpacing = o.spacing + 'px'; } catch { /* old canvas */ } }
    g.lineWidth = 3.2; g.strokeStyle = o.halo || 'rgba(240,228,198,.75)'; g.lineJoin = 'round';
    g.strokeText(text, x, y);
    g.fillStyle = o.color || 'rgba(66,48,28,.92)'; g.fillText(text, x, y);
    try { g.letterSpacing = '0px'; } catch { /* ignore */ }
  }

  function draw() {
    if (!W) resize();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // the chart fills the screen: tiled paper beyond the surveyed square
    const [x0, y0] = w2s(-md.HALF, -md.HALF), size = md.HALF * 2 * view.s;
    if (!paperPat) paperPat = g.createPattern(paper, 'repeat');
    g.save(); g.translate(x0, y0); g.scale(size / 1536, size / 1536);
    g.fillStyle = paperPat; g.fillRect(-x0 * 1536 / size, -y0 * 1536 / size, W * 1536 / size, H * 1536 / size);
    g.restore();
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    if (md.parch) g.drawImage(md.parch, x0, y0, size, size);
    if (fogVersion !== md.revealVersion) buildFog();
    if (fogCanvas) g.drawImage(fogCanvas, x0, y0, size, size);
    // graticule
    g.strokeStyle = 'rgba(90,66,40,.16)'; g.lineWidth = 1;
    for (let k = -2048; k <= 2048; k += 512) {
      const [ax, ay] = w2s(k, -md.HALF), [bx, by] = w2s(k, md.HALF); g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
      const [cx, cy] = w2s(-md.HALF, k), [dx, dy] = w2s(md.HALF, k); g.beginPath(); g.moveTo(cx, cy); g.lineTo(dx, dy); g.stroke();
    }
    // labels: regions + rivers (only where revealed)
    const world = ctx.world;
    const zoomK = Math.min(1.6, Math.max(0.8, view.s / 0.22));
    for (const l of [...(world.LANDMARKS || []), ...REGIONS]) {
      if (!md.isRevealed(l.x, l.z)) continue;
      const [sx, sy] = w2s(l.x, l.z + (l.kind === 'peak' ? 70 : 0));
      label(l.name.toUpperCase(), sx, sy - 22, 13 * zoomK, { spacing: 4 * zoomK });
    }
    for (const r of world.RIVERS || []) {
      const pts = r.points || []; if (pts.length < 8) continue;
      const i = Math.floor(pts.length * 0.42), a = pts[i], b = pts[Math.min(pts.length - 1, i + 4)];
      if (!md.isRevealed(a.x, a.z)) continue;
      const [sx, sy] = w2s(a.x, a.z), [ex, ey] = w2s(b.x, b.z);
      let ang = Math.atan2(ey - sy, ex - sx); if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
      g.save(); g.translate(sx, sy); g.rotate(ang);
      label(r.name, 0, -10, 12 * zoomK, { italic: true, color: 'rgba(40,78,96,.95)', spacing: 1.5 });
      g.restore();
    }
    // markers
    const ms = md.markers();
    for (const m of ms) {
      if (!m.always && !md.isRevealed(m.x, m.z)) continue;
      const [sx, sy] = w2s(m.x, m.z);
      if (sx < -20 || sy < -20 || sx > W + 20 || sy > H + 20) continue;
      const r = (m.kind === 'quest' ? 8.5 : m.kind === 'spire' || m.kind === 'beacon' ? 10 : m.kind === 'fire' ? 6 : 8) * Math.min(1.3, Math.max(0.85, zoomK));
      if (m.kind === 'quest') {
        const pr = (t * 0.8) % 1;
        g.strokeStyle = `rgba(255,220,140,${1 - pr})`; g.lineWidth = 1.5;
        g.beginPath(); g.arc(sx, sy, r * (1.2 + pr * 1.6), 0, Math.PI * 2); g.stroke();
      }
      glyph(g, m.kind, sx, sy, r, { ...m, ink: 'rgba(40,28,16,.95)' });
      if (view.s > 0.3 && m.label && m.kind !== 'fire') label(m.label, sx, sy + r + 11, 11.5, { italic: true });
    }
    for (const pnn of pins) { const [sx, sy] = w2s(pnn.x, pnn.z); glyph(g, 'pin', sx, sy - 9, 8, { fill: '#6fc6dc', ink: 'rgba(30,40,50,.95)' }); }
    // player with a soft halo
    const pl = ctx.systems.player, p = pl?.position || ctx.focus;
    const [px, py] = w2s(p.x, p.z);
    const hg = g.createRadialGradient(px, py, 0, px, py, 30);
    hg.addColorStop(0, 'rgba(255,248,220,.55)'); hg.addColorStop(1, 'rgba(255,248,220,0)');
    g.fillStyle = hg; g.beginPath(); g.arc(px, py, 30, 0, Math.PI * 2); g.fill();
    const yaw = pl?.yaw ?? 0;
    glyph(g, 'player', px, py, 9, { rot: Math.atan2(Math.sin(yaw), -Math.cos(yaw)) });
    // compass rose on the open sea (south-east corner of the chart)
    { const [rx, ry] = w2s(md.HALF * 0.78, md.HALF * 0.78); rose(Math.min(W - 110, rx), Math.min(H - 130, ry), 46); }
    // aged edge: darken the margins like a well-handled sheet
    const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.72);
    vg.addColorStop(0, 'rgba(60,40,20,0)'); vg.addColorStop(1, 'rgba(60,40,20,.38)');
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
  }
  function rose(x, y, r) {
    g.save(); g.translate(x, y);
    g.strokeStyle = 'rgba(70,50,28,.7)'; g.fillStyle = 'rgba(70,50,28,.8)'; g.lineWidth = 1;
    g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(0, 0, r * 0.82, 0, Math.PI * 2); g.stroke();
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2, L = i % 2 ? r * 0.55 : r * 0.95;
      g.beginPath(); g.moveTo(Math.cos(a - 0.2) * r * 0.16, Math.sin(a - 0.2) * r * 0.16); g.lineTo(Math.cos(a) * L, Math.sin(a) * L); g.lineTo(Math.cos(a + 0.2) * r * 0.16, Math.sin(a + 0.2) * r * 0.16);
      g.closePath(); g.fillStyle = i % 2 ? 'rgba(70,50,28,.45)' : (i === 6 ? 'rgba(150,60,40,.9)' : 'rgba(70,50,28,.8)'); g.fill();
    }
    label('N', 0, -r - 12, 15);
    g.restore();
  }

  // ------------------------------------------------ interaction
  let drag = null, moved = false;
  stage.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, vx: view.x, vz: view.z }; moved = false; stage.classList.add('drag'); });
  addEventListener('pointermove', e => {
    if (!open) return;
    const [wx, wz] = s2w(e.clientX, e.clientY);
    coord.innerHTML = `<b>${esc(md.regionName(wx, wz))}</b><br>${Math.round(wx)} E · ${Math.round(-wz)} N · ${Math.round(ctx.world.getHeight(wx, wz))} m`;
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
    view.x = drag.vx - dx / view.s; view.z = drag.vz - dy / view.s; clampView();
  });
  addEventListener('pointerup', e => {
    if (!drag) return;
    stage.classList.remove('drag');
    if (!moved && open && e.target === cv) {
      const [wx, wz] = s2w(e.clientX, e.clientY);
      const i = pins.findIndex(p => Math.hypot(p.x - wx, p.z - wz) < 14 / view.s);
      if (i >= 0) pins.splice(i, 1); else if (pins.length < 12) pins.push({ x: wx, z: wz });
    }
    drag = null;
  });
  stage.addEventListener('wheel', e => {
    e.preventDefault();
    const [wx, wz] = s2w(e.clientX, e.clientY);
    view.s = Math.min(1.6, Math.max(0.12, view.s * (e.deltaY > 0 ? 0.88 : 1.14)));
    const [nx, nz] = s2w(e.clientX, e.clientY);
    view.x += wx - nx; view.z += wz - nz; clampView();
  }, { passive: false });
  function clampView() { view.x = Math.max(-md.HALF, Math.min(md.HALF, view.x)); view.z = Math.max(-md.HALF, Math.min(md.HALF, view.z)); }

  function refreshPanels() {
    const p = ctx.systems.player?.position || ctx.focus;
    title.querySelector('.rg').textContent = md.regionName(p.x, p.z);
    const gp = ctx.systems.gameplay;
    let q = null; try { q = gp?.quests?.current?.(); } catch { q = null; }
    quest.innerHTML = q?.quest ? `<div class="qt">${esc(q.quest.title)}</div><div class="qs">${esc(q.step?.text || 'Complete')}</div>` : '';
    const ms = md.markers();
    const cnt = k => ms.filter(m => m.kind === k);
    const rows = [
      ['spire', 'Windstone Spires', `${cnt('spire').filter(m => m.active).length} / ${cnt('spire').length}`, { active: true }],
      ['sanctum', 'Sanctums', `${cnt('sanctum').filter(m => m.solved).length} / ${cnt('sanctum').length}`, {}],
      ['camp', 'Gnarl Camps', `${cnt('camp').filter(m => m.cleared).length} / ${cnt('camp').length}`, {}],
      ['fire', 'Campfires', `${cnt('fire').length}`, {}],
      ['quest', 'Objective', '', {}],
    ];
    legend.innerHTML = '<div class="cap">Legend</div>';
    for (const [k, n, v, o] of rows) {
      const row = document.createElement('div'); row.className = 'row';
      const { c, g: gg } = makeCanvas(20, 20, 2); glyph(gg, k, 10, 10.5, 6.5, { ...o, ink: 'rgba(20,14,8,.95)' });
      row.appendChild(c); row.insertAdjacentHTML('beforeend', `${esc(n)}<span>${esc(v)}</span>`);
      legend.appendChild(row);
    }
  }

  return {
    open() {
      open = true; resize();
      const p = ctx.systems.player?.position || ctx.focus;
      view.x = p.x * 0.3; view.z = p.z * 0.3;   // lean toward the hero, keep the island framed
      view.s = Math.min(W, H) / (md.HALF * 1.56);
      clampView(); refreshPanels(); draw();
    },
    close() { open = false; },
    center() { const p = ctx.systems.player?.position || ctx.focus; view.x = p.x; view.z = p.z; },
    update(dt) { if (!open) return; t += dt; draw(); },
    resize,
    view,
  };
}
