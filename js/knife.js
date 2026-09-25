// Karambit animations, keyframed in code and played in the first-person
// view: draw, idle, alternating slashes, a heavy stab and an inspect. The
// knife pivots on its ring (the model's origin), so spins turn it around the
// finger the way a karambit is flipped.
//
// Knife space: the ring at the origin, the blade running toward -Y, the
// cutting edge (the inside of the curve) toward +X, the flats facing ±Z.
//
// The grip is CS2's: the index finger through the ring at the left of the
// fist, the blade coming out to the right and curling up at the tip, one
// flat toward the view. Every keyframe is that grip moved and turned: `p` is
// where the ring sits in the viewmodel camera's space (x right, y up,
// -z ahead), `turn` rotates the hand about the camera's axes ([pitch, yaw,
// roll] in radians), and `spin` turns the knife around the ring.
import * as THREE from '../vendor/three.module.min.js';

const TAU = Math.PI * 2;

// The resting grip: the ring a little right of centre and below the
// crosshair, the blade pointing right (a touch up and away), edge up.
export const KNIFE_IDLE = { p: [0.045, -0.032, -0.21], blade: [1, 0.12, -0.25], face: [0.1, -0.1, -1] };

const I = KNIFE_IDLE;
const at = (dx, dy, dz) => [I.p[0] + dx, I.p[1] + dy, I.p[2] + dz];
const idle = (t) => ({ t, p: I.p, turn: [0, 0, 0] });

// ease: how a segment arrives at its keyframe.
export const KNIFE_ANIMS = {
  // Flipped up around the finger into the grip.
  draw: [
    { t: 0, p: at(0.08, -0.2, 0.05), turn: [0.3, 0, -0.6], spin: -2.5 * TAU },
    { t: 0.5, p: at(-0.005, 0.01, 0), turn: [0, 0, 0.05], spin: -0.1 * TAU, ease: 'out' },
    { t: 0.85, p: I.p, turn: [0, 0, 0], spin: 0 },
  ],
  // Forehand: cock the wrist right, then sweep the fist left and forward
  // so the blade swings round in front.
  slash: [
    idle(0),
    { t: 0.07, p: at(0.05, 0.03, 0.02), turn: [0, -0.35, 0.1], ease: 'out' },
    { t: 0.2, p: at(-0.12, -0.04, -0.03), turn: [-0.15, 0.85, -0.2], ease: 'in' },
    idle(0.48),
  ],
  // Backhand: start across to the left, sweep back out to the right.
  slash2: [
    idle(0),
    { t: 0.08, p: at(-0.09, 0.04, 0), turn: [0, 0.9, 0.15], ease: 'out' },
    { t: 0.21, p: at(0.07, -0.04, -0.05), turn: [0.1, -0.45, -0.25], ease: 'in' },
    idle(0.5),
  ],
  // Heavy stab: raise it with the tip back, then drive it forward and down.
  stab: [
    idle(0),
    { t: 0.22, p: at(0.02, 0.07, 0.08), turn: [0.2, -0.2, 0.7], ease: 'out' },
    { t: 0.34, p: at(-0.03, -0.03, -0.08), turn: [-0.35, 0.75, -0.3], ease: 'in' },
    { t: 0.55, p: at(-0.03, -0.035, -0.075), turn: [-0.35, 0.75, -0.3] },
    idle(0.9),
  ],
  // Inspect: bring it to the middle, spin it twice around the finger, angle
  // it to look down the blade, roll the wrist to show the other side, back.
  inspect: [
    idle(0),
    { t: 0.4, p: [0.0, -0.01, -0.21], turn: [0, 0, 0.25], spin: 0, ease: 'out' },
    { t: 1.45, p: [0.0, -0.01, -0.21], turn: [0, 0, 0.25], spin: 2 * TAU },
    { t: 2.0, p: [-0.01, 0, -0.2], turn: [0, 0.35, 0.1], spin: 2 * TAU, ease: 'out' },
    { t: 2.25, p: [-0.01, 0, -0.2], turn: [0, 0.35, 0.1], spin: 2 * TAU },
    { t: 2.75, p: [-0.01, 0, -0.2], turn: [Math.PI, 0.35, 0.1], spin: 2 * TAU },
    { t: 3.05, p: [-0.01, 0, -0.2], turn: [Math.PI, 0.35, 0.1], spin: 2 * TAU },
    { t: 3.55, p: I.p, turn: [0, 0, 0], spin: 2 * TAU },
  ],
};

for (const keys of Object.values(KNIFE_ANIMS)) {
  for (const k of keys) {
    k.spin = k.spin || 0;
    k.turn = k.turn || [0, 0, 0];
  }
}

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

export const knifeLength = (name) => {
  const keys = KNIFE_ANIMS[name];
  return keys ? keys[keys.length - 1].t : 0;
};

function ease(u, kind) {
  if (kind === 'linear') return u;
  if (kind === 'out') return 1 - (1 - u) ** 3;
  if (kind === 'in') return u * u * u;
  return u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
}

const _turn = new THREE.Euler(0, 0, 0, 'YXZ');
const _spin = new THREE.Quaternion();
const Z = new THREE.Vector3(0, 0, 1);

// Pose of animation `name` at time `t` (seconds) into `pos` and `quat`.
// With no animation (or past its end) this is the resting grip.
export function sampleKnife(name, t, pos, quat) {
  const keys = KNIFE_ANIMS[name];
  if (!keys || t >= keys[keys.length - 1].t) {
    pos.fromArray(I.p);
    quat.copy(IDLE_Q);
    return;
  }
  let i = 0;
  while (i < keys.length - 2 && t >= keys[i + 1].t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const u = ease(Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))), b.ease);
  const mix = (m, n) => m + (n - m) * u;
  pos.set(mix(a.p[0], b.p[0]), mix(a.p[1], b.p[1]), mix(a.p[2], b.p[2]));
  // Hand turn in camera space, then the grip, then the spin on the ring.
  _turn.set(mix(a.turn[0], b.turn[0]), mix(a.turn[1], b.turn[1]), mix(a.turn[2], b.turn[2]), 'YXZ');
  quat.setFromEuler(_turn).multiply(IDLE_Q);
  const spin = mix(a.spin, b.spin);
  if (spin) quat.multiply(_spin.setFromAxisAngle(Z, spin));
}
