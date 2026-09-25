// Weapon skins: colours, finish and pattern for each gun. Pure data and
// validation; the viewmodel turns a skin into materials.

import { WEAPONS } from './weapons.js';

export const FINISHES = {
  matte: { label: 'Matte', roughness: 0.78, metalness: 0.2, clearcoat: 0 },
  satin: { label: 'Satin', roughness: 0.52, metalness: 0.6, clearcoat: 0 },
  gloss: { label: 'Gloss', roughness: 0.28, metalness: 0.5, clearcoat: 0.7 },
  chrome: { label: 'Chrome', roughness: 0.16, metalness: 1, clearcoat: 0 },
};

export const PATTERNS = {
  none: { label: 'None' },
  stripes: { label: 'Stripes' },
  hex: { label: 'Hex' },
  carbon: { label: 'Carbon' },
  camo: { label: 'Camo' },
};

export const DEFAULT_SKIN = Object.freeze({
  body: '#2e343d',
  accent: '#36e2c4',
  grip: '#262b33',
  finish: 'satin',
  pattern: 'none',
  glow: true,
});

export const SKIN_PRESETS = [
  { id: 'stock', name: 'Stock', skin: { ...DEFAULT_SKIN } },
  { id: 'frost', name: 'Frost', skin: { body: '#dfe8f2', accent: '#4fb7ff', grip: '#8ea3b8', finish: 'gloss', pattern: 'hex', glow: true } },
  { id: 'ember', name: 'Ember', skin: { body: '#3a1d1d', accent: '#ff7a1a', grip: '#1f1414', finish: 'satin', pattern: 'stripes', glow: true } },
  { id: 'volt', name: 'Volt', skin: { body: '#15181d', accent: '#d8ff3a', grip: '#2a2f14', finish: 'matte', pattern: 'carbon', glow: true } },
  { id: 'onyx', name: 'Onyx', skin: { body: '#0e0f12', accent: '#8a8f98', grip: '#141518', finish: 'gloss', pattern: 'none', glow: false } },
  { id: 'gilded', name: 'Gilded', skin: { body: '#c9a24a', accent: '#fff1c2', grip: '#2b2114', finish: 'chrome', pattern: 'none', glow: false } },
  { id: 'jungle', name: 'Jungle', skin: { body: '#4d5a3c', accent: '#d9c36a', grip: '#2f3624', finish: 'matte', pattern: 'camo', glow: false } },
  { id: 'rose', name: 'Rose', skin: { body: '#f2dfe6', accent: '#ff4f8b', grip: '#5a2a3c', finish: 'gloss', pattern: 'none', glow: true } },
];

/** Swatches offered in the editor for each colour role. */
export const SKIN_SWATCHES = {
  body: ['#2e343d', '#0e0f12', '#dfe8f2', '#3a1d1d', '#1f3a5a', '#4d5a3c', '#c9a24a', '#f2dfe6', '#5a2a7a'],
  accent: ['#36e2c4', '#4fb7ff', '#ff7a1a', '#d8ff3a', '#ff4f8b', '#fff1c2', '#b58cff', '#ffffff', '#8a8f98'],
  grip: ['#262b33', '#141518', '#8ea3b8', '#1f1414', '#2a2f14', '#2b2114', '#5a2a3c', '#3b3f47', '#6b4a2a'],
};

const HEX = /^#[0-9a-f]{6}$/i;

function color(value, fallback) {
  return typeof value === 'string' && HEX.test(value) ? value.toLowerCase() : fallback;
}

export function sanitizeSkin(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_SKIN;
  return {
    body: color(s.body, d.body),
    accent: color(s.accent, d.accent),
    grip: color(s.grip, d.grip),
    finish: s.finish in FINISHES ? s.finish : d.finish,
    pattern: s.pattern in PATTERNS ? s.pattern : d.pattern,
    glow: typeof s.glow === 'boolean' ? s.glow : d.glow,
  };
}

/** A skin for every weapon, validating stored values and dropping unknown weapons. */
export function sanitizeSkins(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return Object.fromEntries(WEAPONS.map((w) => [w.id, sanitizeSkin(s[w.id])]));
}

export function skinsEqual(a, b) {
  return skinKey(a) === skinKey(b);
}

/** Stable identity of a skin, used to know when materials must be rebuilt. */
export function skinKey(skin) {
  const s = sanitizeSkin(skin);
  return `${s.body}|${s.accent}|${s.grip}|${s.finish}|${s.pattern}|${s.glow ? 1 : 0}`;
}

/** Which preset (if any) a skin currently matches. */
export function matchingPreset(skin) {
  const key = skinKey(skin);
  return SKIN_PRESETS.find((preset) => skinKey(preset.skin) === key)?.id ?? null;
}
