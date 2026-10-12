import * as THREE from 'three';

/*
 * SWIVEL: parametric study model of the three-tier rotating pencil sharpener.
 *
 * Units are millimetres. Y is up, each tier's long axis runs along X and the
 * window side faces +Z (front). The one-piece steel shaft runs through the
 * centre of every tier's right-hand rounded end, so all tiers pivot about the
 * same vertical line x = DIM.a, z = 0. The bottom tier is fixed; the middle
 * and top tiers each turn on their own bushing.
 *
 * Angles are in degrees. A positive angle swings a tier's free end (the end
 * with the pencil entry) toward the front.
 */
export const DIM = (() => {
  const L = 120;              // tier length
  const W = 54;               // tier width
  const R = W / 2;            // end radius
  const a = L / 2 - R;        // tier centre to shaft (centre of the rounded end)
  const lipTop = 3.0;         // top of the ivory base lip
  const bandTop = 18.6;       // top of the nickel band
  const H = 26.3;             // tier height, top of the crowned lid
  const inset = 0.7;          // band sits this far inside the ivory shell
  const gap = 1.0;            // thrust-washer gap between tiers
  const foot = 1.4;           // rubber foot under the fixed base
  const holeY = (lipTop + bandTop) / 2;
  const holeX = -(L / 2 - inset);   // pencil entry on the free end
  const reach = a - holeX;          // shaft to pencil entry
  return { L, W, R, a, lipTop, bandTop, H, inset, gap, foot, pitch: H + gap, holeY, holeX, reach };
})();

export const TIER_NAMES = ['Bottom (fixed)', 'Middle', 'Top'];

export const tierBaseY = (i) => DIM.foot + i * DIM.pitch;
export const STACK_TOP = tierBaseY(2) + DIM.H;

const rad = THREE.MathUtils.degToRad;

/* ---------- procedural textures ---------- */

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, { srgb = true, repeat = false } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// Ivory fibreglass: soft mottling plus faint short fibres, tileable.
function ivoryTexture() {
  const s = 1024;
  const [c, g] = canvas(s, s);
  const r = rng(11);
  g.fillStyle = '#ede5d7';
  g.fillRect(0, 0, s, s);
  const wrapped = (x, y, pad, draw) => {
    for (const dx of [-s, 0, s]) for (const dy of [-s, 0, s]) {
      if (x + dx > -pad && x + dx < s + pad && y + dy > -pad && y + dy < s + pad) draw(x + dx, y + dy);
    }
  };
  for (let i = 0; i < 700; i++) {
    const x = r() * s, y = r() * s, rr = 30 + r() * 140;
    const light = r() < 0.5;
    wrapped(x, y, rr, (px, py) => {
      const gr = g.createRadialGradient(px, py, 0, px, py, rr);
      gr.addColorStop(0, light ? 'rgba(255,253,248,0.025)' : 'rgba(196,184,166,0.025)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(px - rr, py - rr, rr * 2, rr * 2);
    });
  }
  for (let i = 0; i < 3200; i++) {
    const x = r() * s, y = r() * s, len = 6 + r() * 26, ang = r() * Math.PI;
    const light = r() < 0.55;
    g.strokeStyle = light ? 'rgba(255,255,252,0.07)' : 'rgba(150,138,120,0.05)';
    g.lineWidth = 0.6 + r() * 0.9;
    wrapped(x, y, len, (px, py) => {
      g.beginPath();
      g.moveTo(px, py);
      g.quadraticCurveTo(px + Math.cos(ang + 0.4) * len * 0.5, py + Math.sin(ang + 0.4) * len * 0.5,
        px + Math.cos(ang) * len, py + Math.sin(ang) * len);
      g.stroke();
    });
  }
  return tex(c, { repeat: true });
}

// Satin brushing for the nickel band; used as a roughness map (lines run along the band).
function brushedTexture() {
  const [c, g] = canvas(512, 512);
  const r = rng(5);
  g.fillStyle = 'rgb(205,205,205)';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 1600; i++) {
    const v = 150 + Math.floor(r() * 105);
    g.fillStyle = `rgba(${v},${v},${v},${0.25 + r() * 0.5})`;
    g.fillRect(0, r() * 512, 512, 0.5 + r() * 1.6);
  }
  return tex(c, { srgb: false, repeat: true });
}

