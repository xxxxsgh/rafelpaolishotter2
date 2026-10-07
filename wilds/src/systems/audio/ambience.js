// Environmental ambience. Continuous beds (wind, rustle, rain, water, fire,
// insects) are always-running sources whose gains/filters follow the world
// state; discrete life (birds, crickets, frogs, owls, wave crashes, thunder)
// is scheduled ahead in step(state, t, horizon).
//
// state = {
//   wind 0..1.5, altitude (m above ground), y (absolute), daylight 0..1, night 0..1,
//   rain 0..1, storm 0..1, grass 0..1, forest 0..1, snow 0..1,
//   river 0..1, ocean 0..1, lake 0..1, falls {x,y,z}|null, fallsAmt 0..1,
//   fire {x,y,z}|null, fireAmt 0..1, glide 0..1 (airspeed), indoor 0..1, underwater bool
// }
import { clamp, smooth, lerp } from './core.js';

export class Ambience {
  constructor(A) {
    this.A = A;
    const ac = A.ac, out = A.amb, P = (p, tc) => A.param(p, tc);
    this.t = 0;

    // ---- wind: low body + two whistling band-passes panned apart + glide rush
    const wl = A.loop('brown', 1);
    const wlF = A.filter('lowpass', 260, 0.6);
    this.windLow = A.gain(0);
    A.chain(wl, wlF, this.windLow, out);
    this.windHi = [];
    for (const pan of [-0.7, 0.7]) {
      const s = A.loop('pink', pan < 0 ? 1 : 0.97);
      const f = A.filter('bandpass', 600, 4.5);
      const f2 = A.filter('bandpass', 600, 3);
      const g = A.gain(0);
      A.chain(s, f, f2, g, A.stereo(pan, out));
      this.windHi.push({ f: P(f.frequency, 0.4), f2: P(f2.frequency, 0.4), g: P(g.gain, 0.3) });
    }
    this.gWindLow = P(this.windLow.gain, 0.4);
    this.gWindLowF = P(wlF.frequency, 0.5);
    const gl = A.loop('white', 1);
    const glF = A.filter('bandpass', 900, 0.6);
    const glG = A.gain(0);
    A.chain(gl, glF, glG, A.ambBus);   // glide rush is "at the ears", not muffled
    this.gGlide = P(glG.gain, 0.2); this.gGlideF = P(glF.frequency, 0.3);

    // ---- grass / leaf rustle
    const rs = A.loop('white', 1);
    const rsHp = A.filter('highpass', 1800, 0.5);
    const rsPk = A.filter('peaking', 5200, 0.9, 6);
    const rsG = A.gain(0);
    A.chain(rs, rsHp, rsPk, rsG, out);
    this.gRustle = P(rsG.gain, 0.08); this.gRustleF = P(rsPk.frequency, 0.5);

    // ---- rain: hiss + body + droplet texture
    const rh = A.loop('pink', 1); const rhF = A.filter('highpass', 600, 0.5); const rhL = A.filter('lowpass', 9000, 0.5);
    const rhG = A.gain(0); A.chain(rh, rhF, rhL, rhG, out);
    const rb = A.loop('brown', 1.4); const rbF = A.filter('lowpass', 900, 0.5); const rbG = A.gain(0); A.chain(rb, rbF, rbG, out);
    const rd = A.loop('rain', 1); const rdF = A.filter('highpass', 700, 0.5); const rdG = A.gain(0); A.chain(rd, rdF, rdG, out);
    const rd2 = A.loop('rain', 0.8); const rd2G = A.gain(0); A.chain(rd2, A.filter('lowpass', 5000, 0.5), rd2G, out);
    this.gRainHiss = P(rhG.gain, 1); this.gRainBody = P(rbG.gain, 1); this.gRainDrops = P(rdG.gain, 1); this.gRainDrops2 = P(rd2G.gain, 1);

    // ---- river: babble + rush
    const bb = A.loop('babble', 1); const bbF = A.filter('bandpass', 1100, 0.5); const bbG = A.gain(0); A.chain(bb, bbF, bbG, out);
    const ru = A.loop('pink', 0.9); const ruF = A.filter('bandpass', 450, 0.6); const ruG = A.gain(0); A.chain(ru, ruF, ruG, out);
    this.gRiver = P(bbG.gain, 0.8); this.gRiverRush = P(ruG.gain, 0.8);
    // ---- lake lapping: slowed babble, low-passed
    const lk = A.loop('babble', 0.55); const lkF = A.filter('lowpass', 900, 0.7); const lkG = A.gain(0); A.chain(lk, lkF, lkG, out);
    this.gLake = P(lkG.gain, 1);
    // ---- ocean surf: swell envelope scheduled per wave
    const oc = A.loop('pink', 0.8); this.ocF = A.filter('lowpass', 500, 0.6); this.ocEnv = A.gain(0.2); const ocG = A.gain(0);
    const ob = A.loop('brown', 1); const obG = A.gain(0.6);
    A.chain(oc, this.ocF, this.ocEnv, ocG, out); ob.connect(obG); obG.connect(this.ocEnv);
    this.gOcean = P(ocG.gain, 1.2); this.nextWave = 0;
    // ---- waterfall (positional roar)
    this.fallsPan = A.panner(0, -9999, 0, { ref: 18, rolloff: 1.0, max: 800 });
    const fa = A.loop('pink', 1); const faF = A.filter('lowpass', 2600, 0.5); const fb = A.loop('brown', 1); const fbG = A.gain(1.2);
    const faG = A.gain(0); fa.connect(faF); faF.connect(faG); fb.connect(fbG); fbG.connect(faG); faG.connect(this.fallsPan); this.fallsPan.connect(out);
    this.gFalls = P(faG.gain, 1.5);
    // ---- campfire (positional): low roar + crackle texture + scheduled pops
    this.firePan = A.panner(0, -9999, 0, { ref: 2.5, rolloff: 1.4, max: 200 });
    const fr = A.loop('brown', 1); const frF = A.filter('lowpass', 380, 0.7); const frG = A.gain(0.5);
    const fc = A.loop('crackle', 1); const fcF = A.filter('highpass', 700, 0.5); const fcG = A.gain(0.6);
    this.fireG = A.gain(0);
    fr.connect(frF); frF.connect(frG); frG.connect(this.fireG);
    fc.connect(fcF); fcF.connect(fcG); fcG.connect(this.fireG);
    this.fireG.connect(this.firePan); this.firePan.connect(A.sfx);   // not muffled: a fire is near
    this.gFire = P(this.fireG.gain, 0.6);
    this.nextPop = 0;
    // ---- insect chorus bed (night)
    const ib = A.loop('white', 1); const ibF = A.filter('bandpass', 4700, 6); const ibAM = A.gain(0); const ibG = A.gain(0);
    const am = ac.createOscillator(); am.frequency.value = 22; const amG = A.gain(0.5); am.connect(amG); amG.connect(ibAM.gain); am.start();
    A.chain(ib, ibF, ibAM, ibG, out); ibAM.gain.value = 0.5;
    this.gInsects = P(ibG.gain, 2);
    // ---- crickets: continuous carriers gated by scheduled chirp envelopes
    this.crickets = [];
    for (let i = 0; i < 4; i++) {
      const f = 4100 + i * 260 + A.rng() * 120;
      const o = ac.createOscillator(); o.frequency.value = f;
      const o2 = ac.createOscillator(); o2.frequency.value = f * 2.01; const o2g = A.gain(0.18);
      const gate = A.gain(0);
      const pan = A.stereo(-0.8 + i * 0.53 + (A.rng() - 0.5) * 0.2, out);
      const lvl = A.gain(0);
      o.connect(gate); o2.connect(o2g); o2g.connect(gate); gate.connect(lvl); lvl.connect(pan);
      o.start(); o2.start();
      this.crickets.push({ gate: gate.gain, lvl: P(lvl.gain, 1.5), next: 0, rate: 0.55 + A.rng() * 0.5, pulses: 3 + (i % 3), pr: 0.028 + A.rng() * 0.012 });
    }
    this.nextBird = 0; this.nextFrog = 0; this.nextOwl = 0; this.nextGust = 0;
    this.gust = 0; this.gustT = 0;
    this.pMuffle = P(A.muffle.frequency, 0.25);
    this.pOutdoor = P(A.outdoor.gain, 0.6);
  }

