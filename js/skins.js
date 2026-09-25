// Procedural weapon skins and stickers. Everything here is drawn in code;
// no artwork is copied from any game.
import * as THREE from '../vendor/three.module.min.js';

const TAU = Math.PI * 2;

export const PATTERNS = {
  original: 'Original (model textures)',
  champions: 'Champions 2021',
  casehardened: 'Case Hardened',
  solid: 'Solid',
  fade: 'Fade',
  camo: 'Woodland camo',
  digital: 'Digital camo',
  carbon: 'Carbon fibre',
  hex: 'Hex grid',
  stripes: 'Tiger stripe',
  splatter: 'Splatter',
  damascus: 'Damascus steel',
};

// What each colour slot does in a pattern, for the form labels.
export const COLOR_ROLES = {
  original: ['Simple model paint', null, null],
  champions: ['Base', 'Gold stripes', 'Red accents'],
  casehardened: ['Blue', 'Gold', 'Purple'],
  solid: ['Paint', null, null],
  fade: ['Rear', 'Middle', 'Front'],
  camo: ['Base', 'Dark blotches', 'Light blotches'],
  digital: ['Base', 'Mid pixels', 'Dark pixels'],
  carbon: ['Weave', 'Sheen', null],
  hex: ['Base', 'Grid lines', 'Filled cells'],
  stripes: ['Base', 'Stripes', null],
  splatter: ['Base', 'Splash 1', 'Splash 2'],
  damascus: ['Light steel', 'Dark steel', null],
};

export const FINISHES = {
  matte: { label: 'Matte', roughness: 0.82, metalness: 0 },
  satin: { label: 'Satin', roughness: 0.55, metalness: 0.15 },
  gloss: { label: 'Gloss', roughness: 0.22, metalness: 0 },
  anodized: { label: 'Anodized', roughness: 0.28, metalness: 0.62 },
  metallic: { label: 'Metallic', roughness: 0.3, metalness: 0.88 },
  clear: { label: 'Clear glossy plastic', roughness: 0.05, metalness: 0, clear: true },
};

// Solid choices for a gun's zones (stock, grip, magazine, suppressor, scope
// and so on); 'skin' paints the zone with the pattern instead, and 'factory'
// shows a detailed model's own textures (black on the simple models).
export const ZONE_FINISHES = {
  skin: { label: 'Skin pattern' },
  factory: { label: 'Factory (model textures)' },
  black: { label: 'Black polymer', color: '#16171a', roughness: 0.7, metalness: 0.05 },
  tan: { label: 'Tan polymer', color: '#b59a70', roughness: 0.72, metalness: 0.02 },
  wood: { label: 'Wood', color: '#ffffff', roughness: 0.6, metalness: 0, wood: true },
  gray: { label: 'Gunmetal polymer', color: '#3f444c', roughness: 0.62, metalness: 0.1 },
  gold: { label: 'Gold', color: '#e9ad3c', roughness: 0.24, metalness: 1 },
  silver: { label: 'Silver polymer', color: '#a8a79f', roughness: 0.58, metalness: 0.08 },
  steel: { label: 'Steel', color: '#9aa1aa', roughness: 0.32, metalness: 1 },
  clear: { label: 'Clear plastic', color: '#dbe8f3', roughness: 0.05, metalness: 0, clear: true },
  clearTint: { label: 'Tinted clear plastic (skin colour)', roughness: 0.05, metalness: 0, clear: true, tint: true },
  // Your own colour for the part (`custom`: picked per part).
  paint: { label: 'Custom colour, matte', custom: true, roughness: 0.75, metalness: 0.05 },
  paintGloss: { label: 'Custom colour, gloss', custom: true, roughness: 0.2, metalness: 0.05 },
  paintMetal: { label: 'Custom colour, metallic', custom: true, roughness: 0.3, metalness: 0.9 },
  // Lit parts: a neon glow in your colour, or RGB lights cycling the rainbow.
  // Both flare with each shot.
  neon: { label: 'Neon glow (custom colour)', custom: true, light: true, roughness: 0.4, metalness: 0 },
  rgb: { label: 'RGB lights (colour cycle)', rgb: true, light: true, color: '#1a1a1f', roughness: 0.4, metalness: 0 },
};
// A starting colour for a custom part.
export const ZONE_COLOR_DEFAULT = { paint: '#c8342b', paintGloss: '#c8342b', paintMetal: '#3a6fd8', neon: '#2f8bff' };

