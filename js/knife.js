// Karambit animations, keyframed in code after CS2's and played in the
// first-person view: draw, idle, alternating slashes, a heavy attack and an
// inspect. The knife pivots on its ring (the model's origin), so spins turn
// it around the finger the way a karambit is flipped.
//
// Knife space: the ring at the origin, the blade running toward -Y, the
// cutting edge (the inside of the curve) toward +X, the flats facing ±Z.
//
// The grip is CS2's: the index finger through the ring at the left of the
// fist, the blade coming out to the right and curling up at the tip, one
// flat toward the view. In a keyframe, `p` is where the ring sits in the
// viewmodel camera's space (x right, y up, -z ahead).
import * as THREE from '../vendor/three.module.min.js';

const TAU = Math.PI * 2;

// Keyframe positions are laid out for a hand 21 cm from the eye; HOLD
// pushes the whole hand out to where it holds a rifle's grip (about 38 cm),
// so the knife keeps its place on screen but shows at its real size next
// to the guns.
const HOLD = 1.8;

// The resting grip, as CS2 holds it: the fist low in the middle of the
// screen, palm down on the knife's flat, the ring (and the index finger
// through it) on the left, the blade lying flat and curving out forward to
// the right, its edge forward.
export const KNIFE_IDLE = { p: [0.014, -0.05, -0.17], blade: [1, 0, -0.5], face: [0, -1, -0.45] };

const I = KNIFE_IDLE;
const at = (dx, dy, dz) => [I.p[0] + dx, I.p[1] + dy, I.p[2] + dz];
const idle = (t) => ({ t, p: I.p });

// Grips other than the resting one, as { blade, face } like KNIFE_IDLE.
// Hanging: the knife dangles from the finger, blade down, mid-flip.
const HANG = { blade: [0.15, -1, 0.1], face: [0, 0, 1] };
// Turned blade-down at the end of the inspect, the flat half toward you.
const HANG_DOWN = { blade: [0.05, -1, -0.15], face: [0.45, 0, 1] };
// Pointing up out of the fist as it's drawn.
const POINT_UP = { blade: [-0.2, 1, -0.2], face: [0, 0, 1] };
// Upright: the fist raised, fingers curled round the upright handle toward
// you, the blade hanging below it and curving down to the left, its flat
// toward you (CS2's inspect); rocked a little each way as it's looked at.
const UPRIGHT = { blade: [-0.15, -1, 0.1], face: [0, 0, 1] };
const UPRIGHT_L = { blade: [-0.25, -1, 0.05], face: [-0.3, 0, 1] };
const UPRIGHT_R = { blade: [-0.05, -1, 0.15], face: [0.3, 0.05, 1] };
// Hammer grip up high: the blade pointing left from the top of the fist.
const RAISED = { blade: [-1, -0.25, 0.15], face: [0, 0, 1] };
const DRIVEN = { blade: [-0.5, -0.85, -0.3], face: [0.2, 0.3, 0.9] };

