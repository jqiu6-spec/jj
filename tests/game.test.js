import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/random.js';
import { crosshairRects } from '../src/game/crosshair.js';
import { BOT_HEIGHT, BOT_SHAPE, botFrame, botHitboxes, directionFromAngles, hitTest, hitTestDetailed, rayAabb, rayCapsule, raySphere } from '../src/game/hit.js';
import { animateBotPose, createBotPose, DIFFICULTIES, EYE_HEIGHT, resolveDifficulty, RUN_SPEED, SCENARIOS } from '../src/game/scenarios.js';
import { DEFAULT_CROSSHAIR } from '../src/core/settings.js';

const eye = { x: 0, y: EYE_HEIGHT, z: 0 };

function aimAt(point) {
  const dx = point.x - eye.x;
  const dy = point.y - eye.y;
  const dz = point.z - eye.z;
  const len = Math.hypot(dx, dy, dz);
  return { x: dx / len, y: dy / len, z: dz / len };
}

describe('ray tests', () => {
  it('hits a sphere straight ahead and misses beside it', () => {
    const forward = directionFromAngles(0, 0);
    expect(raySphere(eye, forward, { x: 0, y: EYE_HEIGHT, z: -10 }, 0.5)).toBeCloseTo(9.5, 8);
    expect(raySphere(eye, forward, { x: 0.6, y: EYE_HEIGHT, z: -10 }, 0.5)).toBe(-1);
    // Behind the camera does not count.
    expect(raySphere(eye, forward, { x: 0, y: EYE_HEIGHT, z: 10 }, 0.5)).toBe(-1);
  });

  it('hits a vertical capsule on its side and its caps', () => {
    const a = { x: 0, y: 0.3, z: -10 };
    const b = { x: 0, y: 1.2, z: -10 };
    expect(rayCapsule(eye, aimAt({ x: 0, y: 0.8, z: -10 }), a, b, 0.3)).toBeGreaterThan(0);
    expect(rayCapsule(eye, aimAt({ x: 0, y: 1.45, z: -10 }), a, b, 0.3)).toBeGreaterThan(0);
    expect(rayCapsule(eye, aimAt({ x: 0.5, y: 0.8, z: -10 }), a, b, 0.3)).toBe(-1);
    expect(rayCapsule(eye, aimAt({ x: 0, y: 1.6, z: -10 }), a, b, 0.3)).toBe(-1);
  });

  it('turns yaw/pitch into the three.js forward vector', () => {
    const right = directionFromAngles(-Math.PI / 2, 0);
    expect(right.x).toBeCloseTo(1, 10);
    expect(right.z).toBeCloseTo(0, 10);
    const up = directionFromAngles(0, Math.PI / 4);
    expect(up.y).toBeCloseTo(Math.SQRT1_2, 10);
  });

  it('separates head, body and legs on the bot', () => {
    const bot = { kind: 'bot', position: { x: 0, y: 0, z: -15 }, scale: 1 };
    const { head, body, legs } = botHitboxes(bot);
    expect(hitTest(eye, aimAt(head.center), bot)).toBe('head');
    expect(hitTest(eye, aimAt({ x: 0, y: (body.a.y + body.b.y) / 2, z: -15 }), bot)).toBe('body');
    expect(hitTest(eye, aimAt({ x: legs[0].a.x, y: 0.5, z: -15 }), bot)).toBe('legs');
    expect(hitTest(eye, aimAt({ x: legs[1].a.x, y: 0.5, z: -15 }), bot)).toBe('legs');
    // Between the legs, above the head and beside the body are misses.
    expect(hitTest(eye, aimAt({ x: 0, y: 0.5, z: -15 }), bot)).toBeNull();
    expect(hitTest(eye, aimAt({ x: 0, y: BOT_HEIGHT + 0.05, z: -15 }), bot)).toBeNull();
    expect(hitTest(eye, aimAt({ x: 1, y: 1, z: -15 }), bot)).toBeNull();
    // Arms hang beside the torso and count as body.
    const { arms } = botHitboxes(bot);
    expect(hitTest(eye, aimAt({ x: arms[1].b.x, y: arms[1].b.y, z: -15 }), bot)).toBe('body');
    expect(arms[1].b.x).toBeGreaterThan(BOT_SHAPE.bodyRadius);
    const orb = { kind: 'sphere', position: { x: 2, y: 2, z: -8 }, radius: 0.4 };
    expect(hitTest(eye, aimAt(orb.position), orb)).toBe('target');
    expect(hitTestDetailed(eye, aimAt(orb.position), orb).t).toBeCloseTo(Math.hypot(2, 0.4, 8) - 0.4, 6);
  });

  it('scales the bot and its hitboxes together', () => {
    const big = { kind: 'bot', position: { x: 0, y: 0, z: -15 }, scale: 1.3 };
    const { head } = botHitboxes(big);
    expect(head.center.y).toBeCloseTo(BOT_SHAPE.headY * 1.3, 8);
    expect(head.radius).toBeCloseTo(BOT_SHAPE.headRadius * 1.3, 8);
  });

  it('keeps the bot facing the player', () => {
    expect(botFrame({ x: 0, y: 0, z: -15 }).yaw).toBeCloseTo(0, 8);
    expect(botFrame({ x: 5, y: 0, z: -15 }).yaw).toBeCloseTo(Math.atan2(-5, 15), 8);
    const { right } = botFrame({ x: 15, y: 0, z: 0 });
    // Bot to the right of the player: its sideways axis runs along -z.
    expect(right.x).toBeCloseTo(0, 8);
    expect(Math.abs(right.z)).toBeCloseTo(1, 8);
    const bot = { kind: 'bot', position: { x: 15, y: 0, z: 0 }, scale: 1 };
    const { legs } = botHitboxes(bot);
    expect(Math.abs(legs[0].a.z - legs[1].a.z)).toBeCloseTo(2 * BOT_SHAPE.hipSpread, 8);
  });

  it('moves the leg hitboxes with the walking pose', () => {
    const pose = createBotPose();
    const still = botHitboxes({ kind: 'bot', position: { x: 0, y: 0, z: -15 }, scale: 1, pose });
    for (let i = 0; i < 30; i++) animateBotPose(pose, { x: RUN_SPEED, z: 0 }, 1 / 60);
    expect(pose.amount).toBeGreaterThan(0.9);
    const moving = botHitboxes({ kind: 'bot', position: { x: 0, y: 0, z: -15 }, scale: 1, pose });
    const spread = (h) => Math.abs(h.legs[0].b.x - h.legs[1].b.x);
    expect(spread(moving)).not.toBeCloseTo(spread(still), 3);
    expect(moving.head.center.y).toBeGreaterThanOrEqual(still.head.center.y);
    for (const leg of moving.legs) expect(leg.b.y).toBeGreaterThanOrEqual(0);
    // Stopping settles the legs back to a stance.
    for (let i = 0; i < 120; i++) animateBotPose(pose, { x: 0, z: 0 }, 1 / 60);
    expect(pose.amount).toBeLessThan(0.02);
  });

  it('finds room walls from inside and boxes from outside', () => {
    const room = { min: { x: -40, y: 0, z: -40 }, max: { x: 40, y: 20, z: 40 } };
    const forward = directionFromAngles(0, 0);
    const wall = rayAabb(eye, forward, room.min, room.max);
    expect(wall.t).toBeCloseTo(40, 8);
    expect(wall.normal).toEqual({ x: 0, y: 0, z: 1 });
    const floor = rayAabb(eye, directionFromAngles(0, -Math.PI / 2), room.min, room.max);
    expect(floor.t).toBeCloseTo(EYE_HEIGHT, 8);
    expect(floor.normal).toEqual({ x: 0, y: 1, z: 0 });
    const pillar = rayAabb(eye, forward, { x: -0.3, y: 0, z: -10.3 }, { x: 0.3, y: 6, z: -9.7 });
    expect(pillar.t).toBeCloseTo(9.7, 8);
    expect(pillar.normal).toEqual({ x: 0, y: 0, z: 1 });
    expect(rayAabb(eye, forward, { x: 2, y: 0, z: -10.3 }, { x: 3, y: 6, z: -9.7 })).toBeNull();
    expect(rayAabb(eye, forward, { x: -1, y: 0, z: 5 }, { x: 1, y: 6, z: 6 })).toBeNull(); // behind
  });
});

