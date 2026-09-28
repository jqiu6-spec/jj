// First-person arms: gloved hands and sleeved forearms, built in code and
// posed on the held weapon. The right hand closes round the pistol grip with
// its index finger on the trigger and its thumb along the far side; the left
// hand holds the handguard from underneath, thumb along the side facing you;
// on the karambit, a fist round the handle with the index finger through the
// ring. The fingers wrap whatever size the grip is: each knuckle is placed
// on a circle round it. The forearms run from the wrists toward elbows off
// screen, so they come in from the bottom corners whatever the weapon does.
//
// Hand space (a right hand; the left is its mirror image): the wrist at the
// origin, the fingers toward +Y, the palm facing +Z, the thumb toward +X.
import * as THREE from '../vendor/three.module.min.js';
import { materialTextures } from './materials.js';
import { loadModelFile } from './models.js';

// A gloved adult hand, metres.
const PALM_LEN = 0.094; // wrist to knuckles
const PALM_W = 0.084; // across the knuckles
const PALM_T = 0.03; // thickness
// Each finger: its knuckle (x across, y along the palm), radius, and bone
// lengths, knuckle to knuckle and on to the middle of the fingertip.
const FINGERS = [
  { x: 0.029, y: 0.091, r: 0.0094, len: [0.044, 0.026, 0.02] }, // index
  { x: 0.0095, y: 0.095, r: 0.0097, len: [0.048, 0.03, 0.022] }, // middle
  { x: -0.0105, y: 0.092, r: 0.0093, len: [0.045, 0.028, 0.021] }, // ring
  { x: -0.0295, y: 0.085, r: 0.0084, len: [0.036, 0.022, 0.018] }, // little
];
const THUMB = { at: new THREE.Vector3(0.027, 0.026, 0.004), r: 0.0108, len: [0.042, 0.032, 0.024], bend: 0.35 };
const SLEEVE_LEN = 0.55;

const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// ------------------------------------------------------------- geometry
// Texture coordinates in metres, projected along each face's main axis,
// so the glove and cloth textures show at their real size.
function projectUV(g) {
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    const [u, v] = ax >= ay && ax >= az ? [p.getZ(i), p.getY(i)] : ay >= az ? [p.getX(i), p.getZ(i)] : [p.getX(i), p.getY(i)];
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

// A capsule along +Y from 0 to `len`: radius r0 at the base, r1 at the tip,
// its cross-section `flat` as deep as it is wide.
function capsule(r0, r1, len, flat = 0.88) {
  const pts = [];
  const n = 6;
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + (i / n) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(1e-5, r0 * Math.cos(a)), r0 * Math.sin(a)));
  }
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(1e-5, r1 * Math.cos(a)), len + r1 * Math.sin(a)));
  }
  return projectUV(new THREE.LatheGeometry(pts, 14).scale(1, 1, flat));
}

// A box with rounded edges and corners, centred.
function roundedBox(w, h, d, r, seg = 10) {
  const g = new THREE.BoxGeometry(1, 1, 1, seg, seg, seg);
  const p = g.attributes.position;
  const nor = g.attributes.normal;
  const v = new THREE.Vector3();
  const q = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i) * w, p.getY(i) * h, p.getZ(i) * d);
    q.set(clamp(v.x, -w / 2 + r, w / 2 - r), clamp(v.y, -h / 2 + r, h / 2 - r), clamp(v.z, -d / 2 + r, d / 2 - r));
    v.sub(q).normalize();
    nor.setXYZ(i, v.x, v.y, v.z);
    p.setXYZ(i, q.x + v.x * r, q.y + v.y * r, q.z + v.z * r);
  }
  return g;
}

// The palm: narrower and thicker at the wrist, with the pads at the base of
// the thumb and the little finger.
function palmGeometry() {
  const g = roundedBox(PALM_W, PALM_LEN + 0.006, PALM_T, 0.0135, 14).translate(0, PALM_LEN / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = clamp(p.getY(i) / PALM_LEN, 0, 1);
    const x = p.getX(i);
    const z = p.getZ(i);
    const across = clamp(x / (PALM_W / 2), -1, 1);
    // The back of the hand domed across, the palm a little cupped.
    const dome = z < 0 ? -0.006 * (1 - across * across) * Math.sin(Math.PI * (0.15 + 0.7 * t)) : -0.002 * Math.sin(Math.PI * t);
    p.setX(i, x * (0.8 + 0.2 * t));
    p.setZ(i, z * (1.1 - 0.15 * t) + dome);
  }
  g.computeVertexNormals();
  return projectUV(g);
}
const pad = (sx, sy, sz, x, y, z, rz) => projectUV(new THREE.SphereGeometry(1, 16, 12).scale(sx, sy, sz).rotateZ(rz).translate(x, y, z));

