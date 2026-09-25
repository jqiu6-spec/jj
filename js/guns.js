// Weapon models built from primitives: original low-poly takes on real-world
// rifles, sized in metres. Gun-local space: +X toward the muzzle, +Y up,
// +Z the right side. The left side (-Z) faces the player in first person and
// in the inspect view, so sticker slots sit there.
//
// Every mesh belongs to a zone. 'body' always wears the skin pattern; the
// other zones can wear the pattern or a solid finish, chosen per gun in the
// skin editor. 'metal', 'dark', 'glass' and 'glow' are fixed materials.
import * as THREE from '../vendor/three.module.min.js';

export const ZONE_LABELS = {
  body: 'Body',
  handguard: 'Handguard',
  stock: 'Stock',
  grip: 'Grip',
  foregrip: 'Foregrip',
  mag: 'Magazine',
  suppressor: 'Suppressor',
  scope: 'Scope',
  butt: 'Butt pad',
  blade: 'Blade',
  handle: 'Handle',
  metal: 'Barrel & metal parts',
};

// Spray patterns: how far each shot kicks the view (degrees up, and right),
// by its place in the spray, like CS2's. The first shot goes where you aim;
// past the end the last few repeat. 'ak' climbs hard for ten rounds and then
// wanders left and right; 'light' (M4A1-S, Phantom) climbs about a third as
// much and barely wanders.
export const RECOIL = {
  ak: {
    up: [0.9, 1.0, 1.05, 1.0, 0.9, 0.8, 0.6, 0.45, 0.3, 0.2, 0.15, 0.1, 0.05, 0.05, 0, 0, 0, 0, 0, 0],
    right: [0, 0.08, -0.05, 0.1, -0.08, 0.12, 0.2, 0.3, 0.35, 0.4, 0.35, -0.3, -0.45, -0.5, -0.45, -0.35, 0.3, 0.4, 0.45, 0.35],
  },
  light: {
    up: [0.35, 0.4, 0.4, 0.38, 0.33, 0.28, 0.22, 0.16, 0.12, 0.08, 0.05, 0.03, 0, 0, 0, 0],
    right: [0, 0.04, -0.04, 0.05, -0.05, 0.06, 0.08, -0.08, -0.1, 0.1, 0.12, -0.12, -0.1, 0.1, 0.08, -0.08],
  },
};

export const GUNS = {
  m4a1s: {
    name: 'M4A1-S',
    run: 5.72, // m/s running: CS2 225 units/s
    bodyShots: 5, // body or leg hits to kill a bot in the AWP playlist (a headshot always kills)
    recoil: 'light',
    kind: 'Rifle',
    fireInterval: 0.1, // 600 rounds per minute
    blurb: 'Suppressed 5.56 carbine with a ribbed handguard. 600 rounds per minute; the suppressor comes off.',
    zones: ['handguard', 'stock', 'grip', 'mag', 'suppressor'],
    sound: (skin) => (skin.suppressor === false ? 'rifle' : 'm4a1s'),
  },
  ak47: {
    name: 'AK-47',
    run: 5.46, // m/s running: CS2 215 units/s
    bodyShots: 4,
    recoil: 'ak',
    kind: 'Rifle',
    fireInterval: 0.1,
    blurb: '7.62 rifle with a curved magazine and wood furniture. 600 rounds per minute.',
    zones: ['handguard', 'stock', 'grip', 'mag'],
    sound: () => 'ak47',
  },
  xm7: {
    name: 'XM7',
    run: 5.33, // m/s running: CS2 210 units/s (estimate)
    bodyShots: 3,
    kind: 'Rifle',
    fireInterval: 0.075, // 800 rounds per minute
    blurb: 'The US Army\'s 6.8 mm rifle: long slotted handguard, flip-up sights, straight box magazine, folding stock. Fires at 800 rounds per minute here.',
    zones: ['handguard', 'stock', 'grip', 'mag'],
    sound: () => 'rifle',
  },
  phantom: {
    name: 'Phantom',
    run: 5.4, // m/s running: Valorant's run speed
    bodyShots: 4,
    recoil: 'light',
    kind: 'Rifle',
    fireInterval: 1 / 11, // Valorant Phantom: 11 rounds per second
    blurb: 'Valorant\'s suppressed rifle. Fires at Valorant\'s 11 rounds per second.',
    zones: ['handguard', 'stock', 'grip', 'foregrip', 'mag', 'suppressor'],
    sound: () => 'suppressed',
  },
  vandal: {
    name: 'Vandal 2021',
    run: 5.4, // m/s running: Valorant's run speed
    bodyShots: 4,
    kind: 'Rifle',
    fireInterval: 1 / 9.75, // Valorant Vandal: 9.75 rounds per second
    blurb: 'Valorant\'s Vandal in the Champions 2021 finish. 9.75 rounds per second, a gold tracer, and a kill sound that climbs with each kill in a streak.',
    zones: ['handguard', 'stock', 'grip', 'mag'],
    sound: () => 'champions',
    killSound: 'champions',
    defaultPreset: 'original',
    defaultFx: { type: 'tracer', color: '#ffcf5a', glow: false },
  },
  awp: {
    name: 'AWP',
    run: 5.08, // m/s running: CS2 200 units/s, 100 scoped
    kind: 'Sniper',
    sniper: true,
    blurb: 'Bolt-action sniper with a thumbhole stock. Used in sniping scenarios, with CS2 or Valorant Operator handling (Settings).',
    zones: ['scope', 'mag', 'butt'],
    sound: () => 'awp',
  },
  karambit: {
    name: 'Karambit',
    run: 6.35, // m/s running: CS2 250 units/s with a knife
    kind: 'Knife',
    melee: true,
    blurb: 'A curved claw knife with a finger ring. In a run, scroll the mouse wheel or press 3 to draw it and 1 to go back to your gun. Left click slashes, right click stabs, F inspects.',
    zones: ['blade', 'handle'],
    // Parts a skin leaves unset: the handle keeps the knife's own handle.
    defaultZones: { handle: 'factory' },
    sound: () => 'off',
    defaultPreset: 'original',
  },
};

