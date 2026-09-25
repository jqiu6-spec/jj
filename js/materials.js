// Real gun materials for the parts: carbon fibre, brushed and blasted metal,
// bluing, knurling, Cerakote, stippled polymer and so on. Each is drawn in
// code once, at its real size (the models' UVs are in metres), as a colour
// map, a normal map worked out from a height map, a roughness map and, for
// fibres and brushing, the direction the surface's sheen runs (anisotropy),
// which is what makes carbon weave shimmer and brushed steel streak.
import * as THREE from '../vendor/three.module.min.js';
import { rng, noiseField } from './skins.js';

const TAU = Math.PI * 2;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const mix = (a, b, t) => a + (b - a) * t;
const frac = (x) => x - Math.floor(x);
const rgb = (hex) => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b].map((v) => Math.round(v * 255));
};

// Tileable fractal noise from the skins' lattice noise.
function fbm(rand, periods, weights) {
  const fields = periods.map((p) => noiseField(rand, p));
  const total = weights.reduce((a, b) => a + b, 0);
  return (u, v) => fields.reduce((s, f, i) => s + f(u, v) * weights[i], 0) / total;
}

// Scattered points in the unit square, for cells (Voronoi) that wrap,
// bucketed on a grid so finding the nearest looks at only a few.
function points(rand, n) {
  const pts = Array.from({ length: n }, () => ({ x: rand(), y: rand(), s: rand(), t: rand() }));
  const g = Math.max(1, Math.round(Math.sqrt(n / 2)));
  const cells = Array.from({ length: g * g }, () => []);
  for (const p of pts) cells[(Math.floor(p.y * g) % g) * g + (Math.floor(p.x * g) % g)].push(p);
  return { g, cells };
}
// The nearest and second-nearest point to (u, v), across the wrap.
function nearest(P, u, v) {
  const { g, cells } = P;
  const ci = Math.floor(u * g);
  const cj = Math.floor(v * g);
  let d1 = Infinity;
  let d2 = Infinity;
  let best = null;
  for (let dj = -2; dj <= 2; dj++) {
    for (let di = -2; di <= 2; di++) {
      for (const p of cells[(((cj + dj) % g + g) % g) * g + (((ci + di) % g + g) % g)]) {
        let dx = u - p.x;
        let dy = v - p.y;
        dx -= Math.round(dx);
        dy -= Math.round(dy);
        const d = Math.hypot(dx, dy);
        if (d < d1) { d2 = d1; d1 = d; best = p; } else if (d < d2) d2 = d;
      }
    }
  }
  return { p: best, d1, d2 };
}

// Tileable value noise with its own number of cells across (px) and down
// (py), for grain that runs one way.
function noiseGrid(rand, px, py) {
  const g = Array.from({ length: px * py }, rand);
  const at = (i, j) => g[((j % py + py) % py) * px + ((i % px + px) % px)];
  return (x, y) => {
    const fx = x * px;
    const fy = y * py;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const u = fx - i;
    const v = fy - j;
    const su = u * u * (3 - 2 * u);
    const sv = v * v * (3 - 2 * v);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * su;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * su;
    return a + (b - a) * sv;
  };
}

// Carbon fibre, 2x2 twill: tows 2 mm wide going over two and under two,
// stepping one along each row, so the weave runs in diagonals. Warp tows run
// along u, weft tows along v; each shines along its own length.
function carbonTwill(N) {
  const rand = rng(7);
  const fibre = noiseField(rand, 64);
  return (u, v, o) => {
    const i = Math.floor(u * N);
    const j = Math.floor(v * N);
    const fu = u * N - i;
    const fv = v * N - j;
    const warpOver = (i + j) % 4 < 2;
    // Across the tow: a flattened bundle; along it: rising out of the weave
    // and diving back under at the ends of its two-cell run.
    const across = warpOver ? fv : fu;
    const run = warpOver ? ((i + j) % 4 + fu) / 2 : (((i + j) % 4 - 2) + fv) / 2;
    const bulge = Math.sqrt(Math.max(0, 1 - (2 * across - 1) ** 2));
    const rise = Math.sin(Math.PI * clamp01(run)) ** 0.6;
    const lines = warpOver ? fibre(u * 0.25, v * 8 % 1) : fibre(u * 8 % 1, v * 0.25);
    o.h = 0.25 + 0.75 * bulge * (0.55 + 0.45 * rise);
    o.k = (warpOver ? 0.55 : 0.4) * (0.3 + 0.7 * bulge) + (lines - 0.5) * 0.2;
    o.r = 0.85 + (1 - bulge) * 0.45;
    o.ax = warpOver ? 1 : 0;
    o.ay = warpOver ? 0 : 1;
    o.as = 0.25 + 0.65 * bulge;
  };
}