// The forearm, along +Y from the wrist: the glove's cuff, then the sleeve
// with a rolled edge, widening toward the elbow.
function cuffGeometry() {
  const pts = [[0.028, -0.012], [0.033, 0.0], [0.036, 0.03], [0.037, 0.062], [0.033, 0.07], [0.03, 0.074]];
  return projectUV(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 24).scale(1.18, 1, 0.9));
}
function sleeveGeometry() {
  const pts = [[0.034, 0.058], [0.043, 0.062], [0.047, 0.07], [0.045, 0.078]];
  for (let y = 0.09; y <= SLEEVE_LEN + 1e-6; y += 0.012) pts.push([0.044 + 0.012 * Math.min(1, (y - 0.09) / 0.35), y]);
  const segments = 40;
  const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segments);
  // Folds: the cloth bunches in rings above the cuff and creases along the
  // arm, in bands that wander round it.
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    if (y < 0.085) continue;
    const a = Math.atan2(x, z);
    const near = Math.max(0, 1 - (y - 0.085) / 0.12);
    const k = 1 + 0.07 * near * Math.sin(y * 260 + Math.sin(a * 2) * 1.5) ** 2
      + 0.035 * Math.sin(y * 45 + a * 3 + Math.sin(a * 5) * 0.8) * (0.4 + 0.6 * Math.sin(a * 2 + y * 9) ** 2)
      + 0.015 * Math.sin(a * 7 + y * 30);
    p.setXYZ(i, x * k, y, z * k);
  }
  g.computeVertexNormals();
  // The lathe's first and last columns are the same seam: share normals.
  const n = g.attributes.normal;
  const rows = pts.length;
  for (let j = 0; j < rows; j++) {
    const a = j;
    const b = segments * rows + j;
    const nx = n.getX(a) + n.getX(b);
    const ny = n.getY(a) + n.getY(b);
    const nz = n.getZ(a) + n.getZ(b);
    const l = Math.hypot(nx, ny, nz) || 1;
    n.setXYZ(a, nx / l, ny / l, nz / l);
    n.setXYZ(b, nx / l, ny / l, nz / l);
  }
  return projectUV(g.scale(1.15, 1, 0.92));
}

// ------------------------------------------------------------- materials
function armMaterials() {
  const glove = materialTextures('glove');
  const cloth = materialTextures('ripstop');
  const mat = (params, t) => {
    const m = new THREE.MeshPhysicalMaterial(params);
    if (t) {
      m.map = t.map;
      m.normalMap = t.normalMap;
      m.roughnessMap = t.roughnessMap;
      m.roughness = Math.min(1, params.roughness * 1.5);
    }
    return m;
  };
  return {
    glove: mat({ color: '#2b2d31', roughness: 0.72, metalness: 0, sheen: 0.4, sheenRoughness: 0.6, sheenColor: new THREE.Color('#5a5f66') }, glove),
    guard: mat({ color: '#18191c', roughness: 0.62, metalness: 0 }),
    cuff: mat({ color: '#1b1c1f', roughness: 0.8, metalness: 0 }, glove),
    sleeve: mat({ color: '#3f4637', roughness: 0.9, metalness: 0, sheen: 0.6, sheenRoughness: 0.8, sheenColor: new THREE.Color('#7d8570'), side: THREE.DoubleSide }, cloth),
  };
}

