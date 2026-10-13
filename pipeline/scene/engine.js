// Scene engine: maps flat SVG ad panels into the hand-drawn blocks with a
// projective (perspective) transform and clips them to the exact block shape.
const PW = 1455, PH = 2056;
const MODE = (location.hash || '#full').slice(1);

function homography(q, w, h) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q; // TL, TR, BR, BL
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  let a, b, c, d, e, f, g, k;
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
    a = x1 - x0; b = x3 - x0; c = x0; d = y1 - y0; e = y3 - y0; f = y0; g = 0; k = 0;
  } else {
    const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
    const den = dx1 * dy2 - dx2 * dy1;
    g = (sx * dy2 - dx2 * sy) / den;
    k = (dx1 * sy - sx * dy1) / den;
    a = x1 - x0 + g * x1; b = x3 - x0 + k * x3; c = x0;
    d = y1 - y0 + g * y1; e = y3 - y0 + k * y3; f = y0;
  }
  return [a / w, b / h, c, d / w, e / h, f, g / w, k / h, 1];
}
function matrix3d(Hm) {
  const [h11, h12, h13, h21, h22, h23, h31, h32, h33] = Hm;
  return `matrix3d(${h11},${h21},0,${h31},${h12},${h22},0,${h32},0,0,1,0,${h13},${h23},0,${h33})`;
}
const edge = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1]);
const polyD = q => 'M' + q.map(v => v[0].toFixed(2) + ' ' + v[1].toFixed(2)).join(' L') + ' Z';
// project panel-space point through a sign's homography (for page-space effects)
function sgPoint(key, u, v) { const g = SG[key]; const [TL, TR, BR, BL] = g.quad; const Hm = homography(g.quad, 1, 1); const den = Hm[6] * u + Hm[7] * v + 1; return [(Hm[0] * u + Hm[1] * v + Hm[2]) / den, (Hm[3] * u + Hm[4] * v + Hm[5]) / den]; }

let clipN = 0;
const DEFS = [];
const PANELS = [];
// p: {z, clip:[ids|'d'], quad?, w?, h?, svg:(w,h)=>string, blend?, opacity?, filter?}
function panel(p) { PANELS.push(p); }

