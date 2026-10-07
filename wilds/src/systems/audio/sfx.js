// One-shot sound effects, all synthesised. Each method takes an audio time t
// and an optional world position (spatialised through a PannerNode; omitted =
// "at the listener", used for the player's own body sounds).
import { pluck, bell, piano } from './instruments.js';
import { mtof, clamp } from './core.js';

export class Sfx {
  constructor(A) { this.A = A; }
  r(a, b) { return this.A.rng.range(a, b); }

  // ---------------------------------------------------------------- locomotion
  footstep(t, surface = 'grass', speed = 3, pos = null) {
    const A = this.A, d = A.at(pos, A.sfx, { ref: 3 });
    const v = clamp(0.35 + speed / 9, 0.3, 1.1) * this.r(0.8, 1.1);
    const p = this.r(0.9, 1.12);
    switch (surface) {
      case 'rock': case 'ruin': case 'stone':
        A.burst(t, 0.035, d, { hp: 1800 * p, gain: 0.22 * v });
        A.burst(t, 0.06, d, { bp: 1300 * p, q: 3, gain: 0.18 * v });
        A.tone(t, 110 * p, 0.06, d, { to: 70, gain: 0.25 * v });
        if (A.rng() < 0.3) A.burst(t + 0.05, 0.03, d, { bp: 4000, q: 2, gain: 0.05 * v });   // grit
        break;
      case 'sand': case 'dirt':
        for (let i = 0; i < 4; i++) A.burst(t + i * 0.018, 0.05, d, { noise: 'pink', bp: (surface === 'sand' ? 2600 : 1400) * p, q: 0.9, gain: 0.14 * v * (1 - i * 0.18) });
        A.tone(t, 90 * p, 0.07, d, { to: 60, gain: 0.2 * v });
        break;
      case 'snow':
        for (let i = 0; i < 7; i++) A.burst(t + i * 0.016 + A.rng() * 0.006, 0.03, d, { bp: this.r(1100, 3200), q: 4, gain: 0.12 * v });
        A.burst(t, 0.12, d, { noise: 'pink', lp: 900, gain: 0.12 * v, attack: 0.02 });
        break;
      case 'water': case 'swim':
        A.burst(t, 0.22, d, { bp: 700 * p, bpTo: 2400, q: 1.2, gain: 0.25 * v, attack: 0.01 });
        A.burst(t + 0.04, 0.3, d, { noise: 'pink', hp: 2500, gain: 0.08 * v, attack: 0.03 });
        for (let i = 0; i < 3; i++) { const f = this.r(500, 1200); A.tone(t + 0.05 + i * 0.04, f, 0.04, d, { to: f * 1.6, gain: 0.04 * v }); }
        break;
      case 'climb':
        A.burst(t, 0.08, d, { noise: 'pink', bp: 1800, q: 1, gain: 0.12, attack: 0.01 });
        A.burst(t + 0.02, 0.03, d, { hp: 2500, gain: 0.06 });
        A.burst(t, 0.1, d, { noise: 'pink', bp: 400, q: 0.8, gain: 0.08, attack: 0.02 });   // cloth
        break;
      default:   // grass
        A.burst(t, 0.09, d, { noise: 'white', bp: 3500 * p, q: 0.7, gain: 0.12 * v, attack: 0.008 });
        A.burst(t + 0.015, 0.07, d, { noise: 'white', hp: 5000, gain: 0.05 * v, attack: 0.01 });
        A.tone(t, 85 * p, 0.07, d, { to: 55, gain: 0.18 * v });
    }
  }
  jump(t) {
    const A = this.A, d = A.sfx;
    A.burst(t, 0.18, d, { noise: 'pink', bp: 600, bpTo: 1800, q: 0.8, gain: 0.16, attack: 0.03 });
    A.burst(t, 0.04, d, { bp: 1500, q: 1, gain: 0.08 });
  }
  land(t, height = 1, surface = 'grass', hard = false) {
    const A = this.A, d = A.sfx, v = clamp(0.4 + height / 6, 0.4, 1.4);
    A.tone(t, 120, 0.18, d, { to: 45, glide: 0.12, gain: 0.35 * v });
    A.burst(t, 0.12, d, { noise: 'pink', lp: 1200, gain: 0.3 * v });
    this.footstep(t + 0.01, surface, 6 + height, null);
    if (hard) { A.burst(t, 0.3, d, { noise: 'brown', lp: 400, gain: 0.5 }); A.tone(t + 0.02, 70, 0.4, d, { to: 35, gain: 0.3 }); }
  }
  // glider: rapid cloth flutter then the canopy catching air
  gliderOpen(t) {
    const A = this.A, d = A.sfx;
    for (let i = 0; i < 6; i++) A.burst(t + i * 0.035 * (1 + i * 0.15), 0.05, d, { noise: 'pink', bp: 700 + i * 120, q: 1.2, gain: 0.22 * (1 - i * 0.1), attack: 0.004 });
    A.burst(t + 0.18, 0.45, d, { noise: 'pink', lp: 500, gain: 0.35, attack: 0.02 });   // "fwump"
    A.burst(t + 0.1, 0.7, d, { noise: 'white', bp: 900, bpTo: 2500, q: 0.6, gain: 0.12, attack: 0.25, shape: 'swell' });
  }
  gliderClose(t) {
    const A = this.A, d = A.sfx;
    for (let i = 0; i < 4; i++) A.burst(t + i * 0.045, 0.045, d, { noise: 'pink', bp: 1100 - i * 120, q: 1.2, gain: 0.15, attack: 0.004 });
    A.burst(t + 0.15, 0.06, d, { bp: 2500, q: 2, gain: 0.06 });   // clasp
    A.tone(t + 0.15, 900, 0.05, d, { gain: 0.04 });
  }
  grab(t) { const A = this.A; A.burst(t, 0.06, A.sfx, { noise: 'pink', bp: 1200, q: 1, gain: 0.18 }); A.tone(t, 160, 0.05, A.sfx, { to: 100, gain: 0.12 }); }
  mantle(t) { const A = this.A; A.burst(t, 0.3, A.sfx, { noise: 'pink', bp: 500, bpTo: 1400, q: 0.8, gain: 0.16, attack: 0.05 }); this.footstep(t + 0.32, 'rock', 3); }
  slip(t) { const A = this.A; A.burst(t, 0.35, A.sfx, { bp: 2200, bpTo: 800, q: 1.4, gain: 0.14, attack: 0.01 }); }
  splash(t, pos, big = 1) {
    const A = this.A, d = A.at(pos, A.sfx, { ref: 5 });
    A.burst(t, 0.5 * big, d, { noise: 'white', bp: 500, bpTo: 2800, q: 0.7, gain: 0.4 * big, attack: 0.005 });
    A.burst(t, 0.25, d, { noise: 'pink', lp: 500, gain: 0.35 * big });
    for (let i = 0; i < 6; i++) { const f = this.r(400, 1400); A.tone(t + 0.08 + i * this.r(0.02, 0.07), f, 0.05, d, { to: f * 1.7, gain: 0.05 }); }
  }