// Shavings seen through the smoked window: ruffled wood fans with orange lacquer edges.
function shavingsTexture() {
  const [c, g] = canvas(640, 182);
  const r = rng(23);
  const bg = g.createLinearGradient(0, 0, 0, c.height);
  bg.addColorStop(0, '#24170f');
  bg.addColorStop(1, '#0f0906');
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 30; i++) {
    const x = r() * c.width;
    const y = c.height * (0.45 + r() * 0.75);
    const rr = 34 + r() * 46;
    const spread = 0.9 + r() * 1.3;
    const a0 = -Math.PI / 2 - spread / 2 + (r() - 0.5) * 1.4;
    const n = 48;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k <= n; k++) {
      const t = a0 + (spread * k) / n;
      const wob = rr * (1 + 0.1 * Math.sin(k * 1.7 + i * 3));
      g.lineTo(x + wob * Math.cos(t), y + wob * Math.sin(t));
    }
    g.closePath();
    const gr = g.createRadialGradient(x, y, 0, x, y, rr * 1.1);
    gr.addColorStop(0, '#f2c89d');
    gr.addColorStop(0.62, '#e6a46c');
    gr.addColorStop(0.82, '#de6f34');
    gr.addColorStop(1, '#a8421b');
    g.globalAlpha = 0.55 + r() * 0.4;
    g.fillStyle = gr;
    g.fill();
    g.globalAlpha = 0.3;
    g.strokeStyle = '#6b2c12';
    g.lineWidth = 1;
    for (let k = 0; k <= n; k += 4) {
      const t = a0 + (spread * k) / n;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + rr * Math.cos(t), y + rr * Math.sin(t));
      g.stroke();
    }
    g.globalAlpha = 1;
  }
  // smoked-glass falloff toward the frame
  const v = g.createLinearGradient(0, 0, 0, c.height);
  v.addColorStop(0, 'rgba(10,6,4,0.55)');
  v.addColorStop(0.35, 'rgba(10,6,4,0.1)');
  v.addColorStop(1, 'rgba(10,6,4,0.35)');
  g.fillStyle = v;
  g.fillRect(0, 0, c.width, c.height);
  return tex(c);
}

function holeTexture() {
  const [c, g] = canvas(128, 128);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, '#040303');
  gr.addColorStop(0.7, '#0b0908');
  gr.addColorStop(0.9, '#272220');
  gr.addColorStop(1, '#3b3530');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  return tex(c);
}

function woodTexture() {
  const [c, g] = canvas(256, 256);
  const r = rng(3);
  g.fillStyle = '#d7a372';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 90; i++) {
    const x = r() * 256;
    g.fillStyle = r() < 0.5 ? 'rgba(160,100,55,0.18)' : 'rgba(240,200,150,0.18)';
    g.fillRect(x, 0, 0.8 + r() * 2.5, 256);
  }
  return tex(c, { repeat: true });
}

// Soft contact shadow under the fixed base, drawn as a blurred stadium.
function contactTexture(pxPerMm, padMm) {
  const w = Math.round((DIM.L + padMm * 2) * pxPerMm);
  const h = Math.round((DIM.W + padMm * 2) * pxPerMm);
  const [c, g] = canvas(w, h);
  g.filter = `blur(${3.2 * pxPerMm}px)`;
  g.fillStyle = '#000';
  const x0 = padMm * pxPerMm, y0 = padMm * pxPerMm;
  const rr = (DIM.R - 1.5) * pxPerMm;
  g.beginPath();
  g.roundRect(x0 + 1.5 * pxPerMm, y0 + 1.5 * pxPerMm, (DIM.L - 3) * pxPerMm, (DIM.W - 3) * pxPerMm, rr);
  g.fill();
  return tex(c, { srgb: false });
}

/* ---------- materials ---------- */

export function createMaterials() {
  const ivoryMap = ivoryTexture();
  const brushed = brushedTexture();
  return {
    ivory: new THREE.MeshPhysicalMaterial({
      color: 0xffffff, map: ivoryMap, roughness: 0.42,
      clearcoat: 0.45, clearcoatRoughness: 0.22, envMapIntensity: 0.85,
    }),
    steel: new THREE.MeshPhysicalMaterial({
      color: 0xdcd9d3, metalness: 1, roughness: 0.22, roughnessMap: brushed, envMapIntensity: 1.0,
    }),
    brightSteel: new THREE.MeshPhysicalMaterial({
      color: 0xe2ded7, metalness: 1, roughness: 0.16, envMapIntensity: 1.0,
    }),
    // lathe UVs run v along the profile, so the brushing becomes concentric rings
    capSteel: new THREE.MeshPhysicalMaterial({
      color: 0xd2cec7, metalness: 1, roughness: 0.4, roughnessMap: brushed, envMapIntensity: 1.0,
    }),
    darkSteel: new THREE.MeshPhysicalMaterial({
      color: 0x7a746c, metalness: 1, roughness: 0.35,
    }),
    frame: new THREE.MeshPhysicalMaterial({
      color: 0x15120f, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06,
    }),
    glass: (() => {
      const map = shavingsTexture();
      return new THREE.MeshPhysicalMaterial({
        color: 0xffffff, map, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.22,
        roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.02,
      });
    })(),
    hole: new THREE.MeshBasicMaterial({ map: holeTexture() }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 0.85 }),
    seam: new THREE.MeshBasicMaterial({ color: 0x2a2622 }),
    wood: new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.62 }),
    graphite: new THREE.MeshStandardMaterial({ color: 0x2b2b2d, roughness: 0.4, metalness: 0.3 }),
    contact: new THREE.MeshBasicMaterial({
      map: contactTexture(4, 14), color: 0x000000, transparent: true, opacity: 0.38, depthWrite: false,
      alphaMap: null,
    }),
  };
}