// Forged carbon: chopped strips of fibre pressed into black resin, piled
// every which way, each with its fibres (and its sheen) running its own
// way. The strips are laid into an index map first, later ones on top.
function forgedCarbon(S) {
  const rand = rng(11);
  const strips = [];
  const id = new Int16Array(S * S).fill(-1);
  for (let n = 0; n < 420; n++) {
    const a = rand() * Math.PI;
    const st = { c: Math.cos(a), s: Math.sin(a), len: 0.06 + rand() * 0.16, wid: 0.012 + rand() * 0.03, sheen: rand() ** 2.5, phase: rand() };
    const x = rand();
    const y = rand();
    st.x = x;
    st.y = y;
    strips.push(st);
    const r = Math.ceil((st.len / 2 + st.wid) * S);
    const cx = Math.round(x * S);
    const cy = Math.round(y * S);
    for (let py = cy - r; py <= cy + r; py++) {
      for (let px = cx - r; px <= cx + r; px++) {
        const dx = px / S - x;
        const dy = py / S - y;
        const along = dx * st.c + dy * st.s;
        const across = -dx * st.s + dy * st.c;
        // A strip with tapered, frayed ends.
        const end = Math.max(0, Math.abs(along) - st.len / 2 + st.wid);
        if (Math.abs(across) + end * 0.6 > st.wid / 2 || Math.abs(along) > st.len / 2) continue;
        id[(((py % S) + S) % S) * S + (((px % S) + S) % S)] = n;
      }
    }
  }
  const fibre = noiseGrid(rand, 4, 180);
  return (u, v, o) => {
    const x = Math.min(S - 1, Math.floor(u * S));
    const y = Math.min(S - 1, Math.floor(v * S));
    const k = id[y * S + x];
    if (k < 0) {
      o.h = 0.2;
      o.k = 0.02;
      o.r = 1.1;
      return;
    }
    const st = strips[k];
    const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => id[((y + dy + S) % S) * S + ((x + dx + S) % S)] !== k);
    const along = frac((u - st.x) * st.c + (v - st.y) * st.s + st.phase);
    const across = frac(-(u - st.x) * st.s + (v - st.y) * st.c + st.phase);
    const f = fibre(along, across);
    o.h = 0.5 + (k % 7) * 0.03 + (f - 0.5) * 0.25 - (edge ? 0.2 : 0);
    o.k = edge ? 0.03 : 0.04 + st.sheen * 0.75 * (0.7 + f * 0.6);
    o.r = 0.85 + (1 - st.sheen) * 0.3;
    o.ax = st.c;
    o.ay = st.s;
    o.as = edge ? 0 : 0.85;
  };
}

// Brushed metal: fine lines along u, a few deeper scratches, the brushing
// catching the light along its length.
function brushed(size) {
  const rand = rng(3);
  const rows = new Float32Array(size);
  for (let y = 0; y < size; y++) rows[y] = rand();
  const soft = rows.map((_, y) => (rows[y] * 0.5 + rows[(y + 1) % size] * 0.25 + rows[(y + size - 1) % size] * 0.25));
  const scratches = Array.from({ length: 24 }, () => ({ y: rand(), x: rand(), len: 0.2 + rand() * 0.6, k: 0.3 + rand() * 0.7 }));
  const drift = noiseField(rand, 6);
  return (u, v, o) => {
    const y = Math.floor(v * size) % size;
    let line = soft[y] * 0.7 + rows[y] * 0.3;
    for (const sc of scratches) {
      if (Math.abs(v - sc.y) * size > 0.7) continue;
      const along = frac(u - sc.x);
      if (along < sc.len) line -= sc.k * 0.6 * Math.sin(Math.PI * along / sc.len);
    }
    const d = drift(u, v);
    o.h = 0.5 + (line - 0.5) * 0.5;
    o.k = 0.9 + (line - 0.5) * 0.14 + (d - 0.5) * 0.08;
    o.r = 0.9 + (line - 0.5) * 0.3 + (d - 0.5) * 0.2;
    o.ax = 1;
    o.ay = 0;
    o.as = 0.8;
  };
}

