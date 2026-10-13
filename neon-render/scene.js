// Neon / LED re-render of the flat colour-block collage.
// Every block of the source keeps its colour and its exact outline; the material
// becomes a light-emitting LED matrix, a neon tube or a matte surface lit by the
// neighbouring lights.  Area lights sit on each emitter so the dark backdrop
// shows real falloff, and the three yellow lines become physical light rails.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';

const W = 792, H = 1224;              // source poster size: 1 unit = 1 source pixel
const params = new URLSearchParams(location.search);
const STILL = params.has('still');    // deterministic frame for the headless render
if (STILL) document.getElementById('hint').style.display = 'none';
const TIME0 = parseFloat(params.get('t') || '3.7');

// ---------------------------------------------------------------- utilities
const P = (x, y, z = 0) => new THREE.Vector3(x, -y, z);
const hex = (c) => new THREE.Color(c);
const hdr = (c, k) => hex(c).multiplyScalar(k);

// For a 4-point face the texture runs along the first edge (u) and the last edge (v):
// size the canvas by those lengths so lettering is not squashed by the shear.
function quadDims(pts) {
  const [a, b, , d] = pts;
  return { u: Math.hypot(b[0] - a[0], b[1] - a[1]), v: Math.hypot(d[0] - a[0], d[1] - a[1]) };
}
function bbox(pts) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

// Flat polygon in the picture plane. 4-point polygons get a sheared quad mapping
// (texture follows the parallelogram), others get a bounding-box mapping.
function faceGeometry(pts, z, normal = [0, 0, 1]) {
  let geo;
  if (pts.length === 4) {
    const [a, b, c, d] = pts;
    const pos = new Float32Array([a[0], -a[1], z, b[0], -b[1], z, c[0], -c[1], z, d[0], -d[1], z]);
    const uv = new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]);
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex([0, 2, 1, 0, 3, 2]);
  } else {
    const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, -y)));
    geo = new THREE.ShapeGeometry(shape);
    const bb = bbox(pts);
    const p = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      p.setZ(i, z);
      uv.setXY(i, (p.getX(i) - bb.x0) / bb.w, 1 - (-p.getY(i) - bb.y0) / bb.h);
    }
  }
  const n = new Float32Array(geo.attributes.position.count * 3);
  for (let i = 0; i < n.length; i += 3) { n[i] = normal[0]; n[i + 1] = normal[1]; n[i + 2] = normal[2]; }
  geo.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  return geo;
}

function canvas(w, h) { const c = document.createElement('canvas'); c.width = Math.round(w); c.height = Math.round(h); return c; }
function texture(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// Draw `draw(ctx,w,h)` at 4x, then sample it on a cols x rows grid and rebuild it
// as physical LED pixels: dark board, dim unlit diodes, lit diodes with a bright
// core and a soft bleed into the neighbours.
function ledCanvas(cols, rows, cell, draw, opt = {}) {
  const src = canvas(cols * 4, rows * 4);
  const sc = src.getContext('2d');
  draw(sc, src.width, src.height);
  const small = canvas(cols, rows);
  const smc = small.getContext('2d');
  smc.imageSmoothingEnabled = true; smc.imageSmoothingQuality = 'high';
  smc.drawImage(src, 0, 0, cols, rows);
  const data = smc.getImageData(0, 0, cols, rows).data;

  const out = canvas(cols * cell, rows * cell);
  const ctx = out.getContext('2d');
  ctx.fillStyle = opt.board || '#05060b';
  ctx.fillRect(0, 0, out.width, out.height);
  // bleed layer
  ctx.save();
  ctx.globalAlpha = opt.bleed ?? 0.5;
  ctx.filter = `blur(${cell * 0.9}px)`;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(small, 0, 0, out.width, out.height);
  ctx.restore();
  // unlit diodes
  ctx.fillStyle = 'rgba(255,255,255,0.035)';
  const r = cell * (opt.radius ?? 0.36);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    ctx.beginPath(); ctx.arc((x + .5) * cell, (y + .5) * cell, r * 0.9, 0, Math.PI * 2); ctx.fill();
  }
  // lit diodes
  const gain = opt.gain ?? 1.0;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = (y * cols + x) * 4;
    const R = data[i], G = data[i + 1], B = data[i + 2];
    const lum = (R * 0.3 + G * 0.59 + B * 0.11) / 255;
    if (lum < 0.06) continue;
    const cx = (x + .5) * cell, cy = (y + .5) * cell;
    ctx.fillStyle = `rgba(${R},${G},${B},${Math.min(1, lum * 1.6 * gain)})`;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    if (lum > 0.45) {
      ctx.fillStyle = `rgba(${Math.min(255, R + 90)},${Math.min(255, G + 90)},${Math.min(255, B + 90)},${(lum - 0.4) * 0.9})`;
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.45, 0, Math.PI * 2); ctx.fill();
    }
  }
  if (opt.sheen !== false) {
    const g = ctx.createLinearGradient(0, 0, out.width, out.height);
    g.addColorStop(0, 'rgba(255,255,255,0.05)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,0.03)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, out.width, out.height);
  }
  return out;
}

function neonText(ctx, text, x, y, color, opt = {}) {
  ctx.save();
  ctx.font = opt.font || "48px 'Monoton'";
  ctx.textAlign = opt.align || 'left';
  ctx.textBaseline = opt.baseline || 'alphabetic';
  if (opt.rotate) { ctx.translate(x, y); ctx.rotate(opt.rotate); x = 0; y = 0; }
  ctx.shadowColor = color; ctx.shadowBlur = opt.blur ?? 26;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color; ctx.lineWidth = opt.width ?? 3;
  for (let i = 0; i < (opt.passes ?? 3); i++) ctx.strokeText(text, x, y);
  ctx.shadowBlur = 0;
  ctx.fillStyle = opt.core || '#fff6f8';
  ctx.globalAlpha = opt.coreAlpha ?? 0.9;
  ctx.font = ctx.font; ctx.fillText(text, x, y);
  ctx.restore();
}

function scanlines(ctx, w, h, step = 3, alpha = 0.28) {
  ctx.save(); ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  for (let y = 0; y < h; y += step) ctx.fillRect(0, y, w, 1);
  ctx.restore();
}

function glitchSlices(ctx, w, h, n = 6, seed = 1) {
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < n; i++) {
    const y = rnd() * h, hh = 2 + rnd() * h * 0.03, dx = (rnd() - .5) * w * 0.05;
    const img = ctx.getImageData(0, y, w, hh);
    ctx.putImageData(img, dx, y);
  }
}

function fitText(ctx, text, maxW) {
  let size = parseFloat(ctx.font);
  while (ctx.measureText(text).width > maxW && size > 6) { size -= 1; ctx.font = ctx.font.replace(/\d+(\.\d+)?px/, size + 'px'); }
}

// ---------------------------------------------------------------- scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x030309);
const camera = new THREE.OrthographicCamera(0, W, 0, -H, -3000, 3000);
camera.position.set(0, 0, 1000);
camera.lookAt(0, 0, 0);

RectAreaLightUniformsLib.init();
scene.add(new THREE.AmbientLight(0x3b4466, 0.22));
const hemi = new THREE.HemisphereLight(0x2a3660, 0x160a18, 0.35);
hemi.position.set(0, 1, 1);
scene.add(hemi);

const animated = [];      // {update(t)} hooks
const lights = [];        // area lights for light-only debug toggling

const AREA_SCALE = 0.32, POINT_SCALE = 0.8;   // global trims for the physically based light units
function areaLight(color, intensity, x, y, z, w, h, rot = 0) {
  const l = new THREE.RectAreaLight(color, intensity * AREA_SCALE, w, h);
  l.position.set(x, -y, z);
  l.rotation.z = rot;
  scene.add(l); lights.push(l);
  return l;
}
function pointLight(color, intensity, x, y, z, dist = 500) {
  const l = new THREE.PointLight(color, intensity * POINT_SCALE, dist, 2);
  l.position.set(x, -y, z);
  scene.add(l); lights.push(l);
  return l;
}

