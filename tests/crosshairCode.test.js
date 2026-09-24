import { describe, expect, it } from 'vitest';
import { CrosshairCodeError, parseCrosshairCode, toCrosshairCode } from '../src/core/crosshairCode.js';
import { DEFAULT_CROSSHAIR, sanitizeCrosshair } from '../src/core/settings.js';

describe('Valorant crosshair codes', () => {
  it('reads a typical pro code', () => {
    const cfg = parseCrosshairCode('0;s;1;P;c;5;h;0;m;1;0l;4;0o;2;0a;1;0f;0;1b;0');
    expect(cfg).toMatchObject({
      color: '#00ffff',
      outline: false,
      innerLines: true,
      innerLength: 4,
      innerOffset: 2,
      innerOpacity: 1,
      innerThickness: 2,
      outerLines: false,
      centerDot: false,
    });
  });

  it('uses Valorant defaults for missing keys', () => {
    const cfg = parseCrosshairCode('0');
    expect(cfg).toMatchObject({
      color: '#ffffff',
      outline: true,
      outlineOpacity: 0.5,
      outlineThickness: 1,
      innerLines: true,
      innerLength: 6,
      innerOffset: 3,
      innerOpacity: 0.8,
      outerLines: true,
      outerLength: 2,
      outerOffset: 10,
      outerOpacity: 0.35,
    });
  });

  it('reads a center-dot-only crosshair with a custom color', () => {
    const cfg = parseCrosshairCode('0;P;c;8;u;FF8800FF;h;1;t;2;o;1;d;1;z;3;a;1;0b;0;1b;0');
    expect(cfg).toMatchObject({
      color: '#ff8800',
      outlineThickness: 2,
      outlineOpacity: 1,
      centerDot: true,
      centerDotThickness: 3,
      innerLines: false,
      outerLines: false,
    });
  });

  it('only uses the primary section', () => {
    const cfg = parseCrosshairCode('0;P;c;1;0l;5;A;c;7;0l;9;S;c;3');
    expect(cfg.color).toBe('#00ff00');
    expect(cfg.innerLength).toBe(5);
  });

  it('treats zero thickness or length as hidden lines', () => {
    expect(parseCrosshairCode('0;P;0t;0').innerLines).toBe(false);
    expect(parseCrosshairCode('0;P;1l;0').outerLines).toBe(false);
  });

  it('tolerates whitespace and a trailing semicolon', () => {
    expect(parseCrosshairCode('  0;P;c;7;  ').color).toBe('#ff0000');
    expect(parseCrosshairCode('0;P;c;7;').color).toBe('#ff0000');
  });

  it('rejects things that are not crosshair codes', () => {
    for (const bad of ['', 'hello', '1;P;c;5', '0;P;c', '0;P;c;five', null]) {
      expect(() => parseCrosshairCode(bad)).toThrow(CrosshairCodeError);
    }
  });

  it('round-trips Tracklock crosshairs', () => {
    const samples = [
      DEFAULT_CROSSHAIR,
      { ...DEFAULT_CROSSHAIR, color: '#123abc', outline: false, centerDot: true, centerDotThickness: 4, innerLines: false },
      { ...DEFAULT_CROSSHAIR, outerLines: true, outerLength: 5, outerOffset: 14, outerOpacity: 0.6, innerOpacity: 1 },
    ];
    for (const sample of samples) {
      const cfg = sanitizeCrosshair(sample);
      expect(parseCrosshairCode(toCrosshairCode(cfg))).toEqual(cfg);
    }
  });

  it('writes compact codes with static lines', () => {
    const code = toCrosshairCode(sanitizeCrosshair({ ...DEFAULT_CROSSHAIR, color: '#00ffff' }));
    expect(code.startsWith('0;P;c;5;')).toBe(true);
    expect(code).toContain('0f;0');
    expect(code).toContain('1b;0');
    expect(code).not.toContain('0l;'); // default length is omitted
  });
});
