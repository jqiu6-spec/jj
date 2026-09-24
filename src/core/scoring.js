// Scoring for a tracking run. The run is advanced with small time steps; each
// step is credited to the target if the crosshair ray was on it while firing.
// Score is time based (so it doesn't depend on frame rate or weapon); the
// weapon adds a discrete shot simulation for hits, misses and damage numbers.

import { damageFor, fireRateAt } from './weapons.js';

/** Points per second of time on target, by hit zone. Legs mirror Valorant's reduced leg damage. */
export const ZONE_POINTS = { target: 100, body: 100, head: 200, legs: 85 };

/** Off-target gaps shorter than this are edge jitter, not a lost target. */
export const MIN_LOSS_DURATION = 0.1;

export class TrackingSession {
  constructor({ duration, tracksHead = false, weapon = null, bucketSize = 1 }) {
    this.duration = duration;
    this.tracksHead = tracksHead;
    this.weapon = weapon;
    this.bucketSize = bucketSize;
    this.elapsed = 0;
    this.firingTime = 0;
    this.onTargetTime = 0;
    this.headTime = 0;
    this.points = 0;
    this.streak = 0;
    this.longestStreak = 0;
    this.onTarget = false;
    this.hasAcquired = false;
    this.gap = 0;
    this.losses = [];
    // Discrete shots
    this.shots = 0;
    this.hits = 0;
    this.headHits = 0;
    this.damage = 0;
    this.wasFiring = false;
    this.burstTime = 0;
    this.shotClock = 0;
    this.buckets = Array.from({ length: Math.ceil(duration / bucketSize) }, () => ({
      firing: 0,
      onTarget: 0,
    }));
  }

  get finished() {
    return this.elapsed >= this.duration - 1e-9;
  }

  get remaining() {
    return Math.max(0, this.duration - this.elapsed);
  }

  get accuracy() {
    return this.firingTime > 0 ? this.onTargetTime / this.firingTime : 0;
  }

  get score() {
    return Math.round(this.points);
  }

  /**
   * @param {number} dt seconds since the previous update
   * @param {{firing: boolean, zone: null | 'target' | 'body' | 'head' | 'legs'}} frame
   * @returns {{shots: number, hitZone: string | null}} shots fired during this step
   */
  update(dt, { firing, zone }) {
    if (this.finished || !(dt > 0)) return { shots: 0, hitZone: null };
    const step = Math.min(dt, this.duration - this.elapsed);
    const aimed = Boolean(zone);
    const hitting = firing && aimed;

    this.#fillBuckets(step, firing, hitting);

    if (firing) this.firingTime += step;
    if (hitting) {
      this.onTargetTime += step;
      this.points += step * (ZONE_POINTS[zone] ?? ZONE_POINTS.target);
      if (zone === 'head') this.headTime += step;
      this.streak += step;
      this.longestStreak = Math.max(this.longestStreak, this.streak);
    } else {
      this.streak = 0;
    }

    // Recovery time: how long the crosshair stays off the target after losing it.
    if (aimed) {
      if (!this.onTarget && this.hasAcquired && this.gap >= MIN_LOSS_DURATION) {
        this.losses.push(this.gap);
      }
      this.hasAcquired = true;
      this.gap = 0;
    } else {
      this.gap += step;
    }
    this.onTarget = aimed;
    this.elapsed += step;

    const shots = this.weapon ? this.#fireShots(step, firing, zone) : 0;
    return { shots, hitZone: shots > 0 && aimed ? zone : null };
  }

  /** Fire at the weapon's rate: the first shot leaves the moment the trigger is pulled. */
  #fireShots(step, firing, zone) {
    if (!firing) {
      this.wasFiring = false;
      this.burstTime = 0;
      this.shotClock = 0;
      return 0;
    }
    let shots = 0;
    if (!this.wasFiring) {
      this.wasFiring = true;
      this.shotClock = 1 / fireRateAt(this.weapon, 0);
    }
    this.shotClock += step;
    this.burstTime += step;
    let interval = 1 / fireRateAt(this.weapon, this.burstTime);
    while (this.shotClock >= interval) {
      this.shotClock -= interval;
      shots += 1;
      this.shots += 1;
      if (zone) {
        this.hits += 1;
        if (zone === 'head') this.headHits += 1;
        this.damage += damageFor(this.weapon, zone);
      }
      interval = 1 / fireRateAt(this.weapon, this.burstTime);
    }
    return shots;
  }

  #fillBuckets(step, firing, hitting) {
    let t = this.elapsed;
    let left = step;
    while (left > 1e-12) {
      const index = Math.min(this.buckets.length - 1, Math.floor(t / this.bucketSize + 1e-9));
      // The last bucket absorbs any floating point remainder.
      const end = index === this.buckets.length - 1 ? Infinity : (index + 1) * this.bucketSize;
      const part = Math.min(left, end - t);
      if (part <= 0) break;
      const bucket = this.buckets[index];
      if (firing) bucket.firing += part;
      if (hitting) bucket.onTarget += part;
      t += part;
      left -= part;
    }
  }

  results() {
    const avg = this.losses.length
      ? this.losses.reduce((sum, value) => sum + value, 0) / this.losses.length
      : null;
    return {
      score: this.score,
      accuracy: this.accuracy,
      timeOnTarget: this.onTargetTime,
      firingTime: this.firingTime,
      longestStreak: this.longestStreak,
      avgRecovery: avg,
      targetLosses: this.losses.length,
      headshotRate: this.tracksHead && this.onTargetTime > 0 ? this.headTime / this.onTargetTime : null,
      shots: this.shots,
      hits: this.hits,
      headHits: this.headHits,
      damage: this.damage,
      timeline: this.buckets.map((b) => (b.firing > 0 ? Math.round((b.onTarget / b.firing) * 1000) / 1000 : null)),
    };
  }
}