// ------------------------------------------------------------- the hand
function buildHand(mats) {
  const hand = new THREE.Group();
  hand.matrixAutoUpdate = false;
  hand.add(new THREE.Mesh(palmGeometry(), mats.glove));
  hand.add(new THREE.Mesh(pad(0.019, 0.032, 0.012, 0.021, 0.034, 0.009, -0.35), mats.glove));
  hand.add(new THREE.Mesh(pad(0.015, 0.03, 0.01, -0.025, 0.036, 0.007, 0.1), mats.glove));
  // A tactical glove's hard knuckle pads, one over each knuckle on a
  // moulded strip, and a padded back.
  const strip = new THREE.Mesh(projectUV(roundedBox(0.07, 0.015, 0.008, 0.0038)), mats.guard);
  strip.position.set(0, 0.086, -PALM_T / 2 - 0.0005);
  hand.add(strip);
  for (const f of FINGERS) hand.add(new THREE.Mesh(pad(0.0092, 0.0078, 0.0032, f.x, f.y - 0.003, -PALM_T / 2 - 0.0042, 0), mats.guard));
  const fingers = FINGERS.map((f) => {
    const joints = [];
    let parent = hand;
    let r = f.r;
    f.len.forEach((L, k) => {
      const j = new THREE.Group();
      j.position.set(k ? 0 : f.x, k ? f.len[k - 1] : f.y, 0);
      parent.add(j);
      const r1 = r * (k === 2 ? 0.9 : 0.95);
      j.add(new THREE.Mesh(capsule(r, r1, L), mats.glove));
      joints.push(j);
      parent = j;
      r = r1;
    });
    return joints;
  });
  // The thumb: a base that turns freely at the wrist end of the palm, then
  // two joints that bend.
  const thumb = [];
  let parent = hand;
  let r = THUMB.r;
  THUMB.len.forEach((L, k) => {
    const j = new THREE.Group();
    if (k) j.position.set(0, THUMB.len[k - 1], 0);
    else j.position.copy(THUMB.at);
    parent.add(j);
    const r1 = r * (k === 2 ? 0.88 : 0.93);
    j.add(new THREE.Mesh(capsule(r, r1, L, 0.85), mats.glove));
    thumb.push(j);
    parent = j;
    r = r1;
  });
  return { hand, fingers, thumb };
}

function buildForearm(mats) {
  const arm = new THREE.Group();
  arm.matrixAutoUpdate = false;
  arm.add(new THREE.Mesh(cuffGeometry(), mats.cuff));
  // The cuff's hook-and-loop strap.
  const band = [[0.0362, 0.018], [0.0385, 0.0195], [0.0388, 0.04], [0.0364, 0.0415]];
  arm.add(new THREE.Mesh(projectUV(new THREE.LatheGeometry(band.map(([r, y]) => new THREE.Vector2(r, y)), 28).scale(1.18, 1, 0.9)), mats.guard));
  arm.add(new THREE.Mesh(sleeveGeometry(), mats.sleeve));
  return arm;
}

// ------------------------------------------------------------- posing
// A hand's measurements, in hand space, for posing it: the palm's surface
// (z), each finger's knuckle (x, y, z), radius and bone lengths, and the
// thumb's base and bone lengths.
const BUILT = { palm: PALM_T / 2, fingers: FINGERS.map((f) => ({ ...f, z: 0 })), thumb: THUMB };

// Close a finger round a circle in the hand's YZ plane (centre `cy`, `cz`,
// radius `rho`, the finger's own radius included): each bone ends on the
// circle, going round it the way the fingers curl. Writes the bend at each
// joint (radians, curling toward the palm) into `out`.
function wrapFinger(f, cy, cz, rho, maxTurn, out) {
  let py = f.y;
  let pz = f.z;
  let a = 0;
  f.len.forEach((L, k) => {
    const dy = cy - py;
    const dz = cz - pz;
    const d = Math.hypot(dy, dz);
    let ty;
    let tz;
    if (d > 1e-6 && d <= L + rho && d >= Math.abs(L - rho)) {
      // Where the circle of reach meets the grip's circle, going round.
      const m = (L * L - rho * rho + d * d) / (2 * d);
      const h = Math.sqrt(Math.max(0, L * L - m * m));
      const mx = py + (m * dy) / d;
      const mz = pz + (m * dz) / d;
      const c1 = [mx + (h * dz) / d, mz - (h * dy) / d];
      const c2 = [mx - (h * dz) / d, mz + (h * dy) / d];
      const ap = Math.atan2(pz - cz, py - cy);
      const ahead = (c) => ((Math.atan2(c[1] - cz, c[0] - cy) - ap) % TAU + TAU) % TAU;
      [ty, tz] = ahead(c1) < ahead(c2) ? c1 : c2;
    } else {
      // Out of reach: head for a point a little round the circle.
      const ap = Math.atan2(pz - cz, py - cy) + 0.5;
      ty = cy + rho * Math.cos(ap);
      tz = cz + rho * Math.sin(ap);
    }
    let bend = Math.atan2(tz - pz, ty - py) - a;
    bend = ((bend + Math.PI) % TAU + TAU) % TAU - Math.PI;
    bend = clamp(bend, -0.15, k === 0 ? 1.6 : 1.75);
    if (a + bend > maxTurn) bend = Math.max(0, maxTurn - a);
    out[k] = bend;
    a += bend;
    py += L * Math.cos(a);
    pz += L * Math.sin(a);
  });
  return out;
}

