import { describe, expect, it } from 'vitest';
import { damageFor, fireRateAt, getWeapon, WEAPONS } from '../src/core/weapons.js';
import { TrackingSession, ZONE_POINTS } from '../src/core/scoring.js';

describe('weapons', () => {
  it('has Valorant fire rates and damage', () => {
    expect(getWeapon('vandal')).toMatchObject({ fireRate: 9.75, damage: { head: 160, body: 40, legs: 34 } });
    expect(getWeapon('phantom').fireRate).toBe(11);
    expect(getWeapon('spectre').fireRate).toBeCloseTo(13.33, 2);
    expect(getWeapon('nope').id).toBe(WEAPONS[0].id);
  });

  it('spins the Odin up', () => {
    const odin = getWeapon('odin');
    expect(fireRateAt(odin, 0)).toBe(12);
    expect(fireRateAt(odin, 10)).toBe(15.6);
    expect(fireRateAt(odin, odin.spinUp.time / 2)).toBeCloseTo(13.8, 6);
    expect(fireRateAt(getWeapon('vandal'), 5)).toBe(9.75);
  });

  it('maps hit zones to damage', () => {
    const vandal = getWeapon('vandal');
    expect(damageFor(vandal, 'head')).toBe(160);
    expect(damageFor(vandal, 'legs')).toBe(34);
    expect(damageFor(vandal, 'target')).toBe(40); // orbs count as body
    expect(damageFor(vandal, null)).toBe(0);
  });
});

describe('shot simulation', () => {
  const run = (weapon, seconds, zone, dt = 1 / 144) => {
    const session = new TrackingSession({ duration: seconds + 1, weapon });
    let shots = 0;
    const frames = Math.round(seconds / dt);
    for (let i = 0; i < frames; i++) shots += session.update(dt, { firing: true, zone }).shots;
    return { session, shots };
  };

  it('fires the first shot immediately and then at the fire rate', () => {
    const vandal = getWeapon('vandal');
    const session = new TrackingSession({ duration: 10, weapon: vandal });
    expect(session.update(0.001, { firing: true, zone: 'body' })).toEqual({ shots: 1, hitZone: 'body' });
    expect(session.update(0.05, { firing: true, zone: 'body' }).shots).toBe(0);
    const { shots } = run(vandal, 4, 'body');
    expect(shots).toBeGreaterThanOrEqual(39); // 1 + floor(4 × 9.75)
    expect(shots).toBeLessThanOrEqual(40);
  });

  it('is frame rate independent', () => {
    const spectre = getWeapon('spectre');
    const counts = [30, 60, 144, 240].map((fps) => run(spectre, 3, 'target', 1 / fps).shots);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    expect(counts[0]).toBeGreaterThanOrEqual(40);
  });

  it('counts hits, head hits and damage', () => {
    const vandal = getWeapon('vandal');
    const session = new TrackingSession({ duration: 10, weapon: vandal });
    session.update(0.001, { firing: true, zone: 'head' }); // shot 1: head
    session.update(1 / 9.75, { firing: true, zone: 'legs' }); // shot 2: legs
    session.update(1 / 9.75, { firing: true, zone: null }); // shot 3: miss
    const r = session.results();
    expect(r.shots).toBe(3);
    expect(r.hits).toBe(2);
    expect(r.headHits).toBe(1);
    expect(r.damage).toBe(160 + 34);
  });

  it('does not fire while the trigger is released and restarts instantly', () => {
    const vandal = getWeapon('vandal');
    const session = new TrackingSession({ duration: 10, weapon: vandal });
    expect(session.update(0.5, { firing: false, zone: 'body' }).shots).toBe(0);
    expect(session.update(0.001, { firing: true, zone: 'body' }).shots).toBe(1);
    session.update(0.5, { firing: false, zone: 'body' });
    expect(session.update(0.001, { firing: true, zone: 'body' }).shots).toBe(1);
  });

  it('scores legs below the body and keeps score weapon independent', () => {
    expect(ZONE_POINTS.legs).toBeLessThan(ZONE_POINTS.body);
    const a = run(getWeapon('vandal'), 2, 'legs').session.score;
    const b = run(getWeapon('spectre'), 2, 'legs').session.score;
    expect(a).toBe(b);
    expect(a).toBe(Math.round(2 * ZONE_POINTS.legs));
  });

  it('works without a weapon', () => {
    const session = new TrackingSession({ duration: 2 });
    expect(session.update(0.5, { firing: true, zone: 'body' })).toEqual({ shots: 0, hitZone: null });
    expect(session.results().shots).toBe(0);
  });
});
