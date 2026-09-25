// Light bars: glowing tubes laid along both sides of a gun, after VALORANT's
// Afterglow. They are real geometry, so they have volume and sit on top of
// everything else: the pattern, part finishes and stickers.
//
// Each bar is built like an LED tube light: a frosted diffuser that glows
// brightest down its middle, under a glossy clear shell that picks up
// reflections and highlights, with a black metal cap on each end and a soft
// glow around it.
//
// Where they go: the gun's triangles are rasterised into a depth map of each
// side (the nearest surface seen from -z and from +z, per 2.5 mm cell). Bars
// run along the rows of that map with the longest smooth stretches of
// surface (the receiver, handguard, stock), jog at 45 degrees here and there,
// and follow the surface in and out, just off it. A row of short lit
// segments goes where there's room. The layout seed picks among the good
// rows and places the jogs.
import * as THREE from '../vendor/three.module.min.js';
import { rng } from './skins.js';

const CELL = 0.0025; // depth-map resolution, m
const RADIUS = 0.0016; // tube radius, m
const CAP_IN = 2; // end cap: length over the tube, in tube radii
const CAP_OUT = 0.8; // and past its end
const CAP_R = 1.14; // and its radius
const HALO = 2.8; // glow radius, in tube radii
const CORE_GLOW = 0.95; // diffuser brightness
const HALO_GLOW = 0.55; // glow brightness
const LIFT = 0.0006; // gap between the surface and the tube
const MIN_RUN = 20; // shortest bar, in cells (5 cm)

// Triangles of every visible mesh under `group`, in `root`'s space.
function triangles(root, group) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const out = [];
  group.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    for (let p = o; p && p !== group; p = p.parent) if (!p.visible) return;
    m.multiplyMatrices(inv, o.matrixWorld);
    const pos = o.geometry.attributes.position;
    const idx = o.geometry.index;
    const n = idx ? idx.count : pos.count;
    for (let k = 0; k + 2 < n; k++) {
      v.fromBufferAttribute(pos, idx ? idx.getX(k) : k).applyMatrix4(m);
      out.push(v.x, v.y, v.z);
    }
  });
  return new Float32Array(out);
}

// For each (x, y) cell, the smallest and largest z of the surface there.
function depthMaps(T) {
  let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
  for (let i = 0; i < T.length; i += 3) {
    x0 = Math.min(x0, T[i]); x1 = Math.max(x1, T[i]);
    y0 = Math.min(y0, T[i + 1]); y1 = Math.max(y1, T[i + 1]);
  }
  const nx = Math.ceil((x1 - x0) / CELL) + 1;
  const ny = Math.ceil((y1 - y0) / CELL) + 1;
  const near = new Float32Array(nx * ny).fill(Infinity);
  const far = new Float32Array(nx * ny).fill(-Infinity);
  const put = (i, j, z) => {
    if (i < 0 || j < 0 || i >= nx || j >= ny) return;
    const k = j * nx + i;
    if (z < near[k]) near[k] = z;
    if (z > far[k]) far[k] = z;
  };
  for (let t = 0; t < T.length; t += 9) {
    const ax = T[t]; const ay = T[t + 1]; const az = T[t + 2];
    const bx = T[t + 3]; const by = T[t + 4]; const bz = T[t + 5];
    const cx = T[t + 6]; const cy = T[t + 7]; const cz = T[t + 8];
    const i0 = Math.floor((Math.min(ax, bx, cx) - x0) / CELL);
    const i1 = Math.ceil((Math.max(ax, bx, cx) - x0) / CELL);
    const j0 = Math.floor((Math.min(ay, by, cy) - y0) / CELL);
    const j1 = Math.ceil((Math.max(ay, by, cy) - y0) / CELL);
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(d) < 1e-12) continue; // edge-on from the side
    if (i1 - i0 <= 1 && j1 - j0 <= 1) {
      // Smaller than a cell: its centre stands for it.
      put(Math.round(((ax + bx + cx) / 3 - x0) / CELL), Math.round(((ay + by + cy) / 3 - y0) / CELL), (az + bz + cz) / 3);
      continue;
    }
    for (let j = j0; j <= j1; j++) {
      const py = y0 + j * CELL;
      for (let i = i0; i <= i1; i++) {
        const px = x0 + i * CELL;
        const w1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d;
        const w2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d;
        const w3 = 1 - w1 - w2;
        if (w1 < -1e-6 || w2 < -1e-6 || w3 < -1e-6) continue;
        put(i, j, w1 * az + w2 * bz + w3 * cz);
      }
    }
  }
  return { x0, y0, nx, ny, near, far };
}