// Starting points; every value can be changed afterwards. `zones` names the
// solid finishes by part kind; parts not listed wear the pattern. `fx` is the
// fire effect. Fade copies the colour scheme of the reference: crimson at the
// front, magenta and purple through the receiver, blue at the rear, a gold
// suppressor and black furniture.
export const SKIN_PRESETS = {
  original: { name: 'Original', pattern: 'original', c1: '#2b2e33', c2: '#4a4f57', c3: '#7d848e', finish: 'satin', wear: 0.02, scale: 1, seed: 1, zones: {}, fx: { type: 'none', color: '#ffd27a', glow: false } },
  // The finish of the Champions 2021 Vandal the project owner supplied:
  // gold claw stripes on black, red accents, silver furniture, and the
  // "Champions" wordmark on the receiver. Colours sampled from its texture.
  // Heat-quenched steel like CS2's Case Hardened: blue and purple pools on
  // silver and gold, the furniture left as it is. The seed picks the layout.
  casehardened: { name: 'Case Hardened', pattern: 'casehardened', c1: '#3f79d8', c2: '#c9a24a', c3: '#5a3aa8', blue: 0.3, finish: 'anodized', wear: 0.03, scale: 1, seed: 661, zones: { metal: 'skin' }, fx: { type: 'none', color: '#ffd27a', glow: false } },
  bluegem: { name: 'Blue Gem', pattern: 'casehardened', c1: '#356fe0', c2: '#c9a24a', c3: '#5a3aa8', blue: 0.8, finish: 'anodized', wear: 0.01, scale: 1, seed: 387, zones: { metal: 'skin' }, fx: { type: 'tracer', color: '#6fb6ff', glow: false } },
  champions: { name: 'Champions 2021', featured: true, pattern: 'champions', c1: '#151615', c2: '#a8904f', c3: '#c31a1d', finish: 'satin', wear: 0.02, scale: 1, seed: 21, zones: { metal: 'skin' }, fx: { type: 'tracer', color: '#ffcf5a', glow: false } },
  // After VALORANT's Afterglow: a black frame traced with glowing neon light
  // bars and rows of lit segments, in three chromas; and an RGB version whose
  // lights cycle the rainbow. The light bars are an overlay (`lights`) that
  // any pattern can wear.
  afterglow: { name: 'Afterglow', pattern: 'solid', c1: '#0c0d11', c2: '#2a2d33', c3: '#000000', finish: 'satin', wear: 0, scale: 1, seed: 5, lights: { type: 'neon', color: '#2f7dff', accent: '#8fe6ff', seed: 5 }, zones: { metal: 'skin' }, fx: { type: 'tracer', color: '#4f95ff', glow: false } },
  afterglowGold: { name: 'Afterglow Gold', pattern: 'solid', c1: '#0c0d11', c2: '#2a2d33', c3: '#000000', finish: 'satin', wear: 0, scale: 1, seed: 5, lights: { type: 'neon', color: '#ffab2e', accent: '#ffe07a', seed: 5 }, zones: { metal: 'skin' }, fx: { type: 'tracer', color: '#ffb640', glow: false } },
  afterglowPurple: { name: 'Afterglow Violet', pattern: 'solid', c1: '#0c0d11', c2: '#2a2d33', c3: '#000000', finish: 'satin', wear: 0, scale: 1, seed: 5, lights: { type: 'neon', color: '#8a4dff', accent: '#d7b8ff', seed: 5 }, zones: { metal: 'skin' }, fx: { type: 'tracer', color: '#a070ff', glow: false } },
  rgb: { name: 'RGB', pattern: 'solid', c1: '#0c0d11', c2: '#2a2d33', c3: '#000000', finish: 'satin', wear: 0, scale: 1, seed: 5, lights: { type: 'rgb', color: '#ffffff', accent: '#ffffff', seed: 5 }, zones: { metal: 'skin' }, fx: { type: 'tracer', color: '#ffffff', glow: false } },
  fade: { name: 'Fade', pattern: 'fade', c1: '#3a5ae8', c2: '#b02ec2', c3: '#e8234d', finish: 'anodized', wear: 0.01, scale: 1, seed: 1, zones: { stock: 'black', grip: 'black', foregrip: 'black', butt: 'black', suppressor: 'gold' }, fx: { type: 'plasma', color: '#ff4fd8', glow: true } },
  recon: { name: 'Recon Digital', pattern: 'digital', c1: '#dfe4ea', c2: '#8a97a6', c3: '#34414f', finish: 'matte', wear: 0.04, scale: 0.55, seed: 9, zones: { stock: 'gray', grip: 'gray', foregrip: 'gray', mag: 'gray', butt: 'black' }, fx: { type: 'tracer', color: '#5fd8ff', glow: false } },
  coyote: { name: 'Coyote', pattern: 'solid', c1: '#a8875c', c2: '#8a6d49', c3: '#5e4a33', finish: 'matte', wear: 0.05, scale: 1, seed: 1, zones: { stock: 'tan', grip: 'tan', foregrip: 'tan', mag: 'black', butt: 'black' }, fx: { type: 'none', color: '#ffb35c', glow: false } },
  factory: { name: 'Gunmetal', pattern: 'solid', c1: '#2a2d32', c2: '#4a4f57', c3: '#7d848e', finish: 'satin', wear: 0.06, scale: 1, seed: 1, zones: { stock: 'black', grip: 'black', foregrip: 'black', butt: 'black' }, fx: { type: 'none', color: '#ffd27a', glow: false } },
  woodland: { name: 'Woodland', pattern: 'camo', c1: '#56663f', c2: '#2c3622', c3: '#8e7b52', finish: 'matte', wear: 0.24, scale: 1, seed: 7, zones: { butt: 'black' }, fx: { type: 'none', color: '#ffb35c', glow: false } },
  arctic: { name: 'Arctic Digital', pattern: 'digital', c1: '#dde4ea', c2: '#98a5b2', c3: '#4b5764', finish: 'matte', wear: 0.14, scale: 1, seed: 3, zones: { butt: 'black' }, fx: { type: 'tracer', color: '#dff4ff', glow: false } },
  carbon: { name: 'Carbon Weave', pattern: 'carbon', c1: '#141619', c2: '#454c56', c3: '#000000', finish: 'gloss', wear: 0.04, scale: 1, seed: 1, zones: { mag: 'steel', suppressor: 'steel', scope: 'steel', butt: 'black' }, fx: { type: 'tracer', color: '#ffffff', glow: false } },
  ember: { name: 'Ember Tiger', pattern: 'stripes', c1: '#ff8a1e', c2: '#1b120d', c3: '#000000', finish: 'gloss', wear: 0.1, scale: 1, seed: 11, zones: { stock: 'black', grip: 'black', foregrip: 'black', butt: 'black' }, fx: { type: 'flame', color: '#ff7a1a', glow: true } },
  cobalt: { name: 'Cobalt Hex', pattern: 'hex', c1: '#10284d', c2: '#46b3ff', c3: '#0b1a36', finish: 'satin', wear: 0.05, scale: 1, seed: 5, zones: { mag: 'steel', suppressor: 'steel', scope: 'steel', butt: 'black' }, fx: { type: 'lightning', color: '#5cc8ff', glow: true } },
  neon: { name: 'Neon Splatter', pattern: 'splatter', c1: '#17171f', c2: '#3dfc9b', c3: '#ff3df0', finish: 'gloss', wear: 0.05, scale: 1, seed: 21, zones: { stock: 'black', grip: 'black', foregrip: 'black', butt: 'black' }, fx: { type: 'spectral', color: '#3dfc9b', glow: true } },
  ice: { name: 'Clear Ice', pattern: 'solid', c1: '#8fd3ff', c2: '#dff4ff', c3: '#2a6f9e', finish: 'clear', wear: 0, scale: 1, seed: 4, zones: { grip: 'black', stock: 'clear', mag: 'clear', suppressor: 'steel', scope: 'steel', butt: 'black' }, fx: { type: 'tracer', color: '#bfeaff', glow: false } },
  doppler: { name: 'Doppler', pattern: 'splatter', c1: '#140c2e', c2: '#7b2ff7', c3: '#ff4fb8', finish: 'metallic', wear: 0, scale: 1.4, seed: 17, zones: { stock: 'black', grip: 'black', foregrip: 'black', butt: 'black' }, fx: { type: 'spectral', color: '#b36bff', glow: true } },
  tigertooth: { name: 'Tiger Tooth', pattern: 'stripes', c1: '#f5a623', c2: '#7a3b06', c3: '#000000', finish: 'metallic', wear: 0, scale: 1, seed: 8, zones: { stock: 'black', grip: 'black', foregrip: 'black', butt: 'black' }, fx: { type: 'flame', color: '#ffb02e', glow: false } },
  smoke: { name: 'Smoke Glass', pattern: 'solid', c1: '#6d7580', c2: '#aab3bd', c3: '#2d3238', finish: 'clear', wear: 0, scale: 1, seed: 3, zones: { grip: 'black', mag: 'clearTint', suppressor: 'black', scope: 'black', butt: 'black' }, fx: { type: 'tracer', color: '#e6edf5', glow: false } },
  damascus: { name: 'Damascus', pattern: 'damascus', c1: '#8a919b', c2: '#2c3036', c3: '#000000', finish: 'metallic', wear: 0.03, scale: 1, seed: 2, zones: { stock: 'black', grip: 'black', foregrip: 'black', mag: 'steel', suppressor: 'steel', scope: 'steel', butt: 'black' }, fx: { type: 'none', color: '#ffd27a', glow: false } },
};

// Keys that change the paint itself (texture, materials); zones and fx are
// applied separately.
export const SKIN_KEYS = ['pattern', 'c1', 'c2', 'c3', 'finish', 'wear', 'scale', 'seed', 'fadeReverse', 'blue'];

// A random skin that still looks designed: one hue, its complement, a dark.
export function randomSkin(rand = Math.random) {
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const h = rand() * 360;
  const hsl = (hh, ss, ll) => `#${new THREE.Color().setHSL((((hh % 360) + 360) % 360) / 360, ss, ll).getHexString()}`;
  const pattern = pick(Object.keys(PATTERNS));
  const fxType = pick(['none', 'tracer', 'plasma', 'flame', 'spectral', 'lightning']);
  return {
    pattern,
    c1: hsl(h, 0.6 + rand() * 0.3, 0.42 + rand() * 0.2),
    c2: hsl(h + 150 + rand() * 60, 0.6 + rand() * 0.3, 0.4 + rand() * 0.25),
    c3: rand() < 0.5 ? hsl(h + 30, 0.3, 0.12) : hsl(h - 60, 0.7, 0.55),
    finish: pick(Object.keys(FINISHES)),
    wear: Math.round(rand() * rand() * 60) / 100,
    scale: Math.round((0.6 + rand() * 1.2) * 20) / 20,
    seed: 1 + Math.floor(rand() * 998),
    fadeReverse: rand() < 0.5,
    fx: { type: fxType, color: hsl(h + (rand() < 0.5 ? 0 : 180), 0.9, 0.62), glow: rand() < 0.6 },
  };
}

export function wearLabel(w) {
  if (w < 0.07) return 'Pristine';
  if (w < 0.15) return 'Light wear';
  if (w < 0.38) return 'Used';
  if (w < 0.45) return 'Worn';
  return 'Battered';
}

// ------------------------------------------------------------ drawing tools
export function rng(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shade(hex, k) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return `#${c.getHexString()}`;
}