// A fine random surface: bead blasting, phosphate crystals, Cerakote's
// orange peel, grip rubber. `cells` makes a crystalline speckle.
function grain({ seed, fine = 0.6, peel = 0, cells = 0, pebble = 0 }) {
  const rand = rng(seed);
  const noise = noiseField(rand, 192);
  const noise2 = noiseField(rand, 97);
  const orange = fbm(rand, [12, 24], [0.6, 0.4]);
  const pts = cells ? points(rand, cells) : null;
  const pb = pebble ? points(rand, pebble) : null;
  return (u, v, o) => {
    let h = (noise(u, v) - 0.5) * fine + (noise2(u, v) - 0.5) * fine * 0.5;
    let k = 0.94 + (noise2(u, v) - 0.5) * 0.08;
    let r = 1 + (noise(u, v) - 0.5) * 0.25;
    if (peel) h += (orange(u, v) - 0.5) * peel;
    if (pts) {
      const { p, d1, d2 } = nearest(pts, u, v);
      const edge = clamp01((d2 - d1) * cells * 0.9);
      h += (p.s - 0.5) * 0.4 - (1 - edge) * 0.3;
      k += (p.s - 0.5) * 0.18;
      r += (p.t - 0.5) * 0.25;
    }
    if (pb) {
      const { d1 } = nearest(pb, u, v);
      const bump = clamp01(1 - d1 * Math.sqrt(pebble) * 2.2);
      h += Math.sqrt(bump) * 0.8;
      r -= bump * 0.15;
    }
    o.h = 0.5 + h;
    o.k = k;
    o.r = r;
  };
}

// Stippled polymer, as on a grip: a field of melted-in dimples.
function stipple() {
  const rand = rng(19);
  const pts = points(rand, 260);
  const fine = noiseField(rand, 160);
  return (u, v, o) => {
    const { d1 } = nearest(pts, u, v);
    const r = 0.028;
    const dimple = d1 < r ? Math.sqrt(1 - (d1 / r) ** 2) : 0;
    o.h = 0.7 - dimple * 0.7 + (fine(u, v) - 0.5) * 0.15;
    o.k = 0.93 + dimple * 0.07;
    o.r = 1 - dimple * 0.1;
  };
}

// Diamond knurling: two sets of grooves at 45 degrees leaving pyramids.
function knurl(N) {
  return (u, v, o) => {
    const a = frac((u + v) * N);
    const b = frac((u - v) * N);
    const tri = (x) => 1 - Math.abs(x - 0.5) * 2;
    const h = Math.min(tri(a), tri(b));
    o.h = h;
    o.k = 0.75 + h * 0.25;
    o.r = 1.2 - h * 0.4;
  };
}

// Bluing: a deep blue-black oxide with polishing lines under it.
function blued() {
  const base = brushed(512);
  const rand = rng(23);
  const cloud = fbm(rand, [3, 7, 15], [0.5, 0.3, 0.2]);
  return (u, v, o) => {
    base(u, v, o);
    o.h = 0.5 + (o.h - 0.5) * 0.35;
    const c = cloud(u, v);
    o.cr = mix(0.02, 0.035, c);
    o.cg = mix(0.03, 0.04, c);
    o.cb = mix(0.06, 0.1, c);
    o.as = 0.35;
  };
}

// Heat-tinted titanium, like an exhaust tip: bands of straw, bronze,
// purple and blue flowing along the part.
function burntTitanium() {
  const base = brushed(512);
  const rand = rng(29);
  const warp = fbm(rand, [3, 6, 12], [0.55, 0.3, 0.15]);
  const stops = ['#c9b27a', '#b07a3c', '#7d3f8c', '#3d4fb8', '#3f8fc0', '#9fc3cf', '#c9b27a'].map((h) => new THREE.Color(h));
  const tmp = new THREE.Color();
  return (u, v, o) => {
    base(u, v, o);
    o.h = 0.5 + (o.h - 0.5) * 0.4;
    const t = frac(u + (warp(u, v) - 0.5) * 0.35);
    const x = t * (stops.length - 1);
    const i = Math.floor(x);
    tmp.copy(stops[i]).lerp(stops[i + 1], x - i);
    o.cr = tmp.r;
    o.cg = tmp.g;
    o.cb = tmp.b;
    o.as = 0.5;
  };
}

// Laminated wood, as on hunting stocks: glued layers in two or three tones,
// cut at an angle so they sweep in waves.
function laminate(colors) {
  const rand = rng(31);
  const wave = fbm(rand, [2, 5, 11], [0.6, 0.28, 0.12]);
  const pore = noiseField(rand, 220);
  const layers = [];
  let y = 0;
  while (y < 1) {
    const t = 0.015 + rand() * 0.025;
    layers.push({ y, c: colors[layers.length % colors.length].map((c) => c * (0.9 + rand() * 0.2)) });
    y += t;
  }
  const n = layers.length;
  return (u, v, o) => {
    const w = frac(v + (wave(u, v) - 0.5) * 0.12);
    let k = 0;
    while (k < n - 1 && layers[k + 1].y <= w) k++;
    const c = layers[k].c;
    const p = pore(u, v);
    const dark = p < 0.3 ? 0.8 : 1;
    o.cr = c[0] * dark;
    o.cg = c[1] * dark;
    o.cb = c[2] * dark;
    o.h = 0.5 + (p < 0.3 ? -0.3 : 0);
    o.r = 1;
  };
}