describe('scenarios', () => {
  const inside = (p, bounds, tolerance = 1e-6) =>
    ['x', 'y', 'z'].every((axis) => p[axis] >= bounds.min[axis] - tolerance && p[axis] <= bounds.max[axis] + tolerance);

  for (const scenario of SCENARIOS) {
    for (const [id, difficulty] of Object.entries(DIFFICULTIES)) {
      it(`${scenario.id} (${id}) keeps its target in bounds and moving`, () => {
        const instance = scenario.create({ rng: createRng(1234), speed: difficulty.speed, size: difficulty.size });
        const { target, bounds } = instance;
        let travelled = 0;
        let last = { ...target.position };
        for (let i = 0; i < 120 * 90; i++) {
          instance.update(1 / 120);
          const p = target.position;
          expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true);
          expect(inside(p, bounds)).toBe(true);
          travelled += Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z);
          last = { ...p };
        }
        expect(travelled).toBeGreaterThan(20);
        if (target.kind === 'sphere') expect(target.position.y - target.radius).toBeGreaterThan(0);
      });
    }
  }

  it('is reproducible with the same seed', () => {
    const run = () => {
      const instance = SCENARIOS[0].create({ rng: createRng(7), speed: 1, size: 1 });
      for (let i = 0; i < 600; i++) instance.update(1 / 60);
      return { ...instance.target.position };
    };
    expect(run()).toEqual(run());
  });

  it('keeps the strafe bot at Valorant running speed', () => {
    const strafe = SCENARIOS.find((s) => s.id === 'strafe');
    const instance = strafe.create({ rng: createRng(99), speed: 1, size: 1 });
    let maxSpeed = 0;
    let lastX = instance.target.position.x;
    for (let i = 0; i < 120 * 30; i++) {
      instance.update(1 / 120);
      maxSpeed = Math.max(maxSpeed, Math.abs(instance.target.position.x - lastX) * 120);
      lastX = instance.target.position.x;
    }
    expect(maxSpeed).toBeLessThanOrEqual(6.75 + 1e-6);
    expect(maxSpeed).toBeGreaterThan(6);
  });

  it('resolves custom difficulty into a stable key', () => {
    expect(resolveDifficulty('hard')).toMatchObject({ key: 'hard', speed: 1.3 });
    expect(resolveDifficulty('nope').key).toBe('normal');
    const custom = resolveDifficulty('custom', { speed: 1.2, size: 0.8 });
    expect(custom.key).toBe('custom-1.2x-0.8x');
    expect(custom.label).toContain('1.2×');
  });
});

describe('crosshair geometry', () => {
  it('draws four symmetric inner lines', () => {
    const rects = crosshairRects({ ...DEFAULT_CROSSHAIR, innerThickness: 2, innerOffset: 3, innerLength: 6 });
    expect(rects).toHaveLength(4);
    const [right, left] = rects;
    // Same gap on both sides of the centre point.
    expect(right.x).toBe(3);
    expect(-(left.x + left.w)).toBe(3);
  });

  it('keeps odd thicknesses centred on a pixel', () => {
    const rects = crosshairRects({ ...DEFAULT_CROSSHAIR, innerThickness: 1, innerOffset: 2, innerLength: 4, centerDot: true, centerDotThickness: 1 });
    const [right, left] = rects;
    const dot = rects[rects.length - 1];
    const centre = dot.x + dot.w / 2; // 0.5
    expect(right.x - centre).toBe(centre - (left.x + left.w));
  });

  it('draws nothing for hidden elements', () => {
    expect(crosshairRects({ ...DEFAULT_CROSSHAIR, innerLines: false, outerLines: false, centerDot: false })).toHaveLength(0);
  });
});