// Tileable value noise on a `period` grid, sampled at (x, y) in [0, 1).
function noiseField(rand, period) {
  const g = Array.from({ length: period * period }, rand);
  const at = (i, j) => g[((j % period + period) % period) * period + ((i % period + period) % period)];
  return (x, y) => {
    const fx = x * period;
    const fy = y * period;
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

// Run a drawing function at all nine offsets so shapes wrap across edges.
function wrapped(W, H, fn) {
  for (const dx of [-W, 0, W]) for (const dy of [-H, 0, H]) fn(dx, dy);
}

function blob(g, rand, cx, cy, r) {
  const n = 9;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const rr = r * (0.55 + rand() * 0.6);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * (0.6 + rand() * 0.5)]);
  }
  g.beginPath();
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  let m = mid(pts[n - 1], pts[0]);
  g.moveTo(m[0], m[1]);
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    m = mid(p, pts[(i + 1) % n]);
    g.quadraticCurveTo(p[0], p[1], m[0], m[1]);
  }
  g.fill();
}

function grain(g, W, H, rand, amount) {
  for (let i = 0; i < amount; i++) {
    g.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.04)';
    g.fillRect(rand() * W, rand() * H, 1.5, 1.5);
  }
}

// --------------------------------------------------------------- patterns
// Case Hardened: two warped noise fields over a tile that repeats. One sets
// the heat colour of the steel (silver through pale gold to amber); the
// other marks the blue pools, deepening to purple, with a purple fringe at
// their edges. `blue` (0..1) is how much of the steel turned blue.
function caseHardened(g, W, H, s, rand) {
  const R = 256; // drawn small and scaled up; the colours are soft anyway
  const fbm = (fields, weights) => (u, v) => fields.reduce((a, f, i) => a + f(u, v) * weights[i], 0);
  const heat = fbm([noiseField(rand, 3), noiseField(rand, 6), noiseField(rand, 12), noiseField(rand, 28)], [0.5, 0.28, 0.15, 0.07]);
  const pool = fbm([noiseField(rand, 2), noiseField(rand, 5), noiseField(rand, 11), noiseField(rand, 24)], [0.46, 0.3, 0.16, 0.08]);
  const wu = noiseField(rand, 4);
  const wv = noiseField(rand, 4);
  const speck = noiseField(rand, 64);
  // Raw sRGB values: these go straight into canvas pixels.
  const col = (hex) => new THREE.Color().setHex(parseInt(String(hex).slice(1), 16), THREE.LinearSRGBColorSpace);
  const blue = col(s.c1);
  const gold = col(s.c2);
  const purple = col(s.c3);
  const silver = col('#c9c6ba');
  const pale = silver.clone().lerp(gold, 0.45);
  const amber = gold.clone().multiplyScalar(0.72);
  const light = blue.clone().lerp(col('#cfe6f7'), 0.55);
  const steel = [silver, pale, gold, amber];
  const halo = col('#eef0ec');
  // Sample both fields over the tile first, so `blue` can be a true share of
  // the surface: the pool threshold is taken from the sampled values.
  const N = R * R;
  const heatV = new Float32Array(N);
  const poolV = new Float32Array(N);
  for (let y = 0; y < R; y++) {
    for (let x = 0; x < R; x++) {
      let u = x / R;
      let v = y / R;
      // Two passes of warping give the swirled, marbled edges of quenched steel.
      const du = (wu(u, v) - 0.5) * 0.2;
      const dv = (wv(u, v) - 0.5) * 0.2;
      u += du + (wv(u + du, v + dv) - 0.5) * 0.12;
      v += dv + (wu(u + du, v + dv) - 0.5) * 0.12;
      heatV[y * R + x] = heat(u, v);
      poolV[y * R + x] = pool(u, v);
    }
  }
  const sorted = Float32Array.from(poolV).sort();
  const share = Math.min(0.95, Math.max(0, s.blue ?? 0.3));
  const cut = sorted[Math.min(N - 1, Math.floor((1 - share) * N))];
  const top = sorted[N - 1];
  const hs = Float32Array.from(heatV).sort();
  const h0 = hs[Math.floor(N * 0.05)];
  const h1 = hs[Math.floor(N * 0.95)];
  const c = document.createElement('canvas');
  c.width = c.height = R;
  const cg = c.getContext('2d');
  const img = cg.createImageData(R, R);
  const t = new THREE.Color();
  const b = new THREE.Color();
  const smooth = (a, bb, x) => { const k = Math.min(1, Math.max(0, (x - a) / (bb - a))); return k * k * (3 - 2 * k); };
  const rimW = 0.025;
  for (let n = 0; n < N; n++) {
    const x = n % R;
    const y = (n - x) / R;
    // Steel heat colour, spread over the whole ramp.
    const hh = smooth(h0, h1, heatV[n]) * 2.999;
    const i = Math.floor(hh);
    t.copy(steel[i]).lerp(steel[Math.min(3, i + 1)], hh - i);
    const p = poolV[n];
    // A bright silver halo just outside each pool.
    t.lerp(halo, (1 - smooth(0, rimW * 2.5, Math.abs(p - (cut - rimW)))) * 0.5);
    if (share > 0 && p > cut - rimW) {
      // Pools: purple at the rim, royal blue, then a pale sky-blue centre.
      const depth = smooth(cut, cut + (top - cut) * 0.7, p);
      b.copy(purple).lerp(blue, smooth(0, 0.35, depth)).lerp(light, smooth(0.45, 1, depth));
      t.lerp(b, smooth(cut - rimW, cut + rimW * 0.4, p));
    }
    const k = 0.9 + speck(x / R, y / R) * 0.2;
    const o = n * 4;
    img.data[o] = Math.min(255, t.r * 255 * k);
    img.data[o + 1] = Math.min(255, t.g * 255 * k);
    img.data[o + 2] = Math.min(255, t.b * 255 * k);
    img.data[o + 3] = 255;
  }
  cg.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true;
  g.drawImage(c, 0, 0, W, H);
  grain(g, W, H, rand, 1200);
}

// Neon strips like VALORANT's Afterglow, laid out once per tile so they meet
// across tile edges: long rails along the gun that jog at 45 degrees, rows
// of lit segments, and short accent dashes. `paint(style, width)` is called
// for each stroke; `mode` 'base' draws the unlit surface, 'glow' the light.
function neonLayout(W, H, rand) {
  const rails = [];
  const n = 3;
  for (let i = 0; i < n; i++) {
    const y = ((i + 0.5) / n) * H + (rand() - 0.5) * H * 0.08;
    const jogs = 1 + Math.floor(rand() * 2);
    const pts = [[0, y]];
    let x = 0;
    for (let j = 0; j < jogs; j++) {
      // Up (or down) by d over d, run along, and back: the rail ends where it began.
      const d = (18 + rand() * 26) * (rand() < 0.5 ? -1 : 1);
      const x0 = x + 30 + rand() * (W / jogs - 160);
      const run = 40 + rand() * 60;
      pts.push([x0, y], [x0 + Math.abs(d), y + d], [x0 + Math.abs(d) + run, y + d], [x0 + 2 * Math.abs(d) + run, y]);
      x = x0 + 2 * Math.abs(d) + run;
    }
    pts.push([W, y]);
    rails.push(pts);
  }
  const bars = [];
  for (let i = 0; i < 2; i++) {
    const y = ((i + 1) / n) * H + (rand() - 0.5) * 16;
    const x = rand() * W;
    const count = 4 + Math.floor(rand() * 4);
    bars.push({ x, y, count, w: 16 + rand() * 8, h: 7 + rand() * 4, gap: 7 + rand() * 4 });
  }
  const dashes = [];
  for (let i = 0; i < 10; i++) dashes.push({ x: rand() * W, y: rand() * H, len: 10 + rand() * 24 });
  return { rails, bars, dashes };
}

