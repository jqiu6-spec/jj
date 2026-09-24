// Single-series line chart in SVG with a snapping crosshair + tooltip.
// Marks follow fixed specs: 2px line, 10% area wash, hairline grid,
// 8px dots with a 2px surface ring. Colors come from CSS custom properties.

import { h, s } from './dom.js';

const MARGIN = { top: 16, right: 18, bottom: 28, left: 46 };

/**
 * @param {HTMLElement} host
 * @param {{
 *   points: {x: number, y: number|null, value: string, label: string}[],
 *   xDomain: [number, number], yDomain: [number, number],
 *   yTicks: number[], yFormat: (v: number) => string,
 *   xTicks: {x: number, label: string}[],
 *   ariaLabel: string, showDots?: boolean, area?: boolean,
 *   highlight?: {index: number, text: string} | null,
 * }} options
 */
export function renderLineChart(host, options) {
  host._chart = options;
  if (!host._chartObserver && 'ResizeObserver' in window) {
    host._chartObserver = new ResizeObserver(() => draw(host, false));
    host._chartObserver.observe(host);
  }
  draw(host, true);
}

export function clearChart(host, message) {
  host._chart = null;
  host._chartSize = null;
  host.replaceChildren(h('p', { class: 'chart-empty' }, message));
}

function draw(host, force) {
  const o = host._chart;
  if (!o) return;
  const width = Math.max(260, Math.floor(host.clientWidth));
  const height = Math.max(150, Math.floor(host.clientHeight || 220));
  const size = `${width}x${height}`;
  if (!force && host._chartSize === size) return;
  host._chartSize = size;

  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = height - MARGIN.top - MARGIN.bottom;
  const [x0, x1] = o.xDomain;
  const [y0, y1] = o.yDomain;
  const sx = (v) => MARGIN.left + ((v - x0) / (x1 - x0 || 1)) * plotW;
  const sy = (v) => MARGIN.top + (1 - (v - y0) / (y1 - y0 || 1)) * plotH;
  const baseline = sy(y0);

  const svg = s('svg', {
    class: 'chart-svg',
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': o.ariaLabel,
  });

  // Grid + y labels
  const grid = s('g', { class: 'chart-grid' });
  for (const tick of o.yTicks) {
    const y = Math.round(sy(tick)) + 0.5;
    grid.append(
      s('line', { x1: MARGIN.left, x2: width - MARGIN.right, y1: y, y2: y }),
      s('text', { x: MARGIN.left - 8, y, 'text-anchor': 'end', 'dominant-baseline': 'middle', class: 'chart-tick' }, o.yFormat(tick)),
    );
  }
  o.xTicks.forEach((tick, i) => {
    const anchor = i === 0 && o.xTicks.length > 1 ? 'start' : i === o.xTicks.length - 1 && o.xTicks.length > 1 ? 'end' : 'middle';
    grid.append(s('text', { x: sx(tick.x), y: height - 8, 'text-anchor': anchor, class: 'chart-tick' }, tick.label));
  });
  svg.append(grid);

  // Split into continuous segments (null = no data for that step).
  const segments = [];
  let current = [];
  for (const point of o.points) {
    if (point.y === null || point.y === undefined) {
      if (current.length) segments.push(current);
      current = [];
    } else {
      current.push(point);
    }
  }
  if (current.length) segments.push(current);

  const marks = s('g', { class: 'chart-marks' });
  for (const seg of segments) {
    const d = seg.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
    if (o.area !== false && seg.length > 1) {
      const first = sx(seg[0].x).toFixed(1);
      const last = sx(seg[seg.length - 1].x).toFixed(1);
      marks.append(s('path', { class: 'chart-area', d: `${d}L${last},${baseline}L${first},${baseline}Z` }));
    }
    if (seg.length > 1) marks.append(s('path', { class: 'chart-line', d }));
    if (seg.length === 1 || o.showDots) {
      for (const p of seg) marks.append(s('circle', { class: 'chart-dot', cx: sx(p.x), cy: sy(p.y), r: 4 }));
    }
  }
  svg.append(marks);

  // Selective direct label (e.g. the best run).
  if (o.highlight && o.points[o.highlight.index]?.y != null) {
    const p = o.points[o.highlight.index];
    const cx = sx(p.x);
    const cy = sy(p.y);
    const anchor = cx > width - 90 ? 'end' : cx < MARGIN.left + 60 ? 'start' : 'middle';
    svg.append(
      s('circle', { class: 'chart-dot chart-dot-strong', cx, cy, r: 5 }),
      s('text', { x: cx, y: Math.max(12, cy - 12), 'text-anchor': anchor, class: 'chart-direct-label' }, o.highlight.text),
    );
  }

  // Hover layer: crosshair snaps to the nearest point with data.
  const cross = s('line', { class: 'chart-cross', y1: MARGIN.top, y2: MARGIN.top + plotH, visibility: 'hidden' });
  const hoverDot = s('circle', { class: 'chart-dot chart-dot-strong', r: 5, visibility: 'hidden' });
  const hit = s('rect', { class: 'chart-hit', x: MARGIN.left, y: 0, width: plotW, height: height - MARGIN.bottom + 8 });
  svg.append(cross, hoverDot, hit);

  const tooltip = h('div', { class: 'chart-tooltip', hidden: true, 'aria-live': 'polite' });
  const valued = o.points.map((p, i) => ({ p, i })).filter(({ p }) => p.y !== null && p.y !== undefined);
  let active = -1;

  const show = (index) => {
    const entry = valued[index];
    if (!entry) return;
    active = index;
    const cx = sx(entry.p.x);
    const cy = sy(entry.p.y);
    cross.setAttribute('x1', cx);
    cross.setAttribute('x2', cx);
    cross.setAttribute('visibility', 'visible');
    hoverDot.setAttribute('cx', cx);
    hoverDot.setAttribute('cy', cy);
    hoverDot.setAttribute('visibility', 'visible');
    tooltip.replaceChildren(
      h('span', { class: 'tt-key', 'aria-hidden': 'true' }),
      h('strong', {}, entry.p.value),
      h('span', { class: 'tt-label' }, entry.p.label),
    );
    tooltip.hidden = false;
    const tipWidth = tooltip.offsetWidth;
    const left = cx + 14 + tipWidth > width ? cx - 14 - tipWidth : cx + 14;
    tooltip.style.left = `${Math.max(0, left)}px`;
    tooltip.style.top = `${Math.max(0, Math.min(cy - 18, height - 60))}px`;
  };
  const hide = () => {
    active = -1;
    cross.setAttribute('visibility', 'hidden');
    hoverDot.setAttribute('visibility', 'hidden');
    tooltip.hidden = true;
  };
  const nearest = (clientX) => {
    const rect = svg.getBoundingClientRect();
    const x = clientX - rect.left;
    let best = -1;
    let bestDist = Infinity;
    valued.forEach(({ p }, index) => {
      const dist = Math.abs(sx(p.x) - x);
      if (dist < bestDist) {
        bestDist = dist;
        best = index;
      }
    });
    return best;
  };

  hit.addEventListener('pointermove', (event) => show(nearest(event.clientX)));
  hit.addEventListener('pointerleave', hide);
  host.tabIndex = 0;
  host.setAttribute('aria-label', `${o.ariaLabel}. Use the arrow keys to read values.`);
  host.onkeydown = (event) => {
    if (!valued.length) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const step = event.key === 'ArrowRight' ? 1 : -1;
      const start = active === -1 ? (step > 0 ? -1 : valued.length) : active;
      show(Math.min(valued.length - 1, Math.max(0, start + step)));
    } else if (event.key === 'Escape') {
      hide();
    }
  };
  host.onblur = hide;

  host.replaceChildren(svg, tooltip);
}

/** Round a max value up to a clean axis top and return evenly spaced ticks. */
export function niceTicks(max, count = 4) {
  if (!(max > 0)) return { top: 1, ticks: [0, 1] };
  const rough = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((m) => m >= rough);
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { top, ticks };
}
