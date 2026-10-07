// Audio core: bus graph, master dynamics, procedural reverbs, noise + texture
// buffers and small scheduling helpers. Works on any BaseAudioContext so the
// exact same graph renders live (AudioContext) or offline (OfflineAudioContext,
// see tools/audio-render.mjs).
//
//   sources ─► bus(music|amb|sfx|ui) ─► master ─► glue comp ─► limiter ─► out(mute) ─► destination
//                    └─► send ─► air reverb / hall reverb ─► master
//   outdoor ambience passes an extra low-pass ("muffle") used for interiors / underwater.

// ------------------------------------------------------------------ rng
export function makeRng(seed = 1) {
  let s = seed >>> 0 || 1;
  const r = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  r.range = (a, b) => a + (b - a) * r();
  r.pick = arr => arr[Math.floor(r() * arr.length) % arr.length];
  r.chance = p => r() < p;
  return r;
}

export const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------ buffers
function crossfadeLoop(data, fade) {
  // blend the tail into the head so a looping buffer has no seam click
  const n = data.length - fade;
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    data[i] = data[i] * t + data[n + i] * (1 - t);
  }
  return data.subarray(0, n);
}

function makeBuffer(ac, seconds, channels, fill) {
  const sr = ac.sampleRate, fade = 4096;
  const len = Math.floor(seconds * sr);
  const buf = ac.createBuffer(channels, len, sr);
  for (let c = 0; c < channels; c++) {
    const tmp = new Float32Array(len + fade);
    fill(tmp, sr, c);
    // normalise to peak 0.9
    let pk = 1e-6; for (let i = 0; i < tmp.length; i++) { const a = Math.abs(tmp[i]); if (a > pk) pk = a; }
    const k = 0.9 / pk; for (let i = 0; i < tmp.length; i++) tmp[i] *= k;
    buf.copyToChannel(crossfadeLoop(tmp, fade), c);
  }
  return buf;
}

function fillWhite(d, sr, c) { const r = makeRng(17 + c * 101); for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1; }
function fillPink(d, sr, c) {
  const r = makeRng(29 + c * 131);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < d.length; i++) {
    const w = r() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
  }
}
function fillBrown(d, sr, c) {
  const r = makeRng(43 + c * 151); let l = 0;
  for (let i = 0; i < d.length; i++) { l = (l + 0.02 * (r() * 2 - 1)) / 1.02; d[i] = l; }
}
// rain: a dense bed of tiny high droplet ticks plus sparser upward-chirping "plinks"
function fillRain(d, sr, c) {
  const r = makeRng(71 + c * 7);
  const n = Math.floor(d.length / sr * 900);
  for (let k = 0; k < n; k++) {
    const at = Math.floor(r() * d.length);
    const big = r() < 0.06;
    const f0 = big ? 900 + r() * 1400 : 2500 + r() * 7000;
    const len = Math.floor(sr * (big ? 0.012 + r() * 0.02 : 0.0015 + r() * 0.004));
    const amp = (big ? 0.6 : 0.25) * (0.2 + r() * r());
    let ph = r() * 6.28;
    for (let i = 0; i < len && at + i < d.length; i++) {
      const t = i / len;
      const f = big ? f0 * (1 + t * 0.9) : f0;   // water-drop chirp rises
      ph += 6.283185 * f / sr;
      d[at + i] += Math.sin(ph) * amp * Math.exp(-t * 5) * (big ? 1 : (1 - t));
    }
  }
}
// campfire crackle: clustered pops, each a sharp impulse into a short resonant ring
function fillCrackle(d, sr, c) {
  const r = makeRng(97 + c * 3);
  let t = 0;
  while (t < d.length) {
    t += Math.floor(sr * (r() < 0.25 ? 0.004 + r() * 0.03 : 0.04 + r() * r() * 0.45));
    const amp = Math.pow(r(), 2.2) * (r() < 0.08 ? 1 : 0.45);
    const f = 1200 + r() * 5200, q = 0.985 + r() * 0.01;
    let y1 = 0, y2 = 0; const w = 2 * Math.cos(6.283185 * f / sr);
    const len = Math.floor(sr * (0.004 + r() * 0.02));
    for (let i = 0; i < len && t + i < d.length; i++) {
      const x = i < 3 ? (r() * 2 - 1) * amp : (r() * 2 - 1) * amp * 0.15 * Math.exp(-i / (len * 0.2));
      const y = x + w * q * y1 - q * q * y2; y2 = y1; y1 = y;
      d[t + i] += y * 0.25;
    }
  }
}
// bubbling water: many short rising sine bubbles (Minnaert resonances)
function fillBabble(d, sr, c) {
  const r = makeRng(131 + c * 5);
  const n = Math.floor(d.length / sr * 260);
  for (let k = 0; k < n; k++) {
    const at = Math.floor(r() * d.length);
    const f0 = 280 + Math.pow(r(), 1.6) * 1500;
    const len = Math.floor(sr * (0.008 + r() * 0.035));
    const amp = 0.1 + r() * r() * 0.6;
    let ph = 0;
    for (let i = 0; i < len && at + i < d.length; i++) {
      const t = i / len;
      ph += 6.283185 * f0 * (1 + 0.35 * t * t) / sr;
      d[at + i] += Math.sin(ph) * amp * Math.exp(-t * 4) * Math.min(1, i / 30);
    }
  }
  // fold in some pink wash
  const pr = makeRng(7 + c); let l = 0;
  for (let i = 0; i < d.length; i++) { l = l * 0.97 + (pr() * 2 - 1) * 0.03; d[i] += l * 0.5; }
}

