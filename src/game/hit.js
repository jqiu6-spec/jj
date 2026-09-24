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
 * Proportions of the humanoid bot at scale 1 (metres, feet at y = 0, facing
 * +z). The mannequin mesh in bot.js is built from exactly these joints and
 * radii, so the silhouette you see is what your shots can hit.
 */
export const BOT_SHAPE = Object.freeze({
  head: { y: 1.7, radius: 0.125 },
  neck: { top: 1.585, bottom: 1.5, radius: 0.05 },
  // Capsule caps add their radius: the chest reaches shoulder height (1.48).
  chest: { top: 1.29, bottom: 1.2, radius: 0.19 },
  waist: { top: 1.2, bottom: 1.08, radius: 0.145 },
  pelvis: { top: 1.06, bottom: 0.97, radius: 0.165 },
  belt: { top: 1.075, bottom: 1.045, radius: 0.175 },
  collar: { top: 1.475, bottom: 1.455, radius: 0.075 },
  shoulder: { x: 0.235, y: 1.455, radius: 0.075 },
  upperArm: { length: 0.3, radius: 0.052 },
  elbow: { radius: 0.058 },
  forearm: { length: 0.27, radius: 0.047 },
  hand: { length: 0.11, radius: 0.045 },
  hip: { x: 0.1, y: 0.98, radius: 0.09 },
  thigh: { length: 0.44, radius: 0.082 },
  knee: { radius: 0.085 },
  shin: { length: 0.425, radius: 0.068 },
  ankle: { radius: 0.06 },
  foot: { length: 0.16, drop: 0.06, radius: 0.055 },
  armAngle: 0.12,
  elbowBend: 0.35,
  bobHeight: 0.025,
});

/** Total height of the bot at scale 1. */
export const BOT_HEIGHT = BOT_SHAPE.head.y + BOT_SHAPE.head.radius;

/**
 * The bot always faces the player, who stands at the origin. Returns the bot's
 * yaw and its sideways (right) and forward axes in world space.
 */
export function botFrame(position) {
  const len = Math.hypot(position.x, position.z) || 1;
  const tx = -position.x / len;
  const tz = -position.z / len;
  return { yaw: Math.atan2(tx, tz), right: { x: tz, y: 0, z: -tx }, forward: { x: tx, y: 0, z: tz } };
}

/**
 * Standing still. Angles are radians: hipSwing / armSwing are sideways
 * (positive = outward), kneeBend pushes the ankle back behind the knee.
 */
export const REST_POSE = Object.freeze({
  hipSwing: [0.05, 0.05],
  kneeBend: [0.06, 0.06],
  armSwing: [0.05, 0.05],
  bob: 0,
});

function unit(x, y, z) {
  const len = Math.hypot(x, y, z) || 1;
  return { x: x / len, y: y / len, z: z / len };
}

function along(from, dir, length) {
  return { x: from.x + dir.x * length, y: from.y + dir.y * length, z: from.z + dir.z * length };
}

/**
 * Joints and hit primitives in the bot's local space (scale 1, no bob).
 * Each primitive is a sphere ({center, radius}) or capsule ({a, b, radius})
 * tagged with its zone and a part name the mesh uses to find it.
 */
