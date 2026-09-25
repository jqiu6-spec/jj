import { s } from './dom.js';

const common = { fill: 'none', stroke: 'currentColor', 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
const dot = (cx, cy, r = 5) => s('circle', { cx, cy, r, class: 'icon-target' });

const ICONS = {
  smooth: () => [s('path', { ...common, d: 'M6 38 C 16 8, 28 42, 40 20 S 54 14, 58 10', opacity: 0.55 }), dot(58, 10)],
  strafe: () => [
    s('circle', { cx: 32, cy: 11, r: 5, class: 'icon-target' }),
    s('rect', { x: 26, y: 18, width: 12, height: 24, rx: 6, fill: 'currentColor', opacity: 0.8 }),
    s('path', { ...common, d: 'M18 30 H6 M10 25 L5 30 L10 35 M46 30 H58 M54 25 L59 30 L54 35', opacity: 0.55 }),
  ],
  reactive: () => [s('path', { ...common, d: 'M6 36 L20 14 L32 32 L46 10 L58 26', opacity: 0.55 }), dot(58, 26)],
  air: () => [s('path', { ...common, d: 'M4 44 Q 16 0 28 44 Q 40 12 52 44', opacity: 0.55 }), dot(40, 24)],
  micro: () => [
    s('path', { ...common, d: 'M24 26 l6 -6 l4 8 l6 -5 l-3 9 l5 2', opacity: 0.55 }),
    s('circle', { cx: 32, cy: 24, r: 14, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, opacity: 0.35 }),
    dot(42, 30, 4),
  ],
  sphere: () => [
    s('path', { ...common, d: 'M8 30 L18 12 L30 34 L42 8 L52 24 L58 16', opacity: 0.55 }),
    s('circle', { cx: 42, cy: 8, r: 3, fill: 'currentColor', opacity: 0.5 }),
    dot(30, 34, 6),
  ],
  cinematic: () => [s('path', { ...common, d: 'M4 30 C 18 6, 30 6, 40 26 S 56 30, 60 18', opacity: 0.55 }), dot(40, 26, 6)],
  speedtrack: () => [
    s('path', { ...common, d: 'M6 24 H50 M14 16 L6 24 L14 32 M42 16 L50 24 L42 32', opacity: 0.55 }),
    dot(28, 24),
  ],
  orbit: () => [
    s('circle', { cx: 32, cy: 24, r: 17, fill: 'none', stroke: 'currentColor', 'stroke-width': 3, 'stroke-dasharray': '4 6', opacity: 0.55 }),
    s('circle', { cx: 32, cy: 24, r: 3, fill: 'currentColor' }),
    dot(49, 24),
  ],
};

export function scenarioIcon(id) {
  return s('svg', { viewBox: '0 0 64 48', 'aria-hidden': 'true', class: 'scenario-svg' }, ...(ICONS[id]?.() ?? ICONS.smooth()));
}