export const PRIMARY_GUNS = ['m4a1s', 'ak47', 'xm7', 'phantom', 'vandal'];

// ----------------------------------------------------------------- helpers
function shape(points, holes = []) {
  const s = new THREE.Shape();
  points.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  for (const h of holes) {
    const p = new THREE.Path();
    h.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
    p.closePath();
    s.holes.push(p);
  }
  return s;
}

function extrude(points, depth, bevel = 0.002, holes) {
  const g = new THREE.ExtrudeGeometry(shape(points, holes), {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

// Cylinder along X. r1 is the radius at x0, r2 at x1.
export function tube(r1, x0, x1, y, r2 = r1, seg = 28) {
  const g = new THREE.CylinderGeometry(r2, r1, x1 - x0, seg);
  g.rotateZ(-Math.PI / 2);
  g.translate((x0 + x1) / 2, y, 0);
  return g;
}

function box(x0, x1, y0, y1, w, z = 0) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, w);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, z);
  return g;
}

// Picatinny rail: a comb profile extruded across the top.
function rail(x0, x1, y, w) {
  const pts = [[x0, y]];
  for (let x = x0 + 0.003; x + 0.005 < x1; x += 0.01) {
    pts.push([x, y + 0.008], [x, y + 0.013], [x + 0.005, y + 0.013], [x + 0.005, y + 0.008]);
  }
  pts.push([x1, y + 0.008], [x1, y]);
  return extrude(pts, w, 0.0008);
}

// UVs in metres so a pattern keeps one scale across every part. Flat parts
// use a box projection; round parts wrap around their own axis.
export function projectUVs(geo, round) {
  const p = geo.attributes.position;
  const n = geo.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    let u;
    let v;
    if (round) {
      u = x;
      v = Math.atan2(z, y - round.y) * round.r;
    } else {
      const ax = Math.abs(n.getX(i));
      const ay = Math.abs(n.getY(i));
      const az = Math.abs(n.getZ(i));
      if (az >= ax && az >= ay) { u = x; v = y; } else if (ay >= ax) { u = x; v = z; } else { u = z; v = y; }
    }
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(p.count * 3).fill(1), 3));
}