  // ---------------------------------------------------------------- combat
  swing(t, type = 'sword', step = 0, heavy = false) {
    const A = this.A, d = A.stereo(step % 2 ? 0.3 : -0.3, A.sfx);
    const big = heavy || type === 'club' || type === 'axe' || type === 'greatsword';
    const len = big ? 0.38 : type === 'spear' ? 0.2 : 0.26;
    const f0 = big ? 260 : 520, f1 = big ? 1300 : type === 'spear' ? 3200 : 2600;
    A.burst(t, len, d, { noise: 'pink', bp: f0, bpTo: f1, sweep: len * 0.55, q: 1.6, gain: big ? 0.45 : 0.32, attack: len * 0.45, shape: 'swell' });
    A.burst(t + len * 0.35, len * 0.6, d, { noise: 'white', bp: f1 * 1.5, q: 2, gain: 0.08, attack: len * 0.2 });
    // cloth / body
    A.burst(t, 0.12, d, { noise: 'pink', bp: 350, q: 0.8, gain: 0.1, attack: 0.02 });
  }
  hit(t, pos, o = {}) {
    // weapon into creature: meaty thump + crunchy transient + short metallic edge
    const A = this.A, d = A.at(pos, A.sfx, { ref: 5 });
    const v = clamp(0.6 + (o.damage || 4) / 15, 0.6, 1.2);
    A.tone(t, 180, 0.2, d, { to: 55, glide: 0.12, gain: 0.5 * v });
    A.burst(t, 0.1, d, { noise: 'pink', lp: 2500, gain: 0.5 * v, attack: 0.001 });
    A.burst(t, 0.05, d, { bp: 3200, q: 1.5, gain: 0.3 * v, attack: 0.0005 });
    if (o.metal !== false) [1870, 2930].forEach(f => A.tone(t, f * this.r(0.95, 1.05), 0.12, d, { gain: 0.04 * v, attack: 0.001 }));
    if (o.crit) { A.burst(t, 0.4, A.sfx, { noise: 'brown', lp: 300, gain: 0.5 }); A.tone(t, 60, 0.4, A.sfx, { to: 30, gain: 0.4 }); }
  }
  clang(t, pos, bright = 1, gain = 1) {
    const A = this.A, d = A.at(pos, A.sfx, { ref: 5 });
    const base = this.r(480, 560) * bright;
    [[1, 1], [2.37, 0.6], [3.91, 0.45], [5.6, 0.3], [7.13, 0.2]].forEach(([k, a], i) => A.tone(t, base * k, 0.6 / (1 + i * 0.4), d, { gain: 0.09 * a * gain, attack: 0.0008 }));
    A.burst(t, 0.04, d, { hp: 3000, gain: 0.4 * gain, attack: 0.0005 });
    A.tone(t, 140, 0.1, d, { to: 70, gain: 0.25 * gain });
  }
  block(t, pos, heavy) { this.clang(t, pos, 0.8, heavy ? 1.3 : 1); }
  parry(t, pos) {
    this.clang(t, pos, 1.4, 1.2);
    const A = this.A;
    A.burst(t, 0.9, A.sfx, { noise: 'white', bp: 6000, q: 3, gain: 0.08, attack: 0.002 });
    bell(A, t + 0.02, 1760, 0.4, A.sfx, { decay: 0.6 });
  }
  weaponBreak(t, pos) {
    // shatter: crack, cascading high shards, dull thunk of the hilt
    const A = this.A, d = A.at(pos, A.sfx, { ref: 5 });
    A.burst(t, 0.06, d, { hp: 2000, gain: 0.6, attack: 0.0005 });
    A.burst(t, 0.25, d, { noise: 'pink', bp: 1800, q: 0.7, gain: 0.35 });
    for (let i = 0; i < 16; i++) {
      const tt = t + 0.02 + Math.pow(A.rng(), 1.8) * 0.6, f = this.r(2200, 7500);
      A.tone(tt, f, this.r(0.05, 0.22), d, { gain: this.r(0.02, 0.06), attack: 0.0005 });
    }
    A.tone(t + 0.3, 220, 0.15, d, { to: 120, gain: 0.15 });
    A.tone(t, 300, 0.5, A.sfx, { to: 90, glide: 0.5, gain: 0.08, type: 'triangle' });   // falling "loss" tone
  }
  weaponLow(t) { const A = this.A; A.tone(t, 1320, 0.15, A.ui, { gain: 0.08 }); A.tone(t + 0.12, 990, 0.25, A.ui, { gain: 0.08 }); }
  bowDraw(t) { const A = this.A; A.burst(t, 0.6, A.sfx, { noise: 'pink', bp: 300, bpTo: 900, q: 3, gain: 0.08, attack: 0.5, shape: 'swell' }); }
  arrowShot(t, pos) {
    const A = this.A, d = A.at(pos, A.sfx, { ref: 5 });
    pluck(A, t, 98, 0.9, d, { decay: 0.25, pos: 0.4 });
    A.tone(t, 160, 0.12, d, { to: 120, gain: 0.25, type: 'triangle' });
    A.burst(t + 0.01, 0.25, d, { noise: 'white', bp: 2500, bpTo: 900, q: 2, gain: 0.12 });
  }
  arrowHit(t, pos) {
    const A = this.A, d = A.at(pos, A.sfx, { ref: 5 });
    A.burst(t, 0.04, d, { bp: 1500, q: 2, gain: 0.4, attack: 0.0005 });
    A.tone(t, 260, 0.1, d, { to: 140, gain: 0.3 });
    pluck(A, t + 0.01, 210, 0.3, d, { decay: 0.15 });   // shaft quiver
  }
  explosion(t, pos, radius = 4) {
    const A = this.A, d = A.at(pos, A.sfx, { ref: 12, rolloff: 0.8 });
    const v = clamp(radius / 5, 0.6, 1.5);
    A.burst(t, 0.08, d, { hp: 800, gain: 0.8 * v, attack: 0.0005 });
    A.burst(t, 1.6, d, { noise: 'brown', lp: 700, lpTo: 120, sweep: 1.2, gain: 1.2 * v, attack: 0.003 });
    A.tone(t, 90, 0.9, d, { to: 28, glide: 0.6, gain: 0.8 * v });
    A.burst(t + 0.1, 1.2, d, { noise: 'pink', bp: 2500, q: 0.6, gain: 0.15 * v, attack: 0.1 });   // debris hiss
    for (let i = 0; i < 6; i++) A.burst(t + this.r(0.3, 1.2), 0.04, d, { bp: this.r(800, 3000), q: 3, gain: 0.1 });
  }
  fuse(t, pos) { const A = this.A; A.burst(t, 1.6, A.at(pos, A.sfx, { ref: 3 }), { hp: 4000, gain: 0.1, attack: 0.05 }); }
  slam(t, pos, r = 3) {
    const A = this.A, d = A.at(pos, A.sfx, { ref: 8 });
    A.tone(t, 80, 0.5, d, { to: 30, glide: 0.3, gain: 0.7 });
    A.burst(t, 0.6, d, { noise: 'brown', lp: 500, gain: 0.8 });
    A.burst(t, 0.3, d, { noise: 'pink', bp: 1200, q: 0.6, gain: 0.25 });
  }
  zap(t, pos, element = 'fire') {
    const A = this.A, d = A.at(pos, A.sfx, { ref: 5 });
    if (element === 'ice') { for (let i = 0; i < 8; i++) A.tone(t + i * 0.03, this.r(3000, 6000), 0.15, d, { gain: 0.04 }); }
    else if (element === 'shock' || element === 'lightning') { A.burst(t, 0.4, d, { bp: 3000, q: 0.5, gain: 0.3 }); A.tone(t, 60, 0.4, d, { type: 'sawtooth', gain: 0.1 }); }
    else A.burst(t, 0.6, d, { noise: 'pink', lp: 1500, lpTo: 400, gain: 0.4, attack: 0.03 });
  }
  hurt(t, amount = 1) {
    // player takes damage: dull body thud + a muffled low "whoomph", no voice
    const A = this.A, v = clamp(0.6 + amount * 0.1, 0.6, 1.2);
    A.tone(t, 130, 0.25, A.sfx, { to: 50, glide: 0.15, gain: 0.5 * v });
    A.burst(t, 0.18, A.sfx, { noise: 'pink', lp: 900, gain: 0.45 * v });
    A.tone(t + 0.02, 330, 0.18, A.ui, { to: 240, gain: 0.05, type: 'triangle' });
  }
  heal(t) { const A = this.A; [72, 76, 79, 84].forEach((m, i) => bell(A, t + i * 0.06, mtof(m + 12), 0.25, A.ui, { decay: 0.8 })); }
  poof(t, pos) {
    const A = this.A, d = A.at(pos, A.sfx, { ref: 5 });
    A.burst(t, 0.6, d, { noise: 'pink', bp: 400, bpTo: 3000, q: 0.7, gain: 0.35, attack: 0.04 });
    A.tone(t + 0.05, 900, 0.4, d, { to: 1800, gain: 0.04 });
  }
  impact(t, pos, speed = 4, material = 'wood') {
    const A = this.A, d = A.at(pos, A.sfx, { ref: 4 });
    const v = clamp(speed / 10, 0.1, 1);
    if (v < 0.12) return;
    if (material === 'metal' || material === 'iron') this.clang(t, pos, 0.6, v);
    else if (material === 'stone' || material === 'rock') {
      A.burst(t, 0.08, d, { hp: 900, gain: 0.35 * v }); A.tone(t, 150, 0.15, d, { to: 70, gain: 0.4 * v });
    } else {
      A.tone(t, 200 * this.r(0.8, 1.2), 0.15, d, { to: 110, gain: 0.35 * v });
      A.burst(t, 0.07, d, { noise: 'pink', bp: 900, q: 1.5, gain: 0.3 * v });
      A.tone(t, 620 * this.r(0.9, 1.1), 0.08, d, { gain: 0.06 * v });   // wooden knock resonance
    }
  }
  woodBreak(t, pos) {
    const A = this.A, d = A.at(pos, A.sfx, { ref: 5 });
    A.burst(t, 0.05, d, { bp: 1800, q: 1, gain: 0.5 });
    for (let i = 0; i < 7; i++) A.burst(t + this.r(0, 0.25), 0.04, d, { bp: this.r(500, 2500), q: 2, gain: 0.2 });
    A.tone(t, 160, 0.2, d, { to: 80, gain: 0.3 });
  }
  whoomp(t, pos) {
    const A = this.A, d = A.at(pos, A.sfx, { ref: 4 });
    A.burst(t, 0.8, d, { noise: 'pink', lp: 300, lpTo: 1800, sweep: 0.3, gain: 0.5, attack: 0.08 });
    A.burst(t + 0.1, 0.6, d, { hp: 2500, gain: 0.06, attack: 0.1 });
  }
  sizzle(t, pos) { const A = this.A; A.burst(t, 1.2, A.at(pos, A.sfx, { ref: 3 }), { hp: 3500, gain: 0.12, attack: 0.05 }); }