// Soft additive halo: light scattered in the haze around an emitter.
const haloTex = (() => {
  const c = canvas(256, 256), g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  grd.addColorStop(0.6, 'rgba(255,255,255,0.10)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
function halo(color, x, y, z, size, opacity = 0.22, aspect = 1) {
  const m = new THREE.SpriteMaterial({ map: haloTex, color: hex(color), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
  const s = new THREE.Sprite(m);
  s.position.set(x, -y, z);
  s.scale.set(size * aspect, size, 1);
  scene.add(s);
  return s;
}

// Light-emitting panel (LED matrix / light box).  Unlit material: it is the light.
function emitterFace(pts, z, cvs, boost = 1.3, opt = {}) {
  const geo = faceGeometry(pts, z);
  const mat = new THREE.MeshBasicMaterial({ map: texture(cvs), color: hdr('#ffffff', boost), toneMapped: true, side: THREE.DoubleSide, transparent: !!opt.transparent, opacity: opt.opacity ?? 1, blending: opt.additive ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: !opt.additive });
  const m = new THREE.Mesh(geo, mat);
  scene.add(m);
  return m;
}

// Matte surface, lit by the scene; optional emissive overlay (neon lettering).
function matteFace(pts, z, color, opt = {}) {
  const geo = faceGeometry(pts, z, opt.normal || [0, 0, 1]);
  const mat = new THREE.MeshStandardMaterial({
    color: hex(color), roughness: opt.roughness ?? 0.55, metalness: opt.metalness ?? 0.15, side: THREE.DoubleSide,
    map: opt.map ? texture(opt.map) : null,
    emissive: opt.emissiveMap ? hex('#ffffff') : hex(opt.emissive || '#000000'),
    emissiveIntensity: opt.emissiveIntensity ?? 1,
    emissiveMap: opt.emissiveMap ? texture(opt.emissiveMap) : null,
  });
  const m = new THREE.Mesh(geo, mat);
  scene.add(m);
  return m;
}

// Neon tube along a closed or open polyline, with glass glow + point lights.
function neonTube(pts, z, color, opt = {}) {
  const radius = opt.radius ?? 2.2;
  const path = new THREE.CurvePath();
  const n = pts.length - (opt.closed === false ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    path.add(new THREE.LineCurve3(P(a[0], a[1], z), P(b[0], b[1], z)));
  }
  const core = new THREE.Mesh(new THREE.TubeGeometry(path, Math.max(8, pts.length * 12), radius, 10, false),
    new THREE.MeshBasicMaterial({ color: hdr(opt.coreColor || '#ffffff', opt.coreBoost ?? 1.15) }));
  const tube = new THREE.Mesh(new THREE.TubeGeometry(path, Math.max(8, pts.length * 12), radius * 2.2, 10, false),
    new THREE.MeshBasicMaterial({ color: hdr(color, opt.boost ?? 1.1), transparent: true, opacity: opt.tubeOpacity ?? 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
  const glow = new THREE.Mesh(new THREE.TubeGeometry(path, Math.max(8, pts.length * 12), radius * 6, 10, false),
    new THREE.MeshBasicMaterial({ color: hdr(color, 0.9), transparent: true, opacity: opt.glowOpacity ?? 0.16, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(core, tube, glow);
  // corner-ish point lights
  const pl = [];
  if (opt.light !== false) {
    const every = opt.lightEvery ?? 1;
    pts.forEach((p, i) => { if (i % every === 0) pl.push(pointLight(color, opt.lightIntensity ?? 2600, p[0], p[1], z + 18, 420)); });
  }
  animated.push({ update(t) {
    const f = opt.flicker ? (0.82 + 0.18 * Math.max(0, Math.sin(t * 17.3 + (opt.seed || 0)) * Math.sin(t * 5.1 + 2))) : 1;
    tube.material.opacity = (opt.tubeOpacity ?? 0.5) * f; glow.material.opacity = (opt.glowOpacity ?? 0.16) * f;
    pl.forEach(l => l.intensity = (opt.lightIntensity ?? 2600) * POINT_SCALE * f);
  }});
  return { core, tube, glow };
}

// ---------------------------------------------------------------- backdrop
// The backdrop is the user's dark brutalist city photo (train on a truss bridge
// between concrete towers, kanji neon).  If `assets/background.png` exists it is
// used as-is (cover-fitted); otherwise the same scene is painted procedurally so
// the render never depends on the file being present.
async function loadImage(url) {
  return new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = url; });
}
function paintCity(g, w, h) {
  // sky + deep shadow
  const sky = g.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#1b2130'); sky.addColorStop(0.35, '#0b0d14'); sky.addColorStop(1, '#07080c');
  g.fillStyle = sky; g.fillRect(0, 0, w, h);
  let s = 12345; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const slab = (x, y, sw, sh, tone) => {
    const grd = g.createLinearGradient(x, 0, x + sw, 0);
    grd.addColorStop(0, tone); grd.addColorStop(0.5, '#1f2126'); grd.addColorStop(1, tone);
    g.fillStyle = grd; g.fillRect(x, y, sw, sh);
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(x, y, 6, sh); g.fillRect(x + sw - 6, y, 6, sh);
    // concrete noise
    g.fillStyle = 'rgba(255,255,255,0.025)';
    for (let i = 0; i < sw * sh / 400; i++) g.fillRect(x + rnd() * sw, y + rnd() * sh, 2 + rnd() * 6, 1);
    // floor lines
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let yy = y; yy < y + sh; yy += 86) g.fillRect(x, yy, sw, 3);
  };
  const windows = (x, y, cols, rows, cw, ch, gap, warm, density = 0.55) => {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (rnd() > density) continue;
      const lit = rnd();
      g.fillStyle = lit > 0.6 ? (warm ? '#ffe6b8' : '#e8f2ff') : (warm ? '#b89a6a' : '#8ea0b8');
      g.fillRect(x + c * (cw + gap), y + r * (ch + gap), cw, ch);
    }
  };
  // towers (left, centre far, right)
  slab(0, 0, 250, h, '#34373f');
  slab(250, 0, 90, h, '#2a2c32');
  slab(420, 0, 200, h, '#22242a');
  slab(700, 0, 330, h, '#32353c');
  slab(1030, 0, 200, h, '#383b43');
  // far centre tower with vertical light ladders
  g.fillStyle = 'rgba(255,230,190,0.9)';
  for (let yy = 60; yy < h * 0.75; yy += 140) { g.fillRect(470, yy, 26, 10); g.fillRect(560, yy + 60, 26, 10); }
  // window clusters
  windows(120, 90, 3, 9, 16, 22, 10, true, 0.45);
  windows(285, 120, 2, 10, 14, 22, 12, false, 0.5);
  windows(740, 80, 3, 7, 18, 24, 12, true, 0.5);
  windows(920, 40, 4, 6, 16, 22, 10, false, 0.4);
  windows(760, 700, 5, 3, 16, 20, 10, true, 0.5);
  windows(60, 1100, 6, 3, 18, 18, 10, true, 0.6);
  windows(1040, 1200, 4, 5, 18, 20, 10, false, 0.5);
  // ventilation dot grids
  g.fillStyle = '#0a0b0e';
  const dots = (x, y) => { for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { g.beginPath(); g.arc(x + c * 14, y + r * 14, 5, 0, Math.PI * 2); g.fill(); } };
  dots(20, 40); dots(610, 580); dots(100, 1000); dots(560, 1240); dots(750, 1400);
  // truss bridge
  const by = 1560, bh = 150;
  g.fillStyle = '#2b2d33'; g.fillRect(0, by, w, bh);
  g.fillStyle = '#1a1b1f'; g.fillRect(0, by, w, 12); g.fillRect(0, by + bh - 14, w, 14);
  g.strokeStyle = '#3a3c44'; g.lineWidth = 10;
  for (let x = -100; x < w + 100; x += 120) { g.beginPath(); g.moveTo(x, by + 12); g.lineTo(x + 120, by + bh - 14); g.moveTo(x + 120, by + 12); g.lineTo(x, by + bh - 14); g.stroke(); }
  g.fillStyle = '#1a1b1f'; g.fillRect(0, by - 30, w, 30);
  // pylons under the bridge
  g.fillStyle = '#26282d'; g.fillRect(260, by + bh, 120, h - by - bh); g.fillRect(700, by + bh, 120, h - by - bh);
  g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(260, by + bh, 10, h); g.fillRect(810, by + bh, 10, h);
  // the train: three rounded cars with lit windows
  const cars = [[40, 1330, 330], [380, 1360, 330], [720, 1400, 330]];
  for (const [cx, cy, cw] of cars) {
    const chh = 190;
    g.fillStyle = '#4a4d55'; g.beginPath(); g.roundRect(cx, cy, cw, chh, 22); g.fill();
    g.fillStyle = '#2e3036'; g.fillRect(cx, cy + chh - 40, cw, 40);
    g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(cx, cy, cw, 10);
    for (let i = 0; i < 6; i++) {
      g.fillStyle = i % 3 === 1 ? '#dfe8ff' : '#ffe4b0';
      g.fillRect(cx + 22 + i * 50, cy + 44, 40, 60);
    }
    g.fillStyle = '#bcd8ff'; g.fillRect(cx + cw - 14, cy + 60, 6, 50);   // door lamp
    g.fillStyle = '#3b3d44'; for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(cx + 60 + k * 70, cy + chh, 22, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#0f1013'; g.fillRect(cx + 60, cy - 8, cw - 120, 8);  // pantograph rail
  }
  // headlights on first car
  g.fillStyle = '#ffffff'; for (let k = 0; k < 6; k++) { g.beginPath(); g.arc(58 + k * 16, 1415, 6, 0, Math.PI * 2); g.fill(); }
  // red neon kanji sign (乗車口) with cyan element, plus small red signs
  const neonSign = (x, y, sw, sh, chars, color, size) => {
    g.fillStyle = '#120507'; g.fillRect(x, y, sw, sh);
    g.strokeStyle = color; g.lineWidth = 4; g.shadowColor = color; g.shadowBlur = 24; g.strokeRect(x + 4, y + 4, sw - 8, sh - 8);
    g.fillStyle = color; g.font = `900 ${size}px 'Noto Sans JP'`; g.textAlign = 'center'; g.textBaseline = 'middle';
    chars.forEach((ch, i) => g.fillText(ch, x + sw / 2, y + sh * (i + 0.5) / chars.length));
    g.shadowBlur = 0;
  };
  neonSign(700, 520, 72, 250, ['乗', '車', '口'], '#ff3344', 54);
  g.fillStyle = '#6ae8ff'; g.shadowColor = '#6ae8ff'; g.shadowBlur = 18; g.fillRect(726, 740, 22, 22); g.shadowBlur = 0;
  neonSign(88, 330, 60, 130, ['修', '理'], '#ff2a3a', 38);
  g.fillStyle = '#ff2a3a'; g.shadowColor = '#ff2a3a'; g.shadowBlur = 16; g.font = "900 34px 'Noto Sans JP'"; g.fillText('食堂', 150, 1640 * 0.82); g.shadowBlur = 0;
  g.fillStyle = '#6ae8ff'; g.shadowColor = '#6ae8ff'; g.shadowBlur = 14; g.fillRect(240, 540, 5, 40); g.fillRect(1120, 1720, 5, 60); g.shadowBlur = 0;
  // street lamps and walkways low in frame
  for (let x = 40; x < w; x += 190) { g.fillStyle = '#ffe9c0'; g.shadowColor = '#ffe9c0'; g.shadowBlur = 20; g.beginPath(); g.arc(x, 1880 + (x % 3) * 30, 5, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0; }
  // overall darkening so the collage's lights dominate
  const vg = g.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0.0)'); vg.addColorStop(1, 'rgba(0,0,0,0.3)');
  g.fillStyle = vg; g.fillRect(0, 0, w, h);
}
{
  const c = canvas(1280, 1980), g = c.getContext('2d');
  const photo = await loadImage('assets/background.png') || await loadImage('assets/background.jpg');
  if (photo) {
    // cover-fit the photo onto the backdrop
    const sc = Math.max(c.width / photo.width, c.height / photo.height);
    const dw = photo.width * sc, dh = photo.height * sc;
    g.drawImage(photo, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
  } else {
    await document.fonts.load("900 40px 'Noto Sans JP'", '乗車口').catch(() => null);
    paintCity(g, c.width, c.height);
  }
  const geo = new THREE.PlaneGeometry(W * 1.04, H * 1.04);
  const tex = texture(c);
  const mat = new THREE.MeshStandardMaterial({ map: tex, color: hdr('#ffffff', 2.6), roughness: 0.72, metalness: 0.08, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.6 });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(W / 2, -H / 2, -220);
  scene.add(m);
  window.__backdrop = photo ? 'photo' : 'procedural';
}

// ---------------------------------------------------------------- fonts
const FONTS = [
  "900 40px 'Noto Sans JP'", "700 40px 'Noto Sans JP'", "900 40px 'Orbitron'", "700 40px 'Orbitron'",
  "40px 'Bebas Neue'", "40px 'Press Start 2P'", "40px 'Limelight'", "40px 'Monoton'", "40px 'Russo One'", "40px 'Russo One'",
];
await Promise.all(FONTS.map(f => document.fonts.load(f, '次の駅 ABC 123 ▲▼◆ ВПЕРЁД').catch(() => null)));

// ---------------------------------------------------------------- blocks
// Colours are the source block colours; outlines are traced from the source.

// 1. Big sky-blue tilted LED light panel  (#9cc0e4) + brighter sub-panel (#b4d8f0)
{
  const pts = [[43, 48], [200, 158], [251, 624], [63, 523], [0, 247]];
  const bb = bbox(pts);
  const cvs = canvas(bb.w * 3, bb.h * 3), g = cvs.getContext('2d');
  const grd = g.createLinearGradient(0, 0, cvs.width, cvs.height);
  grd.addColorStop(0, '#8ab8e8'); grd.addColorStop(0.5, '#6aa0dc'); grd.addColorStop(1, '#4f84c4');
  g.fillStyle = grd; g.fillRect(0, 0, cvs.width, cvs.height);
  // LED light bars running with the panel's tilt
  g.save(); g.translate(0, 0); g.rotate(-0.21);
  for (let x = -600; x < cvs.width + 600; x += 54) {
    const bright = (x / 54) % 3 === 0;
    g.fillStyle = bright ? 'rgba(200,240,255,0.95)' : 'rgba(255,255,255,0.18)';
    g.fillRect(x, -800, bright ? 7 : 3, cvs.height + 1600);
    if (bright) { g.fillStyle = 'rgba(180,235,255,0.35)'; g.fillRect(x - 10, -800, 27, cvs.height + 1600); }
  }
  g.restore();
  // cyberpunk data glyphs
  g.fillStyle = 'rgba(10,30,60,0.55)'; g.font = "900 22px 'Orbitron'";
  for (let i = 0; i < 26; i++) { g.fillText(['SYS', '0x3F', 'LUX', '7.4K', 'ON', '∆', '12V'][i % 7], 40 + (i * 97) % (cvs.width - 100), 90 + (i * 173) % (cvs.height - 120)); }
  g.fillStyle = 'rgba(255,255,255,0.08)';
  for (let y = 0; y < cvs.height; y += 6) g.fillRect(0, y, cvs.width, 2);
  emitterFace(pts, -60, cvs, 0.8);
  areaLight('#9cc0e4', 3.2, bb.cx, bb.cy - 40, -40, 170, 420, -0.1);
  halo('#9cc0e4', bb.cx, bb.cy, -65, 700, 0.14);

  // sub panel
  const sp = [[24, 43], [176, 148], [104, 190], [66, 162], [53, 163], [7, 126]];
  const sb = bbox(sp);
  const c2 = canvas(sb.w * 3, sb.h * 3), g2 = c2.getContext('2d');
  const gr2 = g2.createLinearGradient(0, 0, c2.width, 0); gr2.addColorStop(0, '#d6ecfb'); gr2.addColorStop(1, '#b4d8f0');
  g2.fillStyle = gr2; g2.fillRect(0, 0, c2.width, c2.height);
  g2.fillStyle = 'rgba(255,255,255,0.28)';
  for (let y = 0; y < c2.height; y += 9) g2.fillRect(0, y, c2.width, 4);
  g2.save(); g2.translate(c2.width * 0.42, c2.height * 0.62); g2.rotate(0.45);
  g2.fillStyle = '#0d2a4e'; g2.font = "900 54px 'Orbitron'"; g2.textAlign = 'center';
  g2.fillText('LED LIGHT', 0, 0);
  g2.font = "900 38px 'Noto Sans JP'"; g2.fillText('照明 ／ CYBER', 0, 48);
  g2.restore();
  emitterFace(sp, -55, c2, 1.0);
  areaLight('#cfe8ff', 4.5, sb.cx, sb.cy, -35, 150, 120, -0.6);
}

// 2. Lavender "led ad" panel  (#7878b4)
{
  const pts = [[92, 436], [214, 501], [210, 564], [186, 553], [184, 588], [84, 534]];
  const bb = bbox(pts);
  const cvs = ledCanvas(Math.round(bb.w / 2.2), Math.round(bb.h / 2.2), 6, (g, w, h) => {
    g.fillStyle = '#4a4a8c'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#9a9ae6'; g.fillRect(0, 0, w, h * 0.06); g.fillRect(0, h * 0.94, w, h * 0.06);
    g.fillStyle = '#e6e6ff'; g.font = "900 60px 'Orbitron'"; g.textAlign = 'center';
    g.fillText('LED AD', w / 2, h * 0.34);
    g.fillStyle = '#ffd2f0'; g.font = "900 58px 'Noto Sans JP'";
    g.fillText('ラーメン 24H', w / 2, h * 0.58);
    g.fillStyle = '#b8b8ff'; g.font = "44px 'Bebas Neue'";
    g.fillText('NEON NOODLE · LVL 3', w / 2, h * 0.82);
  }, { board: '#121228' });
  emitterFace(pts, -50, cvs, 1.35);
  areaLight('#8c8cd8', 3.0, bb.cx, bb.cy, -30, 110, 120, -0.45);
  halo('#8c8cd8', bb.cx, bb.cy, -52, 320, 0.16);
}

// 3. Left-edge stacked soft panels: lavender (#ccb4d8) and pinks (#f0b4cc)
{
  const panels = [
    { pts: [[0, 361], [72, 401], [62, 523], [0, 489]], color: '#ccb4d8', z: -40 },
    { pts: [[0, 497], [60, 529], [60, 543], [1, 512]], color: '#f0b4cc', z: -38 },
    { pts: [[0, 539], [57, 569], [31, 701], [0, 686]], color: '#f0b4cc', z: -38 },
  ];
  for (const p of panels) {
    const bb = bbox(p.pts);
    const cvs = canvas(bb.w * 3, bb.h * 3), g = cvs.getContext('2d');
    g.fillStyle = p.color; g.fillRect(0, 0, cvs.width, cvs.height);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    for (let y = 0; y < cvs.height; y += 14) g.fillRect(0, y, cvs.width, 5);
    g.fillStyle = 'rgba(80,20,60,0.25)';
    for (let x = 0; x < cvs.width; x += 30) g.fillRect(x, 0, 2, cvs.height);
    emitterFace(p.pts, p.z, cvs, 1.05);
    areaLight(p.color, 2.2, bb.cx, bb.cy, p.z + 20, bb.w, bb.h * 0.9, -0.5);
  }
  halo('#f0b4cc', 20, 600, -42, 300, 0.18);
}

// 4. The huge diagonal dark-blue block (#001824): one giant LED matrix with the rolling text
{
  const pts = [[0, 248], [738, 701], [698, 752], [0, 359]];
  const bb = bbox(pts);
  const len = Math.hypot(738, 453), hgt = 111;
  const cols = Math.round(len / 2.35), rows = Math.round(hgt / 2.35);
  const row1 = 'BREAKING ◆ ACID RAIN WARNING FOR DIHTOWN SECTOR 7 TONIGHT ◆ COUNCIL APPROVES THIRD SKY-RAIL LINE ◆ POWER RATIONING LIFTED IN OOSKAKSK ◆ 今夜のニュース ◆ ';
  const row2 = 'NKY 41,206 ▲1.2%   ARASAKA 882.10 ▼3.4%   TYO-HOLO 12.07 ▲0.8%   KAMI CORP 55.10 ▼0.3%   DIH-RAIL 9.42 ▲4.1%   LUX CREDIT 310 ▼0.9%   NEON GAS 2.11 ▲2.0%   ';
  const row3 = 'NEXT STATION ▶ DIHTOWN   次は ディータウン   THEN ▶ OOSKAKSK   オースカクスク   MIND THE GAP   ';
  const cvs = ledCanvas(cols, rows, 7, (g, w, h) => {
    g.fillStyle = '#001824'; g.fillRect(0, 0, w, h);
    const rh = h / 3;
    const line = (txt, y, font, color, speed) => {
      g.font = font; g.fillStyle = color; g.textBaseline = 'middle';
      const tw = g.measureText(txt).width;
      let x = -((TIME0 * speed) % tw);
      for (; x < w; x += tw) g.fillText(txt, x, y);
    };
    line(row1, rh * 0.5, "900 " + (rh * 0.62) + "px 'Noto Sans JP'", '#e6ffd0', 140);
    // stock ticker with coloured arrows
    g.font = "900 " + (rh * 0.62) + "px 'Noto Sans JP'"; g.textBaseline = 'middle';
    const tw = g.measureText(row2).width;
    let x = -((TIME0 * 95) % tw);
    for (; x < w; x += tw) {
      let cx = x;
      for (const tok of row2.split(/(▲[\d.]+%|▼[\d.]+%)/)) {
        g.fillStyle = tok.startsWith('▲') ? '#52ff7a' : tok.startsWith('▼') ? '#ff4d5a' : '#f2e860';
        g.fillText(tok, cx, rh * 1.5); cx += g.measureText(tok).width;
      }
    }
    line(row3, rh * 2.5, "900 " + (rh * 0.66) + "px 'Noto Sans JP'", '#ffd84a', 60);
    // row separators
    g.fillStyle = 'rgba(120,160,255,0.35)'; g.fillRect(0, rh - 2, w, 3); g.fillRect(0, rh * 2 - 2, w, 3);
    // art-deco advertisement set into the block: a woman dancing with a caped hero
    const ax = w * 0.22, aw = w * 0.13;
    g.fillStyle = '#041020'; g.fillRect(ax, 0, aw, h);
    g.save(); g.beginPath(); g.rect(ax, 0, aw, h); g.clip();
    g.translate(ax + aw / 2, h * 0.98); g.strokeStyle = '#ffd36a'; g.lineWidth = 4;
    for (let i = 0; i <= 18; i++) { const an = Math.PI + i * Math.PI / 18; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(an) * aw, Math.sin(an) * aw); g.stroke(); }
    g.restore();
    g.save(); g.translate(ax, 0);
    const dw = aw, dh = h;
    g.fillStyle = '#ffe28a';
    g.beginPath(); g.arc(dw * 0.36, dh * 0.30, dw * 0.055, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(dw * 0.36, dh * 0.36); g.lineTo(dw * 0.46, dh * 0.50); g.lineTo(dw * 0.56, dh * 0.86); g.lineTo(dw * 0.16, dh * 0.86); g.lineTo(dw * 0.26, dh * 0.50); g.closePath(); g.fill();
    g.strokeStyle = '#ffe28a'; g.lineWidth = dw * 0.035; g.lineCap = 'round';
    g.beginPath(); g.moveTo(dw * 0.32, dh * 0.42); g.lineTo(dw * 0.12, dh * 0.28); g.stroke();
    g.beginPath(); g.moveTo(dw * 0.42, dh * 0.42); g.lineTo(dw * 0.62, dh * 0.36); g.stroke();
    g.fillStyle = '#0a0c1a';
    g.beginPath(); g.moveTo(dw * 0.66, dh * 0.26); g.lineTo(dw * 0.62, dh * 0.16); g.lineTo(dw * 0.68, dh * 0.21); g.lineTo(dw * 0.78, dh * 0.21); g.lineTo(dw * 0.84, dh * 0.16); g.lineTo(dw * 0.80, dh * 0.26); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(dw * 0.62, dh * 0.30); g.lineTo(dw * 0.84, dh * 0.30); g.lineTo(dw * 0.98, dh * 0.86); g.lineTo(dw * 0.50, dh * 0.86); g.closePath(); g.fill();
    g.fillStyle = '#ffe9a8'; g.font = "" + dh * 0.11 + "px 'Limelight'"; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('DANCE WITH THE NIGHT', dw / 2, dh * 0.94);
    g.font = "" + dh * 0.09 + "px 'Limelight'"; g.fillText('ART DECO BALLROOM', dw / 2, dh * 0.07);
    g.restore();
  }, { board: '#030a12', gain: 1.1 });
  emitterFace(pts, 0, cvs, 1.3);
  // a long thin area light following the band
  const ang = -Math.atan2(453, 738);
  areaLight('#c8e070', 1.6, 369, 480, 25, len, 90, ang);
  halo('#b0d060', 200, 370, -3, 420, 0.10, 2.2);
  halo('#b0d060', 560, 600, -3, 420, 0.10, 2.2);
}

// 5. The LED "rolling stick" bar: dotted top (#4854a8 / pink halftone) + navy front (#0c0c3c) stock ticker
{
  const top = [[222, 301], [492, 412], [497, 431], [220, 324]];
  const front = [[220, 324], [497, 431], [489, 453], [474, 451], [219, 354]];
  const tb = bbox(top);
  const cTop = ledCanvas(Math.round(Math.hypot(270, 111) / 1.6), 16, 5, (g, w, h) => {
    for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 8) {
      g.fillStyle = ((x + y) / 8) % 2 === 0 ? '#5a6cff' : '#ff5aa0';
      g.fillRect(x, y, 6, 6);
    }
  }, { board: '#0a0a24', radius: 0.42 });
  emitterFace(top, 10, cTop, 1.0);
  const fb = bbox(front);
  const row = 'STICK MARKET ▶ DIH 9.42 ▲4.1%  OOS 3.10 ▼1.1%  NKY ▲1.2%  HOLO ▲0.8%  LUX ▼0.9%  RAIL ▲2.2%  ';
  const cFront = ledCanvas(Math.round(Math.hypot(277, 107) / 2.0), 15, 7, (g, w, h) => {
    g.fillStyle = '#0c0c3c'; g.fillRect(0, 0, w, h);
    g.font = "900 " + (h * 0.74) + "px 'Noto Sans JP'"; g.textBaseline = 'middle';
    const tw = g.measureText(row).width;
    let x = -((TIME0 * 120) % tw);
    for (; x < w; x += tw) {
      let cx = x;
      for (const tok of row.split(/(▲[\d.]+%|▼[\d.]+%)/)) {
        g.fillStyle = tok.startsWith('▲') ? '#4dffa0' : tok.startsWith('▼') ? '#ff4060' : '#9ab8ff';
        g.fillText(tok, cx, h / 2); cx += g.measureText(tok).width;
      }
    }
  }, { board: '#06061a' });
  emitterFace(front, 10, cFront, 1.7);
  // glowing end cap (the pale teal/pink edge in the source)
  neonTube([[492, 412], [497, 431], [489, 453]], 12, '#8af0e0', { closed: false, radius: 1.6, lightIntensity: 900 });
  areaLight('#7a86ff', 2.0, fb.cx, fb.cy, 35, 290, 30, -Math.atan2(107, 277));
}

// 6. Neon door frame: teal outer (#78c0c0) and pink inner (#d89cc0)
{
  neonTube([[194, 155], [232, 180], [218, 359], [176, 355]], -28, '#7ee8dc', { radius: 2.0, lightIntensity: 1800, flicker: true, seed: 1.3 });
  neonTube([[201, 168], [224, 183], [213, 319], [189, 306]], -26, '#ff9ad2', { radius: 2.0, lightIntensity: 1800 });
  halo('#9ad8d0', 205, 258, -32, 260, 0.14, 0.7);
}

// 7. Huge floating holo poster: purple frame (#3c1854) + mint hologram (#d8e4cc)
{
  const frame = [[307, 171], [402, 215], [404, 344], [302, 292]];
  const inner = [[315, 183], [394, 222], [397, 326], [311, 279]];
  matteFace(frame, -22, '#3c1854', { roughness: 0.4, metalness: 0.5, emissive: '#2a0e40', emissiveIntensity: 0.6 });
  neonTube(frame, -20, '#b45cff', { radius: 1.8, lightIntensity: 1500, boost: 2.0 });
  const bb = bbox(inner);
  const cvs = canvas(bb.w * 4, bb.h * 4), g = cvs.getContext('2d');
  g.clearRect(0, 0, cvs.width, cvs.height);
  const bg = g.createLinearGradient(0, 0, 0, cvs.height); bg.addColorStop(0, 'rgba(180,255,210,0.22)'); bg.addColorStop(1, 'rgba(120,230,190,0.08)');
  g.fillStyle = bg; g.fillRect(0, 0, cvs.width, cvs.height);
  // holographic globe rings
  g.strokeStyle = 'rgba(200,255,225,0.9)'; g.lineWidth = 3;
  const cx = cvs.width * 0.5, cy = cvs.height * 0.42, R = cvs.width * 0.3;
  for (let i = 0; i < 7; i++) { g.beginPath(); g.ellipse(cx, cy, R, R * Math.abs(Math.cos(i * 0.45)), 0, 0, Math.PI * 2); g.stroke(); }
  for (let i = 0; i < 7; i++) { g.beginPath(); g.ellipse(cx, cy, R * Math.abs(Math.cos(i * 0.45)), R, 0, 0, Math.PI * 2); g.stroke(); }
  g.fillStyle = '#eafff2'; g.font = "900 " + cvs.width * 0.16 + "px 'Noto Sans JP'"; g.textAlign = 'center';
  g.fillText('新発売', cx, cvs.height * 0.86);
  g.font = "700 " + cvs.width * 0.07 + "px 'Orbitron'"; g.fillStyle = '#c8ffe0';
  g.fillText('HOLO · VISION', cx, cvs.height * 0.95);
  g.fillStyle = 'rgba(255,255,255,0.8)';
  for (let i = 0; i < 40; i++) g.fillRect(Math.random() * cvs.width, Math.random() * cvs.height, 2 + Math.random() * 10, 2);
  scanlines(g, cvs.width, cvs.height, 4, 0.35);
  glitchSlices(g, cvs.width, cvs.height, 5, 11);
  const m = emitterFace(inner, -18, cvs, 1.5, { transparent: true, additive: true, opacity: 0.95 });
  animated.push({ update(t) { m.material.opacity = 0.8 + 0.2 * Math.sin(t * 9.0) * Math.sin(t * 2.3); } });
  const bb2 = bbox(frame);
  areaLight('#b8ffd8', 2.4, bb2.cx, bb2.cy, 10, 90, 130, -0.4);
  halo('#b8ffd8', bb2.cx, bb2.cy, -24, 300, 0.18);
}

// 8. Teal parallelogram sign (#6cc0b4)
{
  const pts = [[607, 147], [656, 171], [663, 230], [613, 213]];
  const bb = bbox(pts);
  const cvs = ledCanvas(28, 40, 6, (g, w, h) => {
    g.fillStyle = '#167a70'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#aefff2'; g.textAlign = 'center'; g.font = "900 54px 'Noto Sans JP'";
    g.fillText('営', w / 2, h * 0.28); g.fillText('業', w / 2, h * 0.56); g.fillText('中', w / 2, h * 0.84);
    g.fillStyle = '#6cf0dc'; g.font = "900 20px 'Orbitron'"; g.fillText('OPEN', w / 2, h * 0.97);
  }, { board: '#04161a' });
  emitterFace(pts, -30, cvs, 1.4);
  areaLight('#6cc0b4', 2.4, bb.cx, bb.cy, -10, 50, 80, -0.4);
  halo('#6cc0b4', bb.cx, bb.cy, -33, 190, 0.2);
}

// 9. Japanese holographic neon advertisement (yellow text, two floating columns)
{
  const makeHolo = (x0, y0, w, h, lines, size, z, big) => {
    const cvs = canvas(w * 4, h * 4), g = cvs.getContext('2d');
    g.clearRect(0, 0, cvs.width, cvs.height);
    g.font = "900 " + size * 4 + "px 'Noto Sans JP'"; g.textAlign = 'center'; g.textBaseline = 'top';
    const colW = cvs.width / lines.length;
    lines.forEach((txt, ci) => {
      const cx = colW * (lines.length - ci) - colW / 2;   // right-to-left vertical columns
      [...txt].forEach((ch, i) => {
        const y = 8 + i * size * 4 * 1.06;
        g.shadowColor = '#fff26a'; g.shadowBlur = 18;
        g.fillStyle = 'rgba(0,255,255,0.55)'; g.fillText(ch, cx - 4, y);
        g.fillStyle = 'rgba(255,0,180,0.45)'; g.fillText(ch, cx + 4, y);
        g.shadowBlur = 8; g.fillStyle = '#ffee5c'; g.fillText(ch, cx, y);
        g.shadowBlur = 0; g.fillStyle = '#fffbd0'; g.globalAlpha = 0.65; g.fillText(ch, cx, y); g.globalAlpha = 1;
      });
    });
    // red star emblem for the big column block
    if (big) {
      g.save(); g.translate(cvs.width * 0.5, cvs.height * 0.955); g.fillStyle = '#ff3b3b'; g.shadowColor = '#ff5050'; g.shadowBlur = 20;
      g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 14 : 34, a = -Math.PI / 2 + i * Math.PI / 5; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.fill(); g.restore();
    }
    scanlines(g, cvs.width, cvs.height, 4, 0.3);
    glitchSlices(g, cvs.width, cvs.height, 4, 5);
    const pts = [[x0, y0], [x0 + w, y0 - w * 0.12], [x0 + w, y0 + h - w * 0.12], [x0, y0 + h]];
    const m = emitterFace(pts, z, cvs, 1.3, { transparent: true, additive: true, opacity: 0.95 });
    animated.push({ update(t) { m.material.opacity = 0.85 + 0.15 * Math.sin(t * 13.0 + x0); } });
    return bbox(pts);
  };
  const b1 = makeHolo(683, 212, 104, 175, ['偉大なる指導者', '習近平同志', '人民に奉仕'], 20, 22, true);
  const b2 = makeHolo(636, 250, 56, 150, ['共産党万歳', 'ホログラム広告'], 12, 18, false);
  areaLight('#ffe84a', 2.6, b1.cx, b1.cy, 40, 100, 170, -0.1);
  halo('#ffe84a', b1.cx, b1.cy, 15, 330, 0.17, 0.8);
  halo('#ffe84a', b2.cx, b2.cy, 12, 200, 0.12, 0.6);
}

// 10. The dark-blue bracket (#243090): art-deco LED sign with a gold neon outline
{
  const pts = [[635, 363], [646, 456], [554, 540], [551, 498], [621, 435], [621, 424], [617, 396], [549, 455], [546, 443]];
  const bb = bbox(pts);
  const cvs = ledCanvas(Math.round(bb.w / 1.6), Math.round(bb.h / 1.6), 5, (g, w, h) => {
    g.fillStyle = '#1d2a8c'; g.fillRect(0, 0, w, h);
    // art deco sunburst stripes
    g.strokeStyle = '#ffd36a'; g.lineWidth = 6;
    for (let i = 0; i < 16; i++) { g.beginPath(); g.moveTo(w, h); g.lineTo(w - Math.cos(i * 0.1) * w * 1.6, h - Math.sin(i * 0.1) * h * 1.6); g.stroke(); }
    g.fillStyle = '#ffe9a8'; g.font = "900 " + w * 0.11 + "px 'Limelight'";
    g.save(); g.translate(w * 0.5, h * 0.9); g.rotate(-0.72); g.textAlign = 'center';
    g.fillText('DANCE · TONIGHT', 0, 0); g.restore();
  }, { board: '#070a24', gain: 0.9 });
  emitterFace(pts, 0, cvs, 1.6);
  neonTube(pts, 2, '#ffcf5a', { radius: 1.6, lightEvery: 2, lightIntensity: 1200, boost: 1.6 });
  areaLight('#4a5ae0', 1.8, bb.cx, bb.cy, 20, 90, 160, -0.6);
}

// 11. Huge Soviet-style digital poster on the red block (#e41824) + green side (#60b43c) + dark underside (#000c00)
{
  const red = [[390, 540], [636, 718], [636, 782], [387, 657]];
  const green = [[340, 551], [387, 578], [385, 656], [341, 673]];
  const dark = [[343, 674], [387, 657], [636, 782], [591, 813]];
  const bb = bbox(red); const qd = quadDims(red);
  const cvs = ledCanvas(Math.round(qd.u / 1.2), Math.round(qd.v / 1.2), 4, (g, w, h) => {
    g.fillStyle = '#e41824'; g.fillRect(0, 0, w, h);
    // constructivist diagonals
    g.fillStyle = '#1a0608'; g.beginPath(); g.moveTo(w * 0.30, h); g.lineTo(w * 0.62, 0); g.lineTo(w * 0.70, 0); g.lineTo(w * 0.38, h); g.closePath(); g.fill();
    g.fillStyle = '#ffe7c2'; g.beginPath(); g.moveTo(w * 0.36, h); g.lineTo(w * 0.68, 0); g.lineTo(w * 0.705, 0); g.lineTo(w * 0.395, h); g.closePath(); g.fill();
    g.fillStyle = '#1a0608'; g.fillRect(0, h * 0.84, w, h * 0.16);
    // star
    g.save(); g.translate(w * 0.11, h * 0.40); g.fillStyle = '#ffd24a';
    g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? h * 0.13 : h * 0.32, a = -Math.PI / 2 + i * Math.PI / 5; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.fill(); g.restore();
    // raised fist / worker silhouette at right
    g.fillStyle = '#1a0608';
    g.beginPath(); g.moveTo(w * 0.86, h * 0.84); g.lineTo(w * 0.86, h * 0.34); g.lineTo(w * 0.89, h * 0.22); g.lineTo(w * 0.95, h * 0.22); g.lineTo(w * 0.98, h * 0.34); g.lineTo(w * 0.98, h * 0.52); g.lineTo(w * 0.94, h * 0.56); g.lineTo(w * 0.94, h * 0.84); g.closePath(); g.fill();
    // slogans
    g.fillStyle = '#fff3e0'; g.font = "" + h * 0.46 + "px 'Russo One'"; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillText('ВПЕРЁД!', w * 0.22, h * 0.62);
    g.fillStyle = '#ffd24a'; g.font = "" + h * 0.15 + "px 'Russo One'";
    g.fillText('СЛАВА ТРУДУ · 2077', w * 0.22, h * 0.80);
    g.fillStyle = '#ffd24a'; g.font = "" + h * 0.11 + "px 'Press Start 2P'"; g.textAlign = 'right';
    g.fillText('DIGITAL POSTER', w * 0.98, h * 0.96);
    g.fillStyle = '#ff6a70'; g.textAlign = 'left'; g.fillText('SOVIET STYLE', w * 0.02, h * 0.96);
    g.fillStyle = 'rgba(0,0,0,0.18)'; for (let y = 0; y < h; y += 8) g.fillRect(0, y, w, 3);
    glitchSlices(g, w, h, 7, 3);
  }, { board: '#140305', radius: 0.42, gain: 1.1 });
  emitterFace(red, 20, cvs, 1.3);
  // the side faces are matte surfaces lit by the scene; the green one carries a green LED edge strip
  matteFace(green, 20, '#60b43c', { normal: [-0.75, 0, 0.66], roughness: 0.5, emissive: '#2a5a14', emissiveIntensity: 0.9 });
  neonTube([[340, 551], [341, 673]], 22, '#9cff5a', { closed: false, radius: 1.5, lightIntensity: 1400 });
  matteFace(dark, 20, '#0a1a0c', { normal: [0, -0.8, 0.6], roughness: 0.7, metalness: 0.2 });
  areaLight('#ff2a35', 4.2, bb.cx, bb.cy, 45, 230, 170, -0.63);
  halo('#ff2030', bb.cx, bb.cy, 17, 520, 0.2);
}

// 12. Brown cyberpunk ad (#30180c) with amber neon lettering, plus its small top face (#785448)
{
  const pts = [[32, 703], [145, 760], [136, 830], [23, 775]];
  const top = [[0, 687], [30, 702], [23, 774], [0, 763]];
  const bb = bbox(pts); const qd = quadDims(pts);
  const base = canvas(qd.u * 4, qd.v * 4), g = base.getContext('2d');
  g.fillStyle = '#3a2214'; g.fillRect(0, 0, base.width, base.height);
  g.fillStyle = 'rgba(0,0,0,0.25)'; for (let y = 0; y < base.height; y += 18) g.fillRect(0, y, base.width, 6);
  const em = canvas(qd.u * 4, qd.v * 4), e = em.getContext('2d');
  e.fillStyle = '#000'; e.fillRect(0, 0, em.width, em.height);
  neonText(e, 'CYBER', em.width * 0.5, em.height * 0.42, '#ffa028', { font: "900 " + em.width * 0.19 + "px 'Orbitron'", align: 'center', width: 4, core: '#fff0d0' });
  neonText(e, 'AUGMENT', em.width * 0.5, em.height * 0.72, '#ff7a1a', { font: "900 " + em.width * 0.14 + "px 'Orbitron'", align: 'center', width: 4, core: '#ffe8c8' });
  e.font = "900 " + em.width * 0.06 + "px 'Orbitron'"; e.textAlign = 'center'; e.fillStyle = '#ffc070'; e.shadowColor = '#ff9020'; e.shadowBlur = 10;
  e.fillText('義体 · 24H CLINIC', em.width * 0.5, em.height * 0.90);
  matteFace(pts, -10, '#ffffff', { map: base, emissiveMap: em, emissiveIntensity: 1.6, roughness: 0.6 });
  matteFace(top, -12, '#785448', { normal: [-0.7, 0.3, 0.65], roughness: 0.6 });
  neonTube(pts, -8, '#ff9a2a', { radius: 1.4, lightIntensity: 1500, boost: 1.5 });
  areaLight('#ff9a2a', 1.6, bb.cx, bb.cy, 10, 110, 90, -0.45);
  halo('#ff9a2a', bb.cx, bb.cy, -14, 300, 0.14);
}

// 13. Long maroon cyberpunk ad bar (#240000) with dark underside (#180c18) and glowing red cap (#780000)
{
  const top = [[255, 815], [589, 990], [570, 1000], [254, 857]];
  const dark = [[254, 857], [537, 997], [536, 1030], [254, 887]];
  const cap = [[568, 982], [569, 1049], [537, 1033], [537, 999]];
  const tb = bbox(top); const qd = quadDims(top);
  const base = canvas(qd.u * 4, qd.v * 4), g = base.getContext('2d');
  g.fillStyle = '#3a0a10'; g.fillRect(0, 0, base.width, base.height);
  g.fillStyle = 'rgba(0,0,0,0.3)'; for (let x = 0; x < base.width; x += 40) g.fillRect(x, 0, 14, base.height);
  const em = canvas(qd.u * 4, qd.v * 4), e = em.getContext('2d');
  e.fillStyle = '#000'; e.fillRect(0, 0, em.width, em.height);
  // text runs along the bar: the quad maps u along the top edge, so draw horizontally and let the shear do the rest
  neonText(e, 'IMPLANT CLINIC', em.width * 0.03, em.height * 0.68, '#ff2a6a', { font: "900 " + em.height * 0.56 + "px 'Orbitron'", width: 4, core: '#ffd8e4', baseline: 'alphabetic' });
  neonText(e, '▶ NIGHT SHIFT ▶ 義体改造', em.width * 0.52, em.height * 0.68, '#ff4a4a', { font: "900 " + em.height * 0.5 + "px 'Noto Sans JP'", width: 3, core: '#fff0f0', blur: 18 });
  matteFace(top, 0, '#ffffff', { map: base, emissiveMap: em, emissiveIntensity: 1.7, roughness: 0.55, metalness: 0.2 });
  matteFace(dark, 0, '#2a1220', { normal: [0, -0.8, 0.6], roughness: 0.7, metalness: 0.25 });
  // red LED cap
  const cc = ledCanvas(8, 16, 6, (g2, w, h) => { g2.fillStyle = '#ff2030'; g2.fillRect(0, 0, w, h); g2.fillStyle = '#ffb0b0'; g2.fillRect(0, h * 0.45, w, h * 0.1); }, { board: '#1a0004', radius: 0.44 });
  emitterFace(cap, 2, cc, 1.5);
  pointLight('#ff2030', 5000, 553, 1015, 30, 420);
  neonTube([[255, 815], [589, 990]], 3, '#ff2a6a', { closed: false, radius: 1.5, lightEvery: 1, lightIntensity: 1600 });
  areaLight('#ff3050', 1.7, tb.cx, tb.cy, 25, 370, 40, -Math.atan2(175, 334));
  halo('#ff2a5a', 553, 1015, -2, 260, 0.22);
}

// 14. Light-green vertical strip (#9ccc30): a tall green LED tube
{
  const pts = [[181, 636], [208, 650], [184, 849], [156, 838]];
  const bb = bbox(pts);
  const cvs = canvas(bb.w * 4, bb.h * 4), g = cvs.getContext('2d');
  const grd = g.createLinearGradient(0, 0, cvs.width, 0); grd.addColorStop(0, '#6a9a18'); grd.addColorStop(0.5, '#e8ff9a'); grd.addColorStop(1, '#6a9a18');
  g.fillStyle = grd; g.fillRect(0, 0, cvs.width, cvs.height);
  g.fillStyle = 'rgba(0,0,0,0.25)'; for (let y = 0; y < cvs.height; y += 60) g.fillRect(0, y, cvs.width, 6);
  emitterFace(pts, -20, cvs, 1.5);
  areaLight('#b8ff40', 2.6, bb.cx, bb.cy, 0, 26, 210, -0.12);
  halo('#b8ff40', bb.cx, bb.cy, -22, 330, 0.16, 0.45);
}

// 15. Dark teal triangles (#0c3030 / #001824): matte, with one teal neon edge each
{
  matteFace([[149, 994], [211, 966], [258, 1044]], -30, '#0c3030', { roughness: 0.5, metalness: 0.3 });
  neonTube([[211, 966], [258, 1044]], -28, '#2ad8c8', { closed: false, radius: 1.2, lightIntensity: 700 });
  matteFace([[194, 0], [250, 0], [247, 42]], -30, '#001824', { roughness: 0.5, metalness: 0.3 });
  neonTube([[250, 0], [247, 42]], -28, '#2ad8c8', { closed: false, radius: 1.2, lightIntensity: 600 });
}

// 16. Red neon triangle on the right edge (#e41824)
{
  const pts = [[791, 632], [791, 682], [754, 710], [739, 701]];
  const cvs = canvas(80, 120), g = cvs.getContext('2d');
  g.fillStyle = 'rgba(228,24,36,0.55)'; g.fillRect(0, 0, 80, 120);
  emitterFace(pts, 0, cvs, 1.2, { transparent: true, opacity: 0.7 });
  neonTube(pts, 2, '#ff3040', { radius: 1.6, lightIntensity: 1100 });
}

// 17. Pale blue LED light panel bottom right (#b4c0e4) with slate top face (#24303c)
{
  const pts = [[700, 754], [791, 805], [791, 920], [699, 869]];
  const top = [[754, 712], [791, 734], [791, 803], [701, 752]];
  const bb = bbox(pts); const qd = quadDims(pts);
  const cvs = canvas(qd.u * 3, qd.v * 3), g = cvs.getContext('2d');
  g.fillStyle = '#b4c0e4'; g.fillRect(0, 0, cvs.width, cvs.height);
  g.fillStyle = 'rgba(255,255,255,0.45)'; for (let y = 0; y < cvs.height; y += 12) g.fillRect(0, y, cvs.width, 5);
  g.fillStyle = 'rgba(30,40,90,0.35)'; for (let x = 0; x < cvs.width; x += 36) g.fillRect(x, 0, 3, cvs.height);
  g.fillStyle = '#243a7a'; g.font = "900 34px 'Orbitron'"; g.textAlign = 'center';
  g.save(); g.translate(cvs.width / 2, cvs.height / 2); g.rotate(0.5); g.fillText('LED · PANEL', 0, 0); g.fillText('照明', 0, 40); g.restore();
  emitterFace(pts, -30, cvs, 1.15);
  matteFace(top, -30, '#24303c', { normal: [0, 0.75, 0.66], roughness: 0.5, metalness: 0.3 });
  areaLight('#b4c0e4', 3.2, bb.cx, bb.cy, -10, 90, 110, -0.5);
  halo('#b4c0e4', bb.cx, bb.cy, -33, 320, 0.16);
}

// 18. The huge LED wall bottom right (blue/pink halftone): art-deco "woman dancing with a caped hero" + LIVE
{
  const pts = [[680, 1040], [792, 990], [792, 1224], [680, 1224]];
  const bb = bbox(pts);
  const cvs = ledCanvas(Math.round(bb.w / 1.3), Math.round(bb.h / 1.3), 5, (g, w, h) => {
    g.fillStyle = '#1c2a9a'; g.fillRect(0, 0, w, h);
    // halftone dot field, blue + pink like the source texture
    for (let y = 0; y < h; y += 10) for (let x = 0; x < w; x += 10) { g.fillStyle = ((x + y) / 10) % 2 ? 'rgba(255,90,160,0.55)' : 'rgba(90,120,255,0.55)'; g.fillRect(x + 2, y + 2, 5, 5); }
    // art-deco sunburst behind the dancers
    g.save(); g.translate(w * 0.5, h * 0.62); g.strokeStyle = '#ffd36a'; g.lineWidth = 5;
    for (let i = 0; i < 24; i++) { const a = Math.PI + i * Math.PI / 23; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * w, Math.sin(a) * w); g.stroke(); }
    g.restore();
    // dancer (flared dress) in gold
    g.fillStyle = '#ffe28a';
    g.beginPath(); g.arc(w * 0.38, h * 0.36, w * 0.055, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(w * 0.38, h * 0.41); g.lineTo(w * 0.47, h * 0.52); g.lineTo(w * 0.56, h * 0.80); g.lineTo(w * 0.20, h * 0.80); g.lineTo(w * 0.30, h * 0.52); g.closePath(); g.fill();
    g.lineWidth = w * 0.03; g.strokeStyle = '#ffe28a'; g.lineCap = 'round';
    g.beginPath(); g.moveTo(w * 0.34, h * 0.46); g.lineTo(w * 0.16, h * 0.34); g.stroke();
    g.beginPath(); g.moveTo(w * 0.42, h * 0.46); g.lineTo(w * 0.60, h * 0.40); g.stroke();
    // caped partner in black silhouette with pointed cowl
    g.fillStyle = '#05060f';
    g.beginPath(); g.moveTo(w * 0.70, h * 0.30); g.lineTo(w * 0.66, h * 0.22); g.lineTo(w * 0.70, h * 0.26); g.lineTo(w * 0.78, h * 0.26); g.lineTo(w * 0.82, h * 0.22); g.lineTo(w * 0.78, h * 0.30); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(w * 0.64, h * 0.34); g.lineTo(w * 0.84, h * 0.34); g.lineTo(w * 0.96, h * 0.80); g.lineTo(w * 0.52, h * 0.80); g.closePath(); g.fill();
    g.strokeStyle = '#05060f'; g.beginPath(); g.moveTo(w * 0.66, h * 0.44); g.lineTo(w * 0.60, h * 0.40); g.stroke();
    // LIVE badge + title
    g.fillStyle = '#ff2040'; g.fillRect(w * 0.06, h * 0.04, w * 0.34, h * 0.07);
    g.fillStyle = '#fff'; g.font = "900 " + w * 0.09 + "px 'Orbitron'"; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText('● LIVE', w * 0.09, h * 0.075);
    g.fillStyle = '#ffe9a8'; g.font = "" + w * 0.085 + "px 'Limelight'"; g.textAlign = 'center';
    g.fillText('A HUGE LIVE SHOW', w * 0.5, h * 0.17);
    g.fillText('DANCE WITH THE NIGHT', w * 0.5, h * 0.24);
    g.fillStyle = '#ffffff'; g.font = "900 " + w * 0.06 + "px 'Noto Sans JP'";
    g.fillText('今夜 ・ 生放送 ・ 24H', w * 0.5, h * 0.90);
    g.fillStyle = '#ffd36a'; g.font = "" + w * 0.065 + "px 'Limelight'"; g.fillText('ART · DECO · NITE', w * 0.5, h * 0.96);
  }, { board: '#060818', radius: 0.42, gain: 1.05 });
  emitterFace(pts, 10, cvs, 1.3);
  areaLight('#6a7aff', 3.0, bb.cx, bb.cy, 35, 110, 230, 0);
  areaLight('#ff5aa0', 1.2, bb.cx, bb.cy + 40, 35, 110, 150, 0);
  halo('#7080ff', bb.cx, bb.cy, 7, 520, 0.18, 0.7);
}

// 19. The three yellow light tracks (#fce49c): physical rails with a light strip, and area lights along them
{
  const slope = 0.546;
  const rails = [492, 510, 530];       // y at x = 0
  const x0 = -60, x1 = 820;
  const ang = -Math.atan(slope);
  const len = Math.hypot(x1 - x0, (x1 - x0) * slope);
  rails.forEach((y0, i) => {
    const a = [x0, y0 + x0 * slope], b = [x1, y0 + x1 * slope];
    // dark rail bed under the strip
    const off = 6;
    const bed = [[a[0], a[1] - off], [b[0], b[1] - off], [b[0], b[1] + off], [a[0], a[1] + off]];
    matteFace(bed, -48, '#2a2a30', { roughness: 0.35, metalness: 0.7 });
    // brackets every 48 px
    for (let x = 0; x < W + 40; x += 48) {
      const y = y0 + x * slope;
      matteFace([[x - 3, y - 9], [x + 3, y - 9], [x + 3, y + 9], [x - 3, y + 9]], -47, '#17171c', { roughness: 0.4, metalness: 0.7 });
    }
    neonTube([a, b], -45, '#ffd978', { closed: false, radius: 1.5, light: false, coreColor: '#fff4cc', coreBoost: 1.3, boost: 1.1, glowOpacity: 0.08, tubeOpacity: 0.3 });
    areaLight('#ffd978', 1.1, (x0 + x1) / 2, y0 + (x0 + x1) / 2 * slope, -25, len, 8, ang);
    // point lights spaced along the rail for a readable falloff on the backdrop
    for (let x = 40; x < W; x += 150) pointLight('#ffd978', 1300, x, y0 + x * slope, -20, 300);
  });
  halo('#ffd978', 150, 600, -47, 360, 0.08, 1.6);
  halo('#ffd978', 450, 770, -47, 360, 0.08, 1.6);
  halo('#ffd978', 720, 920, -47, 360, 0.08, 1.6);
}

// ---------------------------------------------------------------- haze particles (dust in the light)
{
  const n = 900, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = Math.random() * W; pos[i * 3 + 1] = -Math.random() * H; pos[i * 3 + 2] = -150 + Math.random() * 200;
    const c = hex(['#ffd978', '#9cc0e4', '#ff4060', '#b8ff40', '#ffe84a'][i % 5]);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: 2.2, vertexColors: true, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, map: haloTex, sizeAttenuation: false });
  const pts = new THREE.Points(geo, mat);
  scene.add(pts);
  animated.push({ update(t) { pts.position.y = Math.sin(t * 0.2) * 4; pts.position.x = Math.cos(t * 0.13) * 3; } });
}

// ---------------------------------------------------------------- renderer + post
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('stage').appendChild(renderer.domElement);

const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType }));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.45, 0.4, 0.9);
composer.addPass(bloom);
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, res: { value: new THREE.Vector2(W, H) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time; uniform vec2 res; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      vec2 d = (uv - 0.5);
      float r2 = dot(d, d);
      // slight lens chromatic spread, stronger toward the edges
      vec2 ca = d * r2 * 0.012;
      vec3 c;
      c.r = texture2D(tDiffuse, uv + ca).r;
      c.g = texture2D(tDiffuse, uv).g;
      c.b = texture2D(tDiffuse, uv - ca).b;
      // vignette
      c *= 1.0 - smoothstep(0.25, 0.95, r2 * 1.6) * 0.55;
      // fine grain
      float g = hash(uv * res + fract(time) * 10.0) - 0.5;
      c += g * 0.025;
      gl_FragColor = vec4(c, 1.0);
    }`
});
composer.addPass(grade);
composer.addPass(new OutputPass());

function resize() {
  const vw = window.innerWidth, vh = window.innerHeight;
  const s = STILL ? 1 : Math.min(vw / W, vh / H);
  renderer.setSize(Math.round(W * s), Math.round(H * s), true);
  composer.setSize(Math.round(W * s), Math.round(H * s));     // the composer applies the pixel ratio itself
  bloom.setSize(W, H);                                          // bloom blur radius is defined in texels: keep it resolution-independent
  grade.uniforms.res.value.set(W * s * renderer.getPixelRatio(), H * s * renderer.getPixelRatio());
}
window.addEventListener('resize', resize);
resize();

let mouse = { x: 0.5, y: 0.5 };
window.addEventListener('mousemove', (e) => { mouse.x = e.clientX / window.innerWidth; mouse.y = e.clientY / window.innerHeight; });
window.addEventListener('keydown', (e) => {
  if (e.key === 's' || e.key === 'S') {
    const a = document.createElement('a'); a.download = 'neon-render.png'; a.href = renderer.domElement.toDataURL('image/png'); a.click();
  }
});

const clock = new THREE.Clock();
function frame() {
  const t = STILL ? TIME0 : TIME0 + clock.getElapsedTime();
  for (const a of animated) a.update(t);
  grade.uniforms.time.value = t;
  if (!STILL) { camera.position.x = (mouse.x - 0.5) * 6; camera.position.y = -(mouse.y - 0.5) * 6; }
  composer.render();
  if (!STILL) requestAnimationFrame(frame);
}
frame();
if (STILL) { frame(); }       // second pass so every texture upload has landed
window.__ready = true;