// Collects meshes by zone. Skinnable zones get UVs and no material yet;
// metal parts keep theirs (as the 'metal' zone's factory look) but can be
// painted too.
function kit(mats) {
  const group = new THREE.Group();
  const zones = {};
  const part = (geo, zone, round) => {
    const fixed = mats[zone];
    const paintable = !fixed || zone === 'metal';
    if (paintable) projectUVs(geo, round);
    const m = new THREE.Mesh(geo, fixed || null);
    if (fixed && paintable) m.userData.orig = fixed;
    if (paintable) (zones[zone] || (zones[zone] = [])).push(m);
    group.add(m);
    return m;
  };
  return { group, zones, part };
}

// ------------------------------------------------------------------ models
function m4a1s(mats) {
  const { group, zones, part } = kit(mats);
  const Y = 0.022; // bore line
  const round = (r) => ({ y: Y, r });
  // Upper receiver, flat-top rail, charging handle, forward assist, ejection
  // port with a brass deflector, magazine well bulge on the lower.
  part(extrude([[-0.005, 0], [0.195, 0], [0.195, 0.048], [0.02, 0.048], [0, 0.043], [-0.005, 0.03]], 0.028), 'body');
  part(rail(0, 0.19, 0.048, 0.021), 'metal');
  part(box(-0.02, -0.004, 0.036, 0.046, 0.04), 'metal');
  part(tube(0.0055, -0.002, 0.022, 0.03).translate(0, 0, 0.019), 'metal');
  part(box(0.068, 0.136, 0.013, 0.034, 0.001, 0.0152), 'dark');
  part(extrude([[0.058, 0.01], [0.068, 0.01], [0.068, 0.04], [0.058, 0.04]], 0.006, 0.001).translate(0, 0, 0.017), 'metal');
  part(extrude([[0, 0], [0.19, 0], [0.19, -0.02], [0.148, -0.028], [0.148, -0.046], [0.07, -0.046], [0.06, -0.03], [0, -0.028]], 0.03), 'body');
  part(box(0.072, 0.146, -0.044, -0.026, 0.034), 'body');
  part(box(0.018, 0.072, -0.061, -0.056, 0.012), 'metal');
  part(box(0.066, 0.072, -0.061, -0.03, 0.012), 'metal');
  part(extrude([[0.04, -0.028], [0.047, -0.028], [0.05, -0.052], [0.044, -0.052]], 0.005, 0.0008), 'metal');
  part(new THREE.CylinderGeometry(0.004, 0.004, 0.008, 12).rotateX(Math.PI / 2).translate(0.024, -0.014, -0.018), 'metal'); // selector
  // Pistol grip, raked back, and the curved magazine.
  part(extrude([[-0.006, -0.026], [0.036, -0.026], [0.022, -0.07], [0.006, -0.126], [-0.031, -0.126], [-0.022, -0.07]], 0.026, 0.004), 'grip');
  part(extrude([[0.078, -0.03], [0.14, -0.03], [0.148, -0.1], [0.162, -0.17], [0.176, -0.214], [0.116, -0.226], [0.104, -0.176], [0.091, -0.1]], 0.022, 0.003), 'mag');
  // Round ribbed handguard like the reference: a tube with raised rings,
  // a delta ring behind it and a handguard cap in front.
  part(tube(0.03, 0.188, 0.2, Y), 'metal');
  part(tube(0.026, 0.2, 0.44, Y), 'handguard', round(0.026));
  for (let i = 0; i < 9; i++) {
    const x = 0.212 + i * 0.026;
    part(tube(0.0295, x, x + 0.012, Y), 'handguard', round(0.0295));
  }
  part(tube(0.028, 0.44, 0.452, Y), 'metal');
  // Barrel, gas block and A-frame front sight, rear sight on the rail.
  part(tube(0.0085, 0.452, 0.58, Y), 'metal');
  part(box(0.452, 0.478, -0.004, 0.034, 0.024), 'metal');
  part(extrude([[0.452, 0.034], [0.48, 0.034], [0.469, 0.088], [0.461, 0.088]], 0.01, 0.001), 'metal');
  part(extrude([[0.004, 0.061], [0.034, 0.061], [0.029, 0.082], [0.011, 0.082]], 0.018, 0.001), 'metal');
  // Buffer tube (painted, like the reference) and an A2-style fixed stock
  // with the sloped comb, the lower sling notch and a rubber butt pad.
  part(tube(0.0145, -0.27, -0.004, Y), 'body', round(0.0145));
  part(extrude([[-0.37, 0.05], [-0.205, 0.046], [-0.19, 0.032], [-0.19, 0.002], [-0.24, -0.018], [-0.33, -0.06], [-0.37, -0.074]], 0.036, 0.004), 'stock');
  part(box(-0.3, -0.29, -0.052, -0.038, 0.04), 'dark');
  part(box(-0.385, -0.37, -0.078, 0.054, 0.04), 'butt');
  // Suppressor or bare flash hider.
  const sup = new THREE.Group();
  const before = group.children.length;
  part(tube(0.0195, 0.575, 0.765, Y), 'suppressor', round(0.0195));
  part(tube(0.0205, 0.566, 0.578, Y), 'metal');
  part(tube(0.0205, 0.763, 0.775, Y), 'metal');
  part(tube(0.0055, 0.775, 0.7755, Y), 'dark');
  for (const m of group.children.slice(before)) sup.add(m);
  group.add(sup);
  const hider = part(tube(0.011, 0.575, 0.605, Y), 'metal');
  return {
    group, zones, suppressor: sup, hider,
    muzzle: (skin) => [skin.suppressor === false ? 0.605 : 0.775, Y],
    rear: -0.385, front: 0.775, fade: [-0.27, 0.44],
    slots: [
      { name: 'Handguard', x: 0.32, y: 0.022, z: -0.0301, size: 0.036 },
      { name: 'Receiver', x: 0.105, y: 0.024, z: -0.0166, size: 0.032 },
      { name: 'Magazine', x: 0.123, y: -0.125, z: -0.0146, size: 0.04 },
      { name: 'Stock', x: -0.29, y: 0.004, z: -0.0226, size: 0.05 },
      { name: 'Lower', x: 0.172, y: -0.012, z: -0.0176, size: 0.022 },
    ],
  };
}

