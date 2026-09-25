import { describe, expect, it } from 'vitest';
import { DEFAULT_SKIN, FINISHES, matchingPreset, PATTERNS, sanitizeSkin, sanitizeSkins, SKIN_PRESETS, skinKey, skinsEqual } from '../src/core/skins.js';
import { sanitizeSettings } from '../src/core/settings.js';
import { WEAPONS } from '../src/core/weapons.js';

describe('weapon skins', () => {
  it('repairs invalid values', () => {
    const skin = sanitizeSkin({ body: 'red', accent: '#ABCDEF', finish: 'wet', pattern: 42, glow: 'yes' });
    expect(skin).toEqual({ ...DEFAULT_SKIN, accent: '#abcdef' });
    expect(sanitizeSkin(null)).toEqual(DEFAULT_SKIN);
  });

  it('ships valid presets', () => {
    for (const preset of SKIN_PRESETS) {
      expect(sanitizeSkin(preset.skin)).toEqual(preset.skin);
      expect(preset.skin.finish in FINISHES).toBe(true);
      expect(preset.skin.pattern in PATTERNS).toBe(true);
    }
    expect(matchingPreset(DEFAULT_SKIN)).toBe('stock');
    expect(matchingPreset({ ...DEFAULT_SKIN, body: '#123456' })).toBeNull();
  });

  it('gives every weapon a skin and drops unknown ones', () => {
    const skins = sanitizeSkins({ vandal: { body: '#112233' }, laser: { body: '#ffffff' } });
    expect(Object.keys(skins).sort()).toEqual(WEAPONS.map((w) => w.id).sort());
    expect(skins.vandal.body).toBe('#112233');
    expect(skins.phantom).toEqual(DEFAULT_SKIN);
    expect(skins.laser).toBeUndefined();
  });

  it('is part of the settings', () => {
    const settings = sanitizeSettings({ skins: { odin: { finish: 'chrome', glow: false } } });
    expect(settings.skins.odin.finish).toBe('chrome');
    expect(settings.skins.odin.glow).toBe(false);
    expect(settings.skins.vandal).toEqual(DEFAULT_SKIN);
  });

  it('compares skins by content', () => {
    expect(skinsEqual({ ...DEFAULT_SKIN }, { ...DEFAULT_SKIN, body: '#2E343D' })).toBe(true);
    expect(skinKey({ ...DEFAULT_SKIN, glow: false })).not.toBe(skinKey(DEFAULT_SKIN));
  });
});
