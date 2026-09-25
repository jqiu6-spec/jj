// Detailed gun models: real meshes converted to .glb with
// tools/convert_model.py (metres, +X muzzle, +Y up, +Z right side). They load
// in the background; the simple built-in model shows until one is ready, and
// stays if loading fails.
//
// Each triangle is sorted into a skin zone by rules over its part name,
// material name and centroid (in the file's own coordinates). The first
// matching rule wins. 'fixed' keeps the model's own material (barrels,
// sights, small metal parts); every other zone can be painted.
import * as THREE from '../vendor/three.module.min.js';
import { GLTFLoader, DecalGeometry } from '../vendor/loaders.module.min.js';
import { tube, projectUVs } from './guns.js';

export const MODEL_INFO = {
  m4a1s: {
    file: 'm4a1s.glb',
    // Line the model up with the built-in gun's frame: rear end and bore height.
    rear: -0.385, bore: 0.022,
    zones: ['handguard', 'stock', 'grip', 'mag', 'suppressor'],
    rules: [
      { zone: 'fixed', box: [0.205, 9, -9, 9] }, // barrel, front sight, flash hider
      { zone: 'fixed', box: [-0.1, -0.07, -0.145, -0.115] }, // trigger
      { zone: 'stock', box: [-9, -0.19, -9, 9] },
      { zone: 'grip', box: [-0.2, -0.118, -0.215, -0.118] },
      { zone: 'mag', box: [-0.06, 0.035, -0.26, -0.137] },
      { zone: 'handguard', box: [0.045, 0.205, -0.11, -0.035] },
      { zone: 'body' },
    ],
    // CS2's M4A1-S carries a removable suppressor; the model has a bare
    // flash hider, so one is added over it.
    suppressor: { back: 0.05, length: 0.2, radius: 0.0195 },
    fade: [-0.3, 0.21],
    slots: [
      { name: 'Handguard', x: 0.125, y: -0.072, size: 0.036 },
      { name: 'Receiver', x: -0.045, y: -0.07, size: 0.03 },
      { name: 'Magazine', x: -0.01, y: -0.19, size: 0.04 },
      { name: 'Stock', x: -0.34, y: -0.072, size: 0.04 },
      { name: 'Magwell', x: 0.0, y: -0.113, size: 0.022 },
    ],
  },
  ak47: {
    file: 'ak47.glb',
    rear: -0.484, bore: 0.012,
    zones: ['handguard', 'stock', 'grip', 'mag'],
    rules: [
      { zone: 'stock', part: /stockWood/ },
      { zone: 'fixed', part: /stock|belt/ },
      { zone: 'grip', part: /grip/ },
      { zone: 'mag', part: /magazine/ },
      { zone: 'handguard', part: /woodUpper|woodLower/ },
      { zone: 'body', part: /m_base|dustcover/ },
      { zone: 'fixed' },
    ],
    fade: [-0.2, 0.2],
    slots: [
      { name: 'Receiver rear', x: -0.14, y: 0.1, size: 0.036 },
      { name: 'Receiver front', x: -0.03, y: 0.1, size: 0.03 },
      { name: 'Magazine', x: 0.025, y: 0.02, size: 0.036 },
      { name: 'Handguard', x: 0.14, y: 0.093, size: 0.04 },
      { name: 'Stock', x: -0.33, y: 0.085, size: 0.052 },
    ],
  },
  xm7: {
    file: 'xm7.glb',
    rear: -0.345, bore: 0.022,
    zones: ['handguard', 'stock', 'grip', 'mag'],
    rules: [
      { zone: 'fixed', mat: /^Material\.00[23]$/ }, // dark metal and hardware
      { zone: 'fixed', box: [0.345, 9, -9, 9] }, // barrel and muzzle device
      { zone: 'stock', box: [-9, -0.285, -9, 9] },
      { zone: 'grip', box: [-0.24, -0.14, -0.14, -0.035] },
      { zone: 'mag', box: [-0.105, 0.0, -0.15, -0.045] },
      { zone: 'handguard', box: [-0.005, 0.345, -0.015, 0.09] },
      { zone: 'body' },
    ],
    fade: [-0.3, 0.34],
    slots: [
      { name: 'Handguard', x: 0.31, y: 0.018, size: 0.03 },
      { name: 'Receiver', x: -0.15, y: 0.035, size: 0.03 },
      { name: 'Magazine', x: -0.055, y: -0.1, size: 0.045 },
      { name: 'Stock', x: -0.39, y: 0.02, size: 0.04 },
      { name: 'Grip', x: -0.19, y: -0.08, size: 0.026 },
    ],
  },
  phantom: {
    file: 'phantom.glb',
    rear: -0.385, bore: 0.025,
    zones: ['handguard', 'stock', 'grip', 'mag', 'suppressor'],
    rules: [
      { zone: 'suppressor', part: /Silencer/, round: 0.02 },
      { zone: 'mag', part: /Magazine/ },
      { zone: 'fixed', mat: /Tritium/ },
      { zone: 'fixed', box: [0.33, 0.4, 0.215, 0.3] }, // front sight
      { zone: 'fixed', box: [-0.05, 0.0, 0.215, 0.3] }, // rear sight
      { zone: 'fixed', box: [-0.035, 0.04, 0.07, 0.125] }, // trigger and guard
      { zone: 'grip', box: [-0.15, -0.035, -0.01, 0.118] },
      { zone: 'stock', box: [-9, -0.1, -9, 9] },
      { zone: 'handguard', box: [0.15, 0.41, -9, 9] },
      { zone: 'body' },
    ],
    fade: [-0.2, 0.4],
    slots: [
      { name: 'Handguard', x: 0.26, y: 0.165, size: 0.034 },
      { name: 'Receiver', x: 0.05, y: 0.15, size: 0.032 },
      { name: 'Suppressor', x: 0.52, y: 0.179, size: 0.026 },
      { name: 'Magazine', x: 0.12, y: 0.05, size: 0.042 },
      { name: 'Stock', x: -0.25, y: 0.16, size: 0.035 },
    ],
  },
  // Karambit from Standoff 2 ("Eye of God"), origin on the ring.
  karambit: {
    file: 'karambit.glb',
    knife: true,
    zones: ['blade', 'handle'],
    rules: [
      // Both sides of the blade are the big crescents in the texture; the
      // handle panels, claws and ring are elsewhere. This follows the
      // bolster's edge exactly, where a cut by height would not.
      // The handle's thin edge strips share that part of the texture, so
      // the crescents only count below the bolster.
      { zone: 'blade', uv: [0.02, 0.8, 0.33, 0.7], box: [-9, 9, -9, -0.085] },
      { zone: 'blade', box: [-9, 9, -9, -0.1] }, // the blade's spine and edge strips
      { zone: 'handle' }, // handle and ring
    ],
    fade: [-0.09, -0.17], // along the blade, bolster to tip
    fadeAxis: 'y',
    slots: [],
  },
  awp: {
    file: 'awp.glb',
    rear: -0.545, bore: 0.03,
    zones: ['scope', 'mag', 'butt'],
    rules: [
      { zone: 'fixed', part: /scope/, box: [-9, 9, -9, 0.285] }, // bipod
      { zone: 'scope', part: /scope/ },
      { zone: 'butt', box: [-9, 0.0, -9, 9] },
      { zone: 'mag', box: [0.31, 0.4, 0.15, 0.215] },
      // One texture covers the whole rifle: the olive chassis is the paint,
      // and anything grey (barrel, action, screws, trigger guard) is metal.
      { zone: 'fixed', neutral: 0.06 },
      { zone: 'body' },
    ],
    fade: [-0.05, 0.62],
    slots: [
      { name: 'Stock', x: 0.12, y: 0.235, size: 0.05 },
      { name: 'Butt', x: 0.06, y: 0.2, size: 0.036 },
      { name: 'Grip', x: 0.2, y: 0.2, size: 0.03 },
      { name: 'Forend', x: 0.52, y: 0.245, size: 0.042 },
      { name: 'Scope', x: 0.3, y: 0.335, size: 0.022 },
    ],
  },
};