function ak47(mats) {
  const { group, zones, part } = kit(mats);
  const Y = 0.012;
  // Stamped receiver with a ribbed dust cover, rear sight block.
  part(extrude([[-0.1, -0.02], [0.2, -0.02], [0.2, 0.035], [0.19, 0.05], [-0.06, 0.055], [-0.1, 0.045]], 0.036), 'body');
  for (let i = 0; i < 4; i++) part(box(0.0 + i * 0.024, 0.014 + i * 0.024, 0.052, 0.058, 0.03), 'body');
  part(box(0.19, 0.232, 0.03, 0.062, 0.03), 'metal');
  part(extrude([[0.2, 0.062], [0.232, 0.062], [0.228, 0.072], [0.204, 0.07]], 0.014, 0.001), 'metal');
  part(box(0.08, 0.16, 0.0, 0.02, 0.001, 0.0185), 'dark'); // ejection port
  part(tube(0.005, 0.15, 0.175, 0.03).translate(0, 0, 0.02), 'metal'); // charging handle
  // Handguards and gas tube.
  part(extrude([[0.232, -0.026], [0.42, -0.02], [0.42, 0.028], [0.232, 0.03]], 0.04, 0.006), 'handguard');
  part(tube(0.0135, 0.236, 0.41, 0.05), 'handguard', { y: 0.05, r: 0.0135 });
  part(tube(0.0085, 0.41, 0.47, 0.05), 'metal');
  part(box(0.46, 0.49, 0.002, 0.058, 0.026), 'metal');
  // Barrel, front sight, slant brake.
  part(tube(0.0095, 0.42, 0.6, Y), 'metal');
  part(tube(0.013, 0.55, 0.585, Y), 'metal');
  part(extrude([[0.553, 0.02], [0.582, 0.02], [0.575, 0.072], [0.561, 0.072]], 0.012, 0.001), 'metal');
  part(tube(0.011, 0.6, 0.636, Y), 'metal');
  part(extrude([[0.61, 0.0], [0.64, 0.0], [0.634, 0.024], [0.616, 0.024]], 0.014, 0.001), 'metal');
  // Banana magazine.
  part(extrude([[0.075, -0.02], [0.132, -0.02], [0.146, -0.08], [0.176, -0.15], [0.214, -0.21], [0.242, -0.244], [0.186, -0.268], [0.156, -0.202], [0.122, -0.132], [0.096, -0.07]], 0.026, 0.003), 'mag');
  // Trigger guard and trigger.
  part(box(-0.005, 0.07, -0.062, -0.056, 0.012), 'metal');
  part(box(0.064, 0.07, -0.062, -0.02, 0.012), 'metal');
  part(extrude([[0.02, -0.02], [0.027, -0.02], [0.03, -0.047], [0.024, -0.047]], 0.005, 0.0008), 'metal');
  // Grip and drop stock with a steel butt plate.
  part(extrude([[-0.055, -0.02], [-0.015, -0.02], [-0.03, -0.07], [-0.045, -0.125], [-0.08, -0.122], [-0.068, -0.07]], 0.03, 0.004), 'grip');
  part(extrude([[-0.1, 0.042], [-0.46, 0.02], [-0.47, 0.018], [-0.47, -0.115], [-0.44, -0.118], [-0.25, -0.055], [-0.1, -0.02]], 0.036, 0.004), 'stock');
  part(box(-0.484, -0.47, -0.12, 0.024, 0.04), 'metal');
  return {
    group, zones,
    muzzle: () => [0.636, Y],
    rear: -0.484, front: 0.636, fade: [-0.1, 0.2],
    slots: [
      { name: 'Receiver rear', x: 0.0, y: 0.016, z: -0.0206, size: 0.036 },
      { name: 'Receiver front', x: 0.162, y: 0.016, z: -0.0206, size: 0.03 },
      { name: 'Magazine', x: 0.16, y: -0.125, z: -0.0166, size: 0.036 },
      { name: 'Handguard', x: 0.33, y: 0.003, z: -0.0266, size: 0.04 },
      { name: 'Stock', x: -0.3, y: -0.02, z: -0.0226, size: 0.052 },
    ],
  };
}