// Cells on one side (s = -1 or 1) where a bar can lie: surface there and
// three cells above and below (so not on an edge), and flat enough across
// and along.
function barCells(D, s) {
  const { nx, ny } = D;
  const z = s < 0 ? D.near : D.far;
  const at = (i, j) => z[j * nx + i];
  const ok = new Uint8Array(nx * ny);
  for (let j = 3; j < ny - 3; j++) {
    for (let i = 1; i < nx - 1; i++) {
      const c = at(i, j);
      if (!Number.isFinite(c)) continue;
      const up = at(i, j + 3); const dn = at(i, j - 3);
      if (!Number.isFinite(up) || !Number.isFinite(dn)) continue;
      if (Math.abs(up - dn) > 6 * CELL * 0.9) continue; // steeper than ~42° across
      const l = at(i - 1, j); const r = at(i + 1, j);
      if (!Number.isFinite(l) || !Number.isFinite(r) || Math.abs(r - l) > 2 * CELL * 1.2) continue;
      ok[j * nx + i] = 1;
    }
  }
  return { ok, depth: at };
}

// Runs of usable cells along row j: [[i0, i1], ...] of at least `min` cells.
function runs(ok, nx, j, min) {
  const out = [];
  let start = -1;
  for (let i = 0; i <= nx; i++) {
    const on = i < nx && ok[j * nx + i];
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      if (i - start >= min) out.push([start, i - 1]);
      start = -1;
    }
  }
  return out;
}

// The bars and segment rows on one side, as lists of 3D points.
function layout(D, s, rand) {
  const { nx, ny, x0, y0 } = D;
  const { ok, depth } = barCells(D, s);
  const scored = [];
  for (let j = 3; j < ny - 3; j++) {
    const rs = runs(ok, nx, j, MIN_RUN);
    const len = rs.reduce((n, [a, b]) => n + b - a + 1, 0);
    if (len >= 40) scored.push({ j, rs, score: len * (0.75 + rand() * 0.5) });
  }
  scored.sort((a, b) => b.score - a.score);
  const rails = [];
  for (const r of scored) {
    if (rails.every((q) => Math.abs(q.j - r.j) >= 7)) rails.push(r);
    if (rails.length === 3) break;
  }
  const lift = s * (RADIUS + LIFT);
  const point = (i, j) => new THREE.Vector3(x0 + i * CELL, y0 + j * CELL, depth(i, j) + lift);
  const usable = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && ok[j * nx + i];
  const bars = [];
  for (const { j, rs } of rails) {
    for (const [a, b] of rs) {
      // The row, with a 45-degree jog up or down on longer runs.
      const path = [];
      let jog = null;
      if (b - a > 70 && rand() < 0.7) {
        const h = (4 + Math.floor(rand() * 5)) * (rand() < 0.5 ? -1 : 1);
        const start = a + 10 + Math.floor(rand() * (b - a - 60));
        const flat = 12 + Math.floor(rand() * 18);
        jog = { start, h, flat };
        for (let i = start; i <= start + 2 * Math.abs(h) + flat; i++) {
          const k = i - start;
          const dj = k < Math.abs(h) ? Math.sign(h) * k : k < Math.abs(h) + flat ? h : h - Math.sign(h) * (k - Math.abs(h) - flat);
          if (!usable(i, j + dj)) { jog = null; break; }
        }
      }
      for (let i = a; i <= b; i += 2) {
        let dj = 0;
        if (jog) {
          const k = i - jog.start;
          const H = Math.abs(jog.h);
          if (k >= 0 && k < H) dj = Math.sign(jog.h) * k;
          else if (k >= H && k < H + jog.flat) dj = jog.h;
          else if (k >= H + jog.flat && k < 2 * H + jog.flat) dj = jog.h - Math.sign(jog.h) * (k - H - jog.flat);
        }
        path.push(point(i, j + dj));
      }
      if (path.length >= 4) bars.push(smooth(path));
    }
  }
  // A row of short lit segments where there's room away from the bars.
  const segments = [];
  const free = scored.filter((r) => rails.every((q) => Math.abs(q.j - r.j) >= 6)).filter((r) => r.rs.some(([a, b]) => b - a >= 40));
  if (free.length) {
    const r = free[Math.floor(rand() * Math.min(3, free.length))];
    const [a, b] = r.rs.find(([p, q]) => q - p >= 40);
    const count = 4 + Math.floor(rand() * 3);
    const i0 = a + Math.floor(rand() * Math.max(1, b - a - count * 8));
    for (let k = 0; k < count; k++) {
      const i = i0 + k * 8;
      if (i + 5 > b) break;
      segments.push([point(i, r.j), point(i + 5, r.j)]);
    }
  }
  return { bars, segments };
}