const _d = new THREE.Vector3();
const _w = new THREE.Vector3();
const _j1 = new THREE.Vector3();
const _e = new THREE.Vector3();
const _s1 = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();

// Aim a thumb (`T`: base `at`, bone lengths `len`, last joint's bend `bend`)
// at `tip` (hand space), bending toward `inside`. Returns its frame: the
// bending axis `n`, the first bone's direction `d0`, the way it bends `z`,
// and the two joints' bends.
const _thumb = { n: new THREE.Vector3(), d0: new THREE.Vector3(), z: new THREE.Vector3(), bend1: 0, bend2: 0 };
function aimThumb(T, tip, inside) {
  const [L0, L1, L2] = T.len;
  const b2 = T.bend;
  const L12 = Math.sqrt(L1 * L1 + L2 * L2 + 2 * L1 * L2 * Math.cos(b2));
  const off = Math.atan2(L2 * Math.sin(b2), L1 + L2 * Math.cos(b2));
  const { n, d0, z } = _thumb;
  _d.copy(tip).sub(T.at);
  const dist = clamp(_d.length(), Math.abs(L0 - L12) + 1e-4, L0 + L12 - 1e-4);
  _d.normalize();
  _w.copy(inside).addScaledVector(_d, -inside.dot(_d)).normalize();
  n.crossVectors(_d, _w).normalize();
  const a0 = Math.acos(clamp((L0 * L0 + dist * dist - L12 * L12) / (2 * L0 * dist), -1, 1));
  d0.copy(_d).multiplyScalar(Math.cos(a0)).addScaledVector(_w, -Math.sin(a0));
  _j1.copy(T.at).addScaledVector(d0, L0);
  _e.copy(_d).multiplyScalar(dist).add(T.at).sub(_j1).normalize();
  _z.crossVectors(n, _e);
  _s1.copy(_e).multiplyScalar(Math.cos(off)).addScaledVector(_z, -Math.sin(off));
  z.crossVectors(n, d0);
  _thumb.bend1 = Math.atan2(z.dot(_s1), d0.dot(_s1));
  _thumb.bend2 = b2;
  return _thumb;
}

// Where each hand goes on a weapon, in its own space (see gripsFor): the
// grip is a cylinder with centre `c`, axis `axis` (toward the index finger)
// and radius `r`; the palm (its surface at `palm` in hand space) sits on
// the `out` side of it. `y` is how far along the palm it crosses.
function handMatrix(g, palm, out) {
  const X = g.axis;
  const Z = _z.copy(g.out).negate();
  const Y = _e.crossVectors(Z, X);
  out.makeBasis(X, Y, Z);
  if (g.mirror) out.multiply(_m.makeScale(-1, 1, 1));
  _d.copy(g.c).addScaledVector(g.out, palm + g.r).addScaledVector(Y, -g.y).addScaledVector(X, -(g.x || 0));
  out.setPosition(_d);
  return out;
}

const _bends = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
const _tip = new THREE.Vector3();
const _in = new THREE.Vector3();

// Curl hand `H` for grip `g`: work out every finger's bends and the thumb's
// aim from the hand's measurements, then let the hand turn its joints.
// `open` (0..1) loosens all but the index finger (the karambit spinning
// round it).
function curl(H, g, open = 0) {
  const S = H.shape;
  const cy = g.y;
  const cz = S.palm + g.r;
  S.fingers.forEach((f, i) => {
    const trigger = i === 0 && g.kind === 'pistol';
    const rho = g.r + f.r * 0.9 + (trigger ? 0.016 : 0);
    wrapFinger(f, cy, cz, rho, trigger ? 1.9 : g.kind === 'fore' ? 3.2 : 4.2, _bends[i]);
    const loose = i === 0 ? 0 : open;
    for (let k = 0; k < 3; k++) _bends[i][k] += ([0.55, 0.7, 0.4][k] - _bends[i][k]) * loose; // loosened, not flat open
  });
  if (g.kind === 'pistol') {
    // Over the top of the grip and along its far side, pointing forward.
    _tip.set(0.047, cy + 0.01, cz + g.r + 0.008);
  } else if (g.kind === 'fore') {
    // Along the side of the handguard facing you.
    _tip.set(0.082, 0.042, cz * 0.75);
  } else {
    // Folded over the fingers.
    _tip.set(0.008 - open * 0.02, cy + 0.012, cz + g.r + 0.012 - open * 0.02);
  }
  // It bends round the grip, whose line runs along x.
  _in.set(0, cy - (S.thumb.at.y + _tip.y) / 2, cz - (S.thumb.at.z + _tip.z) / 2);
  H.apply(_bends, aimThumb(S.thumb, _tip, _in));
}