function xm7(mats) {
  const { group, zones, part } = kit(mats);
  const Y = 0.022;
  // Upper receiver, full-length top rail, flip-up sights, left charging handle.
  part(extrude([[-0.02, 0], [0.2, 0], [0.2, 0.05], [0, 0.052], [-0.02, 0.045]], 0.032), 'body');
  part(rail(-0.01, 0.505, 0.052, 0.022), 'metal');
  part(extrude([[0.0, 0.065], [0.024, 0.065], [0.02, 0.09], [0.006, 0.09]], 0.02, 0.001), 'metal');
  part(extrude([[0.482, 0.065], [0.504, 0.065], [0.5, 0.092], [0.488, 0.092]], 0.016, 0.001), 'metal');
  part(box(0.118, 0.142, 0.024, 0.04, 0.012, -0.022), 'metal');
  // Long handguard with slots along the side and angled vents at the front.
  part(extrude([[0.2, -0.012], [0.5, -0.012], [0.515, 0], [0.515, 0.05], [0.2, 0.052]], 0.05, 0.004), 'handguard');
  for (const [x0, x1] of [[0.232, 0.29], [0.305, 0.335], [0.35, 0.41], [0.425, 0.452]]) {
    part(box(x0, x1, 0.026, 0.038, 0.001, 0.0295), 'dark');
    part(box(x0, x1, 0.026, 0.038, 0.001, -0.0295), 'dark');
  }
  for (let i = 0; i < 3; i++) {
    const x = 0.462 + i * 0.013;
    for (const z of [0.0295, -0.0295]) {
      part(extrude([[x, -0.004], [x + 0.005, -0.004], [x + 0.013, 0.016], [x + 0.008, 0.016]], 0.001, 0).translate(0, 0, z), 'dark');
    }
  }
  // Barrel and muzzle device.
  part(tube(0.009, 0.515, 0.6, Y), 'metal');
  part(tube(0.012, 0.595, 0.642, Y), 'metal');
  // Lower receiver, trigger guard, trigger.
  part(extrude([[0, 0], [0.2, 0], [0.2, -0.02], [0.152, -0.03], [0.152, -0.05], [0.075, -0.05], [0.062, -0.032], [0, -0.03]], 0.034), 'body');
  part(box(0.02, 0.074, -0.064, -0.058, 0.012), 'metal');
  part(box(0.068, 0.074, -0.064, -0.032, 0.012), 'metal');
  part(extrude([[0.042, -0.03], [0.049, -0.03], [0.052, -0.054], [0.046, -0.054]], 0.005, 0.0008), 'metal');
  // Straight box magazine with a base plate.
  part(extrude([[0.08, -0.035], [0.146, -0.035], [0.152, -0.16], [0.088, -0.165]], 0.03, 0.003), 'mag');
  part(box(0.084, 0.156, -0.176, -0.162, 0.036), 'dark');
  // Ergonomic grip.
  part(extrude([[-0.005, -0.028], [0.04, -0.028], [0.03, -0.07], [0.02, -0.125], [-0.02, -0.13], [-0.028, -0.1], [-0.015, -0.06]], 0.03, 0.004), 'grip');
  // Folding hinge, short tube and an angular adjustable stock.
  part(box(-0.042, -0.02, -0.004, 0.05, 0.03), 'metal');
  part(tube(0.014, -0.18, -0.04, 0.03), 'metal');
  part(extrude(
    [[-0.33, 0.058], [-0.17, 0.052], [-0.17, 0.004], [-0.25, -0.04], [-0.315, -0.09], [-0.33, -0.09]],
    0.036, 0.004,
    [[[-0.3, 0.04], [-0.2, 0.036], [-0.2, 0.018], [-0.3, 0.01]]],
  ), 'stock');
  part(box(-0.345, -0.33, -0.094, 0.062, 0.04), 'dark');
  return {
    group, zones,
    muzzle: () => [0.642, Y],
    rear: -0.345, front: 0.642, fade: [-0.2, 0.515],
    slots: [
      { name: 'Handguard', x: 0.38, y: 0.008, z: -0.0299, size: 0.036 },
      { name: 'Receiver', x: 0.1, y: 0.025, z: -0.0182, size: 0.032 },
      { name: 'Magazine', x: 0.116, y: -0.1, z: -0.0184, size: 0.045 },
      { name: 'Stock', x: -0.26, y: -0.012, z: -0.0226, size: 0.04 },
      { name: 'Grip', x: 0.012, y: -0.08, z: -0.0196, size: 0.028 },
    ],
  };
}