  // ---------------------------------------------------------------- birds
  bird(t, s) {
    const A = this.A, r = A.rng;
    // random spot around the listener, up in the trees / sky
    const a = r() * 6.283, d = r.range(12, 45);
    const dest = A.panner(s.lx + Math.cos(a) * d, s.ly + r.range(3, 14), s.lz + Math.sin(a) * d, { ref: 12, rolloff: 0.9 });
    const g = A.gain(r.range(3.2, 5.2)); g.connect(dest); dest.connect(A.amb);
    const kind = r.pick(s.forest > 0.4 ? ['warble', 'trill', 'whistle', 'coo', 'trill', 'pip'] : ['whistle', 'trill', 'pip', 'warble', 'lark']);
    const base = r.range(0.85, 1.2);
    if (kind === 'whistle') {             // two falling whistles "tee-yoo"
      const n = 1 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) A.tone(t + i * 0.42, 3600 * base, 0.32, g, { to: 2300 * base, glide: 0.28, gain: 0.13, attack: 0.03, curve: 2.2 });
    } else if (kind === 'trill') {        // rapid chirp series
      const n = 6 + Math.floor(r() * 10), f = 4200 * base, rate = r.range(0.045, 0.075);
      for (let i = 0; i < n; i++) A.tone(t + i * rate, f * (1 + (i % 2) * 0.06), 0.04, g, { to: f * 0.78, glide: 0.035, gain: 0.09 * (1 - i / n * 0.5), attack: 0.004 });
    } else if (kind === 'warble') {       // vibrato song phrase
      let tt = t;
      for (let i = 0; i < 4 + Math.floor(r() * 4); i++) {
        const f = r.range(2400, 4200) * base, dur = r.range(0.08, 0.2);
        const { osc } = A.tone(tt, f, dur, g, { to: f * r.range(0.8, 1.25), glide: dur, gain: 0.085, attack: 0.012, curve: 2 });
        const v = A.ac.createOscillator(); v.frequency.value = r.range(25, 45); const vg = A.gain(f * 0.04); v.connect(vg); vg.connect(osc.frequency); v.start(tt); v.stop(tt + dur + 0.1);
        tt += dur + r.range(0.02, 0.09);
      }
    } else if (kind === 'coo') {          // soft low dove-like call
      [0, 0.45, 0.75].forEach((o, i) => A.tone(t + o, 520 * base, i === 0 ? 0.35 : 0.22, g, { to: 470 * base, glide: 0.25, gain: 0.05, attack: 0.06, curve: 2 }));
    } else if (kind === 'lark') {         // high tumbling song
      let tt = t;
      for (let i = 0; i < 14; i++) { const f = r.range(3500, 6500); A.tone(tt, f, 0.05, g, { to: f * r.range(0.85, 1.15), gain: 0.06, attack: 0.004 }); tt += r.range(0.04, 0.09); }
    } else {                              // pip pip
      const n = 2 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) A.tone(t + i * 0.16, 5200 * base, 0.03, g, { to: 4600 * base, gain: 0.09, attack: 0.002 });
    }
  }

  frog(t, s) {
    const A = this.A, r = A.rng;
    const a = r() * 6.283, d = r.range(8, 30);
    const dest = A.panner(s.lx + Math.cos(a) * d, s.ly - 1, s.lz + Math.sin(a) * d, { ref: 5 });
    dest.connect(A.amb);
    const n = 2 + Math.floor(r() * 4), f0 = r.range(140, 260);
    for (let i = 0; i < n; i++) {
      const tt = t + i * r.range(0.16, 0.24);
      const o = A.ac.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f0, tt); o.frequency.linearRampToValueAtTime(f0 * 1.15, tt + 0.1);
      const bp = A.filter('bandpass', f0 * 4.5, 4); const e = A.gain(0);
      const am = A.ac.createOscillator(); am.type = 'square'; am.frequency.value = r.range(38, 60); const amg = A.gain(0.5);
      am.connect(amg); amg.connect(e.gain);
      e.gain.setValueAtTime(0, tt); e.gain.linearRampToValueAtTime(0.09, tt + 0.02); e.gain.setTargetAtTime(0, tt + 0.08, 0.03);
      o.connect(bp); bp.connect(e); e.connect(dest);
      o.start(tt); o.stop(tt + 0.25); am.start(tt); am.stop(tt + 0.25);
    }
  }

  owl(t, s) {
    const A = this.A, r = A.rng;
    const a = r() * 6.283, d = r.range(30, 70);
    const dest = A.panner(s.lx + Math.cos(a) * d, s.ly + 10, s.lz + Math.sin(a) * d, { ref: 10 });
    dest.connect(A.amb);
    const f = r.range(360, 420);
    [[0, 0.5], [0.85, 0.18], [1.12, 0.6]].forEach(([o, len]) => {
      A.tone(t + o, f, len, dest, { to: f * 0.93, glide: len, gain: 0.12, attack: 0.07, hold: len * 0.4, curve: 3 });
      A.burst(t + o, len, dest, { noise: 'pink', bp: f * 2, q: 3, gain: 0.03, attack: 0.07 });
    });
  }

  // thunder: crack (when close) then a rolling low rumble
  thunder(t, distance = 1500, pos = null, listener = null) {
    const A = this.A, r = A.rng;
    let dest = A.amb;
    if (pos && listener) {
      // place the source at a fixed 60 m in the strike's direction: we model the
      // distance with filtering/level ourselves, the panner only gives direction
      const dx = pos.x - listener.x, dz = pos.z - listener.z, l = Math.hypot(dx, dz) || 1;
      dest = A.panner(listener.x + dx / l * 60, listener.y + 25, listener.z + dz / l * 60, { ref: 60, rolloff: 0 });
      dest.connect(A.amb);
    }
    const near = clamp(1 - distance / 2500, 0, 1);
    const vol = 0.35 + near * 0.65;
    if (near > 0.45) {
      A.burst(t, 0.35, dest, { noise: 'white', hp: 1500, gain: 0.5 * near * vol, attack: 0.002 });
      A.burst(t, 0.6, dest, { noise: 'pink', lp: 3000, gain: 0.6 * near * vol, attack: 0.004 });
    }
    // rumble: several overlapping low bursts with wandering cutoff
    const len = 3 + r() * 3 + (1 - near) * 2;
    const n = 5 + Math.floor(r() * 5);
    for (let i = 0; i < n; i++) {
      const tt = t + (near > 0.45 ? 0.08 : 0.25) + Math.pow(i / n, 1.4) * len * 0.8 + r() * 0.2;
      const d = r.range(0.8, 2.2);
      A.burst(tt, d, dest, { noise: 'brown', lp: lerp(160, 520, near) * r.range(0.7, 1.4), lpq: 1.2, gain: vol * r.range(0.5, 1) * (1 - i / n * 0.6) * 1.4, attack: r.range(0.05, 0.3) });
    }
    A.burst(t + 0.3, len, dest, { noise: 'brown', lp: 90, gain: vol * 0.9, attack: 0.6 });
  }

  wave(t, s, strength) {
    // one breaker: build (lowpass opens), crash, long hissing recede
    const A = this.A, r = A.rng;
    const build = r.range(1.6, 2.8), crash = 0.5, recede = r.range(3, 5);
    const e = this.ocEnv.gain, f = this.ocF.frequency;
    e.setTargetAtTime(0.25 + 0.2 * strength, t, build / 2.5);
    f.setTargetAtTime(700, t, build / 2);
    e.setTargetAtTime(0.85 + 0.3 * strength, t + build, 0.08);
    f.setTargetAtTime(4200 + 2500 * strength, t + build, 0.1);
    e.setTargetAtTime(0.35, t + build + crash, recede / 2.2);
    f.setTargetAtTime(1600, t + build + crash, recede / 3);
    f.setTargetAtTime(500, t + build + crash + recede * 0.6, 0.8);
    return build + crash + recede * r.range(0.75, 1);
  }

  pop(t) {
    const A = this.A, r = A.rng;
    const big = r() < 0.2;
    A.burst(t, big ? 0.05 : 0.02, this.fireG, { bp: r.range(1500, 5000), q: r.range(2, 8), gain: big ? 0.9 : 0.5, attack: 0.0005 });
    if (big) A.burst(t + 0.005, 0.12, this.fireG, { noise: 'pink', lp: 900, gain: 0.5, attack: 0.002 });
  }

  // ---------------------------------------------------------------- driver
  step(s, t, horizon = 0.3) {
    const A = this.A, r = A.rng;
    const dt = Math.max(0, Math.min(0.25, t - this.t)); this.t = t;
    // gusts: slow random walk, occasionally kicked up
    if (t > this.nextGust) { this.gustT = clamp(r() * r() * 1.4 * (0.4 + s.wind), 0, 1.3); this.nextGust = t + r.range(2, 7); }
    this.gust += (this.gustT - this.gust) * Math.min(1, dt * 0.7);
    const outdoor = 1 - s.indoor;
    const alt = smooth(4, 60, s.altitude) * 0.6 + smooth(120, 260, s.y) * 0.6;
    const w = clamp(s.wind * 0.75 + this.gust * 0.5 + alt * 0.5 + s.storm * 0.5, 0, 2);
    this.gWindLow.set(0.025 + w * 0.15, t);
    this.gWindLowF.set(140 + w * 200, t);
    const ph = t * 0.13;
    this.windHi.forEach((h, i) => {
      const wob = Math.sin(ph * (1.3 + i * 0.4) + i * 2) * 0.5 + Math.sin(ph * 3.1 + i) * 0.25;
      const fc = 380 + w * 420 + wob * 160 + alt * 500;
      h.f.set(fc, t); h.f2.set(fc * 1.04, t);
      h.g.set(Math.pow(w, 1.6) * (0.16 + alt * 0.35) * (0.8 + wob * 0.3), t);
    });
    this.gGlide.set(s.glide * 0.32, t); this.gGlideF.set(600 + s.glide * 1400, t);
    // rustle follows the gusts over grass / leaves
    const veg = clamp(s.grass * 0.8 + s.forest, 0, 1) * (1 - s.snow);
    const flutter = 0.7 + r() * 0.6;
    this.gRustle.set(veg * clamp(0.012 + this.gust * 0.09 + s.wind * 0.035, 0, 0.16) * flutter * (1 - alt * 0.8), t);
    this.gRustleF.set(s.forest > 0.4 ? 3200 : 5400, t);
    // rain
    const rain = s.rain;
    this.gRainHiss.set(rain * 0.16, t);
    this.gRainBody.set(rain * rain * 0.35 + s.storm * 0.12, t);
    this.gRainDrops.set(rain * 0.25, t);
    this.gRainDrops2.set(smooth(0.2, 0.8, rain) * 0.18, t);
    // water
    this.gRiver.set(s.river * 0.5, t); this.gRiverRush.set(s.river * s.river * 0.35, t);
    this.gLake.set(s.lake * 0.16, t);
    this.gOcean.set(s.ocean * 0.55, t);
    if (s.falls) A.setPos(this.fallsPan, s.falls.x, s.falls.y, s.falls.z, t);
    this.gFalls.set(s.fallsAmt * 0.6, t);
    if (s.fire) A.setPos(this.firePan, s.fire.x, s.fire.y, s.fire.z, t);
    this.gFire.set(s.fireAmt * 0.55, t);
    // insects
    const nightLife = s.night * (1 - rain) * (1 - s.snow) * outdoor;
    this.gInsects.set(nightLife * 0.02 * (0.5 + veg), t);
    const lvl = nightLife * (0.4 + veg * 0.6);
    for (const c of this.crickets) {
      c.lvl.set(lvl * 0.11, t);
      if (c.next < t) c.next = t + r() * 0.4;
      while (c.next < t + horizon) {
        if (lvl > 0.02) for (let p = 0; p < c.pulses; p++) {
          const pt = c.next + p * c.pr * 1.6;
          c.gate.setValueAtTime(0, pt); c.gate.linearRampToValueAtTime(1, pt + c.pr * 0.3); c.gate.linearRampToValueAtTime(0, pt + c.pr);
        }
        c.next += c.rate * (0.9 + r() * 0.25) * (r() < 0.07 ? 3 : 1);
      }
    }
    // discrete life
    if (this.nextBird < t) this.nextBird = t + r.range(0.5, 3);
    while (this.nextBird < t + horizon) {
      const day = s.daylight * (1 - rain) * (1 - s.storm) * outdoor * (1 - alt * 0.7);
      if (day > 0.15 && r() < day * (0.35 + s.forest * 0.65)) this.bird(this.nextBird, s);
      this.nextBird += r.range(0.8, 3.6) / (0.6 + s.forest);
    }
    if (this.nextFrog < t) this.nextFrog = t + r.range(1, 4);
    while (this.nextFrog < t + horizon) {
      if (s.night > 0.5 && (s.lake + s.river) > 0.15 && r() < 0.7 * outdoor) this.frog(this.nextFrog, s);
      this.nextFrog += r.range(1.5, 5);
    }
    if (this.nextOwl < t) this.nextOwl = t + r.range(8, 30);
    while (this.nextOwl < t + horizon) {
      if (s.night > 0.6 && s.forest > 0.2 && rain < 0.2 && outdoor > 0.5) this.owl(this.nextOwl, s);
      this.nextOwl += r.range(20, 50) * (s.demo ? 0.3 : 1);
    }
    if (this.nextWave < t) this.nextWave = t;
    while (this.nextWave < t + horizon) this.nextWave += this.wave(this.nextWave, s, clamp(s.wind * 0.6 + s.storm, 0, 1));
    if (this.nextPop < t) this.nextPop = t;
    while (this.nextPop < t + horizon) {
      if (s.fireAmt > 0.01) this.pop(this.nextPop);
      this.nextPop += r() < 0.3 ? r.range(0.03, 0.12) : r.range(0.2, 1.4);
    }
    // interiors / underwater muffle the outdoors
    this.pMuffle.set(s.underwater ? 380 : lerp(20000, 700, s.indoor), t);
    this.pOutdoor.set(s.underwater ? 0.6 : lerp(1, 0.18, s.indoor), t);
  }
}