function match(rule, part, mat, x, y, chroma, uvAt) {
  if (rule.part && !rule.part.test(part)) return false;
  if (rule.mat && !rule.mat.test(mat)) return false;
  // `uv`: the triangle sits in this box of the texture ([u0, u1, v0, v1],
  // v measured down from the top of the image).
  if (rule.uv) {
    const c = uvAt();
    if (!c) return false;
    const [u0, u1, v0, v1] = rule.uv;
    if (c[0] < u0 || c[0] > u1 || c[1] < v0 || c[1] > v1) return false;
  }
  if (rule.box) {
    const [x0, x1, y0, y1] = rule.box;
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  }
  // `neutral`: the model's own colour there is grey (low chroma).
  if (rule.neutral !== undefined && !(chroma() < rule.neutral)) return false;
  return true;
}

// Reads a material's base colour texture so rules can test its colour.
function albedo(mat) {
  if (mat.userData.albedo !== undefined) return mat.userData.albedo;
  let fn = null;
  const img = mat.map && mat.map.image;
  if (img && img.width) {
    const w = Math.min(512, img.width);
    const h = Math.min(512, img.height);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    // glTF textures are not flipped: v = 0 is the top row.
    fn = (u, v) => {
      const x = Math.min(w - 1, Math.max(0, Math.floor((u - Math.floor(u)) * w)));
      const y = Math.min(h - 1, Math.max(0, Math.floor((v - Math.floor(v)) * h)));
      const o = (y * w + x) * 4;
      return (Math.max(d[o], d[o + 1], d[o + 2]) - Math.min(d[o], d[o + 1], d[o + 2])) / 255;
    };
  }
  mat.userData.albedo = fn;
  return fn;
}