// Walnut: straight grain in light and dark bands with long open pores,
// under an oil finish.
function walnut() {
  const rand = rng(42);
  const n = fbm(rand, [3, 6, 12], [0.6, 0.3, 0.1]);
  const pore = noiseGrid(rand, 24, 300);
  const figure = noiseGrid(rand, 3, 40);
  return (u, v, o) => {
    const w = v * 26 + n(u, v) * 3;
    const ring = frac(w);
    const late = Math.pow(Math.sin(Math.PI * ring), 6); // the dark latewood line
    const f = figure(u, v);
    const p = pore(u, v);
    const open = clamp01((0.25 - p) * 12);
    const tone = (0.8 + f * 0.4) * (1 - late * 0.5) * (1 - open * 0.2);
    o.cr = 0.15 * tone;
    o.cg = 0.07 * tone;
    o.cb = 0.032 * tone;
    o.h = 0.5 - late * 0.06 - open * 0.05;
    o.r = 1 + open * 0.25;
  };
}

// The materials. `tile` is the size of one texture tile in metres; `bump`
// scales the height into the normal map; `size` is the texture's pixels.
// `color` is a fixed colour (sRGB hex) the texture shades, or none for a
// texture that draws its own colours (cr, cg, cb, linear 0..1) or that
// shades a colour chosen by the player.
export const MATERIALS = {
  carbon: { tile: 0.032, size: 512, bump: 3, make: () => carbonTwill(16), color: '#0d0e10', sheen: '#40464f' },
  forged: { tile: 0.1, size: 512, bump: 1.5, make: () => forgedCarbon(512), color: '#0b0c0e', sheen: '#8a9099' },
  brushedSteel: { tile: 0.1, size: 512, bump: 0.6, make: () => brushed(512) },
  brushedAlu: { tile: 0.1, size: 512, bump: 0.6, make: () => brushed(512) },
  beadblast: { tile: 0.02, size: 256, bump: 1.2, make: () => grain({ seed: 5, fine: 0.8 }) },
  parkerized: { tile: 0.016, size: 256, bump: 1.4, make: () => grain({ seed: 13, fine: 0.4, cells: 140 }) },
  blued: { tile: 0.1, size: 512, bump: 0.6, make: blued, own: true },
  titanium: { tile: 0.14, size: 512, bump: 0.6, make: burntTitanium, own: true },
  brass: { tile: 0.1, size: 512, bump: 0.4, make: () => brushed(512) },
  knurled: { tile: 0.012, size: 256, bump: 6, make: () => knurl(10) },
  cerakote: { tile: 0.03, size: 256, bump: 0.5, make: () => grain({ seed: 17, fine: 0.25, peel: 0.8 }) },
  stipple: { tile: 0.04, size: 512, bump: 4, make: stipple },
  rubber: { tile: 0.02, size: 256, bump: 2.5, make: () => grain({ seed: 37, fine: 0.3, pebble: 90 }) },
  laminate: { tile: 0.08, size: 512, bump: 0.8, make: () => laminate([rgb('#4a3020'), rgb('#302a26'), rgb('#6e5236')].map((c) => c.map((x) => (x / 255) ** 2.2))), own: true },
  walnut: { tile: 0.25, size: 512, bump: 0.8, make: walnut, own: true },
};