function phantom(mats) {
  const { group, zones, part } = kit(mats);
  const Y = 0.025;
  // Angular upper receiver with a spine rail that runs out over the suppressor.
  part(extrude([[-0.02, -0.01], [0.22, -0.01], [0.22, 0.056], [0.1, 0.063], [0, 0.059], [-0.02, 0.046]], 0.036, 0.003), 'body');
  part(extrude([[0.04, 0.063], [0.53, 0.063], [0.545, 0.07], [0.535, 0.076], [0.05, 0.076]], 0.018, 0.0015), 'metal');
  part(extrude([[0.05, 0.076], [0.075, 0.076], [0.07, 0.09], [0.056, 0.09]], 0.016, 0.001), 'metal');
  part(extrude([[0.5, 0.076], [0.524, 0.076], [0.52, 0.09], [0.506, 0.09]], 0.014, 0.001), 'metal');
  // Handguard with a lower fin, vertical foregrip, laser module with a blue lens.
  part(extrude([[0.22, -0.01], [0.5, -0.006], [0.515, 0.012], [0.515, 0.056], [0.22, 0.056]], 0.046, 0.004), 'handguard');
  part(extrude([[0.34, -0.012], [0.52, -0.008], [0.53, -0.018], [0.36, -0.024]], 0.03, 0.002), 'metal');
  part(extrude([[0.3, -0.012], [0.338, -0.012], [0.334, -0.11], [0.304, -0.112]], 0.026, 0.004), 'foregrip');
  part(box(0.43, 0.5, 0.012, 0.038, 0.018, -0.031), 'metal');
  part(tube(0.007, 0.5, 0.505, 0.025).translate(0, 0, -0.031), 'glow');
  part(box(0.505, 0.66, 0.0235, 0.0265, 0.002, -0.031), 'glow');
  for (const x of [0.25, 0.29, 0.39]) part(box(x, x + 0.03, 0.03, 0.04, 0.001, -0.0271), 'dark');
  // Integrated suppressor with end caps.
  part(tube(0.021, 0.515, 0.79, Y), 'suppressor', { y: Y, r: 0.021 });
  part(tube(0.0225, 0.515, 0.53, Y), 'metal');
  part(tube(0.0225, 0.785, 0.8, Y), 'metal');
  part(tube(0.006, 0.8, 0.8005, Y), 'dark');
  // Lower receiver, trigger guard, trigger.
  part(extrude([[0.02, -0.01], [0.2, -0.01], [0.2, -0.035], [0.162, -0.05], [0.09, -0.05], [0.07, -0.035], [0.02, -0.03]], 0.034, 0.002), 'body');
  part(box(0.03, 0.084, -0.068, -0.062, 0.012), 'metal');
  part(box(0.078, 0.084, -0.068, -0.035, 0.012), 'metal');
  part(extrude([[0.05, -0.03], [0.057, -0.03], [0.06, -0.056], [0.054, -0.056]], 0.005, 0.0008), 'metal');
  // Box magazine, grip, and an adjustable stock with a cut-out.
  part(extrude([[0.096, -0.04], [0.158, -0.04], [0.166, -0.19], [0.104, -0.194]], 0.03, 0.003), 'mag');
  part(box(0.1, 0.17, -0.204, -0.19, 0.034), 'dark');
  part(extrude([[0.0, -0.028], [0.046, -0.028], [0.036, -0.075], [0.024, -0.135], [-0.018, -0.14], [-0.024, -0.1], [-0.01, -0.06]], 0.03, 0.004), 'grip');
  part(tube(0.014, -0.13, -0.02, 0.035), 'metal');
  part(extrude(
    [[-0.37, 0.066], [-0.13, 0.06], [-0.13, 0.022], [-0.2, 0.004], [-0.33, -0.075], [-0.37, -0.075]],
    0.036, 0.004,
    [[[-0.34, 0.046], [-0.18, 0.042], [-0.2, 0.024], [-0.33, -0.04]]],
  ), 'stock');
  part(box(-0.385, -0.37, -0.079, 0.07, 0.04), 'dark');
  return {
    group, zones,
    muzzle: () => [0.8, Y],
    rear: -0.385, front: 0.8, fade: [-0.02, 0.515],
    slots: [
      { name: 'Handguard', x: 0.36, y: 0.012, z: -0.0276, size: 0.034 },
      { name: 'Receiver', x: 0.12, y: 0.03, z: -0.0216, size: 0.034 },
      { name: 'Suppressor', x: 0.66, y: Y + 0.006, z: -0.0212, size: 0.026 },
      { name: 'Magazine', x: 0.13, y: -0.12, z: -0.0186, size: 0.042 },
      { name: 'Stock', x: -0.3, y: 0.04, z: -0.0226, size: 0.03 },
    ],
  };
}