/* ---------- stadium sweep geometry ---------- */

// Samples around a stadium whose straight core runs from x = -a to x = +a.
// Each sample stores the core point and the outward normal; a ring of radius r
// is core + r * normal, so one list serves every offset of the profile.
function stadiumOutline(a, nArc = 44, nStraight = 10) {
  const pts = [];
  const push = (cx, nx, nz) => pts.push({ cx, nx, nz, s: 0 });
  for (let k = 0; k <= nArc; k++) {
    const p = -Math.PI / 2 + (Math.PI * k) / nArc;
    push(a, Math.cos(p), Math.sin(p));
  }
  for (let k = 1; k < nStraight; k++) push(a - (2 * a * k) / nStraight, 0, 1);
  for (let k = 0; k <= nArc; k++) {
    const p = Math.PI / 2 + (Math.PI * k) / nArc;
    push(-a, Math.cos(p), Math.sin(p));
  }
  for (let k = 1; k <= nStraight; k++) push(-a + (2 * a * k) / nStraight, 0, -1);
  // arc length at the nominal radius, used for the band's brushing direction
  for (let k = 1; k < pts.length; k++) {
    const p = pts[k - 1], q = pts[k];
    const dx = q.cx + DIM.R * q.nx - (p.cx + DIM.R * p.nx);
    const dz = DIM.R * (q.nz - p.nz);
    q.s = p.s + Math.hypot(dx, dz);
  }
  return pts;
}