function base64ToBuffer(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

// The single-file build ships the models as base64 in a side script
// (trackline-models.js), because browsers block fetch() from file:// pages.
// Hosts that won't serve .glb files get base64 text copies instead
// (models/NAME.glb.txt) when the page sets window.TRACKLINE_MODEL_TEXT.
async function fetchModel(id) {
  const loader = new GLTFLoader();
  const file = MODEL_INFO[id].file;
  const w = typeof window !== 'undefined' ? window : {};
  const embedded = w.TRACKLINE_MODELS && w.TRACKLINE_MODELS[id];
  if (embedded) return loader.parseAsync(base64ToBuffer(embedded), '');
  if (typeof location !== 'undefined' && location.protocol === 'file:') throw new Error('models need a web server or trackline-models.js');
  if (w.TRACKLINE_MODEL_TEXT) {
    const res = await fetch(`models/${file}.txt`);
    if (!res.ok) throw new Error(`models/${file}.txt: HTTP ${res.status}`);
    return loader.parseAsync(base64ToBuffer((await res.text()).trim()), '');
  }
  return loader.loadAsync(`models/${file}`);
}

const TEX_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'];

// Loads gun `id` and returns the same shape buildGun() does, plus `detailed`.
// `mats` holds the fixed materials for the parts added in code.
export async function loadDetailedGun(id, mats) {
  const info = MODEL_INFO[id];
  const gltf = await fetchModel(id);
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);

  // Gather every mesh as world-space triangle soup.
  const src = [];
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld);
    if (!g.attributes.normal) g.computeVertexNormals();
    src.push({ name: o.name || '', mat: o.material, geo: g });
  });

  // Extent and bore: the bore height is the middle of the front-most 8 mm.
  let minX = Infinity;
  let maxX = -Infinity;
  for (const s of src) {
    const p = s.geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
  }
  let nY = 0;
  let loY = Infinity;
  let hiY = -Infinity;
  for (const s of src) {
    const p = s.geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      if (p.getX(i) < maxX - 0.008) continue;
      const y = p.getY(i);
      nY++;
      loY = Math.min(loY, y);
      hiY = Math.max(hiY, y);
    }
  }
  const boreY = nY ? (loY + hiY) / 2 : 0;
  // Guns line up with the built-in gun; a knife keeps its pivot at the origin.
  const dx = info.knife ? 0 : info.rear - minX;
  const dy = info.knife ? 0 : info.bore - boreY;

  // Original materials read their textures from the second UV set; the first
  // set gets metric projected UVs for skins, like the built-in models.
  for (const m of new Set(src.map((s) => s.mat))) {
    m.side = THREE.DoubleSide;
    m.envMapIntensity = 1;
    for (const k of TEX_KEYS) if (m[k]) m[k].channel = 1;
    m.userData.keepEmissive = !!(m.emissive && m.emissive.getHex() !== 0);
  }

  // Sort triangles into buckets by zone and original material.
  const buckets = new Map();
  for (const s of src) {
    const P = s.geo.attributes.position;
    const N = s.geo.attributes.normal;
    const UV = s.geo.attributes.uv;
    for (let t = 0; t + 2 < P.count; t += 3) {
      const cx = (P.getX(t) + P.getX(t + 1) + P.getX(t + 2)) / 3;
      const cy = (P.getY(t) + P.getY(t + 1) + P.getY(t + 2)) / 3;
      const chroma = () => {
        const f = UV && albedo(s.mat);
        if (!f) return 1;
        return f((UV.getX(t) + UV.getX(t + 1) + UV.getX(t + 2)) / 3, (UV.getY(t) + UV.getY(t + 1) + UV.getY(t + 2)) / 3);
      };
      const uvAt = () => (UV ? [(UV.getX(t) + UV.getX(t + 1) + UV.getX(t + 2)) / 3, (UV.getY(t) + UV.getY(t + 1) + UV.getY(t + 2)) / 3] : null);
      const rule = info.rules.find((r) => match(r, s.name, s.mat.name || '', cx, cy, chroma, uvAt)) || { zone: 'body' };
      const key = `${rule.zone}|${s.mat.uuid}|${rule.round || 0}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { zone: rule.zone, mat: s.mat, round: rule.round, p: [], n: [], uv: [] }));
      for (let k = t; k < t + 3; k++) {
        b.p.push(P.getX(k) + dx, P.getY(k) + dy, P.getZ(k));
        b.n.push(N.getX(k), N.getY(k), N.getZ(k));
        if (UV) b.uv.push(UV.getX(k), UV.getY(k));
        else b.uv.push(0, 0);
      }
    }
    s.geo.dispose();
  }
  for (const s of src) delete s.mat.userData.albedo; // free the pixel copies

  const group = new THREE.Group();
  const zones = {};
  const fixed = [];
  for (const b of buckets.values()) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
    geo.setAttribute('uv1', new THREE.Float32BufferAttribute(b.uv, 2));
    const mesh = new THREE.Mesh(geo, b.mat);
    mesh.userData.orig = b.mat;
    if (b.zone === 'fixed') {
      fixed.push(mesh);
    } else {
      faceUVs(geo, b.round ? { y: info.bore, r: b.round } : null);
      (zones[b.zone] || (zones[b.zone] = [])).push(mesh);
    }
    group.add(mesh);
  }

  const front = maxX + dx;
  const model = {
    group, zones, fixed, detailed: true,
    zoneList: info.zones,
    rear: info.rear,
    front,
    fade: info.fade.map((x) => x + (info.fadeAxis === 'y' ? dy : dx)),
    fadeAxis: info.fadeAxis || 'x',
    muzzle: () => [front, info.bore],
    slots: info.slots.map((s) => ({ ...s, x: s.x + dx, y: s.y + dy })),
  };
  if (info.knife) {
    // Framed lying along X in the Weapon tab: blade tip to ring.
    let minY = Infinity;
    let maxY = -Infinity;
    let tip = [0, 0];
    for (const b of buckets.values()) {
      for (let i = 1; i < b.p.length; i += 3) {
        if (b.p[i] < minY) { minY = b.p[i]; tip = [b.p[i - 1], b.p[i]]; }
        if (b.p[i] > maxY) maxY = b.p[i];
      }
    }
    model.rear = -maxY;
    model.front = -minY;
    model.muzzle = () => tip;
  }

  if (info.suppressor) {
    const { back, length, radius } = info.suppressor;
    const Y = info.bore;
    const x0 = front - back;
    const x1 = x0 + length;
    const sup = new THREE.Group();
    const add = (geo, zone) => {
      const fixedMat = mats[zone];
      if (!fixedMat) projectUVs(geo, { y: Y, r: radius });
      const m = new THREE.Mesh(geo, fixedMat || null);
      if (!fixedMat) (zones[zone] || (zones[zone] = [])).push(m);
      sup.add(m);
    };
    add(tube(radius, x0 + 0.008, x1 - 0.01, Y, radius, 40), 'suppressor');
    add(tube(radius + 0.001, x0, x0 + 0.01, Y, radius + 0.001, 40), 'metal');
    add(tube(radius + 0.001, x1 - 0.012, x1, Y, radius + 0.001, 40), 'metal');
    add(tube(0.0055, x1, x1 + 0.0005, Y), 'dark');
    group.add(sup);
    model.suppressor = sup;
    model.front = x1;
    model.muzzle = (skin) => [skin.suppressor === false ? front : x1, Y];
  }

  // Stickers wrap onto the surface instead of floating as flat cards.
  model.decal = (x, y, size, rot) => decals(group, x, y, size, rot);
  return model;
}

// Box projection by face normal, in metres: a triangle's three corners share
// one projection, so patterns never smear across a corner of the model.
function faceUVs(geo, round) {
  const p = geo.attributes.position;
  const n = geo.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let t = 0; t < p.count; t += 3) {
    a.fromBufferAttribute(p, t);
    b.fromBufferAttribute(p, t + 1).sub(a);
    c.fromBufferAttribute(p, t + 2).sub(a);
    b.cross(c);
    if (b.lengthSq() < 1e-14) b.set(n.getX(t), n.getY(t), n.getZ(t));
    const ax = Math.abs(b.x);
    const ay = Math.abs(b.y);
    const az = Math.abs(b.z);
    for (let k = t; k < t + 3; k++) {
      const x = p.getX(k);
      const y = p.getY(k);
      const z = p.getZ(k);
      let u;
      let v;
      if (round) {
        u = x;
        v = Math.atan2(z, y - round.y) * round.r;
      } else if (az >= ax && az >= ay) { u = x; v = y; } else if (ay >= ax) { u = x; v = z; } else { u = z; v = y; }
      uv[k * 2] = u;
      uv[k * 2 + 1] = v;
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(p.count * 3).fill(1), 3));
}

// Sticker geometry that wraps onto the model's surface around (x, y) on the
// left side, facing -Z, rolled by `rot` radians. Everything is worked out in
// gun space on untransformed copies, wherever the gun is posed on screen.
const PROXY_MAT = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
function proxies(group) {
  if (!group.userData.proxies) {
    const list = [];
    group.traverse((o) => {
      if (!o.isMesh || o.userData.decal) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const p = new THREE.Mesh(o.geometry, PROXY_MAT);
      p.userData.src = o;
      list.push(p);
    });
    group.userData.proxies = list;
  }
  // Skip hidden parts, such as a removed suppressor.
  return group.userData.proxies.filter((p) => {
    for (let o = p.userData.src; o && o !== group; o = o.parent) if (!o.visible) return false;
    return true;
  });
}

const _pos = new THREE.Vector3();
const _dbox = new THREE.Box3();
const _ray = new THREE.Raycaster();
const _o = new THREE.Vector3();
const _d = new THREE.Vector3(0, 0, 1);
function decals(group, x, y, size, rot) {
  const out = [];
  const list = proxies(group);
  _ray.set(_o.set(x, y, -1), _d);
  const hit = _ray.intersectObjects(list, false)[0];
  if (!hit) return out;
  const z = hit.point.z;
  _pos.set(x, y, z);
  const depth = 0.03;
  const orient = new THREE.Euler(0, Math.PI, -rot);
  const sz = new THREE.Vector3(size, size, depth);
  const r = size * 0.75;
  _dbox.min.set(x - r, y - r, z - depth);
  _dbox.max.set(x + r, y + r, z + depth);
  for (const p of list) {
    if (!p.geometry.boundingBox.intersectsBox(_dbox)) continue;
    const g = new DecalGeometry(p, _pos, orient, sz);
    if (g.attributes.position.count) out.push(g);
    else g.dispose();
  }
  return out;
}
