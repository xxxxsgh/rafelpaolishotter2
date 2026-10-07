// Offline renders of every audio layer, for review without speakers.
// Loaded in a headless browser by tools/audio-render.mjs. Uses the exact same
// core / instruments / music / ambience / sfx code as the game, driven by an
// OfflineAudioContext and scripted world states.
import { createCore } from './core.js';
import { Music } from './music.js';
import { Ambience } from './ambience.js';
import { Sfx } from './sfx.js';

const SR = 44100;

function baseEnv(o = {}) {
  return Object.assign({
    wind: 0.5, altitude: 1, y: 40, daylight: 1, night: 0, rain: 0, storm: 0, grass: 1, forest: 0.2, snow: 0,
    river: 0, ocean: 0, lake: 0, falls: null, fallsAmt: 0, fire: null, fireAmt: 0, glide: 0, indoor: 0,
    underwater: false, lx: 0, ly: 0, lz: 0, demo: true,
  }, o);
}
const quietEnv = o => baseEnv(Object.assign({ wind: 0, daylight: 0, night: 0, grass: 0, forest: 0 }, o));
// ambience scenario helper: drive amb.step over time with a state function
function driveAmb(A, dur, stateFn, mute = {}) {
  const amb = new Ambience(A);
  for (let t = 0; t < dur; t += 0.05) amb.step(stateFn(t), t, 0.12);
  return amb;
}
function driveMusic(A, dur, stateFn, setup) {
  const m = new Music(A);
  m.nextPhrase = 0.3;
  setup?.(m);
  for (let t = 0; t < dur; t += 0.05) m.step(stateFn(t), t, 0.12);
  return m;
}
const lerp = (a, b, t) => a + (b - a) * Math.min(1, Math.max(0, t));

