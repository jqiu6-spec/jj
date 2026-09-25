// Karambit animations, keyframed in code and played in the first-person
// view: draw, idle, alternating slashes, a heavy stab and an inspect. The
// knife pivots on its ring (the model's origin), so spins turn it around the
// finger the way a karambit is flipped.
//
// Knife space: the ring at the origin, the blade running toward -Y, the
// cutting edge (the inside of the curve) toward +X, the flats facing ±Z.
// A keyframe gives the ring's position in the viewmodel camera's space
// (x right, y up, -z ahead), the direction the blade points, the direction
// the visible flat faces (mostly back toward the view, so the skin shows),
// and `spin`, extra turns around the ring in radians.
import * as THREE from '../vendor/three.module.min.js';

const TAU = Math.PI * 2;

// Resting pose, held low and right in a reverse grip: the blade reaches
// forward and in toward the crosshair, tip curling up, flat toward the view.
export const KNIFE_IDLE = { p: [0.12, -0.125, -0.25], blade: [-0.45, 0.35, -1], face: [-0.35, 0.3, 1] };

const I = KNIFE_IDLE;
const at = (dx, dy, dz) => [I.p[0] + dx, I.p[1] + dy, I.p[2] + dz];
const idle = (t, ease) => ({ t, p: I.p, blade: I.blade, face: I.face, ease });

// ease: how a segment arrives at its keyframe.
export const KNIFE_ANIMS = {
  // Flipped out around the finger as it comes up.
  draw: [
    { t: 0, p: at(0.07, -0.25, 0.08), blade: [0.3, -1, -0.4], face: [-0.2, 0, 1], spin: -2.5 * TAU },
    { t: 0.5, p: at(-0.01, 0.02, -0.01), blade: I.blade, face: I.face, spin: -0.1 * TAU, ease: 'out' },
    { t: 0.85, p: I.p, blade: I.blade, face: I.face, spin: 0 },
  ],
  // Forehand: wind up to the right, sweep across to the left.
  slash: [
    idle(0),
    { t: 0.07, p: at(0.06, 0.04, 0.02), blade: [0.35, 0.45, -1], face: [-0.1, 0.25, 1], ease: 'out' },
    { t: 0.2, p: at(-0.17, -0.03, -0.06), blade: [-0.6, 0.05, -1], face: [0.1, 0.9, 0.45], ease: 'in' },
    idle(0.48),
  ],
  // Backhand: wind up to the left, sweep back to the right.
  slash2: [
    idle(0),
    { t: 0.08, p: at(-0.1, 0.05, 0.01), blade: [-0.8, 0.5, -0.7], face: [0.1, 0.3, 1], ease: 'out' },
    { t: 0.21, p: at(0.08, -0.05, -0.06), blade: [0.45, -0.05, -1], face: [-0.15, 0.9, 0.45], ease: 'in' },
    idle(0.5),
  ],
  // Heavy stab: draw back and up, then drive forward and down.
  stab: [
    idle(0),
    { t: 0.22, p: at(0.02, 0.1, 0.1), blade: [-0.15, 0.9, -0.45], face: [-0.3, 0.1, 1], ease: 'out' },
    { t: 0.34, p: at(-0.05, -0.02, -0.14), blade: [-0.25, -0.3, -1], face: [-0.3, 0.55, 0.8], ease: 'in' },
    { t: 0.55, p: at(-0.05, -0.025, -0.13), blade: [-0.25, -0.3, -1], face: [-0.3, 0.55, 0.8] },
    idle(0.9),
  ],
  // Inspect: bring it in, spin it twice around the finger, show one flat,
  // roll it over to show the other, and settle back.
  inspect: [
    idle(0),
    { t: 0.4, p: [0.09, -0.1, -0.28], blade: [-0.75, 0.5, -0.5], face: [-0.25, 0.2, 1], spin: 0, ease: 'out' },
    { t: 1.45, p: [0.09, -0.1, -0.28], blade: [-0.75, 0.5, -0.5], face: [-0.25, 0.2, 1], spin: 2 * TAU },
    { t: 2.0, p: [0.07, -0.085, -0.26], blade: [-1, 0.25, -0.1], face: [0, 0.1, 1], spin: 2 * TAU, ease: 'out' },
    { t: 2.25, p: [0.07, -0.085, -0.26], blade: [-1, 0.25, -0.1], face: [0, 0.1, 1], spin: 2 * TAU },
    { t: 2.75, p: [0.07, -0.085, -0.26], blade: [-1, 0.25, -0.1], face: [0, -0.1, -1], spin: 2 * TAU },
    { t: 3.05, p: [0.07, -0.085, -0.26], blade: [-1, 0.25, -0.1], face: [0, -0.1, -1], spin: 2 * TAU },
    { t: 3.55, p: I.p, blade: I.blade, face: I.face, spin: 2 * TAU },
  ],
};

// Orientation that points the blade (local -Y) along `blade` and turns the
// knife's -Z flat toward `face`; the edge (local +X) follows from those.
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _mat = new THREE.Matrix4();
function orient(blade, face) {
  _y.set(blade[0], blade[1], blade[2]).normalize().negate();
  _z.set(face[0], face[1], face[2]);
  _z.addScaledVector(_y, -_z.dot(_y)).normalize().negate();
  _x.crossVectors(_y, _z);
  return new THREE.Quaternion().setFromRotationMatrix(_mat.makeBasis(_x, _y, _z));
}

for (const keys of Object.values(KNIFE_ANIMS)) {
  for (const k of keys) {
    k.q = orient(k.blade, k.face);
    k.spin = k.spin || 0;
  }
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

const _spin = new THREE.Quaternion();
const Z = new THREE.Vector3(0, 0, 1);

// Pose of animation `name` at time `t` (seconds) into `pos` and `quat`.
// With no animation (or past its end) this is the idle pose.
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
  pos.set(
    a.p[0] + (b.p[0] - a.p[0]) * u,
    a.p[1] + (b.p[1] - a.p[1]) * u,
    a.p[2] + (b.p[2] - a.p[2]) * u,
  );
  quat.slerpQuaternions(a.q, b.q, u);
  const spin = a.spin + (b.spin - a.spin) * u;
  if (spin) quat.multiply(_spin.setFromAxisAngle(Z, spin));
}