  // ---------------------------------------------------------------- creatures (original, no voices)
  // Formant-filtered pulse source with a pitch contour and growl AM.
  grunt(t, pos, type = 'alert', size = 1) {
    const A = this.A, ac = A.ac, d = A.at(pos, A.sfx, { ref: 5 });
    const P = {
      alert: { f: [120, 190, 150], dur: 0.45, vow: [[600, 1050], [750, 1250]], g: 0.4 },
      hurt:  { f: [170, 115], dur: 0.22, vow: [[700, 1200], [500, 900]], g: 0.4 },
      death: { f: [150, 130, 70], dur: 1.1, vow: [[750, 1150], [400, 800]], g: 0.4 },
      windup:{ f: [100, 125], dur: 0.35, vow: [[450, 850], [620, 1000]], g: 0.32 },
      taunt: { f: [140, 160, 120, 150], dur: 0.7, vow: [[700, 1250], [550, 950]], g: 0.3 },
      idle:  { f: [95, 85], dur: 0.6, vow: [[400, 800], [450, 850]], g: 0.15 },
    }[type] || { f: [120, 110], dur: 0.3, vow: [[600, 1000], [600, 1000]], g: 0.3 };
    const k = 1 / size * this.r(0.88, 1.12), dur = P.dur * this.r(0.9, 1.15);
    const src = ac.createOscillator(); src.type = 'sawtooth';
    const sub = ac.createOscillator(); sub.type = 'square';
    P.f.forEach((f, i) => { const tt = t + dur * i / (P.f.length - 1 || 1); if (i === 0) { src.frequency.setValueAtTime(f * k, t); sub.frequency.setValueAtTime(f * k / 2, t); } else { src.frequency.linearRampToValueAtTime(f * k, tt); sub.frequency.linearRampToValueAtTime(f * k / 2, tt); } });
    const subG = A.gain(0.25);
    const growl = ac.createOscillator(); growl.frequency.value = this.r(28, 42);
    const gg = A.gain(0.35); const amp = A.gain(0.65);
    growl.connect(gg); gg.connect(amp.gain);
    const env = A.gain(0);
    env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(P.g * 1.7, t + 0.04);
    env.gain.setValueAtTime(P.g * 1.7, t + dur * 0.7); env.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(amp); sub.connect(subG); subG.connect(amp);
    const mix = A.gain(1);
    for (let i = 0; i < 2; i++) {
      const f = A.filter('bandpass', P.vow[0][i] * k * 0.9 + 100, i ? 9 : 6);
      f.frequency.linearRampToValueAtTime(P.vow[1][i] * k * 0.9 + 100, t + dur);
      const fg = A.gain(i ? 0.6 : 1); amp.connect(f); f.connect(fg); fg.connect(mix);
    }
    const lp = A.filter('lowpass', 2200, 0.7);
    mix.connect(lp); lp.connect(env); env.connect(d);
    // breath noise
    A.burst(t, dur, env, { noise: 'pink', bp: 900 * k, q: 1, gain: 0.25, attack: 0.03 });
    for (const o of [src, sub, growl]) { o.start(t); o.stop(t + dur + 0.05); }
  }