// The hand built in code: its joints are groups; bends turn them about x.
function builtHand(mats) {
  const H = buildHand(mats);
  H.shape = BUILT;
  H.apply = (bends, T) => {
    H.fingers.forEach((J, i) => J.forEach((j, k) => j.rotation.set(bends[i][k], 0, k ? 0 : (1.5 - i) * -0.03)));
    H.thumb[0].quaternion.setFromRotationMatrix(_m.makeBasis(T.n, T.d0, T.z));
    H.thumb[1].rotation.set(T.bend1, 0, 0);
    H.thumb[2].rotation.set(T.bend2, 0, 0);
  };
  return H;
}

// ------------------------------------------------------------- the model
// The supplied hand model (models/hands.glb, a rigged hand): its bones by
// finger, index to little, knuckle to tip, and the thumb's.
const RIG = {
  wrist: 'Bone',
  fingers: [['Bone017', 'Bone018', 'Bone019'], ['Bone014', 'Bone015', 'Bone016'], ['Bone011', 'Bone012', 'Bone013'], ['Bone008', 'Bone009', 'Bone010']],
  thumb: ['Bone005', 'Bone006', 'Bone007'],
};

const _hm = new THREE.Matrix4();
const _pm = new THREE.Matrix4();
const _am = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _sc = new THREE.Vector3();

