// Persistent user settings and sensitivity math.
import { SKIN_PRESETS } from './skins.js';
import { GUNS } from './guns.js';

// Degrees of yaw per mouse count at sensitivity 1.0, per game.
export const GAMES = {
  source: { name: 'CS2 / Apex / Source', yaw: 0.022 },
  valorant: { name: 'Valorant', yaw: 0.07 },
  overwatch: { name: 'Overwatch 2 / CoD', yaw: 0.0066 },
};

export const CROSSHAIR_STYLES = {
  cross: 'Cross',
  crossdot: 'Cross + dot',
  dot: 'Dot',
  circle: 'Circle + dot',
};

export const DEFAULTS = {
  sensMode: 'game', // 'game' | 'cm360'
  game: 'source',
  sens: 1.2,
  cm360: 35,
  dpi: 800,
  fov: 103, // horizontal degrees
  invertY: false,
  autoFire: false, // tracking scenarios fire without holding mouse 1
  volume: 60,
  targetColor: '#ff4f64',
  hitColor: '#ffe066',
  showFps: false,
  render: {
    scale: 1, // fraction of the device pixel ratio (capped at 2) to render at
  },
  weapon: {
    show: true, // gun model in first person
    primary: 'm4a1s', // gun for tracking and clicking runs
    hand: 'right',
    fov: 60, // viewmodel field of view
    sounds: true,
    models: 'detailed', // 'detailed' real meshes, or 'simple' built-in models
  },
  sniper: {
    scopeMode: 'toggle', // 'toggle' cycles 2.5x, 5x, off; 'hold' keeps 2.5x while held
    scopedSens: 1, // multiplier on top of scaling by zoom
    scopeTime: 0.25, // seconds to scope in (estimate; not published for the Operator)
    unscope: true, // drop out of scope after each shot
  },
  crosshair: {
    style: 'crossdot',
    color: '#5cf2c9',
    length: 6,
    thickness: 2,
    gap: 3,
    dot: 2,
    outline: true,
  },
};

const KEY = 'trackline.settings.v1';

function merge(base, over) {
  const out = { ...base };
  for (const k of Object.keys(base)) {
    if (over && k in over) {
      const v = over[k];
      out[k] = base[k] && typeof base[k] === 'object' ? merge(base[k], v) : v;
    }
  }
  return out;
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return merge(DEFAULTS, JSON.parse(raw));
  } catch (e) { /* storage unavailable */ }
  return merge(DEFAULTS, {});
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
}

// Degrees of rotation per raw mouse count.
export function degPerCount(s) {
  if (s.sensMode === 'cm360') {
    const countsPer360 = (s.cm360 / 2.54) * s.dpi;
    return 360 / Math.max(countsPer360, 1);
  }
  const g = GAMES[s.game] || GAMES.source;
  return g.yaw * s.sens;
}

// Centimetres of mouse travel for a full 360° turn.
export function cmPer360(s) {
  if (s.sensMode === 'cm360') return s.cm360;
  const counts = 360 / degPerCount(s);
  return (counts / s.dpi) * 2.54;
}

// Horizontal FOV -> vertical FOV for a given aspect ratio (degrees).
export function verticalFov(hfovDeg, aspect) {
  const h = (hfovDeg * Math.PI) / 180;
  return (2 * Math.atan(Math.tan(h / 2) / aspect) * 180) / Math.PI;
}

// Per-scenario setups (target count, health, hitbox), keyed by scenario id.
const SETUP_KEY = 'trackline.setups.v1';

export function loadSetups() {
  try {
    return JSON.parse(localStorage.getItem(SETUP_KEY)) || {};
  } catch (e) {
    return {};
  }
}

export function saveSetups(s) {
  try { localStorage.setItem(SETUP_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
}

// ------------------------------------------------------------------ skins
// One skin per gun, stored apart from settings because stickers are a list.
const SKINS_KEY = 'trackline.skins.v1';
export const STICKER_SLOTS = 5;

export function presetSkin(presetId) {
  const p = SKIN_PRESETS[presetId] || SKIN_PRESETS.fade;
  const { name, ...rest } = p;
  return { ...rest, zones: { ...(p.zones || {}) }, fx: { ...(p.fx || { type: 'none', color: '#ffd27a', glow: false }) }, fadeReverse: false, preset: presetId };
}

export function defaultSkin(gunId) {
  return {
    ...presetSkin((GUNS[gunId] && GUNS[gunId].defaultPreset) || 'fade', gunId),
    suppressor: true,
    sound: 'auto',
    stickers: Array(STICKER_SLOTS).fill(null),
  };
}

// Skins saved before zones existed had one 'furniture' and one 'accent'
// finish per gun; map those onto the zones each gun has.
const OLD_ZONES = {
  m4a1s: { furniture: ['stock', 'grip'], accent: ['suppressor'] },
  ak47: { furniture: ['stock', 'grip', 'handguard'], accent: ['mag'] },
  xm7: { furniture: ['stock', 'grip'], accent: ['mag'] },
  phantom: { furniture: ['stock', 'grip', 'foregrip', 'mag'], accent: ['suppressor'] },
  awp: { furniture: ['butt', 'mag'], accent: ['scope'] },
};

export function loadSkins() {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(SKINS_KEY)) || {};
  } catch (e) { /* storage unavailable */ }
  const out = {};
  for (const id of Object.keys(GUNS)) {
    const d = defaultSkin(id);
    const s = stored[id] && typeof stored[id] === 'object' ? stored[id] : {};
    const skin = { ...d, ...s };
    if (!s.zones || typeof s.zones !== 'object') {
      skin.zones = {};
      const map = OLD_ZONES[id];
      if (s.furniture && s.furniture !== 'skin') for (const z of map.furniture) skin.zones[z] = s.furniture;
      if (s.accent && s.accent !== 'skin') for (const z of map.accent) skin.zones[z] = s.accent;
      if (!s.furniture && !s.accent) skin.zones = { ...d.zones };
    }
    if (!s.fx || typeof s.fx !== 'object') skin.fx = { ...(SKIN_PRESETS[s.preset] ? SKIN_PRESETS[s.preset].fx : { type: 'none', color: '#ffd27a', glow: false }) };
    delete skin.furniture;
    delete skin.accent;
    const list = Array.isArray(s.stickers) ? s.stickers : [];
    skin.stickers = d.stickers.map((_, i) => list[i] || null);
    out[id] = skin;
  }
  return out;
}

export function saveSkins(skins) {
  try { localStorage.setItem(SKINS_KEY, JSON.stringify(skins)); } catch (e) { /* ignore */ }
}
