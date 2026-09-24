import { describe, expect, it } from 'vitest';
import { MIN_LOSS_DURATION, TrackingSession } from '../src/core/scoring.js';

const step = (session, seconds, frame, dt = 1 / 120) => {
  const frames = Math.round(seconds / dt);
  for (let i = 0; i < frames; i++) session.update(dt, frame);
};

describe('TrackingSession', () => {
  it('scores 100 points per second on target', () => {
    const session = new TrackingSession({ duration: 10 });
    step(session, 10, { firing: true, zone: 'target' });
    expect(session.finished).toBe(true);
    expect(session.score).toBe(1000);
    expect(session.accuracy).toBeCloseTo(1, 6);
  });

  it('never runs past the duration, even with a huge final step', () => {
    const session = new TrackingSession({ duration: 5 });
    session.update(4.9, { firing: true, zone: null });
    session.update(3, { firing: true, zone: 'target' });
    expect(session.elapsed).toBeCloseTo(5, 10);
    expect(session.timeOnTarget ?? session.onTargetTime).toBeCloseTo(0.1, 10);
    session.update(1, { firing: true, zone: 'target' });
    expect(session.elapsed).toBeCloseTo(5, 10);
  });

  it('computes accuracy against firing time in hold mode', () => {
    const session = new TrackingSession({ duration: 4 });
    step(session, 1, { firing: false, zone: 'target' }); // not firing: no credit
    step(session, 1, { firing: true, zone: 'target' });
    step(session, 2, { firing: true, zone: null });
    const r = session.results();
    expect(r.firingTime).toBeCloseTo(3, 6);
    expect(r.timeOnTarget).toBeCloseTo(1, 6);
    expect(r.accuracy).toBeCloseTo(1 / 3, 6);
    expect(r.timeline[0]).toBeNull();
    expect(r.timeline[1]).toBe(1);
    expect(r.timeline[2]).toBe(0);
  });

  it('weights head time double and reports head share for bots', () => {
    const session = new TrackingSession({ duration: 2, tracksHead: true });
    step(session, 1, { firing: true, zone: 'head' });
    step(session, 1, { firing: true, zone: 'body' });
    const r = session.results();
    expect(r.score).toBe(300);
    expect(r.headshotRate).toBeCloseTo(0.5, 6);
    expect(new TrackingSession({ duration: 1 }).results().headshotRate).toBeNull();
  });

  it('tracks the longest streak', () => {
    const session = new TrackingSession({ duration: 6 });
    step(session, 1, { firing: true, zone: 'target' });
    step(session, 0.5, { firing: true, zone: null });
    step(session, 2.5, { firing: true, zone: 'target' });
    step(session, 2, { firing: true, zone: null });
    expect(session.results().longestStreak).toBeCloseTo(2.5, 6);
  });

  it('measures recovery time and ignores edge jitter', () => {
    const session = new TrackingSession({ duration: 5 });
    step(session, 1, { firing: true, zone: 'target' });
    step(session, 0.4, { firing: true, zone: null }); // real loss
    step(session, 1, { firing: true, zone: 'target' });
    step(session, MIN_LOSS_DURATION / 2, { firing: true, zone: null }, 1 / 1000); // jitter
    step(session, 1, { firing: true, zone: 'target' });
    step(session, 0.2, { firing: true, zone: null }); // real loss
    step(session, 1, { firing: true, zone: 'target' });
    const r = session.results();
    expect(r.targetLosses).toBe(2);
    expect(r.avgRecovery).toBeCloseTo(0.3, 2);
  });

  it('splits frames across timeline buckets', () => {
    const session = new TrackingSession({ duration: 2 });
    session.update(0.75, { firing: true, zone: null });
    session.update(0.5, { firing: true, zone: 'target' }); // 0.25 in second 0, 0.25 in second 1
    session.update(0.75, { firing: true, zone: null });
    const { timeline } = session.results();
    expect(timeline).toHaveLength(2);
    expect(timeline[0]).toBeCloseTo(0.25, 3);
    expect(timeline[1]).toBeCloseTo(0.25, 3);
  });

  it('matches totals whatever the frame rate', () => {
    for (const fps of [30, 60, 144, 240, 360]) {
      const session = new TrackingSession({ duration: 3 });
      let t = 0;
      while (!session.finished) {
        const onTarget = Math.floor(t * 2) % 2 === 0; // alternate every 0.5 s
        session.update(1 / fps, { firing: true, zone: onTarget ? 'target' : null });
        t += 1 / fps;
      }
      expect(session.results().accuracy).toBeCloseTo(0.5, 1);
      expect(session.elapsed).toBeCloseTo(3, 9);
    }
  });
});