// `mode` 'overlay' draws the unlit bars (and their seams) over whatever is
// on the canvas; 'glow' draws only the light, on black.
function drawNeon(g, W, H, rand, { strip, accent, mode, halo = 0 }) {
  const L = neonLayout(W, H, rand);
  if (mode === 'glow') {
    g.fillStyle = '#000000';
    g.fillRect(0, 0, W, H);
  }
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const stroke = (style, width) => {
    g.strokeStyle = style;
    g.lineWidth = width;
    for (const pts of L.rails) {
      wrapped(W, H, (dx, dy) => {
        g.beginPath();
        pts.forEach(([x, y], i) => (i ? g.lineTo(x + dx, y + dy) : g.moveTo(x + dx, y + dy)));
        g.stroke();
      });
    }
  };
  const housing = 'rgba(8,9,11,0.9)';
  if (mode !== 'glow') stroke(housing, 11); // the dark channel each bar sits in
  if (halo) {
    // A soft halo round each strip, so it reads as light on the surface.
    g.save();
    g.filter = `blur(${halo}px)`;
    stroke(strip, 14);
    g.restore();
  }
  stroke(strip, 6);
  if (mode !== 'glow') stroke('rgba(255,255,255,0.55)', 2); // hot core
  for (const b of L.bars) {
    for (let k = 0; k < b.count; k++) {
      const x = b.x + k * (b.w + b.gap);
      wrapped(W, H, (dx, dy) => {
        if (mode !== 'glow') {
          g.fillStyle = housing;
          g.fillRect(x + dx - 2, b.y + dy - b.h / 2 - 2, b.w + 4, b.h + 4);
        }
        g.fillStyle = accent;
        g.fillRect(x + dx, b.y + dy - b.h / 2, b.w, b.h);
      });
    }
  }
  g.strokeStyle = accent;
  g.lineWidth = 4;
  if (mode !== 'glow') {
    g.save();
    g.strokeStyle = housing;
    g.lineWidth = 8;
    for (const d of L.dashes) {
      wrapped(W, H, (dx, dy) => {
        g.beginPath();
        g.moveTo(d.x + dx, d.y + dy);
        g.lineTo(d.x + dx + d.len, d.y + dy);
        g.stroke();
      });
    }
    g.restore();
  }
  for (const d of L.dashes) {
    wrapped(W, H, (dx, dy) => {
      g.beginPath();
      g.moveTo(d.x + dx, d.y + dy);
      g.lineTo(d.x + dx + d.len, d.y + dy);
      g.stroke();
    });
  }
}

const DRAW = {
  casehardened: caseHardened,
  // Champions 2021: rows of tapered gold claw slashes on black, some in a
  // deeper gold, small splinters between them, and a few thin red bars.
  champions(g, W, H, s, rand) {
    g.fillStyle = s.c1;
    g.fillRect(0, 0, W, H);
    const deep = shade(s.c2, 0.66);
    const slash = (x, y, len, w, ang, bend, col) => wrapped(W, H, (dx, dy) => {
      g.save();
      g.translate(x + dx, y + dy);
      g.rotate(ang);
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(-len / 2, 0);
      g.bezierCurveTo(-len * 0.3, -w, len * 0.15, -w * 0.8 + bend, len / 2, bend);
      g.bezierCurveTo(len * 0.1, w * 0.1 + bend, -len * 0.25, w * 0.35, -len / 2, 0);
      g.fill();
      g.restore();
    });
    const rows = 6;
    for (let r = 0; r < rows; r++) {
      const y0 = ((r + 0.3 * rand()) / rows) * H;
      const per = 3 + Math.floor(rand() * 3);
      for (let k = 0; k < per; k++) {
        const len = 130 + rand() * 160;
        const w = 16 + rand() * 20;
        const x = rand() * W;
        const y = y0 + (rand() - 0.5) * 40;
        slash(x, y, len, w, -0.42 + (rand() - 0.5) * 0.35, (rand() - 0.5) * 16, rand() < 0.3 ? deep : s.c2);
      }
    }
    for (let i = 0; i < 26; i++) {
      slash(rand() * W, rand() * H, 24 + rand() * 50, 4 + rand() * 6, -0.42 + (rand() - 0.5) * 0.5, 0, rand() < 0.5 ? deep : s.c2);
    }
    for (let i = 0; i < 3; i++) {
      slash(rand() * W, rand() * H, 40 + rand() * 50, 5 + rand() * 3, -0.42, 0, s.c3);
    }
    grain(g, W, H, rand, 1800);
  },
  solid(g, W, H, s, rand) {
    g.fillStyle = s.c1;
    g.fillRect(0, 0, W, H);
    grain(g, W, H, rand, 2500);
  },
  fade(g, W, H, s, rand) {
    // Colour comes from the gradient along the gun; the texture adds grain.
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, W, H);
    grain(g, W, H, rand, 1500);
  },
  camo(g, W, H, s, rand) {
    g.fillStyle = s.c1;
    g.fillRect(0, 0, W, H);
    const layers = [[s.c2, 16, 70], [s.c3, 13, 55], [shade(s.c2, 0.55), 10, 38]];
    for (const [col, n, r] of layers) {
      g.fillStyle = col;
      for (let i = 0; i < n; i++) {
        const x = rand() * W;
        const y = rand() * H;
        const rr = r * (0.6 + rand() * 0.8);
        const seed = rand() * 1e9;
        wrapped(W, H, (dx, dy) => blob(g, rng(seed), x + dx, y + dy, rr));
      }
    }
    grain(g, W, H, rand, 1500);
  },
  digital(g, W, H, s, rand) {
    const n1 = noiseField(rand, 6);
    const n2 = noiseField(rand, 16);
    const cols = [s.c1, s.c2, s.c3, shade(s.c3, 0.6)];
    const px = 16;
    for (let y = 0; y < H; y += px) {
      for (let x = 0; x < W; x += px) {
        const v = n1(x / W, y / H) * 0.7 + n2(x / W, y / H) * 0.3;
        const k = v < 0.34 ? 3 : v < 0.44 ? 2 : v < 0.6 ? 0 : 1;
        g.fillStyle = cols[k];
        g.fillRect(x, y, px, px);
      }
    }
  },
  carbon(g, W, H, s) {
    const c = 16;
    for (let j = 0; j < H / c; j++) {
      for (let i = 0; i < W / c; i++) {
        const along = (i + j) % 2 === 0;
        const gr = along
          ? g.createLinearGradient(0, j * c, 0, j * c + c)
          : g.createLinearGradient(i * c, 0, i * c + c, 0);
        gr.addColorStop(0, s.c1);
        gr.addColorStop(0.5, s.c2);
        gr.addColorStop(1, s.c1);
        g.fillStyle = gr;
        g.fillRect(i * c, j * c, c, c);
      }
    }
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let k = 0; k < W; k += c) { g.fillRect(k, 0, 1, H); g.fillRect(0, k, W, 1); }
  },
  hex(g, W, H, s, rand) {
    const r = 16;
    const h = Math.sqrt(3) * r;
    g.fillStyle = s.c1;
    g.fillRect(0, 0, W, H);
    const hexPath = (cx, cy) => {
      g.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * TAU;
        const px = cx + Math.cos(a) * (r - 1.5);
        const py = cy + Math.sin(a) * (r - 1.5);
        if (k) g.lineTo(px, py); else g.moveTo(px, py);
      }
      g.closePath();
    };
    g.lineWidth = 2.5;
    g.strokeStyle = s.c2;
    const cols = Math.round(W / (1.5 * r));
    const rows = Math.round(H / h);
    for (let q = 0; q < cols; q++) {
      for (let row = 0; row < rows; row++) {
        const cx = q * 1.5 * r;
        const cy = row * h + (q % 2) * (h / 2);
        const fill = rand() < 0.16;
        wrapped(W, H, (dx, dy) => {
          hexPath(cx + dx, cy + dy);
          if (fill) { g.fillStyle = s.c3; g.fill(); }
          g.stroke();
        });
      }
    }
  },
  stripes(g, W, H, s, rand) {
    g.fillStyle = s.c1;
    g.fillRect(0, 0, W, H);
    g.fillStyle = s.c2;
    const n = 7;
    for (let k = 0; k < n; k++) {
      const base = ((k + rand() * 0.5) / n) * H;
      const k1 = 1 + Math.floor(rand() * 2);
      const k2 = 3 + Math.floor(rand() * 3);
      const m = 2 + Math.floor(rand() * 3);
      const p1 = rand() * TAU;
      const p2 = rand() * TAU;
      const p3 = rand() * TAU;
      const w = 10 + rand() * 12;
      const top = [];
      const bot = [];
      for (let x = 0; x <= W; x += 4) {
        const t = (x / W) * TAU;
        const cy = base + 18 * Math.sin(t * k1 + p1) + 6 * Math.sin(t * k2 + p2);
        const hw = w * Math.max(0, Math.sin(t * m + p3)) ** 0.7;
        top.push([x, cy - hw]);
        bot.push([x, cy + hw]);
      }
      for (const dy of [-H, 0, H]) {
        g.beginPath();
        top.forEach(([x, y], i) => (i ? g.lineTo(x, y + dy) : g.moveTo(x, y + dy)));
        for (let i = bot.length - 1; i >= 0; i--) g.lineTo(bot[i][0], bot[i][1] + dy);
        g.closePath();
        g.fill();
      }
    }
  },
  splatter(g, W, H, s, rand) {
    g.fillStyle = s.c1;
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 26; i++) {
      const col = rand() < 0.5 ? s.c2 : s.c3;
      const x = rand() * W;
      const y = rand() * H;
      const r = 8 + rand() * 30;
      const drops = [];
      const nd = 6 + Math.floor(rand() * 10);
      for (let d = 0; d < nd; d++) {
        const a = rand() * TAU;
        const dist = r * (1.1 + rand() * 1.6);
        drops.push([Math.cos(a) * dist, Math.sin(a) * dist, 1.5 + rand() * 6]);
      }
      g.fillStyle = col;
      wrapped(W, H, (dx, dy) => {
        g.beginPath();
        g.arc(x + dx, y + dy, r, 0, TAU);
        g.fill();
        for (const [ox, oy, rr] of drops) {
          g.beginPath();
          g.arc(x + dx + ox, y + dy + oy, rr, 0, TAU);
          g.fill();
        }
      });
    }
  },
  damascus(g, W, H, s, rand) {
    const n1 = noiseField(rand, 4);
    const n2 = noiseField(rand, 9);
    const a = new THREE.Color(s.c1);
    const b = new THREE.Color(s.c2);
    a.convertLinearToSRGB();
    b.convertLinearToSRGB();
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const u = x / W;
        const v = y / H;
        const warp = n1(u, v) * 5 + n2(u, v) * 1.5;
        const t = 0.5 + 0.5 * Math.sin(v * TAU * 9 + u * TAU * 2 + warp);
        const k = t * t * (3 - 2 * t);
        const o = (y * W + x) * 4;
        img.data[o] = (a.r + (b.r - a.r) * k) * 255;
        img.data[o + 1] = (a.g + (b.g - a.g) * k) * 255;
        img.data[o + 2] = (a.b + (b.b - a.b) * k) * 255;
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  },
};