// Each scenario: {dur, desc, marks:[[t,label]], build(A)}
export const SCENARIOS = {
  'music-theme': {
    dur: 18, desc: 'Leitmotif (flute over felt piano), plays at dawn and dusk and on first start',
    build: A => driveMusic(A, 18, () => ({ night: 0, dusk: 0, restScale: 99 }), m => { m.pendingTheme = true; }),
  },
  'music-explore-day': {
    dur: 34, desc: 'Exploration, day: sparse pentatonic piano / pluck phrases (rests shortened ~15x for review)',
    build: A => driveMusic(A, 34, () => ({ night: 0, dusk: 0, restScale: 0.07 })),
  },
  'music-explore-dusk': {
    dur: 26, desc: 'Exploration, dusk: dorian colour (rests shortened)',
    build: A => driveMusic(A, 26, () => ({ night: 0, dusk: 1, restScale: 0.07 })),
  },
  'music-explore-night': {
    dur: 30, desc: 'Exploration, night: minor pentatonic, celesta motifs, soft pads (rests shortened)',
    build: A => driveMusic(A, 30, () => ({ night: 1, dusk: 0, restScale: 0.07 })),
  },
  'music-combat': {
    dur: 24, desc: 'Combat: intensity 0.1 -> 0.5 -> 1.0, enemies cleared at 16 s, victory sting',
    marks: [[0, 'alert (low)'], [5, 'ostinato in'], [10, 'full'], [16, 'last enemy down']],
    build: A => driveMusic(A, 24, t => ({ night: 0, dusk: 0, restScale: 99, combat: t < 16, intensity: t < 5 ? 0 : t < 10 ? 0.3 : 1, victory: true })),
  },
  'music-sanctum': {
    dur: 26, desc: 'Sanctum interior: breathing pads, low drone, glass bells in a 7 s hall',
    build: A => { A.hallRet.gain.value = 0.8; driveMusic(A, 26, () => ({ night: 0, dusk: 0, sanctum: true, restScale: 0.5 })); },
  },
  'music-stingers': {
    dur: 18, desc: 'Stingers: sanctum solved, discovery, quest complete, victory, fall',
    marks: [[0.3, 'shrine'], [4, 'discovery'], [7.5, 'quest'], [10.5, 'victory'], [13, 'death']],
    build: A => { const m = new Music(A); m.sting('shrine', 0.3); m.sting('discovery', 4); m.sting('quest', 7.5); m.sting('victory', 10.5); m.sting('death', 13); },
  },
  'amb-wind': {
    dur: 18, desc: 'Wind: strength 0.1 -> 1.3 (0-8 s), then climbing to 180 m above ground on a peak (8-13 s), gliding (13-18 s)',
    marks: [[0, 'calm'], [8, 'gale, start climbing'], [13, 'gliding']],
    build: A => driveAmb(A, 18, t => quietEnv({ wind: lerp(0.1, 1.3, t / 8), altitude: lerp(1, 180, (t - 8) / 5), y: lerp(40, 260, (t - 8) / 5), glide: t > 13 ? lerp(0.3, 1, (t - 13) / 3) : 0 })),
  },
  'amb-meadow-day': {
    dur: 18, desc: 'Day meadow at forest edge: breeze, gusting grass rustle, birdsong',
    build: A => driveAmb(A, 18, () => baseEnv({ wind: 0.6, grass: 1, forest: 0.6 })),
  },
  'amb-night': {
    dur: 18, desc: 'Night by a lake: crickets, insect chorus, frogs, an owl, light wind',
    build: A => driveAmb(A, 18, () => baseEnv({ wind: 0.3, daylight: 0, night: 1, grass: 1, forest: 0.6, lake: 0.6 })),
  },
  'amb-rain-storm': {
    dur: 20, desc: 'Rain rising to a storm; thunder at 2000 m (t=3, ~5.8 s delay), 300 m (t=9, ~0.9 s), 900 m (t=13)',
    marks: [[0, 'rain starts'], [6, 'storm'], [8.8, 'far strike lands'], [9.9, 'near strike'], [15.6, 'mid strike']],
    build: A => {
      const amb = driveAmb(A, 20, t => quietEnv({ wind: 0.8, rain: lerp(0.1, 1, t / 6), storm: t > 6 ? 1 : 0 }));
      amb.thunder(3 + 2000 / 343, 2000, { x: -800, z: -1800 }, { x: 0, y: 0, z: 0 });
      amb.thunder(9 + 300 / 343, 300, { x: 250, z: -100 }, { x: 0, y: 0, z: 0 });
      amb.thunder(13 + 900 / 343, 900, { x: -300, z: 800 }, { x: 0, y: 0, z: 0 });
    },
  },
  'amb-river': {
    dur: 10, desc: 'Standing on a river bank: babbling + rushing current',
    build: A => driveAmb(A, 10, () => quietEnv({ wind: 0.3, river: 1 })),
  },
  'amb-ocean': {
    dur: 22, desc: 'Beach: breaking waves (build, crash, hissing recede) with sea breeze',
    build: A => driveAmb(A, 22, () => quietEnv({ wind: 0.5, ocean: 1 })),
  },
  'amb-waterfall': {
    dur: 10, desc: 'Waterfall 25 m ahead-left (positional), walking closer to 10 m',
    build: A => driveAmb(A, 10, t => quietEnv({ wind: 0.2, river: 0.6, falls: { x: -12, y: 2, z: lerp(-25, -8, t / 10) }, fallsAmt: 1 })),
  },
  'amb-campfire': {
    dur: 10, desc: 'Campfire 2 m to the right: low roar, crackle texture, scheduled pops (night insects muted)',
    build: A => driveAmb(A, 10, () => quietEnv({ fire: { x: 2, y: 0.4, z: -0.5 }, fireAmt: 1 })),
  },
  'sfx-footsteps': {
    dur: 19, desc: 'Footsteps by surface (5 steps each, running pace)',
    marks: [[0.4, 'grass'], [3, 'rock'], [5.6, 'sand'], [8.2, 'dirt'], [10.8, 'snow'], [13.4, 'water'], [16, 'climb']],
    build: A => {
      const s = new Sfx(A);
      ['grass', 'rock', 'sand', 'dirt', 'snow', 'water', 'climb'].forEach((surf, i) => {
        for (let k = 0; k < 5; k++) s.footstep(0.4 + i * 2.6 + k * 0.36, surf, 5.4);
      });
    },
  },
  'sfx-traversal': {
    dur: 12, desc: 'Jump, land, high jump + hard landing, glider open / close, climb grab, mantle, slip, splash',
    marks: [[0.5, 'jump'], [1.0, 'land'], [2, 'jump'], [2.7, 'hard land'], [4, 'glider open'], [6.5, 'glider close'], [7.5, 'grab'], [8.2, 'mantle'], [9.6, 'slip'], [10.6, 'splash']],
    build: A => {
      const s = new Sfx(A);
      s.jump(0.5); s.land(1.0, 1, 'grass'); s.jump(2); s.land(2.7, 9, 'rock', true);
      s.gliderOpen(4); s.gliderClose(6.5); s.grab(7.5); s.mantle(8.2); s.slip(9.6); s.splash(10.6, null, 1);
    },
  },
  'sfx-combat': {
    dur: 12, desc: 'Sword swing + hit, swing + shield block, perfect parry, club swing + crit, bow shot + arrow hit, weapon shatters, bomb, ground slam, player hurt',
    marks: [[0.5, 'swing/hit'], [1.4, 'block'], [2.5, 'parry'], [3.3, 'club crit'], [4.5, 'bow'], [5.8, 'break'], [7.2, 'bomb'], [9, 'slam'], [10.2, 'hurt']],
    build: A => {
      const s = new Sfx(A), P = (x, z) => ({ x, y: 0, z });
      s.swing(0.5, 'sword', 0); s.hit(0.66, P(1, -2.5), { damage: 5 });
      s.swing(1.4, 'sword', 1); s.block(1.65, P(-1, -2), false);
      s.parry(2.5, P(0, -2));
      s.swing(3.3, 'club', 0, true); s.hit(3.55, P(0.5, -2.5), { damage: 12, crit: true });
      s.bowDraw(4.0); s.arrowShot(4.6, null); s.arrowHit(5.0, P(6, -18));
      s.weaponBreak(5.8, P(0, -1));
      s.explosion(7.2, P(-8, -14), 5);
      s.slam(9, P(4, -6));
      s.hurt(10.2, 2);
    },
  },
  'sfx-creatures': {
    dur: 10, desc: 'Original creature vocal synthesis: alert, hurt, windup, taunt, death; large brute alert + death; defeat poof',
    marks: [[0.3, 'alert'], [1.3, 'hurt'], [2.0, 'windup'], [2.8, 'taunt'], [4, 'death'], [5.8, 'brute alert'], [7, 'brute death'], [8.4, 'poof']],
    build: A => {
      const s = new Sfx(A), P = (x, z) => ({ x, y: 1, z });
      s.grunt(0.3, P(-3, -6), 'alert'); s.grunt(1.3, P(-2, -4), 'hurt'); s.grunt(2.0, P(2, -5), 'windup');
      s.grunt(2.8, P(3, -8), 'taunt'); s.grunt(4, P(0, -5), 'death');
      s.grunt(5.8, P(-4, -9), 'alert', 1.5); s.grunt(7, P(-2, -6), 'death', 1.5); s.poof(8.4, P(-2, -6));
    },
  },
  'sfx-items-ui': {
    dur: 15, desc: 'UI click/select/open/close/error, pickups (material, weapon, key item), cooking success + dubious, chest, heal, rune, lock-on, weapon-low',
    marks: [[0.3, 'ui'], [2.7, 'pickups'], [4.6, 'cook ok'], [7.2, 'cook dubious'], [9.4, 'chest'], [11, 'heal'], [12, 'rune'], [12.8, 'lock/low']],
    build: A => {
      const s = new Sfx(A);
      s.ui(0.3, 'click'); s.ui(0.6, 'select'); s.ui(1.0, 'open'); s.ui(1.6, 'close'); s.ui(2.1, 'error');
      s.pickup(2.7, 'material'); s.pickup(3.3, 'weapon'); s.pickup(3.9, 'key');
      s.cook(4.6, true); s.cook(7.2, false); s.chest(9.4, { x: 1, y: 0, z: -2 }); s.heal(11); s.rune(12, true);
      s.lockOn(12.8); s.weaponLow(13.2);
    },
  },
  'mix-gameplay': {
    dur: 24, desc: 'Full mix: meadow ambience + exploration phrase, footsteps, enemy alert at 8 s (combat music), swings/hits, victory',
    marks: [[0, 'exploring'], [8, 'enemy alert'], [16, 'enemy down']],
    build: A => {
      const amb = new Ambience(A), m = new Music(A), s = new Sfx(A);
      m.nextPhrase = 0.5;
      let combat = false;
      for (let t = 0; t < 24; t += 0.05) {
        combat = t > 8 && t < 16;
        amb.step(baseEnv({ wind: 0.6, forest: 0.4 }), t, 0.12);
        m.step({ night: 0, dusk: 0, restScale: 0.2, combat, intensity: t > 11 ? 0.8 : 0.2, victory: true }, t, 0.12);
      }
      for (let t = 0.6; t < 7.6; t += 0.36) s.footstep(t, 'grass', 5);
      s.grunt(8, { x: -4, y: 1, z: -10 }, 'alert');
      for (let k = 0; k < 6; k++) { const t = 10 + k * 0.9; s.swing(t, 'sword', k); if (k % 2 === 0) { s.hit(t + 0.15, { x: 0, y: 1, z: -2 }, { damage: 5 }); s.grunt(t + 0.2, { x: 0, y: 1, z: -2.5 }, 'hurt'); } else s.block(t + 0.2, { x: 0, y: 1, z: -2 }); }
      s.grunt(15.6, { x: 0, y: 1, z: -2.5 }, 'death'); s.poof(16.5, { x: 0, y: 1, z: -2.5 });
    },
  },
};