export function botSkeleton(pose = REST_POSE) {
  const s = BOT_SHAPE;
  const at = (x, y, z = 0) => ({ x, y, z });
  const primitives = [];
  const sphere = (part, zone, center, radius) => primitives.push({ part, zone, kind: 'sphere', center, radius });
  const capsule = (part, zone, a, b, radius) => primitives.push({ part, zone, kind: 'capsule', a, b, radius });

  const joints = { head: at(0, s.head.y) };
  sphere('head', 'head', joints.head, s.head.radius);
  capsule('neck', 'head', at(0, s.neck.bottom), at(0, s.neck.top), s.neck.radius);
  capsule('chest', 'body', at(0, s.chest.bottom), at(0, s.chest.top), s.chest.radius);
  capsule('waist', 'body', at(0, s.waist.bottom), at(0, s.waist.top), s.waist.radius);
  capsule('pelvis', 'body', at(0, s.pelvis.bottom), at(0, s.pelvis.top), s.pelvis.radius);
  capsule('belt', 'body', at(0, s.belt.bottom), at(0, s.belt.top), s.belt.radius);
  capsule('collar', 'body', at(0, s.collar.bottom), at(0, s.collar.top), s.collar.radius);

  for (const [index, side] of [-1, 1].entries()) {
    const key = side < 0 ? 'left' : 'right';
    // Arm: hangs from the shoulder, swings out sideways, forearm bent forward.
    const shoulder = at(side * s.shoulder.x, s.shoulder.y);
    const out = s.armAngle + pose.armSwing[index];
    const upperDir = unit(side * Math.sin(out), -Math.cos(out), 0);
    const elbow = along(shoulder, upperDir, s.upperArm.length);
    const foreDir = unit(side * Math.sin(out * 0.6), -Math.cos(out * 0.6) * Math.cos(s.elbowBend), Math.sin(s.elbowBend));
    const wrist = along(elbow, foreDir, s.forearm.length);
    const hand = along(wrist, foreDir, s.hand.length);
    sphere(`${key}Shoulder`, 'body', shoulder, s.shoulder.radius);
    capsule(`${key}UpperArm`, 'body', shoulder, elbow, s.upperArm.radius);
    sphere(`${key}Elbow`, 'body', elbow, s.elbow.radius);
    capsule(`${key}Forearm`, 'body', elbow, wrist, s.forearm.radius);
    capsule(`${key}Hand`, 'body', wrist, hand, s.hand.radius);

    // Leg: thigh swings sideways at the hip, shin follows with a knee bend.
    const hip = at(side * s.hip.x, s.hip.y);
    const swing = pose.hipSwing[index];
    const thighDir = unit(side * Math.sin(swing), -Math.cos(swing), 0);
    const knee = along(hip, thighDir, s.thigh.length);
    const bend = pose.kneeBend[index];
    const shinDir = unit(side * Math.sin(swing * 0.5), -Math.cos(swing * 0.5), -Math.sin(bend));
    const ankle = along(knee, shinDir, s.shin.length);
    const toe = at(ankle.x, ankle.y - s.foot.drop, ankle.z + s.foot.length);
    sphere(`${key}Hip`, 'legs', hip, s.hip.radius);
    capsule(`${key}Thigh`, 'legs', hip, knee, s.thigh.radius);
    sphere(`${key}Knee`, 'legs', knee, s.knee.radius);
    capsule(`${key}Shin`, 'legs', knee, ankle, s.shin.radius);
    sphere(`${key}Ankle`, 'legs', ankle, s.ankle.radius);
    capsule(`${key}Foot`, 'legs', ankle, toe, s.foot.radius);
    Object.assign(joints, { [`${key}Shoulder`]: shoulder, [`${key}Elbow`]: elbow, [`${key}Wrist`]: wrist, [`${key}Hip`]: hip, [`${key}Knee`]: knee, [`${key}Ankle`]: ankle });
  }
  return { joints, primitives };
}

/** World-space hitboxes for the bot in its current pose. */
export function botHitboxes(target) {
  const { position: p, scale } = target;
  const pose = target.pose ?? REST_POSE;
  const { right, forward } = botFrame(p);
  const bob = pose.bob * scale;
  const toWorld = (l) => ({
    x: p.x + (right.x * l.x + forward.x * l.z) * scale,
    y: p.y + l.y * scale + bob,
    z: p.z + (right.z * l.x + forward.z * l.z) * scale,
  });
  const primitives = botSkeleton(pose).primitives.map((prim) =>
    prim.kind === 'sphere'
      ? { ...prim, center: toWorld(prim.center), radius: prim.radius * scale }
      : { ...prim, a: toWorld(prim.a), b: toWorld(prim.b), radius: prim.radius * scale },
  );
  const byPart = Object.fromEntries(primitives.map((prim) => [prim.part, prim]));
  return {
    primitives,
    head: byPart.head,
    torso: [byPart.chest, byPart.waist, byPart.pelvis, byPart.belt, byPart.collar],
    arms: [byPart.leftUpperArm, byPart.rightUpperArm],
    hands: [byPart.leftHand, byPart.rightHand],
    legs: [byPart.leftThigh, byPart.rightThigh],
    feet: [byPart.leftFoot, byPart.rightFoot],
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
  let best = { zone: null, t: Infinity };
  for (const prim of botHitboxes(target).primitives) {
    const t = prim.kind === 'sphere' ? raySphere(origin, dir, prim.center, prim.radius) : rayCapsule(origin, dir, prim.a, prim.b, prim.radius);
    if (t > 0 && t < best.t) best = { zone: prim.zone, t };
  }
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