// Build a hand from the loaded model (`gltf`): the model fitted into hand
// space (its wrist at the origin, fingers along +Y, palm toward +Z, thumb
// toward +X; a left-hand model is mirrored into it), scaled so the palm is
// a real hand's length, in the glove material; posed by turning its bones.
function modelHand(gltf, mats) {
  const scene = gltf.scene;
  const bones = {};
  let mesh = null;
  scene.traverse((o) => {
    if (o.isBone) bones[o.name] = o;
    if (o.isSkinnedMesh && !mesh) mesh = o;
  });
  if (!mesh || !bones[RIG.wrist]) throw new Error('hand model: no rig');
  scene.updateMatrixWorld(true);
  const at = (name) => bones[name].getWorldPosition(new THREE.Vector3());
  const W = at(RIG.wrist);
  const Y = at(RIG.fingers[1][0]).sub(W);
  const s = PALM_LEN / Y.length();
  Y.normalize();
  const X = at(RIG.fingers[0][0]).sub(at(RIG.fingers[3][0]));
  X.addScaledVector(Y, -X.dot(Y)).normalize();
  const Z = new THREE.Vector3().crossVectors(X, Y);
  // The palm is the side the thumb folds toward.
  if (at(RIG.thumb[2]).sub(W).dot(Z) < 0) Z.negate();
  const N = new THREE.Matrix4().set(
    X.x, X.y, X.z, 0,
    Y.x, Y.y, Y.z, 0,
    Z.x, Z.y, Z.z, 0,
    0, 0, 0, 1,
  ).premultiply(new THREE.Matrix4().makeScale(s, s, s)).multiply(new THREE.Matrix4().makeTranslation(-W.x, -W.y, -W.z));
  const fit = new THREE.Group();
  fit.matrixAutoUpdate = false;
  fit.matrix.copy(N);
  fit.add(scene);
  const hand = new THREE.Group();
  hand.matrixAutoUpdate = false;
  hand.add(fit);
  // Hand space of anything under the fitted model.
  const handOf = (o, out) => {
    const chain = [];
    for (let x = o; x && x !== hand; x = x.parent) chain.push(x);
    out.identity();
    for (let i = chain.length - 1; i >= 0; i--) {
      if (chain[i].matrixAutoUpdate) chain[i].updateMatrix();
      out.multiply(chain[i].matrix);
    }
    return out;
  };
  const head = (name) => new THREE.Vector3().setFromMatrixPosition(handOf(bones[name], _hm));
  // The glove: the model's own shape, textured at its real size.
  const g = mesh.geometry;
  const bind = new THREE.Matrix4().multiplyMatrices(N, mesh.matrixWorld);
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  const nm = new THREE.Matrix3().getNormalMatrix(bind);
  let palm = 0;
  for (let i = 0; i < pos.count; i++) {
    _p.fromBufferAttribute(pos, i).applyMatrix4(bind);
    _v.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
    const ax = Math.abs(_v.x);
    const ay = Math.abs(_v.y);
    const az = Math.abs(_v.z);
    const [u, w] = ax >= ay && ax >= az ? [_p.z, _p.y] : ay >= az ? [_p.x, _p.z] : [_p.x, _p.y];
    uv[i * 2] = u;
    uv[i * 2 + 1] = w;
    if (_p.y > 0.035 && _p.y < 0.075 && Math.abs(_p.x) < 0.02) palm = Math.max(palm, _p.z);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  mesh.material = mats.glove;
  mesh.frustumCulled = false;
  // Its measurements, for posing.
  const fingers = RIG.fingers.map(([a, b, c], i) => {
    const h0 = head(a);
    const h1 = head(b);
    const h2 = head(c);
    const l1 = h1.distanceTo(h0);
    const l2 = h2.distanceTo(h1);
    return { x: h0.x, y: h0.y, z: h0.z, r: i === 3 ? 0.0078 : 0.0088, len: [l1, l2, l2 * 0.82], dir: h1.clone().sub(h0).normalize() };
  });
  const t0 = head(RIG.thumb[0]);
  const t1 = head(RIG.thumb[1]);
  const t2 = head(RIG.thumb[2]);
  const shape = {
    palm: palm || PALM_T / 2,
    fingers,
    thumb: { at: t0, r: 0.0105, len: [t1.distanceTo(t0), t2.distanceTo(t1), t2.distanceTo(t1) * 0.85], bend: THUMB.bend },
  };
  // The thumb's frame at rest: along its first bone, bending toward the
  // palm and across it.
  const td = t1.clone().sub(t0).normalize();
  const tz = new THREE.Vector3(-0.6, 0, 0.8).addScaledVector(td, -new THREE.Vector3(-0.6, 0, 0.8).dot(td)).normalize();
  const thumbRest = new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(td, tz), td, tz);
  const rest = new Map();
  for (const b of Object.values(bones)) rest.set(b, b.quaternion.clone());
  // Turn bone `b` by rotation `R` (hand space) about its own joint.
  const turn = (b, R) => {
    handOf(b, _hm);
    _p.setFromMatrixPosition(_hm);
    _am.makeTranslation(_p.x, _p.y, _p.z).multiply(R).multiply(_pm.makeTranslation(-_p.x, -_p.y, -_p.z)).multiply(_hm);
    handOf(b.parent, _pm).invert();
    _pm.multiply(_am).decompose(_v, _q, _sc);
    b.quaternion.copy(_q);
  };
  const R = new THREE.Matrix4();
  const apply = (bends, T) => {
    for (const [b, q] of rest) b.quaternion.copy(q);
    fingers.forEach((f, i) => {
      // Each finger curls about the line across it in the palm's plane.
      const axis = _e.crossVectors(f.dir, _z.set(0, 0, 1)).normalize();
      RIG.fingers[i].forEach((name, k) => turn(bones[name], R.makeRotationAxis(axis, bends[i][k])));
    });
    turn(bones[RIG.thumb[0]], R.makeBasis(T.n, T.d0, T.z).multiply(_am.copy(thumbRest).transpose()));
    turn(bones[RIG.thumb[1]], R.makeRotationAxis(T.n, T.bend1));
    turn(bones[RIG.thumb[2]], R.makeRotationAxis(T.n, T.bend2));
  };
  return { hand, shape, apply, model: true };
}

const _wrist = new THREE.Vector3();
const _hx = new THREE.Vector3();
const _fy = new THREE.Vector3();
const _fx = new THREE.Vector3();
const _fz = new THREE.Vector3();