export async function renderScenario(name) {
  const sc = SCENARIOS[name];
  if (!sc) throw new Error('unknown scenario ' + name);
  const ac = new OfflineAudioContext(2, Math.ceil(sc.dur * SR), SR);
  const A = createCore(ac, { seed: hash(name) });
  A.out.gain.value = 1;
  sc.build(A);
  const buf = await ac.startRendering();
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  // stats
  let pk = 0, ss = 0;
  for (let i = 0; i < L.length; i++) { const a = Math.max(Math.abs(L[i]), Math.abs(R[i])); if (a > pk) pk = a; ss += (L[i] * L[i] + R[i] * R[i]) * 0.5; }
  const rms = Math.sqrt(ss / L.length);
  // 16-bit PCM interleaved, base64
  const pcm = new Int16Array(L.length * 2);
  for (let i = 0; i < L.length; i++) { pcm[i * 2] = Math.max(-1, Math.min(1, L[i])) * 32767; pcm[i * 2 + 1] = Math.max(-1, Math.min(1, R[i])) * 32767; }
  const png = spectrogram(L, R, SR, name, sc);
  return { name, desc: sc.desc, dur: sc.dur, sr: SR, peakDb: db(pk), rmsDb: db(rms), pcm: b64(new Uint8Array(pcm.buffer)), png };
}