// Scratches and chipped paint showing bare metal, scaled by wear (0-1).
function drawWear(g, W, H, wear, rand) {
  if (wear <= 0) return;
  g.fillStyle = `rgba(120,124,130,${wear * 0.15})`;
  g.fillRect(0, 0, W, H);
  const scratches = Math.floor(wear * 320);
  for (let i = 0; i < scratches; i++) {
    const x = rand() * W;
    const y = rand() * H;
    const len = 8 + rand() * 50;
    const a = rand() * TAU;
    const bend = (rand() - 0.5) * 12;
    g.strokeStyle = `rgba(196,200,206,${0.3 + rand() * 0.5})`;
    g.lineWidth = 0.6 + rand() * 1.1;
    wrapped(W, H, (dx, dy) => {
      g.beginPath();
      g.moveTo(x + dx, y + dy);
      g.quadraticCurveTo(
        x + dx + Math.cos(a) * len * 0.5 - Math.sin(a) * bend,
        y + dy + Math.sin(a) * len * 0.5 + Math.cos(a) * bend,
        x + dx + Math.cos(a) * len,
        y + dy + Math.sin(a) * len,
      );
      g.stroke();
    });
  }
  const chips = Math.floor(wear ** 1.4 * 110);
  g.fillStyle = 'rgba(158,163,170,0.95)';
  for (let i = 0; i < chips; i++) {
    const x = rand() * W;
    const y = rand() * H;
    const r = 1.5 + rand() * 7 * (0.4 + wear);
    const seed = rand() * 1e9;
    wrapped(W, H, (dx, dy) => blob(g, rng(seed), x + dx, y + dy, r));
  }
}

// Light bars, a layer over any pattern: 'neon' glows steadily in its two
// colours, 'rgb' cycles every light through the rainbow together.
export const LIGHT_TYPES = { off: 'Off', neon: 'Neon', rgb: 'RGB (colour cycle)' };
export const NO_LIGHTS = { type: 'off', color: '#2f7dff', accent: '#8fe6ff', seed: 5 };
export const lightsOn = (s) => !!s.lights && LIGHT_TYPES[s.lights.type] && s.lights.type !== 'off';

// The canvas size a pattern tiles on (the hex grid needs whole cells).
const canvasSize = (s) => (s.pattern === 'hex' ? [480, 471] : [512, 512]);

// The light the bars give off, for the paint's emissive map: black where
// it's dark. Null when the skin has no light bars.
export function glowCanvas(s) {
  if (!lightsOn(s)) return null;
  const c = document.createElement('canvas');
  [c.width, c.height] = canvasSize(s);
  const g = c.getContext('2d');
  const L = s.lights;
  const rand = rng(L.seed || 1);
  if (L.type === 'rgb') drawNeon(g, c.width, c.height, rand, { strip: '#ffffff', accent: '#ffffff', mode: 'glow', halo: 6 });
  else drawNeon(g, c.width, c.height, rand, { strip: L.color, accent: L.accent, mode: 'glow', halo: 6 });
  return c;
}

export function skinCanvas(s) {
  const c = document.createElement('canvas');
  [c.width, c.height] = canvasSize(s);
  const g = c.getContext('2d');
  const rand = rng(s.seed || 1);
  (DRAW[s.pattern] || DRAW.solid)(g, c.width, c.height, s, rand);
  drawWear(g, c.width, c.height, s.wear, rng((s.seed || 1) + 999));
  // The light bars' diffusers, pale when unlit, over the pattern.
  if (lightsOn(s)) {
    const L = s.lights;
    const rgb = L.type === 'rgb';
    drawNeon(g, c.width, c.height, rng(L.seed || 1), { strip: rgb ? '#d9dce2' : shade(L.color, 1.2), accent: rgb ? '#d9dce2' : shade(L.accent, 1.1), mode: 'overlay' });
  }
  return c;
}

// The "Champions" wordmark the Champions 2021 skin carries on the receiver:
// an X emblem and the word in slanted gold capitals, outlined in the base
// colour. 3:1, transparent around it.
export function championsWordmark(s) {
  const c = document.createElement('canvas');
  c.width = 768;
  c.height = 256;
  const g = c.getContext('2d');
  g.lineJoin = 'round';
  // X emblem: two tapered blades crossing, and a diamond at the centre.
  g.save();
  g.translate(110, 128);
  for (const a of [-0.8, 0.8]) {
    g.save();
    g.rotate(a);
    g.beginPath();
    g.moveTo(0, -96); g.lineTo(18, -20); g.lineTo(0, 96); g.lineTo(-18, -20);
    g.closePath();
    g.lineWidth = 14; g.strokeStyle = s.c1; g.stroke();
    g.fillStyle = s.c2; g.fill();
    g.restore();
  }
  g.beginPath();
  g.moveTo(0, -22); g.lineTo(22, 0); g.lineTo(0, 22); g.lineTo(-22, 0);
  g.closePath();
  g.fillStyle = s.c3; g.fill();
  g.restore();
  // Slanted capitals.
  g.save();
  g.translate(430, 150);
  g.transform(1, 0, -0.28, 1, 0, 0);
  g.font = '900 118px "Saira Condensed", "Arial Narrow", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 16; g.strokeStyle = s.c1; g.strokeText('CHAMPIONS', 0, 0);
  g.fillStyle = s.c2; g.fillText('CHAMPIONS', 0, 0);
  g.font = '800 40px "Saira Condensed", "Arial Narrow", sans-serif';
  g.lineWidth = 9; g.strokeText('2021', 150, 78);
  g.fillStyle = s.c3; g.fillText('2021', 150, 78);
  g.restore();
  return c;
}

