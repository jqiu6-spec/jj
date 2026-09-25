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

// The resting grip: the ring a little right of centre and below the
// crosshair, the blade pointing right (a touch up and away), edge up.
export const KNIFE_IDLE = { p: [0.045, -0.032, -0.21], blade: [1, 0.12, -0.25], face: [0.1, -0.1, -1] };

const I = KNIFE_IDLE;
const at = (dx, dy, dz) => [I.p[0] + dx, I.p[1] + dy, I.p[2] + dz];
const idle = (t) => ({ t, p: I.p });

// Grips other than the resting one, as { blade, face } like KNIFE_IDLE.
// Hanging: the knife dangles from the finger, blade down, mid-flip.
const HANG = { blade: [0.15, -1, 0.1], face: [0, 0, 1] };
// Upright: the fist held up with its back to you, the blade curving down
// and round to the left, its flat toward you (CS2's inspect).
const UPRIGHT = { blade: [-0.5, -1, 0.15], face: [0, 0, 1] };
const UPRIGHT_TURNED = { blade: [-0.4, -1, 0.3], face: [0.4, 0, 0.9] };
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
  // Drawn: the hand comes up on the right with the knife flipping round the
  // finger, then drops into the grip.
  draw: {
    spinFrom: -TAU,
    spins: [{ from: 0.03, to: 0.55, turns: 1 }],
    keys: [
      { t: 0, p: at(0.08, -0.2, 0.05), turn: [0.3, 0, -0.6] },
      { t: 0.25, p: at(0.03, 0.035, 0), grip: HANG },
      { t: 0.45, p: at(0.02, 0.03, 0), grip: HANG },
      idle(0.85),
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
  // Inspect: a flip up into the upright hold in the middle of the screen,
  // a long look at the blade, a turn of the wrist, then a flip back down.
  inspect: {
    spins: [{ from: 0.2, to: 0.8, turns: -1 }, { from: 3.3, to: 3.95, turns: 1 }],
    keys: [
      idle(0),
      { t: 0.2, p: at(0, -0.02, 0.01), turn: [0.25, 0, -0.3] },
      { t: 0.45, p: at(0.03, 0.03, 0), grip: HANG },
      { t: 0.8, p: at(-0.01, 0.045, 0.02), grip: UPRIGHT, stop: true },
      { t: 1.8, p: at(-0.013, 0.043, 0.02), grip: UPRIGHT },
      { t: 2.9, p: at(-0.015, 0.04, 0.02), grip: UPRIGHT, stop: true },
      { t: 3.2, p: at(-0.01, 0.035, 0.02), grip: UPRIGHT_TURNED, stop: true },
      { t: 3.45, p: at(0.03, 0, 0), grip: HANG },
      { t: 3.75, p: at(0.01, -0.01, 0), turn: [0, 0, 0] },
      idle(4.0),
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
// With no animation (or past its end) this is the resting grip.
export function sampleKnife(name, t, pos, quat) {
  const anim = KNIFE_ANIMS[name];
  const keys = anim && anim.keys;
  if (!keys || t >= keys[keys.length - 1].t) {
    pos.fromArray(I.p).multiplyScalar(HOLD);
    quat.copy(IDLE_Q);
    return;
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
}
