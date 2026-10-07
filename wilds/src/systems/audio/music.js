// Adaptive, procedural score.
//  * explore  — sparse felt-piano / plucked-string phrases separated by long
//               silences (pentatonic by day, dorian at dusk, minor + celesta
//               at night), motifs remembered and varied so phrases feel related,
//               and an original leitmotif that returns at dawn and dusk.
//  * combat   — 126 bpm taiko / rim / shaker grid, bass and a minor ostinato
//               that layers in with intensity; resolves with a short sting.
//  * sanctum  — slow breathing pads, a low drone and glassy bell arpeggios
//               in a long hall reverb.
// All scheduling happens in step(state, t, horizon) against audio time, so the
// same code drives the live game and offline renders.
import { piano, pluck, bell, flute, pad, bass, stab, taiko, rim, shaker, frameDrum, swell } from './instruments.js';
import { mtof, clamp } from './core.js';

const SCALES = {
  day:   [0, 2, 4, 7, 9],              // major pentatonic
  dusk:  [0, 2, 3, 5, 7, 9, 10],       // dorian
  night: [0, 3, 5, 7, 10],             // minor pentatonic
};
// chords: bass offset from root (semitones) + voicing above the bass
const CHORDS = {
  day:   [{ b: 0, v: [7, 16] }, { b: -7, v: [7, 14] }, { b: -3, v: [7, 15] }, { b: -10, v: [7, 14] }, { b: -5, v: [7, 14] }],
  dusk:  [{ b: 0, v: [7, 15] }, { b: -2, v: [7, 14] }, { b: -7, v: [7, 16] }, { b: -10, v: [7, 15] }, { b: -5, v: [7, 14] }],
  night: [{ b: 0, v: [7, 15] }, { b: -4, v: [7, 16] }, { b: -7, v: [7, 15] }, { b: -2, v: [7, 14] }, { b: 3, v: [7, 16] }],
};
const ROOT = { day: 62, dusk: 62, night: 59 };
const RHYTHMS = [
  [1, 1, 2], [0.5, 0.5, 1, 2], [1, 0.5, 0.5, 1, 1, 2], [1.5, 0.5, 2], [0.5, 0.5, 0.5, 0.5, 1, 2.5],
  [2, 1, 1, 3], [1, 1, 1, 1, 3], [0.75, 0.25, 1, 2], [1, 0.5, 0.5, 3], [0.5, 1, 0.5, 2],
];
// leitmotif: [semitones from D5, beats]
const THEME = [[-5, 1], [0, 1], [2, 0.5], [4, 0.5], [7, 2], [4, 1], [2, 0.5], [0, 0.5], [2, 3],
               [-3, 1], [0, 1], [2, 1], [4, 1], [2, 1.5], [-5, 0.5], [0, 4]];
const THEME_CHORDS = [[0, 0], [4, -3], [8, -7], [12, -5], [16, 0]];   // [beat, bass offset]

