// Tracking scenarios. Each one owns a single target and moves it every frame.
// Units are metres and seconds; the player's eye sits at (0, EYE_HEIGHT, 0)
// looking down -Z. Movement code is free of three.js so it can be tested.

import { randomBetween, randomSign } from '../core/random.js';
import { BOT_SHAPE } from './hit.js';

export const EYE_HEIGHT = 1.6;

/** Valorant running speed, used for the strafing bot. */
export const RUN_SPEED = 6.75;

export const DIFFICULTIES = {
  easy: { label: 'Easy', speed: 0.75, size: 1.3 },
  normal: { label: 'Normal', speed: 1, size: 1 },
  hard: { label: 'Hard', speed: 1.3, size: 0.8 },
  insane: { label: 'Insane', speed: 1.65, size: 0.65 },
};

/** Turn a difficulty id (plus custom multipliers) into a comparable key and label. */
export function resolveDifficulty(id, custom = { speed: 1, size: 1 }) {
  if (id === 'custom') {
    const speed = Number(custom.speed.toFixed(2));
    const size = Number(custom.size.toFixed(2));
    return {
      id,
      key: `custom-${speed}x-${size}x`,
      label: `Custom (${speed}× speed, ${size}× size)`,
      speed,
      size,
    };
  }
  const preset = DIFFICULTIES[id] ?? DIFFICULTIES.normal;
  const resolvedId = DIFFICULTIES[id] ? id : 'normal';
  return { id: resolvedId, key: resolvedId, label: preset.label, speed: preset.speed, size: preset.size };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function approach(current, target, maxDelta) {
  if (current < target) return Math.min(target, current + maxDelta);
  return Math.max(target, current - maxDelta);
}

function randomPoint(rng, bounds) {
  return {
    x: randomBetween(rng, bounds.min.x, bounds.max.x),
    y: randomBetween(rng, bounds.min.y, bounds.max.y),
    z: randomBetween(rng, bounds.min.z, bounds.max.z),
  };
}

/**
 * Keep a point inside an axis-aligned box, bouncing its velocity off the walls.
 * `intent` (optional) is a desired velocity that gets reflected the same way.
 */
function bounce(position, velocity, bounds, intent = null) {
  for (const axis of ['x', 'y', 'z']) {
    let sign = 0;
    if (position[axis] < bounds.min[axis]) {
      position[axis] = bounds.min[axis];
      sign = 1;
    } else if (position[axis] > bounds.max[axis]) {
      position[axis] = bounds.max[axis];
      sign = -1;
    }
    if (sign !== 0) {
      velocity[axis] = sign * Math.abs(velocity[axis]);
      if (intent) intent[axis] = sign * Math.abs(intent[axis]);
    }
  }
}

/** Raise the floor of a box so a sphere of `radius` never sinks into the ground. */
function liftBounds(bounds, radius) {
  return {
    min: { ...bounds.min, y: Math.max(bounds.min.y, radius + 0.05) },
    max: { ...bounds.max, y: Math.max(bounds.max.y, radius + 0.1) },
  };
}

function smooth({ rng, speed, size }) {
  const radius = 0.42 * size;
  const bounds = liftBounds({ min: { x: -7, y: 0.9, z: -16 }, max: { x: 7, y: 4.6, z: -11 } }, radius);
  const position = { x: randomBetween(rng, -1.5, 1.5), y: EYE_HEIGHT + 0.2, z: -13.5 };
  const velocity = { x: 0, y: 0, z: 0 };
  let waypoint;
  let cruise;
  let timer;
  const pick = () => {
    waypoint = randomPoint(rng, bounds);
    cruise = 4.2 * speed * randomBetween(rng, 0.7, 1.25);
    timer = randomBetween(rng, 1.2, 2.6);
  };
  pick();
  const steer = 2.8 * Math.sqrt(speed);
  return {
    target: { kind: 'sphere', position, radius },
    bounds,
    update(dt) {
      timer -= dt;
      const dx = waypoint.x - position.x;
      const dy = waypoint.y - position.y;
      const dz = waypoint.z - position.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist < 1 || timer <= 0) pick();
      const k = 1 - Math.exp(-steer * dt);
      const inv = dist > 1e-6 ? cruise / dist : 0;
      velocity.x += (dx * inv - velocity.x) * k;
      velocity.y += (dy * inv - velocity.y) * k;
      velocity.z += (dz * inv - velocity.z) * k;
      position.x += velocity.x * dt;
      position.y += velocity.y * dt;
      position.z += velocity.z * dt;
      bounce(position, velocity, bounds);
    },
  };
}

