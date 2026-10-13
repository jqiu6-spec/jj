// shop_car.js — shop module (owned by one builder). Uses helpers from engine.js, panels2.js and depth.js.
// =====================================================================
// S7 — NEO MOTORS: 15-storey Japanese glass car showroom, built in true 3-D on facade plane SG.car
//      (projected through the solved camera), plus a protruding LED blade fin (replaces SG.carside).
//      Units below are METRES on the facade: x right along the facade, y down from the crown top,
//      d into the building (d < 0 sticks out toward the camera).
// =====================================================================
(() => {
  const F = Frame('car');
  const Wm = 26, Hm = Wm * F.H / F.W;            // facade is 26 m wide -> ~76 m tall
  const P = (x, y, d = 0) => F.N(x / Wm, y / Hm, d / Wm);
  const PX = (x, y, d = 0) => F.NX(x / Wm, y / Hm, d / Wm);
  const f2 = v => (+v).toFixed(2);
  const pd = pts => 'M' + pts.map(p => f2(p[0]) + ' ' + f2(p[1])).join(' L') + ' Z';
  const pd3 = pts => pd(pts.map(q => P(...q)));
  const poly = (pts, fill, extra = '') => `<path d="${pd3(pts)}" fill="${fill}" ${extra}/>`;
  const line3 = (a, b, col, w, extra = '') => { const A = P(...a), B = P(...b); return `<line x1="${f2(A[0])}" y1="${f2(A[1])}" x2="${f2(B[0])}" y2="${f2(B[1])}" stroke="${col}" stroke-width="${w}" ${extra}/>`; };
  const pline3 = (pts, col, w, extra = '') => `<path d="${'M' + pts.map(q => { const p = P(...q); return f2(p[0]) + ' ' + f2(p[1]); }).join(' L')}" fill="none" stroke="${col}" stroke-width="${w}" ${extra}/>`;
  // gradient between 3-D points a -> b whose iso-lines run along 3-D direction `along` (default: facade x)
  const glin = (a, b, stops, along = [1, 0, 0]) => {
    const A = P(...a), B = P(...b), E = P(a[0] + along[0], a[1] + along[1], a[2] + along[2]);
    let ex = E[0] - A[0], ey = E[1] - A[1]; const el = Math.hypot(ex, ey) || 1; ex /= el; ey /= el;
    const nx = -ey, ny = ex, t = (B[0] - A[0]) * nx + (B[1] - A[1]) * ny;
    return GRAD.lin([A[0], A[1]], [A[0] + nx * t, A[1] + ny * t], stops);
  };
  const clipPts = (pts2, svg) => {
    const id = 'ncc' + (GRAD.n++);
    GRAD.list.push(`<clipPath id="${id}" clipPathUnits="userSpaceOnUse"><path d="${pd(pts2)}"/></clipPath>`);
    return `<g clip-path="url(#${id})">${svg}</g>`;
  };
  // facing test: outward normal n (facade metric axes) at point p
  const faces = (n, p) => { const e = F.f; const nw = [0, 1, 2].map(i => n[0] * e.eu[i] + n[1] * e.ev[i] + n[2] * e.nin[i]); return V3.dot(nw, V3.mul(PX(...p), -1)) > 0; };
  let S = 9157; const R = () => (S = (S * 16807) % 2147483647) / 2147483647;
  const pickR = a => a[Math.floor(R() * a.length)];
  const lerp = (a, b, t) => a + (b - a) * t;

  // ---------------- building dimensions ----------------
  const NF = 15, yc = 5.4, hs = (Hm - yc) / NF;     // crown band, storey height (~4.7 m)
  const ts = .85, tn = .62, dg = .95, xL = .9, D = 18; // slab depth, chamfered nose drop, glass set-back, left pier, room depth
  const xf = 23.4, ft = 1.8, df = 12.2;              // LED fin: x position, thickness, projection
  const finY0 = -33.5, finY1 = 84;
  const bay = (xf - xL) / 9;                        // curtain-wall module (~2.5 m)
  const PINK = '#ff3f86';
  // parapet of the foreground terrace (from the photo): everything of ours is behind it
  const parY = x => 1985.2 + (x - 504) * .382;
  const above = [[300, 1300], [760, 1300], [760, parY(760)], [300, parY(300)]];
  const floors = [];
  for (let i = 0; i < NF; i++) { const yS = yc + i * hs; floors.push({ i, n: NF - i, yS, yU: yS + ts, yF: yS + hs, yB: yS + hs + tn }); }

  // floor "moods": ceiling finish, lamp colour, fixture layout, brightness, column finish
  const MOODS = {
    lounge: { ceil: '#7a5638', lamp: '#ffdcae', lay: 'dots', k: .78, colM: '#4a3626' },
    dark: { ceil: '#323236', lamp: '#fff3e4', lay: 'rows', k: 1, dark: 1, colM: '#2c2c30' },
    white: { ceil: '#d8d6d1', lamp: '#fffaf1', lay: 'rows', k: 1, colM: '#c4c1bb' },
    slots: { ceil: '#cfd4da', lamp: '#f3f8ff', lay: 'slots', k: .98, colM: '#bcc0c6' },
    event: { ceil: '#d0cbc7', lamp: '#fff5ef', lay: 'rows', k: .95, accent: '#ff2a3c', colM: '#c0bbb6' },
    service: { ceil: '#8e928d', lamp: '#eef7ea', lay: 'tubes', k: .66, colM: '#7d817b' },
    grid: { ceil: '#c8cbce', lamp: '#f7fbff', lay: 'grid', k: .94, colM: '#b4b7ba' },
  };
  const moodOf = ['lounge', 'dark', 'slots', 'dark', 'event', 'dark', 'white', 'service', 'grid', 'dark', 'white', 'slots', 'dark', 'white', 'white'];
  const CARC = ['#ecebe6', '#e6e6e2', '#b9bdc3', '#50555d', '#141518', '#b3121f', '#1d2f6a', '#d9a520', '#6e7072', '#f1f0ec', '#1e5e66', '#7a0d16'];
  let REFL = 'none';

  // ---------------- a car, true 3-D (side profile extruded), metres ----------------
  // profile in (a: along car, front +; h: height)
  const arch = (ac, r, from, to, n = 7) => Array.from({ length: n + 1 }, (_, j) => { const t = Math.PI * (from + (to - from) * j / n); return [ac + Math.cos(t) * r, .34 + Math.sin(t) * r]; });
  const BODY = [[2.30, .30], ...arch(1.47, .42, 0, 1).map(p => [p[0], Math.max(.30, p[1])]), ...arch(-1.47, .42, 0, 1).map(p => [p[0], Math.max(.30, p[1])]),
    [-2.30, .30], [-2.42, .44], [-2.45, .80], [-2.35, .98], [-1.95, 1.0], [.95, .93], [1.60, .86], [2.36, .74], [2.46, .60], [2.44, .42]];
  const GH = [[.98, .93], [.12, 1.33], [-.72, 1.37], [-1.32, 1.30], [-1.98, 1.0]];
  const DLO = [[.80, .97], [.14, 1.28], [-.70, 1.32], [-1.22, 1.26], [-1.70, 1.02]];
  function car(fl, cx, dNear, yaw, col, lit = 0, plat = .3) {
    const th = yaw * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
    const dc = dNear + 2.44 * Math.abs(s) + .98 * Math.abs(c);
    const yb = fl.yF - plat;
    const W3 = (a, b, h) => [cx + a * c - b * s, yb - h, dc + a * s + b * c];
    const nearB = faces([s, 0, -c], W3(0, -.98, .6)) ? -1 : 1;     // which long side we see
    const endA = faces([c, 0, s], W3(2.44, 0, .6)) ? 1 : -1;          // which end we see
    const bs = .98 * nearB, gs = .80 * nearB;
    const lum = hex2rgb(col).reduce((a, v) => a + v, 0) / 765;
    const sideFirst = Math.abs(c) < .5;                                // nose-out: side is behind the end face
    let o = '', side = '', end = '';
    // ---- end face (front fascia or tail) ----
    const ea = 2.43 * endA, eo = .012 * endA;
    const endPts = endA > 0 ? [[-.95, .32], [.95, .32], [.97, .52], [.92, .70], [.6, .76], [-.6, .76], [-.92, .70], [-.97, .52]] : [[-.97, .33], [.97, .33], [.97, .96], [.6, 1.0], [-.6, 1.0], [-.97, .96]];
    end += poly(endPts.map(([b, h]) => W3(ea, b, h)), glin(W3(ea, 0, .3), W3(ea, 0, 1), [[0, shade(col, .22)], [.55, shade(col, .55)], [1, mix(col, '#ffffff', .15)]], [-s, 0, c]));
    if (endA > 0) {
      end += poly([[-.62, .36], [.62, .36], [.66, .5], [-.66, .5]].map(([b, h]) => W3(ea + eo, b, h)), '#08090b');      // lower intake
      if (lit) {   // full-width light bar (display cars left on)
        end += pline3([W3(ea + eo, -.9, .64), W3(ea + eo, .9, .64)], '#ffffff', .7);
        end += pline3([W3(ea + eo, -.9, .64), W3(ea + eo, .9, .64)], '#e8f4ff', 2.4, 'opacity=".28" filter="url(#b1)"');
      } else { end += pline3([W3(ea + eo, -.9, .65), W3(ea + eo, -.4, .63)], '#dfe6ee', .45) + pline3([W3(ea + eo, .4, .63), W3(ea + eo, .9, .65)], '#dfe6ee', .45); }
    } else {
      end += poly([[-.95, .80], [.95, .80], [.95, .9], [-.95, .9]].map(([b, h]) => W3(ea + eo, b, h)), lit ? '#ff1626' : '#5a0a10');
      if (lit) end += pline3([W3(ea + eo, -.95, .85), W3(ea + eo, .95, .85)], '#ff3a40', 2.2, 'opacity=".35" filter="url(#b1)"');
    }
    // ---- greenhouse (inset side plane) + window ----
    side += poly(GH.map(([a, h]) => W3(a, gs, h)), shade(col, .5));
    side += poly(DLO.map(([a, h]) => W3(a, gs - .01 * nearB, h)), glin(W3(0, gs, 1.0), W3(0, gs, 1.32), [[0, '#20252c'], [.55, '#4b535d'], [1, '#9aa3ad']], [c, 0, s]));
    for (const a0 of [.25, -.55]) side += poly([[a0, .99], [a0 + .16, .99], [a0 - .1, 1.3], [a0 - .26, 1.3]].map(([a, h]) => W3(a, gs - .015 * nearB, h)), '#e9eef4', 'opacity=".5"');
    side += poly([[-.30, .97], [-.40, .97], [-.40, 1.33], [-.30, 1.33]].map(([a, h]) => W3(a, gs - .02 * nearB, h)), '#0b0c0e');
    // ---- body side: paint lit from the ceiling above, rocker in shadow ----
    side += poly(BODY.map(([a, h]) => W3(a, bs, h)), glin(W3(0, bs, .3), W3(0, bs, 1.0), [[0, shade(col, .16)], [.28, shade(col, .4)], [.62, shade(col, .78)], [.86, mix(col, '#ffffff', .18 + .2 * (1 - lum))], [.95, shade(col, .7)], [1, shade(col, .55)]], [c, 0, s]));
    side += pline3([[2.30, .75], [1.6, .845], [.95, .905], [-1.95, .965], [-2.33, .95]].map(([a, h]) => W3(a, bs - .01 * nearB, h)), '#ffffff', .45, `opacity="${.55 + .3 * (1 - lum)}"`);
    side += pline3([[.85, .36], [.85, .9]].map(([a, h]) => W3(a, bs - .01 * nearB, h)), '#000', .3, 'opacity=".35"');
    side += pline3([[-.40, .34], [-.40, .95]].map(([a, h]) => W3(a, bs - .01 * nearB, h)), '#000', .3, 'opacity=".35"');
    side += pline3([[1.9, .62], [-2.1, .66]].map(([a, h]) => W3(a, bs - .01 * nearB, h)), '#ffffff', .5, `opacity="${.16 + .2 * (1 - lum)}"`);
    // the vertical side panel mirrors the bright ceiling near the glass: thin streaks of the linear fixtures
    side += pline3([[2.1, .53], [.9, .55], [-1.0, .57], [-2.2, .58]].map(([a, h]) => W3(a, bs - .012 * nearB, h)), '#ffffff', .32, `opacity="${.3 + .4 * (1 - lum)}"`);
    side += pline3([[1.4, .44], [-1.9, .47]].map(([a, h]) => W3(a, bs - .012 * nearB, h)), '#ffffff', .25, `opacity="${.12 + .25 * (1 - lum)}"`);
    for (const wa of [1.47, -1.47]) {
      const tyre = Array.from({ length: 14 }, (_, j) => { const t = j / 14 * 2 * Math.PI; return W3(wa + Math.cos(t) * .35, bs - .02 * nearB, .35 + Math.sin(t) * .35); });
      const rim = Array.from({ length: 14 }, (_, j) => { const t = j / 14 * 2 * Math.PI; return W3(wa + Math.cos(t) * .23, bs - .03 * nearB, .35 + Math.sin(t) * .23); });
      side += poly(tyre, '#0a0a0b') + poly(rim, glin(W3(wa, bs, .12), W3(wa, bs, .58), [[0, '#2a2c30'], [1, '#9a9ea4']], [c, 0, s]));
    }
    if (endA > 0) side += pline3([W3(2.30, bs - .01 * nearB, .70), W3(2.0, bs - .01 * nearB, .75)], lit ? '#ffffff' : '#cfd6de', .5);
    else side += pline3([W3(-2.40, bs - .01 * nearB, .86), W3(-2.12, bs - .01 * nearB, .9)], lit ? '#ff2a36' : '#6a0c12', .55);
    o = sideFirst ? side + end : end + side;
    return o;
  }
  // person in a vertical plane parallel to the facade (true perspective), feet on the floor
  function human(fl, x, d, ht, col, side = 1) {
    const yf = fl.yF, q = (a, h) => [x + a * ht / 1.75, yf - h * ht / 1.75, d];
    const head = Array.from({ length: 12 }, (_, j) => { const t = j / 12 * 2 * Math.PI; return q(Math.cos(t) * .105, 1.63 + Math.sin(t) * .125); });
    const body = [[-.08, 1.50], [.08, 1.50], [.23, 1.44], [.25 * side, 1.0], [.2, .95], [.16, .05], [.04, .05], [0, .8], [-.04, .05], [-.16, .05], [-.2, .95], [-.25, 1.0], [-.23, 1.44]].map(([a, h]) => q(a, h));
    return poly(body, glin(q(0, .9), q(0, 1.5), [[0, shade(col, .6)], [1, col]])) + poly(head, '#1a1513');
  }

  // low display plinth right behind the glass: front riser faces us, LED strip under its nosing
  function plinth(fl, x0, x1, d0, h, col, led) {
    const yb = fl.yF;
    let o = poly([[x0, yb - h, d0], [x1, yb - h, d0], [x1, yb, d0], [x0, yb, d0]], glin([x0, yb - h, d0], [x0, yb, d0], [[0, shade(col, .55)], [1, shade(col, .2)]]));
    o += line3([x0, yb - h + .03, d0 - .01], [x1, yb - h + .03, d0 - .01], led, .5) + line3([x0, yb - h + .03, d0 - .01], [x1, yb - h + .03, d0 - .01], led, 1.6, 'opacity=".22" filter="url(#b1)"');
    return o;
  }
  // two-post car stacker (service floor): car parked on a raised platform, another one under it
  function stacker(fl, cx, colUp, colLo) {
    const yF = fl.yF, hp = 1.95, d0 = dg + .45, d1 = d0 + 5.3;
    let o = '';
    o += car(fl, cx, d0 + .15, -90, colUp, 0, hp + .02);                                        // upper car (behind the platform deck)
    // deck underside (seen from below), ribs, front beam with worn yellow paint
    o += poly([[cx - 1.3, yF - hp + .16, d0], [cx + 1.3, yF - hp + .16, d0], [cx + 1.3, yF - hp + .16, d1], [cx - 1.3, yF - hp + .16, d1]], glin([cx, yF - hp, d0], [cx, yF - hp, d1], [[0, '#3a3c40'], [.4, '#232427'], [1, '#121214']]));
    for (const dd of [1.2, 2.5, 3.8]) o += line3([cx - 1.3, yF - hp + .16, d0 + dd], [cx + 1.3, yF - hp + .16, d0 + dd], '#0b0b0c', .35);
    o += poly([[cx - 1.3, yF - hp, d0], [cx + 1.3, yF - hp, d0], [cx + 1.3, yF - hp + .16, d0], [cx - 1.3, yF - hp + .16, d0]], '#8a7424');
    for (const sx of [-1.42, 1.3]) o += poly([[cx + sx, yF - 2.6, d0], [cx + sx + .14, yF - 2.6, d0], [cx + sx + .14, yF, d0], [cx + sx, yF, d0]], glin([cx, yF - 2.6, d0], [cx, yF, d0], [[0, '#4a4d52'], [1, '#1c1d20']]));
    o += car(fl, cx, d0 + .25, -90, colLo, 0, .02);                                              // lower car, nose to the glass
    return o;
  }

  // ---------------- one storey ----------------
  function storey(fl) {
    const mood = moodOf[fl.i], M = MOODS[mood], kk = M.k;
    S = 1000 + fl.i * 7919;
    const { yU, yF, yB } = fl;
    const xR = Wm + 3;
    const ce = M.ceil, L = M.lamp;
    let s = '';
    // ---- ceiling (underside of the slab above): the dominant surface when looking up ----
    const cg = M.dark
      ? [[0, '#0e0e10'], [.06, shade(ce, .62)], [.24, shade(ce, .95)], [.6, shade(ce, .8)], [1, shade(ce, .45)]]
      : [[0, shade(ce, .36 * kk)], [.07, shade(ce, .6 * kk)], [.27, shade(ce, .78 * kk)], [.62, shade(ce, .66 * kk)], [1, shade(ce, .44 * kk)]];
    s += poly([[-8, yU, dg], [xR, yU, dg], [xR, yU, D], [-8, yU, D]], glin([10, yU, dg], [10, yU, 9], cg));
    // big soft illuminance variation along the floor (zones, uneven bounce from cars and floor)
    for (let j = 0; j < 3; j++) { const x0 = R() * Wm, w = 3 + R() * 6; s += poly([[x0, yU, dg], [x0 + w, yU, dg], [x0 + w, yU, 9], [x0, yU, 9]], '#000', `opacity="${(.05 + R() * .12).toFixed(2)}" filter="url(#b2)"`); }
    // light fixtures
    const fix = (x0, x1, d0, d1, col, op = 1, halo = .2) => {
      let o = poly([[x0, yU + .01, d0], [x1, yU + .01, d0], [x1, yU + .01, d1], [x0, yU + .01, d1]], col, op < 1 ? `opacity="${f2(op)}"` : '');
      if (halo > 0) { const e = Math.max(.22, (d1 - d0) * 1.5); o += poly([[x0 - .12, yU + .01, d0 - e], [x1 + .12, yU + .01, d0 - e], [x1 + .12, yU + .01, d1 + e], [x0 - .12, yU + .01, d1 + e]], col, `opacity="${f2(halo * op)}" filter="url(#b1)"`); }
      return o;
    };
    if (M.lay === 'rows') {
      const rows = [1.7, 3.0, 4.4, 5.9, 7.5], w = M.dark ? .035 : .05;
      for (const d of rows) {
        if (M.dark) s += poly([[xL, yU + .01, d - .55], [xR, yU + .01, d - .55], [xR, yU + .01, d + .55], [xL, yU + .01, d + .55]], glin([5, yU, d - .55], [5, yU, d + .55], [[0, L, 0], [.5, L, .09], [1, L, 0]]));
        for (let x = xL + .35; x < xR; x += 3.6) { if (R() < .03) continue; s += fix(x, Math.min(x + 3.38, xR), d - w, d + w, L, .84 + R() * .16, M.dark ? .32 : .16); }
      }
    } else if (M.lay === 'slots') {
      for (let x = xL + bay / 2; x < xR; x += bay) s += fix(x - .05, x + .05, dg + .75, 9, L, .92, .12);
      s += fix(xL, xR, 1.42, 1.54, L, 1, .22);
    } else if (M.lay === 'grid') {
      for (const d of [2.1, 4.2, 6.3, 8.4]) for (let x = xL + bay / 2; x < xR; x += bay) s += fix(x - .6, x + .6, d - .6, d + .6, L, .72 + R() * .14, .08);
    } else if (M.lay === 'tubes') {
      for (const d of [2.2, 4.4, 6.6, 8.8]) for (let x = xL + .8; x < xR; x += 3.2) { if (R() < .14) continue; s += fix(x, x + 1.5, d - .04, d + .04, L, .75 + R() * .25, .3); }
    } else if (M.lay === 'dots') {
      // warm wood-slat lounge ceiling with downlights
      for (let dl = dg + .3; dl < 10; dl += .45) s += poly([[-8, yU + .01, dl], [xR, yU + .01, dl], [xR, yU + .01, dl + .07], [-8, yU + .01, dl + .07]], '#2a1a0e', 'opacity=".55"');
      for (let dl = 2; dl < 11; dl += 2.2) for (let x = xL + 1.2; x < xR; x += 2.4) {
        const c = P(x, yU, dl), r = 2.2 / Math.sqrt(dl + 1);
        s += `<ellipse cx="${f2(c[0])}" cy="${f2(c[1])}" rx="${f2(r * .5)}" ry="${f2(r * .26)}" fill="${L}"/><ellipse cx="${f2(c[0])}" cy="${f2(c[1])}" rx="${f2(r * 1.5)}" ry="${f2(r * .8)}" fill="${L}" opacity=".16" filter="url(#b1)"/>`;
      }
    }
    if (M.accent) s += fix(xL, xR, 6.0, 6.25, M.accent, .9, .3);
    // track with spotlights aimed at the display cars; the lenses tilted toward the glass glint at us
    if (['white', 'event', 'slots', 'dark'].includes(mood)) {
      const dT = M.dark ? 2.35 : 2.25;
      s += line3([xL, yU + .06, dT], [xR, yU + .06, dT], M.dark ? '#08080a' : '#3a3a3c', .5);
      for (let x = xL + .9 + R() * .6; x < xR; x += 1.1 + R() * 1.1) {
        if (R() < .2) continue;
        const c = P(x, yU + .16, dT - .05), b = R();
        s += `<ellipse cx="${f2(c[0])}" cy="${f2(c[1])}" rx=".55" ry=".4" fill="#1a1a1c"/><ellipse cx="${f2(c[0] + .1)}" cy="${f2(c[1] + .15)}" rx="${f2(.28 + b * .2)}" ry="${f2(.22 + b * .14)}" fill="#fffaf0" opacity="${f2(.55 + b * .45)}"/>`;
      }
    }
    // the far end of the floor toward the pier gets less light (fewer fixtures beyond the column line)
    s += poly([[xL, yU, dg], [xL + 5, yU, dg], [xL + 5, yU, 9], [xL, yU, 9]], glin([xL, yU, dg], [xL + 5, yU, dg], [[0, '#000', .32], [1, '#000', 0]], [0, 0, 1]));
    // pink light of the LED fin entering through the glass, washing the ceiling near it
    { const c = P(xf, yU, dg), e = P(xf - 8, yU, dg), r = Math.hypot(c[0] - e[0], c[1] - e[1]);
      s += poly([[xf - 10, yU, dg], [xR, yU, dg], [xR, yU, 7], [xf - 10, yU, 7]], GRAD.rad(c, r, [[0, PINK, .2], [.35, PINK, .06], [1, PINK, 0]]), 'style="mix-blend-mode:screen"'); }
    // ambient occlusion where the ceiling meets the glass head
    s += poly([[-8, yU, dg], [xR, yU, dg], [xR, yU, dg + .9], [-8, yU, dg + .9]], glin([10, yU, dg], [10, yU, dg + .9], [[0, '#000', .5], [1, '#000', 0]]));

    // ---- contents, far to near ----
    const items = [];
    // structural columns (same grid on every floor), finish depends on the floor
    const cm = M.colM;
    for (let x = xL + bay * 1.5; x < xf - 1; x += bay * 3) items.push({ d: 3.35, svg: () => {
      // round column (silhouette plane through its axis): shading across the width says "cylinder"
      const x0 = x - .4, x1 = x + .4, d0 = 3.35; let o = '';
      o += poly([[x0, yU, d0], [x1, yU, d0], [x1, yF, d0], [x0, yF, d0]], glin([x0, yU, d0], [x1, yU, d0], [[0, shade(cm, .16 * kk)], [.3, shade(cm, .52 * kk)], [.45, shade(cm, .62 * kk)], [.8, shade(cm, .34 * kk)], [1, shade(cm, .12 * kk)]], [0, 1, 0]));
      o += poly([[x0, yU, d0], [x1, yU, d0], [x1, yF, d0], [x0, yF, d0]], glin([x0, yU, d0], [x0, yF, d0], [[0, '#000', .35], [.12, '#000', 0], [.5, '#000', .1], [1, '#000', .5]]));
      o += line3([x0 + .3, yU + .25, d0 - .01], [x0 + .3, yF, d0 - .01], '#ffffff', .2, `opacity="${M.dark ? .28 : .16}"`);
      return o;
    } });
    // event floor: hanging campaign banners and a red ring light
    if (mood === 'event') for (const x of [5, 11.5, 18]) items.push({ d: 4.2, svg: () => {
      const a = x - .7, b = x + .7, y0 = yU + .15, y1 = yU + 2.4, d = 4.2;
      return line3([x, yU, d], [x, y0, d], '#333', .2) + poly([[a, y0, d], [b, y0, d], [b, y1, d], [a, y1, d]], glin([a, y0, d], [a, y1, d], [[0, '#d9d5d0'], [1, '#a8a49f']])) + poly([[a, y0 + .5, d], [b, y0 + .5, d], [b, y0 + .95, d], [a, y0 + .95, d]], '#a80d19');
    } });
    // 9F: suspended LED video wall
    if (fl.n === 9) items.push({ d: 5.5, svg: () => {
      const a = 6, b = 17, y0 = yU + .25, y1 = yU + 2.1, d = 5.5;
      return poly([[a, y0, d], [b, y0, d], [b, y1, d], [a, y1, d]], glin([a, y0, d], [b, y0, d], [[0, '#1648c8'], [.35, '#1fa6e0'], [.6, '#e8f4ff'], [.75, '#3a8fe0'], [1, '#4a2cc0']], [0, 1, 0])) + poly([[a, y0, d], [b, y0, d], [b, y0 + .12, d], [a, y0 + .12, d]], '#0a0a0c');
    } });
    // linear pendants on some white floors
    if (mood === 'white' && fl.i % 2) items.push({ d: 2.6, svg: () => pline3([[xL + 1, yU + .55, 2.6], [xf - 1, yU + .55, 2.6]], L, .5) + pline3([[xL + 1, yU + .55, 2.6], [xf - 1, yU + .55, 2.6]], L, 1.6, 'opacity=".2" filter="url(#b1)"') });
    // people (heads/shoulders above the slab sightline)
    const np = mood === 'service' ? 1 : 1 + Math.floor(R() * 3);
    for (let j = 0; j < np; j++) { const x = xL + 2 + R() * (xf - 5), d = 1.6 + R() * 1.6, ht = 1.62 + R() * .2, col = pickR(['#16181d', '#20232a', '#3b3e44', '#8e8c88', '#141414', '#d8d4cc']), sd = R() < .5 ? 1 : -1; items.push({ d, svg: () => human(fl, x, d, ht, col, sd) }); }
    if (mood === 'service') {
      items.push({ d: 4, svg: () => stacker(fl, 4.6, '#b9bdc3', '#141518') + stacker(fl, 11.2, '#e6e6e2', '#7a0d16') + stacker(fl, 17.8, '#1d2f6a', '#6e7072') });
    } else {
      // display cars right behind the glass; some on turntables with an LED rim
      const nC = mood === 'lounge' ? 2 : 3;
      let x = xL + 2.6 + R() * 1.2;
      for (let j = 0; j < nC; j++) {
        const yaw = pickR([0, 0, 180, 12, -14, 168, 195, 25, -28]);
        const col = pickR(CARC), th = yaw * Math.PI / 180, ext = 2.44 * Math.abs(Math.sin(th)) + .98 * Math.abs(Math.cos(th));
        const tt = mood !== 'lounge' && R() < .45;
        const cx = x, lit = mood === 'event' || R() < .25 ? 1 : 0;
        if (tt) {
          const dp = dg + .18, dn = dp + .22, half = 2.44 * Math.abs(Math.cos(th)) + .98 * Math.abs(Math.sin(th)) + .5;
          items.push({ d: dn + 1, svg: () => car(fl, cx, dn, yaw, col, lit, .26) + plinth(fl, cx - half, cx + half, dp, .24, M.dark ? '#3a3a3e' : '#d6d4d0', mood === 'event' ? '#ff4050' : '#eef6ff') });
        } else {
          const dn = dg + .3 + R() * .45;
          items.push({ d: dn + 1, svg: () => car(fl, cx, dn, yaw, col, lit, .12) });
        }
        x += 6.4 + R() * 1.6;
        if (x > xf - 2.5) break;
      }
    }
    items.sort((a, b) => b.d - a.d);
    for (const it of items) s += it.svg();
    // roller shades half down on some bays (customer-lounge floor)
    if (mood === 'grid') for (let x = xL, j = 0; x < xf - .1; x += bay, j++) {
      if (R() < .45) continue;
      const dr = .5 + R() * 2.2, d = dg + .12;
      s += poly([[x + .06, yU, d], [x + bay - .06, yU, d], [x + bay - .06, yU + dr, d], [x + .06, yU + dr, d]], glin([x, yU, d], [x, yU + dr, d], [[0, '#a7a49e'], [1, '#d9d5cc']]), 'opacity=".9"');
      s += line3([x + .06, yU + dr, d], [x + bay - .06, yU + dr, d], '#2a2826', .5);
    }
    // 10F: half the floor after hours (lights off, emergency lighting only)
    if (fl.n === 10) s += poly([[xL, yU - 1, dg], [12.5, yU - 1, dg], [12.5, yF + 1, dg], [xL, yF + 1, dg]], glin([xL, yU, dg], [12.5, yU, dg], [[0, '#000', .82], [.62, '#000', .78], [1, '#000', 0]], [0, 1, 0]));

    // ---- glass: slight tint, per-pane sheen, reflected city lights ----
    const G = [[xL, yU, dg], [xR, yU, dg], [xR, yF, dg], [xL, yF, dg]];
    s += poly(G, '#0a1a1c', 'opacity=".2"');
    for (let x = xL, j = 0; x < xf; x += bay, j++) {
      const a = .02 + R() * .06, pane = [[x, yU, dg], [x + bay, yU, dg], [x + bay, yF, dg], [x, yF, dg]];
      s += poly(pane, glin([x, yU, dg], [x, yF, dg], [[0, '#a9b8d0', a * 1.5], [.6, '#56607a', a * .6], [1, '#202838', a * .25]]), 'style="mix-blend-mode:screen"');
    }
    s += poly(G, REFL, 'style="mix-blend-mode:screen"');
    // reflections of signs across the street: thin streaks that break slightly at each mullion (pane distortion)
    const nS = R() < .55 ? 1 : 0;
    for (let k = 0; k < nS; k++) {
      const yy = yU + .4 + R() * (yF - yU - 1.2), x0 = xL + R() * 12, len = 3 + R() * 9, col = pickR(['#ffd9a0', '#8feaff', '#ff7ab8', '#fff1dc', '#b8ff9a']), op = .22 + R() * .3;
      for (let x = Math.floor((x0 - xL) / bay) * bay + xL; x < Math.min(x0 + len, xf); x += bay) {
        const a = Math.max(x, x0) + .04, b = Math.min(x + bay, x0 + len) - .04, dy = (R() - .5) * .08;
        if (b > a) s += line3([a, yy + dy, dg - .01], [b, yy + dy + (R() - .5) * .04, dg - .01], col, .55, `opacity="${f2(op)}" style="mix-blend-mode:screen"`);
      }
    }
    // mullions: dark outer cap with a sliver of its return, faint lit inner edge
    for (let j = 1; j < 10; j++) {
      const x = xL + j * bay;
      s += poly([[x - .04, yU, dg - .16], [x - .04, yF, dg - .16], [x - .04, yF, dg], [x - .04, yU, dg]], '#15171b');
      s += line3([x, yU, dg], [x, yF, dg], '#0c0d10', .42);
      s += line3([x + .045, yU + .2, dg + .02], [x + .045, yF, dg + .02], '#8a8c90', .18, 'opacity=".35"');
    }
    s += line3([xL, yU + .04, dg], [xR, yU + .04, dg], '#0b0c0e', .6);
    s += line3([xL, yF - .04, dg], [xR, yF - .04, dg], '#0b0c0e', .7);
    const inner = clipPts([P(xL, yU, 0), P(xR, yU, 0), P(xR, yB, 0), P(xL, yB, 0)], s);
    // soffit outside (slab underside between fascia and glass head): lit faintly by light leaving the storey below it
    let o = inner;
    o += poly([[xL, yU, 0], [xR, yU, 0], [xR, yU, dg], [xL, yU, dg]], glin([10, yU, 0], [10, yU, dg], [[0, '#121316'], [.55, shade('#3a3936', kk)], [1, shade(mix('#3a3936', L, .12), kk)]]));
    o += poly([[xf - 7, yU, 0], [xf, yU, 0], [xf, yU, dg], [xf - 7, yU, dg]], glin([xf, yU, 0], [xf - 7, yU, 0], [[0, PINK, .4], [.4, PINK, .1], [1, PINK, 0]], [0, 0, 1]), 'style="mix-blend-mode:screen"');
    return o;
  }

  // ---------------- main facade panel (z 120) ----------------
  panel({ z: 120, clip: [], svg: () => {
    let s = '';
    // one continuous reflection across the whole curtain wall (glow of the sky between megastructure masses)
    { const a = P(-4, 8, dg), b = P(30, 62, dg);
      REFL = GRAD.lin(a, b, [[0, '#9fb2d6', 0], [.38, '#9fb2d6', 0], [.47, '#9fb2d6', .07], [.53, '#c4cfe6', .09], [.6, '#9fb2d6', .02], [1, '#9fb2d6', 0]]); }
    for (const fl of floors) s += storey(fl);
    // facade frame: left pier + slab fascias (dark anodised aluminium), with apertures
    let fr = pd3([[0, yc, 0], [Wm + 3, yc, 0], [Wm + 3, Hm + 2, 0], [0, Hm + 2, 0]]);
    for (const fl of floors) fr += ' ' + pd3([[xL, fl.yU, 0], [xL, fl.yB, 0], [Wm + 3, fl.yB, 0], [Wm + 3, fl.yU, 0]]);
    s += `<path d="${fr}" fill-rule="evenodd" fill="${glin([5, yc, 0], [5, Hm, 0], [[0, '#1c1e22'], [1, '#17181b']])}"/>`;
    for (const fl of floors) {
      // fascia: faint sky sheen at the top, crisp lit arris at the bottom edge
      const yn = fl.i ? fl.yS + tn : fl.yS;
      s += poly([[xL, yn, 0], [Wm + 3, yn, 0], [Wm + 3, fl.yU, 0], [xL, fl.yU, 0]], glin([5, yn, 0], [5, fl.yU, 0], [[0, '#4a4d54'], [.35, '#2a2c31'], [1, '#17181b']]));
      s += line3([xL, fl.yU - .03, 0], [Wm + 3, fl.yU - .03, 0], '#9a9890', .35, 'opacity=".7"');
      // pink spill from the LED fin, falling off with distance
      s += poly([[xf - 9, yn, 0], [xf, yn, 0], [xf, fl.yU, 0], [xf - 9, fl.yU, 0]], glin([xf, yn, 0], [xf - 9, yn, 0], [[0, PINK, .6], [.35, PINK, .18], [1, PINK, 0]], [0, 1, 0]), 'style="mix-blend-mode:screen"');
    }
    // left pier edge: reveal toward the photo's structure
    s += poly([[0, yc, 0], [.12, yc, 0], [.12, Hm + 2, 0], [0, Hm + 2, 0]], '#0c0d0f');
    // crown band (projecting box): underside + left end; the lit face is its own panel below
    const cd = -1.1;
    s += poly([[0, yc, cd], [Wm + 3, yc, cd], [Wm + 3, yc, 0], [0, yc, 0]], glin([5, yc, cd], [5, yc, 0], [[0, '#1b1c1f'], [1, '#0e0f11']]));
    for (let x = 1.2; x < xf; x += 1.7) { const c = P(x, yc, cd * .45); s += `<ellipse cx="${f2(c[0])}" cy="${f2(c[1])}" rx=".55" ry=".3" fill="#fff6e6"/>`; }
    if (faces([-1, 0, 0], [0, yc / 2, cd / 2])) s += poly([[0, 0, cd], [0, yc, cd], [0, yc, 0], [0, 0, 0]], '#101114');
    return GRAD.flush() + clipPts(above, s);
  } });

  // crown lit face: black glass band with white channel letters
  {
    const cd = -1.1, q = [P(0, 0, cd), P(xf + 3, 0, cd), P(xf + 3, yc, cd), P(0, yc, cd)];
    const ww = 560, hh = Math.round(ww * yc / (xf + 3));
    panel({ z: 120, quad: q, w: ww, h: hh, clip: [pd(above)], svg: (w, h) => `
      <defs><linearGradient id="ncrownG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#17181c"/><stop offset=".5" stop-color="#0b0c0e"/><stop offset="1" stop-color="#060607"/></linearGradient>
      <filter id="ncrownB" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="${h * .035}"/></filter></defs>
      ${rect(0, 0, w, h, 'url(#ncrownG)')}
      ${rect(0, h * .9, w, h * .1, '#2a2c30')}${rect(0, 0, w, h * .04, '#3a3d42')}
      <g filter="url(#ncrownB)" opacity=".75">${T(w * .43, h * .6, 'NEO MOTORS', h * .4, "'Inter Display','Inter'", '#dfe9ff', 'text-anchor="middle" font-weight="600" letter-spacing="' + (h * .1) + '"')}</g>
      ${T(w * .43, h * .6, 'NEO MOTORS', h * .4, "'Inter Display','Inter'", '#ffffff', 'text-anchor="middle" font-weight="600" letter-spacing="' + (h * .1) + '"')}
      ${rect(w * .18, h * .7, w * .5, h * .012, PINK)}
      ${T(w * .43, h * .83, 'ネオ自動車  ·  SHOWROOM 1F – 15F', h * .1, "'IPAGothic','Inter'", '#c9ced8', 'text-anchor="middle" letter-spacing="' + (h * .03) + '"')}
      <rect x="0" y="0" width="${w}" height="${h}" fill="none" stroke="#000" stroke-width="${h * .04}"/>` });
  }

  // reflection of the LED fin in every storey's glass (mirror image behind the glass plane)
  {
    const vq = [P(xf, finY0, 2 * dg + df), P(xf, finY0, 2 * dg), P(xf, finY1, 2 * dg), P(xf, finY1, 2 * dg + df)];
    const glassClips = floors.map(fl => pd([P(xL, fl.yU, dg), P(xf, fl.yU, dg), P(xf, Math.min(fl.yB, Hm - .6), 0), P(xL, Math.min(fl.yB, Hm - .6), 0)]));
    panel({ z: 120, quad: vq, w: 120, h: Math.round(120 * (finY1 - finY0) / df), clip: glassClips, blend: 'screen', opacity: .15, svg: (w, h) => `<g transform="translate(${w} 0) scale(-1 1)">${finFace(w, h, 'r')}</g>` });
  }

  // ---------------- LED blade fin (z 180) ----------------
  // lit face (the fin's left flank, plane perpendicular to the facade); panel x = 0 at the facade, x = w at the outer edge
  function finFace(w, h, id) {
    const yk = y => (y - finY0) / (finY1 - finY0) * h;   // metres -> panel px
    const chars = 'ネオ自動車';
    const cs = w * .62;
    let txt = '';
    [...chars].forEach((ch, i) => { txt += `<text x="${w * .5}" y="${yk(-28 + i * 10.4) + cs * .86}" font-size="${cs}" font-family="'IPAGothic'" text-anchor="middle" fill="#fff6fa" stroke="#fff6fa" stroke-width="${cs * .03}">${ch}</text>`; });
    let S2 = 4242; const R2 = () => (S2 = (S2 * 16807) % 2147483647) / 2147483647;
    const nP = 23, ph = (finY1 - finY0) / nP;
    let mods = '';
    // LED modules: each 5 m panel has its own slight brightness / tint (binning), joints between them
    for (let i = 0; i < nP; i++) { const y0 = yk(finY0 + i * ph), y1 = yk(finY0 + (i + 1) * ph), v = R2(); mods += rect(0, y0, w, y1 - y0, v < .5 ? '#000' : '#fff', `opacity="${f2(.02 + Math.abs(v - .5) * .12)}"`); }
    for (let i = 1; i < nP; i++) mods += rect(0, yk(finY0 + i * ph) - h * .0008, w, h * .0016, '#5a0b28', 'opacity=".55"');
    for (const xx of [1 / 3, 2 / 3]) mods += rect(w * xx - w * .003, 0, w * .006, h, '#6a0d2e', 'opacity=".12"');
    return `<defs>
      <linearGradient id="nfin${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#a8124c"/><stop offset=".07" stop-color="#e2266e"/><stop offset=".5" stop-color="#ff5394"/><stop offset=".93" stop-color="#e2266e"/><stop offset="1" stop-color="#a8124c"/></linearGradient>
      <linearGradient id="nfinV${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".2"/><stop offset=".08" stop-color="#000" stop-opacity="0"/><stop offset=".9" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></linearGradient>
      <filter id="nfinB${id}" x="-30%" y="-10%" width="160%" height="120%"><feGaussianBlur stdDeviation="${w * .035}"/></filter></defs>
      ${rect(0, 0, w, h, `url(#nfin${id})`)}${mods}
      ${rect(0, 0, w, h, `url(#nfinV${id})`)}
      <g filter="url(#nfinB${id})" opacity=".85">${txt.replace(/fill="#fff6fa"/g, 'fill="#ffc6dc"')}</g>${txt}
      ${T(w * .5, yk(28.5), 'NEO', w * .3, "'Inter Display','Inter'", '#fff', 'text-anchor="middle" font-weight="700" letter-spacing="' + (w * .02) + '"')}
      ${T(w * .5, yk(31.6), 'MOTORS', w * .17, "'Inter Display','Inter'", '#fff', 'text-anchor="middle" font-weight="600" letter-spacing="' + (w * .02) + '"')}
      ${rect(w * .3, yk(33.6), w * .4, h * .0012, '#fff', 'opacity=".9"')}
      ${T(w * .5, yk(39.5), '15F', w * .26, "'Inter Display','Inter'", '#fff', 'text-anchor="middle" font-weight="700"')}
      ${rect(0, 0, w * .035, h, '#24060f')}${rect(w * .965, 0, w * .035, h, '#3a0a1c')}`;
  }
  panel({ z: 180, clip: [], svg: () => {
    let s = '';
    // the blade as a real box (only camera-facing faces are drawn by solid()): outer edge cap + underside + flank base
    const u0 = xf / Wm, u1 = (xf + ft) / Wm, v0 = finY0 / Hm, v1 = finY1 / Hm, k0 = -df / Wm;
    const edgeG = glin([xf, finY0, -df], [xf + ft, finY0, -df], [[0, '#5a1a32'], [.2, '#2c1d25'], [.7, '#211c23'], [1, '#151318']], [0, 1, 0]);
    s += solid(F, u0, v0, u1, v1, k0, 0, { front: edgeG, bottom: '#0b090b', left: '#7a1038', right: '#0c0b0d', top: '#0c0b0d' });
    // cap: vertical seam, panel joints matching the face, street light catching its lower part
    const nP = 23, ph = (finY1 - finY0) / nP;
    s += line3([xf + ft * .55, finY0, -df - .01], [xf + ft * .55, finY1, -df - .01], '#000', .35, 'opacity=".5"');
    for (let i = 1; i < nP; i++) s += line3([xf, finY0 + i * ph, -df - .01], [xf + ft, finY0 + i * ph, -df - .01], '#000', .3, 'opacity=".55"');
    s += poly([[xf, 40, -df - .01], [xf + ft, 40, -df - .01], [xf + ft, finY1, -df - .01], [xf, finY1, -df - .01]], glin([xf, 40, -df], [xf, finY1, -df], [[0, '#8a96aa', 0], [1, '#8a96aa', .12]]), 'style="mix-blend-mode:screen"');
    // lit corner: the diffuser wraps a few cm round the edge
    s += line3([xf + .03, finY0, -df - .01], [xf + .03, finY1, -df - .01], '#ff7aac', .45, 'opacity=".75"');
    // contact shadow where the blade meets the facade
    s += line3([xf, finY0, -.05], [xf, finY1, -.05], '#000', .8, 'opacity=".6"');
    return GRAD.flush() + clipPts(above, s);
  } });
  panel({ z: 180, quad: [P(xf, finY0, 0), P(xf, finY0, -df), P(xf, finY1, -df), P(xf, finY1, 0)], w: 120, h: Math.round(120 * (finY1 - finY0) / df), clip: [pd(above)], svg: (w, h) => finFace(w, h, 'f') });

  // ---------------- foreground: terrace railing, lamp post, a person (from the photo) ----------------
  panel({ z: 180, clip: [], svg: () => {
    const Lr = x => 1936 + (x - 440) * .39;            // top-rail line traced from the photo
    const vv = [760.9, -1932.5];                        // vertical vanishing point
    const x0 = 440, x1 = 660;
    let s = '';
    const rail = (dy, w, col = '#08090b') => `<line x1="${x0}" y1="${f2(Lr(x0) + dy)}" x2="${x1}" y2="${f2(Lr(x1) + dy)}" stroke="${col}" stroke-width="${w}"/>`;
    // person standing at the rail (behind the rails)
    const pc = [552.6, 1964.4];
    s += `<g fill="#0b0b0d"><ellipse cx="${pc[0]}" cy="${pc[1]}" rx="3.5" ry="3.9"/>
      <path d="M549.6 1967.5 L555.6 1967.6 L556.4 1970.6 L560.8 1972.6 L561.6 1978 L562 2006 L540.6 2006 L541 1978 L542.6 1972.2 L548.6 1970.4 Z"/></g>`;
    s += rail(.9, 1.5) + rail(13, .8) + rail(17.2, .8);
    for (const xb of [449, 484.7, 501.8, 532, 561, 581, 600.5, 619.5, 638]) {
      const yb = parY(xb) + 1, yt = Lr(xb) + .5;
      const t = (yb - yt) / (yb - vv[1]);
      s += `<line x1="${xb}" y1="${f2(yb)}" x2="${f2(xb + (vv[0] - xb) * t)}" y2="${f2(yt)}" stroke="#08090b" stroke-width="1.1"/>`;
    }
    // lamp post with its cold-white luminaire (traced from the photo: disc seen from below, pole lit near the top)
    s += `<defs><linearGradient id="nlampP" gradientUnits="userSpaceOnUse" x1="513" y1="1918" x2="508.6" y2="1962"><stop offset="0" stop-color="#9a9a92"/><stop offset=".35" stop-color="#55544f"/><stop offset=".7" stop-color="#1c1c1e"/><stop offset="1" stop-color="#3a3a38"/></linearGradient></defs>
      <line x1="508.6" y1="1962" x2="513.1" y2="1917" stroke="url(#nlampP)" stroke-width="1.5"/><circle cx="508.5" cy="1960.6" r="1.2" fill="#b8bcc4"/>
      <ellipse cx="516.8" cy="1914.4" rx="10" ry="4.3" fill="#202226"/>
      <ellipse cx="516.9" cy="1915.1" rx="9.4" ry="3.7" fill="#eef4ff"/><ellipse cx="517.2" cy="1915.2" rx="6.6" ry="2.4" fill="#ffffff"/>`;
    // warm wall light at the foot of the terrace
    s += `<ellipse cx="481" cy="1957" rx="5" ry="6" fill="#ffd9a0" opacity=".55" filter="url(#b2)"/><rect x="479" y="1953" width="3.4" height="6" fill="#fff1d2"/>`;
    // only where our showroom replaced the photo
    const reg = [pd([P(0, yc, 0), P(xf + 3, yc, 0), P(xf + 3, Hm + 3, 0), P(0, Hm + 3, 0)]), pd([P(xf, finY0, 0), P(xf, finY0, -df), P(xf, finY1, -df), P(xf, finY1, 0)])];
    const id = 'nfg' + (GRAD.n++);
    GRAD.list.push(`<clipPath id="${id}" clipPathUnits="userSpaceOnUse">${reg.map(d => `<path d="${d}"/>`).join('')}</clipPath>`);
    return GRAD.flush() + `<g clip-path="url(#${id})">${s}</g>`;
  } });
})();
