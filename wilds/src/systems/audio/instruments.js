// Synthesised instruments for the score. Every voice is
//   fn(A, t, freq, vel, dest, opts)
// and schedules itself at audio time t into `dest`. Additive/subtractive only,
// no samples. Kept light: a piano note is ~10 nodes and frees itself.

const TAU = Math.PI * 2;

// ------------------------------------------------------------ felt piano
// Stretched (inharmonic) partials, a detuned unison on the fundamental for the
// slow beating of real piano strings, a soft hammer thump and velocity-
// dependent brightness. Upper partials die faster, so notes "bloom" then mellow.
export function piano(A, t, f, vel, dest, o = {}) {
  const { ac } = A;
  const out = A.gain(1);
  const lp = A.filter('lowpass', Math.min(14000, f * (3 + vel * 9)), 0.4);
  lp.frequency.setTargetAtTime(Math.min(9000, f * (1.8 + vel * 2.5)), t + 0.02, 0.6);
  lp.connect(out); out.connect(dest);
  const B = 0.00035;
  const base = (o.decay ?? 1) * 4.2 * Math.pow(220 / f, 0.45);
  const n = f > 1500 ? 4 : f > 700 ? 6 : 8;
  const stop = t + base * 1.4 + 0.2;
  for (let k = 1; k <= n; k++) {
    const fk = f * k * Math.sqrt(1 + B * k * k);
    if (fk > 16000) break;
    const amp = vel * 0.22 / Math.pow(k, 1.15) * (k === 1 ? 1 : 0.6 + vel * 0.6) * (k % 7 === 0 ? 0.3 : 1);
    const dec = base / (1 + 0.55 * (k - 1));
    const voices = k <= 2 ? 2 : 1;
    for (let v = 0; v < voices; v++) {
      const osc = ac.createOscillator(); osc.frequency.value = fk;
      if (voices === 2) osc.detune.value = v ? 1.1 : -1.1;
      const e = A.gain(0);
      e.gain.setValueAtTime(0, t);
      e.gain.linearRampToValueAtTime(amp / voices, t + 0.004);
      // two-stage decay: quick initial drop, long tail (prompt + aftersound)
      e.gain.setTargetAtTime(amp / voices * 0.45, t + 0.004, dec * 0.12);
      e.gain.setTargetAtTime(0, t + dec * 0.25, dec * 0.35);
      if (o.release) e.gain.setTargetAtTime(0, t + o.release, 0.18);
      osc.connect(e); e.connect(lp);
      osc.start(t); osc.stop(stop);
    }
  }
  // hammer
  A.burst(t, 0.03, lp, { noise: 'pink', lp: Math.min(4000, f * 5), gain: 0.05 * vel, attack: 0.001 });
  return out;
}

// ------------------------------------------------------------ plucked string
// Harp/zither-like: pluck-position comb on the partials, a filter that closes
// after the attack and a few cents of pitch drop as the string settles.
export function pluck(A, t, f, vel, dest, o = {}) {
  const { ac } = A;
  const out = A.gain(1); out.connect(dest);
  const lp = A.filter('lowpass', Math.min(15000, f * 14), 0.6);
  lp.frequency.setValueAtTime(Math.min(15000, f * 14), t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(200, f * 2.2), t + 0.35 * (o.decay ?? 1));
  lp.connect(out);
  const pos = o.pos ?? 0.18;
  const dec = (o.decay ?? 1) * 2.4 * Math.pow(260 / f, 0.35);
  for (let k = 1; k <= 7; k++) {
    const amp = vel * 0.2 * Math.abs(Math.sin(k * Math.PI * pos)) / k;
    if (amp < 0.002) continue;
    const osc = ac.createOscillator(); osc.frequency.setValueAtTime(f * k * 1.0016, t);
    osc.frequency.exponentialRampToValueAtTime(f * k, t + 0.06);
    const e = A.gain(0);
    e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(amp, t + 0.0025);
    e.gain.setTargetAtTime(0, t + 0.0025, dec / (1 + (k - 1) * 0.7) / 3);
    osc.connect(e); e.connect(lp);
    osc.start(t); osc.stop(t + dec * 1.3 + 0.1);
  }
  A.burst(t, 0.012, lp, { hp: f * 2, gain: 0.04 * vel, attack: 0.0005 });
  return out;
}

// ------------------------------------------------------------ glass bell / celesta
const BELL_R = [1, 2.0, 2.76, 4.07, 5.43];
const BELL_A = [1, 0.32, 0.38, 0.12, 0.08];
export function bell(A, t, f, vel, dest, o = {}) {
  const { ac } = A;
  const out = A.gain(1); out.connect(dest);
  const dec = (o.decay ?? 1) * 2.2;
  for (let k = 0; k < BELL_R.length; k++) {
    const fk = f * BELL_R[k]; if (fk > 15000) break;
    const osc = ac.createOscillator(); osc.frequency.value = fk;
    const e = A.gain(0);
    e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(vel * 0.12 * BELL_A[k], t + 0.002);
    e.gain.setTargetAtTime(0, t + 0.002, dec / (1 + k * 0.9) / 3);
    osc.connect(e); e.connect(out);
    osc.start(t); osc.stop(t + dec + 0.2);
  }
  return out;
}

