// Procedural creature animation for the shared humanoid rig (Gnarl / Shellback / Stonewarden).
// Each frame a target pose (euler per bone + hips offset) is written from the creature's state
// and action, then the live pose eases toward it (snappier while attacking) and is applied
// to the bones. No allocations.
import { RIG, B } from './models.js';

const NB = RIG.length;
const S = Math.sin, C = Math.cos, PI = Math.PI;
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const bell = (a, b, c, x) => sm(a, b, x) * (1 - sm(b, c, x));

function set(o, b, x, y, z) { const k = b * 3; o[k] += x; o[k + 1] += y; o[k + 2] += z; }

// Action library. f(o, u, e) adds to the pose; u = 0..1 progress. `hit` = strike moment.
export const ACTIONS = {
  // overhead / diagonal weapon swing (right arm)
  swing: { dur: 1.0, hit: 0.62, f(o, u) {
    const w = sm(0.0, 0.5, u) * (1 - sm(0.62, 0.75, u)), s = sm(0.55, 0.66, u) * (1 - sm(0.8, 1.0, u));
    set(o, B.chest, -0.25 * w + 0.45 * s, 0.5 * w - 0.6 * s, 0);
    set(o, B.hips, 0, 0.2 * w - 0.25 * s, 0);
    set(o, B.uArmR, -2.6 * w - 1.0 * s, 0, -0.5 * w + 0.2 * s);
    set(o, B.fArmR, -0.9 * w + 0.1 * s, 0, 0);
    set(o, B.uArmL, -0.5 * w + 0.4 * s, 0, 0.5 * w);
    set(o, B.head, 0.1 * w - 0.1 * s, 0, 0);
    set(o, B.jaw, 0.35 * w, 0, 0);
    set(o, B.thighL, -0.4 * s, 0, 0); set(o, B.shinL, 0.4 * s, 0, 0);
    o[NB * 3 + 1] += -0.06 * s;
  } },
  thrust: { dur: 0.9, hit: 0.55, f(o, u) {
    const w = sm(0, 0.45, u) * (1 - sm(0.52, 0.6, u)), s = sm(0.5, 0.58, u) * (1 - sm(0.75, 1, u));
    set(o, B.chest, 0.3 * s, 0.6 * w - 0.4 * s, 0);
    set(o, B.uArmR, -0.9 - 0.4 * s, 0.4 * w, -0.2 + 0.2 * w);
    set(o, B.fArmR, -1.6 * w + 0.2 * s - 0.4 * (1 - s), 0, 0);
    set(o, B.uArmL, -1.1, 0, 0.2); set(o, B.fArmL, -0.8, 0, 0);
    set(o, B.thighL, -0.6 * s, 0, 0); set(o, B.shinL, 0.5 * s, 0, 0);
  } },
  // two-handed overhead slam (shellback, stonewarden)
  slam: { dur: 1.5, hit: 0.62, f(o, u) {
    const w = sm(0.0, 0.5, u) * (1 - sm(0.6, 0.66, u)), s = sm(0.58, 0.65, u) * (1 - sm(0.82, 1.0, u));
    set(o, B.chest, -0.45 * w + 0.7 * s, 0, 0);
    set(o, B.hips, -0.1 * w + 0.15 * s, 0, 0);
    for (const [ua, fa, sx] of [[B.uArmL, B.fArmL, 1], [B.uArmR, B.fArmR, -1]]) {
      set(o, ua, -2.8 * w - 0.6 * s, 0, 0.25 * sx * w - 0.15 * sx * s);
      set(o, fa, -0.6 * w + 0.1 * s, 0, 0);
    }
    set(o, B.head, 0.2 * w - 0.3 * s, 0, 0); set(o, B.jaw, 0.5 * w, 0, 0);
    set(o, B.thighL, -0.7 * s, 0, 0); set(o, B.shinL, 0.9 * s, 0, 0); set(o, B.thighR, 0.2 * s, 0, 0); set(o, B.shinR, 0.6 * s, 0, 0);
    o[NB * 3 + 1] += 0.06 * w - 0.22 * s;
  } },
  // side backhand sweep
  sweep: { dur: 1.2, hit: 0.55, f(o, u) {
    const w = sm(0.0, 0.45, u) * (1 - sm(0.55, 0.65, u)), s = sm(0.5, 0.62, u) * (1 - sm(0.8, 1.0, u));
    set(o, B.chest, 0.1, 0.9 * w - 1.1 * s, 0); set(o, B.hips, 0, 0.3 * w - 0.4 * s, 0);
    set(o, B.uArmR, -1.4, 0, 0.9 * w - 1.6 * s); set(o, B.fArmR, -0.3 * w, 0, 0);
    set(o, B.uArmL, -0.5, 0, 0.6);
    set(o, B.jaw, 0.4 * w, 0, 0);
  } },
  // head-down horn charge pose (held by the AI while charging)
  charge: { dur: 1.0, hold: true, f(o, u, e) {
    const ph = e.phase;
    set(o, B.chest, 0.6, 0, 0); set(o, B.head, 0.35, 0, 0); set(o, B.hips, 0.2, 0, 0);
    set(o, B.uArmL, 0.6 + S(ph) * 0.5, 0, 0.4); set(o, B.uArmR, 0.6 - S(ph) * 0.5, 0, -0.4);
  } },
  kick: { dur: 0.7, hit: 0.45, f(o, u) {
    const w = sm(0, 0.35, u) * (1 - sm(0.45, 0.5, u)), s = sm(0.42, 0.5, u) * (1 - sm(0.65, 1, u));
    set(o, B.thighR, 0.9 * w - 1.5 * s, 0, 0); set(o, B.shinR, 1.0 * w - 0.2 * s, 0, 0);
    set(o, B.chest, -0.2 * s, 0, 0); set(o, B.uArmL, -0.6 * s, 0, 0.8 * s); set(o, B.uArmR, 0.4 * s, 0, -0.9 * s);
  } },
  draw: { dur: 1.1, hit: 0.95, f(o, u) {   // bow: left arm points, right pulls the string
    const d = sm(0.1, 0.8, u), rel = sm(0.95, 1.0, u);
    set(o, B.chest, 0, 1.0, 0); set(o, B.head, 0, -0.9, 0); set(o, B.hips, 0, 0.2, 0);
    set(o, B.uArmL, -1.55, 0, 0.35); set(o, B.fArmL, -0.05, 0, 0);
    set(o, B.uArmR, -1.5, 0, -0.5 * d - 0.3 + 0.6 * rel); set(o, B.fArmR, -2.2 * d * (1 - rel) - 0.2, 0, 0);
  } },
  throw: { dur: 1.0, hit: 0.6, f(o, u) {
    const w = sm(0, 0.5, u) * (1 - sm(0.58, 0.65, u)), s = sm(0.55, 0.65, u) * (1 - sm(0.8, 1, u));
    set(o, B.chest, -0.4 * w + 0.5 * s, 0.4 * w - 0.4 * s, 0);
    set(o, B.uArmR, -2.8 * w - 1.2 * s, 0, -0.3); set(o, B.fArmR, -1.0 * w, 0, 0);
    set(o, B.uArmL, -1.2 * w, 0, 0.3);
  } },
  hit: { dur: 0.5, f(o, u) {
    const k = S(PI * sm(0, 1, u)) * (1 - u * 0.3);
    set(o, B.chest, -0.5 * k, 0.25 * k, 0.1 * k); set(o, B.head, -0.4 * k, 0, 0); set(o, B.jaw, 0.4 * k, 0, 0);
    set(o, B.uArmL, -0.6 * k, 0, 0.8 * k); set(o, B.uArmR, -0.6 * k, 0, -0.8 * k);
    o[NB * 3 + 2] += -0.08 * k;
  } },
  stagger: { dur: 1.3, f(o, u) {
    const k = sm(0, 0.15, u) * (1 - sm(0.75, 1, u)), wob = S(u * 18) * 0.15 * k;
    set(o, B.chest, -0.3 * k + wob, wob, 0.2 * k); set(o, B.head, -0.2 * k, wob * 2, 0.3 * k); set(o, B.jaw, 0.5 * k, 0, 0);
    set(o, B.uArmL, -0.3 * k, 0, 1.0 * k); set(o, B.uArmR, -0.3 * k, 0, -1.0 * k);
    set(o, B.thighL, -0.3 * k, 0, 0.2 * k); set(o, B.shinL, 0.5 * k, 0, 0);
    o[NB * 3 + 1] += -0.08 * k;
  } },
  alert: { dur: 0.75, f(o, u) {     // startled hop, arms up
    const j = S(PI * sm(0, 0.6, u)), k = bell(0, 0.2, 1, u);
    set(o, B.uArmL, -1.2 * k, 0, 1.1 * k); set(o, B.uArmR, -1.2 * k, 0, -1.1 * k);
    set(o, B.fArmL, -0.8 * k, 0, 0); set(o, B.fArmR, -0.8 * k, 0, 0);
    set(o, B.chest, -0.25 * k, 0, 0); set(o, B.head, -0.25 * k, 0, 0); set(o, B.jaw, 0.6 * k, 0, 0);
    set(o, B.thighL, -0.5 * j, 0, 0); set(o, B.shinL, 0.9 * j, 0, 0); set(o, B.thighR, -0.5 * j, 0, 0); set(o, B.shinR, 0.9 * j, 0, 0);
    o[NB * 3 + 1] += j * 0.32;
  } },
  roar: { dur: 1.6, f(o, u) {
    const k = bell(0, 0.2, 1, u), sh = S(u * 50) * 0.03 * k;
    set(o, B.chest, -0.4 * k, sh, 0); set(o, B.head, -0.5 * k, 0, sh); set(o, B.jaw, 0.8 * k, 0, 0);
    set(o, B.uArmL, -0.4 * k, 0, 1.3 * k); set(o, B.uArmR, -0.4 * k, 0, -1.3 * k);
    set(o, B.fArmL, -1.2 * k, 0, 0); set(o, B.fArmR, -1.2 * k, 0, 0);
  } },
  taunt: { dur: 1.4, f(o, u) {      // jeering hop from foot to foot, weapon raised
    const k = bell(0, 0.15, 1, u), h = S(u * PI * 4);
    set(o, B.uArmR, -2.4 * k, 0, -0.4 * k); set(o, B.uArmL, -0.5 * k, 0, 0.9 * k + h * 0.3 * k);
    set(o, B.thighL, -0.5 * Math.max(0, h) * k, 0, 0); set(o, B.shinL, 0.8 * Math.max(0, h) * k, 0, 0);
    set(o, B.thighR, -0.5 * Math.max(0, -h) * k, 0, 0); set(o, B.shinR, 0.8 * Math.max(0, -h) * k, 0, 0);
    set(o, B.jaw, (0.3 + 0.3 * Math.abs(h)) * k, 0, 0); set(o, B.head, -0.2 * k, h * 0.3 * k, 0);
    o[NB * 3 + 1] += Math.abs(h) * 0.12 * k;
  } },
  pickup: { dur: 0.9, hit: 0.5, f(o, u) {
    const k = bell(0, 0.45, 1, u);
    set(o, B.chest, 0.9 * k, 0, 0); set(o, B.hips, 0.3 * k, 0, 0);
    set(o, B.uArmR, -0.9 * k, 0, 0); set(o, B.thighL, -0.8 * k, 0, 0); set(o, B.shinL, 1.2 * k, 0, 0); set(o, B.thighR, -0.8 * k, 0, 0); set(o, B.shinR, 1.2 * k, 0, 0);
    o[NB * 3 + 1] += -0.18 * k;
  } },
  wake: { dur: 1.1, f(o, u) {
    const k = 1 - sm(0, 1, u);
    set(o, B.chest, 0.5 * k, 0, 0); set(o, B.head, 0.3 * k, S(u * 20) * 0.2 * k, 0);
    o[NB * 3 + 1] += -0.3 * k;
  } },
};

