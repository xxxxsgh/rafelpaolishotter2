// Procedural animation: every pose is a pure function writing per-bone Euler angles into a
// flat buffer; the animator cross-fades weighted layers, overlays one-shot actions on the
// upper body, then applies terrain foot correction and writes the bones. Zero allocations.
import { BONES } from './character.js';

const NB = BONES.length;
const I = Object.fromEntries(BONES.map((n, i) => [n, i]));
export const POSE_SIZE = NB * 3 + 3;          // euler xyz per bone + hips offset xyz
const HX = NB * 3;                           // hips offset slot
const UPPER = ['spine', 'chest', 'neck', 'head', 'uArmL', 'fArmL', 'handL', 'uArmR', 'fArmR', 'handR'].map(n => I[n]);
const ARM_R = ['uArmR', 'fArmR', 'handR'].map(n => I[n]);
const ARM_L = ['uArmL', 'fArmL', 'handL'].map(n => I[n]);

function set(o, b, x, y, z) { const k = I[b] * 3; o[k] += x; o[k + 1] += y || 0; o[k + 2] += z || 0; }
const S = Math.sin, Cc = Math.cos, mx = Math.max, PI = Math.PI;
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------------- base poses (all additive onto a zeroed buffer) ----------------
export const POSES = {
  idle(o, t, p) {
    const br = S(t * 1.7);                          // breathing
    set(o, 'spine', 0.02 + br * 0.012, S(t * 0.21) * 0.03, 0);
    set(o, 'chest', -0.03 + br * 0.018, 0, 0);
    set(o, 'neck', 0.02 - br * 0.01, S(t * 0.27) * 0.12, 0);
    set(o, 'head', 0.02 + S(t * 0.43) * 0.03, S(t * 0.31 + 1) * 0.14, S(t * 0.19) * 0.03);
    // relaxed weight on the right leg
    const sh = 0.5 + 0.5 * S(t * 0.25);
    o[HX] += 0.012 * (sh - 0.5) * 2; o[HX + 1] += -0.008 + br * 0.003;
    set(o, 'hips', 0, 0.04, -0.03 - sh * 0.02);
    set(o, 'thighL', -0.05, 0.06, 0.05); set(o, 'shinL', 0.14, 0, 0); set(o, 'footL', -0.08, 0, -0.03);
    set(o, 'thighR', 0.03, -0.1, -0.03 + sh * 0.02); set(o, 'shinR', 0.05, 0, 0); set(o, 'footR', -0.04, 0, 0.02);
    set(o, 'uArmL', 0.04 + br * 0.02, 0, 0.12 + br * 0.015); set(o, 'fArmL', -0.22, 0, 0); set(o, 'handL', 0, -0.2, 0.08);
    set(o, 'uArmR', 0.02 + br * 0.02, 0, -0.12 - br * 0.015); set(o, 'fArmR', -0.3, 0, 0); set(o, 'handR', 0, 0.2, -0.08);
  },
  // speedN: 0 walk, 1 run, 2 sprint (continuous)
  locomotion(o, t, p) {
    const ph = p.phase, s = p.speedN;
    const run = sm(0.0, 1.0, s), spr = sm(1.0, 2.0, s);
    const A = 0.4 + run * 0.22 + spr * 0.2;            // thigh swing
    const Ks = 0.75 + run * 0.95 + spr * 0.5;          // knee flex in swing
    const Kb = 0.08 + run * 0.18;
    const lean = 0.04 + run * 0.12 + spr * 0.2 + p.accel * 0.08;
    for (let sd = 0; sd < 2; sd++) {
      const L = sd === 0 ? 'L' : 'R', pp = ph + sd * PI;
      const sw = S(pp), fw = Cc(pp);
      set(o, 'thigh' + L, -sw * A - lean * 0.6 - run * 0.08, 0, 0);
      set(o, 'shin' + L, Kb + Ks * Math.pow(mx(0, fw), 1.4) + 0.15 * mx(0, -fw) * run, 0, 0);
      set(o, 'foot' + L, sw * 0.25 - Ks * 0.25 * mx(0, fw) + 0.35 * mx(0, -sw) * mx(0, -fw) * (0.5 + run), 0, 0);
    }
    const bob = 0.022 + run * 0.02;
    o[HX + 1] += (1 - run) * bob * Cc(2 * ph) - run * bob * Cc(2 * ph) - run * 0.05 - spr * 0.02;
    o[HX] += S(ph) * 0.012 * (1 - run * 0.5);
    set(o, 'hips', 0, S(ph) * (0.14 + run * 0.06), Cc(2 * ph) * 0.03 * (1 - run));
    set(o, 'spine', lean, -S(ph) * 0.1, 0);
    set(o, 'chest', lean * 0.5 + S(2 * ph) * 0.02 * run, -S(ph) * (0.14 + run * 0.08), 0);
    set(o, 'neck', -lean * 0.6, S(ph) * 0.12, 0);
    set(o, 'head', -lean * 0.5 + S(2 * ph) * 0.02, S(ph) * 0.06, 0);
    const AA = 0.42 + run * 0.18 + spr * 0.3;
    const eb = 0.25 + run * 1.05 + spr * 0.25;
    set(o, 'uArmL', S(ph) * AA + run * 0.28, 0, 0.1 + run * 0.12);
    set(o, 'fArmL', -(eb + (0.25 + run * 0.2) * mx(0, -S(ph))), 0, 0);
    set(o, 'uArmR', -S(ph) * AA + run * 0.28, 0, -0.1 - run * 0.12);
    set(o, 'fArmR', -(eb + (0.25 + run * 0.2) * mx(0, S(ph))), 0, 0);
    set(o, 'handL', 0, -0.3, 0); set(o, 'handR', 0, 0.3, 0);
  },
  crouch(o, t, p) {
    const ph = p.phase, m = p.move;
    o[HX + 1] += -0.24; o[HX + 2] += -0.04;
    for (let sd = 0; sd < 2; sd++) {
      const L = sd === 0 ? 'L' : 'R', pp = ph + sd * PI, sw = S(pp) * m, fw = Cc(pp) * m;
      set(o, 'thigh' + L, -1.0 - sw * 0.4, 0, (sd ? -1 : 1) * 0.12);
      set(o, 'shin' + L, 1.55 + mx(0, fw) * 0.45, 0, 0);
      set(o, 'foot' + L, -0.55 + sw * 0.2, 0, 0);
    }
    set(o, 'hips', 0.0, S(ph) * 0.1 * m, 0);
    set(o, 'spine', 0.4, 0, 0); set(o, 'chest', 0.15, 0, 0);
    set(o, 'neck', -0.3, 0, 0); set(o, 'head', -0.2, S(t * 0.6) * 0.25 * (1 - m), 0);
    set(o, 'uArmL', -0.35 + S(ph) * 0.2 * m, 0, 0.2); set(o, 'fArmL', -0.9, 0, 0);
    set(o, 'uArmR', -0.35 - S(ph) * 0.2 * m, 0, -0.2); set(o, 'fArmR', -0.9, 0, 0);
  },
  jump(o, t, p) {
    const up = sm(-4, 3, p.vy);
    set(o, 'thighL', -0.95 * up - 0.3, 0, 0.06); set(o, 'shinL', 1.35 * up + 0.4, 0, 0); set(o, 'footL', -0.3, 0, 0);
    set(o, 'thighR', 0.15 * up - 0.25, 0, -0.06); set(o, 'shinR', 0.6 + 0.3 * up, 0, 0); set(o, 'footR', 0.2, 0, 0);
    set(o, 'spine', 0.08, 0, 0); set(o, 'neck', -0.05, 0, 0);
    set(o, 'uArmL', -0.7 * up - 0.1, 0, 0.45); set(o, 'fArmL', -0.6, 0, 0);
    set(o, 'uArmR', 0.4 * up - 0.2, 0, -0.45); set(o, 'fArmR', -0.7, 0, 0);
  },
  fall(o, t, p) {
    const f = sm(0, 1.2, p.airT);
    set(o, 'thighL', -0.45 + S(t * 6) * 0.15 * f, 0, 0.1); set(o, 'shinL', 0.7 + S(t * 6 + 1) * 0.2 * f, 0, 0);
    set(o, 'thighR', -0.1 - S(t * 6) * 0.15 * f, 0, -0.1); set(o, 'shinR', 0.5 + S(t * 6 + 2) * 0.2 * f, 0, 0);
    set(o, 'footL', -0.3, 0, 0); set(o, 'footR', -0.3, 0, 0);
    set(o, 'spine', -0.1, 0, 0); set(o, 'neck', 0.15, 0, 0); set(o, 'head', 0.15, 0, 0);
    set(o, 'uArmL', -0.4 + S(t * 7) * 0.2 * f, 0, 1.05 + S(t * 5) * 0.15 * f); set(o, 'fArmL', -0.45, 0, 0);
    set(o, 'uArmR', -0.4 - S(t * 7) * 0.2 * f, 0, -1.05 - S(t * 5 + 1) * 0.15 * f); set(o, 'fArmR', -0.45, 0, 0);
  },
  glide(o, t, p) {
    const sw = S(t * 1.6), b = p.bank || 0;
    set(o, 'uArmL', -2.85, 0, -0.1 + b * 0.1); set(o, 'fArmL', -0.32, 0, 0); set(o, 'handL', -0.3, 0, 0);
    set(o, 'uArmR', -2.85, 0, 0.1 + b * 0.1); set(o, 'fArmR', -0.32, 0, 0); set(o, 'handR', -0.3, 0, 0);
    set(o, 'spine', -0.08, 0, b * 0.15); set(o, 'chest', -0.12, 0, 0);
    set(o, 'neck', 0.05, -b * 0.2, 0); set(o, 'head', 0.1, -b * 0.3, 0);
    set(o, 'thighL', 0.2 + sw * 0.12, 0, 0.03); set(o, 'shinL', 0.45 + S(t * 1.6 + 0.8) * 0.15, 0, 0); set(o, 'footL', 0.45, 0, 0);
    set(o, 'thighR', 0.08 - sw * 0.12, 0, -0.03); set(o, 'shinR', 0.6 + S(t * 1.6 + 2.4) * 0.15, 0, 0); set(o, 'footR', 0.5, 0, 0);
    o[HX + 1] += -0.02;
  },
  climb(o, t, p) {
    const ph = p.phase, m = p.move;
    const a = S(ph), c = Cc(ph);
    const hang = 1 - m;
    // alternate reaching hands; idle hang breathes
    set(o, 'uArmL', -2.45 - a * 0.45 * m - hang * 0.05 * S(t * 1.5), 0, 0.42 - a * 0.1 * m);
    set(o, 'fArmL', -0.55 - mx(0, a) * 0.6 * m - hang * 0.2, 0, 0);
    set(o, 'handL', -0.6, 0, 0);
    set(o, 'uArmR', -2.45 + a * 0.45 * m - hang * 0.05 * S(t * 1.5 + 1), 0, -0.42 - a * 0.1 * m);
    set(o, 'fArmR', -0.55 - mx(0, -a) * 0.6 * m - hang * 0.2, 0, 0);
    set(o, 'handR', -0.6, 0, 0);
    set(o, 'thighL', -0.75 + a * 0.5 * m, 0, 0.32); set(o, 'shinL', 1.25 - a * 0.45 * m, 0, 0); set(o, 'footL', -0.35, 0, 0);
    set(o, 'thighR', -0.75 - a * 0.5 * m, 0, -0.32); set(o, 'shinR', 1.25 + a * 0.45 * m, 0, 0); set(o, 'footR', -0.35, 0, 0);
    set(o, 'spine', -0.05, a * 0.08 * m, c * 0.05 * m); set(o, 'chest', -0.1, 0, 0);
    set(o, 'neck', -0.35, p.look * 0.4, 0); set(o, 'head', -0.25, p.look * 0.3, 0);
    o[HX + 2] += -0.06; o[HX + 1] += -0.05 + c * 0.03 * m;
    set(o, 'hips', 0, -a * 0.12 * m, 0);
  },
  swim(o, t, p) {
    const ph = p.phase, m = p.move;
    const a = S(ph);
    // moving: freestyle-ish crawl; idle: treading water with sculling arms
    set(o, 'uArmL', (-1.6 - a * 1.5) * m + (-0.3) * (1 - m), 0, 0.35 * m + (1.1 + S(t * 2.4) * 0.25) * (1 - m));
    set(o, 'fArmL', -0.35 - mx(0, a) * 0.6 * m - 0.6 * (1 - m), S(t * 2.4) * 0.4 * (1 - m), 0);
    set(o, 'uArmR', (-1.6 + a * 1.5) * m + (-0.3) * (1 - m), 0, -0.35 * m - (1.1 + S(t * 2.4) * 0.25) * (1 - m));
    set(o, 'fArmR', -0.35 - mx(0, -a) * 0.6 * m - 0.6 * (1 - m), -S(t * 2.4) * 0.4 * (1 - m), 0);
    const k = S(ph * 2.0);
    set(o, 'thighL', 0.15 * k * m - 0.45 * (1 - m) * (0.5 + 0.5 * S(t * 2.4)), 0, 0.08);
    set(o, 'shinL', 0.3 + 0.25 * mx(0, k) * m + 0.6 * (1 - m), 0, 0);
    set(o, 'thighR', -0.15 * k * m - 0.45 * (1 - m) * (0.5 + 0.5 * S(t * 2.4 + PI)), 0, -0.08);
    set(o, 'shinR', 0.3 + 0.25 * mx(0, -k) * m + 0.6 * (1 - m), 0, 0);
    set(o, 'footL', 0.6 * m, 0, 0); set(o, 'footR', 0.6 * m, 0, 0);
    set(o, 'neck', -0.5 * m, a * 0.25 * m, 0); set(o, 'head', -0.45 * m, 0, 0);
    set(o, 'spine', 0, a * 0.15 * m, 0); set(o, 'hips', 0, -a * 0.15 * m, 0);
  },
  sit(o, t) {
    const br = S(t * 1.5);
    o[HX + 1] += -0.73; o[HX + 2] += -0.05;
    set(o, 'thighL', -2.0, 0.1, 0.2); set(o, 'shinL', 2.45, 0, 0); set(o, 'footL', -0.4, 0, 0);
    set(o, 'thighR', -1.75, -0.15, -0.35); set(o, 'shinR', 2.0, 0, 0); set(o, 'footR', -0.2, 0, 0);
    set(o, 'spine', 0.25 + br * 0.01, 0, 0); set(o, 'chest', 0.12 + br * 0.015, 0, 0);
    set(o, 'neck', -0.1, 0.25 + S(t * 0.3) * 0.15, 0); set(o, 'head', -0.05, 0.1, 0);
    set(o, 'uArmL', -0.95, 0, 0.1); set(o, 'fArmL', -0.75, 0.3, 0);
    set(o, 'uArmR', -0.5, 0, -0.3); set(o, 'fArmR', -0.55, 0, 0);
  },
  kneel(o, t) {
    o[HX + 1] += -0.45; o[HX + 2] += 0.02;
    set(o, 'thighL', -1.45, 0, 0.12); set(o, 'shinL', 1.55, 0, 0); set(o, 'footL', -0.1, 0, 0);
    set(o, 'thighR', 0.05, 0, -0.1); set(o, 'shinR', 1.6, 0, 0); set(o, 'footR', 0.7, 0, 0);
    set(o, 'spine', 0.35, 0, 0); set(o, 'chest', 0.15, 0, 0); set(o, 'neck', -0.15, 0, 0); set(o, 'head', 0.2, 0, 0);
    const st = S(t * 2.2);
    set(o, 'uArmL', -0.95, 0, 0.1); set(o, 'fArmL', -0.9, 0, 0);
    set(o, 'uArmR', -1.0 + st * 0.12, 0, -0.25); set(o, 'fArmR', -0.8 - st * 0.15, 0, 0);
  },
  guard(o, t, p) {
    const br = S(t * 2.2);
    o[HX + 1] += -0.07 + br * 0.004;
    set(o, 'hips', 0, 0.35, 0);
    set(o, 'thighL', -0.4, -0.3, 0.14); set(o, 'shinL', 0.5, 0, 0); set(o, 'footL', -0.1, -0.1, 0);
    set(o, 'thighR', 0.25, -0.3, -0.14); set(o, 'shinR', 0.45, 0, 0); set(o, 'footR', -0.1, 0.3, 0);
    set(o, 'spine', 0.1, -0.15, 0); set(o, 'chest', 0.06 + br * 0.01, -0.2, 0);
    set(o, 'neck', -0.08, 0.25, 0); set(o, 'head', 0, 0.12, 0);
    set(o, 'uArmL', -0.9, 0, 0.35); set(o, 'fArmL', -1.35, 0, 0); set(o, 'handL', 0, -0.4, 0);
    set(o, 'uArmR', -0.55, 0, -0.45); set(o, 'fArmR', -0.95, 0, 0); set(o, 'handR', 0.4, 0, 0);
  },
  look(o, t) {   // gazing up at something (shrines, vistas)
    POSES.idle(o, t);
    set(o, 'neck', -0.2, 0.1, 0); set(o, 'head', -0.25, 0.15, 0); set(o, 'chest', -0.05, 0.1, 0);
  },
};