// Straight-grained walnut for classic wood furniture.
export function woodCanvas() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const rand = rng(42);
  const n = noiseField(rand, 5);
  const img = g.createImageData(256, 256);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const u = x / 256;
      const v = y / 256;
      const t = 0.5 + 0.5 * Math.sin(v * TAU * 14 + n(u, v) * 7);
      const o = (y * 256 + x) * 4;
      img.data[o] = 112 + t * 50;
      img.data[o + 1] = 58 + t * 30;
      img.data[o + 2] = 30 + t * 14;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

// ---------------------------------------------------------------- stickers
export const STICKER_FINISHES = {
  paper: 'Paper',
  glossy: 'Glossy',
  holo: 'Holo',
  gold: 'Gold foil',
};

const star = (g, cx, cy, r, inner, points = 5) => {
  g.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const rr = i % 2 ? r * inner : r;
    const a = (i / (points * 2)) * TAU - Math.PI / 2;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.closePath();
};

// Each design draws in `color` on a 256 px canvas centred at 128, 128.
export const STICKERS = {
  text: {
    name: 'Text',
    draw(g, color, text) {
      const t = (text || 'GG').slice(0, 10);
      g.fillStyle = color;
      const w = 220;
      const h = 110;
      g.beginPath();
      if (g.roundRect) g.roundRect(128 - w / 2, 128 - h / 2, w, h, 26);
      else g.rect(128 - w / 2, 128 - h / 2, w, h);
      g.fill();
      let size = 90;
      g.font = `900 ${size}px "Saira Condensed", "Arial Narrow", sans-serif`;
      while (g.measureText(t).width > w - 34 && size > 20) {
        size -= 4;
        g.font = `900 ${size}px "Saira Condensed", "Arial Narrow", sans-serif`;
      }
      g.fillStyle = '#ffffff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(t.toUpperCase(), 128, 132);
    },
  },
  crosshair: {
    name: 'Crosshair',
    draw(g, color) {
      g.strokeStyle = color;
      g.lineWidth = 16;
      g.beginPath();
      g.arc(128, 128, 70, 0, TAU);
      g.stroke();
      g.fillStyle = color;
      for (const [x, y, w, h] of [[120, 24, 16, 62], [120, 170, 16, 62], [24, 120, 62, 16], [170, 120, 62, 16]]) g.fillRect(x, y, w, h);
      g.beginPath();
      g.arc(128, 128, 12, 0, TAU);
      g.fill();
    },
  },
  bolt: {
    name: 'Lightning',
    draw(g, color) {
      g.fillStyle = color;
      g.beginPath();
      [[150, 16], [60, 140], [118, 140], [92, 240], [196, 104], [136, 104], [172, 16]].forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.fill();
    },
  },
  star: {
    name: 'Star',
    draw(g, color) {
      g.fillStyle = color;
      star(g, 128, 134, 112, 0.45);
      g.fill();
    },
  },
  heart: {
    name: 'Heart',
    draw(g, color) {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(128, 222);
      g.bezierCurveTo(20, 150, 16, 70, 76, 50);
      g.bezierCurveTo(108, 40, 124, 62, 128, 80);
      g.bezierCurveTo(132, 62, 148, 40, 180, 50);
      g.bezierCurveTo(240, 70, 236, 150, 128, 222);
      g.fill();
    },
  },
  flame: {
    name: 'Flame',
    draw(g, color) {
      const f = (s, col) => {
        g.fillStyle = col;
        g.beginPath();
        g.moveTo(128, 236);
        g.bezierCurveTo(128 - 90 * s, 236, 128 - 100 * s, 150, 128 - 40 * s, 100);
        g.bezierCurveTo(128 - 30 * s, 140, 128 - 10 * s, 140, 128 - 14 * s, 110);
        g.bezierCurveTo(128 - 20 * s, 70, 128, 40, 128 + 10 * s, 236 - 216 * s);
        g.bezierCurveTo(128 + 30 * s, 80, 128 + 100 * s, 120, 128 + 88 * s, 180);
        g.bezierCurveTo(128 + 80 * s, 226, 128 + 40 * s, 236, 128, 236);
        g.fill();
      };
      f(1, color);
      f(0.5, 'rgba(255,255,255,0.55)');
    },
  },
  skull: {
    name: 'Skull',
    draw(g, color) {
      g.fillStyle = color;
      g.beginPath();
      g.arc(128, 110, 84, 0, TAU);
      g.fill();
      g.beginPath();
      if (g.roundRect) g.roundRect(78, 150, 100, 70, 18);
      else g.rect(78, 150, 100, 70);
      g.fill();
      g.fillStyle = '#16171a';
      g.beginPath();
      g.ellipse(96, 112, 22, 26, 0, 0, TAU);
      g.ellipse(160, 112, 22, 26, 0, 0, TAU);
      g.fill();
      g.beginPath();
      g.moveTo(128, 140);
      g.lineTo(116, 164);
      g.lineTo(140, 164);
      g.fill();
      for (let i = 0; i < 4; i++) g.fillRect(92 + i * 22, 194, 6, 26);
    },
  },
  crown: {
    name: 'Crown',
    draw(g, color) {
      g.fillStyle = color;
      g.beginPath();
      [[30, 190], [30, 80], [80, 130], [128, 50], [176, 130], [226, 80], [226, 190]].forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.fill();
      g.fillRect(30, 196, 196, 26);
      for (const [x, y] of [[30, 72], [128, 42], [226, 72]]) {
        g.beginPath();
        g.arc(x, y, 14, 0, TAU);
        g.fill();
      }
    },
  },
  smile: {
    name: 'Smile',
    draw(g, color) {
      g.fillStyle = color;
      g.beginPath();
      g.arc(128, 128, 108, 0, TAU);
      g.fill();
      g.fillStyle = '#16171a';
      g.beginPath();
      g.ellipse(92, 100, 14, 22, 0, 0, TAU);
      g.ellipse(164, 100, 14, 22, 0, 0, TAU);
      g.fill();
      g.strokeStyle = '#16171a';
      g.lineWidth = 14;
      g.lineCap = 'round';
      g.beginPath();
      g.arc(128, 128, 62, 0.2 * Math.PI, 0.8 * Math.PI);
      g.stroke();
    },
  },
  paw: {
    name: 'Paw',
    draw(g, color) {
      g.fillStyle = color;
      g.beginPath();
      g.ellipse(128, 168, 62, 52, 0, 0, TAU);
      g.fill();
      for (const [x, y, r] of [[60, 104, 24], [102, 66, 26], [154, 66, 26], [196, 104, 24]]) {
        g.beginPath();
        g.ellipse(x, y, r, r * 1.25, 0, 0, TAU);
        g.fill();
      }
    },
  },
  target: {
    name: 'Bullseye',
    draw(g, color) {
      for (const [r, col] of [[110, color], [82, '#ffffff'], [56, color], [28, '#ffffff'], [12, color]]) {
        g.fillStyle = col;
        g.beginPath();
        g.arc(128, 128, r, 0, TAU);
        g.fill();
      }
    },
  },
  // A dark warning plate, the kind stuck on a stock as a joke.
  warning: {
    name: 'Warning',
    draw(g, color) {
      g.fillStyle = '#2d2f33';
      g.beginPath();
      if (g.roundRect) g.roundRect(18, 18, 220, 220, 22); else g.rect(18, 18, 220, 220);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.05)';
      for (let i = 0; i < 9; i++) g.fillRect(18, 30 + i * 24, 220, 8);
      g.fillStyle = color;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = '900 40px "Saira Condensed", "Arial Narrow", sans-serif';
      g.fillText('WARNING', 128, 50);
      g.fillStyle = '#ffffff';
      g.font = '700 14.5px "Saira Condensed", "Arial Narrow", sans-serif';
      ['AIM TRAINING IN PROGRESS.', 'THE FLICKS YOU ARE ABOUT', 'TO SEE WERE PRACTISED BY', 'PROFESSIONALS. DO NOT TRY', 'THEM WITHOUT A MOUSEPAD.']
        .forEach((line, i) => g.fillText(line, 128, 84 + i * 19));
      // Skull over crossed crosshairs.
      g.strokeStyle = '#ffffff';
      g.lineWidth = 7;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(86, 222); g.lineTo(170, 186);
      g.moveTo(86, 186); g.lineTo(170, 222);
      g.stroke();
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(128, 188, 20, 0, TAU);
      g.fill();
      g.fillRect(116, 196, 24, 16);
      g.fillStyle = '#2d2f33';
      g.beginPath();
      g.arc(120, 188, 5, 0, TAU);
      g.arc(136, 188, 5, 0, TAU);
      g.fill();
    },
  },
  // Stained glass: a rose window of tinted panes around a lightning chevron.
  glass: {
    name: 'Stained Glass',
    draw(g, color) {
      const base = new THREE.Color(color);
      const tint = (dh, l) => {
        const c = base.clone().offsetHSL(dh, 0, 0);
        const hsl = {};
        c.getHSL(hsl);
        return `#${c.setHSL(hsl.h, Math.min(1, hsl.s + 0.1), l).getHexString()}`;
      };
      g.fillStyle = '#4a4752';
      g.beginPath();
      if (g.roundRect) g.roundRect(14, 14, 228, 228, 24); else g.rect(14, 14, 228, 228);
      g.fill();
      for (let i = 0; i < 16; i++) {
        const a0 = (i / 16) * TAU;
        const a1 = ((i + 1) / 16) * TAU;
        g.fillStyle = tint((i % 4) * 0.03 - 0.04, 0.55 + (i % 3) * 0.1);
        g.beginPath();
        g.moveTo(128, 124);
        g.arc(128, 124, 92, a0, a1);
        g.closePath();
        g.fill();
      }
      g.strokeStyle = '#4a4752';
      g.lineWidth = 4;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU;
        g.beginPath();
        g.moveTo(128, 124);
        g.lineTo(128 + Math.cos(a) * 92, 124 + Math.sin(a) * 92);
        g.stroke();
      }
      for (const r of [48, 92]) { g.beginPath(); g.arc(128, 124, r, 0, TAU); g.stroke(); }
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU + 0.2;
        g.fillStyle = tint(0.08, 0.8);
        g.beginPath();
        g.arc(128 + Math.cos(a) * 70, 124 + Math.sin(a) * 70, 9, 0, TAU);
        g.fill();
        g.stroke();
      }
      for (const [x, y] of [[36, 36], [220, 36], [36, 220], [220, 220]]) {
        g.fillStyle = tint(-0.06, 0.78);
        g.beginPath();
        g.arc(x, y, 16, 0, TAU);
        g.fill();
      }
      // Lightning chevron.
      g.fillStyle = tint(0, 0.4);
      g.strokeStyle = '#ffffff';
      g.lineWidth = 5;
      g.beginPath();
      [[76, 86], [180, 86], [128, 186]].forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = '#ffffff';
      g.beginPath();
      [[138, 96], [112, 132], [128, 132], [116, 166], [148, 120], [132, 120], [150, 96]].forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.fill();
      g.font = '900 22px "Saira Condensed", "Arial Narrow", sans-serif';
      g.textAlign = 'center';
      g.lineWidth = 6;
      g.strokeStyle = '#4a4752';
      g.strokeText('TRACKLINE 2026', 128, 232);
      g.fillStyle = tint(0.05, 0.85);
      g.fillText('TRACKLINE 2026', 128, 232);
    },
  },
  // Team-style logo: an angular monogram over a paint splash, with a name
  // and event line underneath. Looks best in holo.
  team: {
    name: 'Team Logo',
    draw(g, color) {
      const rand = rng(77);
      g.fillStyle = color;
      g.globalAlpha = 0.55;
      for (let i = 0; i < 38; i++) {
        const r = 8 + rand() * 24;
        g.beginPath();
        g.arc(128 + (rand() - 0.5) * 150, 100 + (rand() - 0.5) * 130, r, 0, TAU);
        g.fill();
      }
      g.globalAlpha = 1;
      g.fillStyle = '#ffffff';
      g.beginPath();
      [[52, 40], [204, 40], [204, 76], [150, 76], [150, 168], [112, 186], [112, 76], [52, 76]].forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.fill();
      g.fillStyle = color;
      g.beginPath();
      [[62, 48], [196, 48], [196, 68], [142, 68], [142, 162], [120, 172], [120, 68], [62, 68]].forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.fill();
      g.textAlign = 'center';
      g.font = '900 30px "Saira Condensed", "Arial Narrow", sans-serif';
      g.lineWidth = 7;
      g.strokeStyle = '#16171a';
      g.strokeText('TRACKLINE', 128, 206);
      g.fillStyle = '#ffffff';
      g.fillText('TRACKLINE', 128, 206);
      g.font = '800 18px "Saira Condensed", "Arial Narrow", sans-serif';
      g.strokeText('HEADSHOT CUP 2026', 128, 236);
      g.fillText('HEADSHOT CUP 2026', 128, 236);
    },
  },
  ace: {
    name: 'Ace of Spades',
    draw(g, color) {
      g.save();
      g.translate(128, 128);
      g.rotate(-0.12);
      g.fillStyle = '#ffffff';
      g.strokeStyle = color;
      g.lineWidth = 8;
      g.beginPath();
      if (g.roundRect) g.roundRect(-78, -108, 156, 216, 16); else g.rect(-78, -108, 156, 216);
      g.fill();
      g.stroke();
      g.fillStyle = '#16171a';
      g.beginPath();
      g.moveTo(0, -60);
      g.bezierCurveTo(-60, -10, -62, 30, -30, 34);
      g.bezierCurveTo(-14, 36, -6, 26, -4, 18);
      g.lineTo(-18, 62);
      g.lineTo(18, 62);
      g.lineTo(4, 18);
      g.bezierCurveTo(6, 26, 14, 36, 30, 34);
      g.bezierCurveTo(62, 30, 60, -10, 0, -60);
      g.fill();
      g.fillStyle = color;
      g.font = '900 34px "Saira Condensed", "Arial Narrow", sans-serif';
      g.textAlign = 'center';
      g.fillText('A', -52, -70);
      g.rotate(Math.PI);
      g.fillText('A', -52, -70);
      g.restore();
    },
  },
  wings: {
    name: 'Wings',
    draw(g, color) {
      g.fillStyle = color;
      for (const side of [-1, 1]) {
        for (let i = 0; i < 5; i++) {
          g.beginPath();
          const y = 86 + i * 20;
          g.moveTo(128 + side * 30, y);
          g.quadraticCurveTo(128 + side * (70 + i * 6), y - 40 + i * 4, 128 + side * (122 - i * 12), y - 30 + i * 10);
          g.quadraticCurveTo(128 + side * (80 + i * 4), y + 6, 128 + side * 30, y + 16);
          g.fill();
        }
      }
      g.beginPath();
      g.arc(128, 124, 40, 0, TAU);
      g.fill();
      g.fillStyle = '#ffffff';
      star(g, 128, 126, 28, 0.45);
      g.fill();
    },
  },
  cat: {
    name: 'Cat',
    draw(g, color) {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(40, 60); g.lineTo(96, 84); g.lineTo(160, 84); g.lineTo(216, 60);
      g.lineTo(212, 150); g.quadraticCurveTo(200, 222, 128, 224); g.quadraticCurveTo(56, 222, 44, 150);
      g.closePath();
      g.fill();
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.ellipse(94, 138, 22, 26, 0, 0, TAU);
      g.ellipse(162, 138, 22, 26, 0, 0, TAU);
      g.fill();
      g.fillStyle = '#16171a';
      g.beginPath();
      g.ellipse(96, 140, 8, 18, 0, 0, TAU);
      g.ellipse(160, 140, 8, 18, 0, 0, TAU);
      g.fill();
      g.fillStyle = '#ff8fb3';
      g.beginPath();
      g.moveTo(118, 176); g.lineTo(138, 176); g.lineTo(128, 188);
      g.closePath();
      g.fill();
      g.strokeStyle = '#ffffff';
      g.lineWidth = 4;
      for (const [x0, y0, x1, y1] of [[110, 186, 50, 176], [110, 192, 52, 198], [146, 186, 206, 176], [146, 192, 204, 198]]) {
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      }
    },
  },
  rocket: {
    name: 'Rocket',
    draw(g, color) {
      g.save();
      g.translate(128, 128);
      g.rotate(Math.PI / 4);
      g.fillStyle = '#ffb02e';
      g.beginPath();
      g.moveTo(-18, 70); g.quadraticCurveTo(0, 130, 18, 70);
      g.fill();
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(-30, 40); g.lineTo(-54, 76); g.lineTo(-24, 66);
      g.moveTo(30, 40); g.lineTo(54, 76); g.lineTo(24, 66);
      g.fill();
      g.fillStyle = '#e8edf2';
      g.beginPath();
      g.moveTo(0, -104);
      g.bezierCurveTo(40, -70, 36, 20, 26, 70);
      g.lineTo(-26, 70);
      g.bezierCurveTo(-36, 20, -40, -70, 0, -104);
      g.fill();
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(0, -104);
      g.bezierCurveTo(22, -86, 30, -64, 32, -50);
      g.lineTo(-32, -50);
      g.bezierCurveTo(-30, -64, -22, -86, 0, -104);
      g.fill();
      g.fillStyle = '#5fd8ff';
      g.strokeStyle = '#16171a';
      g.lineWidth = 5;
      g.beginPath();
      g.arc(0, -14, 15, 0, TAU);
      g.fill();
      g.stroke();
      g.restore();
    },
  },
  eightball: {
    name: '8-Ball',
    draw(g, color) {
      g.fillStyle = '#16171a';
      g.beginPath();
      g.arc(128, 128, 108, 0, TAU);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.beginPath();
      g.ellipse(92, 80, 40, 22, -0.6, 0, TAU);
      g.fill();
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(128, 116, 50, 0, TAU);
      g.fill();
      g.fillStyle = color;
      g.font = '900 72px "Saira Condensed", "Arial Narrow", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('8', 128, 122);
    },
  },
  dragon: {
    name: 'Dragon',
    draw(g, color) {
      const dark = `#${new THREE.Color(color).multiplyScalar(0.55).getHexString()}`;
      // Back spikes.
      g.fillStyle = dark;
      for (let i = 0; i < 5; i++) {
        const x = 60 + i * 22;
        g.beginPath();
        g.moveTo(x, 70 - i * 4); g.lineTo(x + 12, 34 - i * 4); g.lineTo(x + 22, 72 - i * 4);
        g.fill();
      }
      // Head and snout, jaw open.
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(40, 150);
      g.quadraticCurveTo(40, 64, 120, 60);
      g.quadraticCurveTo(200, 58, 232, 110);
      g.lineTo(226, 132);
      g.lineTo(140, 138);
      g.lineTo(226, 158);
      g.quadraticCurveTo(210, 206, 140, 204);
      g.quadraticCurveTo(60, 206, 40, 150);
      g.fill();
      g.fillStyle = '#ffffff';
      for (let i = 0; i < 5; i++) {
        const x = 150 + i * 15;
        g.beginPath(); g.moveTo(x, 136); g.lineTo(x + 7, 148); g.lineTo(x + 14, 137); g.fill();
        g.beginPath(); g.moveTo(x, 160); g.lineTo(x + 7, 149); g.lineTo(x + 14, 160); g.fill();
      }
      g.beginPath();
      g.ellipse(120, 100, 18, 14, 0, 0, TAU);
      g.fill();
      g.fillStyle = '#16171a';
      g.beginPath();
      g.ellipse(124, 100, 6, 12, 0, 0, TAU);
      g.fill();
      g.beginPath();
      g.ellipse(214, 102, 5, 3, 0, 0, TAU);
      g.fill();
      g.strokeStyle = dark;
      g.lineWidth = 6;
      g.beginPath(); g.arc(76, 150, 18, 0.6, 2.6); g.stroke();
    },
  },
};

