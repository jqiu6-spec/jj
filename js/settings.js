// Persistent user settings and sensitivity math.

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