function makeIR(ac, seconds, decay, damp, seed, predelay = 0.018) {
  const sr = ac.sampleRate, len = Math.floor(seconds * sr);
  const buf = ac.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const d = new Float32Array(len), r = makeRng(seed + c * 977);
    const pd = Math.floor(predelay * sr);
    // early reflections
    for (let k = 0; k < 14; k++) {
      const at = pd + Math.floor((0.004 + r() * 0.07) * sr);
      if (at < len) d[at] += (r() < 0.5 ? -1 : 1) * (0.5 - k * 0.025);
    }
    // diffuse tail, darkening over time (one-pole lowpass whose cutoff falls)
    let lp = 0;
    for (let i = pd; i < len; i++) {
      const t = (i - pd) / sr;
      const env = Math.exp(-t * 6.9 / decay) * Math.min(1, t / 0.03);
      const a = Math.exp(-6.283185 * Math.max(300, damp * Math.exp(-t * 1.6)) / sr);
      lp = lp * a + (r() * 2 - 1) * (1 - a);
      d[i] += lp * env * 2.2;
    }
    buf.copyToChannel(d, c);
  }
  return buf;
}

// ------------------------------------------------------------------ core
export function createCore(ac, opts = {}) {
  const A = { ac, rng: makeRng(opts.seed ?? ((Date.now() & 0xffff) + 1)) };
  const g = (v = 1) => { const n = ac.createGain(); n.gain.value = v; return n; };
  A.gain = g;

  A.out = g(1);
  A.out.connect(ac.destination);
  const limiter = ac.createDynamicsCompressor();
  limiter.threshold.value = -2.5; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.12;
  limiter.connect(A.out);
  const glue = ac.createDynamicsCompressor();
  glue.threshold.value = -20; glue.knee.value = 12; glue.ratio.value = 3; glue.attack.value = 0.008; glue.release.value = 0.25;
  glue.connect(limiter);
  A.master = g(opts.volume ?? 0.85);
  A.master.connect(glue);
  A.glue = glue; A.limiter = limiter;

  // reverbs
  A.airIn = g(1); A.hallIn = g(1);
  const air = ac.createConvolver(); air.buffer = makeIR(ac, 3.4, 2.6, 7000, 11);
  const hall = ac.createConvolver(); hall.buffer = makeIR(ac, 7.0, 5.5, 5200, 23, 0.035);
  A.airRet = g(0.55); A.hallRet = g(0.0);
  A.airIn.connect(air); air.connect(A.airRet); A.airRet.connect(A.master);
  A.hallIn.connect(hall); hall.connect(A.hallRet); A.hallRet.connect(A.master);

  // buses
  const bus = (vol, airSend, hallSend) => {
    const b = g(vol); b.connect(A.master);
    const s = g(airSend); b.connect(s); s.connect(A.airIn);
    const h = g(hallSend); b.connect(h); h.connect(A.hallIn);
    b.airSend = s; b.hallSend = h; return b;
  };
  A.music = bus(0.62, 0.55, 0.0);
  A.sfx = bus(0.9, 0.1, 0.0);
  A.ui = bus(0.5, 0.06, 0.0);
  A.ambBus = bus(0.8, 0.04, 0.0);
  // outdoor ambience goes through a muffle filter (sanctum interiors, underwater)
  A.muffle = ac.createBiquadFilter(); A.muffle.type = 'lowpass'; A.muffle.frequency.value = 20000; A.muffle.Q.value = 0.5;
  A.outdoor = g(1);
  A.outdoor.connect(A.muffle); A.muffle.connect(A.ambBus);
  A.amb = A.outdoor;

  // noise + textures (generated once)
  A.buf = {
    white: makeBuffer(ac, 5, 2, fillWhite),
    pink: makeBuffer(ac, 6, 2, fillPink),
    brown: makeBuffer(ac, 6, 2, fillBrown),
    rain: makeBuffer(ac, 4, 2, fillRain),
    crackle: makeBuffer(ac, 7, 1, fillCrackle),
    babble: makeBuffer(ac, 6, 2, fillBabble),
  };

  // --- helpers ------------------------------------------------------
  A.loop = (name, rate = 1, t = 0) => {
    const s = ac.createBufferSource(); s.buffer = A.buf[name]; s.loop = true; s.playbackRate.value = rate;
    s.start(t, A.rng() * (s.buffer.duration - 0.1));
    return s;
  };
  A.filter = (type, freq, q = 0.7, gain = 0) => {
    const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; if (gain) f.gain.value = gain; return f;
  };
  A.chain = (...nodes) => { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; };
  // short noise burst: returns {src, out} — out is a gain with an AD envelope
  A.burst = (t, dur, dest, o = {}) => {
    const s = ac.createBufferSource(); s.buffer = A.buf[o.noise || 'white']; s.playbackRate.value = o.rate || 1;
    const e = g(0);
    let node = s;
    if (o.hp) { const f = A.filter('highpass', o.hp, o.hpq || 0.7); node.connect(f); node = f; }
    if (o.bp) { const f = A.filter('bandpass', o.bp, o.q || 1); node.connect(f); node = f; if (o.bpTo) f.frequency.exponentialRampToValueAtTime(o.bpTo, t + (o.sweep || dur)); }
    if (o.lp) { const f = A.filter('lowpass', o.lp, o.lpq || 0.7); node.connect(f); node = f; if (o.lpTo) f.frequency.exponentialRampToValueAtTime(o.lpTo, t + (o.sweep || dur)); }
    node.connect(e); e.connect(dest);
    const a = o.attack ?? 0.002, peak = o.gain ?? 0.5;
    e.gain.setValueAtTime(0, t);
    e.gain.linearRampToValueAtTime(peak, t + a);
    if (o.shape === 'swell') { e.gain.linearRampToValueAtTime(peak * 0.0001 + 1e-5, t + dur); }
    else e.gain.setTargetAtTime(0, t + a, Math.max(0.003, (dur - a) / 4));
    s.start(t, A.rng() * 3); s.stop(t + dur + 0.05);
    return e;
  };
  // sine/osc tone with exponential decay
  A.tone = (t, freq, dur, dest, o = {}) => {
    const osc = ac.createOscillator(); osc.type = o.type || 'sine'; osc.frequency.setValueAtTime(freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + (o.glide || dur));
    if (o.detune) osc.detune.value = o.detune;
    const e = g(0);
    osc.connect(e); e.connect(dest);
    const a = o.attack ?? 0.003, peak = o.gain ?? 0.3;
    e.gain.setValueAtTime(0, t);
    e.gain.linearRampToValueAtTime(peak, t + a);
    e.gain.setTargetAtTime(0, t + a + (o.hold || 0), Math.max(0.003, (dur - a) / (o.curve || 4)));
    osc.start(t); osc.stop(t + a + (o.hold || 0) + dur + 0.1);
    return { osc, out: e };
  };
  A.panner = (x, y, z, o = {}) => {
    const p = ac.createPanner();
    p.panningModel = o.hrtf ? 'HRTF' : 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = o.ref ?? 4; p.maxDistance = o.max ?? 600; p.rolloffFactor = o.rolloff ?? 1.1;
    setPos(p, x, y, z, 0);
    return p;
  };
  A.setPos = setPos;
  // destination for a one-shot at a world position (or the bus directly when no position)
  A.at = (pos, bus = A.sfx, o) => {
    if (!pos) return bus;
    const p = A.panner(pos.x, pos.y, pos.z, o); p.connect(bus); return p;
  };
  A.stereo = (pan, dest) => { const p = ac.createStereoPanner(); p.pan.value = pan; p.connect(dest); return p; };

  // smoothed parameter writer that skips redundant automation events
  A.param = (p, tc = 0.15) => ({ p, v: p.value, tc, set(v, t) { if (Math.abs(v - this.v) > 1e-4 * (1 + Math.abs(v))) { this.v = v; this.p.setTargetAtTime(v, t, this.tc); } } });

  return A;
}

function setPos(p, x, y, z, t) {
  if (p.positionX) { p.positionX.setValueAtTime(x, t); p.positionY.setValueAtTime(y, t); p.positionZ.setValueAtTime(z, t); }
  else p.setPosition(x, y, z);
}