// Stickers the player adds from their own image files. They live in this
// browser only; each becomes a design like the built-in ones.
const CUSTOM_KEY = 'trackline.stickers.custom.v1';
let stickerVersion = 0;
const imageListeners = [];

export const stickerRevision = () => stickerVersion;
export function onStickerImages(fn) { imageListeners.push(fn); }

function registerCustom(rec) {
  const img = new Image();
  const design = { name: rec.name, custom: true, img, ready: false, draw(g) {
    if (!design.ready) return;
    // Fit inside the 256 box, keeping the image's proportions.
    const k = Math.min(236 / img.width, 236 / img.height);
    const w = img.width * k;
    const h = img.height * k;
    g.drawImage(img, 128 - w / 2, 128 - h / 2, w, h);
  } };
  img.onload = () => {
    design.ready = true;
    stickerVersion++;
    for (const fn of imageListeners) fn();
  };
  img.src = rec.data;
  STICKERS[rec.id] = design;
}

function readCustom() {
  try {
    const list = JSON.parse(localStorage.getItem(CUSTOM_KEY));
    return Array.isArray(list) ? list : [];
  } catch (e) { return []; }
}

export function loadCustomStickers() {
  for (const rec of readCustom()) if (rec && rec.id && rec.data) registerCustom(rec);
}