// base poses -------------------------------------------------------------
function idle(o, t, e) {
  const br = S(t * 2.1 + e.seed);
  set(o, B.chest, 0.08 + br * 0.03, S(t * 0.4 + e.seed) * 0.08, 0);
  set(o, B.head, -0.04 + br * 0.02, S(t * 0.33 + e.seed * 2) * 0.35, S(t * 0.21) * 0.05);
  set(o, B.jaw, 0.06 + Math.max(0, S(t * 0.7 + e.seed)) * 0.05, 0, 0);
  set(o, B.uArmL, 0.05 + br * 0.03, 0, 0.18); set(o, B.fArmL, -0.35, 0, 0);
  set(o, B.uArmR, 0.05 + br * 0.03, 0, -0.18); set(o, B.fArmR, -0.4, 0, 0);
  set(o, B.thighL, -0.12, 0, 0.1); set(o, B.shinL, 0.22, 0, 0);
  set(o, B.thighR, -0.12, 0, -0.1); set(o, B.shinR, 0.22, 0, 0);
  set(o, B.tail, S(t * 1.3 + e.seed) * 0.3, S(t * 0.9) * 0.4, 0);
  o[NB * 3 + 1] += -0.03 + br * 0.008;
}
function combatIdle(o, t, e) {  // crouched, weapon ready, bouncing
  const b = S(t * 5 + e.seed);
  set(o, B.chest, 0.28, -0.25, 0); set(o, B.hips, 0, 0.25, 0); set(o, B.head, -0.18, 0.25, 0);
  set(o, B.jaw, 0.15 + Math.max(0, b) * 0.1, 0, 0);
  set(o, B.uArmR, -0.7, 0, -0.35); set(o, B.fArmR, -1.0, 0, 0);
  set(o, B.uArmL, -0.5, 0, 0.45); set(o, B.fArmL, -0.9, 0, 0);
  set(o, B.thighL, -0.55, -0.25, 0.2); set(o, B.shinL, 0.75, 0, 0);
  set(o, B.thighR, -0.3, -0.25, -0.2); set(o, B.shinR, 0.6, 0, 0);
  set(o, B.tail, 0.3, S(t * 3) * 0.5, 0);
  o[NB * 3 + 1] += -0.07 + b * 0.015;
}
function locomotion(o, t, e) {
  const ph = e.phase, s = e.speedN;           // 0 walk .. 1 run
  const A = 0.55 + s * 0.4, K = 0.6 + s * 0.8;
  for (let sd = 0; sd < 2; sd++) {
    const th = sd ? B.thighR : B.thighL, sh = sd ? B.shinR : B.shinL;
    const pp = ph + sd * PI, sw = S(pp), fw = C(pp);
    set(o, th, -sw * A - 0.1 - s * 0.15, 0, (sd ? -1 : 1) * 0.08);
    set(o, sh, 0.15 + K * Math.max(0, fw), 0, 0);
  }
  const lean = 0.12 + s * 0.35;
  set(o, B.chest, lean, -S(ph) * 0.18, 0);
  set(o, B.hips, 0, S(ph) * 0.18, 0);
  set(o, B.head, -lean * 0.7, S(ph) * 0.1, 0);
  set(o, B.jaw, 0.1 + s * 0.15, 0, 0);
  set(o, B.uArmL, S(ph) * (0.5 + s * 0.4) + s * 0.2, 0, 0.2 + s * 0.2); set(o, B.fArmL, -0.4 - s * 0.6, 0, 0);
  set(o, B.uArmR, -S(ph) * (0.5 + s * 0.4) + s * 0.2 - (e.armed ? 0.3 : 0), 0, -0.2 - s * 0.2); set(o, B.fArmR, -0.45 - s * 0.6, 0, 0);
  set(o, B.tail, 0.2 + s * 0.4, S(ph) * 0.4, 0);
  o[NB * 3 + 1] += -Math.abs(C(ph)) * (0.03 + s * 0.05) + (s > 0.5 ? 0.02 : 0);
}
function sit(o, t, e) {
  const chew = Math.max(0, S(t * 9 + e.seed));
  const bite = sm(0.6, 0.8, (t * 0.18 + e.seed) % 1) * (1 - sm(0.9, 1, (t * 0.18 + e.seed) % 1));
  set(o, B.thighL, -1.45, 0, 0.25); set(o, B.shinL, 1.35, 0, 0);
  set(o, B.thighR, -1.45, 0, -0.25); set(o, B.shinR, 1.35, 0, 0);
  set(o, B.chest, 0.25 - bite * 0.1, S(t * 0.3 + e.seed) * 0.1, 0);
  set(o, B.head, 0.05 - bite * 0.2, S(t * 0.25 + e.seed) * 0.3 * (1 - bite), 0);
  set(o, B.jaw, chew * 0.25 + bite * 0.3, 0, 0);
  set(o, B.uArmR, -1.0 - bite * 0.5, 0, -0.1); set(o, B.fArmR, -1.2 - bite * 0.9, 0, 0);
  set(o, B.uArmL, -0.5, 0, 0.3); set(o, B.fArmL, -0.9, 0, 0);
  set(o, B.tail, -0.5, S(t * 1.5) * 0.2, 0);
  o[NB * 3 + 1] += -e.seatDrop;
}
function sleep(o, t, e) {     // sprawled on the back; model rotation lays the body down
  const br = S(t * 1.2 + e.seed);
  set(o, B.chest, br * 0.04, 0, 0); set(o, B.head, -0.25, 0.5, 0); set(o, B.jaw, 0.15 + br * 0.08, 0, 0);
  set(o, B.uArmL, -0.4, 0, 1.2); set(o, B.fArmL, -0.8, 0, 0);
  set(o, B.uArmR, 0.2, 0, -0.5 - br * 0.05); set(o, B.fArmR, -1.4, 0, 0);
  set(o, B.thighL, -0.6, 0, 0.45); set(o, B.shinL, 1.0, 0, 0);
  set(o, B.thighR, -0.2, 0, -0.25); set(o, B.shinR, 0.3, 0, 0);
}
function dormant(o, t, e) {   // stonewarden resting: hunched, arms on the ground, head down
  set(o, B.chest, 0.55, 0, 0); set(o, B.head, 0.5, 0, 0); set(o, B.hips, 0.1, 0, 0);
  set(o, B.uArmL, -0.5, 0, 0.25); set(o, B.fArmL, -0.2, 0, 0);
  set(o, B.uArmR, -0.5, 0, -0.25); set(o, B.fArmR, -0.2, 0, 0);
  set(o, B.thighL, -1.2, 0, 0.2); set(o, B.shinL, 1.6, 0, 0); set(o, B.thighR, -1.2, 0, -0.2); set(o, B.shinR, 1.6, 0, 0);
  o[NB * 3 + 1] += -e.seatDrop;
}
function limp(o, t, e) {      // ragdoll-ish: floppy limbs driven by the tumble
  const k = e.limp, w = e.wobble;
  set(o, B.chest, 0.3 * k + S(t * 9) * w, 0, 0); set(o, B.head, 0.5 * k + S(t * 11) * w, 0.4 * k, 0.3 * k); set(o, B.jaw, 0.6 * k, 0, 0);
  set(o, B.uArmL, -0.8 * k + S(t * 13) * w, 0, 1.3 * k); set(o, B.uArmR, -0.6 * k + S(t * 12 + 1) * w, 0, -1.4 * k);
  set(o, B.fArmL, -0.4 * k, 0, 0); set(o, B.fArmR, -0.6 * k, 0, 0);
  set(o, B.thighL, -0.7 * k + S(t * 10) * w, 0, 0.4 * k); set(o, B.shinL, 0.8 * k, 0, 0);
  set(o, B.thighR, -0.2 * k, 0, -0.3 * k); set(o, B.shinR, 0.4 * k, 0, 0);
}
function guardPose(o, t, e) {  // shellback blocking with forearms
  set(o, B.chest, 0.35, 0, 0); set(o, B.head, 0.3, 0, 0);
  set(o, B.uArmL, -1.2, 0.3, 0.1); set(o, B.fArmL, -1.6, 0, 0);
  set(o, B.uArmR, -1.2, -0.3, -0.1); set(o, B.fArmR, -1.6, 0, 0);
  set(o, B.thighL, -0.5, 0, 0.2); set(o, B.shinL, 0.7, 0, 0); set(o, B.thighR, -0.5, 0, -0.2); set(o, B.shinR, 0.7, 0, 0);
  o[NB * 3 + 1] += -0.12;
}
const BASE = { idle, combat: combatIdle, loco: locomotion, sit, sleep, dormant, limp, guard: guardPose };

