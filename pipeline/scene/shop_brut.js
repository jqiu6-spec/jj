// shop_brut.js — shop module (owned by one builder). Uses helpers from engine.js, panels2.js and depth.js.
// =====================================================================
// S8 — huge brutalist housing block, built in true 3-D on facade plane SG.brut (plane A),
//      projected through the camera solved from the photo.
//      The block sits in a giant opening of the megastructure wall (the photo's wall plane = d 0):
//      we see the opening's head soffit and its right jamb, then ~21 storeys x 11 bays of
//      cantilevered balconies between full-height concrete fins, a stair/lift core, two
//      access decks ("streets in the sky"), and lived-in apartments behind.
//      Units: METRES. x right along the facade, y down from the opening head, d INTO the building.
//      Camera looks steeply up and from the left: visible faces are undersides (+y), left faces (-x)
//      and fronts (-d). Deeper points project left/down.
// =====================================================================
(() => {
  const F = Frame('brut');
  const Hm = 66, Wm = Hm * F.W / F.H;                 // opening is ~59 m wide, 66 m tall
  const P = (x, y, d = 0) => F.N(x / Wm, y / Hm, d / Wm);
  const f2 = v => (+v).toFixed(2), f4 = v => (+v).toFixed(4);
  const pd = pts => 'M' + pts.map(p => f2(p[0]) + ' ' + f2(p[1])).join(' L') + ' Z';
  const pd3 = pts => pd(pts.map(q => P(...q)));
  const CONC = [];                                    // visible concrete faces (for the texture overlay)
  const poly = (pts, fill, extra = '') => `<path d="${pd3(pts)}" fill="${fill}" ${extra}/>`;
  const cpoly = (pts, fill, extra = '') => { CONC.push(pd3(pts)); return poly(pts, fill, extra); };
  // axis-aligned faces
  const fY = (y, x0, x1, d0, d1) => [[x0, y, d0], [x1, y, d0], [x1, y, d1], [x0, y, d1]];   // horizontal (underside)
  const fX = (x, y0, y1, d0, d1) => [[x, y0, d0], [x, y0, d1], [x, y1, d1], [x, y1, d0]];   // side (left-facing)
  const fD = (d, x0, y0, x1, y1) => [[x0, y0, d], [x1, y0, d], [x1, y1, d], [x0, y1, d]];   // front-facing
  const stopS = st => st.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('');
  // linear gradient a->b whose iso-lines run along 3-D direction `along`
  const glin = (a, b, stops, along) => {
    const A = P(...a), B2 = P(...b);
    if (!along) return GRAD.lin(A, B2, stops);
    const E = P(a[0] + along[0], a[1] + along[1], a[2] + along[2]);
    let ex = E[0] - A[0], ey = E[1] - A[1]; const el = Math.hypot(ex, ey) || 1; ex /= el; ey /= el;
    const nx = -ey, ny = ex, t = (B2[0] - A[0]) * nx + (B2[1] - A[1]) * ny;
    return GRAD.lin(A, [A[0] + nx * t, A[1] + ny * t], stops);
  };
  // elliptical light pool lying in a face: centre c, semi-axes ax, ay (3-D offsets) — affine at the centre
  const gell = (c, ax, ay, stops) => {
    const C = P(...c), A = P(c[0] + ax[0], c[1] + ax[1], c[2] + ax[2]), B2 = P(c[0] + ay[0], c[1] + ay[1], c[2] + ay[2]);
    const id = 'bg' + (GRAD.n++);
    GRAD.list.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="matrix(${f4(A[0] - C[0])} ${f4(A[1] - C[1])} ${f4(B2[0] - C[0])} ${f4(B2[1] - C[1])} ${f2(C[0])} ${f2(C[1])})">${stopS(stops)}</radialGradient>`);
    return `url(#${id})`;
  };
  const clip3 = (pts, svg) => {
    const id = 'bcl' + (GRAD.n++);
    GRAD.list.push(`<clipPath id="${id}" clipPathUnits="userSpaceOnUse"><path d="${pd3(pts)}"/></clipPath>`);
    return `<g clip-path="url(#${id})">${svg}</g>`;
  };
  let S = 88071; const R = () => (S = (S * 16807) % 2147483647) / 2147483647;
  const pickR = a => a[Math.floor(R() * a.length)];
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const jit = (c, k) => shade(c, 1 + (R() - .5) * k);

  // ---------------- dimensions ----------------
  const H = 3.1, ts = .25, hp = .95;                 // storey, slab, parapet height
  const dFin = 1.25, dF = 1.55, dG = 2.8, Dp = dG - dF; // fin front, parapet front, glass line (balcony 1.25 m)
  const DR = 6.5, dC = .85, dK = dG + 1.7;           // room depth, core front, deck back wall
  const B = 5.2, tf = .35;                           // bay, fin thickness
  const NS = Math.ceil((Hm + 3) / H), Ymax = Hm + 6;
  const SKY = new Set([6, 14]);                      // access decks
  const fx = [Wm]; for (let k = 1; Wm - k * B > -B; k++) fx.push(Wm - k * B);
  const bays = []; for (let k = 0; k < fx.length - 1; k++) bays.push({ k, x0: fx[k + 1] + tf, x1: fx[k] });
  const KC = 8;                                       // the stair/lift core replaces bay 8 (counted from the right)
  const cx0 = fx[KC + 1], cx1 = fx[KC] + tf;
  const yC = i => i * H, yFl = i => i * H + H - ts;

  // ---------------- palette (night radiance) ----------------
  const C = { front: '#141718', fin: '#121415', finL: '#0e1011', soff: '#141516', jamb: '#0d0f10', core: '#131516', coreL: '#0d0f10', head: '#101213' };
  const LT = {
    warm: { c: '#ffa955', ceil: '#ffd29a', I: 1 },
    warm2: { c: '#ffbe78', ceil: '#ffe3bd', I: .85 },
    neutral: { c: '#ffe0bd', ceil: '#fff4e4', I: .9 },
    cool: { c: '#d6e4ff', ceil: '#f0f5ff', I: .8 },
    tv: { c: '#5877ff', ceil: '#3a4fa8', I: .32, tv: 1 },
    dim: { c: '#ff9644', ceil: '#b4642c', I: .3 },
  };
  const FLUO = '#dcf6ea';
  // mall sign far below-right lights the undersides of the lowest floors (teal-green), city glow elsewhere
  const spill = (x, y) => clamp(1 - Math.hypot(x - Wm * .78, (y - Hm - 4) * 1.3) / 22) ** 1.6;
  const SPC = '#38e0a6';

  // ---------------- apartment states ----------------
  const ST = {};
  for (let i = 0; i < NS; i++) for (const b of bays) {
    const r = R();
    const L = r < .42 ? null : r < .63 ? LT.warm : r < .70 ? LT.warm2 : r < .79 ? LT.neutral : r < .87 ? LT.cool : r < .93 ? LT.tv : LT.dim;
    const cu = R();
    ST[i + ':' + b.k] = {
      L, lx: .3 + R() * .45, ld: 1.4 + R() * 1.6, fix: R(),
      curtain: cu < .3 ? null : cu < .62 ? 'sheer' : cu < .84 ? 'heavy' : 'closed',
      cl: .08 + R() * .45, cr: R() * .4,
      ccol: pickR(['#e8dcc8', '#dccbb0', '#cbbba6', '#aab6c0', '#8c3c2a', '#5c6c4c', '#7a5c88', '#c9a46a']),
      rail: R() < .1, glazed: R() < .09, lamp: R() < .13, lampC: pickR(['#ffe2ae', '#fff1d8', '#e9f2ff']),
      ac: R() < .24, acx: R(), plant: R() < .16, person: R() < .07, laundry: R() < .13, dish: R() < .04,
      streak: R() < .35 ? R() : -1, pc: R(),
    };
  }
  const st = (i, k) => ST[i + ':' + k] || {};

  // ---------------- 1. interiors behind the glass line ----------------
  function interior(i, b, s_) {
    const yc = yC(i), yf = yFl(i), { x0, x1 } = b, w = x1 - x0, dB = dG + DR, L = s_.L;
    let s = '';
    if (!L) {
      s += poly(fD(dB, x0, yc, x1, yf), '#060708');
      s += poly(fX(x1, yc, yf, dG, dB), '#08090a');
      s += poly(fY(yc, x0, x1, dG, dB), glin([x0, yc, dG], [x0, yc, dG + 2.4], [[0, '#131517'], [1, '#08090a']], [1, 0, 0]));
    } else {
      const lamp = [x0 + w * s_.lx, yc, dG + s_.ld];
      s += poly(fD(dB, x0, yc, x1, yf), glin([x0, yc, dB], [x0, yf, dB], [[0, shade(L.ceil, .5)], [1, shade(L.c, .16)]], [1, 0, 0]));
      s += poly(fX(x1, yc, yf, dG, dB), gell([x1, yc + .5, lamp[2]], [0, 0, 3.6], [0, 2.8, 0], [[0, shade(L.ceil, .78)], [.55, shade(L.c, .36)], [1, shade(L.c, .16)]]));
      s += poly(fY(yc, x0, x1, dG, dB), gell(lamp, [3.6, 0, 0], [0, 0, 3.6], [[0, L.ceil], [.18, mix(L.ceil, L.c, .4)], [.55, shade(L.c, .5)], [1, shade(L.c, .22)]]));
      if (L.tv) s += poly(fY(yc, x0, x1, dG, dB), gell([x0 + w * .7, yc, dB], [4, 0, 0], [0, 0, 4.5], [[0, '#9fb4ff', .5], [1, '#9fb4ff', 0]]));
      else if (s_.fix < .55) s += poly(fY(yc, lamp[0] - .22, lamp[0] + .22, lamp[2] - .22, lamp[2] + .22), '#fffbf2');
      else if (s_.fix < .8) s += poly(fY(yc, lamp[0] - .6, lamp[0] + .6, lamp[2] - .06, lamp[2] + .06), '#ffffff');
      // cornice shadow where ceiling meets the glass head
      s += poly(fY(yc, x0, x1, dG, dG + .5), glin([x0, yc, dG], [x0, yc, dG + .5], [[0, '#000', .35], [1, '#000', 0]], [1, 0, 0]));
    }
    // curtains just behind the glass
    const dc = dG + .14;
    const fold = (xa, xb, col, op) => {
      const n = Math.max(2, Math.round((xb - xa) / .32)), stops = [];
      for (let q = 0; q <= n; q++) stops.push([q / n, q % 2 ? shade(col, .78) : col]);
      return poly(fD(dc, xa, yc + .04, xb, yf), glin([xa, yc, dc], [xb, yc, dc], stops, [0, 1, 0]), `opacity="${op}"`);
    };
    if (s_.curtain) {
      if (s_.curtain === 'closed') s += fold(x0, x1, L ? mix(shade(s_.ccol, .6), L.c, .5) : '#0a0b0c', L ? .96 : 1);
      else {
        const sheer = s_.curtain === 'sheer';
        const col = L ? (sheer ? mix(s_.ccol, L.ceil, .5) : shade(mix(s_.ccol, L.c, .2), .42)) : '#0b0c0d';
        const op = sheer && L ? .8 : 1;
        s += fold(x0, x0 + w * s_.cl, col, op) + fold(x1 - w * s_.cr, x1, col, op);
      }
      s += poly(fD(dc - .02, x0, yc, x1, yc + .07), '#0c0b0a');           // curtain track
    }
    // glazing: head frame, sliding-door mullions, reflection on dark glass
    const fr = L ? '#1b1815' : '#0c0d0e';
    s += poly(fD(dG, x0, yc, x1, yc + .09), fr);
    for (const fxm of [x0 + .04, x0 + w * .36, x0 + w * .38, x0 + w * .7, x1 - .06]) s += poly(fD(dG, fxm, yc, fxm + .06, yf), fr);
    if (!L) s += poly(fD(dG, x0, yc, x1, yf), glin([x0, yc, dG], [x0, yc + 1.2, dG], [[0, '#2a323c', .55], [1, '#1a1f26', .15]], [1, 0, 0]));
    else s += poly(fD(dG, x0, yc, x1, yf), '#a8c4d0', 'opacity=".06"');
    return clip3(fD(dG, x0, yc, x1, yf), s);
  }

  // ---------------- 2. balcony soffits (the camera looks up: these are the big lit surfaces) ----------------
  const soffBase = (x, y) => mix(mix(C.soff, '#1b181d', clamp(y / Hm) * .6), SPC, spill(x, y) * .16);
  function soffit(i, b, s_) {
    const yc = yC(i), { x0, x1 } = b, w = x1 - x0, d0 = i === 0 ? dFin : dF, L = s_.L;
    const base = soffBase((x0 + x1) / 2, yc);
    const Q = fY(yc, x0, x1, d0, dG);
    let s = cpoly(Q, base);
    if (L) {
      const a = .58 * L.I;
      s += poly(Q, gell([x0 + w * clamp(s_.lx, .35, .65), yc, dG], [w * .7, 0, 0], [0, 0, -Dp * 1.45], [[0, L.c, a], [.3, L.c, a * .62], [.7, L.c, a * .2], [1, L.c, 0]]));
      if (s_.curtain === 'closed' || s_.curtain === 'heavy') s += poly(Q, glin([x0, yc, dG], [x0, yc, dF], [[0, '#000', .25], [1, '#000', 0]], [1, 0, 0]));
    } else {
      s += poly(Q, glin([x0, yc, dF], [x0, yc, dG], [[0, '#000', 0], [1, '#000', .45]], [1, 0, 0]));
    }
    if (s_.lamp) {
      const lx = x0 + 2.4 + (w - 3) * s_.pc, ld = dG - .32;
      s += poly(Q, gell([lx, yc, ld], [2.3, 0, 0], [0, 0, 1.6], [[0, s_.lampC, .7], [.25, s_.lampC, .38], [.6, s_.lampC, .12], [1, s_.lampC, 0]]));
    }
    // ambient occlusion in the corners against the fins and the glass
    s += poly(Q, glin([x1, yc, dF], [x1 - .9, yc, dF], [[0, '#000', .38], [1, '#000', 0]], [0, 0, 1]));
    s += poly(Q, glin([x0, yc, dF], [x0 + .7, yc, dF], [[0, '#000', .3], [1, '#000', 0]], [0, 0, 1]));
    // drip groove just behind the slab nose
    if (i > 0) s += poly(fY(yc, x0, x1, dF + .07, dF + .12), '#000', 'opacity=".4"');
    return s;
  }
  // access deck: deep open corridor, fluorescent tubes on the ceiling, kitchen windows high on the back wall
  function deck(i, xa, xb) {
    const yc = yC(i), yf = yFl(i);
    let s = '';
    // back wall (only its top strip shows above the parapet)
    s += poly(fD(dK, xa, yc, xb, yf), glin([xa, yc, dK], [xa, yc + 1.4, dK], [[0, '#7b8680'], [.5, '#3e4642'], [1, '#1c2120']], [1, 0, 0]));
    for (let x = Math.ceil((xa + .3) / B) * B - .4; x < xb - 1.4; x += B) {
      const kw = R() < .62 ? pickR(['#ffd7a0', '#ffe8c8', '#e8f0ff', '#ffc888']) : '#141617';
      s += poly(fD(dK, x - 1.8, yc + .2, x - .4, yc + .85), kw);
      s += poly(fD(dK, x - 1.8, yc + .2, x - .4, yc + .28), '#0e0f0f');
      s += poly(fD(dK, x + .2, yc + .72, x + 1.2, yf), '#26201a');          // flat entrance doors
    }
    const Q = fY(yc, xa, xb, dF, dK);
    CONC.push(pd3(Q));
    s += poly(Q, glin([xa, yc, dF], [xa, yc, dK], [[0, '#353c39'], [.45, '#7e8a84'], [.62, '#87938c'], [1, '#4c5551']], [1, 0, 0]));
    // tubes: one every 2.6 m along the deck, one dead and one flickering dim
    for (let x = xa + 1; x < xb - .6; x += 2.6) {
      const dead = R() < .07, dim = !dead && R() < .08;
      const tc = dead ? '#2c302e' : dim ? '#9fb4aa' : '#f4fff9';
      s += poly(Q, gell([x + .6, yc, dF + 1.05], [2.1, 0, 0], [0, 0, 1.25], [[0, FLUO, dead ? 0 : dim ? .18 : .5], [.5, FLUO, dead ? 0 : .14], [1, FLUO, 0]]));
      s += poly(fY(yc, x, x + 1.2, dF + 1, dF + 1.12), tc);
    }
    s += poly(fY(yc, xa, xb, dF + .07, dF + .12), '#000', 'opacity=".4"');
    return s;
  }

  // ---------------- 3. things on the balconies (behind the parapet, in front of the glass) ----------------
  function contents(i, b, s_) {
    const yc = yC(i), yf = yFl(i), { x0, x1 } = b, w = x1 - x0, L = s_.L;
    const back = L ? L.c : null;
    let s = '';
    if (s_.laundry) {                                       // clothes on a line under the soffit
      const dl = dF + .45 + R() * .4;
      let x = x0 + 1.6 + R() * .6;
      s += poly(fD(dl, x0 + 1.4, yc + .22, x1 - .5, yc + .25), '#0a0a0a');
      while (x < x1 - .9) {
        const cw = .35 + R() * .5, ch = .4 + R() * .55, col = pickR(['#c84a3c', '#e8e4dc', '#3c5c8c', '#d8b84c', '#5c8c6c', '#d87ca0', '#2c2c34', '#bcc8d4']);
        const lit = back ? mix(shade(col, .35), back, .22) : shade(col, .16);
        s += poly(fD(dl, x, yc + .25, x + cw, yc + .25 + ch), lit);
        x += cw + .1 + R() * .3;
      }
    }
    if (s_.glazed) {                                        // resident-glazed balcony: aluminium frames in front of the soffit
      const dg = dF + .07, ya = yc, yb = yf - hp;
      s += poly(fD(dg, x0, ya, x1, yb), back ? mix('#8aa0a8', back, .4) : '#7a8c99', `opacity="${back ? .12 : .1}"`);
      const fcol = back ? shade(mix('#8a8a86', back, .35), .55) : '#1e2122';
      for (let x = x0; x <= x1 + .01; x += w / 4) s += poly(fD(dg, x - .03, ya, x + .03, yb), fcol);
      s += poly(fD(dg, x0, ya + .55, x1, ya + .6), fcol);
    }
    if (s_.plant) {                                         // planter on the parapet: foliage silhouette
      const dp = dF + .25, px = x0 + .6 + R() * (w - 2.2), pw = .8 + R() * 1.2, yt = yf - hp;
      let pts = [[px, yt + .05, dp]];
      for (let q = 0; q <= 8; q++) pts.push([px + pw * q / 8, yt - .18 - R() * .42 * Math.sin(Math.PI * q / 8), dp]);
      pts.push([px + pw, yt + .05, dp]);
      s += poly(pts, back ? glin([px, yt - .6, dp], [px, yt, dp], [[0, shade(back, .38)], [.3, '#16190f'], [1, '#090b08']], [1, 0, 0]) : '#0a0c0a');
    }
    if (s_.person && L) {                                   // resident leaning on the parapet, back-lit
      const dpp = dF + .32, px = x0 + 2 + (w - 3) * s_.pc, yt = yf - hp;
      const sil = '#0b0a0a';
      s += poly([[px - .3, yt + .05, dpp], [px - .26, yt - .3, dpp], [px - .1, yt - .38, dpp], [px + .1, yt - .38, dpp], [px + .26, yt - .3, dpp], [px + .3, yt + .05, dpp]], sil);
      const hc = P(px, yt - .52, dpp), he = P(px + .11, yt - .52, dpp);
      s += `<circle cx="${f2(hc[0])}" cy="${f2(hc[1])}" r="${f2(Math.hypot(he[0] - hc[0], he[1] - hc[1]))}" fill="${sil}"/>`;
      if (R() < .4) { const e = P(px + .34, yt - .1, dpp - .25); s += `<circle cx="${f2(e[0])}" cy="${f2(e[1])}" r=".35" fill="#ff7a2a"/>`; }
    }
    return s;
  }

  // ---------------- 4. front planes: parapets, slab noses, fins, core, jamb ----------------
  const streakCols = bays.map(() => [R(), R() < .5 ? R() : -1]);
  function front(i, b, s_) {
    const yc = yC(i), yf = yFl(i), yb = yc + H, { x0, x1, k } = b, w = x1 - x0;
    const col = jit(mix(C.front, SPC, spill((x0 + x1) / 2, yf) * .06), .16);
    let s = '';
    if (s_.rail && !SKY.has(i)) {
      s += cpoly(fD(dF, x0, yf - .3, x1, yb), col);
      const rl = '#08090a';
      s += poly(fD(dF + .03, x0, yf - hp, x1, yf - .3), rl, 'opacity=".42"');          // balusters read as a veil
      s += poly(fD(dF + .03, x0, yf - hp, x1, yf - hp + .06), rl);
      for (let x = x0 + .05; x < x1; x += 1.3) s += poly(fD(dF + .03, x, yf - hp, x + .05, yf - .3), rl);
    } else {
      s += cpoly(fD(dF, x0, yf - hp, x1, yb), col);
      // the parapet coping catches a little light from the room behind (it is seen against the lit soffit)
      if (s_.L) s += poly(fD(dF, x0, yf - hp, x1, yf - hp + .05), mix(col, s_.L.c, .12 * s_.L.I));
      s += poly(fD(dF, x0 + w * .5 - .015, yf - hp, x0 + w * .5 + .015, yf), '#000', 'opacity=".35"');   // precast panel joint
    }
    s += poly(fD(dF, x0, yf - .015, x1, yf + .025), '#000', 'opacity=".5"');           // groove parapet / slab nose
    // weathering: water running off the slab nose, streaks continuing storey after storey
    const [sx, sx2] = streakCols[k];
    for (const q of [sx, sx2]) if (q >= 0) {
      const xs = x0 + .3 + q * (w - .6), ww = .12 + q * .25;
      s += poly(fD(dF, xs, yf - hp, xs + ww, yb), glin([xs, yf - hp, dF], [xs, yb, dF], [[0, '#000', .05], [.6, '#000', .32], [1, '#000', .18]], [1, 0, 0]));
    }
    if (s_.streak >= 0) { const xs = x0 + .4 + s_.streak * (w - .8); s += poly(fD(dF, xs, yf - hp + .1, xs + .07, yb), '#8f8e86', 'opacity=".05"'); }
    // A/C condenser on brackets outside the parapet, with its condensate stain
    if (s_.ac && !SKY.has(i)) {
      const aw = .82, ah = .6, ad = .32, ax = x0 + .5 + (w - aw - 1) * s_.acx, a0 = yf - .25, a1 = a0 + ah, dA = dF - ad;
      s += poly(fD(dF, ax + .3, a1, ax + .38, a1 + 2.4), '#000', 'opacity=".3"');
      s += poly(fY(a1, ax, ax + aw, dA, dF), '#151617');
      s += poly(fX(ax, a0, a1, dA, dF), '#1b1c1d');
      s += poly(fD(dA, ax, a0, ax + aw, a1), jit('#24292a', .2));
      const gc = [ax + aw * .6, a0 + ah * .5, dA - .005], gp = [];
      for (let q = 0; q < 14; q++) { const t = q / 14 * Math.PI * 2; gp.push([gc[0] + Math.cos(t) * .2, gc[1] + Math.sin(t) * .2, gc[2]]); }
      s += poly(gp, '#0c0d0d');
    }
    if (s_.dish && !SKY.has(i)) {
      const dc = P(x0 + w * .7, yf - hp - .1, dF - .25);
      s += `<ellipse cx="${f2(dc[0])}" cy="${f2(dc[1])}" rx="1.3" ry=".9" fill="#2c2f30"/>`;
    }
    return s;
  }
  // a full-height fin at fx (its visible left face is the right wall of the balconies on its left)
  function finRanges() {
    const r = []; let y = 0;
    for (const i of [...SKY].sort((a, b) => a - b)) { r.push([y, yC(i)]); y = yFl(i) - hp; }
    r.push([y, Ymax]); return r;
  }
  const FR = finRanges();
  function litSide(x, leftK, d0, d1) {                    // light patches from the balconies on the left onto a left-facing wall
    let s = '';
    for (let i = 0; i < NS; i++) {
      if (SKY.has(i) || leftK === KC) continue;
      const s_ = st(i, leftK), yc = yC(i), yf = yFl(i);
      if (s_.L) s += poly(fX(x, yc, yf + ts, d0, d1), gell([x, yc + .8, dG], [0, 0, -(dG - d0) * 1.3], [0, 2.5, 0], [[0, s_.L.c, .5 * s_.L.I], [.4, s_.L.c, .22 * s_.L.I], [1, s_.L.c, 0]]));
      if (s_.lamp) s += poly(fX(x, yc, yf, d0, d1), gell([x, yc + .4, dG - .3], [0, 0, -1.6], [0, 1.8, 0], [[0, s_.lampC, .3], [1, s_.lampC, 0]]));
      // shadow under the slab: top of each patch darker (the soffit corner)
      s += poly(fX(x, yc, yc + .5, d0, d1), glin([x, yc, d0], [x, yc + .5, d0], [[0, '#000', .35], [1, '#000', 0]], [0, 0, 1]));
    }
    return s;
  }
  function fin(x, leftK) {
    let s = '';
    for (const [ya, yb] of FR) s += cpoly(fX(x, ya, yb, dFin, dG), mix(C.finL, SPC, spill(x, yb) * .05));
    s += litSide(x, leftK, dFin, dG);
    for (const [ya, yb] of FR) {
      if (yb < Ymax) s += cpoly(fY(yb, x, x + tf, dFin, dG), '#1c2221');      // underside where the fin stops at a deck
      s += cpoly(fD(dFin, x, ya, x + tf, yb), jit(C.fin, .12));
    }
    return s;
  }
  function jamb() {
    let s = cpoly(fX(Wm, 0, Ymax, 0, dG), C.jamb);
    for (const i of SKY) s += cpoly(fX(Wm, yC(i), yFl(i), dG - .01, dK), glin([Wm, yC(i), dF], [Wm, yC(i), dK], [[0, '#2a302d'], [1, '#56605b']], [0, 1, 0]));
    s += litSide(Wm, 0, 0, dG);
    s += poly(fX(Wm, 0, Ymax, 0, dG), glin([Wm, 0, 0], [Wm, 0, 1.2], [[0, '#000', .3], [1, '#000', 0]], [0, 1, 0]));
    return s;
  }
  // stair / lift core: solid board-marked concrete tower with lit stair slits (half-landings) and lobby windows
  function core() {
    let s = cpoly(fX(cx0, 0, Ymax, dC, dG), C.coreL);
    for (const i of SKY) s += cpoly(fX(cx0, yC(i), yFl(i), dG - .01, dK), glin([cx0, yC(i), dF], [cx0, yC(i), dK], [[0, '#384039'], [1, '#6a756f']], [0, 1, 0]));
    // deck light washing the core's flank at the decks
    for (const i of SKY) s += poly(fX(cx0, yC(i), yFl(i) + .6, dC, dG), gell([cx0, yC(i), dG], [0, 0, -2.2], [0, 3, 0], [[0, FLUO, .3], [1, FLUO, 0]]));
    s += cpoly(fD(dC, cx0, 0, cx1, Ymax), C.core);
    // vertical board marks / shutter joints
    for (let x = cx0 + .6; x < cx1 - .2; x += .6) s += poly(fD(dC, x, 0, x + .03, Ymax), '#000', `opacity="${(.12 + R() * .1).toFixed(2)}"`);
    const win = (xa, xb, ya, yb, col, rev = .45) => {
      let w = '';
      w += poly(fD(dC + rev, xa, ya, xb, yb), col || '#0a0c0c');
      if (col) w += poly(fD(dC + rev, xa, ya, xb, yb), glin([xa, ya, dC + rev], [xa, yb, dC + rev], [[0, '#fff', .25], [1, '#000', .25]], [1, 0, 0]));
      w += poly(fY(ya, xa, xb, dC, dC + rev), col ? mix('#1d2120', col, .3) : '#181a1a');   // head reveal (we see its underside)
      w += poly(fX(xb, ya, yb, dC, dC + rev), col ? mix('#121414', col, .18) : '#0f1111'); // right reveal
      w += poly(fD(dC + rev - .01, xa + (xb - xa) * .5 - .03, ya, xa + (xb - xa) * .5 + .03, yb), '#0b0c0c');
      return w;
    };
    for (let i = -1; i < NS; i++) {
      const yc = yC(i);
      const on = R() < .78, flick = R() < .1;
      s += win(cx0 + 1, cx0 + 1.55, yc + 1.4, yc + 3.4, on ? (flick ? '#7f9a8e' : '#cfeee0') : null);
      if (i >= 0 && !SKY.has(i)) s += win(cx1 - 2.4, cx1 - .9, yc + .5, yc + 1.5, R() < .7 ? '#e6f4ec' : null, .35);
    }
    return s;
  }

  panel({ z: 155, clip: [polyD(SG.brut.quad)], svg: () => {
    let s = '';
    // head of the megastructure opening + safety ground
    s += poly([[-12, 0, 0], [Wm, 0, 0], [Wm, Ymax, 0], [-12, Ymax, 0]], '#0c0e0f');
    s += cpoly(fY(0, -12, Wm, 0, dG), glin([0, 0, 0], [0, 0, dG], [[0, '#0f1112'], [1, '#141516']], [1, 0, 0]));
    // 1. interiors
    for (let i = 0; i < NS; i++) if (!SKY.has(i)) for (const b of bays) if (b.k !== KC) s += interior(i, b, st(i, b.k));
    // 2. soffits and decks
    for (let i = 0; i < NS; i++) {
      if (SKY.has(i)) { s += deck(i, -12, cx0) + deck(i, cx1, Wm); continue; }
      for (const b of bays) if (b.k !== KC) s += soffit(i, b, st(i, b.k));
    }
    // 3. balcony contents
    for (let i = 0; i < NS; i++) if (!SKY.has(i)) for (const b of bays) if (b.k !== KC) s += contents(i, b, st(i, b.k));
    // 4. fronts, swept right -> left so each fin overlaps the bay on its right and is overlapped by the bay on its left
    s += jamb();
    for (const b of bays) {
      if (b.k === KC) { s += core(); continue; }
      for (let i = 0; i < NS; i++) s += front(i, b, SKY.has(i) ? {} : st(i, b.k));
      if (b.k + 1 !== KC && b.k + 1 < fx.length) s += fin(fx[b.k + 1], b.k + 1);
    }
    // 5. concrete texture: mottling + rain streaks, multiplied over the visible concrete only
    const cid = 'bcc' + (GRAD.n++);
    GRAD.list.push(`<clipPath id="${cid}" clipPathUnits="userSpaceOnUse">${CONC.map(d => `<path d="${d}"/>`).join('')}</clipPath>`);
    GRAD.list.push(`<filter id="brTex" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency=".32 .28" numOctaves="3" seed="17"/><feColorMatrix type="matrix" values=".55 0 0 0 .6  .55 0 0 0 .6  .55 0 0 0 .6  0 0 0 0 1"/></filter>`);
    GRAD.list.push(`<filter id="brStreak" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency=".55 .022" numOctaves="2" seed="23"/><feColorMatrix type="matrix" values=".8 0 0 0 .5  .8 0 0 0 .5  .8 0 0 0 .5  0 0 0 0 1"/></filter>`);
    const [bl, bt, br, bb] = [Math.min(...SG.brut.quad.map(q => q[0])) - 2, Math.min(...SG.brut.quad.map(q => q[1])) - 2, Math.max(...SG.brut.quad.map(q => q[0])) + 2, Math.max(...SG.brut.quad.map(q => q[1])) + 2];
    s += `<g style="mix-blend-mode:multiply"><g clip-path="url(#${cid})"><rect x="${bl}" y="${bt}" width="${br - bl}" height="${bb - bt}" filter="url(#brTex)"/><rect x="${bl}" y="${bt}" width="${br - bl}" height="${bb - bt}" filter="url(#brStreak)" style="mix-blend-mode:multiply" opacity=".7"/></g></g>`;
    // 6. light sources last: balcony bulkhead lamps
    for (let i = 0; i < NS; i++) if (!SKY.has(i)) for (const b of bays) {
      const s_ = st(i, b.k); if (b.k === KC || !s_.lamp) continue;
      const w = b.x1 - b.x0, lx = b.x0 + 2.4 + (w - 3) * s_.pc, ld = dG - .32, yc = yC(i);
      s += poly(fY(yc, lx - .16, lx + .16, ld - .12, ld + .12), '#fffaf0');
    }
    return GRAD.flush() + s;
  } });
})();
