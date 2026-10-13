// shop_mech.js — shop module (owned by one builder). Uses helpers from engine.js, panels2.js and depth.js.
// =====================================================================
// S6 — HUGE mechanical shop: a heavy-mech repair hall in the megastructure.
// Everything is real 3-D geometry in the facade frame of SG.mech (x right, y DOWN, z INTO the building,
// metres, origin = facade rect top-left; 1 world unit = 800 m so the facade is ~70 m x 93 m) and is
// rendered per pixel through the solved camera by a small ray tracer: point / area / line lights with
// shadow rays, ambient occlusion, interior-mapped office windows, glass, and hall haze with in-scatter
// from the welding arc. Neon glass (sign letters, the user's two strokes) and spark streaks are SVG on top.
// =====================================================================
(() => {
  const F = Frame('mech');
  const SC = 800;                                  // metres per world unit
  const WM = F.W * SC, HM = F.H * SC;              // facade rect in metres
  const fr = F.f, KK = CAM.K;
  const dt = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const nrm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const PG = (x, y, z = 0) => F.P(F.l + x / SC, F.t + y / SC, z / SC);       // metres -> page px
  const CAMP = [(-dt(fr.X0, fr.eu) - F.l) * SC, (-dt(fr.X0, fr.ev) - F.t) * SC, -dt(fr.X0, fr.nin) * SC];
  const rayDir = (px, py) => {
    const w = [(px - KK[0][2]) / KK[0][0], (py - KK[1][2]) / KK[1][1], 1];
    return nrm([dt(w, fr.eu), dt(w, fr.ev), dt(w, fr.nin)]);
  };

  // ---------------------------------------------------------------- hashing / noise
  const hh = (x, y) => { let n = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const sm = t => t * t * (3 - 2 * t);
  const vn = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), fx = sm(x - xi), fy = sm(y - yi); const a = hh(xi, yi), b = hh(xi + 1, yi), c = hh(xi, yi + 1), d = hh(xi + 1, yi + 1); return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy; };
  const fbm = (x, y) => (vn(x, y) + .5 * vn(x * 2.03 + 7.1, y * 2.03 + 3.3) + .25 * vn(x * 4.1 + 1.7, y * 4.1 + 9.2)) / 1.75;
  let RS = 1;
  const rnd = () => { RS ^= RS << 13; RS ^= RS >>> 17; RS ^= RS << 5; return (RS >>> 0) / 4294967296; };

  // ---------------------------------------------------------------- materials
  const M = {
    CONC: 0, CONCIN: 1, DECK: 2, STEEL: 3, TRUSS: 4, YEL: 5, ARM: 6, ARM2: 7, FRM: 8, VISOR: 9, LAMP: 10, GLASS: 11, WIN: 12,
    PLANK: 13, SCAF: 14, WORK: 15, HAT: 16, CRATE: 17, LED: 18, GIRD: 19, BEACON: 20, TUBEP: 21, TUBEC: 22, CABLE: 23, BACKW: 24,
    RWALL: 25, VEST: 26, SCREEN: 27, ORANGE: 28, LETTERBOX: 29, CAV: 30, CORE: 31, CRIM: 32, LAMPH: 33, BULB: 34,
  };
  const PR = [];
  const LIGHTS = [];
  const prim = (o) => { o.id = PR.length; PR.push(o); return o; };
  const bx = (x0, y0, z0, x1, y1, z1, m, o = {}) => prim(Object.assign({ T: 0, lo: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)], hi: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)], m }, o));
  // oriented box from a centre segment p0->p1 with cross-section half sizes (hw along 'side', hd along the third axis)
  const beam = (p0, p1, hw, hd, m, side = [0, 0, 1], o = {}) => {
    const a0 = nrm(sub(p1, p0)); let a2 = nrm(crs(a0, side)); if (!isFinite(a2[0]) || Math.hypot(...crs(a0, side)) < 1e-6) a2 = nrm(crs(a0, [1, 0, 0]));
    const a1 = crs(a2, a0); const L = Math.hypot(...sub(p1, p0)) / 2;
    return obb(mul(add(p0, p1), .5), [a0, a1, a2], [L, hw, hd], m, o);
  };
  const obb = (c, ax, h, m, o = {}) => {
    const ext = [0, 1, 2].map(i => Math.abs(ax[0][i]) * h[0] + Math.abs(ax[1][i]) * h[1] + Math.abs(ax[2][i]) * h[2]);
    return prim(Object.assign({ T: 1, c, ax, h, lo: sub(c, ext), hi: add(c, ext), m }, o));
  };
  const cyl = (p0, p1, r, m, o = {}) => {
    const a = nrm(sub(p1, p0)), L = Math.hypot(...sub(p1, p0));
    const ext = [0, 1, 2].map(i => r * Math.sqrt(Math.max(0, 1 - a[i] * a[i])));
    return prim(Object.assign({ T: 2, p0, a, L, r, lo: [0, 1, 2].map(i => Math.min(p0[i], p1[i]) - ext[i]), hi: [0, 1, 2].map(i => Math.max(p0[i], p1[i]) + ext[i]), m }, o));
  };
  const sph = (c, r, m, o = {}) => prim(Object.assign({ T: 3, c, r, lo: c.map(v => v - r), hi: c.map(v => v + r), m }, o));

  // ================================================================ GEOMETRY
  const TW = 3.5;                                  // facade wall thickness
  const OX0 = 3.5, OX1 = WM - 3.5, OY0 = 41;       // the hall opening
  const CEIL = 28, FLOOR = 94, BACK = 62, RW = 74, LW = -12;
  const TZ = -1.1, TR = .34;                       // neon tube standoff / radius
  // the user's neon strokes (page points) -> facade plane, snapped to the plane axes
  const toUV = (x, y) => sgInv('mech', x, y);
  const snap = pts => { const out = [pts[0]]; for (let i = 1; i < pts.length; i++) { const [px, py] = out[i - 1], [x, y] = pts[i]; out.push(Math.abs(x - px) > Math.abs(y - py) ? [x, py] : [px, y]); } return out; };
  const toM = pts => pts.map(([u, v]) => [u * WM, v * HM]);
  const clipPoly = (pts, x0, y0, x1, y1) => {   // axis-aligned polyline clipped to a rect
    const segs = [];
    for (let i = 1; i < pts.length; i++) {
      let [ax, ay] = pts[i - 1], [bx_, by] = pts[i];
      const cx0 = Math.max(Math.min(ax, bx_), x0), cx1 = Math.min(Math.max(ax, bx_), x1), cy0 = Math.max(Math.min(ay, by), y0), cy1 = Math.min(Math.max(ay, by), y1);
      if (cx0 > cx1 || cy0 > cy1) continue;
      const fx = v => Math.max(x0, Math.min(x1, v)), fy = v => Math.max(y0, Math.min(y1, v));
      segs.push([[fx(ax), fy(ay)], [fx(bx_), fy(by)]]);
    }
    const out = []; for (const [a, b] of segs) { if (!out.length) out.push(a); out.push(b); } return out;
  };
  const ZIG = clipPoly(toM(snap([[-0.3, 1480.5], [118.6, 1558], [75.6, 1657.7], [237.5, 1735.4], [204.6, 1895]].map(p => toUV(...p)))), 1, .9, WM - 1.2, HM - 1);
  const ELL = clipPoly(toM(snap([[78, 1562], [36, 1690], [214, 1771]].map(p => toUV(...p)))), 1, .9, WM - 1.2, HM - 1);
  const yCy = ELL.length > 1 ? ELL[1][1] : 53;     // cyan horizontal run -> transfer girder height
  const GY0 = yCy - 2.6, GY1 = yCy + 2.4;
  const xCy = ELL[0] ? ELL[0][0] : 21.4;
  console.log('mechdbg', JSON.stringify({ yCy, xCy, GY0, GY1, WM, HM }));

  // ---- facade: storeys above the shop (slab noses + ribbon windows), sign wall, jambs
  for (let s = -3; s <= 1; s++) {
    const y0 = s * 4.6;
    bx(-12, y0, -.55, WM + 12, y0 + 1.0, TW, M.CONC, { slab: 1 });
    bx(-12, y0 + 1.0, 1.2, WM + 12, y0 + 4.6, 1.26, M.WIN, { noSh: 1, st: s });
    for (let x = -1.8; x < WM + 4; x += 3.6) bx(x - .13, y0 + 1.0, 0, x + .13, y0 + 4.6, 1.2, M.STEEL);
  }
  bx(-12, 9.2, -.55, WM + 12, 10.0, TW, M.CONC, { slab: 1 });
  bx(-12, 10.0, 0, WM + 12, OY0, TW, M.CONC);
  bx(-12, OY0, 0, OX0, HM + 30, TW, M.CONC);
  bx(OX1, OY0, 0, WM + 12, HM + 30, TW, M.CONC);
  // clerestory: glass + steel mullions/transom
  bx(OX0, OY0, 1.0, OX1, GY0, 1.06, M.GLASS, { noSh: 1, glass: 1 });
  for (let x = xCy - 7.15 * 3; x < OX1; x += 7.15) if (x > OX0 + .5) bx(x - .28, OY0, .15, x + .28, GY0, 1.9, M.STEEL);
  bx(OX0, (OY0 + GY0) / 2 - .25, .15, OX1, (OY0 + GY0) / 2 + .25, 1.9, M.STEEL);
  // transfer girder across the opening (cyan tube rides on it); stiffener plates on its underside
  bx(OX0, GY0, -.3, OX1, GY1, TW + .4, M.GIRD);
  for (let x = OX0 + 3; x < OX1; x += 3.2) bx(x - .12, GY1, -.2, x + .12, GY1 + .5, TW + .3, M.GIRD);
  bx(OX0, GY1 + .5, 1.6, OX1, GY1 + .9, 2.0, M.STEEL);                          // door track
  // neon sign raceway rails (letters themselves are SVG, at z = -2)
  bx(36.6, 21.6, -1.85, 68.8, 22.2, 0, M.STEEL); bx(36.6, 31.2, -1.85, 68.8, 31.7, 0, M.STEEL);
  for (const x of [38, 46, 54, 62, 68]) { bx(x - .15, 21.6, -1.85, x + .15, 22.2, 0, M.STEEL); }
  // left light-box sign (face drawn as SVG at z = -1.25)
  bx(5.2, 12.0, -1.2, 17.6, 35.5, 0, M.LETTERBOX);

  // ---- neon tubes (twin glass tubes on stand-off brackets, electrode housings at the ends)
  const TUBES = [];
  const offsetPoly = (pts, off) => {                // offset an axis-aligned polyline sideways (in-plane)
    const segN = []; for (let i = 1; i < pts.length; i++) { const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1], l = Math.hypot(dx, dy) || 1; segN.push([-dy / l, dx / l]); }
    return pts.map((p, i) => { const a = segN[Math.max(0, i - 1)], b = segN[Math.min(segN.length - 1, i)]; return [p[0] + (a[0] + b[0] - (a[0] * b[0] + a[1] * b[1] > .5 ? a[0] : 0)) * off, p[1] + (a[1] + b[1] - (a[0] * b[0] + a[1] * b[1] > .5 ? a[1] : 0)) * off]; });
  };
  for (const [pts, mat, col] of [[ZIG, M.TUBEP, [0.75, 0.38, 1.0]], [ELL, M.TUBEC, [0.25, 0.95, 1.0]]]) {
    if (pts.length < 2) continue;
    for (const off of [-.48, .48]) {
      const q = offsetPoly(pts, off);
      TUBES.push({ pts: q, col, mat });
      for (let i = 1; i < q.length; i++) cyl([q[i - 1][0], q[i - 1][1], TZ], [q[i][0], q[i][1], TZ], TR, mat, { tube: 1 });
      for (let i = 1; i < q.length - 1; i++) sph([q[i][0], q[i][1], TZ], TR, mat, { tube: 1 });
    }
    // brackets + electrode housings
    for (let i = 1; i < pts.length; i++) {
      const [a, b] = [pts[i - 1], pts[i]], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(L / 5.5));
      for (let j = 0; j <= n; j++) { const t = (j + .5) / (n + 1), x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t; const hor = Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]); bx(x - (hor ? .1 : .7), y - (hor ? .7 : .1), TZ, x + (hor ? .1 : .7), y + (hor ? .7 : .1), 0, M.STEEL); }
    }
    for (const [e, f] of [[pts[0], pts[1]], [pts[pts.length - 1], pts[pts.length - 2]]]) {
      const d = nrm([f[0] - e[0], f[1] - e[1], 0]);
      cyl([e[0] - d[0] * .9, e[1] - d[1] * .9, TZ], [e[0] + d[0] * .5, e[1] + d[1] * .5, TZ], .78, M.STEEL);
    }
  }

  // ---- the hall box
  bx(LW - 2, CEIL - 3, TW, RW + 2, CEIL, BACK + 2, M.DECK);
  bx(LW - 2, CEIL - 3, BACK, RW + 2, FLOOR + 2, BACK + 2, M.BACKW);
  bx(RW, CEIL - 3, TW, RW + 2, FLOOR + 2, BACK, M.RWALL);
  bx(LW - 2, CEIL - 3, TW, LW, FLOOR + 2, BACK, M.CONCIN);
  bx(LW, FLOOR, TW, RW, FLOOR + 2, BACK, M.CONCIN);
  // pilasters, corbels and crane runways along the walls (the bridge must clear the mech's crest)
  const RY = 35.3;                                 // runway rail top
  for (let zc = TW + 7.5; zc < BACK; zc += 7.5) {
    bx(RW - 1.6, CEIL, zc - 1, RW, FLOOR, zc + 1, M.CONCIN);
    bx(RW - 3.4, RY + 2.2, zc - 1, RW - 1.6, RY + 4.0, zc + 1, M.CONCIN);
    bx(LW + 1.6, RY + 2.2, zc - 1, LW + 3.4, RY + 4.0, zc + 1, M.CONCIN);
  }
  bx(RW - 3.4, RY, TW, RW - 1.7, RY + 2.2, BACK, M.GIRD);
  bx(LW + 1.7, RY, TW, LW + 3.4, RY + 2.2, BACK, M.GIRD);
  // services along the right wall: big pipes + cable tray
  cyl([RW - .9, RY + 5.2, TW], [RW - .9, RY + 5.2, BACK], .75, M.STEEL);
  cyl([RW - 2.6, RY + 5.6, TW], [RW - 2.6, RY + 5.6, BACK], .5, M.ORANGE);
  bx(RW - 3.6, RY + 7.4, TW, RW - 1.8, RY + 7.7, BACK, M.STEEL);
  // roof trusses (4.5 m deep), purlins
  for (let i = 0; i < 8; i++) {
    const zt = TW + 3.75 + 7.5 * i;
    bx(LW, CEIL + 3.9, zt - .3, RW, CEIL + 4.5, zt + .3, M.TRUSS);
    bx(LW, CEIL, zt - .3, RW, CEIL + .6, zt + .3, M.TRUSS);
    for (let x = LW; x < RW; x += 6) {
      bx(x - .18, CEIL + .6, zt - .18, x + .18, CEIL + 3.9, zt + .18, M.TRUSS);
      const flip = ((x - LW) / 6) % 2;
      beam([x + (flip ? 6 : 0), CEIL + 3.9, zt], [x + (flip ? 0 : 6), CEIL + .6, zt], .14, .14, M.TRUSS, [0, 0, 1]);
    }
  }
  for (let x = LW + 3; x < RW; x += 6) bx(x - .15, CEIL, TW, x + .15, CEIL + .9, BACK, M.TRUSS);
  // high-bay lamps between the trusses (rows seen from below as bright lenses)
  const HB = [1.0, 0.84, 0.64];
  for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) {
    const zl = TW + 7.5 * (i + 1), xl = -6 + 12 * j * .965 + (i % 2) * 1.2;
    if (hh(i * 7 + 3, j * 5 + 1) < .06) continue;                                   // a dead lamp or two
    cyl([xl, CEIL + .6, zl], [xl, CEIL + 3.4, zl], .05, M.CABLE);
    cyl([xl, CEIL + 3.4, zl], [xl, CEIL + 4.3, zl], .85, M.LAMP, { lamp: 1 });
    LIGHTS.push({ p: [xl, CEIL + 4.7, zl], c: mul(HB, 380), spot: [0, 1, 0], pw: 1.6, amb: .008, sh: 1, zn: 1, rad: .5 });
  }

  // ---- overhead travelling crane (yellow) running above the mech's head, trolley, hook, a pauldron hanging from it
  const CZ = 24, TX = 61, CY = RY - 1.3;          // CY = bridge girder top
  bx(LW + 2.5, CY, CZ - 3, RW - 2.5, CY + 3.1, CZ - 1.5, M.YEL);
  bx(LW + 2.5, CY, CZ + 1.5, RW - 2.5, CY + 3.1, CZ + 3, M.YEL);
  bx(RW - 5.4, CY - .2, CZ - 4.2, RW - 2.2, RY, CZ + 4.2, M.YEL);
  bx(LW + 2.2, CY - .2, CZ - 4.2, LW + 5.4, RY, CZ + 4.2, M.YEL);
  for (let x = LW + 6; x < RW - 6; x += 2.6) bx(x - .08, CY + 3.1, CZ - 3, x + .08, CY + 3.25, CZ - 1.5, M.STEEL);
  bx(TX - 3, CY - 1.2, CZ - 3.4, TX + 3, CY, CZ + 3.4, M.YEL);
  cyl([TX - 2.4, CY + 1.2, CZ], [TX + 2.4, CY + 1.2, CZ], 1.15, M.STEEL);
  sph([TX + 2.7, CY - 1.5, CZ - 3], .32, M.BEACON);
  const HY = 45.5;                                  // hook block
  for (const dx of [-.55, .55]) cyl([TX + dx, CY + 1.4, CZ - .4], [TX + dx, HY, CZ - .4], .07, M.CABLE);
  bx(TX - 1.5, HY, CZ - 1.3, TX + 1.5, HY + 2.7, CZ + .7, M.YEL);
  cyl([TX, HY + 2.7, CZ - .3], [TX, HY + 3.9, CZ - .3], .3, M.STEEL);
  // pauldron (removed right-shoulder armour) on four chains
  const PL = { c: [TX, HY + 8.7, CZ - .3], h: [4.3, 2.6, 4.6] };
  const pAx = [nrm([1, .12, 0]), nrm([-.12, 1, .05]), [0, 0, 1]]; pAx[2] = nrm(crs(pAx[0], pAx[1]));
  obb(PL.c, pAx, PL.h, M.ARM, { mk: 2 });
  obb(add(PL.c, mul(pAx[1], 2.4)), pAx, [3.6, .5, 3.9], M.FRM);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) cyl([TX, HY + 3.9, CZ - .3], add(PL.c, add(mul(pAx[0], sx * 3.6), add(mul(pAx[1], -2.6), mul(pAx[2], sz * 3.8)))), .07, M.CABLE);

  // ---- the mech (≈54 m tall), standing at x≈39, z≈33, facing the street (-z)
  const MX = 44, MZ = 33;
  const rotV = (v, rx, ry, rz) => {
    let [x, y, z] = v, c = Math.cos(rx), s = Math.sin(rx);
    [y, z] = [y * c - z * s, y * s + z * c];
    c = Math.cos(ry); s = Math.sin(ry); [x, z] = [x * c + z * s, -x * s + z * c];
    c = Math.cos(rz); s = Math.sin(rz); [x, y] = [x * c - y * s, x * s + y * c];
    return [x, y, z];
  };
  const ob = (c, h, m, rx = 0, ry = 0, rz = 0, o = {}) => obb(c, [rotV([1, 0, 0], rx, ry, rz), rotV([0, 1, 0], rx, ry, rz), rotV([0, 0, 1], rx, ry, rz)], h, m, o);
  // legs (mostly below the visible window) + pelvis + skirt armour
  cyl([MX - 4.2, 75, MZ], [MX - 5, 93, MZ - 1.5], 3.4, M.FRM); cyl([MX + 4.2, 75, MZ], [MX + 5, 93, MZ - 1.5], 3.4, M.FRM);
  ob([MX - 5.2, 84, MZ - 1.4], [3.3, 7, 3.6], M.ARM, .08, 0, .04, { mk: 3, paint: 'b' }); ob([MX + 5.2, 84, MZ - 1.4], [3.3, 7, 3.6], M.ARM, .08, 0, -.04, { mk: 3, paint: 'b' });
  bx(MX - 6, 70, MZ - 3.5, MX + 6, 76.5, MZ + 3.5, M.FRM);                        // pelvis block
  ob([MX, 73.6, MZ - 4.4], [3.2, 3.4, .55], M.ARM, -.18, 0, 0, { mk: 3 });       // front codpiece plate
  ob([MX - 7.3, 73.4, MZ - .6], [.6, 3.8, 3.9], M.ARM, 0, 0, .16, { mk: 3 });    // side skirts, flared
  ob([MX + 7.3, 73.4, MZ - .6], [.6, 3.8, 3.9], M.ARM, 0, 0, -.16, { mk: 3 });
  cyl([MX, 63, MZ], [MX, 71, MZ], 3.9, M.FRM);                                    // waist
  for (let i = 0; i < 3; i++) ob([MX, 62.6 + i * 2.25, MZ - 1.1 + i * .35], [5.6 - i * .55, .95, 4.6 - i * .3], M.ARM2, -.06, 0, 0);  // abdomen plates (layered, seen from below)
  // chest: core block + two V-shaped pectoral plates + an open maintenance hatch
  bx(MX - 8.4, 49.8, MZ - 5.4, MX + 8.4, 61.2, MZ + 5.4, M.ARM, { mk: 1, paint: 'b' });
  ob([MX - 4.7, 52.9, MZ - 5.9], [4.5, 3.4, .75], M.ARM, .05, .22, -.1, { mk: 1 });
  ob([MX + 4.7, 52.9, MZ - 5.9], [4.5, 3.4, .75], M.ARM, .05, -.22, .1, { mk: 1 });
  ob([MX - 7.7, 59.3, MZ - 5.7], [1.4, 1.6, .5], M.ARM2, 0, .3, 0);             // lower-chest vents
  ob([MX + 7.7, 59.3, MZ - 5.7], [1.4, 1.6, .5], M.ARM2, 0, -.3, 0);
  bx(MX - 3.5, 56.4, MZ - 5.65, MX + 3.5, 61.0, MZ - 5.45, M.CAV);               // hatch opening (cavity)
  for (const dx of [-2.6, -1.3, 0, 1.3, 2.6]) cyl([MX + dx, 56.6, MZ - 5.5], [MX + dx * .7, 60.8, MZ - 6.0], .17, (dx === 0 ? M.ORANGE : M.CABLE));
  sph([MX, 58.8, MZ - 5.55], .9, M.CORE);
  ob([MX, 56.0, MZ - 8.0], [3.7, .28, 2.6], M.ARM, .42, 0, 0, { mk: 6 });       // hatch door, swung up and out
  // collar, neck
  bx(MX - 5.6, 48.6, MZ - 4.4, MX + 5.6, 50.2, MZ + 4.4, M.FRM);
  cyl([MX, 47.2, MZ - .4], [MX, 49.2, MZ - .4], 1.9, M.FRM);
  for (const dx of [-1.6, 1.6]) beam([MX + dx * 1.6, 49.6, MZ - 2], [MX + dx, 46.8, MZ - 1.2], .2, .2, M.STEEL, [1, 0, 0]);
  // head: skull, brow, mono-eye visor, chin mask, cheek guards, ear sensors, V-crest
  ob([MX, 44.7, MZ - .3], [2.6, 2.3, 2.9], M.ARM, 0, 0, 0, { mk: 4 });
  ob([MX, 43.0, MZ - 2.8], [2.8, .55, .75], M.ARM, .35, 0, 0, { mk: 4 });
  ob([MX, 45.05, MZ - 3.25], [2.15, .32, .14], M.VISOR);
  ob([MX, 46.55, MZ - 3.0], [1.9, 1.05, .55], M.ARM2, -.42, 0, 0);
  for (const sx of [-1, 1]) {
    ob([MX + sx * 2.75, 45.6, MZ - 1.4], [.35, 1.55, 1.9], M.ARM2, 0, 0, sx * -.08);
    cyl([MX + sx * 2.7, 44.6, MZ - .2], [MX + sx * 3.5, 44.6, MZ - .2], 1.0, M.FRM);
    beam([MX + sx * .35, 42.9, MZ - 3.25], [MX + sx * 3.9, 39.4, MZ - 3.55], .26, .1, M.YEL, [0, 0, 1]);
  }
  ob([MX, 42.75, MZ - 3.3], [.55, .45, .25], M.CRIM);
  // back pack + thrusters
  bx(MX - 7, 51, MZ + 5.4, MX + 7, 64, MZ + 10.5, M.FRM);
  cyl([MX - 4, 64, MZ + 8], [MX - 4, 67, MZ + 8], 1.8, M.ARM2); cyl([MX + 4, 64, MZ + 8], [MX + 4, 67, MZ + 8], 1.8, M.ARM2);
  // left shoulder: joint + big sloped pauldron (armour on)
  cyl([MX - 8.2, 53.4, MZ], [MX - 11.2, 53.4, MZ], 3.1, M.FRM);
  cyl([MX - 12.6, 52.6, MZ - 5.6], [MX - 12.6, 52.6, MZ + 5.2], 4.3, M.ARM, { mk: 7 });
  ob([MX - 14.2, 55.4, MZ - .2], [3.9, 2.4, 5.7], M.ARM, 0, 0, .32, { mk: 2 });
  ob([MX - 15.0, 57.9, MZ - .2], [4.0, .5, 5.9], M.ARM2, 0, 0, .32);
  // left arm hanging, forearm raised forward, open hand
  cyl([MX - 12.4, 56.5, MZ], [MX - 12.9, 67.5, MZ - .4], 2.4, M.FRM);
  ob([MX - 12.7, 62, MZ - .2], [2.9, 4.2, 3.0], M.ARM, 0, 0, -.03, { mk: 5, paint: 'b' });
  sph([MX - 12.9, 68.6, MZ - .5], 2.6, M.FRM);
  beam([MX - 12.9, 68.6, MZ - .5], [MX - 13.3, 75.4, MZ - 9.6], 2.5, 2.3, M.ARM, [1, 0, 0], { mk: 5 });
  beam([MX - 13.3, 75.4, MZ - 9.6], [MX - 13.5, 77.4, MZ - 12.0], 1.9, 1.4, M.FRM, [1, 0, 0]);
  for (let i = 0; i < 4; i++) beam([MX - 14.8 + i * 1.0, 77.6, MZ - 12.4], [MX - 14.9 + i * 1.05, 79.6, MZ - 13.6], .36, .36, M.FRM, [1, 0, 0]);
  // right shoulder: armour removed (it hangs from the crane), bare joint, actuators, cables, arm hanging
  cyl([MX + 8.4, 53.4, MZ], [MX + 13.2, 53.4, MZ], 3.2, M.FRM);
  cyl([MX + 13.2, 53.4, MZ], [MX + 14.1, 53.4, MZ], 2.3, M.STEEL);
  beam([MX + 9, 50.9, MZ - 3], [MX + 13, 57.2, MZ - 2.5], .45, .45, M.STEEL, [0, 0, 1]);
  beam([MX + 9, 50.9, MZ + 3], [MX + 13, 57.2, MZ + 2.5], .45, .45, M.STEEL, [0, 0, 1]);
  cyl([MX + 13.3, 56.4, MZ], [MX + 13.7, 68.6, MZ + .5], 2.4, M.FRM);
  sph([MX + 13.7, 69.4, MZ + .5], 2.6, M.FRM);
  beam([MX + 13.7, 69.4, MZ + .5], [MX + 14.1, 79.8, MZ - .8], 2.4, 2.3, M.ARM, [1, 0, 0], { mk: 5 });
  beam([MX + 14.1, 79.8, MZ - .8], [MX + 14.2, 83.2, MZ - 1.0], 1.9, 1.5, M.FRM, [1, 0, 0]);
  for (let i = 0; i < 6; i++) cyl([MX + 10.6 + i * .55, 55.6, MZ - 2.2 + i * .9], [MX + 11.2 + i * .75, 61 + i * .9, MZ - 2.8 + i * 1.1], .16, i % 2 ? M.ORANGE : M.CABLE);

  // ---- weld point (worker on scaffold A welding the chest's lower-left corner)
  const WELD = [MX - 6.6, 61.55, MZ - 5.9];
  LIGHTS.push({ p: WELD, c: [5000, 6000, 7800], sh: 1, zn: 1, rad: .08, weld: 1 });
  LIGHTS.push({ p: add(WELD, [0, .1, -.1]), c: [700, 260, 60], sh: 1, zn: 1, rad: .15 });
  // chest core glow (small, warm)
  LIGHTS.push({ p: [MX, 58.8, MZ - 6.8], c: [26, 11, 3], sh: 1, zn: 1, rad: .3 });
  // floor light towers aimed up at the chest (4000 K floods) — they make the long shadows on the ceiling
  for (const [fx, fy, fz, pw] of [[MX - 15, 84, MZ - 22, 1], [MX + 17, 85, MZ - 19, .75]]) {
    const tgt = [MX + (fx < MX ? -3 : 4), 53, MZ - 5], dv = nrm(sub(tgt, [fx, fy, fz]));
    LIGHTS.push({ p: [fx, fy, fz], c: mul([1, .9, .76], 19000 * pw), spot: dv, pw: 7, amb: .015, sh: 1, zn: 1, rad: 1.2, ns: 5 });
    cyl([fx, fy + .8, fz + 1.2], [fx, FLOOR, fz + 1.2], .18, M.STEEL);
    ob(add([fx, fy, fz], mul(dv, -1.2)), [1.4, 1.0, .5], M.LAMPH, 0, 0, 0, { noSh: 1 });
  }

  // ---- workers (tiny: 1.75 m)
  const worker = (x, y, z, o = {}) => {             // y = feet
    const s = o.s || 1, kneel = o.kneel;
    const hip = y - (kneel ? .55 : .9) * s;
    bx(x - .2, hip, z - .12, x + .2, y, z + .14, M.WORK);
    bx(x - .24, hip - .66 * s, z - .15, x + .24, hip, z + .15, o.vest ? M.VEST : M.WORK);
    sph([x, hip - .82 * s, z], .13 * s, M.FRM);
    sph([x, hip - .9 * s, z], .15 * s, M.HAT);
    if (o.arm) beam([x + .2, hip - .55 * s, z], add([x + .2, hip - .55 * s, z], o.arm), .07, .07, M.WORK);
  };
  // ---- scaffold towers with plank decks
  const scaffold = (x0, x1, z0, z1, yTop, decks, col = M.SCAF) => {
    for (const x of [x0, x1]) for (const z of [z0, z1]) bx(x - .18, yTop - 1.2, z - .18, x + .18, FLOOR, z + .18, col);
    for (let y = yTop; y < FLOOR; y += 4.5) {
      bx(x0, y - .12, z0 - .1, x1, y + .12, z0 + .1, col); bx(x0, y - .12, z1 - .1, x1, y + .12, z1 + .1, col);
      bx(x0 - .1, y - .12, z0, x0 + .1, y + .12, z1, col); bx(x1 - .1, y - .12, z0, x1 + .1, y + .12, z1, col);
      bx(x0, y - 1.2, z0 - .08, x1, y - 1.05, z0 + .08, col);                      // guard rail
      if (y + 4.5 < FLOOR) beam([x0, y, z0 - .15], [x1, y + 4.5, z0 - .15], .09, .09, col, [0, 0, 1]);
    }
    for (const y of decks) bx(x0 + .05, y, z0 + .05, x1 - .05, y + .3, z1 - .05, M.PLANK);
  };
  scaffold(MX - 9.6, MX - 3.4, MZ - 10.6, MZ - 6.6, 58.0, [62.5, 71.5, 80.5]);
  scaffold(MX + 3.6, MX + 9.4, MZ - 10.0, MZ - 6.6, 58.0, [62.5, 71.5, 80.5]);
  worker(WELD[0] + .5, 62.5, WELD[2] - 1.1, { arm: [-.4, -.75, .75] });          // welder
  worker(MX - 5.2, 62.5, MZ - 9.4, { vest: 1 });
  worker(MX - 6.6, 62.5, MZ - 8.0, {});
  worker(MX - 7.5, 71.5, MZ - 9.3, { vest: 1 });
  worker(MX + 5.2, 62.5, MZ - 7.4, { arm: [-.3, -.6, .4] });
  worker(MX + 8.1, 62.5, MZ - 8.6, { vest: 1 });
  worker(MX + 6.4, 71.5, MZ - 7.5, {});
  // clip-on work lamps on the scaffold rails
  for (const p of [[MX - 6.5, 61.2, MZ - 10.7], [MX + 6.5, 61.2, MZ - 10.1], [MX + 8.9, 70.2, MZ - 10.1]]) {
    LIGHTS.push({ p, c: [70, 55, 34], sh: 1, zn: 1, rad: .2 });
    sph(p, .22, M.BULB, { noSh: 1 });
  }

  // ---- galleries along the right wall, LED strips under them, racks on the wall
  const LEDC = [0.78, 0.9, 1.0];
  const GAL = [58, 67, 76, 85];
  for (const gy of GAL) {
    bx(RW - 9, gy, 7.5, RW, gy + .8, BACK - 1.5, M.CONCIN, { gal: 1 });
    bx(RW - 9.1, gy - 1.15, 7.5, RW - 8.9, gy - .98, BACK - 1.5, M.STEEL);
    bx(RW - 9.1, gy - .6, 7.5, RW - 8.9, gy - .52, BACK - 1.5, M.STEEL);
    for (let z = 7.5; z < BACK - 1.5; z += 2.4) bx(RW - 9.1, gy - 1.1, z, RW - 8.95, gy, z + .12, M.STEEL);
    for (let z = 9.5; z < BACK - 2.5; z += 7.0) bx(RW - 5.2, gy + .8, z, RW - 4.7, gy + 1.0, z + 1.3, M.LED);
    for (let z = 10.7; z < BACK - 2; z += 7) LIGHTS.push({ p: [RW - 4.9, gy + 1.3, z], c: mul(LEDC, 60), spot: [0, 1, 0], pw: 1.2, amb: .0, sh: 0, zn: 1, rad: 0 });
    // racks / shelving with crates on the wall
    for (let z = 8; z < BACK - 3; z += 1.55) {
      for (let r = 0; r < 2; r++) {
        const yb = gy + 4.5 * (r + 1) - .2; if (yb > FLOOR || hh(z * 7 | 0, gy * 3 + r) < .25) continue;
        const hgt = .9 + hh(z * 3 | 0, gy + r) * 1.1;
        bx(RW - 1.5, yb - hgt, z, RW, yb, z + 1.25, M.CRATE, { ci: hh(z * 13 | 0, gy * 7 + r * 31) });
      }
    }
    worker(RW - 10 + 1.2, gy, 18 + (gy % 9) * 3, { vest: gy % 2 });
  }
  worker(RW - 7.3, 58, 41, {}); worker(RW - 6.4, 67, 33, { vest: 1 }); worker(RW - 7.8, 76, 49, {});

  // ---- other lights
  LIGHTS.push({ p: [TX + 2.7, CY - 1.5, CZ - 3.6], c: [60, 26, 4], sh: 0, zn: 1, rad: 0 });                  // crane beacon
  LIGHTS.push({ p: [MX, 45.4, MZ - 4.2], c: [5, .5, .15], sh: 0, zn: 1, rad: 0 });                           // visor glow
  // neon sign letters (area lights at z = -2, emitting to all sides) — tube shadows fall on the wall
  const SIGNL = [];
  const sgl = (o, ex, ey, c) => SIGNL.push({ o, ex, ey, c, v: [o, add(o, ex), add(add(o, ex), ey), add(o, ey)] });
  for (let i = 0; i < 4; i++) sgl([37.4 + i * 7.85, 17.2, -2.0], [7.0, 0, 0], [0, 7.6, 0], [2.4, 1.0, .16]);
  sgl([37.4, 27.4, -2.0], [31.0, 0, 0], [0, 3.8, 0], [2.6, 1.25, .3]);
  // tube line lights
  const TL = [];
  for (const t of TUBES) for (let i = 1; i < t.pts.length; i++) { const a = t.pts[i - 1], b = t.pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); TL.push({ a, b, L, col: t.col, pw: .55 }); }
  
  // ================================================================ BVH
  function buildBVH(items) {
    const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (const p of items) for (let i = 0; i < 3; i++) { if (p.lo[i] < lo[i]) lo[i] = p.lo[i]; if (p.hi[i] > hi[i]) hi[i] = p.hi[i]; }
    if (items.length <= 3) return { lo, hi, prims: items };
    const cl = [1e9, 1e9, 1e9], ch = [-1e9, -1e9, -1e9];
    for (const p of items) for (let i = 0; i < 3; i++) { const c = (p.lo[i] + p.hi[i]) / 2; if (c < cl[i]) cl[i] = c; if (c > ch[i]) ch[i] = c; }
    let ax = 0; for (let i = 1; i < 3; i++) if (ch[i] - cl[i] > ch[ax] - cl[ax]) ax = i;
    const s = items.slice().sort((a, b) => (a.lo[ax] + a.hi[ax]) - (b.lo[ax] + b.hi[ax]));
    const m = s.length >> 1;
    return { lo, hi, l: buildBVH(s.slice(0, m)), r: buildBVH(s.slice(m)) };
  }
  // big flat room/facade boxes slow the BVH down: keep them in a separate flat list
  const BIG = PR.filter(p => p.T === 0 && (p.hi[0] - p.lo[0]) * (p.hi[1] - p.lo[1]) * (p.hi[2] - p.lo[2]) > 2500);
  const ROOT = buildBVH(PR.filter(p => !BIG.includes(p)));

  const boxT = (lo, hi, o, iv, tmax) => {
    let t0 = 1e-5, t1 = tmax;
    for (let i = 0; i < 3; i++) {
      let a = (lo[i] - o[i]) * iv[i], b = (hi[i] - o[i]) * iv[i];
      if (a > b) { const t = a; a = b; b = t; }
      if (a > t0) t0 = a; if (b < t1) t1 = b;
      if (t0 > t1) return Infinity;
    }
    return t0;
  };
  const OL = [0, 0, 0], DL = [0, 0, 0], IL = [0, 0, 0];
  function hitPrim(p, o, d, iv, tmax) {
    if (p.T === 0) { const t = boxT(p.lo, p.hi, o, iv, tmax); return t > 2e-4 ? t : Infinity; }
    if (p.T === 1) {
      const rx = o[0] - p.c[0], ry = o[1] - p.c[1], rz = o[2] - p.c[2];
      for (let i = 0; i < 3; i++) { const a = p.ax[i]; OL[i] = rx * a[0] + ry * a[1] + rz * a[2]; DL[i] = d[0] * a[0] + d[1] * a[1] + d[2] * a[2]; IL[i] = 1 / (DL[i] || 1e-12); }
      let t0 = 2e-4, t1 = tmax;
      for (let i = 0; i < 3; i++) { let a = (-p.h[i] - OL[i]) * IL[i], b = (p.h[i] - OL[i]) * IL[i]; if (a > b) { const t = a; a = b; b = t; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return Infinity; }
      return t0;
    }
    if (p.T === 2) {
      const a = p.a, ox = o[0] - p.p0[0], oy = o[1] - p.p0[1], oz = o[2] - p.p0[2];
      const da = d[0] * a[0] + d[1] * a[1] + d[2] * a[2], oa = ox * a[0] + oy * a[1] + oz * a[2];
      const dpx = d[0] - a[0] * da, dpy = d[1] - a[1] * da, dpz = d[2] - a[2] * da, opx = ox - a[0] * oa, opy = oy - a[1] * oa, opz = oz - a[2] * oa;
      const A = dpx * dpx + dpy * dpy + dpz * dpz, Bq = 2 * (dpx * opx + dpy * opy + dpz * opz), C = opx * opx + opy * opy + opz * opz - p.r * p.r;
      let best = Infinity;
      if (A > 1e-12) { const D = Bq * Bq - 4 * A * C; if (D >= 0) { const sq = Math.sqrt(D); for (const t of [(-Bq - sq) / (2 * A), (-Bq + sq) / (2 * A)]) if (t > 2e-4 && t < tmax && t < best) { const s = oa + t * da; if (s >= 0 && s <= p.L) best = t; } } }
      if (Math.abs(da) > 1e-9) for (const s0 of [0, p.L]) { const t = (s0 - oa) / da; if (t > 2e-4 && t < tmax && t < best) { const qx = opx + dpx * t, qy = opy + dpy * t, qz = opz + dpz * t; if (qx * qx + qy * qy + qz * qz <= p.r * p.r) best = t; } }
      return best;
    }
    const ox = o[0] - p.c[0], oy = o[1] - p.c[1], oz = o[2] - p.c[2];
    const b = ox * d[0] + oy * d[1] + oz * d[2], c = ox * ox + oy * oy + oz * oz - p.r * p.r, D = b * b - c;
    if (D < 0) return Infinity; const sq = Math.sqrt(D); let t = -b - sq; if (t < 2e-4) t = -b + sq; return t > 2e-4 && t < tmax ? t : Infinity;
  }
  const STK = new Array(128);
  let HT = Infinity, HP = null;
  function trace(o, d, tmax, shadow) {
    const iv = [1 / (d[0] || 1e-12), 1 / (d[1] || 1e-12), 1 / (d[2] || 1e-12)];
    let best = tmax, bp = null;
    for (const p of BIG) { if (shadow && p.noSh) continue; const t = hitPrim(p, o, d, iv, best); if (t < best) { if (shadow) return true; best = t; bp = p; } }
    let sp = 0; STK[sp++] = ROOT;
    while (sp) {
      const n = STK[--sp];
      if (boxT(n.lo, n.hi, o, iv, best) === Infinity) continue;
      if (n.prims) { for (const p of n.prims) { if (shadow && p.noSh) continue; const t = hitPrim(p, o, d, iv, best); if (t < best) { if (shadow) return true; best = t; bp = p; } } }
      else { STK[sp++] = n.r; STK[sp++] = n.l; }
    }
    if (shadow) return false;
    HT = best; HP = bp; return bp;
  }
  function normalAt(p, P) {
    if (p.T === 0 || p.T === 1) {
      let L = P;
      if (p.T === 1) { const r = sub(P, p.c); L = [dt(r, p.ax[0]), dt(r, p.ax[1]), dt(r, p.ax[2])]; }
      const lo = p.T === 0 ? p.lo : p.h.map(v => -v), hi = p.T === 0 ? p.hi : p.h;
      let bi = 0, bs = -1, bd = Infinity;
      for (let i = 0; i < 3; i++) { const a = Math.abs(L[i] - lo[i]), b = Math.abs(L[i] - hi[i]); if (a < bd) { bd = a; bi = i; bs = -1; } if (b < bd) { bd = b; bi = i; bs = 1; } }
      if (p.T === 0) { const n = [0, 0, 0]; n[bi] = bs; return n; }
      return mul(p.ax[bi], bs);
    }
    if (p.T === 2) {
      const r = sub(P, p.p0), s = dt(r, p.a);
      if (s < 1e-3) return mul(p.a, -1); if (s > p.L - 1e-3) return p.a;
      return nrm(sub(r, mul(p.a, s)));
    }
    return nrm(sub(P, p.c));
  }

  // ================================================================ MATERIALS
  // returns {a: albedo, e: emission, ks, sh}
  const crateCols = [[.08, .16, .34], [.5, .2, .04], [.22, .22, .22], [.06, .2, .1], [.42, .36, .08], [.3, .07, .05]];
  const stencil06 = (x, y) => {            // giant painted bay number on the back wall (x,y in metres)
    const X = x - 20, Y = y - 30; if (X < 0 || Y < 0 || Y > 22 || X > 26) return 0;
    const seg = (cx, cy, w, h) => X >= cx && X <= cx + w && Y >= cy && Y <= cy + h;
    const zero = seg(0, 0, 11, 3) || seg(0, 19, 11, 3) || seg(0, 0, 3, 22) || seg(8, 0, 3, 22);
    const six = seg(14, 0, 11, 3) || seg(14, 0, 3, 22) || seg(14, 9.5, 11, 3) || seg(14, 19, 11, 3) || seg(22, 9.5, 3, 12.5);
    return (zero || six) && !(seg(0, 10, 11, 1.2) || seg(14, 5, 3, 1.2)) ? 1 : 0;   // stencil bridges
  };
  function material(p, P, N) {
    const x = P[0], y = P[1], z = P[2];
    const R = { a: [.2, .2, .2], e: null, ks: 0, sh: 20 };
    switch (p.m) {
      case M.CONC: {
        // board-formed concrete: 4.6 x 2.3 m pours, joints, tie holes, rain streaks, grime under slab noses
        const u = Math.abs(N[2]) > .5 ? x : z, v = Math.abs(N[1]) > .5 ? z : y;
        let g = .19 + .07 * (fbm(u * .35, v * .35) - .5) + .05 * (vn(u * 1.7, v * .08) - .5);
        const ju = ((u % 4.6) + 4.6) % 4.6, jv = ((v % 2.3) + 2.3) % 2.3;
        if (ju < .1 || jv < .08) g *= .62;
        const tu = ((u + 1.15) % 2.3 + 2.3) % 2.3, tv = ((v + 1.15) % 2.3 + 2.3) % 2.3;
        if (Math.hypot(tu - 1.15, tv - 1.15) < .1) g *= .45;
        g *= .82 + .18 * vn(u * 2.5, v * .03);                         // vertical rain streaks
        if (p.slab && N[1] > .5) g *= .7;
        R.a = [g * 1.02, g, g * .96]; break;
      }
      case M.CONCIN: {
        let g = .34 + .1 * (fbm(x * .3 + z * .3, y * .3) - .5);
        if (p.gal && N[1] > .5) g *= .75;
        if (y > 86) g *= .7;
        R.a = [g, g * .98, g * .93]; break;
      }
      case M.RWALL: {
        let g = .3 + .1 * (fbm(z * .25, y * .25) - .5);
        if (y > 47 && y < 49.5) { R.a = [.55, .4, .05]; break; }                      // painted band
        // control-room / locker windows at each gallery level (lit from inside)
        for (const gy of GAL) if (y < gy - 1.2 && y > gy - 3.6) { const cz = Math.floor((z - 6) / 6.5), lz = z - 6 - cz * 6.5; if (lz > .6 && lz < 4.2 && hh(cz, gy) < .45) { const warm = hh(cz + 3, gy) < .6; R.e = warm ? [3.2, 2.5, 1.6] : [2.2, 2.6, 3.0]; R.a = [.02, .02, .02]; if (lz < .75 || lz > 4.05 || y > gy - 1.35 || y < gy - 3.45) { R.e = null; R.a = [.06, .06, .065]; } break; } }
        if (R.e || R.a[0] === .06) break;
        if (((z % 3.75) + 3.75) % 3.75 < .08 || ((y % 4.5) + 4.5) % 4.5 < .08) g *= .7;
        R.a = [g * .95, g, g * 1.03]; break;
      }
      case M.BACKW: {
        // corrugated steel cladding: ribs every 0.9 m, girts every 6 m, rain/grime streaks
        let g = .2 + .08 * (fbm(x * .2, y * .2) - .5);
        const rib = ((x % .9) + .9) % .9; g *= rib < .18 ? .78 : rib < .3 ? 1.12 : 1;
        if (((y % 6) + 6) % 6 < .35) g *= .55;
        g *= .75 + .25 * vn(x * .7, y * .04);
        let a = [g * .96, g * .97, g];
        if (stencil06(x, y)) a = mul([.58, .43, .07], .75 + .25 * vn(x * 1.3, y * 1.3));
        if (y > 85.5 && y < 88) a = (((x + y) % 2.4) + 2.4) % 2.4 < 1.2 ? [.6, .45, .05] : [.04, .04, .04];
        if (x > 40 && x < 66 && y > 66 && y < 94) {                                    // huge roller door
          const rr = ((y % .9) + .9) % .9 < .12; a = rr ? [.12, .13, .14] : [.24, .26, .28];
          if (x < 40.6 || x > 65.4) a = [.08, .08, .08];
        }
        R.a = a; break;
      }
      case M.DECK: { const r = .5 + .5 * Math.cos(x * Math.PI * 2 / 1.2); const g = .13 + .05 * r + .04 * (vn(x * .2, z * .2) - .5); R.a = [g, g, g * 1.04]; R.ks = .1; break; }
      case M.STEEL: R.a = [.07, .072, .075]; R.ks = .25; R.sh = 30; break;
      case M.TRUSS: R.a = [.36, .37, .38]; R.ks = .15; break;
      case M.CABLE: R.a = [.05, .05, .05]; break;
      case M.GIRD: { let g = .1 + .04 * (vn(x * .5, z * .5 + y) - .5); if (((x % 3.2) + 3.2) % 3.2 < .1) g *= .6; R.a = [g, g * 1.02, g * 1.06]; R.ks = .2; break; }
      case M.YEL: {
        let a = [.46, .31, .03];
        if ((x < LW + 9 || x > RW - 9) && (((x + y + z) % 2) + 2) % 2 < 1) a = [.04, .04, .04];
        a = mul(a, .85 + .3 * (vn(x * .6, z * .6 + y) - .5)); R.a = a; R.ks = .2; R.sh = 25; break;
      }
      case M.ARM: {
        // off-white armour with panel lines, grime, orange markings (OBBs use their local frame)
        let Lx = x, Ly = y, Lz = z, Ln = N;
        if (p.T === 1) { const r = sub(P, p.c); Lx = dt(r, p.ax[0]); Ly = dt(r, p.ax[1]); Lz = dt(r, p.ax[2]); Ln = [dt(N, p.ax[0]), dt(N, p.ax[1]), dt(N, p.ax[2])]; }
        const u = Math.abs(Ln[0]) > .5 ? Lz : Lx, v = Math.abs(Ln[1]) > .5 ? Lz : Ly;
        let g = .5 + .08 * (fbm(u * .5 + p.id, v * .5) - .5);
        // irregular panel lines: staggered rows, not every seam present
        const rv = Math.floor((v + 40) / 3.3), su = u + 40 + hh(rv, p.id) * 4.3, cu = Math.floor(su / 4.3);
        const lu = su - cu * 4.3, lv = v + 40 - rv * 3.3;
        if ((lu < .09 && hh(cu, rv + p.id * 3) > .3) || (lv < .09 && hh(cu + 7, rv + p.id) > .25)) g *= .5;
        g *= .82 + .18 * vn(u * 2.5, v * .15);                       // streaky grime
        let a = p.paint === 'b' ? [g * .2, g * .3, g * .58] : [g, g * .99, g * .95];
        if (p.mk === 2 && Math.abs(Lx - .4) < .55) a = [.6, .2, .03];                       // orange stripe on the pauldron
        if (p.mk === 1 && N[2] < -.5 && x > MX + 1.5 && x < MX + 7.5 && y > 56 && y < 62) a = [.58, .18, .03];  // chest marking
        if (p.mk === 6 && (((Lx + Lz) % 1.6) + 1.6) % 1.6 < .8 && Math.abs(Lx) > 2.6) a = [.55, .4, .03];   // hazard edge on the hatch
        // heat-tint & soot around the weld
        const dw = Math.hypot(x - WELD[0], y - WELD[1], z - WELD[2]);
        if (dw < 2.4) { const k = Math.max(0, 1 - dw / 2.4); a = [a[0] * (1 - .6 * k), a[1] * (1 - .7 * k), a[2] * (1 - .5 * k)]; }
        R.a = a; R.ks = .18; R.sh = 28; break;
      }
      case M.ARM2: R.a = [.12, .13, .15]; R.ks = .2; break;
      case M.FRM: { const g = .07 + .04 * vn(x * 1.2 + z, y * 1.2); R.a = [g, g, g * 1.05]; R.ks = .3; R.sh = 40; break; }
      case M.VISOR: R.a = [.05, .02, .02]; R.e = [5.2, .5, .12]; break;
      case M.CAV: R.a = [.035, .033, .032]; break;
      case M.CORE: R.e = [9, 3.2, .7]; R.a = [.1, .1, .1]; break;
      case M.CRIM: R.a = [.5, .06, .04]; R.ks = .2; break;
      case M.LAMPH: R.a = [.08, .08, .085]; R.ks = .2; break;
      case M.BULB: R.e = [30, 24, 15]; break;
      case M.LAMP: if (N[1] > .5) { R.e = [60, 52, 40]; R.a = [0, 0, 0]; } else R.a = [.1, .1, .1]; break;
      case M.LED: { const on = hh(z * 3 | 0, y | 0) > .14; R.e = N[1] > .5 && on ? [7, 7.4, 7.8] : [.3, .3, .3]; R.a = [0, 0, 0]; break; }
      case M.BEACON: R.e = [40, 16, 2]; break;
      case M.TUBEP: R.e = [14, 5, 22]; break;
      case M.TUBEC: R.e = [3, 16, 18]; break;
      case M.LETTERBOX: R.a = [.06, .06, .065]; if (N[2] < -.5) { R.e = [3, 2.7, 2.4]; } R.ks = .2; break;
      case M.PLANK: { const g = .2 + .08 * hh(x * 4 | 0, z * 2 | 0); R.a = [g * 1.1, g * .9, g * .65]; break; }
      case M.SCAF: R.a = [.4, .4, .42]; R.ks = .3; break;
      case M.WORK: R.a = [.55, .2, .04]; break;
      case M.VEST: R.a = [.75, .8, .1]; break;
      case M.HAT: R.a = [.75, .75, .72]; break;
      case M.ORANGE: R.a = [.6, .22, .03]; break;
      case M.CRATE: { const c = crateCols[Math.floor(p.ci * crateCols.length)]; R.a = mul(c, .8 + .4 * vn(z * 2, y * 2)); break; }
      default: break;
    }
    return R;
  }

  // ================================================================ SHADING
  const AMB_EXT = [.0065, .0075, .0095];        // night-city skyglow on the outside concrete
  const inside = P => P[2] > .05 && P[1] > CEIL - 3 && P[0] > LW - 2 && P[0] < RW + 2 && (P[1] > OY0 - .01 || P[2] > TW - .01);
  function ambient(P, N, ins) {
    if (!ins) return [AMB_EXT[0] * (1 + .6 * Math.max(0, N[1])), AMB_EXT[1] * (1 + .6 * Math.max(0, N[1])), AMB_EXT[2] * (1 + .6 * Math.max(0, N[1]))];
    // floor bounce (warm, strong for down-facing surfaces) + side bounce
    const down = Math.max(0, N[1]), up = Math.max(0, -N[1]), side = 1 - down - up;
    const k = .32 * down + .24 * side + .12 * up;
    return [k * .95, k * .82, k * .66];
  }
  function ao(P, N, maxd, n) {
    let t1 = Math.abs(N[0]) < .9 ? [1, 0, 0] : [0, 1, 0]; t1 = nrm(crs(N, t1)); const t2 = crs(N, t1);
    let open = 0;
    for (let i = 0; i < n; i++) {
      const r1 = (i + rnd()) / n, r2 = rnd() * 6.2832, sr = Math.sqrt(r1);
      const lx = sr * Math.cos(r2), ly = sr * Math.sin(r2), lz = Math.sqrt(1 - r1);
      const d = [t1[0] * lx + t2[0] * ly + N[0] * lz, t1[1] * lx + t2[1] * ly + N[1] * lz, t1[2] * lx + t2[2] * ly + N[2] * lz];
      if (!trace(P, d, maxd, true)) open++;
    }
    return open / n;
  }
  function direct(P, N, V, mt, ins, out) {
    const Pn = [P[0] + N[0] * .02, P[1] + N[1] * .02, P[2] + N[2] * .02];
    const spec = mt.ks, seeHall = ins || (P[1] > OY0 - .3 && P[0] > OX0 - .3 && P[0] < OX1 + .3 && P[2] > -.4);
    for (const L of LIGHTS) {
      if (L.zn === 1 && !seeHall) continue;
      if (DBG.only && !DBG.only(L)) continue;
      let lx = L.p[0], ly = L.p[1], lz = L.p[2];
      if (L.rad) { lx += (rnd() - .5) * L.rad; ly += (rnd() - .5) * L.rad; lz += (rnd() - .5) * L.rad; }
      const vx = lx - P[0], vy = ly - P[1], vz = lz - P[2], d2 = vx * vx + vy * vy + vz * vz, d = Math.sqrt(d2);
      const ndl = (N[0] * vx + N[1] * vy + N[2] * vz) / d; if (ndl <= 0) continue;
      let f = 1;
      if (L.spot) { const c = -(L.spot[0] * vx + L.spot[1] * vy + L.spot[2] * vz) / d; f = L.amb + (1 - L.amb) * (c > 0 ? Math.pow(c, L.pw) : 0); }
      const k = ndl * f / (d2 + 1);
      if (k * (L.c[0] + L.c[1] + L.c[2]) < .004) continue;
      let vis = 1;
      if (L.sh) {
        if (!L.ns) { if (trace(Pn, [vx / d, vy / d, vz / d], d - .3, true)) continue; }
        else {                                    // soft shadow: several jittered rays over the emitter
          let ok = 0;
          for (let q = 0; q < L.ns; q++) {
            const sx = L.p[0] + (rnd() - .5) * L.rad - P[0], sy = L.p[1] + (rnd() - .5) * L.rad - P[1], sz = L.p[2] + (rnd() - .5) * L.rad - P[2], sd = Math.hypot(sx, sy, sz);
            if (!trace(Pn, [sx / sd, sy / sd, sz / sd], sd - .3, true)) ok++;
          }
          if (!ok) continue; vis = ok / L.ns;
        }
      }
      let s = 0;
      if (spec) { const hx = vx / d - V[0], hy = vy / d - V[1], hz = vz / d - V[2], hl = Math.hypot(hx, hy, hz); s = spec * Math.pow(Math.max(0, (N[0] * hx + N[1] * hy + N[2] * hz) / hl), mt.sh) * (mt.sh + 2) / 8; }
      out[0] += L.c[0] * k * vis * (mt.a[0] + s); out[1] += L.c[1] * k * vis * (mt.a[1] + s); out[2] += L.c[2] * k * vis * (mt.a[2] + s);
    }
    // area lights: neon sign letters. Unoccluded irradiance is exact (Lambert's polygon formula); visibility
    // (the neon tubes and rails in front of the wall cast soft shadows) is estimated with a few shadow rays.
    if (P[2] < 4) for (const S of SIGNL) {
      const v = S.v; let sx = 0, sy = 0, sz = 0;
      for (let i = 0; i < 4; i++) {
        const a = v[i], b = v[(i + 1) % 4];
        let ax = a[0] - P[0], ay = a[1] - P[1], az = a[2] - P[2], bx_ = b[0] - P[0], by = b[1] - P[1], bz = b[2] - P[2];
        const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx_, by, bz); ax /= la; ay /= la; az /= la; bx_ /= lb; by /= lb; bz /= lb;
        const th = Math.acos(Math.max(-1, Math.min(1, ax * bx_ + ay * by + az * bz)));
        let cx = ay * bz - az * by, cy = az * bx_ - ax * bz, cz = ax * by - ay * bx_; const lc = Math.hypot(cx, cy, cz) || 1;
        sx += cx / lc * th; sy += cy / lc * th; sz += cz / lc * th;
      }
      const E = Math.abs(N[0] * sx + N[1] * sy + N[2] * sz) / 2;
      if (E * (S.c[0] + S.c[1]) < .002) continue;
      let vis = 0; const ns = 3;
      for (let i = 0; i < ns; i++) {
        const q = [S.o[0] + S.ex[0] * (i + rnd()) / ns + S.ey[0] * rnd(), S.o[1] + S.ex[1] * (i + rnd()) / ns + S.ey[1] * rnd(), S.o[2]];
        const vx = q[0] - Pn[0], vy = q[1] - Pn[1], vz = q[2] - Pn[2], d = Math.hypot(vx, vy, vz);
        if (!trace(Pn, [vx / d, vy / d, vz / d], d - .05, true)) vis++;
      }
      const k = E * vis / ns;
      out[0] += S.c[0] * k * mt.a[0]; out[1] += S.c[1] * k * mt.a[1]; out[2] += S.c[2] * k * mt.a[2];
    }
    // line lights: the two neon strokes (closed-form irradiance of a line segment, unshadowed)
    if (P[2] < 6) for (const T of TL) {
      const r0x = T.a[0] - P[0], r0y = T.a[1] - P[1], r0z = TZ - P[2];
      const ux = (T.b[0] - T.a[0]) / T.L, uy = (T.b[1] - T.a[1]) / T.L;
      const c = r0x * ux + r0y * uy, h2 = r0x * r0x + r0y * r0y + r0z * r0z - c * c + .12;
      const a = N[0] * r0x + N[1] * r0y + N[2] * r0z, b = N[0] * ux + N[1] * uy;
      const F1 = s => s / (h2 * Math.sqrt(s * s + h2)), F2 = s => -1 / Math.sqrt(s * s + h2);
      const E = (a - b * c) * (F1(T.L + c) - F1(c)) + b * (F2(T.L + c) - F2(c));
      if (E <= 0) continue;
      const k = E * T.pw;
      out[0] += T.col[0] * k * mt.a[0]; out[1] += T.col[1] * k * mt.a[1]; out[2] += T.col[2] * k * mt.a[2];
    }
  }
  // office interiors behind the ribbon windows (interior mapping: no geometry needed)
  function officeWindow(p, P, d) {
    const s = p.st, yc = s * 4.6 + 1.0, yf = s * 4.6 + 4.6, bw = 3.6;
    const cx = Math.floor((P[0] + 1.8) / bw), x0 = cx * bw - 1.8, x1 = x0 + bw, zb = 11;
    const h = hh(cx * 3 + 11, s * 7 + 5), lit = h < .42, cool = hh(cx, s + 40) < .35;
    const tw = d[2] > 0 ? (zb - P[2]) / d[2] : 1e9, tx = d[0] > 0 ? (x1 - P[0]) / d[0] : (x0 - P[0]) / d[0], ty = d[1] < 0 ? (yc - P[1]) / d[1] : (yf - P[1]) / d[1];
    const t = Math.min(tw, tx, ty), Q = [P[0] + d[0] * t, P[1] + d[1] * t, P[2] + d[2] * t];
    const Lc = mul(cool ? [.75, .88, 1] : [1, .8, .55], .7 + .9 * hh(cx + 17, s + 23));
    let c;
    if (!lit) { const g = .004 + .004 * hh(cx, s); c = [g, g, g * 1.2]; if (hh(cx + 9, s) < .3) c = [.01, .012, .02]; }
    else if (t === ty && d[1] < 0) {                     // ceiling with light rows
      const lz = ((Q[2] - 1.26) % 2.6 + 2.6) % 2.6;
      c = lz < .45 && Math.abs(Q[0] - (x0 + x1) / 2) < 1.4 ? mul(Lc, 14) : mul(Lc, .6 * Math.exp(-(Q[2] - 1.3) * .08));
    } else { const fall = Math.exp(-(Q[2] - 1.3) * .05); c = mul(Lc, (.8 + .5 * (Q[1] - yc) / 3.6) * fall * (t === tw ? .8 : 1)); if (t === tw && hh(cx + 2, s + 3) < .4 && Q[1] > yf - 1.9) c = mul(c, .25); }
    if (lit && hh(cx + 5, s + 9) < .3) c = mul(Lc, 1.1 + .6 * hh(cx, s + 2));                            // drawn curtains, back-lit
    // glass reflection of the night sky + skyglow
    return [c[0] * .82 + .006, c[1] * .84 + .007, c[2] * .86 + .009];
  }
  const SIG = .0018;                                   // hall haze extinction (1/m)
  const HAZE = [.9, .76, .58];
  function weldInscatter(o, d, t0, t1) {
    const q = sub(WELD, o), tc = dt(q, d), h2 = Math.max(.04, dt(q, q) - tc * tc), h = Math.sqrt(h2);
    return (Math.atan((t1 - tc) / h) - Math.atan((t0 - tc) / h)) / h;
  }
  function radiance(o, d, depth = 0) {
    const pr = trace(o, d, 5000, false);
    if (!pr) return [0, 0, 0];
    const t = HT, P = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
    let N = normalAt(pr, P); if (dt(N, d) > 0) N = mul(N, -1);
    let col;
    if (pr.m === M.WIN) col = officeWindow(pr, P, d);
    else if (pr.glass) {
      const fres = .04 + .5 * Math.pow(1 - Math.abs(dt(N, d)), 5);
      const tr = depth < 3 ? radiance(add(P, mul(d, .1)), d, depth + 1) : [0, 0, 0];
      const wire = (((P[0] * 2.2) % 1 + 1) % 1 < .06 || ((P[1] * 2.2) % 1 + 1) % 1 < .06) ? .55 : 1;
      return [(tr[0] * .5 + .09) * wire * (1 - fres) + fres * .03, (tr[1] * .52 + .08) * wire * (1 - fres) + fres * .035, (tr[2] * .5 + .065) * wire * (1 - fres) + fres * .045];
    } else {
      const mt = material(pr, P, N), ins = inside(P);
      const out = [0, 0, 0];
      if (mt.e) { out[0] += mt.e[0]; out[1] += mt.e[1]; out[2] += mt.e[2]; }
      if (mt.a[0] + mt.a[1] + mt.a[2] > 0) {
        const Pn = [P[0] + N[0] * .03, P[1] + N[1] * .03, P[2] + N[2] * .03];
        const A = DBG.noamb ? [0, 0, 0] : ambient(P, N, ins), occ = ao(Pn, N, ins ? 6 : 2.5, ins ? 8 : 3);
        out[0] += A[0] * mt.a[0] * occ; out[1] += A[1] * mt.a[1] * occ; out[2] += A[2] * mt.a[2] * occ;
        direct(P, N, d, mt, ins, out);
      }
      col = out;
    }
    // haze inside the hall (only the part of the ray that is inside the building)
    if (d[2] > 0) {
      const tIn = Math.max(0, (TW - o[2]) / d[2]);
      if (t > tIn && (o[2] + d[2] * t) > TW) {
        const s = t - tIn, a = 1 - Math.exp(-SIG * s), wi = weldInscatter(o, d, tIn, t) * 2.2;
        col = [col[0] * (1 - a) + HAZE[0] * a * .4 + wi * .75, col[1] * (1 - a) + HAZE[1] * a * .4 + wi * .85, col[2] * (1 - a) + HAZE[2] * a * .4 + wi * 1.0];
      }
    }
    return col;
  }

  // ================================================================ RENDER (page-space raster)
  const Q = SG.mech.quad;
  const qx0 = Math.max(0, Math.floor(Math.min(...Q.map(p => p[0]))) - 1), qy0 = Math.floor(Math.min(...Q.map(p => p[1]))) - 1;
  const qx1 = Math.min(PW, Math.ceil(Math.max(...Q.map(p => p[0]))) + 1), qy1 = Math.min(PH, Math.ceil(Math.max(...Q.map(p => p[1]))) + 1);
  const inQuad = (x, y, m) => { for (let i = 0; i < 4; i++) { const a = Q[i], b = Q[(i + 1) % 4]; const ex = b[0] - a[0], ey = b[1] - a[1], l = Math.hypot(ex, ey); if ((ex * (y - a[1]) - ey * (x - a[0])) / l < -m) return false; } return true; };
  const EXPO = .2, SPP = 2;
  const DBG = (typeof window !== 'undefined' && window.__mechDbg) || {};
  const tone = v => Math.pow(1 - Math.exp(-Math.max(0, v) * EXPO), 1 / 2.2) * 255;
  function renderRaster(dprOv) {
    const dpr = dprOv || (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const W = Math.round((qx1 - qx0) * dpr), H = Math.round((qy1 - qy0) * dpr);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d'), img = ctx.createImageData(W, H);
    const acc = new Float32Array(W * H * 3), ids = new Int32Array(W * H).fill(-2), cnt = new Uint8Array(W * H);
    const sample = (px, py) => { const d = rayDir(px, py); const c = radiance(CAMP, d); return [c, HP ? HP.id : -1]; };
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const px = qx0 + (i + .5) / dpr, py = qy0 + (j + .5) / dpr;
      if (!inQuad(px, py, 1.5)) continue;
      if (DBG.crop && (px < DBG.crop[0] || py < DBG.crop[1] || px > DBG.crop[2] || py > DBG.crop[3])) continue;
      RS = (Math.imul(i + 1, 73856093) ^ Math.imul(j + 1, 19349663)) | 1;
      const [c, id] = sample(px, py); const k = j * W + i;
      acc[k * 3] = c[0]; acc[k * 3 + 1] = c[1]; acc[k * 3 + 2] = c[2]; ids[k] = id; cnt[k] = 1;
      for (let q = 1; q < SPP; q++) {
        const [c2] = sample(qx0 + (i + rnd()) / dpr, qy0 + (j + rnd()) / dpr);
        acc[k * 3] += c2[0]; acc[k * 3 + 1] += c2[1]; acc[k * 3 + 2] += c2[2]; cnt[k]++;
      }
    }
    // adaptive anti-aliasing on geometric edges
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i; if (ids[k] === -2) continue;
      const e = (i + 1 < W && ids[k + 1] !== ids[k] && ids[k + 1] !== -2) || (j + 1 < H && ids[k + W] !== ids[k] && ids[k + W] !== -2) || (i > 0 && ids[k - 1] !== ids[k] && ids[k - 1] !== -2) || (j > 0 && ids[k - W] !== ids[k] && ids[k - W] !== -2);
      if (!e) continue;
      for (const [ox, oy] of [[.25, .25], [.75, .25], [.25, .75], [.75, .75]]) {
        const [c] = sample(qx0 + (i + ox) / dpr, qy0 + (j + oy) / dpr);
        acc[k * 3] += c[0]; acc[k * 3 + 1] += c[1]; acc[k * 3 + 2] += c[2]; cnt[k]++;
      }
    }
    for (let k = 0; k < W * H; k++) {
      if (ids[k] === -2) continue;
      const n = cnt[k];
      img.data[k * 4] = tone(acc[k * 3] / n); img.data[k * 4 + 1] = tone(acc[k * 3 + 1] / n); img.data[k * 4 + 2] = tone(acc[k * 3 + 2] / n); img.data[k * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  }

  // ================================================================ SVG overlays
  const pxPerM = (x, y, z) => Math.hypot(...sub([...PG(x + .5, y, z), 0], [...PG(x - .5, y, z), 0]));
  const pathM = pts => 'M' + pts.map(p => p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join(' L');
  // bends with a real radius, sampled densely so the perspective stays exact
  const bendPts = (pts, r = 1.1) => {
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], b = pts[i], c = pts[i + 1];
      const d1 = nrm([b[0] - a[0], b[1] - a[1], 0]), d2 = nrm([c[0] - b[0], c[1] - b[1], 0]);
      const p0 = [b[0] - d1[0] * r, b[1] - d1[1] * r], p2 = [b[0] + d2[0] * r, b[1] + d2[1] * r];
      for (let k = 0; k <= 6; k++) { const t = k / 6, u = 1 - t; out.push([u * u * p0[0] + 2 * u * t * b[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * b[1] + t * t * p2[1]]); }
    }
    out.push(pts[pts.length - 1]);
    const dense = [];
    for (let i = 1; i < out.length; i++) { const a = out[i - 1], b = out[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2)); for (let k = 0; k < n; k++) dense.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); }
    dense.push(out[out.length - 1]);
    return dense;
  };
  function tubesSVG() {
    let s = '';
    const hexOf = c => rgb2hex(c.map(v => Math.min(255, v * 255)));
    for (const t of TUBES) {
      const pts = bendPts(t.pts).map(p => PG(p[0], p[1], TZ));
      const w = 2 * TR * pxPerM(30, 30, TZ), d = pathM(pts), col = hexOf(t.col), core = mix(col, '#ffffff', .78);
      s += `<path d="${d}" fill="none" stroke="${col}" stroke-width="${(w * 3.2).toFixed(2)}" opacity=".33" filter="url(#b2)" stroke-linecap="round" stroke-linejoin="round"/>`;
      s += `<path d="${d}" fill="none" stroke="${col}" stroke-width="${(w * 1.05).toFixed(2)}" stroke-linecap="butt" stroke-linejoin="round"/>`;
      s += `<path d="${d}" fill="none" stroke="${core}" stroke-width="${(w * .5).toFixed(2)}" stroke-linecap="butt" stroke-linejoin="round"/>`;
    }
    return s;
  }
  // sparks: ballistic streaks from the weld point (3-D, gravity, 1/30 s exposure)
  function sparksSVG() {
    let s = ''; RS = 99173;
    for (let i = 0; i < 70; i++) {
      const th = rnd() * Math.PI * 2, ph = Math.acos(1 - rnd() * 1.1);
      const sp = 4 + rnd() * 9;
      let v = [Math.cos(th) * Math.sin(ph) * sp, -Math.cos(ph) * sp * .4 + rnd() * 2, -Math.abs(Math.sin(th) * Math.sin(ph)) * sp - 1];
      const age = rnd() * .9;
      let p = add(WELD, [v[0] * age, v[1] * age + 4.9 * age * age, v[2] * age]);
      const vt = [v[0], v[1] + 9.8 * age, v[2]];
      const dtE = 1 / 30 + rnd() * .02, q = sub(p, mul(vt, dtE));
      const a = PG(...q), b = PG(...p);
      const heat = Math.max(0, 1 - age * 1.2);
      const col = heat > .6 ? '#fff6dc' : heat > .3 ? '#ffd27a' : '#ff9a3a';
      s += `<line x1="${a[0].toFixed(2)}" y1="${a[1].toFixed(2)}" x2="${b[0].toFixed(2)}" y2="${b[1].toFixed(2)}" stroke="${col}" stroke-width="${(.22 + heat * .25).toFixed(2)}" stroke-linecap="round" opacity="${(.55 + heat * .45).toFixed(2)}"/>`;
    }
    const w = PG(...WELD);
    s += `<circle cx="${w[0].toFixed(2)}" cy="${w[1].toFixed(2)}" r="1.6" fill="#dfeaff" opacity=".55" filter="url(#b1)"/><circle cx="${w[0].toFixed(2)}" cy="${w[1].toFixed(2)}" r=".7" fill="#ffffff"/>`;
    return s;
  }
  if (typeof window !== 'undefined') window.__mechRaster = d => renderRaster(d);   // debug hook (tools only)
  const quadD = polyD(Q);
  // sparks are only visible through the door opening (below the girder)
  const doorD = polyD([PG(OX0, GY1 + .9, 0), PG(OX1, GY1 + .9, 0), PG(OX1, HM, 0), PG(OX0, HM, 0)]);

  panel({ z: 118, clip: [quadD], svg: () => {
    const url = renderRaster();
    return `<defs><clipPath id="mkDoor" clipPathUnits="userSpaceOnUse"><path d="${doorD}"/></clipPath></defs>
      <image href="${url}" x="${qx0}" y="${qy0}" width="${qx1 - qx0}" height="${qy1 - qy0}" preserveAspectRatio="none"/>
      <g clip-path="url(#mkDoor)">${sparksSVG()}</g>
      ${tubesSVG()}`;
  } });

  // ---- 機械工房 / MECH WORKS: illuminated channel letters 0.75 m deep, mounted on the raceway rails.
  // Each depth slice is its own exactly-projected plane, so the returns (letter sides) show real parallax:
  // from down-left we see their bottoms and left sides.
  const PS = 10;                                     // panel units per metre
  const planeQ = z => [PG(0, 0, z), PG(WM, 0, z), PG(WM, HM, z), PG(0, HM, z)];
  const jp = (f, s, sw) => T(37.2 * PS, 24.6 * PS, '機械工房', 7.85 * PS, JP, f, `stroke="${s}" stroke-width="${sw}" stroke-linejoin="round" textLength="${31.4 * PS}" lengthAdjust="spacingAndGlyphs"`);
  const en = (f, s, sw) => T(37.2 * PS, 31.0 * PS, 'MECH WORKS', 5.0 * PS, "'Big Shoulders Display','Inter'", f, `font-weight="800" stroke="${s}" stroke-width="${sw}" stroke-linejoin="round" textLength="${31.2 * PS}" lengthAdjust="spacingAndGlyphs"`);
  const NL = 9, Z0 = -1.25, Z1 = -2.0;
  for (let i = 0; i < NL; i++) {
    const z = Z0 + (Z1 - Z0) * i / NL, t = i / (NL - 1);
    const col = mix('#17120e', '#5a3d22', t * t);    // painted returns, picking up the face's light near the front
    panel({ z: 118, quad: planeQ(z), w: Math.round(WM * PS), h: Math.round(HM * PS), clip: [quadD], svg: () => `${jp(col, col, .3 * PS)}${en(col, col, .2 * PS)}` });
  }
  // the lit faces (acrylic over LED modules): slightly uneven, hot cores, a tight halo
  panel({ z: 118, quad: planeQ(Z1), w: Math.round(WM * PS), h: Math.round(HM * PS), clip: [quadD], svg: () => {
    const glow = (el, col, core, sw) => `<g filter="url(#mkNg)" opacity=".55">${el(col, col, sw * 2.2)}</g><g>${el(col, '#7a4a1c', sw * .9)}</g><g opacity=".85">${el(core, core, 0)}</g>`;
    return `<defs><filter id="mkNg" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="${.35 * PS}"/></filter>
      <linearGradient id="mkFace" gradientUnits="userSpaceOnUse" x1="0" y1="${17 * PS}" x2="0" y2="${32 * PS}"><stop offset="0" stop-color="#ffd9a0"/><stop offset=".5" stop-color="#ffc070"/><stop offset="1" stop-color="#ffe2b4"/></linearGradient></defs>
      ${glow(jp, '#ff8a1e', 'url(#mkFace)', .32 * PS)}
      ${glow(en, '#ffa53a', 'url(#mkFace)', .22 * PS)}`;
  } });
  // left light box: its face sits on the box front (z = -1.2), diffuser with three tube bands behind it
  panel({ z: 118, quad: planeQ(-1.22), w: Math.round(WM * PS), h: Math.round(HM * PS), clip: [quadD], svg: () => {
    const x0 = 5.4 * PS, y0 = 12.2 * PS, w = 12.0 * PS, h = 23.1 * PS;
    return `<defs><linearGradient id="mkLb" gradientUnits="userSpaceOnUse" x1="${x0}" y1="0" x2="${x0 + w}" y2="0">
        <stop offset="0" stop-color="#000" stop-opacity=".28"/><stop offset=".2" stop-color="#000" stop-opacity="0"/><stop offset=".33" stop-color="#000" stop-opacity=".1"/>
        <stop offset=".5" stop-color="#000" stop-opacity="0"/><stop offset=".67" stop-color="#000" stop-opacity=".1"/><stop offset=".8" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".3"/></linearGradient>
      <linearGradient id="mkLbV" gradientUnits="userSpaceOnUse" x1="0" y1="${y0}" x2="0" y2="${y0 + h}"><stop offset="0" stop-color="#000" stop-opacity=".18"/><stop offset=".12" stop-color="#000" stop-opacity="0"/><stop offset=".85" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#3a2a10" stop-opacity=".35"/></linearGradient></defs>
      <rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="#f2ead8"/>
      <rect x="${x0}" y="${y0}" width="${w}" height="${5.0 * PS}" fill="#cf2a12"/>
      ${T(x0 + w / 2, y0 + 3.9 * PS, '24H', 3.3 * PS, "'Big Shoulders Display','Inter'", '#fff1e2', 'text-anchor="middle" font-weight="800"')}
      ${VT(x0 + w / 2, y0 + 6.4 * PS, '重機修理', 3.45 * PS, JP, '#1c1a18', '', 1.04)}
      <rect x="${x0 + 1.2 * PS}" y="${y0 + 20.3 * PS}" width="${w - 2.4 * PS}" height="${.12 * PS}" fill="#7a746a"/>
      ${T(x0 + w / 2, y0 + 22.2 * PS, 'BAY 06 · 重機', 1.25 * PS, "'Share Tech Mono','IPAGothic'", '#45403a', 'text-anchor="middle"')}
      <rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="url(#mkLb)"/><rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="url(#mkLbV)"/>
      <rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="none" stroke="#1a1a1c" stroke-width="${.35 * PS}"/>`;
  } });
})();
