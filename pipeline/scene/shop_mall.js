// shop_mall.js — S5 "Mall with a lot of cyber punk windows", built as real 3-D through the solved camera.
// One building corner: front facade (plane A) with stacked shop floors, upper facade + fascia band and the
// side face (plane B), a projecting mint LED corner column, and three recessed round neon portholes.
(() => {
  const NEONS = ['#ff3d9a', '#2ef2ff', '#ffb347', '#b56cff', '#3dff8e', '#ff3b3b', '#ffe14a'];
  const KANA = ['服', '寿司', 'BAR', '薬', 'ゲーム', 'VR', '酒', 'ネイル', '本', 'ロボ', '茶', 'カフェ', '電気', '靴'];
  const LIGHTS = ['#fff1d6', '#ffe2b8', '#e8f2ff', '#fff8ee'];
  const CONC = '#141517', CONC2 = '#101113';

  // emissive text placed on a face of the frame (u,v box at depth k), perspective-correct via a homography
  function faceText(F, u0, v0, u1, v1, k, txt, col, fontPx, font = "'IPAGothic'", weight = '400') {
    const q = [F.N(u0, v0, k), F.N(u1, v0, k), F.N(u1, v1, k), F.N(u0, v1, k)];
    const w = 100, h = 100 * Math.max(.2, (Math.hypot(q[3][0] - q[0][0], q[3][1] - q[0][1])) / Math.max(1, Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1])));
    const Hm = homography(q, w, h);
    // SVG matrix() is affine only; approximate the (small) face with its affine part at the face centre
    const a = Hm[0], b = Hm[1], c = Hm[2], d = Hm[3], e = Hm[4], f = Hm[5];
    return `<g transform="matrix(${a} ${d} ${b} ${e} ${c} ${f})"><text x="${w / 2}" y="${h * .78}" font-size="${h * .8}" font-family="${font}" font-weight="${weight}" fill="${col}" text-anchor="middle" textLength="${w * .9}" lengthAdjust="spacingAndGlyphs">${esc(txt)}</text></g>`;
  }
  const glowPoly = (F, uvk, col, op = .6) => npoly(F, uvk, col, `opacity="${op}" filter="url(#b2)"`) + npoly(F, uvk, col);

  // ---------- front facade: 9 storeys x 3 shop bays ----------
  panel({ z: 126, clip: [], svg: () => {
    const F = Frame('mallfront');
    _seed = 905;
    const rows = 9, cols = 3, K = .32;
    let s = '', holes = [], extras = '';
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const u0 = (c + .06) / cols, u1 = (c + .94) / cols, v0 = (r + .2) / rows, v1 = (r + .96) / rows;
      holes.push([u0, v0, u1, v1]);
      const col = pick(NEONS), L = pick(LIGHTS), dark = rnd() < .1;
      s += room(F, u0, v0, u1, v1, K, {
        ceil: dark ? '#0c0c0e' : '#3a3836', wall: dark ? '#0a0a0c' : mix('#2a2628', col, .18), back: dark ? '#070708' : mix('#1c1a1c', col, .25),
        light: dark ? '#3a3a40' : L, lights: dark ? 0 : 2 + (rnd() < .5 ? 1 : 0), jamb: .03, jambCol: '#1a1b1d', ao: 1.2,
        inside: (F_, bx) => {
          if (dark) return '';
          let t = '';
          const w = bx.u1 - bx.u0, h = bx.v1 - bx.v0;
          // shelving / display racks against the back wall, lit product rows
          for (let i = 0; i < 4; i++) {
            const a = bx.u0 + w * (.08 + i * .23), b2 = a + w * .17;
            t += solid(F_, a, bx.v0 + h * .45, b2, bx.v1, K * .78, K * .95, { all: '#141316', front: '#1d1b20', bottom: '#0b0b0c' });
            for (let j = 0; j < 3; j++) t += npoly(F_, [[a + w * .01, bx.v0 + h * (.5 + j * .16), K * .78], [b2 - w * .01, bx.v0 + h * (.5 + j * .16), K * .78], [b2 - w * .01, bx.v0 + h * (.53 + j * .16), K * .78], [a + w * .01, bx.v0 + h * (.53 + j * .16), K * .78]], pick([col, '#ffffff', '#ffd27a', '#7ad8ff']), 'opacity=".7"');
          }
          // hanging signboard under the ceiling (we see its underside and front)
          const sa = bx.u0 + w * (.25 + rnd() * .3);
          t += solid(F_, sa, bx.v0 + h * .06, sa + w * .28, bx.v0 + h * .2, K * .35, K * .38, { front: col, bottom: shade(col, .45), all: shade(col, .6) });
          // a few shoppers standing near the glass
          for (let p = 0; p < 2; p++) if (rnd() < .6) {
            const sp = spriteAt(F_, bx.u0 + w * (.2 + rnd() * .6), bx.v1 - .002, K * (.12 + rnd() * .2), h * .48);
            t += `<g transform="${sp.tf}">${person(0, 0, 100 / 11.5, '#0a0a0c')}</g>`;
          }
          return t;
        },
      });
      // projecting illuminated blade/box sign above some shopfronts (underside visible from below)
      if (rnd() < .55) {
        const su = u0 + (u1 - u0) * (.05 + rnd() * .5), sw = (u1 - u0) * .42;
        extras += solid(F, su, v0 - .05 / rows, su + sw, v0 + .08 / rows, -.07, 0, { front: '#0b0a0d', bottom: shade(col, .35), left: '#0c0b0e', right: '#0c0b0e', top: '#0c0b0e' });
        extras += glowPoly(F, [[su + sw * .06, v0 - .035 / rows, -.07], [su + sw * .94, v0 - .035 / rows, -.07], [su + sw * .94, v0 + .065 / rows, -.07], [su + sw * .06, v0 + .065 / rows, -.07]], col, .5);
        extras += faceText(F, su + sw * .1, v0 - .03 / rows, su + sw * .9, v0 + .06 / rows, -.071, pick(KANA), '#ffffff', 0);
      }
    }
    // facade: dark concrete with the openings, slab edges catching a little spill
    s += facadeWithHoles(F, holes, CONC);
    for (let r = 0; r <= rows; r++) s += solid(F, 0, (r + .14) / rows, 1, (r + .2) / rows, -.025, 0, { front: '#1c1d20', bottom: '#0b0c0d', left: '#111214', right: '#111214', top: '#111214' });
    s += extras;
    return GRAD.flush() + s;
  } });

  // ---------- upper facade (plane B) with rows of lit windows ----------
  panel({ z: 125, clip: [], svg: () => {
    const F = Frame('mallupper');
    _seed = 77;
    let s = '', holes = [];
    const rows = 4, cols = 7;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const u0 = (c + .12) / cols, u1 = (c + .88) / cols, v0 = (r + .18) / rows, v1 = (r + .82) / rows;
      holes.push([u0, v0, u1, v1]);
      const on = rnd() < .75;
      s += room(F, u0, v0, u1, v1, .18, { light: on ? pick(LIGHTS) : '#202024', lights: on ? 1 : 0, ceil: on ? '#3a3632' : '#0c0c0e', wall: on ? '#2a2624' : '#0a0a0c', back: on ? mix('#1e1c1c', pick(NEONS), .2) : '#070708', jamb: .02, jambCol: '#1a1b1d' });
    }
    s += facadeWithHoles(F, holes, CONC2);
    return GRAD.flush() + s;
  } });

  // ---------- side face (plane B), narrow shop column ----------
  panel({ z: 124, clip: [], svg: () => {
    const F = Frame('mallside');
    _seed = 31;
    let s = '', holes = [];
    for (let r = 0; r < 9; r++) {
      const v0 = (r + .2) / 9, v1 = (r + .92) / 9;
      holes.push([.12, v0, .88, v1]);
      s += room(F, .12, v0, .88, v1, .9, { light: pick(LIGHTS), lights: 2, ceil: '#38342f', wall: mix('#24201f', pick(NEONS), .2), back: '#151314', jamb: .1, jambCol: '#17181a' });
    }
    s += facadeWithHoles(F, holes, '#0d0e10');
    return GRAD.flush() + s;
  } });

  // ---------- green fascia band (plane B) with depth: a lit sign box ----------
  panel({ z: 158, clip: [], svg: () => {
    const F = Frame('mallband');
    let s = solid(F, 0, 0, 1, 1, -.02, 0, { front: '#06261a', bottom: '#020e09', left: '#041a11', right: '#041a11', top: '#041a11' });
    return GRAD.flush() + s;
  } });
  panel({ z: 158.5, sg: 'mallband', svg: (w, h) => `
    ${rect(0, 0, w, h, '#06301f')}
    ${NEON((f, s2, sw) => T(w / 2, h * .74, 'MEGA MALL 3000 · 百貨店', h * .62, "'Inter'", f, `text-anchor="middle" font-weight="800" stroke="${s2}" stroke-width="${sw * h / 70}"`), '#3dffb0', '#e6fff4', 2, 1)}
    ${screen(w, h, { mod: h, seamOp: .15 })}` });

  // ---------- mint LED corner column: a real projecting light column ----------
  panel({ z: 122, clip: [], svg: () => {
    const F = Frame('mallmint');
    let s = solid(F, .08, 0, .92, 1, -.6, 0, { front: '#5affc8', left: '#1d6a52', right: '#239070', bottom: '#0f3a2c', top: '#0f3a2c' });
    s += npoly(F, [[.3, 0, -.6], [.7, 0, -.6], [.7, 1, -.6], [.3, 1, -.6]], '#f0fff9', 'opacity=".75"');
    for (let i = 1; i < 12; i++) s += npoly(F, [[.08, i / 12, -.601], [.92, i / 12, -.601], [.92, i / 12 + .004, -.601], [.08, i / 12 + .004, -.601]], '#0c4a38', 'opacity=".6"');
    return GRAD.flush() + s;
  } });
  panel({ z: 122.5, sg: 'mallmint', clip: [], svg: (w, h) => `${VT(w / 2, h * .05, 'モール', w * .55, "'IPAGothic'", '#073a2a', 'font-weight="700"', 1.12)}` , opacity: .85 });

  // ---------- three recessed round neon portholes ----------
  panel({ z: 177, clip: [], svg: () => [177, 178, 179].map(id => {
    const d = B[id];
    const gid = 'ph' + id;
    return `<defs><radialGradient id="${gid}" cx=".55" cy=".35" r=".7"><stop offset="0" stop-color="#ff9ab0" stop-opacity=".9"/><stop offset=".35" stop-color="#7a1028"/><stop offset="1" stop-color="#14030a"/></radialGradient></defs>
      <path d="${d}" fill="url(#${gid})"/><path d="${d}" fill="#000" opacity=".35" transform="translate(.6 .6)"/>
      ${neonTube(d, '#ff2a4a', .9)}`;
  }).join('') });
})();