// Add an image file as a sticker. Resolves to its id; rejects if the file
// isn't an image or the browser has no room left to keep it.
export function addCustomSticker(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('That file could not be read.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not an image this browser can open.'));
      img.onload = () => {
        const k = Math.min(1, 384 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * k));
        c.height = Math.max(1, Math.round(img.height * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const rec = { id: `custom-${Date.now().toString(36)}`, name: (file.name || 'My sticker').replace(/\.[a-z0-9]+$/i, '').slice(0, 24), data: c.toDataURL('image/png') };
        const list = readCustom();
        list.push(rec);
        try {
          localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
        } catch (e) {
          reject(new Error('This browser has no room left for another sticker image. Delete one first.'));
          return;
        }
        registerCustom(rec);
        resolve(rec.id);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export function removeCustomSticker(id) {
  const list = readCustom().filter((r) => r.id !== id);
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)); } catch (e) { /* storage unavailable */ }
  delete STICKERS[id];
  stickerVersion++;
}

// A sticker as a die-cut decal: the design, a white border, and scraping.
// Drawn at 512 px (designs work in a 256 px space) so large stickers stay sharp.
const R = 512;
export function stickerCanvas(st) {
  const design = STICKERS[st.id];
  const art = document.createElement('canvas');
  art.width = art.height = R;
  const a = art.getContext('2d');
  a.save();
  a.scale(R / 256, R / 256);
  a.translate(128, 128);
  a.scale(0.86, 0.86);
  a.translate(-128, -128);
  if (design) design.draw(a, st.color, st.text);
  a.restore();

  const c = document.createElement('canvas');
  c.width = c.height = R;
  const g = c.getContext('2d', { willReadFrequently: true });
  // White border: stamp a white silhouette around the design.
  const sil = document.createElement('canvas');
  sil.width = sil.height = R;
  const s = sil.getContext('2d');
  s.drawImage(art, 0, 0);
  s.globalCompositeOperation = 'source-in';
  s.fillStyle = '#ffffff';
  s.fillRect(0, 0, R, R);
  const border = (7 * R) / 256;
  for (let i = 0; i < 16; i++) {
    const ang = (i / 16) * TAU;
    g.drawImage(sil, Math.cos(ang) * border, Math.sin(ang) * border);
  }
  g.drawImage(art, 0, 0);

  if (st.scrape > 0) {
    const n1 = noiseField(rng(st.seed || 3), 6);
    const n2 = noiseField(rng((st.seed || 3) + 1), 20);
    const img = g.getImageData(0, 0, R, R);
    for (let y = 0; y < R; y++) {
      for (let x = 0; x < R; x++) {
        const v = n1(x / R, y / R) * 0.65 + n2(x / R, y / R) * 0.35;
        if (v < st.scrape * 0.85) img.data[(y * R + x) * 4 + 3] = 0;
      }
    }
    g.putImageData(img, 0, 0);
  }
  return c;
}