function build() {
  const root = document.getElementById('root');
  if (MODE !== 'panels') {
    const img = document.createElement('img');
    img.src = 'base.png'; img.className = 'photo';
    root.appendChild(img);
  }
  if (MODE === 'base') return;
  PANELS.sort((a, b) => a.z - b.z);
  // measuring svg for bounding boxes
  const meas = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  meas.setAttribute('width', PW); meas.setAttribute('height', PH);
  meas.style.position = 'absolute'; meas.style.visibility = 'hidden';
  document.body.appendChild(meas);
  const bboxOf = (markup) => {
    meas.innerHTML = `<g>${markup}</g>`;
    const b = meas.firstChild.getBBox();
    return [b.x, b.y, b.x + b.width, b.y + b.height];
  };
  for (const p of PANELS) {
    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    if (p.sg) {
      const g = SG[p.sg];
      if (!g) { console.log('missing sign ' + p.sg); continue; }
      p.quad = g.quad;
      if (!p.clip) p.clip = (g.clip || [g.quad]).map(polyD);
      const hp = (edge(g.quad[0], g.quad[3]) + edge(g.quad[1], g.quad[2])) / 2 * (p.scale || 1);
      p.h = p.h || Math.max(8, Math.round(hp));
      p.w = p.w || Math.max(8, Math.round(p.h * g.aspect));
      p.g = g;
    }
    const clipD = (p.clip || []).map(c => typeof c === 'number' ? B[c] : c);
    let w, h, content, bb;
    if (p.quad) {
      const q = p.quad;
      w = p.w || Math.round((edge(q[0], q[1]) + edge(q[3], q[2])) / 2);
      h = p.h || Math.round((edge(q[0], q[3]) + edge(q[1], q[2])) / 2);
      try { content = p.svg(w, h); } catch (e) { console.log('PANEL ERROR', p.sg || p.z, e.message); continue; }
      bb = clipD.length ? bboxOf(clipD.map(d => `<path d="${d}"/>`).join(''))
        : [Math.min(...q.map(v => v[0])), Math.min(...q.map(v => v[1])), Math.max(...q.map(v => v[0])), Math.max(...q.map(v => v[1]))];
    } else {
      w = PW; h = PH;
      try { content = p.svg(w, h); } catch (e) { console.log('PANEL ERROR', p.sg || p.z, e.message); continue; }
      bb = clipD.length ? bboxOf(clipD.map(d => `<path d="${d}"/>`).join('')) : bboxOf(content);
    }
    const m = clipD.length ? 1 : 40; // glow margin for unclipped drawings
    const l = Math.max(-200, Math.floor(bb[0] - m)), t = Math.max(-300, Math.floor(bb[1] - m));
    const r = Math.min(PW + 200, Math.ceil(bb[2] + m)), btm = Math.min(PH + 200, Math.ceil(bb[3] + m));
    Object.assign(wrap.style, { left: l + 'px', top: t + 'px', width: (r - l) + 'px', height: (btm - t) + 'px' });
    if (clipD.length) {
      const id = 'clip' + (clipN++);
      DEFS.push(`<clipPath id="${id}" clipPathUnits="userSpaceOnUse">${clipD.map(d => `<path transform="translate(${-l} ${-t})" d="${d}"/>`).join('')}</clipPath>`);
      wrap.style.clipPath = `url(#${id})`;
    }
    if (p.blend) wrap.style.mixBlendMode = MODE === 'panels' && p.blend === 'screen' ? 'normal' : p.blend;
    if (p.opacity != null) wrap.style.opacity = p.opacity;
    if (p.filter) wrap.style.filter = p.filter;
    const inner = document.createElement('div');
    inner.className = 'panel';
    if (p.quad) {
      inner.style.transform = `translate(${-l}px, ${-t}px) ` + matrix3d(homography(p.quad, w, h));
      inner.style.width = w + 'px'; inner.style.height = h + 'px';
      inner.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" overflow="visible">${content}</svg>`;
    } else {
      inner.style.width = (r - l) + 'px'; inner.style.height = (btm - t) + 'px';
      inner.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${r - l}" height="${btm - t}" viewBox="${l} ${t} ${r - l} ${btm - t}" overflow="visible">${content}</svg>`;
    }
    wrap.appendChild(inner);
    root.appendChild(wrap);
  }
  meas.remove();
  document.getElementById('defs').innerHTML = DEFS.join('');
}

// ---------- shared SVG helpers ----------
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function T(x, y, str, size, font, fill, extra = '') {
  return `<text x="${x}" y="${y}" font-size="${size}" font-family="${font}" fill="${fill}" ${extra}>${esc(str)}</text>`;
}
// stacked vertical CJK text, centred on cx
function VT(cx, y0, str, size, font, fill, extra = '', gap = 1.02) {
  return [...str].map((ch, i) => `<text x="${cx}" y="${y0 + (i + 0.86) * size * gap}" font-size="${size}" font-family="${font}" fill="${fill}" text-anchor="middle" ${extra}>${esc(ch)}</text>`).join('');
}
// neon: a coloured blurred glow under a pale core
function NEON(el, color, core = '#fff', glow = 3, sw = 2) {
  return `<g filter="url(#b${glow})" opacity=".95">${el(color, color, sw * 2)}</g><g>${el(color, color, sw * 0.6)}</g><g opacity=".9">${el(core, 'none', 0)}</g>`;
}
const rect = (x, y, w, h, fill, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${extra}/>`;
const LED = (w, h, pitch = 3, op = 1) => `<rect x="0" y="0" width="${w}" height="${h}" fill="url(#led${pitch})" opacity="${op}" style="mix-blend-mode:multiply"/>`;
const SCAN = (w, h, op = .35) => `<rect x="0" y="0" width="${w}" height="${h}" fill="url(#scan)" opacity="${op}"/>`;
const GRAIN = (w, h, op = .25) => `<rect x="0" y="0" width="${w}" height="${h}" filter="url(#grain)" opacity="${op}" style="mix-blend-mode:overlay"/>`;
// pseudo random, deterministic
let _seed = 7;
const rnd = () => (_seed = (_seed * 16807) % 2147483647) / 2147483647;
const pick = a => a[Math.floor(rnd() * a.length)];