export class Arms {
  constructor() {
    this.group = new THREE.Group();
    this.mats = armMaterials();
    this.sides = ['right', 'left'].map(() => {
      const H = builtHand(this.mats);
      const arm = buildForearm(this.mats);
      this.group.add(H.hand, arm);
      return { H, arm, sig: '' };
    });
    // The supplied hand model replaces the built hands once it loads (one
    // copy each side; each is posed on its own).
    Promise.all([loadModelFile('hands', 'hands.glb'), loadModelFile('hands', 'hands.glb')]).then((models) => {
      this.sides.forEach((S, i) => {
        const H = modelHand(models[i], this.mats);
        H.hand.visible = S.H.hand.visible;
        H.hand.matrix.copy(S.H.hand.matrix);
        this.group.remove(S.H.hand);
        this.group.add(H.hand);
        S.H = H;
        S.sig = '';
      });
      this.model = true;
    }).catch((e) => console.warn('Trackline: using the built hands', e));
  }

  // Glove and sleeve colours.
  setColors(glove, sleeve) {
    this.mats.glove.color.set(glove);
    this.mats.sleeve.color.set(sleeve);
    this.mats.sleeve.sheenColor.set(sleeve).lerp(new THREE.Color('#ffffff'), 0.3);
  }

  // Pose the arms: `base` takes the weapon's space into the arms' parent's
  // space; `grips` (see gripsFor) says where each hand holds; `elbows` are
  // where the forearms head, in the parent's space.
  update(base, grips, elbows, open = 0) {
    this.sides.forEach((S, i) => {
      const g = grips[i];
      S.H.hand.visible = S.arm.visible = !!g;
      if (!g) return;
      const sig = `${g.kind}|${g.r}|${g.y}|${Math.round(open * 20)}`;
      if (sig !== S.sig) {
        S.sig = sig;
        curl(S.H, g, open);
      }
      S.H.hand.matrix.multiplyMatrices(base, handMatrix(g, S.H.shape.palm, _hm));
      S.H.hand.matrixWorldNeedsUpdate = true;
      // The forearm: from the wrist toward its elbow, turned with the hand.
      _wrist.setFromMatrixPosition(S.H.hand.matrix);
      if (elbows) _fy.copy(elbows[i]).sub(_wrist).normalize();
      else _fy.setFromMatrixColumn(S.H.hand.matrix, 1).normalize().negate(); // straight back from the hand
      _hx.setFromMatrixColumn(S.H.hand.matrix, 0).normalize();
      _fx.copy(_hx).addScaledVector(_fy, -_hx.dot(_fy)).normalize();
      _fz.crossVectors(_fx, _fy);
      S.arm.matrix.makeBasis(_fx, _fy, _fz).setPosition(_wrist);
      S.arm.matrixWorldNeedsUpdate = true;
    });
  }
}

// ------------------------------------------------------------- grips
// Where the hands hold a weapon, worked out from its parts (in the
// weapon's own space: +X toward the muzzle, +Y up, +Z to its right): the
// pistol grip's line and thickness from the shape of the 'grip' part, the
// handguard's underside from a slice through the 'handguard' part, the
// karambit's handle from its 'handle' part. [right, left], null for none.
export function gripsFor(gv) {
  const m = gv.model;
  gv.root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(gv.root.matrixWorld).invert();
  const points = (zone) => {
    const out = [];
    const v = new THREE.Vector3();
    const M = new THREE.Matrix4();
    for (const mesh of (m.zones && m.zones[zone]) || []) {
      M.multiplyMatrices(inv, mesh.matrixWorld);
      const p = mesh.geometry.attributes.position;
      const step = Math.max(1, Math.floor(p.count / 4000));
      for (let i = 0; i < p.count; i += step) out.push(v.fromBufferAttribute(p, i).applyMatrix4(M).clone());
    }
    return out;
  };
  if (gv.info.melee) return [knifeGrip(points('handle')), null];
  return [pistolGrip(points('grip'), m), foreGrip(points('handguard'), m)];
}