export function createCreatureAnimator(c, opts = {}) {
  const cur = new Float32Array(NB * 3 + 3), tgt = new Float32Array(NB * 3 + 3);
  const amp = opts.amp ?? 1;
  const e = { phase: 0, speedN: 0, seed: opts.seed ?? 0, armed: false, seatDrop: opts.seatDrop ?? 0.32, limp: 0, wobble: 0, base: 'idle', baseW: 1 };
  let act = null, actT = 0, actDur = 1, actHeld = false;
  let prevBase = 'idle', blendT = 1;
  const prevBuf = new Float32Array(NB * 3 + 3);
  const hipsY = c.bones.hips.position.y, hipsZ = c.bones.hips.position.z;
  const bones = c.boneList;
  return {
    e, cur,
    play(name, speed = 1, hold = false) { act = ACTIONS[name]; if (!act) return 0; actT = 0; actDur = act.dur / speed; actHeld = hold; return actDur; },
    stop() { act = null; },
    get action() { return act; },
    get progress() { return act ? Math.min(1, actT / actDur) : 1; },
    get actionName() { if (!act) return null; for (const k in ACTIONS) if (ACTIONS[k] === act) return k; return null; },
    setBase(name) { if (name !== e.base) { prevBase = e.base; e.base = name; blendT = 0; } },
    update(dt, t) {
      tgt.fill(0);
      // cross-fade between base poses
      blendT = Math.min(1, blendT + dt * 4);
      if (blendT < 1) {
        prevBuf.fill(0); BASE[prevBase](prevBuf, t, e);
        BASE[e.base](tgt, t, e);
        const w = blendT * blendT * (3 - 2 * blendT);
        for (let i = 0; i < tgt.length; i++) tgt[i] = prevBuf[i] + (tgt[i] - prevBuf[i]) * w;
      } else BASE[e.base](tgt, t, e);
      if (act) {
        actT += dt;
        let u = actT / actDur;
        if (u >= 1) { if (actHeld) u = 1; else { act = null; u = 1; } }
        if (act) act.f(tgt, Math.min(u, 1), e);
      }
      const k = Math.min(1, dt * (act ? 22 : 12));
      for (let i = 0; i < cur.length; i++) cur[i] += (tgt[i] - cur[i]) * k;
      for (let i = 1; i < NB; i++) bones[i].rotation.set(cur[i * 3] * amp, cur[i * 3 + 1] * amp, cur[i * 3 + 2] * amp);
      c.bones.hips.position.y = hipsY + cur[NB * 3 + 1] * (opts.hipScale ?? 1);
      c.bones.hips.position.z = hipsZ + cur[NB * 3 + 2];
    },
  };
}
