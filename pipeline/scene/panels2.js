// Photoreal pass: every sign sits on a real scene plane (signs.js, solved from the photo's
// vanishing points). Content is designed at mega-structure scale (~2 km tower).
const JP = "'Dela Gothic One','IPAGothic'";
const PIX = "'DotGothic16','IPAGothic'";
const CN = "'Noto Serif SC','WenQuanYi Zen Hei'";
const SANS = "'Inter','Inter Display','Liberation Sans'";
const DISP = "'Inter Display','Inter'";

// ---------- physical-world helpers (panel space) ----------
let UID = 0;
const uid = p => p + (UID++);
function seams(w, h, nx, ny, op = .28, sw = .5) {
  let s = '';
  for (let i = 1; i < nx; i++) s += `<line x1="${i * w / nx}" y1="0" x2="${i * w / nx}" y2="${h}" stroke="#000" stroke-width="${sw}" opacity="${op}"/>`;
  for (let j = 1; j < ny; j++) s += `<line x1="0" y1="${j * h / ny}" x2="${w}" y2="${j * h / ny}" stroke="#000" stroke-width="${sw}" opacity="${op}"/>`;
  return s;
}
// LED media-facade finish: module seams, view-angle falloff, faint glass sheen, thin bezel
function screen(w, h, o = {}) {
  const mod = o.mod || h / 9;
  return `${seams(w, h, Math.max(2, Math.round(w / mod)), Math.max(2, Math.round(h / mod)), o.seamOp ?? .25, o.seamW ?? .45)}
    ${o.fall ? rect(0, 0, w, h, `url(#fall${o.fall})`, `opacity="${o.fallOp ?? 1}"`) : ''}
    ${rect(0, 0, w, h, 'url(#sheen)')}
    <rect x="0" y="0" width="${w}" height="${h}" fill="none" stroke="#07080a" stroke-width="${o.bezel ?? Math.max(1.2, h / 160)}"/>`;
}
// maintenance gondola hanging on cables from the top of a screen (scale cue)
function gondola(x, y, s = 1) {
  return `<g><line x1="${x - 2.2 * s}" y1="0" x2="${x - 2.2 * s}" y2="${y}" stroke="#111" stroke-width="${.35 * s}"/><line x1="${x + 2.2 * s}" y1="0" x2="${x + 2.2 * s}" y2="${y}" stroke="#111" stroke-width="${.35 * s}"/>
    <rect x="${x - 3 * s}" y="${y}" width="${6 * s}" height="${1.6 * s}" fill="#15171a"/><rect x="${x - 3 * s}" y="${y - 1.2 * s}" width="${6 * s}" height="${.35 * s}" fill="#2a2d31"/>
    <circle cx="${x + 2.4 * s}" cy="${y + .4 * s}" r="${.5 * s}" fill="#fff4d0"/><circle cx="${x + 2.4 * s}" cy="${y + .4 * s}" r="${1.6 * s}" fill="#fff4d0" opacity=".35" filter="url(#b1)"/></g>`;
}
function qr(x, y, s, seed) {
  _seed = seed; let r = '';
  const n = 21, c = s / n;
  r += rect(x - c, y - c, s + 2 * c, s + 2 * c, '#fff');
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const fin = (a, b) => a < 7 && b < 7;
    const inF = fin(i, j) || fin(n - 1 - i, j) || fin(i, n - 1 - j);
    let on;
    if (inF) { const a = i < 7 ? i : n - 1 - i, b = j < 7 ? j : n - 1 - j; on = (a === 0 || a === 6 || b === 0 || b === 6) || (a >= 2 && a <= 4 && b >= 2 && b <= 4); }
    else on = rnd() > .52;
    if (on) r += rect(x + i * c, y + j * c, c + .05, c + .05, '#000');
  }
  return r;
}
function downlights(w, h, nx, ny, col = '#ffe2b0', r = .9, base = '#0c0d0f') {
  let s = rect(0, 0, w, h, base) + seams(w, h, Math.max(2, Math.round(nx / 3)), ny, .5, .4);
  let pools = '', fx = '';
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const x = (i + .5) * w / nx, y = (j + .5) * h / ny;
    pools += `<circle cx="${x}" cy="${y}" r="${r * 5}" fill="${col}"/>`;
    fx += `<circle cx="${x}" cy="${y}" r="${r * 1.35}" fill="#2a2b2e"/><circle cx="${x}" cy="${y}" r="${r}" fill="${col}"/><circle cx="${x - r * .25}" cy="${y - r * .25}" r="${r * .45}" fill="#fffaf0"/>`;
  }
  return s + `<g opacity=".07" filter="url(#b2)">${pools}</g>` + fx + rect(0, 0, w, h, 'none', `stroke="#050506" stroke-width="${Math.max(.8, h / 30)}"`);
}
// tiny person silhouette (for scale)
const person = (x, y, s, c = '#050505') => `<g transform="translate(${x} ${y}) scale(${s})" fill="${c}"><circle cx="0" cy="-9.2" r="1.6"/><path d="M-1.7 -7.4 h3.4 l.5 4.6 h-.9 l-.2 5.8 h-1.1 l-.2 -4 l-.2 4 h-1.1 l-.2 -5.8 h-.9 z"/></g>`;
function bokeh(w, h, n, cols, seed, rmax) {
  _seed = seed; let s = '';
  for (let i = 0; i < n; i++) { const r = rmax * (.25 + rnd() * .75); s += `<circle cx="${rnd() * w}" cy="${rnd() * h}" r="${r}" fill="url(#bokeh)" opacity="${.12 + rnd() * .3}" style="mix-blend-mode:screen" fill-opacity="1" color="${pick(cols)}"/>`.replace('fill="url(#bokeh)"', `fill="${pick(cols)}" filter="url(#b2)"`); }
  return s;
}
// hologram finishing: fog, glow copy, scanlines, flicker band
function holo(w, h, inner, col, o = {}) {
  const id = uid('hf');
  return `<defs><linearGradient id="${id}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${col}" stop-opacity="${o.fog ?? .22}"/><stop offset="1" stop-color="${col}" stop-opacity="${(o.fog ?? .22) * .25}"/></linearGradient></defs>
    ${(o.fog ?? .22) > 0 ? rect(0, 0, w, h, `url(#${id})`) : ''}
    <g filter="url(#b3)" opacity=".75">${inner}</g>
    <g opacity="${o.op ?? .92}">${inner}</g>
    ${rect(0, 0, w, h, 'url(#scan)', `opacity="${o.scan ?? .55}"`)}
    ${rect(0, h * (o.band ?? .37), w, h * .035, '#ffffff', 'opacity=".09"')}
    ${(o.edge ?? .85) > 0 ? `<rect x="0" y="0" width="${w}" height="${h}" fill="none" stroke="${col}" stroke-width="${Math.max(.8, h / 220)}" opacity="${o.edge ?? .85}"/>` : ''}`;
}
function neonTube(d, col, sw = 1.4, core = '#fff') {
  return `<path d="${d}" fill="none" stroke="${col}" stroke-width="${sw * 4}" opacity=".55" filter="url(#b3)" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${d}" fill="none" stroke="${col}" stroke-width="${sw * 1.6}" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${d}" fill="none" stroke="${core}" stroke-width="${sw * .55}" opacity=".9" stroke-linecap="round" stroke-linejoin="round"/>`;
}
// inverse homography: page point -> normalised (u,v) of a sign
function sgInv(key, x, y) {
  const Hm = homography(SG[key].quad, 1, 1);
  const M = [[Hm[0], Hm[1], Hm[2]], [Hm[3], Hm[4], Hm[5]], [Hm[6], Hm[7], Hm[8]]];
  const det = M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  const I = [[(M[1][1] * M[2][2] - M[1][2] * M[2][1]) / det, (M[0][2] * M[2][1] - M[0][1] * M[2][2]) / det, (M[0][1] * M[1][2] - M[0][2] * M[1][1]) / det],
  [(M[1][2] * M[2][0] - M[1][0] * M[2][2]) / det, (M[0][0] * M[2][2] - M[0][2] * M[2][0]) / det, (M[0][2] * M[1][0] - M[0][0] * M[1][2]) / det],
  [(M[1][0] * M[2][1] - M[1][1] * M[2][0]) / det, (M[0][1] * M[2][0] - M[0][0] * M[2][1]) / det, (M[0][0] * M[1][1] - M[0][1] * M[1][0]) / det]];
  const X = I[0][0] * x + I[0][1] * y + I[0][2], Y = I[1][0] * x + I[1][1] * y + I[1][2], Z = I[2][0] * x + I[2][1] * y + I[2][2];
  return [X / Z, Y / Z];
}

// ---------- real neon: monoline glass tube lettering ----------
// NEON_GLYPHS: centre-lines of IPAGothic glyphs (skeletonised offline, em units, origin = em top-left)
// so every letter is ONE bent glass tube of constant width, as real neon is, never a filled font.
const NEON_GLYPHS = {"カ":[[[0.775,0.345],[0.77,0.34]],[[0.775,0.345],[0.77,0.62],[0.745,0.785]],[[0.175,0.84],[0.185,0.845]],[[0.54,0.82],[0.635,0.85],[0.7,0.845],[0.725,0.825]],[[0.32,0.735],[0.27,0.785]],[[0.18,0.34],[0.45,0.34]],[[0.465,0.33],[0.465,0.14]],[[0.73,0.815],[0.74,0.795]],[[0.355,0.69],[0.345,0.7]],[[0.435,0.52],[0.435,0.51]],[[0.34,0.71],[0.33,0.72]],[[0.395,0.62],[0.425,0.545]],[[0.465,0.335],[0.77,0.34]],[[0.44,0.5],[0.455,0.345]]],"ラ":[[[0.64,0.715],[0.645,0.71]],[[0.64,0.715],[0.55,0.79]],[[0.695,0.655],[0.685,0.665]],[[0.78,0.5],[0.79,0.445]],[[0.385,0.87],[0.35,0.86]],[[0.725,0.195],[0.26,0.195]],[[0.785,0.435],[0.775,0.415],[0.175,0.415]],[[0.41,0.86],[0.49,0.825]],[[0.765,0.535],[0.735,0.59]],[[0.645,0.71],[0.675,0.68]]],"オ":[[[0.57,0.375],[0.595,0.4],[0.595,0.81],[0.585,0.84],[0.565,0.855],[0.435,0.855]],[[0.595,0.335],[0.825,0.335]],[[0.52,0.415],[0.505,0.44]],[[0.56,0.37],[0.535,0.345],[0.155,0.345]],[[0.33,0.645],[0.345,0.63]],[[0.585,0.33],[0.585,0.14]],[[0.15,0.76],[0.1,0.75]],[[0.255,0.7],[0.17,0.75]],[[0.585,0.35],[0.59,0.34]],[[0.435,0.54],[0.37,0.61]]],"ケ":[[[0.615,0.47],[0.62,0.335]],[[0.365,0.175],[0.33,0.32]],[[0.37,0.15],[0.37,0.165]],[[0.61,0.48],[0.6,0.545]],[[0.58,0.615],[0.555,0.67]],[[0.275,0.395],[0.285,0.38]],[[0.595,0.555],[0.585,0.605]],[[0.39,0.845],[0.435,0.815],[0.525,0.72]],[[0.355,0.865],[0.32,0.86]],[[0.16,0.545],[0.2,0.505]],[[0.33,0.325],[0.615,0.33]],[[0.625,0.33],[0.85,0.33]],[[0.205,0.495],[0.255,0.43]],[[0.26,0.42],[0.27,0.405]]],"習":[[[0.64,0.24],[0.655,0.25]],[[0.24,0.25],[0.23,0.245]],[[0.705,0.33],[0.69,0.34]],[[0.215,0.875],[0.215,0.905]],[[0.79,0.71],[0.785,0.575],[0.485,0.57]],[[0.3,0.435],[0.405,0.435]],[[0.17,0.115],[0.43,0.12],[0.425,0.42]],[[0.1,0.115],[0.16,0.115]],[[0.785,0.87],[0.22,0.87]],[[0.79,0.875],[0.79,0.91]],[[0.22,0.715],[0.785,0.715]],[[0.57,0.12],[0.575,0.19]],[[0.18,0.395],[0.115,0.43]],[[0.565,0.115],[0.535,0.115]],[[0.215,0.865],[0.215,0.72]],[[0.335,0.295],[0.34,0.265]],[[0.655,0.36],[0.55,0.415]],[[0.725,0.43],[0.82,0.44],[0.85,0.43],[0.865,0.405],[0.865,0.12],[0.575,0.115]],[[0.17,0.2],[0.165,0.12]],[[0.79,0.865],[0.79,0.72]],[[0.325,0.305],[0.235,0.365]],[[0.775,0.255],[0.765,0.29],[0.73,0.315]],[[0.485,0.565],[0.495,0.5]],[[0.215,0.585],[0.22,0.58]],[[0.215,0.585],[0.215,0.71]],[[0.475,0.575],[0.22,0.58]]],"近":[[[0.565,0.165],[0.46,0.175]],[[0.145,0.86],[0.165,0.84]],[[0.745,0.135],[0.705,0.14]],[[0.455,0.375],[0.72,0.375]],[[0.41,0.715],[0.43,0.63]],[[0.575,0.16],[0.605,0.16]],[[0.105,0.895],[0.13,0.87]],[[0.395,0.75],[0.4,0.735]],[[0.245,0.775],[0.245,0.49]],[[0.89,0.375],[0.73,0.375]],[[0.755,0.13],[0.805,0.12],[0.87,0.14]],[[0.65,0.15],[0.67,0.15]],[[0.27,0.79],[0.25,0.78]],[[0.225,0.22],[0.245,0.245]],[[0.24,0.485],[0.09,0.485]],[[0.24,0.485],[0.245,0.49]],[[0.235,0.785],[0.2,0.81]],[[0.68,0.145],[0.695,0.145]],[[0.725,0.77],[0.725,0.38]],[[0.45,0.38],[0.435,0.62]],[[0.32,0.835],[0.28,0.8]],[[0.16,0.155],[0.21,0.2]],[[0.915,0.87],[0.92,0.865]],[[0.345,0.85],[0.42,0.88],[0.565,0.895],[0.89,0.885]],[[0.455,0.18],[0.46,0.175]],[[0.455,0.18],[0.45,0.37]],[[0.64,0.155],[0.615,0.155]]],"平":[[[0.5,0.605],[0.91,0.605]],[[0.49,0.15],[0.13,0.15]],[[0.495,0.905],[0.495,0.61]],[[0.86,0.15],[0.5,0.15]],[[0.245,0.35],[0.22,0.29]],[[0.74,0.37],[0.735,0.385]],[[0.49,0.605],[0.08,0.605]],[[0.695,0.48],[0.73,0.395]],[[0.795,0.27],[0.78,0.28]],[[0.745,0.36],[0.775,0.285]],[[0.265,0.395],[0.29,0.465]],[[0.495,0.6],[0.495,0.155]],[[0.775,0.285],[0.78,0.28]]],"新":[[[0.48,0.905],[0.49,0.885]],[[0.29,0.21],[0.4,0.215]],[[0.78,0.405],[0.575,0.405]],[[0.43,0.755],[0.42,0.745]],[[0.5,0.865],[0.53,0.78]],[[0.215,0.685],[0.22,0.68]],[[0.4,0.22],[0.39,0.29]],[[0.465,0.56],[0.29,0.56]],[[0.785,0.91],[0.785,0.41]],[[0.38,0.715],[0.365,0.7]],[[0.1,0.21],[0.17,0.215]],[[0.37,0.41],[0.475,0.41]],[[0.285,0.415],[0.21,0.41]],[[0.285,0.415],[0.36,0.41]],[[0.285,0.415],[0.285,0.555]],[[0.285,0.085],[0.285,0.205]],[[0.26,0.66],[0.27,0.655]],[[0.29,0.675],[0.355,0.695]],[[0.105,0.815],[0.11,0.81]],[[0.105,0.815],[0.09,0.83]],[[0.89,0.145],[0.825,0.13],[0.58,0.18]],[[0.27,0.655],[0.27,0.58]],[[0.27,0.655],[0.285,0.67]],[[0.405,0.215],[0.46,0.21]],[[0.915,0.405],[0.79,0.405]],[[0.2,0.41],[0.08,0.41]],[[0.175,0.215],[0.28,0.21]],[[0.58,0.18],[0.575,0.185]],[[0.27,0.575],[0.255,0.56],[0.1,0.56]],[[0.155,0.765],[0.11,0.81]],[[0.57,0.41],[0.565,0.625],[0.535,0.77]],[[0.285,0.91],[0.285,0.68]],[[0.22,0.68],[0.24,0.67]],[[0.175,0.74],[0.16,0.755]],[[0.38,0.315],[0.365,0.405]],[[0.17,0.22],[0.205,0.405]],[[0.57,0.4],[0.575,0.185]]],"時":[[[0.65,0.22],[0.865,0.22]],[[0.545,0.715],[0.51,0.675]],[[0.11,0.76],[0.11,0.83]],[[0.11,0.46],[0.11,0.75]],[[0.64,0.405],[0.425,0.405]],[[0.645,0.215],[0.645,0.085]],[[0.775,0.59],[0.775,0.88],[0.76,0.905]],[[0.775,0.415],[0.775,0.58]],[[0.78,0.585],[0.895,0.585]],[[0.11,0.45],[0.115,0.165],[0.33,0.17],[0.33,0.45]],[[0.75,0.91],[0.65,0.91],[0.605,0.88]],[[0.915,0.405],[0.78,0.41]],[[0.115,0.755],[0.33,0.75],[0.33,0.46]],[[0.325,0.455],[0.115,0.455]],[[0.43,0.585],[0.77,0.585]],[[0.64,0.22],[0.455,0.22]],[[0.65,0.405],[0.775,0.41]],[[0.645,0.4],[0.645,0.225]]],"代":[[[0.315,0.4],[0.53,0.385]],[[0.87,0.685],[0.89,0.735],[0.875,0.805]],[[0.26,0.15],[0.24,0.22]],[[0.08,0.555],[0.08,0.53]],[[0.195,0.415],[0.21,0.43],[0.21,0.905]],[[0.56,0.48],[0.58,0.58]],[[0.275,0.11],[0.27,0.115]],[[0.72,0.15],[0.745,0.18]],[[0.88,0.355],[0.68,0.37]],[[0.585,0.59],[0.635,0.71]],[[0.705,0.81],[0.69,0.795]],[[0.745,0.85],[0.73,0.835]],[[0.55,0.38],[0.67,0.375]],[[0.22,0.27],[0.195,0.41]],[[0.555,0.47],[0.545,0.385]],[[0.535,0.375],[0.52,0.11]],[[0.76,0.86],[0.8,0.875],[0.83,0.875],[0.85,0.86]],[[0.855,0.85],[0.865,0.83]],[[0.265,0.14],[0.27,0.115]]],"ホ":[[[0.705,0.495],[0.73,0.53]],[[0.24,0.605],[0.28,0.51]],[[0.32,0.83],[0.31,0.82]],[[0.32,0.83],[0.325,0.835]],[[0.825,0.32],[0.505,0.32]],[[0.825,0.68],[0.815,0.665]],[[0.21,0.66],[0.175,0.71]],[[0.81,0.655],[0.775,0.6]],[[0.5,0.325],[0.5,0.815],[0.49,0.84],[0.455,0.86],[0.35,0.855]],[[0.165,0.32],[0.495,0.32]],[[0.325,0.835],[0.345,0.85]],[[0.215,0.65],[0.235,0.615]],[[0.345,0.85],[0.35,0.855]],[[0.17,0.72],[0.155,0.74]],[[0.5,0.315],[0.5,0.14]]],"テ":[[[0.51,0.435],[0.125,0.435]],[[0.235,0.86],[0.27,0.87]],[[0.485,0.655],[0.505,0.575],[0.515,0.44]],[[0.345,0.83],[0.4,0.785]],[[0.85,0.435],[0.52,0.435]],[[0.48,0.665],[0.465,0.7]],[[0.455,0.72],[0.415,0.77]],[[0.725,0.2],[0.255,0.2]]],"ル":[[[0.885,0.475],[0.88,0.53],[0.82,0.6]],[[0.705,0.71],[0.695,0.72]],[[0.225,0.705],[0.255,0.645]],[[0.17,0.78],[0.14,0.81]],[[0.265,0.62],[0.295,0.455],[0.3,0.235]],[[0.74,0.68],[0.725,0.695]],[[0.64,0.76],[0.685,0.725]],[[0.12,0.825],[0.095,0.825]],[[0.525,0.19],[0.525,0.785],[0.56,0.795],[0.615,0.775]]],"空":[[[0.49,0.205],[0.135,0.21]],[[0.495,0.085],[0.495,0.2]],[[0.36,0.375],[0.335,0.42]],[[0.495,0.635],[0.495,0.87]],[[0.59,0.21],[0.86,0.21],[0.865,0.31]],[[0.33,0.43],[0.32,0.44]],[[0.49,0.63],[0.185,0.63]],[[0.49,0.875],[0.1,0.88]],[[0.265,0.485],[0.18,0.525],[0.135,0.51]],[[0.89,0.88],[0.495,0.875]],[[0.58,0.21],[0.495,0.205]],[[0.13,0.215],[0.135,0.21]],[[0.13,0.215],[0.13,0.345]],[[0.6,0.47],[0.585,0.44],[0.585,0.215]],[[0.625,0.48],[0.765,0.48],[0.805,0.455]],[[0.38,0.3],[0.37,0.35]],[[0.805,0.63],[0.5,0.63]],[[0.82,0.41],[0.81,0.445]]],"室":[[[0.615,0.415],[0.65,0.415]],[[0.495,0.7],[0.495,0.87]],[[0.13,0.2],[0.485,0.195]],[[0.13,0.2],[0.125,0.205]],[[0.505,0.525],[0.715,0.515]],[[0.49,0.695],[0.18,0.695]],[[0.495,0.085],[0.495,0.185]],[[0.655,0.345],[0.655,0.41]],[[0.765,0.34],[0.66,0.34]],[[0.39,0.355],[0.375,0.415]],[[0.225,0.34],[0.38,0.34],[0.39,0.35]],[[0.65,0.34],[0.405,0.345]],[[0.33,0.525],[0.49,0.53]],[[0.495,0.69],[0.495,0.535]],[[0.49,0.875],[0.095,0.88]],[[0.895,0.88],[0.495,0.875]],[[0.655,0.415],[0.715,0.46],[0.73,0.5]],[[0.735,0.505],[0.785,0.515],[0.82,0.545]],[[0.2,0.535],[0.325,0.525]],[[0.5,0.695],[0.815,0.695]],[[0.355,0.45],[0.33,0.52]],[[0.125,0.205],[0.125,0.33]],[[0.495,0.19],[0.86,0.195],[0.87,0.205],[0.87,0.33]]],"拉":[[[0.49,0.395],[0.49,0.405]],[[0.325,0.285],[0.24,0.285]],[[0.235,0.535],[0.235,0.555]],[[0.23,0.285],[0.095,0.285]],[[0.64,0.105],[0.64,0.275]],[[0.1,0.89],[0.12,0.91],[0.21,0.91]],[[0.745,0.63],[0.71,0.795]],[[0.905,0.875],[0.695,0.87]],[[0.22,0.905],[0.225,0.9]],[[0.78,0.475],[0.79,0.4]],[[0.535,0.725],[0.515,0.55]],[[0.235,0.085],[0.235,0.28]],[[0.23,0.56],[0.1,0.58]],[[0.235,0.565],[0.235,0.885],[0.225,0.9]],[[0.75,0.62],[0.775,0.485]],[[0.635,0.28],[0.425,0.285]],[[0.235,0.29],[0.235,0.525]],[[0.1,0.58],[0.095,0.585]],[[0.32,0.52],[0.24,0.53]],[[0.385,0.875],[0.695,0.87]],[[0.485,0.415],[0.51,0.54]],[[0.345,0.51],[0.36,0.505]],[[0.87,0.285],[0.64,0.28]],[[0.705,0.805],[0.695,0.87]]],"麺":[[[0.87,0.745],[0.87,0.305]],[[0.365,0.3],[0.25,0.3]],[[0.87,0.755],[0.87,0.79]],[[0.22,0.43],[0.075,0.425]],[[0.505,0.75],[0.615,0.75]],[[0.74,0.3],[0.655,0.295]],[[0.745,0.305],[0.745,0.44]],[[0.625,0.3],[0.655,0.295]],[[0.305,0.705],[0.345,0.63]],[[0.47,0.87],[0.44,0.86]],[[0.465,0.13],[0.675,0.135]],[[0.35,0.62],[0.35,0.565]],[[0.22,0.68],[0.275,0.735]],[[0.22,0.435],[0.205,0.55]],[[0.1,0.9],[0.14,0.875]],[[0.625,0.595],[0.74,0.595]],[[0.275,0.755],[0.275,0.74]],[[0.37,0.825],[0.405,0.845]],[[0.865,0.3],[0.75,0.3]],[[0.865,0.3],[0.87,0.305]],[[0.19,0.64],[0.17,0.63]],[[0.205,0.825],[0.195,0.835]],[[0.14,0.64],[0.16,0.63]],[[0.315,0.785],[0.28,0.76]],[[0.74,0.445],[0.625,0.445]],[[0.245,0.305],[0.245,0.42]],[[0.5,0.755],[0.5,0.79]],[[0.625,0.75],[0.74,0.75]],[[0.9,0.13],[0.68,0.135]],[[0.18,0.57],[0.165,0.625]],[[0.245,0.295],[0.245,0.18]],[[0.395,0.425],[0.25,0.425]],[[0.385,0.175],[0.25,0.175]],[[0.62,0.45],[0.62,0.59]],[[0.62,0.6],[0.62,0.745]],[[0.48,0.875],[0.62,0.895],[0.905,0.89]],[[0.21,0.555],[0.345,0.56]],[[0.745,0.45],[0.745,0.59]],[[0.745,0.6],[0.745,0.745]],[[0.24,0.425],[0.225,0.43]],[[0.245,0.17],[0.245,0.08]],[[0.5,0.745],[0.5,0.305],[0.615,0.3]],[[0.345,0.56],[0.35,0.565]],[[0.24,0.175],[0.095,0.175]],[[0.655,0.295],[0.675,0.14]],[[0.935,0.87],[0.94,0.865]],[[0.865,0.75],[0.75,0.75]],[[0.115,0.3],[0.24,0.3]],[[0.62,0.44],[0.62,0.305]]],"営":[[[0.74,0.105],[0.735,0.115]],[[0.715,0.54],[0.49,0.545]],[[0.715,0.54],[0.72,0.535]],[[0.305,0.245],[0.49,0.245]],[[0.46,0.68],[0.195,0.68],[0.185,0.69],[0.185,0.865]],[[0.68,0.235],[0.695,0.18]],[[0.72,0.535],[0.715,0.37],[0.28,0.37],[0.27,0.38],[0.275,0.54],[0.48,0.545]],[[0.185,0.875],[0.185,0.91]],[[0.295,0.245],[0.13,0.25]],[[0.3,0.18],[0.3,0.24]],[[0.685,0.24],[0.86,0.245],[0.865,0.37]],[[0.8,0.87],[0.19,0.87]],[[0.7,0.17],[0.725,0.135]],[[0.125,0.255],[0.13,0.25]],[[0.125,0.255],[0.125,0.365]],[[0.495,0.24],[0.495,0.16],[0.475,0.125]],[[0.675,0.24],[0.5,0.245]],[[0.485,0.55],[0.465,0.675]],[[0.47,0.68],[0.795,0.68],[0.805,0.69],[0.805,0.865]],[[0.805,0.875],[0.805,0.905]]],"業":[[[0.625,0.35],[0.61,0.41]],[[0.09,0.655],[0.41,0.655],[0.425,0.67]],[[0.58,0.26],[0.645,0.265]],[[0.49,0.545],[0.49,0.665]],[[0.635,0.33],[0.65,0.27]],[[0.73,0.195],[0.73,0.255]],[[0.66,0.77],[0.675,0.78]],[[0.685,0.785],[0.7,0.795]],[[0.375,0.41],[0.345,0.275]],[[0.705,0.195],[0.725,0.19]],[[0.575,0.255],[0.575,0.085]],[[0.48,0.675],[0.49,0.685],[0.49,0.91]],[[0.38,0.415],[0.49,0.425]],[[0.495,0.425],[0.6,0.42]],[[0.075,0.89],[0.12,0.895]],[[0.43,0.675],[0.475,0.675]],[[0.905,0.655],[0.58,0.66]],[[0.23,0.845],[0.145,0.885]],[[0.49,0.535],[0.49,0.43]],[[0.495,0.54],[0.8,0.54]],[[0.25,0.26],[0.325,0.26],[0.34,0.27]],[[0.655,0.265],[0.725,0.26]],[[0.3,0.805],[0.26,0.83]],[[0.405,0.255],[0.405,0.085]],[[0.245,0.255],[0.255,0.18],[0.205,0.105]],[[0.365,0.42],[0.15,0.42]],[[0.35,0.77],[0.365,0.755]],[[0.195,0.54],[0.485,0.54]],[[0.61,0.415],[0.845,0.42]],[[0.74,0.165],[0.76,0.13]],[[0.735,0.26],[0.895,0.26]],[[0.925,0.86],[0.865,0.87],[0.8,0.845]],[[0.35,0.265],[0.4,0.26]],[[0.57,0.26],[0.41,0.26]],[[0.57,0.67],[0.59,0.72],[0.615,0.74]],[[0.78,0.835],[0.73,0.81]],[[0.24,0.26],[0.1,0.26]],[[0.565,0.67],[0.495,0.67]],[[0.415,0.69],[0.405,0.72],[0.375,0.75]]],"中":[[[0.49,0.6],[0.49,0.905]],[[0.155,0.665],[0.155,0.6]],[[0.16,0.3],[0.165,0.295]],[[0.16,0.3],[0.155,0.59]],[[0.495,0.595],[0.83,0.595]],[[0.49,0.29],[0.49,0.105]],[[0.835,0.6],[0.835,0.66]],[[0.49,0.59],[0.49,0.3]],[[0.165,0.295],[0.485,0.295]],[[0.835,0.59],[0.83,0.295],[0.495,0.295]],[[0.485,0.595],[0.16,0.595]]],"薬":[[[0.64,0.43],[0.64,0.335],[0.63,0.325],[0.48,0.32]],[[0.845,0.535],[0.795,0.505]],[[0.605,0.735],[0.645,0.765]],[[0.49,0.26],[0.48,0.315]],[[0.645,0.16],[0.91,0.16]],[[0.75,0.82],[0.82,0.85]],[[0.72,0.805],[0.69,0.79]],[[0.9,0.665],[0.58,0.67]],[[0.595,0.73],[0.59,0.725]],[[0.49,0.56],[0.48,0.55],[0.36,0.55],[0.355,0.44]],[[0.495,0.565],[0.495,0.675]],[[0.495,0.905],[0.495,0.69]],[[0.765,0.49],[0.735,0.475]],[[0.355,0.43],[0.355,0.335]],[[0.375,0.755],[0.33,0.79]],[[0.405,0.73],[0.415,0.705]],[[0.23,0.845],[0.27,0.825]],[[0.355,0.335],[0.36,0.33]],[[0.195,0.335],[0.21,0.35]],[[0.335,0.16],[0.09,0.16]],[[0.49,0.685],[0.435,0.685]],[[0.63,0.55],[0.505,0.555]],[[0.63,0.55],[0.635,0.545]],[[0.395,0.74],[0.385,0.75]],[[0.185,0.33],[0.165,0.315]],[[0.905,0.865],[0.845,0.86]],[[0.185,0.865],[0.135,0.885]],[[0.5,0.68],[0.565,0.68]],[[0.26,0.5],[0.27,0.485]],[[0.205,0.535],[0.135,0.575],[0.115,0.565]],[[0.43,0.68],[0.415,0.665],[0.095,0.665]],[[0.77,0.35],[0.735,0.375]],[[0.635,0.16],[0.345,0.16]],[[0.36,0.435],[0.635,0.435]],[[0.64,0.165],[0.64,0.22]],[[0.245,0.38],[0.22,0.355]],[[0.34,0.165],[0.34,0.22]],[[0.34,0.085],[0.34,0.155]],[[0.64,0.44],[0.635,0.545]],[[0.105,0.89],[0.125,0.89]],[[0.59,0.725],[0.57,0.685]],[[0.64,0.155],[0.64,0.085]],[[0.36,0.33],[0.465,0.325]]]};
// path data for a string laid out horizontally (vertical=false) or stacked vertically, size = em in panel px
function tubeD(str, x0, y0, size, vertical = true, gap = 1.04) {
  let d = '';
  [...str].forEach((ch, i) => {
    const g = NEON_GLYPHS[ch]; if (!g) return;
    const ox = vertical ? x0 - size / 2 : x0 + i * size * gap, oy = vertical ? y0 + i * size * gap : y0;
    for (const p of g) d += 'M' + p.map(([u, v]) => (ox + u * size).toFixed(2) + ' ' + (oy + v * size).toFixed(2)).join(' L');
  });
  return d;
}
// lit neon tube: soft spill on the backing, tight halo, saturated tube, slightly paler core where hottest
function tube(d, col, sw, core, o = {}) {
  const cap = 'fill="none" stroke-linecap="round" stroke-linejoin="round"';
  return `<path d="${d}" ${cap} stroke="${col}" stroke-width="${sw * 7}" opacity="${o.spill ?? .22}" filter="url(#b5)"/>
    <path d="${d}" ${cap} stroke="${col}" stroke-width="${sw * 2.6}" opacity="${o.halo ?? .45}" filter="url(#b1)"/>
    <path d="${d}" ${cap} stroke="${col}" stroke-width="${sw}"/>
    <path d="${d}" ${cap} stroke="${core || col}" stroke-width="${sw * .38}" opacity=".85"/>`;
}
// unlit/dark glass tube (for the 'off' segments of a chaser, or blocked-out returns)
const deadTube = (d, sw) => `<path d="${d}" fill="none" stroke="#1a1416" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
// vertical CJK text where the long-vowel mark ー is turned 90° (as Japanese vertical setting requires)
function VTj(cx, y0, str, size, font, fill, extra = '', gap = 1.02) {
  return [...str].map((ch, i) => {
    const y = y0 + (i + 0.86) * size * gap;
    if (ch === 'ー' || ch === '－') return `<rect x="${cx - size * .045}" y="${y - size * .78}" width="${size * .09}" height="${size * .68}" fill="${fill}"/>`;
    return `<text x="${cx}" y="${y}" font-size="${size}" font-family="${font}" fill="${fill}" text-anchor="middle" ${extra}>${esc(ch)}</text>`;
  }).join('');
}
// steel suspension cable from a page point up toward the vertical vanishing point (true plumb line)
function cable(p, len, sw = .55, col = '#0b0c0e', fade = false) {
  const vv = CAM_VV, dx = vv[0] - p[0], dy = vv[1] - p[1], L = Math.hypot(dx, dy);
  const q = [p[0] + dx / L * len, p[1] + dy / L * len];
  const st = fade ? GRAD.lin(p, q, [[0, col, 1], [.6, col, .8], [1, col, 0]]) : col;
  const hl = fade ? GRAD.lin(p, q, [[0, '#a4a8b0', 1], [.5, '#a4a8b0', .5], [1, '#a4a8b0', 0]]) : '#a4a8b0';
  return `${fade ? GRAD.flush() : ''}<line x1="${p[0].toFixed(2)}" y1="${p[1].toFixed(2)}" x2="${q[0].toFixed(2)}" y2="${q[1].toFixed(2)}" stroke="${st}" stroke-width="${sw}" stroke-linecap="round"/>
    <line x1="${(p[0] + .25).toFixed(2)}" y1="${p[1].toFixed(2)}" x2="${(q[0] + .25).toFixed(2)}" y2="${q[1].toFixed(2)}" stroke="${hl}" stroke-width="${sw * .4}" opacity=".55"/>
    <rect x="${p[0] - sw * 1.4}" y="${p[1] - sw * 1.2}" width="${sw * 2.8}" height="${sw * 1.6}" fill="#15171a"/>`;
}
const CAM_VV = [760.9137, -1932.5349];
// length of a plumb cable from p up to the underside of the overhead beam that runs above the train
// (beam underside traced on base.png: y = 464 + .5125 x, page px)
function toBeam(p) {
  const dx = CAM_VV[0] - p[0], dy = CAM_VV[1] - p[1], L = Math.hypot(dx, dy);
  const t = (464 + .5125 * p[0] - p[1]) / (dy - .5125 * dx);
  return t * L;
}

// =====================================================================
// S0 — the dark-blue ribbon along the train: rolling news, stocks, next station, art-deco ad
// =====================================================================
function decoCouple(cx, base, s) {
  // art-deco silhouettes: woman in a long gown leaning back, dancing with a caped bat-eared vigilante
  return `<g transform="translate(${cx} ${base}) scale(${s})" fill="url(#gold)" stroke="url(#gold)" stroke-linecap="round" stroke-linejoin="round">
    <path d="M14 -150 l2 -10 l3 8 h4 l3 -8 l2 10 c4 6 2 14 -4 16 h-6 c-6 -2 -8 -10 -4 -16 z" stroke="none"/>
    <path d="M8 -132 h26 l6 34 l-6 2 l-2 30 l4 66 h-9 l-6 -58 l-4 58 h-9 l2 -66 l-6 -34 z" stroke="none"/>
    <path d="M36 -128 c22 22 34 80 34 128 l-20 -8 l-10 12 l-8 -14 z" stroke="none" opacity=".9"/>
    <path d="M10 -126 L-14 -112" stroke-width="7" fill="none"/>
    <circle cx="-16" cy="-140" r="8" stroke="none"/>
    <path d="M-20 -146 c-6 -4 -14 -2 -16 4 c6 -2 10 0 12 4 z" stroke="none"/>
    <path d="M-14 -128 c-6 6 -10 18 -6 30 l4 18 c-14 22 -30 50 -40 80 h70 c-8 -30 -16 -58 -20 -82 l2 -22 c2 -12 -2 -20 -10 -24 z" stroke="none"/>
    <path d="M-20 -120 L-46 -150" stroke-width="5" fill="none"/>
  </g>`;
}
panel({ z: 166, sg: 'band', svg: (w, h) => {
  const news = 'BREAKING ◆ DIHTOWN LINE RUNNING 3 MIN LATE AFTER ACID STORM ◆ CITY COUNCIL APPROVES 3000-STOREY SKYBRIDGE ◆ ORBITAL ELEVATOR REOPENS AT DAWN ◆ RING DISTRICT POWER RESTORED ◆ ';
  const stocks = [['DHTN', '3,000.00', '+3.02'], ['OOSK', '812.40', '-0.61'], ['NKY', '41,203', '+1.24'], ['SYNTH', '228.17', '+4.80'], ['KIRIN-T', '96.05', '-1.13'], ['ORBX', '1,540.9', '+0.72'], ['NEURO', '77.31', '-2.30'], ['HYDRO', '12.88', '+0.21']];
  const fs = h * .17;
  let st = '', x = 4;
  for (let k = 0; k < 6; k++) for (const [n, v, c] of stocks) {
    const up = c[0] === '+';
    st += T(x, h * .955, n, fs, 'VT323', '#d6e6ff') + T(x + (n.length + 1) * fs * .5, h * .955, v, fs, 'VT323', '#ffffff') + T(x + (n.length + v.length + 2) * fs * .5, h * .955, (up ? '▲' : '▼') + c.slice(1) + '%', fs, 'VT323', up ? '#45ff7a' : '#ff4552');
    x += (n.length + v.length + c.length + 5) * fs * .5;
  }
  const station = (x0) => `
    ${rect(x0, h * .26, h * 1.9, h * .5, '#0d2a6e')}${rect(x0, h * .26, h * .07, h * .5, '#ffb000')}
    ${T(x0 + h * .14, h * .38, '次は  NEXT STATION', h * .085, SANS, '#bcd3ff', 'font-weight="600" letter-spacing=".5"')}
    ${T(x0 + h * .14, h * .62, 'DIHTOWN', h * .22, SANS, '#ffffff', 'font-weight="800" letter-spacing=".5"')}
    ${T(x0 + h * .14, h * .72, 'ディータウン  ·  then OOSKAKSK', h * .07, SANS, '#ffd27a', 'font-weight="500"')}`;
  const deco = (x0, ww) => `
    <g transform="translate(${x0} ${h * .25})">
      ${rect(0, 0, ww, h * .52, '#070503')}
      ${Array.from({ length: 19 }, (_, i) => { const a = Math.PI + i * Math.PI / 18; return `<line x1="${ww / 2}" y1="${h * .52}" x2="${ww / 2 + Math.cos(a) * ww}" y2="${h * .52 + Math.sin(a) * ww}" stroke="#d9a94e" stroke-width=".5" opacity=".55"/>`; }).join('')}
      <rect x="1.5" y="1.5" width="${ww - 3}" height="${h * .52 - 3}" fill="none" stroke="url(#gold)" stroke-width="1"/>
      <path d="M4 ${h * .09} H${ww * .3} M${ww * .7} ${h * .09} H${ww - 4}" stroke="#d9a94e" stroke-width=".6"/>
      ${decoCouple(ww / 2, h * .5, h * .0026)}
      ${T(ww / 2, h * .07, 'THE MIDNIGHT WALTZ', h * .05, "'Poiret One'", '#ffe6a8', 'text-anchor="middle" letter-spacing="1.5"')}
      ${T(ww / 2, h * .505, 'GRAND BALLROOM · LEVEL 1,800 · TONIGHT', h * .03, "'Josefin Sans'", '#d9a94e', 'text-anchor="middle" letter-spacing="1" font-weight="700"')}
    </g>`;
  const live = (x0, ww) => `
    <g transform="translate(${x0} ${h * .26})">
      <image href="ringdetail.jpg" width="${ww}" height="${h * .5}" preserveAspectRatio="xMidYMid slice"/>
      ${rect(0, h * .37, ww, h * .13, '#b3001b', 'opacity=".92"')}
      ${T(h * .04, h * .465, 'LIVE  RING DISTRICT — POWER RESTORED AFTER 6 HRS', h * .065, SANS, '#fff', 'font-weight="700"')}
      ${rect(h * .04, h * .04, h * .2, h * .08, '#e0001b')}${T(h * .14, h * .105, 'LIVE', h * .06, SANS, '#fff', 'text-anchor="middle" font-weight="800"')}
    </g>`;
  return `
  ${rect(0, 0, w, h, '#03060d')}
  ${rect(0, 0, w, h * .24, '#0b0703')}
  ${T(4, h * .19, news + news + news + news, h * .19, 'VT323', '#ffb13b', 'letter-spacing=".4"')}
  ${rect(0, h * .245, w, h * .012, '#29447a')}${rect(0, h * .785, w, h * .012, '#29447a')}
  ${station(h * .1)}
  ${live(h * 2.1, h * 1.9)}
  ${deco(w * .355, w * .095)}
  ${station(w * .46)}
  ${live(w * .46 + h * 2, h * 1.9)}
  ${station(w * .62)}
  ${deco(w * .62 + h * 2, h * 1.2)}
  ${station(w * .86)}
  ${st}
  ${screen(w, h, { mod: h / 3, fall: 'R', fallOp: .5 })}
`; } });

// =====================================================================
// S15 — giant LED screen (luxury residences ad, photographic) + S16 cyberpunk LED light crown
// =====================================================================
// The lower ~30% of the screen is hidden behind the passing train (foreground matte, z 196), so the
// whole composition lives in v < .68. Content is an emissive render (dawn above a cloud sea), not a photo.
panel({ z: 185, sg: 'led', svg: (w, h) => {
  const tx = w * .76;
  // cumulus sea: banks of billows, far banks small and pale, near banks large; lit from the low sun
  // (warm tops) with blue-grey shadowed undersides
  let clouds = '';
  _seed = 41;
  for (let L = 0; L < 10; L++) {
    const yb = h * (.545 + L * .03), rr = w * (.025 + L * .014);
    const lit = mix('#ffd9ae', '#e9e2da', Math.min(1, L / 6)), sh = mix('#7d8cab', '#34405e', Math.min(1, L / 9));
    const gid = 'cg' + L;
    clouds += `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${lit}"/><stop offset=".45" stop-color="${mix(lit, sh, .55)}"/><stop offset="1" stop-color="${sh}"/></linearGradient></defs><g fill="url(#${gid})">`;
    for (let x = -rr; x < w + rr; x += rr * (.7 + rnd() * .6)) {
      const r = rr * (.6 + rnd() * .8);
      clouds += `<circle cx="${x}" cy="${yb - r * .4 + rnd() * rr * .4}" r="${r}"/>`;
    }
    clouds += `${rect(0, yb, w, h * .06 + rr, sh)}</g>`;
  }
  return `
  <defs>
    <linearGradient id="ledSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#081634"/><stop offset=".3" stop-color="#1d3f7a"/><stop offset=".46" stop-color="#5a78b0"/><stop offset=".53" stop-color="#e7a466"/><stop offset=".58" stop-color="#ffd9a6"/><stop offset="1" stop-color="#b9c4d8"/></linearGradient>
    <radialGradient id="ledSun" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff4dc"/><stop offset=".25" stop-color="#ffd59a" stop-opacity=".8"/><stop offset="1" stop-color="#ff9a4a" stop-opacity="0"/></radialGradient>
    <linearGradient id="ledTw" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#1a2236"/><stop offset=".45" stop-color="#3a4660"/><stop offset=".55" stop-color="#121a2a"/><stop offset="1" stop-color="#0a1020"/></linearGradient>
  </defs>
  ${rect(0, 0, w, h, 'url(#ledSky)')}
  <ellipse cx="${w * .62}" cy="${h * .54}" rx="${w * .55}" ry="${h * .09}" fill="url(#ledSun)"/>
  <g transform="translate(${tx} 0)">
    <path d="M${-w * .035} ${h * .7} L${-w * .022} ${h * .26} L${w * .022} ${h * .26} L${w * .035} ${h * .7} Z" fill="url(#ledTw)"/>
    <ellipse cx="0" cy="${h * .25}" rx="${w * .2}" ry="${h * .022}" fill="none" stroke="#2a3550" stroke-width="${h * .009}"/>
    <path d="M${-w * .2} ${h * .25} A ${w * .2} ${h * .022} 0 0 0 ${w * .2} ${h * .25}" fill="none" stroke="#ffd9a6" stroke-width="${h * .0035}" opacity=".9"/>
    <path d="M${-w * .022} ${h * .26} L0 ${h * .17} L${w * .022} ${h * .26} Z" fill="#202a40"/>
    <line x1="0" y1="${h * .17}" x2="0" y2="${h * .12}" stroke="#2a3550" stroke-width="${w * .004}"/>
    ${Array.from({ length: 14 }, (_, i) => rect(-w * .016, h * (.29 + i * .028), w * .032, h * .003, '#ffe2b0', `opacity="${.35 + (i % 3) * .2}"`)).join('')}
    <path d="M${w * .028} ${h * .3} L${w * .034} ${h * .66}" stroke="#ffcf96" stroke-width="${w * .004}" opacity=".7"/>
  </g>
  <g filter="url(#b1)">${clouds}</g>
  ${rect(0, h * .9, w, h * .1, '#34405e')}
  ${rect(0, h * .5, w, h * .06, '#ffe2b8', 'opacity=".25" filter="url(#b3)"')}
  ${rect(0, 0, w, h * .3, '#000', 'opacity=".25" filter="url(#b8)"')}
  ${T(w * .08, h * .06, 'DIHTOWN DEVELOPMENT CORP.', h * .016, SANS, '#cfd9e6', 'font-weight="600" letter-spacing="2.2"')}
  ${T(w * .08, h * .13, 'THE RING', h * .062, DISP, '#ffffff', 'font-weight="200" letter-spacing="5"')}
  ${T(w * .08, h * .158, 'RESIDENCES · LV 1,200–2,000 M', h * .015, SANS, '#ffd59a', 'font-weight="600" letter-spacing=".8"')}
  ${rect(w * .08, h * .178, w * .25, h * .0022, '#ffd59a')}
  ${T(w * .08, h * .215, '雲の上の暮らし。', h * .024, "'IPAGothic'", '#e8eef7', '')}
  ${T(w * .08, h * .35, 'Live above', h * .034, DISP, '#ffffff', 'font-weight="300"')}
  ${T(w * .08, h * .388, 'the acid rain.', h * .034, DISP, '#ffffff', 'font-weight="300"')}
  ${T(w * .08, h * .416, 'Private sky-lifts · 24h air filtration', h * .0135, SANS, '#e9eef6', 'font-weight="500"')}
  ${T(w * .08, h * .438, 'NOW LEASING · 3,000 CR / MO', h * .014, SANS, '#fff0d8', 'font-weight="800" letter-spacing="1"')}
  ${screen(w, h, { mod: h / 14, fall: 'R', fallOp: .45, seamOp: .09 })}
  ${gondola(w * .93, h * .34, h / 110)}
`; } });
// S16 — 'Led light with cyberpunk style': a crown of chevron LED fixtures on a steel rail ABOVE the screen
panel({ z: 186, quad: [[364.8, 318.0], [630.3, 488.5], [628.2, 526.0], [358.2, 355.0]], svg: (w, h) => {
  let s = rect(0, h * .2, w, h * .62, '#0a0c0f') + rect(0, h * .2, w, h * .05, '#2a2e34') + rect(0, h * .78, w, h * .04, '#050607');
  for (let i = 0; i < 6; i++) { const x = w * (.04 + i * .184); s += rect(x, h * .78, w * .012, h * .22, '#121418') + rect(x - w * .006, h * .12, w * .024, h * .1, '#16181c'); }
  const n = 18;
  for (let i = 0; i < n; i++) {
    const x = w * (.03 + i * .053), c = i % 6 === 2 || i % 6 === 3 ? '#ff4fd8' : '#4ff0ff';
    s += rect(x - w * .004, h * .3, w * .036, h * .42, '#030405');
    s += tube(`M${x} ${h * .34} L${x + w * .022} ${h * .51} L${x} ${h * .68}`, c, h / 16, i % 6 === 2 || i % 6 === 3 ? '#ffc8f2' : '#d8fcff', { spill: .18, halo: .4 });
  }
  s += tube(`M${w * .01} ${h * .86} H${w * .99}`, '#bff6ff', h / 22, '#ffffff', { spill: .25, halo: .5 });
  return s;
} });
// =====================================================================
// Multi-layer holographic GPU ad — exploded view on 5 parallel planes
// =====================================================================
function gpuCard(x, y, w, h, c) {
  const fanR = h * .36;
  const fan = (cx) => `<circle cx="${cx}" cy="${y + h * .5}" r="${fanR}" fill="#0b1210" stroke="${c}" stroke-width="${h * .03}"/>
    ${Array.from({ length: 9 }, (_, i) => { const a = i * Math.PI * 2 / 9; return `<path d="M${cx} ${y + h * .5} q${Math.cos(a + .6) * fanR * .7} ${Math.sin(a + .6) * fanR * .7} ${Math.cos(a + 1) * fanR * .95} ${Math.sin(a + 1) * fanR * .95}" stroke="${c}" stroke-width="${h * .022}" fill="none" opacity=".85"/>`; }).join('')}
    <circle cx="${cx}" cy="${y + h * .5}" r="${fanR * .28}" fill="${c}" opacity=".9"/>`;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h * .08}" fill="#121815" stroke="${c}" stroke-width="${h * .03}"/>
    ${fan(x + w * .2)}${fan(x + w * .5)}${fan(x + w * .8)}
    <rect x="${x + w * .05}" y="${y + h * .9}" width="${w * .9}" height="${h * .04}" fill="#9dff3a"/>`;
}
const GPUL = [
  (w, h, tb, sl, c) => `${Array.from({ length: 12 }, (_, i) => `<line x1="${w * i / 12}" y1="0" x2="${w * i / 12}" y2="${h}" stroke="${c}" stroke-width=".4" opacity=".6"/>`).join('')}
     ${Array.from({ length: 30 }, (_, i) => `<line x1="0" y1="${h * i / 30}" x2="${w}" y2="${h * i / 30}" stroke="${c}" stroke-width=".4" opacity=".6"/>`).join('')}
     ${T(w / 2, h * tb * .62, '3000', w * .3, 'Orbitron', 'none', `text-anchor="middle" font-weight="900" stroke="${c}" stroke-width=".7"`)}`,
  (w, h, tb, sl, c) => `${Array.from({ length: 22 }, (_, i) => rect(w * .06 + i * w * .04, h * tb * .2, w * .018, h * tb * .65, c, 'opacity=".75"')).join('')}
     ${Array.from({ length: 16 }, (_, i) => rect(w * sl + (w * (1 - sl)) * .15, h * (tb + .04 + i * .05), w * (1 - sl) * .7, h * .012, c, 'opacity=".7"')).join('')}`,
  (w, h, tb, sl, c) => `${gpuCard(w * .04, h * tb * .14, w * .92, h * tb * .72, c)}
     ${T(w * (sl + 1) / 2, h * (tb + .1), 'COOLER', w * .07, 'Orbitron', c, 'text-anchor="middle" font-weight="900"')}`,
  (w, h, tb, sl, c) => `<rect x="${w * .05}" y="${h * tb * .15}" width="${w * .9}" height="${h * tb * .7}" fill="#0a2a10" stroke="${c}" stroke-width="1"/>
     <rect x="${w * .38}" y="${h * tb * .25}" width="${w * .24}" height="${h * tb * .5}" fill="#9dff3a" opacity=".9"/>
     ${Array.from({ length: 14 }, (_, i) => `<path d="M${w * .38} ${h * tb * (.27 + i * .034)} H${w * (.1 + (i % 4) * .05)}" stroke="#ffd36a" stroke-width=".7"/>`).join('')}
     ${T(w / 2, h * tb * .58, 'NV-X', w * .07, 'Orbitron', '#03140a', 'text-anchor="middle" font-weight="900"')}
     ${VT(w * (sl + 1) / 2, h * (tb + .04), 'NVIDIA', w * (1 - sl) * .55, 'Orbitron', '#eaffcc', 'font-weight="900"', 1.08)}`,
  (w, h, tb, sl, c) => `${T(w / 2, h * tb * .45, 'NVIDIA', w * .2, 'Orbitron', '#ffffff', 'text-anchor="middle" font-weight="900"')}
     ${T(w / 2, h * tb * .8, 'XR 3000', w * .13, 'Orbitron', '#9dff3a', 'text-anchor="middle" font-weight="900"')}
     ${['3.0 PFLOPS', '96 GB HBM5', 'NEURAL-RT', 'COMING 3000'].map((s, i) => T(w * (sl + .04), h * (tb + .08 + i * .06), s, w * (1 - sl) * .14, 'Share Tech Mono', '#e9fbff')).join('')}`,
];
const GPUC = ['#7fd8ff', '#5ffff0', '#c9f3ff', '#76ff2a', '#f2fff2'];
// three transparent LED-mesh scrims (no fog, no frames), each hung on two thin cables from the structure above
GPUL[3] = (w, h, tb, sl, c) => `<rect x="${w * .05}" y="${h * tb * .15}" width="${w * .9}" height="${h * tb * .7}" fill="#0a2a10" opacity=".55"/>
     <rect x="${w * .38}" y="${h * tb * .25}" width="${w * .24}" height="${h * tb * .5}" fill="#9dff3a" opacity=".85"/>
     ${Array.from({ length: 14 }, (_, i) => `<path d="M${w * .38} ${h * tb * (.27 + i * .034)} H${w * (.1 + (i % 4) * .05)}" stroke="#ffd36a" stroke-width=".7"/>`).join('')}
     ${T(w / 2, h * tb * .58, 'NV-X', w * .07, 'Orbitron', '#03140a', 'text-anchor="middle" font-weight="900"')}
     ${T(w * (sl + 1) / 2, h * (tb + .07), 'NVIDIA', w * (1 - sl) * .18, 'Orbitron', '#eaffcc', 'text-anchor="middle" font-weight="900"')}`;
GPUL[4] = (w, h, tb, sl, c) => `${T(w / 2, h * tb * .45, 'NVIDIA', w * .2, 'Orbitron', '#ffffff', 'text-anchor="middle" font-weight="900"')}
     ${T(w / 2, h * tb * .8, 'XR 3000', w * .13, 'Orbitron', '#9dff3a', 'text-anchor="middle" font-weight="900"')}
     ${['3.0 PFLOPS', '96 GB HBM5', 'NEURAL-RT'].map((s, i) => T(w * (sl + .04), h * (tb + .08 + i * .06), s, w * (1 - sl) * .14, 'Share Tech Mono', '#e9fbff')).join('')}`;
for (let k = 0; k < 3; k++) {
  const key = 'gpu' + k, g = SG[key], L = k + 2;
  panel({ z: 137 + k * 2, sg: key, blend: 'screen', opacity: .5 + k * .1, svg: (w, h) => holo(w, h, GPUL[L](w, h, g.top_b, g.stem_l, GPUC[L]), GPUC[L], { fog: 0, scan: .14, band: .2 + k * .13, edge: 0 }) });
  panel({ z: 137.5 + k * 2, clip: [], svg: () => [sgPoint(key, .04, 0), sgPoint(key, .96, 0)].map(p => cable(p, p[1] + 40, .45)).join('') });
}
// =====================================================================
// Hanging cube (top-left): ramen chain, faces solved as a true 3-D box
// =====================================================================
panel({ z: 188.1, sg: 'cube_right', svg: (w, h) => `
  <defs><linearGradient id="cubeR" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d4a1a"/><stop offset="1" stop-color="#06260c"/></linearGradient></defs>
  ${rect(0, 0, w, h, 'url(#cubeR)')}
  <g filter="url(#b2)" opacity=".5">${VT(w * .5, h * .3, '龍麺', w * .8, "'IPAGothic'", '#9dff7a', '', 1.02)}</g>
  ${VT(w * .5, h * .3, '龍麺', w * .8, "'IPAGothic'", '#eaffd8', '', 1.02)}
  ${rect(w * .12, h * .3 - w * .25, w * .76, w * .05, '#eaffd8', 'opacity=".9"')}
  ${screen(w, h, { mod: w / 3, fall: 'T', fallOp: .5 })}
` });
panel({ z: 188.2, sg: 'cube_left', svg: (w, h) => `
  ${rect(0, 0, w, h, 'url(#cubeR)')}${rect(0, 0, w, h, '#000', 'opacity=".4"')}
  ${rect(0, h * .12, w, h * .05, '#eaffd8', 'opacity=".85"')}
  ${rect(0, h * .2, w, h * .012, '#7dff5a', 'opacity=".6"')}
  ${screen(w, h, { mod: w / 3, fall: 'T', fallOp: .5 })}
` });
panel({ z: 188.3, sg: 'cube_bottom', svg: (w, h) => downlights(w, h, 22, 11, '#ffe6c2', h / 120) });

// =====================================================================
// Pachinko tower sign (top-right, perpendicular facade)
// =====================================================================
// a real lightbox: steel frame + return (box depth into the wall), diffuser face with hot centre and
// visible fluorescent-tube shadows, chaser bulbs as small bright points
panel({ z: 104.9, clip: [], svg: () => {
  const F = Frame('pachinko');
  return solid(F, -.01, -.01, 1.01, 1.01, 0, .07, { all: '#0e0c08', bottom: '#2a2210', left: '#17130b', right: '#0a0906' });
} });
panel({ z: 105, sg: 'pachinko', svg: (w, h) => {
  const fr = w * .045;
  let bulbs = '', halo = '';
  const nb = 12, nbx = 4, r = w * .022;
  const put = (x, y, i) => { const op = i % 3 === 0 ? .3 : 1; halo += `<circle cx="${x}" cy="${y}" r="${r * 2.6}" fill="#ff9a00" opacity="${.45 * op}"/>`; bulbs += `<circle cx="${x}" cy="${y}" r="${r * 1.25}" fill="#3a2a08"/><circle cx="${x}" cy="${y}" r="${r}" fill="#fff0b8" opacity="${op}"/>`; };
  let n = 0;
  for (let i = 0; i <= nb; i++) { const y = fr * 1.6 + i * (h - fr * 3.2) / nb; put(fr * .5, y, n++); put(w - fr * .5, y, n++); }
  for (let i = 1; i < nbx; i++) { const x = i * w / nbx; put(x, fr * .5, n++); put(x, h - fr * .5, n++); }
  return `
  <defs><radialGradient id="pachHot" cx=".5" cy=".42" r=".8"><stop offset="0" stop-color="#fff3c8"/><stop offset=".5" stop-color="#ffd02a"/><stop offset="1" stop-color="#b87d00"/></radialGradient></defs>
  ${rect(0, 0, w, h, '#15120a')}
  ${rect(fr * .35, fr * .35, w - fr * .7, h - fr * .7, 'none', `stroke="#3a3326" stroke-width="${fr * .12}"`)}
  ${rect(fr, fr, w - 2 * fr, h - 2 * fr, 'url(#pachHot)')}
  ${Array.from({ length: 5 }, (_, i) => rect(fr, (i + 1) * h / 6 - h * .012, w - 2 * fr, h * .024, '#7a4a00', 'opacity=".12" filter="url(#b2)"')).join('')}
  ${rect(fr, fr, w - 2 * fr, h * .012, '#000', 'opacity=".35"')}
  ${VT(w / 2, h * .05, 'パチンコ', h * .118, JP, '#d4000e', `stroke="#3a0000" stroke-width="${h / 160}" paint-order="stroke"`, 1.0)}
  ${rect(w * .14, h * .595, w * .72, h * .16, '#120303')}${rect(w * .14, h * .595, w * .72, h * .16, 'none', `stroke="#4a3a20" stroke-width="${w * .012}"`)}
  ${NEON((f, s, sw) => T(w / 2, h * .73, '777', w * .22, 'Bungee', f, `text-anchor="middle" stroke="${s}" stroke-width="${sw}"`), '#ff2020', '#ffb080', 2, 1)}
  ${T(w / 2, h * .878, '大当り', w * .15, JP, '#3a0000', 'text-anchor="middle"')}
  ${T(w / 2, h * .935, 'JACKPOT · 3000 MACHINES', w * .05, SANS, '#3a0000', 'text-anchor="middle" font-weight="800"')}
  ${rect(0, 0, w, h, 'url(#fallL)', 'opacity=".3"')}
  <g filter="url(#b2)">${halo}</g>${bulbs}
`; } });

// =====================================================================
// Karaoke lightbox (replaces the old 修理 sign, same facade plane)
// =====================================================================
// real neon: one monoline glass tube per stroke on a dark sheet-metal box with a visible return edge
panel({ z: 164, sg: 'karaoke', svg: (w, h) => {
  const d = tubeD('カラオケ', w * .5, h * .07, w * .62, true, 1.08);
  return `
  ${rect(0, 0, w, h, '#0a0204')}
  ${rect(w * .04, w * .04, w * .92, h - w * .08, '#140308')}
  ${rect(0, 0, w, h, 'none', `stroke="#26181c" stroke-width="${w / 30}"`)}
  ${rect(w * .02, h - w * .05, w * .96, w * .03, '#000', 'opacity=".6"')}
  ${tube(`M${w * .1} ${h * .035} H${w * .9} V${h * .965} H${w * .1} Z`, '#ff2f6d', w / 70, '#ff8fb0', { spill: .16, halo: .35 })}
  ${tube(d, '#ff2b62', w / 42, '#ff86a6')}
  ${tube(`M${w * .25} ${h * .93} H${w * .75}`, '#45f0ff', w / 80, '#b8fbff', { spill: .15, halo: .3 })}
`; } });

// =====================================================================
// S14 — LED screen on the train cab front: expressionism ad (+ lower panel)
// =====================================================================
function screamArt(w, h) {
  let s = rect(0, 0, w, h, '#c4511a');
  const sky = ['#ff7a1a', '#ffb12a', '#e2401a', '#ffd06a', '#d6331a', '#ff8f2a', '#c0302a'];
  for (let i = 0; i < 18; i++) {
    const y = i * h * .032;
    s += `<path d="M${-w * .1} ${y} C ${w * .2} ${y - h * .05} ${w * .45} ${y + h * .06} ${w * .7} ${y - h * .02} S ${w * 1.05} ${y + h * .05} ${w * 1.1} ${y}" fill="none" stroke="${sky[i % 7]}" stroke-width="${h * (.03 + (i % 3) * .01)}" stroke-linecap="round"/>`;
  }
  for (let i = 0; i < 10; i++) {
    const y = h * .5 + i * h * .045;
    s += `<path d="M${-w * .1} ${y} C ${w * .25} ${y + h * .06} ${w * .45} ${y - h * .07} ${w * .62} ${y + h * .03}" fill="none" stroke="${['#173a95', '#2559c4', '#0e2463', '#3a6fd0'][i % 4]}" stroke-width="${h * .045}" stroke-linecap="round"/>`;
  }
  s += `<path d="M${w * .3} ${h * 1.05} L${w * 1.1} ${h * .45} L${w * 1.1} ${h * .62} L${w * .55} ${h * 1.05} Z" fill="#7a3a1a"/>`;
  for (let i = 0; i < 7; i++) s += `<line x1="${w * (.36 + i * .1)}" y1="${h * (1.02 - i * .075)}" x2="${w * (.42 + i * .1)}" y2="${h * (1.05 - i * .07)}" stroke="#3a1608" stroke-width="${h * .012}"/>`;
  s += `<path d="M${w * .44} ${h * 1.02} C ${w * .42} ${h * .85} ${w * .4} ${h * .7} ${w * .43} ${h * .6} C ${w * .38} ${h * .5} ${w * .38} ${h * .32} ${w * .47} ${h * .3} C ${w * .56} ${h * .28} ${w * .6} ${h * .45} ${w * .55} ${h * .6} C ${w * .58} ${h * .72} ${w * .57} ${h * .86} ${w * .58} ${h * 1.02} Z" fill="#2b2a3a"/>
    <path d="M${w * .43} ${h * .5} C ${w * .4} ${h * .32} ${w * .44} ${h * .2} ${w * .5} ${h * .2} C ${w * .56} ${h * .2} ${w * .6} ${h * .32} ${w * .56} ${h * .5} C ${w * .53} ${h * .56} ${w * .46} ${h * .56} ${w * .43} ${h * .5} Z" fill="#d9c79a"/>
    <ellipse cx="${w * .47}" cy="${h * .33}" rx="${w * .018}" ry="${h * .03}" fill="#2a1a0a"/><ellipse cx="${w * .53}" cy="${h * .33}" rx="${w * .018}" ry="${h * .03}" fill="#2a1a0a"/>
    <ellipse cx="${w * .5}" cy="${h * .44}" rx="${w * .02}" ry="${h * .045}" fill="#2a1a0a"/>
    <path d="M${w * .4} ${h * .42} C ${w * .38} ${h * .34} ${w * .4} ${h * .26} ${w * .43} ${h * .28}" stroke="#d9c79a" stroke-width="${h * .04}" fill="none" stroke-linecap="round"/>
    <path d="M${w * .6} ${h * .42} C ${w * .62} ${h * .34} ${w * .6} ${h * .26} ${w * .57} ${h * .28}" stroke="#d9c79a" stroke-width="${h * .04}" fill="none" stroke-linecap="round"/>`;
  return `<g filter="url(#paint)">${s}</g>`;
}
// The real windscreen + driver stay visible. The ad runs on a slim LED destination-style display set
// into the cab front between the headlight cluster and the light bars (page quad traced on base.png).
// Painterly (brush-stroke field through the #paint displacement), dimmed to a believable LED level.
function expressionStrip(w, h) {
  _seed = 77; let s = rect(0, 0, w, h, '#2a0f08');
  const warm = ['#c8501a', '#e07a22', '#b8361c', '#e8a040', '#9a2a1a'], cool = ['#1c3a7a', '#2a54a0', '#16285a', '#3a68b0'];
  for (let i = 0; i < 70; i++) {
    const y = rnd() * h * .62, x = rnd() * w * .62, l = w * (.06 + rnd() * .12);
    s += `<path d="M${x} ${y} q${l * .5} ${-h * (.1 + rnd() * .15)} ${l} 0" fill="none" stroke="${pick(warm)}" stroke-width="${h * (.06 + rnd() * .06)}" stroke-linecap="round" opacity=".9"/>`;
  }
  for (let i = 0; i < 26; i++) {
    const y = h * (.55 + rnd() * .45), x = rnd() * w * .62, l = w * (.08 + rnd() * .1);
    s += `<path d="M${x} ${y} q${l * .5} ${h * .12} ${l} ${-h * .05}" fill="none" stroke="${pick(cool)}" stroke-width="${h * .09}" stroke-linecap="round"/>`;
  }
  s += `<path d="M${w * .15} ${h * 1.05} L${w * .62} ${h * .35} L${w * .62} ${h * .6} L${w * .3} ${h * 1.05} Z" fill="#5a2a14" opacity=".9"/>`;
  s += `<path d="M${w * .26} ${h * 1.05} C${w * .25} ${h * .8} ${w * .245} ${h * .6} ${w * .255} ${h * .5} C${w * .24} ${h * .38} ${w * .25} ${h * .22} ${w * .272} ${h * .22} C${w * .296} ${h * .22} ${w * .304} ${h * .38} ${w * .29} ${h * .5} C${w * .298} ${h * .62} ${w * .296} ${h * .82} ${w * .298} ${h * 1.05} Z" fill="#1c1a24"/>
    <ellipse cx="${w * .272}" cy="${h * .36}" rx="${w * .011}" ry="${h * .14}" fill="#c9b48a"/>`;
  return `<g filter="url(#paint)">${s}</g>`;
}
panel({ z: 199, quad: [[44, 730], [134, 711], [132, 724], [41, 743]], svg: (w, h) => `
  ${rect(0, 0, w, h, '#06070a')}
  <g transform="translate(${w * .015} ${h * .1}) scale(.97 .8)">${expressionStrip(w, h)}</g>
  ${rect(w * .62, h * .1, w * .37, h * .8, '#0a0806', 'opacity=".75"')}
  ${T(w * .64, h * .48, 'EXPRESSIONISM', h * .3, SANS, '#ffd9b0', 'font-weight="800" letter-spacing=".3"')}
  ${T(w * .64, h * .8, 'THE SCREAM · DIHTOWN ART MUSEUM', h * .17, SANS, '#e8a070', 'font-weight="600"')}
  ${rect(0, 0, w, h, '#000', 'opacity=".35"')}
  ${LED(w, h, 2, .25)}
  ${rect(0, 0, w, h, 'none', `stroke="#0c0d10" stroke-width="${h * .1}"`)}
` });

// =====================================================================
// Train light bars (S13) — one fixture per car body: they stop at doors, gangways and car joints,
// and end with the last car. Each segment has its own slight brightness offset (separate fixtures).
// =====================================================================
const BAR_GAPS = [[140, 185], [198, 216], [288, 326], [511, 552], [588, 648], [686, 719], [891, 924], [943, 1003], [1051, 1086], [1212, 1276]];
const BAR_END = 1316;
panel({ z: 197, clip: [], svg: () => {
  let glow = '', mid = '', core = '';
  SG.bars.lines.forEach((pts, li) => {
    const x0 = pts[0][0], xN = pts[pts.length - 1][0];
    const yAt = x => { for (let i = 0; i < pts.length - 1; i++) { const [a, b] = [pts[i], pts[i + 1]]; if (x <= b[0] || i === pts.length - 2) return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); } };
    const wAt = (x, wa, wb) => wa + (wb - wa) * (x - x0) / (xN - x0);
    let segs = [[x0, BAR_END]];
    for (const [g0, g1] of BAR_GAPS) segs = segs.flatMap(([a, b]) => (g1 <= a || g0 >= b) ? [[a, b]] : [[a, g0], [g1, b]].filter(([p, q]) => q - p > 6));
    segs.forEach(([a, b], si) => {
      const xs = [a, ...pts.map(p => p[0]).filter(x => x > a && x < b), b];
      const d = 'M' + xs.map(x => x.toFixed(1) + ' ' + yAt(x).toFixed(1)).join(' L');
      const xm = (a + b) / 2, k = .85 + ((si * 7 + li * 3) % 7) / 20;
      glow += `<path d="${d}" stroke-width="${wAt(xm, 12, 6).toFixed(2)}" opacity="${(.26 * k).toFixed(3)}"/>`;
      mid += `<path d="${d}" stroke-width="${wAt(xm, 4.6, 2.2).toFixed(2)}" opacity="${(.8 * k).toFixed(3)}"/>`;
      core += `<path d="${d}" stroke-width="${wAt(xm, 2.2, 1.1).toFixed(2)}" opacity="${Math.min(1, k).toFixed(3)}"/>`;
    });
  });
  const g = 'fill="none" stroke-linecap="round" stroke-linejoin="round"';
  return `<g ${g} stroke="#ffc86a" filter="url(#b5)">${glow}</g><g ${g} stroke="#ffe2a8" filter="url(#b1)">${mid}</g><g ${g} stroke="#fff6e6">${core}</g>`;
} });
// vertical LED strip fixture beside the last car's door
panel({ z: 198, sg: 'trainstrip', svg: (w, h) => `${rect(w * .2, 0, w * .6, h, '#0b0d10')}
  ${rect(w * .28, h * .02, w * .44, h * .96, '#1a2a2e')}
  ${tube(`M${w * .5} ${h * .05} V${h * .95}`, '#7ff3ff', w * .2, '#e8fdff', { spill: .2, halo: .45 })}` });

// =====================================================================
// S3 — Soviet-style digital poster on a true 3-D box
// =====================================================================
// The box hangs IN FRONT of the train (z 200-202, above the foreground matte) from the overhead beam
panel({ z: 200, sg: 'sov_bottom', svg: (w, h) => downlights(w, h, 28, 2, '#ffe2c0', h / 34) });
panel({ z: 201, sg: 'sov_end', svg: (w, h) => `
  ${rect(0, 0, w, h, '#1c3a06')}${rect(0, 0, w, h, '#6ad01a', 'opacity=".3"')}
  <path transform="translate(${w / 2} ${h * .2}) scale(${w / 44})" d="M0 -14 l4.3 12.9 h13.5 l-10.9 8 l4.2 13 l-11.1 -8.1 l-11.1 8.1 l4.2 -13 l-10.9 -8 h13.5 z" fill="#e8261c"/>
  ${VT(w / 2, h * .4, 'ТРУД', w * .32, "'Russo One'", '#e2f5c8', '', 1.08)}
  ${screen(w, h, { mod: w / 2, fall: 'L', fallOp: .6 })}
` });
panel({ z: 202, sg: 'sov_front', svg: (w, h) => `
  <defs><linearGradient id="svR" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#c81812"/><stop offset="1" stop-color="#980a0a"/></linearGradient>
  <pattern id="half" width="3" height="3" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r=".7" fill="#000" opacity=".35"/></pattern></defs>
  ${rect(0, 0, w, h, 'url(#svR)')}
  <path d="M0 ${h} L${w * .4} 0 L${w * .54} 0 L${w * .14} ${h} Z" fill="#160606"/>
  <circle cx="${w * .84}" cy="${h * .5}" r="${h * .3}" fill="#e6d6b4"/>
  ${Array.from({ length: 9 }, (_, i) => { const a = -Math.PI * .92 + i * Math.PI * .2; return `<path d="M${w * .84} ${h * .5} L${w * .84 + Math.cos(a) * w} ${h * .5 + Math.sin(a) * w} L${w * .84 + Math.cos(a + .09) * w} ${h * .5 + Math.sin(a + .09) * w} Z" fill="#ffd2a0" opacity=".18"/>`; }).join('')}
  <g transform="translate(${w * .84} ${h}) scale(${h / 140})" fill="#140404">
    <path d="M-22 0 L-18 -42 C-18 -54 -11 -60 0 -60 C11 -60 18 -54 18 -42 L24 0 Z"/><circle cx="0" cy="-71" r="11.5"/>
    <path d="M11 -52 L27 -77 L35 -99 L46 -95 L37 -70 L21 -42 Z"/><rect x="31" y="-112" width="17" height="17" rx="3"/></g>
  ${rect(0, 0, w, h, 'url(#half)')}
  <path transform="translate(${w * .36} ${h * .2}) scale(${h / 110})" d="M0 -14 l4.3 12.9 h13.5 l-10.9 8 l4.2 13 l-11.1 -8.1 l-11.1 8.1 l4.2 -13 l-10.9 -8 h13.5 z" fill="#f2c640"/>
  ${T(w * .05, h * .4, 'ВПЕРЁД!', h * .2, "'Russo One'", '#efdfbc', 'letter-spacing="1"')}
  ${T(w * .05, h * .57, 'К 3000 ГОДУ', h * .12, "'Ruslan Display'", '#f2c640')}
  ${T(w * .05, h * .86, 'ЦИФРОВОЙ НАРОД — DIGITAL PEOPLE', h * .065, SANS, '#efdfbc', 'font-weight="700"')}
  ${screen(w, h, { mod: h / 5, fall: 'R', fallOp: .45 })}
` });
panel({ z: 202.5, clip: [], svg: () => [sgPoint('sov_front', .1, 0), sgPoint('sov_front', .9, 0), sgPoint('sov_end', .1, 0)].map(p => cable(p, toBeam(p), .7)).join('') });

// =====================================================================
// S2 — Japanese holographic neon ad on the existing station-entrance board
// =====================================================================
// low-profile projector housing sitting on the board's top edge (the 'holographic' emitter)
panel({ z: 110, sg: 's2cap', svg: (w, h) => {
  let l = '', g = '';
  for (let i = 0; i < 7; i++) { const x = w * (.15 + i * .117); g += `<circle cx="${x}" cy="${h * .86}" r="${w * .05}" fill="#a8ffe8" opacity=".35"/>`; l += `<circle cx="${x}" cy="${h * .86}" r="${w * .028}" fill="#1a2a28"/><circle cx="${x}" cy="${h * .86}" r="${w * .02}" fill="#c8fff0"/>`; }
  return `${rect(w * .04, h * .7, w * .92, h * .26, '#0b0d10')}${rect(w * .04, h * .7, w * .92, h * .03, '#262a30')}
    <g filter="url(#b1)">${g}</g>${l}`;
} });
// Station-entrance board: the photo's red rounded frame tube is kept (the ground is inset so it shows);
// lettering is monoline glass tube in the photo's own cyan + red palette, no fill, no scanlines.
panel({ z: 195, sg: 's2', svg: (w, h) => {
  const main = tubeD('習近平', w * .5, h * .045, w * .58, true, 1.42);
  const sub = tubeD('新時代', w * .5, h * .705, w * .3, true, 1.12);
  return `
  <rect x="${w * .085}" y="${h * .022}" width="${w * .83}" height="${h * .956}" rx="${w * .06}" fill="#050a0e"/>
  ${tube(main, '#3ff0ea', w / 26, '#b8fff8', { spill: .2, halo: .4 })}
  ${tube(`M${w * .24} ${h * .688} H${w * .76}`, '#ff2a3a', w / 60, '#ff8a90', { spill: .15, halo: .3 })}
  ${tube(sub, '#ff2a3a', w / 40, '#ff9aa0', { spill: .2, halo: .35 })}
`; } });

// =====================================================================
// S17 — huge floating holographic poster (jellyfish), with projector beam
// =====================================================================
panel({ z: 151, sg: 'posterframe', blend: 'screen', svg: (w, h) => `<rect x="${w * .01}" y="${h * .01}" width="${w * .98}" height="${h * .98}" fill="none" stroke="#7a5cff" stroke-width="${w / 30}" filter="url(#b2)"/><rect x="${w * .01}" y="${h * .01}" width="${w * .98}" height="${h * .98}" fill="none" stroke="#d6ccff" stroke-width="${w / 120}"/>` });
panel({ z: 152, sg: 'poster', blend: 'screen', svg: (w, h) => {
  let tent = '';
  for (let i = 0; i < 9; i++) { const x = w * (.3 + i * .05); tent += `<path d="M${x} ${h * .46} C ${x - w * .06} ${h * .6} ${x + w * .07} ${h * .72} ${x - w * .02} ${h * .92}" fill="none" stroke="${i % 2 ? '#8ff8ff' : '#ff8fe0'}" stroke-width="${w / 110}" opacity=".9"/>`; }
  const inner = `<path d="M${w * .25} ${h * .46} C ${w * .24} ${h * .14} ${w * .76} ${h * .14} ${w * .75} ${h * .46} C ${w * .62} ${h * .41} ${w * .38} ${h * .41} ${w * .25} ${h * .46} Z" fill="#9ff6ff" fill-opacity=".45" stroke="#ffffff" stroke-width="${w / 130}"/>
    <path d="M${w * .33} ${h * .4} C ${w * .4} ${h * .25} ${w * .6} ${h * .25} ${w * .67} ${h * .4}" fill="none" stroke="#ff9fe8" stroke-width="${w / 160}"/>${tent}
    ${T(w * .5, h * .12, '深海の夢', w * .09, JP, '#ffffff', 'text-anchor="middle"')}
    ${T(w * .5, h * .97, 'DREAM DIVE · AQUARIUM LEVEL 900', w * .045, SANS, '#e8fbff', 'text-anchor="middle" font-weight="700"')}`;
  return holo(w, h, inner, '#7fe8ff', { fog: .04, scan: .18, edge: 0 });
} });

// =====================================================================
// S1 — art-deco holographic coffee ad + purple deco fan (perpendicular facade, right)
// =====================================================================
panel({ z: 147, sg: 'coffee', blend: 'screen', svg: (w, h) => {
  const cx = w * .5, cy = h * .66;
  const inner = `
    ${Array.from({ length: 17 }, (_, i) => { const a = Math.PI + i * Math.PI / 16; return `<line x1="${cx}" y1="${cy + h * .08}" x2="${cx + Math.cos(a) * w}" y2="${cy + h * .08 + Math.sin(a) * w}" stroke="#f1c260" stroke-width="${w / 260}" opacity=".7"/>`; }).join('')}
    ${[.2, .28, .36].map(r => `<path d="M${cx - w * r} ${cy + h * .08} A ${w * r} ${w * r} 0 0 1 ${cx + w * r} ${cy + h * .08}" fill="none" stroke="#f1c260" stroke-width="${w / 220}"/>`).join('')}
    <g transform="translate(${cx} ${cy}) scale(${w / 160})">
      <path d="M-24 -20 L24 -20 L19 12 C16 20 -16 20 -19 12 Z" fill="#bff8ff" fill-opacity=".85"/>
      <path d="M-24 -20 L24 -20 L23 -14 L-23 -14 Z" fill="#6a3a1a"/>
      <path d="M23 -14 C38 -14 38 6 18 5" fill="none" stroke="#bff8ff" stroke-width="4"/>
      <ellipse cx="0" cy="18" rx="34" ry="5" fill="#bff8ff" fill-opacity=".7"/>
      <g filter="url(#steam)">${[-10, 0, 10].map(x => `<path d="M${x} -26 C ${x - 7} -38 ${x + 7} -48 ${x} -64" fill="none" stroke="#ffffff" stroke-width="3" opacity=".8"/>`).join('')}</g>
    </g>
    <path d="M${w * .06} ${h * .17} H${w * .16} V${h * .06} M${w * .94} ${h * .17} H${w * .84} V${h * .06}" fill="none" stroke="#f1c260" stroke-width="${w / 260}" opacity=".7"/>
    ${T(cx, h * .25, 'SYNTH ROAST', w * .15, "'Limelight'", '#ffe6a8', 'text-anchor="middle"')}
    ${T(cx, h * .9, 'COFFEE · 24H', w * .08, "'Josefin Sans'", '#ffe6a8', 'text-anchor="middle" font-weight="700" letter-spacing="1"')}`;
  return holo(w, h, inner, '#3ff2ff', { fog: .03, band: .55, scan: .1, edge: 0 });
} });
panel({ z: 148, sg: 'fan', clip: [B[148]], svg: (w, h) => `${rect(0, 0, w, h, '#0b0812')}
  ${Array.from({ length: 9 }, (_, i) => tube(`M0 ${h} L${w * i / 8} 0`, '#c77dff', w / 80, '#ead2ff', { spill: .15, halo: .35 })).join('')}
  ${[.45, .8].map(r => `<path d="M0 ${h - h * r} A ${h * r} ${h * r} 0 0 1 ${h * r} ${h}" fill="none" stroke="#e3b8ff" stroke-width="${w / 120}" opacity=".8"/>`).join('')}
  ${tube(`M0 ${h} L0 0 L${w} 0 Z`, '#e0b0ff', w / 110, '#f6e8ff', { spill: .12, halo: .3 })}` });

// =====================================================================
// Lavender — cyber-eye clinic (photoreal iris)
// =====================================================================
panel({ z: 150, sg: 'lavender', svg: (w, h) => {
  const cx = w / 2, cy = h * .4, R = w * .36;
  return `
  <defs><radialGradient id="irisG"><stop offset="0" stop-color="#05010d"/><stop offset=".3" stop-color="#05010d"/><stop offset=".33" stop-color="#5a2a8a"/><stop offset=".55" stop-color="#9b6cff"/><stop offset=".8" stop-color="#3fd8ff"/><stop offset=".95" stop-color="#1a1240"/><stop offset="1" stop-color="#0a0820"/></radialGradient>
  <clipPath id="irisC"><circle cx="${cx}" cy="${cy}" r="${R}"/></clipPath></defs>
  ${rect(0, 0, w, h, '#120a24')}
  <path d="M${-w * .1} ${cy} Q ${cx} ${cy - h * .32} ${w * 1.1} ${cy} Q ${cx} ${cy + h * .32} ${-w * .1} ${cy} Z" fill="#e6dcef"/>
  <circle cx="${cx}" cy="${cy}" r="${R}" fill="url(#irisG)"/>
  <g clip-path="url(#irisC)"><g transform="translate(${cx} ${cy})">${Array.from({ length: 90 }, (_, i) => { const a = i / 90 * Math.PI * 2; return `<line x1="${Math.cos(a) * R * .33}" y1="${Math.sin(a) * R * .33}" x2="${Math.cos(a + .05) * R * .95}" y2="${Math.sin(a + .05) * R * .95}" stroke="${i % 3 ? '#c9b3ff' : '#2a1250'}" stroke-width="${R / 90}" opacity=".5"/>`; }).join('')}</g></g>
  <circle cx="${cx}" cy="${cy}" r="${R * .3}" fill="#020005"/>
  ${Array.from({ length: 12 }, (_, i) => { const a = i / 12 * Math.PI * 2; return `<line x1="${cx + Math.cos(a) * R * .36}" y1="${cy + Math.sin(a) * R * .36}" x2="${cx + Math.cos(a) * R * .5}" y2="${cy + Math.sin(a) * R * .5}" stroke="#3ff2ff" stroke-width="${R / 40}"/>`; }).join('')}
  <ellipse cx="${cx + R * .35}" cy="${cy - R * .38}" rx="${R * .14}" ry="${R * .09}" fill="#fff" opacity=".9"/>
  ${T(cx, h * .1, 'OPTIK', w * .2, SANS, '#efe6ff', 'text-anchor="middle" font-weight="800" letter-spacing="2"')}
  ${VT(cx, h * .66, '義眼', w * .26, JP, '#ff9be6', '', 1.05)}
  ${T(cx, h * .96, 'CYBER-EYE CLINIC · LV 1450', w * .06, SANS, '#c9f6ff', 'text-anchor="middle" font-weight="600"')}
  ${screen(w, h, { mod: w / 2, fall: 'L', fallOp: .45 })}
`; } });

// =====================================================================
// Hanging banner (pink) — idol holo-concert ad, rim-lit performer
// =====================================================================
function singer(x, y, s, fill) {
  return `<g transform="translate(${x} ${y}) scale(${s})" fill="${fill}" stroke="${fill}" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="0" cy="-118" r="11" stroke="none"/>
    <path d="M-10 -126 C-22 -122 -26 -96 -18 -78 C-16 -94 -13 -106 -8 -112 Z M10 -126 C22 -122 28 -96 22 -76 C18 -94 15 -106 9 -112 Z" stroke="none"/>
    <path d="M-12 -102 C-14 -88 -12 -76 -10 -62 L-24 -20 L24 -20 L10 -62 C12 -76 14 -88 12 -102 Z" stroke="none"/>
    <path d="M10 -98 L26 -128 L30 -150" stroke-width="7" fill="none"/>
    <path d="M-11 -98 L-20 -76 L-8 -66" stroke-width="6.5" fill="none"/>
    <circle cx="-6" cy="-70" r="3.2" stroke="none"/>
    <path d="M-8 -20 L-12 40 M8 -20 L14 40" stroke-width="8" fill="none"/>
  </g>`;
}
// 'pink' (hanging banner) and 'lime' (vertical strip) were removed: both quads lie wholly below the train
// roofline, i.e. behind the cars and in front of the viaduct deck at the same time.

// =====================================================================
// S10/S11 — bridge-deck LED ribbon: ramen (left) + bar (right)
// =====================================================================
function ramenBowl(cx, cy, r) {
  return `<g transform="translate(${cx} ${cy})">
    <ellipse cx="0" cy="0" rx="${r}" ry="${r * .32}" fill="#e7b06a"/>
    <ellipse cx="0" cy="0" rx="${r * .92}" ry="${r * .26}" fill="#d38b3a"/>
    ${Array.from({ length: 8 }, (_, i) => `<path d="M${-r * .7 + i * r * .18} ${-r * .05} q${r * .1} ${r * .12} ${r * .2} 0" stroke="#ffe7a8" stroke-width="${r * .05}" fill="none"/>`).join('')}
    <ellipse cx="${r * .35}" cy="${-r * .04}" rx="${r * .18}" ry="${r * .09}" fill="#fff6e0"/><ellipse cx="${r * .35}" cy="${-r * .04}" rx="${r * .09}" ry="${r * .05}" fill="#ffb21a"/>
    <path d="M${-r * .5} ${-r * .12} l${r * .4} ${r * .02} l${-r * .05} ${r * .12} z" fill="#3a6a1a"/>
    <path d="M${-r} 0 C${-r} ${r * .7} ${r} ${r * .7} ${r} 0" fill="#121212"/>
    <path d="M${-r * .9} ${r * .1} C${-r * .8} ${r * .55} ${r * .8} ${r * .55} ${r * .9} ${r * .1}" fill="none" stroke="#c0281a" stroke-width="${r * .06}"/>
    <g filter="url(#steam)" opacity=".7">${[-.3, 0, .3].map(x => `<path d="M${x * r} ${-r * .2} c${-r * .15} ${-r * .3} ${r * .15} ${-r * .5} 0 ${-r * .85}" stroke="#fff" stroke-width="${r * .06}" fill="none"/>`).join('')}</g>
  </g>`;
}
panel({ z: 159, sg: 'brown', svg: (w, h) => `
  <defs><linearGradient id="rmBg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3a0f02"/><stop offset=".35" stop-color="#170500"/></linearGradient></defs>
  ${rect(0, 0, w, h, '#060505')}
  ${rect(0, 0, w * .42, h, 'url(#rmBg)')}
  ${tube(`M${w * .03} ${h * .5} A ${w * .05} ${h * .32} 0 0 0 ${w * .13} ${h * .5} Z`, '#ff9a3a', h / 45, '#ffd2a0', { spill: .18, halo: .35 })}
  ${[-.025, 0, .025].map(dx => tube(`M${w * (.08 + dx)} ${h * .42} c${-w * .012} ${-h * .1} ${w * .012} ${-h * .18} 0 ${-h * .28}`, '#ffd9a0', h / 90, '#fff2dc', { spill: .1, halo: .25 })).join('')}
  ${tube(tubeD('拉麺', w * .16, h * .14, h * .46, false, 1.06), '#ff7a1a', h / 40, '#ffc890')}
  ${T(w * .16, h * .82, 'TONKOTSU ¥300', h * .12, SANS, '#ffd9a0', 'font-weight="700"')}
  ${rect(w * .73, 0, w * .27, h, '#00121a')}
  ${NEON((f, s, sw) => T(w * .86, h * .5, 'BAR ZERO', h * .16 * 1.6, "'Tilt Neon'", f, `text-anchor="middle" stroke="${s}" stroke-width="${sw * h / 260}"`), '#2ef2ff', '#bffaff', 2, 1)}
  ${T(w * .86, h * .78, 'OPEN UNTIL THE TRAINS STOP', h * .06 * 1.4, SANS, '#ff9fd4', 'text-anchor="middle" font-weight="600"')}
  ${screen(w, h, { mod: h / 2, fall: 'R', fallOp: .5 })}
` });

// =====================================================================
// S12 — under the train deck: optic implants (+ ticker on the deck side)
// =====================================================================
panel({ z: 161, sg: 'deckunder', svg: (w, h) => `
  ${rect(0, 0, w, h, '#12000a')}
  ${NEON((f, s, sw) => T(w * .04, h * .68, 'OPTIC IMPLANTS', h * .5, SANS, f, `font-weight="800" letter-spacing="1" stroke="${s}" stroke-width="${sw * h / 90}"`), '#ff2a6d', '#ff9ab8', 2, .8)}
  ${T(w * .7, h * .64, '改造手術 0%', h * .3, "'IPAGothic'", '#ffb0cc')}
  ${screen(w, h, { mod: h, fall: 'R', fallOp: .5 })}
` });
panel({ z: 162, sg: 'deckside', svg: (w, h) => `${rect(0, 0, w, h, '#070512')}
  ${T(4, h * .78, 'CYBERWARE · サイバーウェア · NEURAL LINK · CYBERWARE · サイバーウェア · NEURAL LINK ·', h * .72, 'VT323', '#8a7bff')}
  ${screen(w, h, { mod: h, fall: 'R', fallOp: .5 })}` });
panel({ z: 162.9, clip: [], svg: () => [sgPoint('exit', .2, 0), sgPoint('exit', .8, 0)].map(p => cable(p, 22, .9, '#0a0b0c')).join('') });
panel({ z: 163, sg: 'exit', svg: (w, h) => `${rect(0, 0, w, h, '#0e1410')}
  ${rect(w * .03, h * .06, w * .94, h * .88, '#0b8a43')}
  ${rect(w * .06, h * .12, w * .88, h * .76, 'none', `stroke="#eafff2" stroke-width="${h / 40}"`)}
  <g transform="translate(${w * .2} ${h * .5}) scale(${h / 100})" fill="#f4fff8">
    <circle cx="6" cy="-28" r="6"/>
    <path d="M-2 -20 L10 -18 L18 -6 L26 -10 L28 -6 L16 2 L10 -6 L6 6 L16 14 L14 30 L8 30 L9 18 L0 12 L-6 22 L-18 26 L-20 20 L-10 16 L-4 2 L-2 -10 L-10 -4 L-14 -10 Z"/>
  </g>
  ${rect(w * .32, h * .2, w * .006, h * .6, '#eafff2', 'opacity=".6"')}
  ${T(w * .64, h * .5, '非常口', h * .26, "'IPAGothic'", '#ffffff', 'text-anchor="middle"')}
  ${T(w * .64, h * .8, 'EXIT', h * .24, SANS, '#ffffff', 'text-anchor="middle" font-weight="700" letter-spacing="1"')}
  ${rect(0, 0, w, h, 'url(#sheen)')}` });
panel({ z: 160, clip: [], svg: () => [160, 169, 171, 172].map(id => {
  const n = (B[id].match(/-?[0-9.]+/g) || []).map(Number), P = []; for (let i = 0; i + 1 < n.length; i += 2) P.push([n[i], n[i + 1]]); const c = P.length ? [P.reduce((a, p) => a + p[0], 0) / P.length, P.reduce((a, p) => a + p[1], 0) / P.length] : null;
  return `<path d="${B[id]}" fill="#121316"/><path d="${B[id]}" fill="none" stroke="#24262b" stroke-width=".6"/>` + (c ? `<circle cx="${c[0]}" cy="${c[1]}" r="3.5" fill="#ff3a2a" opacity=".35" filter="url(#b2)"/><circle cx="${c[0]}" cy="${c[1]}" r="1.2" fill="#ff5a40"/>` : '');
}).join('') });

// =====================================================================
// Right hanging box: live news screen (photographic footage) + side + underside
// =====================================================================
// hangs in front of the train (z 203-205); footage is a different subject (mirrored crop of ring.jpg)
panel({ z: 203, sg: 'rbox_bottom', svg: (w, h) => downlights(w, h, 30, 2, '#ffe9c8', h / 26) });
panel({ z: 204, sg: 'rbox_side', svg: (w, h) => `
  ${rect(0, 0, w, h * .3, '#2fd8a4')}${rect(0, h * .3, w, h * .7, '#b80c1a')}
  ${VTj(w / 2, h * .34, 'ニュース', w * .7, JP, '#fff0e8', '', 1.05)}
  ${screen(w, h, { mod: w, fall: 'L', fallOp: .6 })}` });
panel({ z: 205, sg: 'rbox_front', svg: (w, h) => `
  ${rect(0, 0, w, h, '#05070b')}
  <svg x="0" y="${h * .08}" width="${w}" height="${h * .68}" viewBox="0 0 ${w} ${h * .68}" preserveAspectRatio="none">
    <image href="ring.jpg" x="${-w * .9}" y="${-h * .02}" width="${w * 2.4}" height="${h * .72}" preserveAspectRatio="xMidYMid slice" transform="translate(${w} 0) scale(-1 1)" style="filter:brightness(1.35) contrast(1.1) saturate(1.15)"/>
  </svg>
  ${rect(w * .05, h * .5, w * .42, h * .2, '#000', 'opacity=".25" filter="url(#b8)"')}
  ${rect(0, 0, w, h * .08, '#0a1a3a')}
  ${T(w * .04, h * .055, 'CH 3000  NEWS', h * .035, SANS, '#ffffff', 'font-weight="800" letter-spacing="1"')}
  ${T(w * .96, h * .055, '23:58', h * .035, SANS, '#ffd27a', 'text-anchor="end" font-weight="700"')}
  ${rect(w * .04, h * .1, h * .1, h * .04, '#e0001b')}${T(w * .04 + h * .05, h * .131, 'LIVE', h * .028, SANS, '#fff', 'text-anchor="middle" font-weight="800"')}
  ${rect(0, h * .76, w, h * .06, '#c0001a')}
  ${T(w * .04, h * .805, 'BREAKING', h * .036, SANS, '#ffffff', 'font-weight="900" letter-spacing="1"')}
  ${rect(0, h * .82, w, h * .12, '#c4c9d2')}
  ${T(w * .04, h * .872, 'DIHTOWN LINE DELAYED', h * .032, SANS, '#0a0d14', 'font-weight="800"')}
  ${T(w * .04, h * .91, 'Acid storm · expect 3 min delays', h * .022, SANS, '#2a3040', 'font-weight="500"')}
  ${rect(0, h * .94, w, h * .06, '#0a1a3a')}
  ${T(w * .04, h * .98, 'NKY ▲1.24%  DHTN ▲3.02%  RAIN 87%', h * .026, 'VT323', '#9fd0ff')}
  ${screen(w, h, { mod: h / 10, fall: 'R', fallOp: .5, seamOp: .2 })}
` });
panel({ z: 205.5, clip: [], svg: () => [sgPoint('rbox_front', .08, 0), sgPoint('rbox_front', .92, 0), sgPoint('rbox_side', .1, 0)].map(p => cable(p, 260, .7, '#0b0c0e', true)).join('') });

// =====================================================================
// Smaller signs
// =====================================================================
panel({ z: 167, sg: 'leftled', clip: [B[167]], svg: (w, h) => `<defs><linearGradient id="nlG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a3a9a"/><stop offset="1" stop-color="#020c2a"/></linearGradient></defs>
  ${rect(0, 0, w, h, 'url(#nlG)')}
  <svg x="0" y="${h * .5}" width="${w}" height="${h * .3}" viewBox="0 0 ${w} ${h * .3}" preserveAspectRatio="none"><image href="ring.jpg" x="${-w * 1.2}" y="0" width="${w * 3}" height="${h * .3}" preserveAspectRatio="xMidYMid slice"/></svg>
  ${rect(0, h * .5, w, h * .3, '#0a3a9a', 'style="mix-blend-mode:multiply"')}
  ${rect(0, h * .5, w, h * .3, '#3a7aff', 'opacity=".15"')}
  ${VT(w * .55, h * .04, '電脳', w * .5, "'IPAGothic'", '#d8ecff', 'opacity=".85"', 1)}
  ${T(w * .55, h * .86, 'NEURAL LINK', w * .14, SANS, '#ffffff', 'text-anchor="middle" font-weight="800"')}
  ${T(w * .55, h * .9, 'THINK FASTER THAN THE CITY', w * .06, SANS, '#9fd8ff', 'text-anchor="middle" font-weight="600"')}
  ${screen(w, h, { mod: w / 3, fall: 'L', fallOp: .5 })}` });
panel({ z: 114, sg: 'hotel', svg: (w, h) => `
  ${rect(0, 0, w, h, '#1c0306')}
  ${neonTube(`M${w * .07} ${h * .02} H${w * .93} V${h * .98} H${w * .07} Z`, '#ff2a3a', w / 50)}
  ${tube(tubeD('ホテル', w * .5, h * .06, w * .55, true, 1.08), '#ff2a3a', w / 36, '#ff9aa0')}
  ${T(w * .5, h * .6, 'CAPSULE', w * .13, SANS, '#ffb0b6', 'text-anchor="middle" font-weight="800" letter-spacing="1"')}
  ${T(w * .5, h * .66, '9,000 PODS', w * .11, SANS, '#ffd9a0', 'text-anchor="middle" font-weight="600"')}
  ${tube(tubeD('空室', w * .5 - w * .37, h * .86 - w * .32, w * .36, false, 1.04), '#3dff6e', w / 50, '#b8ffc8')}
  ${screen(w, h, { mod: w / 2, fall: 'L', fallOp: .4, seamOp: .1 })}
` });
panel({ z: 109, sg: 'bracket', clip: [B[109]], svg: (w, h) => `
  ${rect(0, 0, w, h, '#06123f')}
  ${Array.from({ length: 13 }, (_, i) => T(-((i * 37) % 60), h * (.08 + i * .075), i % 3 === 2 ? 'NKY ▲1.2%  DHTN ▲3.0%  OOSK ▼0.6%  SYNTH ▲4.8%' : 'NEWS · DIHTOWN · OOSKAKSK · 速報 · NEWS · DIHTOWN', h * .07, 'VT323', i % 3 === 2 ? '#7dff9a' : '#dfe9ff')).join('')}
  ${LED(w, h, 3, .35)}
  ${screen(w, h, { mod: h / 3 })}
` });
panel({ z: 136, sg: 'mintsign', svg: (w, h) => `
  <ellipse cx="${w / 2}" cy="${h / 2}" rx="${w * .46}" ry="${h * .46}" fill="#031a12"/>
  ${neonTube(`M${w * .04} ${h / 2} A ${w * .46} ${h * .46} 0 1 1 ${w * .96} ${h / 2} A ${w * .46} ${h * .46} 0 1 1 ${w * .04} ${h / 2}`, '#5dffb2', w / 14)}
  ${rect(w * .25, h * .5 - w * .08, w * .5, w * .16, '#eafff4')}${rect(w * .42, h * .5 - w * .25, w * .16, w * .5, '#eafff4')}` });
panel({ z: 108, sg: 'magenta', svg: (w, h) => `
  ${rect(0, 0, w, h, '#33003f')}
  ${NEON((f, s, sw) => T(w * .04, h * .68, '食堂', h * .55, JP, f, `stroke="${s}" stroke-width="${sw * h / 60}"`), '#ff4ff0', '#fff0fe', 2, 1)}
  ${T(w * .34, h * .45, 'OPEN 24H', h * .26, SANS, '#ffe8ff', 'font-weight="800"')}
  ${T(w * .34, h * .78, 'DIHTOWN MARKET · LV 12', h * .18, SANS, '#ffb0f8', 'font-weight="600"')}
  ${screen(w, h, { mod: h, fall: 'R', fallOp: .35 })}
` });

// =====================================================================
// S9 — huge holographic art-deco surveillance poster
// =====================================================================
panel({ z: 168, sg: 'surv', blend: 'screen', svg: (w, h) => {
  const ey = h * .2;
  const inner = `
    ${Array.from({ length: 19 }, (_, i) => { const a = -Math.PI + i * Math.PI / 18; return `<line x1="${w / 2}" y1="${ey}" x2="${w / 2 + Math.cos(a) * w * 1.2}" y2="${ey + Math.sin(a) * w * 1.2}" stroke="#f1c260" stroke-width="${w / 220}" opacity=".8"/>`; }).join('')}
    <path d="M${w * .06} ${ey} Q ${w / 2} ${ey - w * .36} ${w * .94} ${ey} Q ${w / 2} ${ey + w * .36} ${w * .06} ${ey} Z" fill="#0a0420" stroke="#f1c260" stroke-width="${w / 90}"/>
    <circle cx="${w / 2}" cy="${ey}" r="${w * .17}" fill="#3ff2ff"/><circle cx="${w / 2}" cy="${ey}" r="${w * .08}" fill="#05010d"/><circle cx="${w * .54}" cy="${ey - w * .05}" r="${w * .028}" fill="#fff"/>
    <path d="M${w * .05} ${h * .02} H${w * .95} V${h * .98} H${w * .05} Z M${w * .1} ${h * .33} H${w * .9} M${w * .1} ${h * .345} H${w * .9}" fill="none" stroke="#f1c260" stroke-width="${w / 120}"/>
    ${VT(w / 2, h * .37, 'WE·WATCH', w * .17, "'Limelight'", '#ffe6a8', '', 1.02)}
    ${T(w / 2, h * .76, 'OVER YOU', w * .14, "'Poiret One'", '#3ff2ff', 'text-anchor="middle" letter-spacing="1"')}
    ${T(w / 2, h * .82, '監視は愛', w * .15, JP, '#ff9be6', 'text-anchor="middle"')}
    ${T(w / 2, h * .9, 'FOR YOUR SAFETY', w * .085, "'Josefin Sans'", '#f1c260', 'text-anchor="middle" letter-spacing="1" font-weight="700"')}
    ${T(w / 2, h * .94, 'MINISTRY OF VIGILANCE · 3000', w * .055, "'Josefin Sans'", '#ffe6a8', 'text-anchor="middle" font-weight="700"')}`;
  return holo(w, h, inner, '#f1c260', { fog: .05, band: .62, scan: .2, edge: 0 });
} });

// =====================================================================
// Scale & atmosphere: projector beams, aviation lights, distant aircars
// =====================================================================
panel({ z: 400, clip: [], blend: 'screen', svg: () => {
  const beam = (src, a, b, col, op) => `<path d="M${src[0]} ${src[1]} L${a[0]} ${a[1]} L${b[0]} ${b[1]} Z" fill="${col}" opacity="${op}" filter="url(#b8)"/>`;
  const g0 = SG.gpu0.quad, g4 = SG.gpu4.quad, pq = SG.poster.quad, sv = SG.surv.quad, cf = SG.coffee.quad;
  return `
    ${beam([700, 760], pq[3], pq[2], '#8fe8ff', .1)}
    ${beam([1230, 2056], sv[3], sv[2], '#f1c260', .08)}
    ${beam([1395, 760], cf[3], cf[2], '#3ff2ff', .08)}`;
} });
panel({ z: 401, clip: [], svg: () => {
  // obstruction lights sit on real arrises of the structure
  const av = [[1188, 6], [922, 48], [856, 140], [8, 212], [818, 6], [306, 54]];
  let s = av.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.5" fill="#ff2a1a" opacity=".45" filter="url(#b2)"/><circle cx="${x}" cy="${y}" r=".9" fill="#ff3a20"/>`).join('');
  // distant air-cars in two lanes parallel to the train (toward v1); smaller the higher (farther) they fly
  const V1 = [6393.76, 4177.04];
  const cars = [[742, 92], [790, 140], [700, 210], [860, 70], [1150, 260], [1080, 300], [930, 200], [1010, 150]];
  s += cars.map(([x, y]) => {
    const l = 4 + 5 * Math.min(1, y / 300), a = Math.atan2(V1[1] - y, V1[0] - x) * 180 / Math.PI;
    return `<g transform="translate(${x} ${y}) rotate(${a.toFixed(1)})">
      <ellipse rx="${l * .5}" ry="${l * .16}" fill="#0b0c0f"/>
      <circle cx="${l * .5}" cy="${-l * .06}" r="${l * .25}" fill="#fff6e0" opacity=".35" filter="url(#b1)"/>
      <circle cx="${l * .48}" cy="${-l * .07}" r=".55" fill="#fff6e0"/><circle cx="${l * .48}" cy="${l * .07}" r=".55" fill="#fff6e0"/>
      <circle cx="${-l * .5}" cy="0" r=".45" fill="#ff2a1a"/></g>`;
  }).join('');
  return s;
} });
