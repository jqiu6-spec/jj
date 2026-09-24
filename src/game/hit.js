// Ray tests between the crosshair ray and target hitboxes. Pure math so the
// exact same code runs in the game loop and in tests.

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

/** Hitbox proportions of the humanoid bot at size 1 (metres, feet at y = 0). */
export const BOT_SHAPE = Object.freeze({
  bodyRadius: 0.3,
  bodyBottom: 0.3,
  bodyTop: 1.22,
  headRadius: 0.15,
  headHeight: 1.7,
});

export function botHitboxes(target) {
  const { position: p, scale } = target;
  const s = BOT_SHAPE;
  return {
    head: { center: { x: p.x, y: p.y + s.headHeight * scale, z: p.z }, radius: s.headRadius * scale },
    body: {
      a: { x: p.x, y: p.y + s.bodyBottom * scale, z: p.z },
      b: { x: p.x, y: p.y + s.bodyTop * scale, z: p.z },
      radius: s.bodyRadius * scale,
    },
  };
}

/**
 * Which part of the target (if any) the ray hits first.
 * @returns {null | 'target' | 'head' | 'body'}
 */
export function hitTest(origin, dir, target) {
  if (target.kind === 'sphere') {
    return raySphere(origin, dir, target.position, target.radius) > 0 ? 'target' : null;
  }
  const { head, body } = botHitboxes(target);
  const tHead = raySphere(origin, dir, head.center, head.radius);
  const tBody = rayCapsule(origin, dir, body.a, body.b, body.radius);
  if (tHead > 0 && (tBody < 0 || tHead <= tBody)) return 'head';
  if (tBody > 0) return 'body';
  return null;
}

/** Forward direction of a camera with the given yaw/pitch (radians, three.js convention). */
export function directionFromAngles(yaw, pitch) {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}