// Modelled on CS2's karambit. Each animation has hand keys and spins.
// A key gives the hand's place `p`, and either a `grip` or a `turn` of the
// resting grip about the camera's axes ([pitch, yaw, roll], radians); the
// hand moves on a smooth curve through the keys (no stop at each one), and
// comes to rest only at the ends and at keys marked `stop`. A spin turns the
// knife around the ring by `turns` between `from` and `to`, speeding up and
// slowing down once, so a flip reads as one continuous spin; `spinFrom` is
// where the knife starts, in radians. Spins end on whole turns, back in the
// grip.
export const KNIFE_ANIMS = {
  // Drawn, as in CS2 (0.75 s): the hand comes up from the bottom right with
  // the knife pointing up, flips it once round the finger, and drops into
  // the grip; the free hand comes in at the end.
  draw: {
    spinFrom: -TAU,
    spins: [{ from: 0.17, to: 0.43, turns: 1 }],
    away: [-1, 0, 0.42, 0.62],
    keys: [
      { t: 0, p: at(0.14, -0.2, 0.05), grip: POINT_UP },
      { t: 0.1, p: at(0.125, 0.0, 0.01), grip: POINT_UP },
      { t: 0.22, p: at(0.105, 0.04, 0), grip: POINT_UP },
      { t: 0.4, p: at(0.095, 0.03, 0), grip: HANG },
      { t: 0.52, p: at(0.06, 0.015, 0), turn: [0.3, -0.2, 0.4] },
      { t: 0.63, p: at(0.02, 0.003, 0), turn: [0.08, 0, 0.1] },
      idle(0.75),
    ],
  },
  // Backhand: dip to the lower left, whip across the screen to the right.
  slash: {
    keys: [
      idle(0),
      { t: 0.07, p: at(-0.12, -0.09, 0.03), turn: [0.3, 0.7, 0.4] },
      { t: 0.15, p: at(0, 0.02, -0.05), turn: [-0.1, 0, -0.2] },
      { t: 0.22, p: at(0.15, 0, -0.02), turn: [-0.2, -0.8, -0.5] },
      { t: 0.32, p: at(0.07, -0.12, 0.02), turn: [0.2, -0.3, -0.2] },
      idle(0.5),
    ],
  },
  // Forehand: the other way, right to left.
  slash2: {
    keys: [
      idle(0),
      { t: 0.07, p: at(0.1, -0.08, 0.03), turn: [0.3, -0.6, -0.3] },
      { t: 0.15, p: at(-0.01, 0.02, -0.05), turn: [-0.1, 0.2, 0.2] },
      { t: 0.22, p: at(-0.14, 0, -0.02), turn: [-0.2, 0.9, 0.4] },
      { t: 0.32, p: at(-0.06, -0.12, 0.02), turn: [0.2, 0.4, 0.2] },
      idle(0.5),
    ],
  },
  // Heavy: raise the fist high on the right, blade out to the left, then
  // drive it down through the middle and flip it back into the grip.
  stab: {
    spins: [{ from: 0.68, to: 1.08, turns: 1 }],
    keys: [
      idle(0),
      { t: 0.1, p: at(0.02, -0.12, 0.03), turn: [0.3, 0, -0.2] },
      { t: 0.28, p: at(0.1, 0.1, 0.03), grip: RAISED, stop: true },
      { t: 0.45, p: at(0.1, 0.11, 0.035), grip: RAISED, stop: true },
      { t: 0.58, p: at(-0.02, -0.02, -0.1), grip: DRIVEN },
      { t: 0.72, p: at(0.02, -0.03, -0.04), grip: DRIVEN },
      { t: 0.9, p: at(0.02, -0.005, -0.01), turn: [0, 0, 0.2] },
      idle(1.1),
    ],
  },
  // Inspect, as in CS2 (4.7 s): the free hand drops away; the knife hand
  // dips and twists, flips the knife up into the upright hold at the right
  // of the middle (fingers round the handle, the blade hanging down, its
  // flat toward you) and holds it there, rocking it to catch the light;
  // then turns it blade-down out to the right, spins it once round the
  // finger and drops back into the grip as the free hand comes back.
  inspect: {
    spins: [{ from: 0.45, to: 0.95, turns: -1 }, { from: 3.95, to: 4.35, turns: 1 }],
    away: [0.15, 0.45, 4.3, 4.6],
    keys: [
      idle(0),
      { t: 0.3, p: at(0.03, -0.03, 0.02), turn: [0.45, -0.3, -0.5] },
      { t: 0.6, p: at(0.06, 0.035, 0.01), grip: HANG },
      { t: 1.0, p: at(0.042, 0.058, 0.015), grip: UPRIGHT, stop: true },
      { t: 1.8, p: at(0.04, 0.055, 0.017), grip: UPRIGHT_L },
      { t: 2.7, p: at(0.044, 0.06, 0.015), grip: UPRIGHT_R },
      { t: 3.45, p: at(0.042, 0.057, 0.015), grip: UPRIGHT, stop: true },
      { t: 3.85, p: at(0.078, 0.052, 0.01), grip: HANG_DOWN, stop: true },
      { t: 4.2, p: at(0.072, 0.045, 0), grip: HANG },
      { t: 4.45, p: at(0.04, 0.004, 0), turn: [0.15, -0.1, 0.2] },
      idle(4.7),
    ],
  },
};

// The grip's orientation: the blade (local -Y) along `blade`, the knife's
// -Z flat toward `face`, the edge (local +X) following from those.
function orient(blade, face) {
  const y = new THREE.Vector3(blade[0], blade[1], blade[2]).normalize().negate();
  const z = new THREE.Vector3(face[0], face[1], face[2]);
  z.addScaledVector(y, -z.dot(y)).normalize().negate();
  const x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}
const IDLE_Q = orient(I.blade, I.face);