// ---------------- one-shot actions (upper body overlay unless full) ----------------
// f(o, t01) writes an absolute upper-body pose; env weight handled by animator.
export const ACTIONS = {
  attack: { dur: 0.5, mask: 'upper', f(o, u) {     // horizontal slash right->left
    const w = sm(0, 0.3, u), s = sm(0.3, 0.55, u);
    set(o, 'spine', 0.1, -0.5 * w + 1.0 * s, 0); set(o, 'chest', 0.05, -0.4 * w + 0.7 * s, 0);
    set(o, 'uArmR', -1.5 + 0.2 * s, 0, -1.25 * w + 1.6 * s); set(o, 'fArmR', -1.3 * w + 1.1 * s - 0.2, 0, 0);
    set(o, 'handR', 0, 0, -0.4 * w + 0.6 * s);
    set(o, 'uArmL', -0.6, 0, 0.35); set(o, 'fArmL', -1.2, 0, 0);
    set(o, 'neck', 0, 0.3 * w - 0.5 * s, 0);
  } },
  attack2: { dur: 0.5, mask: 'upper', f(o, u) {    // backhand left->right
    const w = sm(0, 0.28, u), s = sm(0.28, 0.55, u);
    set(o, 'spine', 0.1, 0.5 * w - 1.0 * s, 0); set(o, 'chest', 0.05, 0.4 * w - 0.7 * s, 0);
    set(o, 'uArmR', -1.45, 0, 0.5 * w - 1.7 * s); set(o, 'fArmR', -1.4 * w + 1.2 * s - 0.2, 0, 0);
    set(o, 'uArmL', -0.5, 0, 0.4); set(o, 'fArmL', -1.1, 0, 0);
  } },
  attack3: { dur: 0.65, mask: 'full', f(o, u) {    // overhead chop
    const w = sm(0, 0.35, u), s = sm(0.35, 0.55, u);
    set(o, 'spine', -0.2 * w + 0.6 * s, 0, 0); set(o, 'chest', -0.1 * w + 0.3 * s, 0, 0);
    set(o, 'uArmR', -2.9 * w + 1.6 * s, 0, -0.2); set(o, 'fArmR', -0.6 * w + 0.4 * s, 0, 0);
    set(o, 'uArmL', -2.6 * w + 1.5 * s, 0, 0.2); set(o, 'fArmL', -0.7 * w + 0.4 * s, 0, 0);
    set(o, 'thighL', -0.5 * s, 0, 0.1); set(o, 'shinL', 0.6 * s, 0, 0); set(o, 'thighR', 0.3 * s, 0, -0.1); set(o, 'shinR', 0.5 * s, 0, 0);
    o[HX + 1] += -0.12 * s;
  } },
  spin: { dur: 0.7, mask: 'upper', f(o, u) {
    set(o, 'uArmR', -1.55, 0, -1.4); set(o, 'fArmR', -0.15, 0, 0);
    set(o, 'uArmL', -0.6, 0, 0.9); set(o, 'fArmL', -0.6, 0, 0);
    set(o, 'spine', 0.15, 0, 0);
  } },
  thrust: { dur: 0.45, mask: 'upper', f(o, u) {
    const w = sm(0, 0.3, u), s = sm(0.3, 0.45, u);
    set(o, 'spine', 0.05 + 0.2 * s, -0.3 * w + 0.4 * s, 0);
    set(o, 'uArmR', -0.6 - 0.9 * s, 0, -0.2); set(o, 'fArmR', -1.6 * w + 1.5 * s, 0, 0);
    set(o, 'uArmL', -0.4, 0, 0.3); set(o, 'fArmL', -1.0, 0, 0);
  } },
  shield: { dur: 0.35, mask: 'upper', hold: true, f(o, u) {
    set(o, 'uArmL', -1.35, 0.2, 0.15); set(o, 'fArmL', -1.45, 0, 0); set(o, 'handL', 0, -1.0, 0);
    set(o, 'spine', 0.15, 0, 0); set(o, 'chest', 0.08, -0.2, 0);
    set(o, 'uArmR', -0.5, 0, -0.4); set(o, 'fArmR', -0.9, 0, 0);
  } },
  bash: { dur: 0.4, mask: 'upper', f(o, u) {
    const s = sm(0.1, 0.3, u) * (1 - sm(0.6, 1, u));
    set(o, 'uArmL', -1.35 - 0.3 * s, 0.2, 0.15); set(o, 'fArmL', -1.45 + 0.8 * s, 0, 0); set(o, 'handL', 0, -1.0, 0);
    set(o, 'spine', 0.15 + 0.2 * s, 0, 0);
    set(o, 'uArmR', -0.5, 0, -0.4); set(o, 'fArmR', -0.9, 0, 0);
  } },
  bow: { dur: 0.6, mask: 'upper', hold: true, f(o, u) {
    const d = sm(0, 0.8, u);
    set(o, 'chest', 0, 0.9, 0); set(o, 'neck', 0, -0.75, 0); set(o, 'head', 0, -0.15, 0);
    set(o, 'uArmL', -1.55, 0, 0.25); set(o, 'fArmL', -0.05, 0, 0);
    set(o, 'uArmR', -1.6, 0, -0.6 * d - 0.2); set(o, 'fArmR', -2.0 * d - 0.3, 0, 0);
  } },
  throw: { dur: 0.55, mask: 'upper', f(o, u) {
    const w = sm(0, 0.4, u), s = sm(0.4, 0.6, u);
    set(o, 'chest', 0, -0.5 * w + 0.8 * s, 0); set(o, 'spine', -0.1 * w + 0.3 * s, 0, 0);
    set(o, 'uArmR', -2.6 * w + 1.4 * s, 0, -0.4); set(o, 'fArmR', -1.2 * w + 1.0 * s, 0, 0);
    set(o, 'uArmL', -0.9 * w, 0, 0.4); set(o, 'fArmL', -0.6, 0, 0);
  } },
  hit: { dur: 0.45, mask: 'full', f(o, u) {
    const k = S(PI * sm(0, 1, u)) ;
    set(o, 'spine', -0.35 * k, 0.2 * k, 0); set(o, 'chest', -0.2 * k, 0, 0); set(o, 'neck', 0.3 * k, 0, 0); set(o, 'head', 0.25 * k, 0, 0);
    set(o, 'uArmL', -0.4 * k, 0, 0.6 * k); set(o, 'uArmR', -0.4 * k, 0, -0.6 * k);
    o[HX + 2] += -0.05 * k;
  } },
  eat: { dur: 1.4, mask: 'upper', f(o, u) {
    const r = sm(0, 0.25, u) * (1 - sm(0.8, 1, u)), ch = S(u * 30) * 0.05 * r;
    set(o, 'uArmR', -1.1 * r, 0, -0.1); set(o, 'fArmR', -2.0 * r, 0, 0); set(o, 'handR', 0, 0.3 * r, 0);
    set(o, 'neck', 0.1 * r + ch, 0, 0); set(o, 'head', 0.1 * r, 0, 0);
  } },
  interact: { dur: 0.8, mask: 'full', f(o, u) {
    const r = S(PI * sm(0, 1, u));
    set(o, 'spine', 0.6 * r, 0, 0); set(o, 'chest', 0.2 * r, 0, 0); set(o, 'neck', -0.3 * r, 0, 0);
    set(o, 'uArmR', -1.0 * r, 0, -0.1); set(o, 'fArmR', -0.3 * r, 0, 0);
    set(o, 'thighL', -0.6 * r, 0, 0); set(o, 'shinL', 1.0 * r, 0, 0); set(o, 'thighR', -0.6 * r, 0, 0); set(o, 'shinR', 1.0 * r, 0, 0);
    o[HX + 1] += -0.18 * r;
  } },
  wave: { dur: 1.4, mask: 'upper', f(o, u) {
    const r = sm(0, 0.2, u) * (1 - sm(0.8, 1, u));
    set(o, 'uArmR', -0.3 * r, 0, -2.5 * r); set(o, 'fArmR', -0.4 * r, 0, S(u * 25) * 0.4 * r);
    set(o, 'neck', 0, -0.2 * r, 0);
  } },
  cook: { dur: 1.6, mask: 'upper', f(o, u) {
    const st = S(u * 14);
    set(o, 'uArmR', -1.0 + st * 0.15, 0, -0.25); set(o, 'fArmR', -0.8 - st * 0.2, st * 0.2, 0);
    set(o, 'uArmL', -0.9, 0, 0.2); set(o, 'fArmL', -1.0, 0, 0);
  } },
};
ACTIONS.slash = ACTIONS.attack;
ACTIONS.swing = ACTIONS.attack;
ACTIONS.attack1 = ACTIONS.attack;