// Sweeps a profile run of [d, y] points (d = offset from the stadium of radius R)
// around the outline. Runs must be traversed counter-clockwise in the (d, y) plane
// (bottom centre, outward, up, inward) so faces point out of the solid.
function sweep(outline, run, uvMode) {
  const nO = outline.length, nP = run.length;
  const pos = [], nor = [], uv = [], idx = [];
  const pn = run.map((_, j) => {
    const p0 = run[Math.max(0, j - 1)], p1 = run[Math.min(nP - 1, j + 1)];
    const td = p1[0] - p0[0], ty = p1[1] - p0[1];
    const l = Math.hypot(td, ty) || 1;
    return [ty / l, -td / l];
  });
  for (let j = 0; j < nP; j++) {
    const [d, y] = run[j];
    const r = DIM.R + d;
    for (const o of outline) {
      const x = o.cx + r * o.nx, z = r * o.nz;
      pos.push(x, y, z);
      nor.push(pn[j][0] * o.nx, pn[j][1], pn[j][0] * o.nz);
      if (uvMode === 'band') {
        uv.push(o.s / 60, y / 60);
      } else {
        const k = Math.abs(pn[j][0]);
        uv.push((x + k * y * o.nx) / 90, (z + k * y * o.nz) / 90);
      }
    }
  }
  for (let j = 0; j < nP - 1; j++) {
    for (let i = 0; i < nO - 1; i++) {
      const A = j * nO + i, B = A + 1, D = A + nO, C = D + 1;
      idx.push(A, C, B, A, D, C);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

const arc = (cd, cy, r, a0, a1, n) =>
  Array.from({ length: n + 1 }, (_, k) => {
    const t = a0 + ((a1 - a0) * k) / n;
    return [cd + r * Math.cos(t), cy + r * Math.sin(t)];
  });

function tierProfileRuns() {
  const { R, lipTop, bandTop, H, inset } = DIM;
  const crown = 0.3;
  const top = H - crown;
  const fr = 3.8;
  return [
    {
      mat: 'ivory', uv: 'planar',
      pts: [[-R, 0], [-R / 2, 0], ...arc(-1.8, 1.8, 1.8, -Math.PI / 2, 0, 8), [0, lipTop]],
    },
    { mat: 'ivory', uv: 'planar', pts: [[0, lipTop], [-inset, lipTop]] },
    { mat: 'steel', uv: 'band', pts: [[-inset, lipTop], [-inset, (lipTop + bandTop) / 2], [-inset, bandTop]] },
    { mat: 'ivory', uv: 'planar', pts: [[-inset, bandTop], [-0.4, bandTop]] },
    {
      mat: 'ivory', uv: 'planar',
      pts: [
        ...arc(-0.4, bandTop + 0.4, 0.4, -Math.PI / 2, 0, 3),
        [0, top - fr],
        ...arc(-fr, top - fr, fr, 0, Math.PI / 2, 12).slice(1),
        [-8, top + crown * 0.45], [-14, top + crown * 0.8], [-20, top + crown * 0.95], [-R, H],
      ],
    },
  ];
}

function roundedRectShape(x0, y0, x1, y1, r, ShapeType = THREE.Shape) {
  const s = new ShapeType();
  s.moveTo(x0 + r, y0);
  s.lineTo(x1 - r, y0);
  s.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x1, y1 - r);
  s.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2, false);
  s.lineTo(x0 + r, y1);
  s.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x0, y0 + r);
  s.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

function shadowed(mesh, cast = true, receive = true) {
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  return mesh;
}

function buildTierBody(outline, mats) {
  const body = new THREE.Group();
  for (const run of tierProfileRuns()) {
    body.add(shadowed(new THREE.Mesh(sweep(outline, run.pts, run.uv), mats[run.mat])));
  }

  // Window: dark frame with a recessed smoked pane and a steel slider on the right.
  const front = DIM.R - DIM.inset;
  const glass = { x0: -18.6, x1: 15.2, y0: 6.0, y1: 15.6 };
  const frameShape = roundedRectShape(-20, 4.6, 24.5, 17.0, 2.2);
  frameShape.holes.push(roundedRectShape(glass.x0, glass.y0, glass.x1, glass.y1, 1.2, THREE.Path));
  const frame = new THREE.Mesh(
    new THREE.ExtrudeGeometry(frameShape, {
      depth: 0.45, bevelEnabled: true, bevelThickness: 0.15, bevelSize: 0.15, bevelSegments: 2, curveSegments: 10,
    }),
    mats.frame,
  );
  frame.position.z = front + 0.15;
  body.add(shadowed(frame));

  const pane = new THREE.Mesh(new THREE.PlaneGeometry(glass.x1 - glass.x0, glass.y1 - glass.y0), mats.glass);
  pane.position.set((glass.x0 + glass.x1) / 2, (glass.y0 + glass.y1) / 2, front + 0.35);
  body.add(shadowed(pane, false, true));

  const slider = new THREE.Mesh(
    new THREE.ExtrudeGeometry(roundedRectShape(17.6, 7.0, 22.2, 14.6, 2.3), {
      depth: 0.6, bevelEnabled: true, bevelThickness: 0.5, bevelSize: 0.5, bevelSegments: 4, curveSegments: 12,
    }),
    mats.brightSteel,
  );
  slider.position.z = front + 0.75 + 0.5;
  body.add(shadowed(slider));

  // Pencil entry on the free end, opposite the shaft.
  const hole = new THREE.Group();
  hole.position.set(DIM.holeX, DIM.holeY, 0);
  const disk = new THREE.Mesh(new THREE.CircleGeometry(4.5, 40), mats.hole);
  disk.rotation.y = -Math.PI / 2;
  disk.position.x = -0.06;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(4.6, 0.55, 12, 48), mats.brightSteel);
  ring.rotation.y = Math.PI / 2;
  ring.position.x = 0.12;
  hole.add(disk, shadowed(ring));
  body.add(hole);

  return body;
}

function buildCap(mats) {
  const prof = [[0, 6.2], [6.8, 6.2], [7.6, 6.12], [8.15, 5.9], [8.45, 5.5], [8.5, 5.0], [8.5, 0]];
  const cap = shadowed(new THREE.Mesh(
    new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 72),
    mats.capSteel,
  ));
  const seat = new THREE.Mesh(new THREE.RingGeometry(8.4, 8.95, 72), mats.seam);
  seat.rotation.x = -Math.PI / 2;
  seat.position.y = 0.08;
  const g = new THREE.Group();
  g.add(cap, seat);
  return g;
}

function buildPencil(mats) {
  const inside = 14, outside = 70, r = 3.7;
  const len = inside + outside;
  const g = new THREE.Group();
  const shaft = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 40, 1), mats.wood));
  shaft.rotation.z = Math.PI / 2;
  shaft.position.x = inside - len / 2;
  const lead = new THREE.Mesh(new THREE.CircleGeometry(1.1, 24), mats.graphite);
  lead.rotation.y = -Math.PI / 2;
  lead.position.x = -outside - 0.05;
  g.add(shaft, lead);
  return g;
}

