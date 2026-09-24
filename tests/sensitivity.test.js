import { describe, expect, it } from 'vitest';
import {
  clampSensitivity,
  cmPer360,
  convertSensitivity,
  countsToDegrees,
  edpi,
  formatSensitivity,
  GAMES,
  horizontalToVerticalFov,
  parseSensitivity,
  roundTo,
  SENS_MAX,
  SENS_MIN,
  sensitivityFromCm360,
  sensitivityToSlider,
  sliderToSensitivity,
} from '../src/core/sensitivity.js';
import { sensitivityStep } from '../src/ui/sensitivityControl.js';

describe('Valorant sensitivity math', () => {
  it('matches known cm/360 values', () => {
    // 0.4 @ 800 DPI is the classic ~40.8 cm/360 in Valorant.
    expect(cmPer360(0.4, 800)).toBeCloseTo(40.82, 2);
    expect(cmPer360(0.25, 1600)).toBeCloseTo(32.66, 2);
    expect(cmPer360(1, 400)).toBeCloseTo(32.66, 2);
  });

  it('turns 0.07 degrees per count at sensitivity 1', () => {
    expect(countsToDegrees(1, 1)).toBeCloseTo(0.07, 10);
    // A full 360 at 0.4 sens takes 360 / 0.028 counts.
    expect(countsToDegrees(360 / 0.028, 0.4)).toBeCloseTo(360, 8);
  });

  it('computes eDPI and inverts cm/360', () => {
    expect(edpi(0.4, 800)).toBeCloseTo(320, 10);
    expect(sensitivityFromCm360(cmPer360(0.37, 1200), 1200)).toBeCloseTo(0.37, 10);
    expect(sensitivityFromCm360(0, 800)).toBeNull();
  });

  it('handles the extreme ends of the range', () => {
    expect(cmPer360(SENS_MAX, 800)).toBeCloseTo(0.1633, 3);
    expect(cmPer360(SENS_MIN, 800)).toBeCloseTo(163286, -1);
    expect(cmPer360(0, 800)).toBe(Infinity);
  });
});

describe('clamping and parsing (0.0001 – 100)', () => {
  it('clamps to the supported range', () => {
    expect(clampSensitivity(0)).toBe(SENS_MIN);
    expect(clampSensitivity(-3)).toBe(SENS_MIN);
    expect(clampSensitivity(0.00004)).toBe(SENS_MIN);
    expect(clampSensitivity(250)).toBe(SENS_MAX);
    expect(clampSensitivity(Number.NaN)).toBe(SENS_MIN);
  });

  it('keeps 4 decimals with correct rounding', () => {
    expect(clampSensitivity(0.12345)).toBe(0.1235);
    expect(clampSensitivity(0.00015)).toBe(0.0002);
    expect(clampSensitivity(1.005)).toBe(1.005);
    expect(roundTo(2.675, 2)).toBe(2.68);
  });

  it('parses user input', () => {
    expect(parseSensitivity('0.4')).toBe(0.4);
    expect(parseSensitivity(' 0,35 ')).toBe(0.35);
    expect(parseSensitivity('100')).toBe(100);
    expect(parseSensitivity('0.0001')).toBe(0.0001);
    expect(parseSensitivity('1e-4')).toBe(0.0001);
    expect(parseSensitivity('9999')).toBe(100);
    expect(parseSensitivity('')).toBeNull();
    expect(parseSensitivity('abc')).toBeNull();
    expect(parseSensitivity(null)).toBeNull();
  });

  it('formats without trailing zeros', () => {
    expect(formatSensitivity(0.4)).toBe('0.4');
    expect(formatSensitivity(100)).toBe('100');
    expect(formatSensitivity(0.0001)).toBe('0.0001');
    expect(formatSensitivity(10.05)).toBe('10.05');
    expect(formatSensitivity(1)).toBe('1');
  });
});

describe('logarithmic slider', () => {
  it('spans exactly 0.0001 to 100', () => {
    expect(sliderToSensitivity(0)).toBe(SENS_MIN);
    expect(sliderToSensitivity(1)).toBe(SENS_MAX);
    expect(sliderToSensitivity(-1)).toBe(SENS_MIN);
    expect(sliderToSensitivity(2)).toBe(SENS_MAX);
  });

  it('puts each power of ten on a sixth of the track', () => {
    expect(sliderToSensitivity(4 / 6)).toBe(1);
    expect(sliderToSensitivity(3 / 6)).toBe(0.1);
    expect(sensitivityToSlider(0.01)).toBeCloseTo(2 / 6, 10);
  });

  it('round-trips within 3 significant figures', () => {
    for (const sens of [0.0003, 0.012, 0.25, 0.4, 1.7, 33, 99.5]) {
      const back = sliderToSensitivity(sensitivityToSlider(sens));
      expect(Math.abs(back - sens) / sens).toBeLessThan(0.005);
    }
  });

  it('is monotonic', () => {
    let previous = 0;
    for (let i = 0; i <= 6000; i += 7) {
      const value = sliderToSensitivity(i / 6000);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });
});

describe('arrow-key steps', () => {
  it('scales with magnitude and never gets stuck at the minimum', () => {
    expect(sensitivityStep(0.4)).toBeCloseTo(0.01, 10);
    expect(sensitivityStep(2.5)).toBeCloseTo(0.1, 10);
    expect(sensitivityStep(0.004)).toBeCloseTo(0.0001, 10);
    expect(sensitivityStep(SENS_MIN)).toBe(SENS_MIN);
    expect(clampSensitivity(SENS_MIN + sensitivityStep(SENS_MIN))).toBe(0.0002);
    expect(sensitivityStep(0.4, true)).toBeCloseTo(0.1, 10);
  });
});

describe('game conversion and FOV', () => {
  it('converts CS2 and Overwatch to Valorant', () => {
    const cs2 = GAMES.find((g) => g.id === 'cs2');
    const ow = GAMES.find((g) => g.id === 'overwatch');
    // Valorant = CS2 / 3.181818...
    expect(convertSensitivity(1.27, cs2.yaw)).toBeCloseTo(0.3991, 4);
    expect(convertSensitivity(4.24, ow.yaw)).toBeCloseTo(0.3998, 4);
    expect(convertSensitivity(-1, cs2.yaw)).toBeNull();
  });

  it('converts Valorant 103° horizontal FOV at 16:9 to ~70.5° vertical', () => {
    expect(horizontalToVerticalFov(103, 16 / 9)).toBeCloseTo(70.53, 1);
    expect(horizontalToVerticalFov(90, 1)).toBeCloseTo(90, 8);
  });
});
