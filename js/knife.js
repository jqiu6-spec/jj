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
const idle = (t, spin = 0) => ({ t, p: I.p, spin });

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

// Modelled on CS2's karambit. A key gives the hand's place `p`, and either a
// `grip` or a `turn` of the resting grip about the camera's axes ([pitch,
// yaw, roll], radians); `spin` turns the knife around the ring (whole
// turns, so a flip that ends back in the grip ends on a multiple of TAU).
// `ease` is how a segment arrives at its key.
export const KNIFE_ANIMS = {
  // Drawn: the hand comes up on the right with the knife flipping round the
  // finger, then drops into the grip.
  draw: [
    { t: 0, p: at(0.08, -0.2, 0.05), turn: [0.3, 0, -0.6], spin: -1.5 * TAU },
    { t: 0.22, p: at(0.03, 0.035, 0), grip: HANG, spin: -0.5 * TAU, ease: 'out' },
    { t: 0.4, p: at(0.02, 0.03, 0), grip: HANG, spin: 0 },
    idle(0.8),
  ],
  // Backhand: dip to the lower left, whip across the screen to the right.
  slash: [
    idle(0),
    { t: 0.07, p: at(-0.12, -0.09, 0.03), turn: [0.3, 0.7, 0.4], ease: 'out' },
    { t: 0.15, p: at(0, 0.02, -0.05), turn: [-0.1, 0, -0.2], ease: 'in' },
    { t: 0.22, p: at(0.15, 0, -0.02), turn: [-0.2, -0.8, -0.5] },
    { t: 0.32, p: at(0.07, -0.12, 0.02), turn: [0.2, -0.3, -0.2] },
    { ...idle(0.5), ease: 'out' },
  ],
  // Forehand: the other way, right to left.
  slash2: [
    idle(0),
    { t: 0.07, p: at(0.1, -0.08, 0.03), turn: [0.3, -0.6, -0.3], ease: 'out' },
    { t: 0.15, p: at(-0.01, 0.02, -0.05), turn: [-0.1, 0.2, 0.2], ease: 'in' },
    { t: 0.22, p: at(-0.14, 0, -0.02), turn: [-0.2, 0.9, 0.4] },
    { t: 0.32, p: at(-0.06, -0.12, 0.02), turn: [0.2, 0.4, 0.2] },
    { ...idle(0.5), ease: 'out' },
  ],
  // Heavy: raise the fist high on the right, blade out to the left, then
  // drive it down through the middle and flip it back into the grip.
  stab: [
    idle(0),
    { t: 0.1, p: at(0.02, -0.12, 0.03), turn: [0.3, 0, -0.2], ease: 'out' },
    { t: 0.28, p: at(0.1, 0.1, 0.03), grip: RAISED, ease: 'out' },
    { t: 0.45, p: at(0.1, 0.11, 0.035), grip: RAISED },
    { t: 0.58, p: at(-0.02, -0.02, -0.1), grip: DRIVEN, ease: 'in' },
    { t: 0.72, p: at(0.02, -0.06, -0.04), grip: DRIVEN },
    { t: 0.85, p: at(0.02, -0.03, -0.01), turn: [0, 0, 0.2], spin: 0.6 * TAU },
    { ...idle(1.0, TAU), ease: 'out' },
  ],
  // Inspect: a flip up into the upright hold in the middle of the screen,
  // a long look at the blade, a turn of the wrist, then a flip back down.
  inspect: [
    idle(0),
    { t: 0.2, p: at(0, -0.02, 0.01), turn: [0.25, 0, -0.3] },
    { t: 0.45, p: at(0.03, 0.03, 0), grip: HANG, spin: -0.6 * TAU, ease: 'out' },
    { t: 0.75, p: at(-0.01, 0.045, 0.02), grip: UPRIGHT, spin: 0, ease: 'out' },
    { t: 1.8, p: at(-0.013, 0.043, 0.02), grip: UPRIGHT },
    { t: 2.9, p: at(-0.015, 0.04, 0.02), grip: UPRIGHT },
    { t: 3.2, p: at(-0.01, 0.035, 0.02), grip: UPRIGHT_TURNED },
    { t: 3.45, p: at(0.03, 0, 0), grip: HANG, spin: 0 },
    { t: 3.75, p: at(0.01, -0.01, 0), turn: [0, 0, 0], spin: TAU, ease: 'out' },
    idle(4.0, TAU),
  ],
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

// Each key's hand orientation (before the spin), worked out once.
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
for (const keys of Object.values(KNIFE_ANIMS)) {
  for (const k of keys) {
    k.spin = k.spin || 0;
    if (k.grip) k.q = orient(k.grip.blade, k.grip.face);
    else {
      const turn = k.turn || [0, 0, 0];
      k.q = new THREE.Quaternion().setFromEuler(_euler.set(turn[0], turn[1], turn[2], 'YXZ')).multiply(IDLE_Q);
    }
  }
}

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
// With no animation (or past its end) this is the resting grip.
export function sampleKnife(name, t, pos, quat) {
  const keys = KNIFE_ANIMS[name];
  if (!keys || t >= keys[keys.length - 1].t) {
    pos.fromArray(I.p).multiplyScalar(HOLD);
    quat.copy(IDLE_Q);
    return;
  }
  let i = 0;
  while (i < keys.length - 2 && t >= keys[i + 1].t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const u = ease(Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))), b.ease);
  const mix = (m, n) => m + (n - m) * u;
  pos.set(mix(a.p[0], b.p[0]), mix(a.p[1], b.p[1]), mix(a.p[2], b.p[2])).multiplyScalar(HOLD);
  // The hand's orientation, then the spin on the ring.
  quat.slerpQuaternions(a.q, b.q, u);
  const spin = mix(a.spin, b.spin);
  if (spin) quat.multiply(_spin.setFromAxisAngle(Z, spin));
}