function hash(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) || 1; }
const db = v => +(20 * Math.log10(Math.max(1e-9, v))).toFixed(1);
function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }

// ------------------------------------------------------------------ spectrogram
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
const CMAP = [[0, [10, 14, 26]], [0.25, [28, 44, 86]], [0.45, [30, 110, 128]], [0.65, [120, 180, 110]], [0.82, [236, 196, 92]], [1, [255, 248, 228]]];
function cmap(v) {
  v = Math.max(0, Math.min(1, v));
  for (let i = 1; i < CMAP.length; i++) if (v <= CMAP[i][0]) {
    const [a, ca] = CMAP[i - 1], [b, cb] = CMAP[i], t = (v - a) / (b - a);
    return [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t];
  }
  return CMAP[CMAP.length - 1][1];
}
function spectrogram(L, R, sr, name, sc) {
  const W = 1400, SH = 340, WH = 70, top = 46, left = 56, right = 14, bottom = 30;
  const cw = left + W + right, chh = top + WH + 8 + SH + bottom;
  const cv = document.createElement('canvas'); cv.width = cw; cv.height = chh;
  const g = cv.getContext('2d');
  g.fillStyle = '#0d1418'; g.fillRect(0, 0, cw, chh);
  g.fillStyle = '#f2ead8'; g.font = '600 16px system-ui, sans-serif'; g.fillText(name, left, 20);
  g.fillStyle = '#a9b8b8'; g.font = '12px system-ui, sans-serif'; g.fillText(sc.desc, left, 37);
  const n = L.length, N = 2048;
  // waveform (L+R envelope)
  const wy = top, mid = wy + WH / 2;
  g.fillStyle = '#152026'; g.fillRect(left, wy, W, WH);
  g.fillStyle = '#7fc4c0';
  for (let x = 0; x < W; x++) {
    const a = Math.floor(x / W * n), b = Math.floor((x + 1) / W * n);
    let mn = 0, mx = 0; for (let i = a; i < b; i++) { const v = (L[i] + R[i]) * 0.5; if (v < mn) mn = v; if (v > mx) mx = v; }
    g.fillRect(left + x, mid - mx * WH / 2, 1, Math.max(1, (mx - mn) * WH / 2));
  }
  // STFT columns
  const sy = top + WH + 8;
  const img = g.createImageData(W, SH);
  const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  const re = new Float32Array(N), im = new Float32Array(N);
  const fMin = 40, fMax = 18000, lmin = Math.log(fMin), lmax = Math.log(fMax);
  const rowBin = new Float32Array(SH);
  for (let y = 0; y < SH; y++) rowBin[y] = Math.exp(lmax - (y / (SH - 1)) * (lmax - lmin)) / sr * N;
  const mag = new Float32Array(N / 2);
  for (let x = 0; x < W; x++) {
    const c = Math.floor((x + 0.5) / W * n) - N / 2;
    for (let i = 0; i < N; i++) { const k = c + i; re[i] = k >= 0 && k < n ? (L[k] + R[k]) * 0.5 * win[i] : 0; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < N / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
    for (let y = 0; y < SH; y++) {
      const b = rowBin[y], b0 = Math.floor(b), b1 = Math.min(N / 2 - 1, Math.ceil(b * 1.03 + 1));
      let m = 0; for (let k = b0; k <= b1; k++) if (mag[k] > m) m = mag[k];
      const d = 20 * Math.log10(m / (N / 4) + 1e-9);   // dBFS-ish
      const [r, gg, bb] = cmap((d + 96) / 90);
      const o = (y * W + x) * 4; img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = bb; img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, left, sy);
  // axes
  g.font = '11px system-ui, sans-serif'; g.fillStyle = '#a9b8b8'; g.strokeStyle = 'rgba(242,234,216,.18)';
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
    const y = sy + (lmax - Math.log(f)) / (lmax - lmin) * (SH - 1);
    g.beginPath(); g.moveTo(left, y + 0.5); g.lineTo(left + W, y + 0.5); g.stroke();
    g.fillText(f >= 1000 ? f / 1000 + 'k' : String(f), 8, y + 4);
  }
  for (let s = 0; s <= sc.dur; s += sc.dur > 20 ? 2 : 1) {
    const x = left + s / sc.dur * W;
    g.fillRect(x, sy + SH, 1, 5); g.fillText(s + 's', x - 6, sy + SH + 18);
  }
  g.fillText('Hz', 8, sy - 2);
  if (sc.marks) {
    g.font = '600 11px system-ui, sans-serif';
    const used = [];
    for (const [t, label] of sc.marks) {
      const x = left + t / sc.dur * W;
      g.fillStyle = 'rgba(255,214,120,.55)'; g.fillRect(x, top, 1, WH + 8 + SH);
      let row = 0; while (used.some(u => u.row === row && Math.abs(u.x - x) < 90)) row++;
      used.push({ x, row });
      g.fillStyle = '#ffd678'; g.fillText(label, x + 3, top + 12 + row * 13);
    }
  }
  return cv.toDataURL('image/png');
}

export async function contactSheet(items) {
  // items: [{name, png}] -> one tall overview image of down-scaled spectrograms
  const imgs = await Promise.all(items.map(it => new Promise(res => { const im = new Image(); im.onload = () => res(im); im.src = it.png; })));
  const cols = 2, w = 735, h = Math.round(imgs[0].height * w / imgs[0].width);
  const cv = document.createElement('canvas'); cv.width = cols * w + 10; cv.height = Math.ceil(imgs.length / cols) * (h + 6) + 6;
  const g = cv.getContext('2d'); g.fillStyle = '#081014'; g.fillRect(0, 0, cv.width, cv.height);
  imgs.forEach((im, i) => g.drawImage(im, (i % cols) * (w + 4) + 3, Math.floor(i / cols) * (h + 6) + 3, w, h));
  return cv.toDataURL('image/png');
}