// A key's velocity on each axis: the mean of the slopes either side, or zero
// where the path turns back on that axis (so it never overshoots a key), at
// the ends, and at `stop` keys.
function velocities(keys, get) {
  return keys.map((k, i) => {
    const a = keys[i - 1];
    const c = keys[i + 1];
    const v = get(k).map(() => 0);
    if (!a || !c || k.stop) return v;
    return v.map((_, j) => {
      const s0 = (get(k)[j] - get(a)[j]) / (k.t - a.t);
      const s1 = (get(c)[j] - get(k)[j]) / (c.t - k.t);
      if (s0 * s1 <= 0) return 0;
      const m = (s0 + s1) / 2;
      return Math.sign(m) * Math.min(Math.abs(m), 3 * Math.abs(s0), 3 * Math.abs(s1));
    });
  });
}

// Work out each key's orientation (before the spin) and the velocities once.
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
for (const anim of Object.values(KNIFE_ANIMS)) {
  anim.spinFrom = anim.spinFrom || 0;
  anim.spins = anim.spins || [];
  let prev = null;
  for (const k of anim.keys) {
    let q;
    if (k.grip) q = orient(k.grip.blade, k.grip.face);
    else {
      const turn = k.turn || [0, 0, 0];
      q = new THREE.Quaternion().setFromEuler(_euler.set(turn[0], turn[1], turn[2], 'YXZ')).multiply(IDLE_Q);
    }
    // Keep neighbouring keys on the same side, so the hand turns the short way.
    if (prev && q.dot(prev) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
    k.q = [q.x, q.y, q.z, q.w];
    prev = q;
  }
  const vp = velocities(anim.keys, (k) => k.p);
  const vq = velocities(anim.keys, (k) => k.q);
  anim.keys.forEach((k, i) => { k.vp = vp[i]; k.vq = vq[i]; });
}

// How far the free hand has dropped out of view (0 in view .. 1 gone) at
// time `t` of animation `name`: an animation's `away` is [start going,
// gone, start coming back, back].
export function freeHandAway(name, t) {
  const anim = KNIFE_ANIMS[name];
  if (!anim || !anim.away) return 0;
  const [a, b, c, d] = anim.away;
  const s = (x) => x * x * (3 - 2 * x);
  if (t <= a || t >= d) return 0;
  if (t < b) return s((t - a) / (b - a));
  if (t <= c) return 1;
  return 1 - s((t - c) / (d - c));
}

export const knifeLength = (name) => {
  const anim = KNIFE_ANIMS[name];
  return anim ? anim.keys[anim.keys.length - 1].t : 0;
};

// Cubic Hermite between two keys.
function hermite(a, b, va, vb, dt, u, out) {
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  for (let j = 0; j < a.length; j++) out[j] = h00 * a[j] + h10 * dt * va[j] + h01 * b[j] + h11 * dt * vb[j];
  return out;
}

// Speeds up and slows down once (smootherstep), for spins.
const smoother = (u) => u * u * u * (u * (u * 6 - 15) + 10);

const _spin = new THREE.Quaternion();
const Z = new THREE.Vector3(0, 0, 1);
const _p = [0, 0, 0];
const _q = [0, 0, 0, 0];

// Pose of animation `name` at time `t` (seconds) into `pos` and `quat`.
// With no animation (or past its end) this is the resting grip. Returns how
// far the knife has spun round the ring (radians, 0 at rest), which the hand
// holding it doesn't follow.
export function sampleKnife(name, t, pos, quat) {
  const anim = KNIFE_ANIMS[name];
  const keys = anim && anim.keys;
  if (!keys || t >= keys[keys.length - 1].t) {
    pos.fromArray(I.p).multiplyScalar(HOLD);
    quat.copy(IDLE_Q);
    return 0;
  }
  t = Math.max(0, t);
  let i = 0;
  while (i < keys.length - 2 && t >= keys[i + 1].t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const dt = b.t - a.t;
  const u = Math.min(1, Math.max(0, (t - a.t) / dt));
  hermite(a.p, b.p, a.vp, b.vp, dt, u, _p);
  pos.set(_p[0], _p[1], _p[2]).multiplyScalar(HOLD);
  hermite(a.q, b.q, a.vq, b.vq, dt, u, _q);
  quat.set(_q[0], _q[1], _q[2], _q[3]).normalize();
  let spin = anim.spinFrom;
  for (const sp of anim.spins) spin += sp.turns * TAU * smoother(Math.min(1, Math.max(0, (t - sp.from) / (sp.to - sp.from))));
  if (spin % TAU) quat.multiply(_spin.setFromAxisAngle(Z, spin));
  return spin;
}