// combat: D minor i - VI - VII - V
const C_ROOT = 50;
const C_CHORDS = [[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [-5, -1, 2]];
const OSTINATO = [0, 2, 1, 2, 0, 2, 1, 0, 2, 1, 0, 2, 1, 2, 0, 1];
const ACCENT = new Set([0, 3, 6, 8, 11, 14]);

export class Music {
  constructor(A) {
    this.A = A;
    const ac = A.ac;
    this.explore = A.gain(1); this.explore.connect(A.music);
    this.combatBus = A.gain(0); this.combatBus.connect(A.music);
    this.sanctumBus = A.gain(0); this.sanctumBus.connect(A.music);
    const sanctHall = A.gain(0.9); this.sanctumBus.connect(sanctHall); sanctHall.connect(A.hallIn);
    this.gExplore = A.param(this.explore.gain, 1.2);
    this.gCombat = A.param(this.combatBus.gain, 0.6);
    this.gSanct = A.param(this.sanctumBus.gain, 2.0);
    this.nextPhrase = ac.currentTime + 4;
    this.motif = null;
    this.combatOn = false; this.combatLevel = 0; this.cStep = 0; this.cNext = 0; this.combatEndT = -1;
    this.sanctOn = false; this.sNextChord = 0; this.sNextBell = 0; this.sChord = 0;
    this.pendingTheme = false;
    this.lastPhraseEnd = 0;
  }

  // ---------------------------------------------------------------- helpers
  mood(state) { return state.night > 0.5 ? 'night' : state.dusk > 0.5 ? 'dusk' : 'day'; }
  deg(mood, d) {
    const s = SCALES[mood], n = s.length;
    const o = Math.floor(d / n), i = ((d % n) + n) % n;
    return ROOT[mood] + 12 * o + s[i];
  }
  nearestDeg(mood, midi) {
    let best = 0, bd = 1e9;
    for (let d = -14; d < 28; d++) { const e = Math.abs(this.deg(mood, d) - midi); if (e < bd) { bd = e; best = d; } }
    return best;
  }
  hum() { return (this.A.rng() - 0.5) * 0.02; }

  // ---------------------------------------------------------------- explore
  phrase(state, t0) {
    const A = this.A, r = A.rng, mood = this.mood(state);
    const beat = mood === 'night' ? 0.82 : mood === 'dusk' ? 0.72 : 0.64;
    const out = this.explore;
    const chords = CHORDS[mood];
    const root = ROOT[mood];
    const ch = this.lastChord !== chords[0] && r() < 0.4 ? chords[0] : r.pick(chords.filter(c => c !== this.lastChord));
    this.lastChord = ch;
    const ch2 = r.pick(chords);
    const lhInst = mood === 'night' ? 0.45 : 0.55;

    const leftHand = (t, c, v = lhInst, roll = 0.06) => {
      piano(A, t, mtof(root + c.b - 12), v * 0.9, out, { decay: 1.4 });
      c.v.forEach((x, i) => piano(A, t + roll * (i + 1) + this.hum(), mtof(root + c.b + x - (c.b > 0 ? 12 : 0)), v * 0.55, out, { decay: 1.2 }));
    };

    if (this.pendingTheme) {
      this.pendingTheme = false;
      return this.theme(state, t0);
    }

    const kind = mood === 'night'
      ? r.pick(['melody', 'bells', 'bells', 'echo', 'arp'])
      : r.pick(['melody', 'melody', 'arp', 'echo', 'pluck']);
    let t = t0, len = 0;

    if (kind === 'arp') {
      leftHand(t, ch, lhInst * 0.8, 0);
      const tones = [];
      for (let oct = 0; oct < 2; oct++) for (const x of [0, ...ch.v]) tones.push(root + ch.b + x + 12 * oct + (ch.b < -4 ? 12 : 0));
      tones.sort((a, b) => a - b);
      const step = beat * (r() < 0.5 ? 0.5 : 0.333);
      tones.forEach((m, i) => pluck(A, t + beat + i * step + this.hum(), mtof(m), 0.5 + 0.25 * Math.sin(i / tones.length * Math.PI), out));
      const top = this.deg(mood, this.nearestDeg(mood, tones[tones.length - 1]) + r.pick([1, 2, -1]));
      const tEnd = t + beat + tones.length * step + beat;
      piano(A, tEnd, mtof(top), 0.55, out, { decay: 1.3 });
      len = tEnd - t0 + beat * 4;
      return len;
    }

    // melodic material (remembered motif, varied)
    let degs, rhythm;
    if (this.motif && !this.reused && r() < 0.45) {
      this.reused = true;
      const shift = r.pick([1, -1, 2, -2, 3]);
      degs = this.motif.degs.map(d => d + shift);
      if (r() < 0.6) degs[degs.length - 1] += r.pick([1, -1, 2]);
      rhythm = this.motif.rhythm;
    } else {
      rhythm = r.pick(RHYTHMS);
      const reg = mood === 'night' ? 70 : 76;
      let d = this.nearestDeg(mood, reg + Math.floor(r() * 5));
      degs = [];
      for (let i = 0; i < rhythm.length; i++) {
        degs.push(d);
        const st = r();
        d += st < 0.35 ? 1 : st < 0.7 ? -1 : st < 0.82 ? 2 : st < 0.92 ? -2 : r.pick([3, -3, 4]);
      }
      // land on a chord tone of the opening chord
      const tones = [0, ...ch.v].map(x => ((ch.b + x) % 12 + 12) % 12);
      let last = degs[degs.length - 1];
      for (let k = 0; k < 4; k++) { if (tones.includes(((this.deg(mood, last) - root) % 12 + 12) % 12)) break; last += k % 2 ? -k : k; }
      degs[degs.length - 1] = last;
      this.motif = { degs: degs.slice(), rhythm };
      this.reused = false;
    }

    if (kind === 'bells') {
      // music-box motif up high + one low piano note and a quiet pad
      piano(A, t, mtof(root + ch.b - 12), 0.4, out, { decay: 1.6 });
      pad(A, t, [mtof(root + ch.b), mtof(root + ch.b + ch.v[0]), mtof(root + ch.b + ch.v[1])], beat * 6, 0.35, out, { attack: 2, release: 4, cutoff: 700, wave: 'triangle' });
      let tt = t + beat;
      degs.forEach((d, i) => { bell(A, tt + this.hum(), mtof(this.deg(mood, d) + 12), 0.55 - i * 0.03, out, { decay: 1.4 }); tt += rhythm[i] * beat * 0.75; });
      return tt - t0 + beat * 5;
    }

    const lead = kind === 'pluck' ? pluck : piano;
    leftHand(t, ch);
    let tt = t + (r() < 0.5 ? beat : beat * 0.5);
    const playLine = (dd, vel, inst = lead, oct = 0) => {
      dd.forEach((d, i) => {
        const v = vel * (0.85 + 0.25 * Math.sin((i + 1) / dd.length * Math.PI)) * (1 + this.hum() * 4);
        inst(A, tt + this.hum(), mtof(this.deg(mood, d) + oct), v, out, { decay: i === dd.length - 1 ? 1.5 : 1 });
        // occasional grace note from above
        if (i === dd.length - 1 && r() < 0.25) inst(A, tt - 0.07, mtof(this.deg(mood, d + 1) + oct), v * 0.5, out);
        tt += rhythm[i] * beat;
      });
    };
    playLine(degs, 0.62);
    if (kind === 'echo' || r() < 0.35) {
      // answer: same contour up a step-and-a-bit, softer, on a different chord
      tt += beat;
      leftHand(tt - beat * 0.5, ch2, lhInst * 0.8);
      const shift = r.pick([2, 3, -2]);
      playLine(degs.map(d => d + shift), 0.45, kind === 'echo' ? (mood === 'night' ? bell : pluck) : lead);
    }
    len = tt - t0 + beat * 5;
    return len;
  }

  theme(state, t0) {
    const A = this.A, out = this.explore, mood = this.mood(state);
    const beat = 0.7, minor = mood === 'night' ? -3 : 0;
    for (const [b, off] of THEME_CHORDS) {
      const m = 62 + off + minor;
      piano(A, t0 + b * beat, mtof(m - 12), 0.45, out, { decay: 1.6 });
      piano(A, t0 + b * beat + 0.08, mtof(m + 7), 0.3, out);
      piano(A, t0 + b * beat + 0.16, mtof(m + (off === -3 || off === -7 ? 15 : 16) - 12 + 12), 0.25, out);
    }
    let tt = t0 + beat * 0.02;
    for (const [s, d] of THEME) {
      const m = 74 + s + (minor && (s === 4 || s === -8) ? -1 : 0) + minor;
      flute(A, tt, mtof(m), d * beat * 0.95, 0.75, out);
      tt += d * beat;
    }
    return tt - t0 + beat * 6;
  }

  // ---------------------------------------------------------------- combat
  combatStepAt(t, step, level) {
    const A = this.A, out = this.combatBus;
    const s = step % 16, bar = Math.floor(step / 16) % 4;
    const chord = C_CHORDS[bar];
    if (s === 0 || s === 6 || (s === 10 && bar % 2) || (bar === 3 && s >= 12 && s !== 13)) taiko(A, t, s === 0 ? 0.9 : 0.6, out, { pitch: s === 0 ? 1 : 1.25 });
    if (s === 8) taiko(A, t, 0.35, out, { pitch: 0.85 });
    if (s === 4 || s === 12) rim(A, t, 0.5, out);
    if (s % 2 === 0) shaker(A, t, s % 4 === 2 ? 0.8 : 0.45, out);
    if (s === 0) bass(A, t, mtof(C_ROOT - 12 + chord[0]), 60 / 126 * 3.6, 0.9, out, { cutoff: 360 });
    if (level > 0.45) {
      const m = C_ROOT + 12 + chord[OSTINATO[s]] + (s === 15 ? 12 : 0);
      pluck(A, t, mtof(m), ACCENT.has(s) ? 0.5 : 0.28, out, { decay: 0.22, pos: 0.12 });
    }
    if (level > 0.75 && (s === 0 || s === 3 || s === 6)) stab(A, t, chord.map(x => mtof(C_ROOT + 12 + x)), s === 0 ? 0.8 : 0.55, out);
    if (level > 0.75 && bar === 3 && s === 8) swell(A, t, 60 / 126 * 2, 0.8, out);
    if (s === 0 && bar === 0 && level > 0.6) frameDrum(A, t + 60 / 126 / 4 * 14, 0.5, out);
  }

  victory(t) {
    const A = this.A, out = A.music;
    [62, 66, 69, 74, 78, 81].forEach((m, i) => pluck(A, t + i * 0.085, mtof(m), 0.55, out, { decay: 1.2 }));
    bell(A, t + 0.55, mtof(86), 0.5, out, { decay: 1.5 });
    piano(A, t + 0.5, mtof(50), 0.5, out, { decay: 1.4 });
    piano(A, t + 0.55, mtof(57), 0.35, out);
  }

  // ---------------------------------------------------------------- sanctum
  sanctumChord(t, i) {
    const A = this.A, out = this.sanctumBus;
    const set = [[50, 57, 64, 69], [47, 54, 62, 66], [43, 50, 57, 66], [45, 52, 59, 64]][i % 4];
    pad(A, t, set.map(mtof), 7, 0.9, out, { attack: 3.2, release: 5, cutoff: 1100, lfo: 0.07 });
    pad(A, t, [mtof(set[0] - 12)], 7, 0.6, out, { attack: 3, release: 5, cutoff: 260, wave: 'triangle' });
  }

  // ---------------------------------------------------------------- stingers
  sting(name, t) {
    const A = this.A, out = A.music;
    if (name === 'shrine') {
      [62, 66, 69, 73, 76, 81, 85, 88].forEach((m, i) => bell(A, t + i * 0.11, mtof(m), 0.5, out, { decay: 1.6 }));
      pad(A, t, [mtof(50), mtof(57), mtof(64), mtof(66)], 2.5, 1, out, { attack: 0.8, release: 4, cutoff: 1500 });
    } else if (name === 'discovery') {
      [69, 74, 76, 81].forEach((m, i) => piano(A, t + i * 0.16, mtof(m), 0.55, out, { decay: 1.4 }));
      piano(A, t, mtof(50), 0.5, out, { decay: 1.6 });
      bell(A, t + 0.7, mtof(88), 0.4, out);
    } else if (name === 'quest') {
      [[62, 0], [66, 0.18], [69, 0.36], [74, 0.6]].forEach(([m, d]) => { pluck(A, t + d, mtof(m), 0.6, out); piano(A, t + d, mtof(m - 12), 0.35, out); });
      bell(A, t + 0.62, mtof(86), 0.5, out, { decay: 2 });
    } else if (name === 'death') {
      [69, 65, 62, 57].forEach((m, i) => piano(A, t + i * 0.42, mtof(m), 0.5, out, { decay: 1.6 }));
      pad(A, t, [mtof(50), mtof(57), mtof(65)], 3, 0.8, out, { attack: 0.5, release: 4, cutoff: 600 });
    } else if (name === 'victory') this.victory(t);
  }

  // ---------------------------------------------------------------- driver
  // state: {night, dusk, combat (bool), intensity 0..1, sanctum (bool), restScale}
  step(state, t, horizon = 0.3) {
    const A = this.A, r = A.rng;
    // combat state machine
    if (state.combat) { if (!this.combatOn) { this.combatOn = true; this.cNext = Math.max(this.cNext, t + 0.06); this.cStep = 0; } this.combatEndT = -1; }
    else if (this.combatOn && this.combatEndT < 0) this.combatEndT = t + 3.5;
    if (this.combatOn && this.combatEndT > 0 && t > this.combatEndT) {
      this.combatOn = false;
      if (state.victory) { this.sting('victory', t + 0.2); state.victory = false; }
      this.nextPhrase = Math.max(this.nextPhrase, t + 10);
    }
    const target = this.combatOn ? clamp(0.35 + state.intensity, 0, 1) : 0;
    this.combatLevel += (target - this.combatLevel) * (target > this.combatLevel ? 0.5 : 0.05);
    this.gCombat.set(this.combatOn ? 1 : 0, t);
    this.gSanct.set(state.sanctum ? 1 : 0, t);
    this.gExplore.set(this.combatOn || state.sanctum ? 0 : 1, t);

    if (this.combatOn) {
      const stepDur = 60 / 126 / 4;
      while (this.cNext < t + horizon) { this.combatStepAt(this.cNext, this.cStep++, this.combatLevel); this.cNext += stepDur; }
    } else this.cNext = t;

    if (state.sanctum) {
      if (!this.sanctOn) { this.sanctOn = true; this.sNextChord = t + 0.05; this.sNextBell = t + 2; }
      while (this.sNextChord < t + horizon) { this.sanctumChord(this.sNextChord, this.sChord++); this.sNextChord += 8; }
      while (this.sNextBell < t + horizon) {
        const L = [74, 76, 78, 81, 83, 85, 86, 88, 90, 93];
        const n = 1 + Math.floor(r() * 4); let d = Math.floor(r() * 5);
        for (let i = 0; i < n; i++) { bell(A, this.sNextBell + i * 0.23, mtof(L[Math.min(L.length - 1, d)]), 0.32, this.sanctumBus, { decay: 2.2 }); d += 1 + Math.floor(r() * 2); }
        this.sNextBell += r.range(2.5, 6) * (state.restScale < 1 ? 0.6 : 1);
      }
    } else this.sanctOn = false;

    if (!this.combatOn && !state.sanctum && !state.silent && this.nextPhrase < t + horizon) {
      const t0 = Math.max(this.nextPhrase, t + 0.05);
      const len = this.phrase(state, t0);
      const rs = state.restScale ?? 1;
      const night = state.night > 0.5;
      this.nextPhrase = t0 + len + rs * r.range(night ? 22 : 16, night ? 55 : 42);
      this.lastPhraseEnd = t0 + len;
    } else if (this.combatOn || state.sanctum) this.nextPhrase = Math.max(this.nextPhrase, t + 8);
  }

  queueTheme(t) { this.pendingTheme = true; this.nextPhrase = Math.min(this.nextPhrase, Math.max(t + 2, this.lastPhraseEnd + 1)); }
}
