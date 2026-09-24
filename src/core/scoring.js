// Scoring for a tracking run. The run is advanced with small time steps; each
// step is credited to the target if the crosshair ray was on it while firing.

/** Points per second of time on target, by hit zone. */
export const ZONE_POINTS = { target: 100, body: 100, head: 200 };

/** Off-target gaps shorter than this are edge jitter, not a lost target. */
export const MIN_LOSS_DURATION = 0.1;

export class TrackingSession {
  constructor({ duration, tracksHead = false, bucketSize = 1 }) {
    this.duration = duration;
    this.tracksHead = tracksHead;
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
   * @param {{firing: boolean, zone: null | 'target' | 'body' | 'head'}} frame
   */
  update(dt, { firing, zone }) {
    if (this.finished || !(dt > 0)) return;
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
      timeline: this.buckets.map((b) => (b.firing > 0 ? Math.round((b.onTarget / b.firing) * 1000) / 1000 : null)),
    };
  }
}