/** Stride cycle rate in radians per metre travelled (about 2.6 steps per second at running speed). */
const STRIDE_RATE = 2.4;
const MAX_LEG_SWING = 0.42;

/**
 * Procedural side-step animation. The pose lives on the target so the hitboxes
 * in hit.js and the mesh in bot.js read the same leg angles.
 */
export function animateBotPose(pose, velocity, dt, scale = 1) {
  const speed = Math.hypot(velocity.x, velocity.z);
  const stride = speed / scale;
  pose.phase = (pose.phase + stride * STRIDE_RATE * dt) % (Math.PI * 2);
  // Strength follows speed so the legs settle when the bot stops.
  const amount = Math.min(1, stride / RUN_SPEED);
  pose.amount += (amount - pose.amount) * (1 - Math.exp(-14 * dt));
  const swing = MAX_LEG_SWING * pose.amount * Math.sin(pose.phase);
  pose.legs[0] = 0.04 + Math.max(-0.04, -swing);
  pose.legs[1] = 0.04 + Math.max(-0.04, swing);
  pose.bob = BOT_SHAPE.bobHeight * pose.amount * Math.abs(Math.sin(pose.phase));
  return pose;
}

export function createBotPose() {
  return { legs: [0.04, 0.04], bob: 0, phase: 0, amount: 0 };
}

function strafe({ rng, speed, size }) {
  const bounds = { min: { x: -6.5, y: 0, z: -18 }, max: { x: 6.5, y: 0, z: -12 } };
  const position = { x: randomBetween(rng, -1, 1), y: 0, z: -15 };
  const runSpeed = RUN_SPEED * speed;
  const accel = 42 * speed;
  let vx = 0;
  let vz = 0;
  let dir = randomSign(rng);
  let timer = randomBetween(rng, 0.3, 0.7);
  let depthTarget = 0;
  let depthTimer = 0;
  const pose = createBotPose();
  return {
    target: { kind: 'bot', position, scale: size, pose },
    bounds,
    update(dt) {
      timer -= dt;
      if (timer <= 0) {
        const roll = rng();
        if (dir !== 0 && roll < 0.18) {
          // Stop briefly, like a player counter-strafing to shoot.
          dir = 0;
          timer = randomBetween(rng, 0.08, 0.3);
        } else {
          dir = dir === 0 ? randomSign(rng) : roll < 0.8 ? -dir : dir;
          timer = randomBetween(rng, 0.16, 0.75) / Math.sqrt(speed);
        }
      }
      if (position.x <= bounds.min.x + 0.4 && dir < 0) dir = 1;
      if (position.x >= bounds.max.x - 0.4 && dir > 0) dir = -1;
      vx = approach(vx, dir * runSpeed, accel * dt);
      position.x = clamp(position.x + vx * dt, bounds.min.x, bounds.max.x);

      depthTimer -= dt;
      if (depthTimer <= 0) {
        depthTarget = randomBetween(rng, -1.6, 1.6) * speed;
        depthTimer = randomBetween(rng, 0.8, 2);
      }
      if ((position.z <= bounds.min.z + 0.3 && depthTarget < 0) || (position.z >= bounds.max.z - 0.3 && depthTarget > 0)) {
        depthTarget = -depthTarget;
      }
      vz = approach(vz, depthTarget, 8 * dt);
      position.z = clamp(position.z + vz * dt, bounds.min.z, bounds.max.z);
      animateBotPose(pose, { x: vx, z: vz }, dt, size);
    },
  };
}