/* ---------- assembly ---------- */

export function createSwivel() {
  const mats = createMaterials();
  const outline = stadiumOutline(DIM.a);
  const root = new THREE.Group();
  root.name = 'swivel';

  const tiers = [0, 1, 2].map((i) => {
    const pivot = new THREE.Group();
    pivot.position.set(DIM.a, tierBaseY(i), 0);
    const body = buildTierBody(outline, mats);
    body.position.x = -DIM.a;
    pivot.add(body);
    root.add(pivot);
    return { pivot, body, angle: 0 };
  });

  // Rubber foot and contact shadow under the fixed base.
  const foot = shadowed(new THREE.Mesh(
    sweep(outline, [[-DIM.R, 0], [-3.4, 0], [-2.8, 0.3], [-2.6, 0.8], [-2.6, DIM.foot + 0.2]], 'planar'),
    mats.rubber,
  ), false, false);
  root.add(foot);
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(DIM.L + 28, DIM.W + 28), mats.contact);
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.03;
  contact.renderOrder = -1;
  root.add(contact);

  // Thrust washers between tiers and the retained cap on top of the shaft.
  for (let i = 0; i < 2; i++) {
    const w = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(9.5, 9.5, DIM.gap + 0.1, 48), mats.darkSteel));
    w.position.set(DIM.a, tierBaseY(i) + DIM.H + DIM.gap / 2, 0);
    root.add(w);
  }
  const cap = buildCap(mats);
  cap.position.set(DIM.a, STACK_TOP, 0);
  root.add(cap);

  const pencil = buildPencil(mats);
  pencil.visible = false;

  function setPose({ mid = 0, top = 0 } = {}) {
    tiers[1].angle = mid;
    tiers[2].angle = top;
    tiers[1].pivot.rotation.y = rad(mid);
    tiers[2].pivot.rotation.y = rad(top);
    root.updateMatrixWorld(true);
  }

  function showPencil(i) {
    if (i == null) { pencil.visible = false; pencil.removeFromParent(); return; }
    tiers[i].body.add(pencil);
    pencil.position.set(DIM.holeX, DIM.holeY, 0);
    pencil.visible = true;
    root.updateMatrixWorld(true);
  }

  // World-space helpers for annotations.
  const holeWorld = (i) => tiers[i].body.localToWorld(new THREE.Vector3(DIM.holeX, DIM.holeY, 0));
  const centreWorld = (i) => tiers[i].body.localToWorld(new THREE.Vector3(0, DIM.H / 2, 0));
  const outlineWorld = (i, y = DIM.H) =>
    outline.map((o) => tiers[i].body.localToWorld(new THREE.Vector3(o.cx + DIM.R * o.nx, y, DIM.R * o.nz)));

  // Points that bound the visible object in its current pose, for camera framing.
  function silhouettePoints(step = 3) {
    const pts = [];
    for (let i = 0; i < 3; i++) {
      for (const y of [0, DIM.H]) pts.push(...outlineWorld(i, y).filter((_, k) => k % step === 0));
    }
    if (pencil.visible) {
      pts.push(pencil.localToWorld(new THREE.Vector3(-70, 4, 4)), pencil.localToWorld(new THREE.Vector3(-70, -4, -4)));
    }
    return pts;
  }

  return { root, tiers, mats, setPose, showPencil, holeWorld, centreWorld, outlineWorld, silhouettePoints };
}

// Position on tier i's pencil-entry circle at angle deg (world space).
export function entryPoint(i, deg) {
  const t = rad(deg);
  return new THREE.Vector3(DIM.a - DIM.reach * Math.cos(t), tierBaseY(i) + DIM.holeY, DIM.reach * Math.sin(t));
}

// Combined centre of mass in plan, assuming the three tiers weigh the same.
export function centreOfMass(pose) {
  let x = 0, z = 0;
  for (const deg of [0, pose.mid ?? 0, pose.top ?? 0]) {
    const t = rad(deg);
    x += DIM.a - DIM.a * Math.cos(t);
    z += DIM.a * Math.sin(t);
  }
  return { x: x / 3, z: z / 3 };
}

// True when a plan point lies over the fixed base's footprint.
export function overBase({ x, z }) {
  const cx = Math.max(-DIM.a, Math.min(DIM.a, x));
  return Math.hypot(x - cx, z) <= DIM.R;
}