export function createAnimator(rig) {
  const B = BONES.map(n => rig.bones[n]);
  const bindHips = rig.bones.hips.position.clone();
  const out = new Float32Array(POSE_SIZE), tmp = new Float32Array(POSE_SIZE), act = new Float32Array(POSE_SIZE);
  const layers = {};            // name -> {w, target, rate}
  for (const k of Object.keys(POSES)) layers[k] = { w: 0, target: 0, rate: 8 };
  layers.idle.w = layers.idle.target = 1;
  let action = null, actT = 0, actW = 0, actHold = false, actRelease = false;
  const params = { phase: 0, speedN: 0, accel: 0, move: 0, vy: 0, airT: 0, bank: 0, look: 0 };

  function setLayer(name, rate) {   // exclusive target
    for (const k in layers) layers[k].target = k === name ? 1 : 0;
    if (rate) for (const k in layers) layers[k].rate = rate;
  }
  function play(name, opts = {}) {
    const a = ACTIONS[name];
    if (!a) return 0;
    action = a; actT = 0; actHold = !!(a.hold && opts.hold !== false); actRelease = false;
    if (opts.speed) action = { ...a, dur: a.dur / opts.speed };
    return action.dur;
  }
  function release() { actRelease = true; }

  function update(dt, t, footLift) {
    out.fill(0);
    let wsum = 0;
    for (const k in layers) {
      const L = layers[k];
      L.w += (L.target - L.w) * Math.min(1, dt * L.rate);
      if (L.w < 0.002 && L.target === 0) { L.w = 0; continue; }
      tmp.fill(0);
      POSES[k](tmp, t, params);
      for (let i = 0; i < POSE_SIZE; i++) out[i] += tmp[i] * L.w;
      wsum += L.w;
    }
    if (wsum > 0 && Math.abs(wsum - 1) > 1e-3) for (let i = 0; i < POSE_SIZE; i++) out[i] /= wsum;
    // action overlay
    if (action) {
      actT += dt;
      let u = actT / action.dur;
      if (actHold && !actRelease) u = Math.min(u, 0.999);
      const fadeIn = Math.min(1, actT / 0.08);
      const fadeOut = actHold && !actRelease ? 1 : 1 - sm(0.8, 1.0, u);
      actW = fadeIn * fadeOut;
      act.fill(0);
      action.f(act, Math.min(u, 1));
      const bones = action.mask === 'full' ? null : UPPER;
      if (bones) {
        for (const bi of bones) for (let c = 0; c < 3; c++) { const k = bi * 3 + c; out[k] += (act[k] - out[k]) * actW; }
      } else for (let k = 0; k < POSE_SIZE; k++) out[k] += (act[k] - out[k]) * actW * (k >= HX ? 1 : 1);
      if (u >= 1 && (!actHold || actRelease)) action = null;
    }
    // terrain foot correction: raise a foot by bending its knee (cheap analytic 2-bone IK)
    if (footLift) {
      for (let sd = 0; sd < 2; sd++) {
        const e = footLift[sd];
        if (e <= 0.001) continue;
        const Lg = 0.41;
        const c = Math.max(-1, Math.min(1, 1 - e / (2 * Lg) * 1.0));
        const a = Math.acos(c);
        const th = I[sd ? 'thighR' : 'thighL'] * 3, sh = I[sd ? 'shinR' : 'shinL'] * 3, ft = I[sd ? 'footR' : 'footL'] * 3;
        out[th] -= a; out[sh] += 2 * a; out[ft] -= a;
      }
    }
    for (let i = 0; i < B.length; i++) B[i].rotation.set(out[i * 3], out[i * 3 + 1], out[i * 3 + 2]);
    rig.bones.hips.position.set(bindHips.x + out[HX], bindHips.y + out[HX + 1], bindHips.z + out[HX + 2]);
  }
  return {
    params, layers, setLayer, play, release, update,
    get action() { return action; },
    get actionProgress() { return action ? actT / action.dur : 1; },
    snap() { for (const k in layers) layers[k].w = layers[k].target; },
  };
}