// ------------------------------------------------------------ breathy flute
export function flute(A, t, f, dur, vel, dest) {
  const { ac } = A;
  const out = A.gain(0); out.connect(dest);
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(vel * 0.16, t + 0.09);
  out.gain.setTargetAtTime(vel * 0.12, t + 0.09, 0.3);
  out.gain.setTargetAtTime(0, t + dur, 0.12);
  const osc = ac.createOscillator(); osc.frequency.value = f;
  const o2 = ac.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f * 2;
  const g2 = A.gain(0.12);
  const vib = ac.createOscillator(); vib.frequency.value = 5.1;
  const vg = A.gain(0); vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(f * 0.006, t + Math.min(0.6, dur * 0.6));
  vib.connect(vg); vg.connect(osc.frequency); vg.connect(o2.detune);
  osc.connect(out); o2.connect(g2); g2.connect(out);
  const end = t + dur + 0.6;
  for (const s of [osc, o2, vib]) { s.start(t); s.stop(end); }
  // breath chiff + air
  A.burst(t, 0.08, out, { noise: 'pink', bp: f * 2, q: 2, gain: 0.5 });
  const air = A.burst(t, dur, out, { noise: 'pink', bp: f * 1.5, q: 1.4, gain: 0.08, attack: 0.1, shape: 'swell' });
  return out;
}

// ------------------------------------------------------------ warm pad
// Detuned saw pairs through a breathing low-pass. freqs = chord.
export function pad(A, t, freqs, dur, vel, dest, o = {}) {
  const { ac } = A;
  const out = A.gain(0); out.connect(dest);
  const atk = o.attack ?? 2.5, rel = o.release ?? 3;
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(vel * 0.05, t + atk);
  out.gain.setValueAtTime(vel * 0.05, t + Math.max(atk, dur));
  out.gain.linearRampToValueAtTime(0, t + Math.max(atk, dur) + rel);
  const lp = A.filter('lowpass', o.cutoff ?? 900, 0.8); lp.connect(out);
  const lfo = ac.createOscillator(); lfo.frequency.value = o.lfo ?? 0.09;
  const lg = A.gain((o.cutoff ?? 900) * 0.45); lfo.connect(lg); lg.connect(lp.frequency);
  const end = t + Math.max(atk, dur) + rel + 0.1;
  lfo.start(t); lfo.stop(end);
  for (const f of freqs) {
    for (const d of [-8, 7]) {
      const osc = ac.createOscillator(); osc.type = o.wave || 'sawtooth'; osc.frequency.value = f; osc.detune.value = d + (A.rng() - 0.5) * 3;
      const g = A.gain(1 / freqs.length); osc.connect(g); g.connect(lp);
      osc.start(t, ); osc.stop(end);
    }
  }
  return out;
}

// ------------------------------------------------------------ bowed low string / bass
export function bass(A, t, f, dur, vel, dest, o = {}) {
  const { ac } = A;
  const out = A.gain(0); out.connect(dest);
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(vel * 0.2, t + (o.attack ?? 0.02));
  out.gain.setTargetAtTime(vel * 0.12, t + 0.05, 0.25);
  out.gain.setTargetAtTime(0, t + dur, o.release ?? 0.15);
  const lp = A.filter('lowpass', o.cutoff ?? 420, 1.2); lp.connect(out);
  const s = ac.createOscillator(); s.type = 'sawtooth'; s.frequency.value = f;
  const q = ac.createOscillator(); q.frequency.value = f / 2;
  const qg = A.gain(0.7);
  s.connect(lp); q.connect(qg); qg.connect(out);
  const end = t + dur + (o.release ?? 0.15) * 6;
  s.start(t); s.stop(end); q.start(t); q.stop(end);
  return out;
}

// ------------------------------------------------------------ staccato string stab
export function stab(A, t, freqs, vel, dest, o = {}) {
  const { ac } = A;
  const out = A.gain(0); out.connect(dest);
  const len = o.len ?? 0.16;
  out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(vel * 0.09, t + 0.01);
  out.gain.setTargetAtTime(0, t + len, 0.05);
  const bp = A.filter('lowpass', 3200, 1.5);
  bp.frequency.setValueAtTime(4200, t); bp.frequency.exponentialRampToValueAtTime(900, t + len + 0.1);
  bp.connect(out);
  for (const f of freqs) for (const d of [-6, 6]) {
    const osc = ac.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = f; osc.detune.value = d;
    const g = A.gain(1 / freqs.length); osc.connect(g); g.connect(bp);
    osc.start(t); osc.stop(t + len + 0.4);
  }
  return out;
}

// ------------------------------------------------------------ percussion
export function taiko(A, t, vel, dest, o = {}) {
  const p = o.pitch ?? 1;
  A.tone(t, 150 * p, 0.55, dest, { to: 46 * p, glide: 0.22, gain: vel * 0.9, attack: 0.002 });
  A.tone(t, 240 * p, 0.18, dest, { to: 90 * p, glide: 0.12, gain: vel * 0.25, attack: 0.001 });
  A.burst(t, 0.07, dest, { noise: 'pink', lp: 1400, gain: vel * 0.6, attack: 0.001 });
}
export function rim(A, t, vel, dest) {
  A.burst(t, 0.09, dest, { bp: 2300, q: 1.6, gain: vel * 0.55, attack: 0.001 });
  A.tone(t, 420, 0.05, dest, { to: 300, gain: vel * 0.25, attack: 0.001 });
}
export function shaker(A, t, vel, dest) {
  A.burst(t, 0.05 + vel * 0.03, dest, { hp: 6500, gain: vel * 0.22, attack: 0.008 });
}
export function frameDrum(A, t, vel, dest) {
  A.tone(t, 95, 0.35, dest, { to: 70, glide: 0.1, gain: vel * 0.45 });
  A.burst(t, 0.12, dest, { noise: 'pink', bp: 700, q: 0.8, gain: vel * 0.35 });
}
// gong/cymbal swell — reverse-ish crescendo used for tension
export function swell(A, t, dur, vel, dest) {
  A.burst(t, dur, dest, { noise: 'pink', hp: 3000, gain: vel * 0.18, attack: dur * 0.95, shape: 'swell' });
}