function awp(mats) {
  const { group, zones, part } = kit(mats);
  const Y = 0.03;
  const S = 0.098; // scope axis
  // Thumbhole chassis: butt, comb, grip and forend in one piece, cheek riser.
  part(extrude(
    [[-0.53, 0.04], [-0.23, 0.035], [-0.17, 0.012], [0.44, 0.012], [0.455, -0.012], [0.44, -0.036], [0.02, -0.036], [0, -0.05], [-0.03, -0.135], [-0.075, -0.14], [-0.075, -0.1], [-0.2, -0.105], [-0.46, -0.14], [-0.53, -0.145]],
    0.04, 0.004,
    [[[-0.2, -0.03], [-0.1, -0.03], [-0.09, -0.08], [-0.21, -0.085]]],
  ), 'body');
  part(box(-0.3, -0.2, 0.038, 0.052, 0.036), 'body');
  part(box(-0.545, -0.53, -0.148, 0.043, 0.044), 'butt');
  // Action, bolt shroud, bolt handle on the right, magazine, trigger guard.
  part(tube(0.021, -0.17, 0.2, Y), 'body', { y: Y, r: 0.021 });
  part(tube(0.016, -0.2, -0.17, Y), 'metal');
  part(new THREE.CylinderGeometry(0.005, 0.005, 0.05, 12).rotateX(1.2).translate(-0.115, Y - 0.012, 0.03), 'metal');
  part(new THREE.SphereGeometry(0.009, 16, 12).translate(-0.115, Y - 0.032, 0.05), 'metal');
  part(box(0.03, 0.1, -0.075, -0.036, 0.032), 'mag');
  part(box(-0.03, 0.03, -0.068, -0.062, 0.012), 'metal');
  part(box(0.024, 0.03, -0.068, -0.036, 0.012), 'metal');
  // Barrel and muzzle brake with ports.
  part(tube(0.013, 0.2, 0.78, Y, 0.011), 'metal');
  part(tube(0.017, 0.78, 0.84, Y), 'metal');
  for (const x of [0.792, 0.812]) {
    part(box(x, x + 0.01, Y - 0.008, Y + 0.008, 0.001, 0.0172), 'dark');
    part(box(x, x + 0.01, Y - 0.008, Y + 0.008, 0.001, -0.0172), 'dark');
  }
  // Scope: rings, tube, bells, turrets, lenses.
  for (const x of [-0.02, 0.15]) part(box(x, x + 0.022, Y + 0.018, S - 0.008, 0.024), 'metal');
  part(tube(0.0135, -0.07, 0.21, S), 'scope', { y: S, r: 0.0135 });
  part(tube(0.0135, 0.21, 0.27, S, 0.025), 'scope', { y: S, r: 0.02 });
  part(tube(0.025, 0.27, 0.32, S), 'scope', { y: S, r: 0.025 });
  part(tube(0.021, -0.14, -0.07, S, 0.0135), 'scope', { y: S, r: 0.018 });
  part(new THREE.CylinderGeometry(0.009, 0.009, 0.018, 20).translate(0.07, S + 0.02, 0), 'metal');
  part(new THREE.CylinderGeometry(0.009, 0.009, 0.018, 20).rotateX(Math.PI / 2).translate(0.07, S, -0.02), 'metal');
  part(tube(0.0225, 0.32, 0.3205, S), 'glass');
  part(tube(0.019, -0.1405, -0.14, S), 'glass');
  return {
    group, zones,
    muzzle: () => [0.84, Y],
    rear: -0.545, front: 0.84, fade: [-0.53, 0.44],
    slots: [
      { name: 'Stock', x: -0.36, y: -0.03, z: -0.0246, size: 0.06 },
      { name: 'Butt', x: -0.48, y: -0.06, z: -0.0246, size: 0.05 },
      { name: 'Grip', x: -0.05, y: -0.08, z: -0.0246, size: 0.03 },
      { name: 'Forend', x: 0.3, y: -0.012, z: -0.0246, size: 0.042 },
      { name: 'Scope', x: 0.08, y: S, z: -0.0142, size: 0.022 },
    ],
  };
}

