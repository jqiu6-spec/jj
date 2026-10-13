// depth.js — true 3-D construction for shopfronts, projected through the camera solved from the photo.
// Every sign with plane geometry has SG[key].f3d = {eu, ev, X0, nin, rect:[l,t,r,b]}:
//   world point(s, t, d) = X0 + s*eu + t*ev + d*nin
//   s grows to image-right along the facade, t grows downward (toward the ground), d grows INTO the building
//   (d < 0 is in front of the facade, toward the camera). Units are metric-consistent but arbitrary scale;
//   always size things relative to the facade rect (W = r - l, H = b - t).
// The camera sits at the origin looking up at everything, so horizontal surfaces you can see are
// CEILINGS / SOFFITS / UNDERSIDES, never floors seen from above.
const V3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: a => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; },
};
function proj3(X) {
  const K = CAM.K;
  const z = K[2][0] * X[0] + K[2][1] * X[1] + K[2][2] * X[2];
  return [(K[0][0] * X[0] + K[0][1] * X[1] + K[0][2] * X[2]) / z, (K[1][0] * X[0] + K[1][1] * X[1] + K[1][2] * X[2]) / z];
}
const fmt = p => p[0].toFixed(2) + ' ' + p[1].toFixed(2);
const pathOf = pts => 'M' + pts.map(fmt).join(' L') + ' Z';

// Frame(key) -> helpers bound to one facade plane
function Frame(key) {
  const f = SG[key].f3d;
  const [l, t, r, b] = f.rect;
  const F = {
    key, f, l, t, r, b, W: r - l, H: b - t,
    X: (s, tt, d = 0) => [0, 1, 2].map(i => f.X0[i] + s * f.eu[i] + tt * f.ev[i] + d * f.nin[i]),
    P: (s, tt, d = 0) => proj3(F.X(s, tt, d)),
    // normalised: u,v in [0,1] across the facade rect, depth k in units of facade WIDTH
    N: (u, v, k = 0) => F.P(l + u * (r - l), t + v * (b - t), k * (r - l)),
    NX: (u, v, k = 0) => F.X(l + u * (r - l), t + v * (b - t), k * (r - l)),
  };
  return F;
}
// polygon from normalised (u,v,k) triples
function npoly(F, uvk, fill, extra = '') { return `<path d="${pathOf(uvk.map(p => F.N(p[0], p[1], p[2] || 0)))}" fill="${fill}" ${extra}/>`; }
// is a planar face (given as normalised uvk corners) facing the camera?  (camera at origin)
function faces(F, uvk) {
  const P = uvk.map(p => F.NX(p[0], p[1], p[2] || 0));
  const n = V3.cross(V3.sub(P[1], P[0]), V3.sub(P[2], P[0]));
  const c = P.reduce((a, q) => V3.add(a, V3.mul(q, 1 / P.length)), [0, 0, 0]);
  return { n, c, toCam: V3.dot(n, V3.mul(c, -1)) };
}
// visible from the camera when looking at the INSIDE of a box (room) or the OUTSIDE of a solid (slab/fin)
function seenInside(F, uvk, centerUVK) {
  const { n, c, toCam } = faces(F, uvk);
  const ctr = F.NX(centerUVK[0], centerUVK[1], centerUVK[2] || 0);
  const toCtr = V3.dot(n, V3.sub(ctr, c));
  return Math.sign(toCam) === Math.sign(toCtr);
}
function seenOutside(F, uvk, centerUVK) { return !seenInside(F, uvk, centerUVK); }