// Bake a material's maps once: its shade (0..1 between two colours) or its
// own colours, and canvases for the normal, roughness (green) and
// anisotropy direction and strength.
function bake(id) {
  const M = MATERIALS[id];
  const S = M.size;
  const fn = M.make();
  const H = new Float32Array(S * S);
  const K = new Float32Array(S * S);
  const own = M.own ? new Uint8ClampedArray(S * S * 4) : null;
  const rough = new Uint8ClampedArray(S * S * 4);
  const aniso = new Uint8ClampedArray(S * S * 4);
  let hasAniso = false;
  const o = {};
  const srgb = (x) => Math.round(Math.pow(clamp01(x), 1 / 2.2) * 255);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      for (const k in o) delete o[k];
      fn((x + 0.5) / S, (y + 0.5) / S, o);
      const i = y * S + x;
      const q = i * 4;
      H[i] = o.h ?? 0.5;
      K[i] = clamp01(o.k ?? 1);
      if (own) {
        own[q] = srgb(o.cr);
        own[q + 1] = srgb(o.cg);
        own[q + 2] = srgb(o.cb);
        own[q + 3] = 255;
      }
      rough[q + 1] = Math.round(clamp01((o.r ?? 1) / 1.5) * 255); // x1.5 in the material
      rough[q + 3] = 255;
      if (o.as) hasAniso = true;
      aniso[q] = Math.round((0.5 + 0.5 * (o.ax ?? 1)) * 255);
      aniso[q + 1] = Math.round((0.5 + 0.5 * (o.ay ?? 0)) * 255);
      aniso[q + 2] = Math.round(clamp01(o.as ?? 0) * 255);
      aniso[q + 3] = 255;
    }
  }
  // Normals from the height's slopes, wrapping at the edges so it tiles.
  // Canvas rows run down while v runs up, hence the sign on y.
  const nor = new Uint8ClampedArray(S * S * 4);
  const k = M.bump * (S / 256);
  const at = (xx, yy) => H[((yy + S) % S) * S + ((xx + S) % S)];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * k;
      const dy = (at(x, y + 1) - at(x, y - 1)) * k;
      const len = Math.hypot(dx, dy, 1);
      const q = (y * S + x) * 4;
      nor[q] = Math.round((0.5 - 0.5 * dx / len) * 255);
      nor[q + 1] = Math.round((0.5 + 0.5 * dy / len) * 255);
      nor[q + 2] = Math.round((0.5 + 0.5 / len) * 255);
      nor[q + 3] = 255;
    }
  }
  return { S, K, own: own && canvasOf(own, S), normal: canvasOf(nor, S), rough: canvasOf(rough, S), aniso: hasAniso ? canvasOf(aniso, S) : null };
}

function canvasOf(data, S) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  c.getContext('2d').putImageData(new ImageData(data, S, S), 0, 0);
  return c;
}

// The colour map: the shade between two colours, or grey (multiplied by a
// colour the player picks).
function shadeCanvas(b, pair) {
  const [c1, c2] = pair ? pair.map((h) => new THREE.Color(h)) : [new THREE.Color(0, 0, 0), new THREE.Color(1, 1, 1)];
  const data = new Uint8ClampedArray(b.S * b.S * 4);
  for (let i = 0; i < b.K.length; i++) {
    const k = b.K[i];
    const q = i * 4;
    data[q] = Math.round(Math.pow(mix(c1.r, c2.r, k), 1 / 2.2) * 255);
    data[q + 1] = Math.round(Math.pow(mix(c1.g, c2.g, k), 1 / 2.2) * 255);
    data[q + 2] = Math.round(Math.pow(mix(c1.b, c2.b, k), 1 / 2.2) * 255);
    data[q + 3] = 255;
  }
  return canvasOf(data, b.S);
}

const baked = new Map(); // id -> bake()
const sets = new Map(); // id|colours|scale -> textures, oldest first
const MAX_SETS = 40;

const texture = (c, srgb, tile) => {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.repeat.set(1 / tile, 1 / tile);
  return t;
};

// The textures for material `id` at `scale` times its real size, made the
// first time they're asked for. `colors` ([base, sheen], hex) recolours a
// material that shades between two colours, such as carbon.
export function materialTextures(id, colors = null, scale = 1) {
  const M = MATERIALS[id];
  const pair = M.own ? null : colors || (M.color ? [M.color, M.sheen] : null);
  const key = `${id}|${pair ? pair.join() : ''}|${scale}`;
  let t = sets.get(key);
  if (t) {
    sets.delete(key); // most recently used goes last
    sets.set(key, t);
    return t;
  }
  let b = baked.get(id);
  if (!b) baked.set(id, (b = bake(id)));
  const tile = M.tile * scale;
  t = {
    map: texture(b.own || shadeCanvas(b, pair), true, tile),
    normalMap: texture(b.normal, false, tile),
    roughnessMap: texture(b.rough, false, tile),
    anisotropyMap: b.aniso ? texture(b.aniso, false, tile) : null,
  };
  sets.set(key, t);
  // Free the GPU copies of sets not used lately (a material still holding
  // one just uploads it again).
  while (sets.size > MAX_SETS) {
    const [k, old] = sets.entries().next().value;
    sets.delete(k);
    for (const x of Object.values(old)) if (x) x.dispose();
  }
  return t;
}