function pistolGrip(P, m) {
  let c;
  let axis;
  let r;
  if (P.length > 20) {
    // The grip's line: its longest direction in the side view.
    const mean = P.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(P.length);
    let xx = 0; let xy = 0; let yy = 0;
    for (const p of P) {
      const dx = p.x - mean.x;
      const dy = p.y - mean.y;
      xx += dx * dx; xy += dx * dy; yy += dy * dy;
    }
    const th = 0.5 * Math.atan2(2 * xy, xx - yy);
    axis = new THREE.Vector3(Math.cos(th), Math.sin(th), 0);
    if (axis.y < 0) axis.negate();
    // A pistol grip leans back: its top is further forward than its foot.
    if (axis.y < 0.6) axis.set(0.4, 0.92, 0).normalize();
    const fwd = new THREE.Vector3(axis.y, -axis.x, 0); // across the grip, toward the muzzle
    let t0 = Infinity; let t1 = -Infinity;
    for (const p of P) {
      const t = _d.copy(p).sub(mean).dot(axis);
      t0 = Math.min(t0, t); t1 = Math.max(t1, t);
    }
    // Its thickness front to back, through the middle of its length.
    let s0 = Infinity; let s1 = -Infinity;
    for (const p of P) {
      _d.copy(p).sub(mean);
      const t = _d.dot(axis);
      if (t < t0 + (t1 - t0) * 0.3 || t > t0 + (t1 - t0) * 0.75) continue;
      const s = _d.dot(fwd);
      s0 = Math.min(s0, s); s1 = Math.max(s1, s);
    }
    if (!Number.isFinite(s0)) { s0 = -0.015; s1 = 0.015; }
    r = clamp((s1 - s0) / 2, 0.011, 0.022);
    // The index finger just under the top of the grip.
    c = mean.clone().addScaledVector(fwd, (s0 + s1) / 2).addScaledVector(axis, t1 - 0.04);
    c.z = 0;
  } else {
    // No grip part: a third of the way along, under the bore.
    const L = m.front - m.rear;
    c = new THREE.Vector3(m.rear + L * 0.3, -0.07, 0);
    axis = new THREE.Vector3(0.4, 0.92, 0).normalize();
    r = 0.016;
  }
  // The palm on the gun's right side, where it meets the grip a little
  // toward the front (that's near the knuckles; the heel of the hand and
  // the wrist are behind the grip).
  const fwd = new THREE.Vector3(axis.y, -axis.x, 0);
  const out = new THREE.Vector3(0, 0, 1).multiplyScalar(Math.cos(0.25)).addScaledVector(fwd, Math.sin(0.25)).normalize();
  return { kind: 'pistol', c, axis, out, r, y: 0.066, x: 0, mirror: false };
}

function foreGrip(P, m) {
  let c;
  let r;
  if (P.length > 20) {
    let x0 = Infinity; let x1 = -Infinity;
    for (const p of P) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); }
    const hx = x0 + clamp((x1 - x0) * 0.45, 0.07, 0.12);
    let y0 = Infinity; let z0 = Infinity; let z1 = -Infinity;
    for (const p of P) {
      if (Math.abs(p.x - hx) > 0.015) continue;
      y0 = Math.min(y0, p.y); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
    }
    if (!Number.isFinite(y0)) { y0 = -0.02; z0 = -0.025; z1 = 0.025; }
    r = clamp((z1 - z0) / 2, 0.014, 0.034);
    c = new THREE.Vector3(hx, y0 + r, (z0 + z1) / 2);
  } else {
    const L = m.front - m.rear;
    r = 0.025;
    c = new THREE.Vector3(m.rear + L * 0.62, -0.01, 0);
  }
  // The palm underneath, meeting it a little to the right (near the
  // knuckles; the heel of the hand is under its near side); the thumb
  // forward.
  const out = new THREE.Vector3(0, -Math.cos(0.35), Math.sin(0.35));
  return { kind: 'fore', c, axis: new THREE.Vector3(-1, 0, 0), out, r, y: 0.07, x: -0.004, mirror: true };
}

// The karambit: the ring at the origin, the handle running down from it,
// its +Z flat toward you at rest. The index finger goes through the ring;
// the palm is on your side of the handle with the fingers over the edge,
// so you see the back of the fist, the wrist under it.
function knifeGrip(P) {
  const mid = new THREE.Vector3(-0.012, -0.05, 0);
  const band = P.filter((p) => p.y < -0.025 && p.y > -0.075);
  if (band.length) mid.copy(band.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(band.length));
  const axis = new THREE.Vector3().sub(mid).normalize(); // up the handle to the ring
  const r = 0.011;
  const index = FINGERS[0].x;
  const c = new THREE.Vector3().addScaledVector(axis, -index);
  c.z = 0;
  const out = new THREE.Vector3(0, 0, 1).addScaledVector(axis, -axis.z).normalize();
  return { kind: 'knife', c, axis, out, r, y: 0.07, x: 0, mirror: false };
}