// Simple karambit: the ring at the origin, the blade curving down toward -Y
// with the edge on the inside of the curve (+X), like the detailed model.
function karambit(mats) {
  const { group, zones, part } = kit(mats);
  const ring = new THREE.TorusGeometry(0.0165, 0.0055, 12, 40);
  part(ring, 'handle');
  part(extrude([[-0.013, -0.012], [-0.03, -0.045], [-0.042, -0.088], [-0.018, -0.094], [-0.012, -0.062], [0.004, -0.021]], 0.012, 0.002), 'handle');
  // Crescent blade: the spine (outer curve) then the edge (inner curve).
  const pts = [];
  for (let i = 0; i <= 12; i++) {
    const u = i / 12;
    pts.push([-0.042 + (0.05 * u * u), -0.09 - 0.079 * Math.sin((u * Math.PI) / 2)]);
  }
  for (let i = 12; i >= 0; i--) {
    const u = i / 12;
    pts.push([-0.018 + 0.026 * u * u * u, -0.094 - 0.075 * u ** 1.4]);
  }
  part(extrude(pts, 0.004, 0.0008), 'blade');
  return {
    group, zones,
    muzzle: () => [0.008, -0.169],
    rear: -0.022, front: 0.169,
    fade: [-0.09, -0.17], fadeAxis: 'y',
    slots: [],
  };
}

// The Vandal's simple stand-in is the AK it is modelled on.
const BUILDERS = { m4a1s, ak47, xm7, phantom, awp, karambit, vandal: ak47 };

export function buildGun(id, mats) {
  const g = BUILDERS[id](mats);
  g.id = id;
  if (g.zones.metal && !g.zoneList) g.zoneList = [...GUNS[id].zones, 'metal'];
  return g;
}
