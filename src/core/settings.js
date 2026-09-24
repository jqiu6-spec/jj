import { clampDpi, clampSensitivity, VALORANT_FOV } from './sensitivity.js';
import { DEFAULT_WEAPON, WEAPONS } from './weapons.js';

export const SETTINGS_KEY = 'tracklock.settings.v1';

export const CROSSHAIR_COLORS = [
  { name: 'White', value: '#ffffff' },
  { name: 'Green', value: '#00ff00' },
  { name: 'Yellow green', value: '#7fff00' },
  { name: 'Green yellow', value: '#dfff00' },
  { name: 'Yellow', value: '#ffff00' },
  { name: 'Cyan', value: '#00ffff' },
  { name: 'Pink', value: '#ff00ff' },
  { name: 'Red', value: '#ff0000' },
];

export const TARGET_COLORS = [
  { name: 'Red', value: '#ff3b4a' },
  { name: 'Yellow', value: '#f2e24a' },
  { name: 'Purple', value: '#c35cff' },
  { name: 'Cyan', value: '#2fdde6' },
  { name: 'Orange', value: '#ff8a2b' },
];

export const DEFAULT_CROSSHAIR = Object.freeze({
  color: '#00ffff',
  outline: true,
  outlineOpacity: 0.5,
  outlineThickness: 1,
  centerDot: false,
  centerDotOpacity: 1,
  centerDotThickness: 2,
  innerLines: true,
  innerOpacity: 0.8,
  innerLength: 6,
  innerThickness: 2,
  innerOffset: 3,
  outerLines: false,
  outerOpacity: 0.35,
  outerLength: 2,
  outerThickness: 2,
  outerOffset: 10,
});

export const DEFAULT_SETTINGS = Object.freeze({
  // Mouse
  sensitivity: 0.4,
  dpi: 800,
  invertY: false,
  rawInput: true,
  inputMultiplier: 1,
  fov: VALORANT_FOV,
  // Gameplay
  fireMode: 'auto',
  weapon: DEFAULT_WEAPON,
  countdown: true,
  targetColor: TARGET_COLORS[0].value,
  hitFeedback: true,
  hitMarker: true,
  damageNumbers: true,
  showWeapon: true,
  shotEffects: true,
  customSpeed: 1,
  customSize: 1,
  // Video
  renderScale: 1,
  shadows: true,
  showFps: true,
  fullscreen: false,
  // Audio
  volume: 0.5,
  hitSounds: true,
  weaponSounds: true,
  uiSounds: true,
  // Last launch choices
  scenario: 'smooth',
  difficulty: 'normal',
  duration: 60,
  crosshair: DEFAULT_CROSSHAIR,
});

export const FIRE_MODES = ['auto', 'hold'];
export const DIFFICULTY_IDS = ['easy', 'normal', 'hard', 'insane', 'custom'];
export const DURATIONS = [30, 60, 90, 120];

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function num(value, fallback, min, max, decimals = null) {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  let clamped = Math.min(max, Math.max(min, n));
  if (decimals !== null) clamped = Number(clamped.toFixed(decimals));
  return clamped;
}

function bool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function oneOf(value, fallback, options) {
  return options.includes(value) ? value : fallback;
}

function color(value, fallback) {
  return typeof value === 'string' && HEX_COLOR.test(value) ? value.toLowerCase() : fallback;
}