function reactive({ rng, speed, size }) {
  const radius = 0.45 * size;
  const bounds = liftBounds({ min: { x: -6, y: 1, z: -11 }, max: { x: 6, y: 4.2, z: -11 } }, radius);
  const position = { x: randomBetween(rng, -1, 1), y: EYE_HEIGHT + 0.3, z: -11 };
  const velocity = { x: 0, y: 0, z: 0 };
  const cruise = 5.2 * speed;
  let timer = 0;
  const redirect = (flip) => {
    const sx = flip ? -Math.sign(velocity.x || 1) : randomSign(rng);
    const vy = randomBetween(rng, -0.55, 0.55);
    const len = Math.hypot(1, vy);
    const magnitude = cruise * randomBetween(rng, 0.8, 1.2);
    velocity.x = (sx / len) * magnitude;
    velocity.y = (vy / len) * magnitude;
    timer = randomBetween(rng, 0.22, 0.85) / Math.sqrt(speed);
  };
  redirect(false);
  return {
    target: { kind: 'sphere', position, radius },
    bounds,
    update(dt) {
      timer -= dt;
      if (timer <= 0) redirect(rng() < 0.7);
      position.x += velocity.x * dt;
      position.y += velocity.y * dt;
      bounce(position, velocity, bounds);
    },
  };
}

function air({ rng, speed, size }) {
  const radius = 0.45 * size;
  const bounds = liftBounds({ min: { x: -7, y: 0.6, z: -13 }, max: { x: 7, y: 7, z: -10 } }, radius);
  const gravity = 9 * speed * speed;
  const position = { x: randomBetween(rng, -1, 1), y: bounds.min.y, z: -11.5 };
  const velocity = { x: 0, y: 0, z: 0 };
  const jump = () => {
    const height = randomBetween(rng, 2.2, 5.2);
    velocity.y = Math.sqrt(2 * gravity * height);
    const sx = rng() < 0.4 ? -Math.sign(velocity.x || 1) : Math.sign(velocity.x || randomSign(rng));
    velocity.x = sx * randomBetween(rng, 2.5, 5) * speed;
    velocity.z = randomBetween(rng, -1, 1) * speed;
  };
  jump();
  return {
    target: { kind: 'sphere', position, radius },
    bounds,
    update(dt) {
      // Occasional mid-air direction change, like an air strafe.
      if (rng() < 0.6 * speed * dt) velocity.x = -velocity.x;
      velocity.y -= gravity * dt;
      position.x += velocity.x * dt;
      position.y += velocity.y * dt;
      position.z += velocity.z * dt;
      if (position.y <= bounds.min.y) {
        position.y = bounds.min.y;
        jump();
      }
      bounce(position, velocity, bounds);
    },
  };
}

function micro({ rng, speed, size }) {
  const radius = 0.24 * size;
  const bounds = liftBounds({ min: { x: -2.3, y: 0.9, z: -6 }, max: { x: 2.3, y: 2.9, z: -4.4 } }, radius);
  const position = { x: 0, y: EYE_HEIGHT, z: -5.2 };
  const velocity = { x: 0, y: 0, z: 0 };
  const desired = { x: 0, y: 0, z: 0 };
  let timer = 0;
  const response = 14 * Math.sqrt(speed);
  return {
    target: { kind: 'sphere', position, radius },
    bounds,
    update(dt) {
      timer -= dt;
      if (timer <= 0) {
        const angle = randomBetween(rng, 0, Math.PI * 2);
        const magnitude = randomBetween(rng, 1.4, 3.8) * speed;
        desired.x = Math.cos(angle) * magnitude;
        desired.y = Math.sin(angle) * magnitude * 0.75;
        desired.z = randomBetween(rng, -0.6, 0.6) * speed;
        timer = randomBetween(rng, 0.07, 0.28) / Math.sqrt(speed);
      }
      const k = 1 - Math.exp(-response * dt);
      velocity.x += (desired.x - velocity.x) * k;
      velocity.y += (desired.y - velocity.y) * k;
      velocity.z += (desired.z - velocity.z) * k;
      position.x += velocity.x * dt;
      position.y += velocity.y * dt;
      position.z += velocity.z * dt;
      // Reflect the intent too so the orb doesn't grind along a wall.
      bounce(position, velocity, bounds, desired);
    },
  };
}