// page-space gradients (userSpaceOnUse). Returns `url(#id)`; push the defs with GRAD.flush()
const GRAD = {
  list: [], n: 0,
  lin(p0, p1, stops) {
    const id = 'dg' + (GRAD.n++);
    GRAD.list.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${p0[0]}" y1="${p0[1]}" x2="${p1[0]}" y2="${p1[1]}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</linearGradient>`);
    return `url(#${id})`;
  },
  rad(c, rx, stops, ry) {
    const id = 'dg' + (GRAD.n++);
    const sy = (ry || rx) / rx;
    GRAD.list.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${c[0]}" cy="${c[1] / sy}" r="${rx}" gradientTransform="scale(1 ${sy})">${stops.map(([o, col, a = 1]) => `<stop offset="${o}" stop-color="${col}" stop-opacity="${a}"/>`).join('')}</radialGradient>`);
    return `url(#${id})`;
  },
  flush() { const s = `<defs>${GRAD.list.join('')}</defs>`; GRAD.list = []; return s; },
};
// linear gradient along a face between two normalised points
const ngrad = (F, a, b, stops) => GRAD.lin(F.N(a[0], a[1], a[2] || 0), F.N(b[0], b[1], b[2] || 0), stops);

// facade solid with rectangular openings (holes given as [u0,v0,u1,v1] at k=0); evenodd fill
function facadeWithHoles(F, holes, fill, extra = '', outer = [0, 0, 1, 1]) {
  const [a, b, c, d] = outer;
  let p = pathOf([F.N(a, b), F.N(c, b), F.N(c, d), F.N(a, d)]);
  for (const [u0, v0, u1, v1] of holes) p += ' ' + pathOf([F.N(u0, v0), F.N(u0, v1), F.N(u1, v1), F.N(u1, v0)]);
  return `<path d="${p}" fill="${fill}" fill-rule="evenodd" ${extra}/>`;
}

// A recessed, lit room behind an opening [u0,v0,u1,v1] on the facade, depth k (in facade widths).
// o: {ceil, wall, back, floor, light (colour), lights: n ceiling light rows, ao: ambient-occlusion strength,
//     jamb: reveal depth (k units) drawn in facade colour jambCol, inside: (F, box) => svg drawn before the jambs}
function room(F, u0, v0, u1, v1, k, o = {}) {
  const ceil = o.ceil || '#3a3a40', wall = o.wall || '#2a2a30', back = o.back || '#1e1e24', floor = o.floor || '#151518';
  const L = o.light || '#fff1d6';
  const ctr = [(u0 + u1) / 2, (v0 + v1) / 2, k / 2];
  const F_ = {
    back: [[u0, v0, k], [u1, v0, k], [u1, v1, k], [u0, v1, k]],
    ceil: [[u0, v0, 0], [u1, v0, 0], [u1, v0, k], [u0, v0, k]],
    floor: [[u0, v1, 0], [u0, v1, k], [u1, v1, k], [u1, v1, 0]],
    left: [[u0, v0, 0], [u0, v0, k], [u0, v1, k], [u0, v1, 0]],
    right: [[u1, v0, 0], [u1, v1, 0], [u1, v1, k], [u1, v0, k]],
  };
  let s = '';
  // back wall: lit from the ceiling, darker toward the floor
  s += npoly(F, F_.back, ngrad(F, [ctr[0], v0, k], [ctr[0], v1, k], [[0, mix(back, L, .35)], [.55, back], [1, shade(back, .55)]]));
  // floor (rarely visible from below, kept for low rooms)
  if (seenInside(F, F_.floor, ctr)) s += npoly(F, F_.floor, ngrad(F, [ctr[0], v1, 0], [ctr[0], v1, k], [[0, shade(floor, .9)], [1, shade(floor, .5)]]));
  // side walls: bright near the front/ceiling, falling off into the depth
  for (const side of ['left', 'right']) if (seenInside(F, F_[side], ctr)) {
    const uu = side === 'left' ? u0 : u1;
    s += npoly(F, F_[side], ngrad(F, [uu, v0, k * .1], [uu, v1, k * .9], [[0, mix(wall, L, .3)], [.6, wall], [1, shade(wall, .45)]]));
    s += npoly(F, F_[side], ngrad(F, [uu, ctr[1], 0], [uu, ctr[1], k], [[0, '#000', 0], [.85, '#000', .15], [1, '#000', .55 * (o.ao ?? 1)]]));
  }
  // ceiling with rows of light fixtures (the camera looks up, so ceilings are the big visible surface)
  if (seenInside(F, F_.ceil, ctr)) {
    s += npoly(F, F_.ceil, ngrad(F, [ctr[0], v0, 0], [ctr[0], v0, k], [[0, mix(ceil, L, .12)], [1, shade(ceil, .55)]]));
    const rows = o.lights ?? 3;
    for (let i = 0; i < rows; i++) {
      const kk = k * (i + .5) / rows, w = (u1 - u0);
      const strip = [[u0 + w * .1, v0, kk - k * .03], [u1 - w * .1, v0, kk - k * .03], [u1 - w * .1, v0, kk + k * .03], [u0 + w * .1, v0, kk + k * .03]];
      s += npoly(F, strip, L, `opacity="${.95 - i * .12}"`);
      s += npoly(F, strip, L, `opacity=".5" filter="url(#b2)"`);
    }
    s += npoly(F, F_.ceil, ngrad(F, [ctr[0], v0, k * .7], [ctr[0], v0, k], [[0, '#000', 0], [1, '#000', .5 * (o.ao ?? 1)]]));
  }
  if (o.inside) s += o.inside(F, { u0, v0, u1, v1, k, ctr });
  // window reveal / jambs in facade material
  if (o.jamb) {
    const j = o.jamb, jc = o.jambCol || '#3b3936';
    const J = {
      ceil: [[u0, v0, 0], [u1, v0, 0], [u1, v0, j], [u0, v0, j]],
      left: [[u0, v0, 0], [u0, v0, j], [u0, v1, j], [u0, v1, 0]],
      right: [[u1, v0, 0], [u1, v1, 0], [u1, v1, j], [u1, v0, j]],
      floor: [[u0, v1, 0], [u0, v1, j], [u1, v1, j], [u1, v1, 0]],
    };
    for (const [nm, q] of Object.entries(J)) if (seenInside(F, q, ctr)) s += npoly(F, q, nm === 'ceil' ? shade(jc, .7) : jc);
  }
  // you can only see into a room through its opening: clip everything to the opening quad
  if (o.clip === false) return s;
  const cid = 'rc' + (GRAD.n++);
  GRAD.list.push(`<clipPath id="${cid}" clipPathUnits="userSpaceOnUse"><path d="${pathOf([F.N(u0, v0), F.N(u1, v0), F.N(u1, v1), F.N(u0, v1)])}"/></clipPath>`);
  return `<g clip-path="url(#${cid})">${s}</g>`;
}
// clip arbitrary svg to an opening on the facade (normalised rect at depth k)
function clipTo(F, u0, v0, u1, v1, svg, k = 0) {
  const cid = 'rc' + (GRAD.n++);
  GRAD.list.push(`<clipPath id="${cid}" clipPathUnits="userSpaceOnUse"><path d="${pathOf([F.N(u0, v0, k), F.N(u1, v0, k), F.N(u1, v1, k), F.N(u0, v1, k)])}"/></clipPath>`);
  return `<g clip-path="url(#${cid})">${svg}</g>`;
}
// solid box sticking out of / sitting on the facade (balcony slab, fin, awning, sign box). Corners in uvk.
function solid(F, u0, v0, u1, v1, k0, k1, cols = {}) {
  const ctr = [(u0 + u1) / 2, (v0 + v1) / 2, (k0 + k1) / 2];
  const Q = {
    front: [[u0, v0, k0], [u1, v0, k0], [u1, v1, k0], [u0, v1, k0]],
    bottom: [[u0, v1, k0], [u1, v1, k0], [u1, v1, k1], [u0, v1, k1]],
    top: [[u0, v0, k0], [u0, v0, k1], [u1, v0, k1], [u1, v0, k0]],
    left: [[u0, v0, k0], [u0, v1, k0], [u0, v1, k1], [u0, v0, k1]],
    right: [[u1, v0, k0], [u1, v0, k1], [u1, v1, k1], [u1, v1, k0]],
  };
  let s = '';
  for (const nm of ['bottom', 'top', 'left', 'right', 'front']) if (seenOutside(F, Q[nm], ctr)) s += npoly(F, Q[nm], cols[nm] || cols.all || '#444');
  return s;
}
// colour utilities
function hex2rgb(h) { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); }
const rgb2hex = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => { const A = hex2rgb(a), B = hex2rgb(b); return rgb2hex(A.map((v, i) => v + (B[i] - v) * t)); };
const shade = (a, k) => rgb2hex(hex2rgb(a).map(v => v * k));
// billboard sprite (e.g. a car or a person) standing inside a room at normalised (u, v-floor, k):
// returns a transform that places a sprite of unit height at that 3-D spot, scaled by perspective
function spriteAt(F, u, v, k, heightV) {
  const base = F.N(u, v, k), top = F.N(u, v - heightV, k);
  const hpx = Math.hypot(top[0] - base[0], top[1] - base[1]);
  const ang = Math.atan2(top[0] - base[0], -(top[1] - base[1])) * 180 / Math.PI;
  return { base, hpx, ang, tf: `translate(${base[0].toFixed(2)} ${base[1].toFixed(2)}) rotate(${ang.toFixed(2)}) scale(${(hpx / 100).toFixed(4)})` };
}