// Even out the depth along a bar, so it glides over small bumps.
function smooth(path) {
  return path.map((p, k) => {
    const a = path[Math.max(0, k - 1)];
    const b = path[Math.min(path.length - 1, k + 1)];
    return new THREE.Vector3(p.x, p.y, (a.z + p.z + b.z) / 3);
  });
}

// One tube through `points` into `out`, with a flat cap on each end into
// `caps` (or rounded ends when there are no caps, for the glow).
function tube(points, radius, out, caps, radial) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  out.push(new THREE.TubeGeometry(curve, Math.max(4, points.length * 2), radius, radial, false));
  const ends = [[points[0], curve.getTangentAt(0).negate()], [points[points.length - 1], curve.getTangentAt(1)]];
  for (const [p, t] of ends) {
    if (!caps) {
      out.push(new THREE.SphereGeometry(radius, radial, Math.ceil(radial * 0.75)).translate(p.x, p.y, p.z));
      continue;
    }
    // A short cylinder over the end of the tube, its axis along the tube.
    const cap = new THREE.CylinderGeometry(radius * CAP_R, radius * CAP_R, radius * (CAP_IN + CAP_OUT), radial, 1, false);
    cap.translate(0, radius * (CAP_OUT - CAP_IN) / 2, 0);
    cap.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), t));
    caps.push(cap.translate(p.x, p.y, p.z));
  }
}

// Position and normal only, all in one geometry.
function merge(list) {
  let nv = 0;
  let ni = 0;
  for (const g of list) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nv * 3);
  const nor = new Float32Array(nv * 3);
  const idx = new Uint32Array(ni);
  let v = 0;
  let k = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, v * 3);
    nor.set(g.attributes.normal.array, v * 3);
    const n = g.attributes.position.count;
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[k++] = g.index.getX(i) + v;
    else for (let i = 0; i < n; i++) idx[k++] = i + v;
    v += n;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}

// The diffuser: a frosted tube lit from inside, brightest and palest down
// the middle and deeper in colour toward its edges, under a clear glossy
// shell (the clearcoat) that reflects the room.
function diffuser() {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0x000000, emissive: 0xffffff, emissiveIntensity: CORE_GLOW, roughness: 0.5, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.3,
  });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  {
    float facing = clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0);
    totalEmissiveRadiance *= mix(0.55, 1.0, facing);
    float peak = max(max(totalEmissiveRadiance.r, totalEmissiveRadiance.g), totalEmissiveRadiance.b);
    totalEmissiveRadiance = mix(totalEmissiveRadiance, vec3(peak), smoothstep(0.8, 1.0, facing) * 0.15);
  }`);
  };
  return m;
}

// The glow around a tube: light added on screen, strongest at the tube's
// edge and fading out to the halo's, only faint over the tube itself.
function glow() {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color() }, strength: { value: HALO_GLOW }, core: { value: 1 / HALO } },
    vertexShader: `varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = -mv.xyz;
  vN = normalMatrix * normal;
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: `uniform vec3 color;
uniform float strength;
uniform float core;
varying vec3 vN;
varying vec3 vV;
void main() {
  float f = clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0);
  float d = sqrt(1.0 - f * f); // how far out from the middle, in halo radii
  float a = d < core ? 0.08 : pow(1.0 - (d - core) / (1.0 - core), 2.2);
  gl_FragColor = vec4(color * strength * a, 1.0);
  #include <colorspace_fragment>
}`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

