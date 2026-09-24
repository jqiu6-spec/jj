// SVG charts: the run pace chart and the history sparkline.

const NS = 'http://www.w3.org/2000/svg';
const fmt = (n) => Math.round(n).toLocaleString('en-US');

function niceStep(max, ticks) {
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * mag;
}

function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

// Cumulative score per second for this run, with the best run for comparison.
export function paceChart(host, current, best, duration) {
  host.textContent = '';
  const W = Math.max(280, host.clientWidth || 560);
  const H = 190;
  const m = { l: 48, r: 16, t: 12, b: 26 };
  const cur = [0, ...current];
  const pb = best ? [0, ...best] : null;
  const top = Math.max(1, ...cur, ...(pb || [0]));
  const step = niceStep(top, 4);
  const yMax = Math.ceil(top / step) * step;
  const x = (s) => m.l + (s / duration) * (W - m.l - m.r);
  const y = (v) => H - m.b - (v / yMax) * (H - m.t - m.b);

  const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img' });
  svg.setAttribute('aria-label', 'Cumulative score by second');

  const grid = el('g', { class: 'c-grid' }, svg);
  for (let v = 0; v <= yMax + 1e-9; v += step) {
    el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }, grid);
    const t = el('text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'c-tick' }, svg);
    t.textContent = fmt(v);
  }
  const xStep = duration > 90 ? 30 : 10;
  for (let s = 0; s <= duration; s += xStep) {
    const t = el('text', { x: x(s), y: H - 8, 'text-anchor': 'middle', class: 'c-tick' }, svg);
    t.textContent = `${s}s`;
  }

  const path = (arr) => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  if (pb) el('path', { d: path(pb), class: 'c-best' }, svg);
  el('path', { d: `${path(cur)}L${x(cur.length - 1)},${y(0)}L${x(0)},${y(0)}Z`, class: 'c-area' }, svg);
  el('path', { d: path(cur), class: 'c-cur' }, svg);
  el('circle', { cx: x(cur.length - 1), cy: y(cur[cur.length - 1]), r: 4, class: 'c-end' }, svg);

  // Hover: vertical rule plus a tooltip with both values at that second.
  const rule = el('line', { y1: m.t, y2: H - m.b, class: 'c-rule', visibility: 'hidden' }, svg);
  const dot = el('circle', { r: 4, class: 'c-end', visibility: 'hidden' }, svg);
  const hit = el('rect', { x: m.l, y: 0, width: W - m.l - m.r, height: H, fill: 'transparent' }, svg);
  host.appendChild(svg);
  const tip = document.createElement('div');
  tip.className = 'c-tip';
  tip.hidden = true;
  host.appendChild(tip);

  const show = (clientX) => {
    const box = svg.getBoundingClientRect();
    const s = Math.round(((clientX - box.left - m.l) / (W - m.l - m.r)) * duration);
    const i = Math.max(0, Math.min(cur.length - 1, s));
    rule.setAttribute('x1', x(i));
    rule.setAttribute('x2', x(i));
    rule.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', x(i));
    dot.setAttribute('cy', y(cur[i]));
    dot.setAttribute('visibility', 'visible');
    let html = `<b>${i}s</b><span>This run <em>${fmt(cur[i])}</em></span>`;
    if (pb && pb[i] !== undefined) {
      const d = cur[i] - pb[i];
      html += `<span>Best run <em>${fmt(pb[i])}</em></span><span class="${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '+' : '−'}${fmt(Math.abs(d))}</span>`;
    }
    tip.innerHTML = html;
    tip.hidden = false;
    const left = Math.min(Math.max(x(i) + 12, 0), W - tip.offsetWidth - 4);
    tip.style.left = `${x(i) > W * 0.6 ? x(i) - tip.offsetWidth - 12 : left}px`;
  };
  const hide = () => {
    rule.setAttribute('visibility', 'hidden');
    dot.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  };
  hit.addEventListener('pointermove', (e) => show(e.clientX));
  hit.addEventListener('pointerleave', hide);
}

// Scores of recent runs, oldest to newest, with the latest point emphasised.
export function sparkline(host, scores) {
  host.textContent = '';
  if (scores.length < 2) {
    host.innerHTML = `<p class="spark-empty">${scores.length ? 'One run so far.' : 'No runs yet.'} Play a few to see a trend.</p>`;
    return;
  }
  const W = Math.max(200, host.clientWidth || 320);
  const H = 56;
  const pad = 6;
  const lo = Math.min(...scores);
  const hi = Math.max(...scores);
  const span = hi - lo || 1;
  const x = (i) => pad + (i / (scores.length - 1)) * (W - pad * 2);
  const y = (v) => H - pad - ((v - lo) / span) * (H - pad * 2);
  const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
  svg.setAttribute('aria-label', `Last ${scores.length} scores, from ${fmt(scores[0])} to ${fmt(scores[scores.length - 1])}`);
  const d = scores.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  el('path', { d: `${d}L${x(scores.length - 1)},${H}L${x(0)},${H}Z`, class: 'c-area' }, svg);
  el('path', { d, class: 'c-cur' }, svg);
  scores.forEach((v, i) => {
    const c = el('circle', { cx: x(i), cy: y(v), r: i === scores.length - 1 ? 4 : 2.5, class: i === scores.length - 1 ? 'c-end' : 'c-pt' }, svg);
    const t = el('title', {}, c);
    t.textContent = fmt(v);
  });
  host.appendChild(svg);
}