function orbit({ rng, speed, size }) {
  const radius = 0.5 * size;
  const minHeight = Math.max(0.6, radius + 0.1);
  let angle = 0;
  let omega = 0;
  let omegaTarget = randomSign(rng) * randomBetween(rng, 0.55, 1) * speed;
  let omegaTimer = randomBetween(rng, 1.2, 3.2);
  let distance = 9;
  let distanceTarget = 9;
  let distanceTimer = randomBetween(rng, 2, 4);
  let phase = randomBetween(rng, 0, Math.PI * 2);
  let phaseRate = randomBetween(rng, 0.9, 1.6);
  const position = { x: 0, y: 1.8, z: -distance };
  const place = () => {
    position.x = Math.sin(angle) * distance;
    position.z = -Math.cos(angle) * distance;
    position.y = Math.max(minHeight, 1.8 + 1.2 * Math.sin(phase));
  };
  place();
  return {
    target: { kind: 'sphere', position, radius },
    bounds: { min: { x: -10.6, y: minHeight, z: -10.6 }, max: { x: 10.6, y: 3.1, z: 10.6 } },
    update(dt) {
      omegaTimer -= dt;
      if (omegaTimer <= 0) {
        const sign = rng() < 0.55 ? -Math.sign(omegaTarget) : Math.sign(omegaTarget);
        omegaTarget = sign * randomBetween(rng, 0.55, 1) * speed;
        omegaTimer = randomBetween(rng, 1.2, 3.2);
        phaseRate = randomBetween(rng, 0.9, 1.6);
      }
      distanceTimer -= dt;
      if (distanceTimer <= 0) {
        distanceTarget = randomBetween(rng, 7.5, 10.5);
        distanceTimer = randomBetween(rng, 2, 4);
      }
      omega = approach(omega, omegaTarget, 2.2 * speed * dt);
      distance = approach(distance, distanceTarget, 1.2 * dt);
      angle += omega * dt;
      phase += phaseRate * speed * dt;
      place();
    },
  };
}

export const SCENARIOS = [
  {
    id: 'smooth',
    name: 'Smooth Tracking',
    focus: 'Consistency',
    description: 'An orb glides in long, unpredictable curves. Keep your crosshair glued to it.',
    create: smooth,
  },
  {
    id: 'strafe',
    name: 'Strafe Bot',
    focus: 'Valorant duels',
    description: 'A humanoid bot A-D strafes at running speed. Head time scores double.',
    create: strafe,
  },
  {
    id: 'reactive',
    name: 'Reactive Tracking',
    focus: 'Reaction',
    description: 'Fast, straight lines with sudden direction changes. React, re-adjust, stay on.',
    create: reactive,
  },
  {
    id: 'air',
    name: 'Air Tracking',
    focus: 'Vertical control',
    description: 'The target jumps in high arcs and air-strafes. Track both axes at once.',
    create: air,
  },
  {
    id: 'micro',
    name: 'Close-Range Micro',
    focus: 'Precision',
    description: 'A small, jittery orb up close. Tiny, fast corrections at high angular speed.',
    create: micro,
  },
  {
    id: 'orbit',
    name: '360 Orbit',
    focus: 'Arm aiming',
    description: 'The target circles all the way around you. Tests low sensitivity and big swipes.',
    create: orbit,
  },
];

export function getScenario(id) {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}