// Build the light bars for the model under `group`, in `root`'s space.
// `lights` is the skin's { type, color, accent, seed }. Returns
// { group, mats } (the materials, for the colour cycle), or null.
export function buildLightBars(root, group, lights) {
  const T = triangles(root, group);
  if (T.length < 9) return null;
  const D = depthMaps(T);
  const rand = rng(lights.seed || 1);
  const bars = [];
  const segs = [];
  const caps = [];
  const halo = [];
  const segHalo = [];
  for (const s of [-1, 1]) {
    const L = layout(D, s, rand);
    for (const p of L.bars) {
      tube(p, RADIUS, bars, caps, 16);
      tube(p, RADIUS * HALO, halo, null, 12);
    }
    for (const p of L.segments) {
      tube(p, RADIUS * 1.25, segs, caps, 16);
      tube(p, RADIUS * 1.25 * HALO, segHalo, null, 12);
    }
  }
  if (!bars.length && !segs.length) return null;
  const mats = {
    bar: diffuser(),
    seg: diffuser(),
    // Black anodised aluminium.
    cap: new THREE.MeshStandardMaterial({ color: 0x151619, roughness: 0.32, metalness: 0.8 }),
    barHalo: glow(),
    segHalo: glow(),
  };
  const out = new THREE.Group();
  const add = (list, mat, order) => {
    if (!list.length) return;
    const mesh = new THREE.Mesh(merge(list), mat);
    mesh.renderOrder = order;
    out.add(mesh);
  };
  add(bars, mats.bar, 0);
  add(segs, mats.seg, 0);
  add(caps, mats.cap, 0);
  add(halo, mats.barHalo, 2);
  add(segHalo, mats.segHalo, 2);
  out.userData.lightBars = true;
  const L = { group: out, mats, type: lights.type };
  tintLightBars(L, lights);
  return L;
}

const _c = new THREE.Color();
function colorLight(core, halo, c) {
  core.emissive.copy(c);
  core.color.copy(c).multiplyScalar(0.2);
  halo.uniforms.color.value.copy(c);
}

// Colour a light-bar set without rebuilding it: neon takes the bar and
// segment colours; RGB is coloured each frame by glowLightBars.
export function tintLightBars(L, lights) {
  L.type = lights.type;
  if (lights.type === 'rgb') return;
  colorLight(L.mats.bar, L.mats.barHalo, _c.set(lights.color));
  colorLight(L.mats.seg, L.mats.segHalo, _c.set(lights.accent));
}

// Each frame: `flare` brightens the lights (1 at rest, more with each
// shot); an RGB set takes the colour-cycle `hue` (0..1).
export function glowLightBars(L, flare, hue) {
  const { bar, seg, barHalo, segHalo } = L.mats;
  if (L.type === 'rgb') {
    _c.setHSL(hue, 1, 0.55);
    colorLight(bar, barHalo, _c);
    colorLight(seg, segHalo, _c);
  }
  bar.emissiveIntensity = seg.emissiveIntensity = CORE_GLOW * flare;
  barHalo.uniforms.strength.value = segHalo.uniforms.strength.value = HALO_GLOW * flare;
}

// Dispose of a light-bar set.
export function disposeLightBars(L) {
  if (!L) return;
  L.group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
  for (const m of Object.values(L.mats)) m.dispose();
}