export function sanitizeCrosshair(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_CROSSHAIR;
  return {
    color: color(c.color, d.color),
    outline: bool(c.outline, d.outline),
    outlineOpacity: num(c.outlineOpacity, d.outlineOpacity, 0, 1, 2),
    outlineThickness: num(c.outlineThickness, d.outlineThickness, 1, 6, 0),
    centerDot: bool(c.centerDot, d.centerDot),
    centerDotOpacity: num(c.centerDotOpacity, d.centerDotOpacity, 0, 1, 2),
    centerDotThickness: num(c.centerDotThickness, d.centerDotThickness, 1, 10, 0),
    innerLines: bool(c.innerLines, d.innerLines),
    innerOpacity: num(c.innerOpacity, d.innerOpacity, 0, 1, 2),
    innerLength: num(c.innerLength, d.innerLength, 0, 30, 0),
    innerThickness: num(c.innerThickness, d.innerThickness, 1, 10, 0),
    innerOffset: num(c.innerOffset, d.innerOffset, 0, 30, 0),
    outerLines: bool(c.outerLines, d.outerLines),
    outerOpacity: num(c.outerOpacity, d.outerOpacity, 0, 1, 2),
    outerLength: num(c.outerLength, d.outerLength, 0, 30, 0),
    outerThickness: num(c.outerThickness, d.outerThickness, 1, 10, 0),
    outerOffset: num(c.outerOffset, d.outerOffset, 0, 40, 0),
  };
}

/** Merge stored settings over the defaults, repairing anything invalid. */
export function sanitizeSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_SETTINGS;
  const sensitivity = typeof s.sensitivity === 'number' ? clampSensitivity(s.sensitivity) : d.sensitivity;
  const dpi = typeof s.dpi === 'number' ? clampDpi(s.dpi) : d.dpi;
  const duration = Number(s.duration);
  return {
    sensitivity,
    dpi,
    invertY: bool(s.invertY, d.invertY),
    rawInput: bool(s.rawInput, d.rawInput),
    inputMultiplier: num(s.inputMultiplier, d.inputMultiplier, 0.01, 10, 4),
    fov: num(s.fov, d.fov, 60, 130, 0),
    fireMode: oneOf(s.fireMode, d.fireMode, FIRE_MODES),
    weapon: oneOf(s.weapon, d.weapon, WEAPONS.map((w) => w.id)),
    countdown: bool(s.countdown, d.countdown),
    targetColor: color(s.targetColor, d.targetColor),
    hitFeedback: bool(s.hitFeedback, d.hitFeedback),
    hitMarker: bool(s.hitMarker, d.hitMarker),
    damageNumbers: bool(s.damageNumbers, d.damageNumbers),
    showWeapon: bool(s.showWeapon, d.showWeapon),
    shotEffects: bool(s.shotEffects, d.shotEffects),
    customSpeed: num(s.customSpeed, d.customSpeed, 0.25, 3, 2),
    customSize: num(s.customSize, d.customSize, 0.25, 3, 2),
    renderScale: num(s.renderScale, d.renderScale, 0.5, 1.5, 2),
    shadows: bool(s.shadows, d.shadows),
    showFps: bool(s.showFps, d.showFps),
    fullscreen: bool(s.fullscreen, d.fullscreen),
    volume: num(s.volume, d.volume, 0, 1, 2),
    hitSounds: bool(s.hitSounds, d.hitSounds),
    weaponSounds: bool(s.weaponSounds, d.weaponSounds),
    uiSounds: bool(s.uiSounds, d.uiSounds),
    scenario: typeof s.scenario === 'string' ? s.scenario : d.scenario,
    difficulty: oneOf(s.difficulty, d.difficulty, DIFFICULTY_IDS),
    duration: DURATIONS.includes(duration) ? duration : d.duration,
    crosshair: sanitizeCrosshair(s.crosshair),
  };
}

export function loadSettings(storage) {
  return sanitizeSettings(storage.getJSON(SETTINGS_KEY, {}));
}

export function saveSettings(storage, settings) {
  return storage.setJSON(SETTINGS_KEY, settings);
}

/** Read a dotted path such as "crosshair.innerLength". */
export function getPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

/** Return a copy of `obj` with the dotted `path` replaced by `value`. */
export function setPath(obj, path, value) {
  const [head, ...rest] = path.split('.');
  if (rest.length === 0) return { ...obj, [head]: value };
  return { ...obj, [head]: setPath(obj[head] ?? {}, rest.join('.'), value) };
}
