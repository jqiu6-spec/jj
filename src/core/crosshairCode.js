// Valorant crosshair profile codes, e.g. "0;s;1;P;c;5;h;0;0l;4;0o;2;0a;1;0f;0;1b;0".
// A code is "0" followed by key;value pairs grouped into sections: general
// settings, then P (primary), A (aim down sights) and S (sniper). Only values
// that differ from Valorant's defaults are written. Tracklock uses the primary
// crosshair, which is also what Valorant shows while hip-firing.

import { CROSSHAIR_COLORS, sanitizeCrosshair } from './settings.js';

const SECTIONS = new Set(['P', 'A', 'S']);
const CUSTOM_COLOR_INDEX = 8;

/** Valorant's defaults for the primary crosshair keys Tracklock understands. */
const DEFAULTS = {
  c: 0, // color index: white
  h: 1, // outlines on
  t: 1, // outline thickness
  o: 0.5, // outline opacity
  d: 0, // center dot off
  z: 2, // center dot thickness
  a: 1, // center dot opacity
  '0b': 1, // inner lines shown
  '0t': 2,
  '0l': 6,
  '0o': 3,
  '0a': 0.8,
  '1b': 1, // outer lines shown
  '1t': 2,
  '1l': 2,
  '1o': 10,
  '1a': 0.35,
};

export class CrosshairCodeError extends Error {}

function tokenize(code) {
  const tokens = String(code ?? '')
    .trim()
    .replace(/;$/, '')
    .split(';')
    .map((t) => t.trim());
  if (tokens[0] !== '0') {
    throw new CrosshairCodeError('Valorant crosshair codes start with “0;”. Copy it from Settings → Crosshair → Profile → Export.');
  }
  const sections = { general: {}, P: {}, A: {}, S: {} };
  let section = 'general';
  for (let i = 1; i < tokens.length; ) {
    const token = tokens[i];
    if (SECTIONS.has(token)) {
      section = token;
      i += 1;
      continue;
    }
    const value = tokens[i + 1];
    if (!/^[0-9a-z]{1,3}$/i.test(token) || value === undefined || value === '') {
      throw new CrosshairCodeError(`The code is incomplete or damaged near “${token || '…'}”.`);
    }
    sections[section][token] = value;
    i += 2;
  }
  return sections;
}

function number(values, key) {
  if (!(key in values)) return DEFAULTS[key];
  const n = Number(values[key]);
  if (!Number.isFinite(n)) throw new CrosshairCodeError(`“${key}” should be a number, got “${values[key]}”.`);
  return n;
}

function colorFrom(values) {
  const index = number(values, 'c');
  if (index === CUSTOM_COLOR_INDEX) {
    const hex = String(values.u ?? '').replace(/^#/, '');
    return /^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex) ? `#${hex.slice(0, 6).toLowerCase()}` : CROSSHAIR_COLORS[0].value;
  }
  return CROSSHAIR_COLORS[index]?.value ?? CROSSHAIR_COLORS[0].value;
}

/** Turn a Valorant crosshair code into Tracklock crosshair settings. */
export function parseCrosshairCode(code) {
  const { P: p } = tokenize(code);
  const innerThickness = number(p, '0t');
  const innerLength = number(p, '0l');
  const outerThickness = number(p, '1t');
  const outerLength = number(p, '1l');
  const dotThickness = number(p, 'z');
  return sanitizeCrosshair({
    color: colorFrom(p),
    outline: number(p, 'h') !== 0,
    outlineThickness: number(p, 't'),
    outlineOpacity: number(p, 'o'),
    // Valorant allows zero thickness/length, which simply draws nothing.
    centerDot: number(p, 'd') !== 0 && dotThickness > 0,
    centerDotThickness: dotThickness,
    centerDotOpacity: number(p, 'a'),
    innerLines: number(p, '0b') !== 0 && innerThickness > 0 && innerLength > 0,
    innerThickness,
    innerLength,
    innerOffset: number(p, '0o'),
    innerOpacity: number(p, '0a'),
    outerLines: number(p, '1b') !== 0 && outerThickness > 0 && outerLength > 0,
    outerThickness,
    outerLength,
    outerOffset: number(p, '1o'),
    outerOpacity: number(p, '1a'),
  });
}

function formatValue(value) {
  return String(Number(value.toFixed(3)));
}

/**
 * Build a Valorant code for a Tracklock crosshair. Tracklock's lines never
 * spread, so the code also turns off movement and firing error.
 */
export function toCrosshairCode(cfg) {
  const parts = ['0', 'P'];
  const put = (key, value) => {
    if (value !== DEFAULTS[key]) parts.push(key, formatValue(value));
  };
  const index = CROSSHAIR_COLORS.findIndex((c) => c.value === cfg.color.toLowerCase());
  if (index >= 0) put('c', index);
  else parts.push('c', String(CUSTOM_COLOR_INDEX), 'u', `${cfg.color.slice(1).toUpperCase()}FF`);
  put('h', cfg.outline ? 1 : 0);
  put('t', cfg.outlineThickness);
  put('o', cfg.outlineOpacity);
  put('d', cfg.centerDot ? 1 : 0);
  put('z', cfg.centerDotThickness);
  put('a', cfg.centerDotOpacity);
  put('0b', cfg.innerLines ? 1 : 0);
  if (cfg.innerLines) {
    put('0t', cfg.innerThickness);
    put('0l', cfg.innerLength);
    put('0o', cfg.innerOffset);
    put('0a', cfg.innerOpacity);
    parts.push('0m', '0', '0f', '0');
  }
  put('1b', cfg.outerLines ? 1 : 0);
  if (cfg.outerLines) {
    put('1t', cfg.outerThickness);
    put('1l', cfg.outerLength);
    put('1o', cfg.outerOffset);
    put('1a', cfg.outerOpacity);
    parts.push('1m', '0', '1f', '0');
  }
  return parts.join(';');
}