  // ---------------------------------------------------------------- items / ui
  pickup(t, kind = 'material') {
    const A = this.A, d = A.ui;
    const set = kind === 'weapon' ? [74, 81] : kind === 'key' ? [74, 78, 81, 86] : kind === 'food' ? [79, 83] : [81, 88];
    set.forEach((m, i) => bell(A, t + i * 0.075, mtof(m), 0.5, d, { decay: 0.7 }));
    A.burst(t, 0.12, d, { noise: 'white', hp: 7000, gain: 0.05, attack: 0.03 });   // sparkle
  }
  cook(t, success = true) {
    // a little bubbling pot, then a bright original 6-note jingle (or a deflated one for dubious food)
    const A = this.A, d = A.ui;
    for (let i = 0; i < 10; i++) { const f = this.r(300, 900); A.tone(t + i * 0.07, f, 0.05, A.sfx, { to: f * 1.8, gain: 0.05 }); }
    const t1 = t + 0.75;
    if (success) {
      const notes = [[67, 0], [71, 0.12], [74, 0.24], [79, 0.36], [78, 0.54], [83, 0.66]];
      notes.forEach(([m, o]) => { pluck(A, t1 + o, mtof(m), 0.6, d, { decay: 0.8 }); bell(A, t1 + o, mtof(m + 12), 0.25, d, { decay: 0.6 }); });
      piano(A, t1 + 0.66, mtof(55), 0.4, d, { decay: 1.2 }); piano(A, t1 + 0.7, mtof(62), 0.3, d);
    } else {
      [[67, 0], [66, 0.18], [65, 0.36], [61, 0.6]].forEach(([m, o]) => pluck(A, t1 + o, mtof(m - 12), 0.55, d, { decay: 0.6 }));
      A.burst(t1 + 0.6, 0.3, d, { noise: 'pink', lp: 600, gain: 0.15 });
    }
  }
  cookStart(t) { const A = this.A; for (let i = 0; i < 18; i++) { const f = this.r(250, 700); A.tone(t + i * this.r(0.05, 0.12), f, 0.06, A.sfx, { to: f * 1.9, gain: 0.04 }); } }
  eat(t) { const A = this.A; for (let i = 0; i < 3; i++) A.burst(t + i * 0.16, 0.07, A.sfx, { noise: 'pink', bp: 1500, q: 1, gain: 0.15 }); this.heal(t + 0.5); }
  chest(t, pos) {
    const A = this.A, d = A.at(pos, A.sfx, { ref: 4 });
    // wooden creak (slow resonant scrape) then a rising chime
    const o = A.ac.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(70, t); o.frequency.linearRampToValueAtTime(110, t + 0.6);
    const f = A.filter('bandpass', 800, 6); const e = A.gain(0);
    e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(0.12, t + 0.1); e.gain.linearRampToValueAtTime(0, t + 0.6);
    o.connect(f); f.connect(e); e.connect(d); o.start(t); o.stop(t + 0.7);
    this.impact(t + 0.65, pos, 6, 'wood');
    [74, 78, 81, 85, 86].forEach((m, i) => bell(A, t + 0.75 + i * 0.09, mtof(m), 0.45, A.ui, { decay: 1.2 }));
  }
  ui(t, type = 'click') {
    const A = this.A, d = A.ui;
    if (type === 'open') { A.tone(t, 660, 0.12, d, { gain: 0.08 }); A.tone(t + 0.06, 990, 0.18, d, { gain: 0.07 }); A.burst(t, 0.15, d, { noise: 'pink', bp: 1500, bpTo: 4000, q: 1, gain: 0.04, attack: 0.05 }); }
    else if (type === 'close') { A.tone(t, 880, 0.1, d, { gain: 0.07 }); A.tone(t + 0.05, 587, 0.16, d, { gain: 0.07 }); }
    else if (type === 'select') { A.tone(t, 1175, 0.08, d, { gain: 0.07 }); A.tone(t + 0.04, 1568, 0.1, d, { gain: 0.05 }); }
    else if (type === 'error') { A.tone(t, 220, 0.15, d, { type: 'triangle', gain: 0.1 }); A.tone(t + 0.1, 196, 0.2, d, { type: 'triangle', gain: 0.1 }); }
    else { A.tone(t, 1400, 0.035, d, { gain: 0.08, attack: 0.001 }); A.burst(t, 0.015, d, { hp: 4000, gain: 0.05 }); }
  }
  lockOn(t) { const A = this.A; A.tone(t, 1600, 0.06, A.ui, { gain: 0.06 }); A.tone(t + 0.05, 2100, 0.08, A.ui, { gain: 0.05 }); }
  rune(t, on = true) {
    const A = this.A;
    const f = on ? 220 : 330;
    A.tone(t, f, 0.5, A.sfx, { to: on ? 330 : 165, glide: 0.25, gain: 0.12, type: 'triangle' });
    A.tone(t, f * 1.5, 0.5, A.sfx, { to: on ? 495 : 248, glide: 0.25, gain: 0.05 });
    A.burst(t, 0.4, A.sfx, { bp: 2500, q: 4, gain: 0.05, attack: 0.1 });
  }
  plate(t, pos, down) { const A = this.A, d = A.at(pos, A.sfx, { ref: 4 }); A.tone(t, down ? 180 : 240, 0.2, d, { to: down ? 120 : 300, gain: 0.25 }); A.burst(t, 0.05, d, { bp: 1200, q: 2, gain: 0.2 }); }
  stoneGrind(t, pos, dur = 2.5) {
    const A = this.A, d = A.at(pos, A.sfx, { ref: 8 });
    A.burst(t, dur, d, { noise: 'brown', lp: 400, gain: 0.8, attack: 0.4, shape: 'swell' });
    A.burst(t, dur, d, { noise: 'pink', bp: 300, q: 2, gain: 0.25, attack: 0.3 });
    this.impact(t + dur, pos, 8, 'stone');
  }
  heartbeat(t) { const A = this.A; A.tone(t, 60, 0.12, A.sfx, { to: 40, gain: 0.3 }); A.tone(t + 0.22, 55, 0.14, A.sfx, { to: 38, gain: 0.22 }); }
}
