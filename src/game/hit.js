// Ray tests between the crosshair ray and target hitboxes. Pure math so the
// exact same code runs in the game loop, the effects and in tests.

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

/** Distance along the (normalized) ray to a sphere, or -1 when missed. */
export function raySphere(origin, dir, center, radius) {
  const oc = sub(origin, center);
  const b = dot(oc, dir);
  const c = dot(oc, oc) - radius * radius;
  const h = b * b - c;
  if (h < 0) return -1;
  const root = Math.sqrt(h);
  const near = -b - root;
  if (near > 0) return near;
  const far = -b + root;
  return far > 0 ? far : -1;
}

/** Distance along the ray to a capsule (segment a–b, radius), or -1 when missed. */
export function rayCapsule(origin, dir, a, b, radius) {
  const ba = sub(b, a);
  const oa = sub(origin, a);
  const baba = dot(ba, ba);
  const bard = dot(ba, dir);
  const baoa = dot(ba, oa);
  const rdoa = dot(dir, oa);
  const oaoa = dot(oa, oa);
  const qa = baba - bard * bard;
  if (qa > 1e-9) {
    const qb = baba * rdoa - baoa * bard;
    const qc = baba * oaoa - baoa * baoa - radius * radius * baba;
    const h = qb * qb - qa * qc;
    if (h < 0) return -1;
    const t = (-qb - Math.sqrt(h)) / qa;
    const y = baoa + t * bard;
    if (y > 0 && y < baba && t > 0) return t;
  }
  // The cylinder part was missed (or the ray runs along the axis): try the end caps.
  const tA = raySphere(origin, dir, a, radius);
  const tB = raySphere(origin, dir, b, radius);
  if (tA < 0) return tB;
  if (tB < 0) return tA;
  return Math.min(tA, tB);
}

/**
 * Ray against an axis-aligned box. From outside it returns the entry distance;
 * from inside, the exit distance (used for the room walls). null when missed.
 * The normal always faces back toward the shooter, which is what a bullet
 * impact needs.
 */
export function rayAabb(origin, dir, min, max) {
  let tNear = -Infinity;
  let tFar = Infinity;
  let nearAxis = null;
  let farAxis = null;
  for (const axis of ['x', 'y', 'z']) {
    const d = dir[axis];
    const o = origin[axis];
    if (Math.abs(d) < 1e-12) {
      if (o < min[axis] || o > max[axis]) return null;
      continue;
    }
    let t1 = (min[axis] - o) / d;
    let t2 = (max[axis] - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tNear) {
      tNear = t1;
      nearAxis = axis;
    }
    if (t2 < tFar) {
      tFar = t2;
      farAxis = axis;
    }
    if (tNear > tFar || tFar < 0) return null;
  }
  const inside = tNear < 0;
  const axis = inside ? farAxis : nearAxis;
  const normal = { x: 0, y: 0, z: 0 };
  normal[axis] = dir[axis] > 0 ? -1 : 1;
  return { t: inside ? tFar : tNear, normal };
}

/**
 * Proportions of the humanoid bot at scale 1 (metres, feet at y = 0). The
 * visual model in bot.js is built from exactly these numbers, so what you see
 * is what you hit.
 */
export const BOT_SHAPE = Object.freeze({
  headRadius: 0.14,
  headY: 1.66,
  bodyRadius: 0.27,
  bodyBottom: 0.92,
  bodyTop: 1.3,
  hipY: 0.92,
  hipSpread: 0.13,
  legRadius: 0.1,
  legLength: 0.82,
  shoulderY: 1.4,
  shoulderX: 0.29,
  armRadius: 0.06,
  armLength: 0.58,
  armAngle: 0.1,
  bobHeight: 0.025,
});

/** Total height of the bot at scale 1. */
export const BOT_HEIGHT = BOT_SHAPE.headY + BOT_SHAPE.headRadius;

/**
 * The bot always faces the player, who stands at the origin. Returns the bot's
 * yaw and its sideways (right) axis in world space.
 */
export function botFrame(position) {
  const len = Math.hypot(position.x, position.z) || 1;
  const tx = -position.x / len;
  const tz = -position.z / len;
  return { yaw: Math.atan2(tx, tz), right: { x: tz, y: 0, z: -tx } };
}

/** Empty pose: standing still. Leg angles are sideways swings in radians (positive = outward). */
export const REST_POSE = Object.freeze({ legs: [0.04, 0.04], bob: 0 });

/** World-space hitboxes for the bot in its current pose. */
export function botHitboxes(target) {
  const { position: p, scale } = target;
  const pose = target.pose ?? REST_POSE;
  const s = BOT_SHAPE;
  const { right } = botFrame(p);
  const bob = pose.bob * scale;
  const local = (lx, ly) => ({ x: p.x + right.x * lx * scale, y: p.y + ly * scale + bob, z: p.z + right.z * lx * scale });
  const legs = pose.legs.map((angle, i) => {
    const side = i === 0 ? -1 : 1;
    const hipX = side * s.hipSpread;
    const footX = hipX + side * Math.sin(angle) * s.legLength;
    const footY = s.hipY - Math.cos(angle) * s.legLength;
    return { a: local(hipX, s.hipY), b: local(footX, footY), radius: s.legRadius * scale };
  });
  // Arms hang at a fixed angle; they count as body, like Valorant's hitboxes.
  const arms = [-1, 1].map((side) => ({
    a: local(side * s.shoulderX, s.shoulderY),
    b: local(side * (s.shoulderX + Math.sin(s.armAngle) * s.armLength), s.shoulderY - Math.cos(s.armAngle) * s.armLength),
    radius: s.armRadius * scale,
  }));
  return {
    head: { center: local(0, s.headY), radius: s.headRadius * scale },
    body: { a: local(0, s.bodyBottom), b: local(0, s.bodyTop), radius: s.bodyRadius * scale },
    arms,
    legs,
  };
}

/**
 * Which part of the target (if any) the ray hits first, and how far away.
 * @returns {{zone: null | 'target' | 'head' | 'body' | 'legs', t: number}}
 */
export function hitTestDetailed(origin, dir, target) {
  if (target.kind === 'sphere') {
    const t = raySphere(origin, dir, target.position, target.radius);
    return t > 0 ? { zone: 'target', t } : { zone: null, t: -1 };
  }
  const { head, body, arms, legs } = botHitboxes(target);
  let best = { zone: null, t: Infinity };
  const consider = (zone, t) => {
    if (t > 0 && t < best.t) best = { zone, t };
  };
  consider('head', raySphere(origin, dir, head.center, head.radius));
  consider('body', rayCapsule(origin, dir, body.a, body.b, body.radius));
  for (const arm of arms) consider('body', rayCapsule(origin, dir, arm.a, arm.b, arm.radius));
  for (const leg of legs) consider('legs', rayCapsule(origin, dir, leg.a, leg.b, leg.radius));
  return best.zone ? best : { zone: null, t: -1 };
}

export function hitTest(origin, dir, target) {
  return hitTestDetailed(origin, dir, target).zone;
}

/** Forward direction of a camera with the given yaw/pitch (radians, three.js convention). */
export function directionFromAngles(yaw, pitch) {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}
