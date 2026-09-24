// First-person weapon. It lives in its own scene with a fixed-FOV camera so
// it never distorts when the game FOV changes, and is drawn on top of the
// arena after the depth buffer is cleared.

import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  ExtrudeGeometry,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Path,
  PerspectiveCamera,
  RepeatWrapping,
  Scene,
  Shape,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
} from 'three';

const BASE_POSITION = new Vector3(0.245, -0.235, -0.6);
const BASE_ROTATION = { x: 0.02, y: 0.14, z: 0.05 };
const FLASH_LIFE = 0.045;

/** Fine directional noise: brushed metal as a roughness map. */
function brushedTexture(repeat = 6) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  g.fillStyle = '#8c8c8c';
  g.fillRect(0, 0, size, size);
  let seed = 11;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 2200; i++) {
    const y = rand() * size;
    const len = 20 + rand() * 120;
    const x = rand() * size;
    const shade = 110 + Math.floor(rand() * 90);
    g.strokeStyle = `rgba(${shade},${shade},${shade},0.55)`;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + len, y + (rand() - 0.5) * 2);
    g.stroke();
  }
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  return texture;
}

/** Stippled grain for polymer parts, used as a bump map. */
function stippleTexture(repeat = 30) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  g.fillStyle = '#808080';
  g.fillRect(0, 0, size, size);
  let seed = 5;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 900; i++) {
    const shade = 90 + Math.floor(rand() * 80);
    g.fillStyle = `rgb(${shade},${shade},${shade})`;
    g.beginPath();
    g.arc(rand() * size, rand() * size, 1 + rand() * 1.6, 0, Math.PI * 2);
    g.fill();
  }
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  return texture;
}

function flashTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  const c = size / 2;
  const glow = g.createRadialGradient(c, c, 0, c, c, c);
  glow.addColorStop(0, 'rgba(255,250,230,1)');
  glow.addColorStop(0.25, 'rgba(255,200,120,0.9)');
  glow.addColorStop(0.6, 'rgba(255,140,60,0.25)');
  glow.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, size, size);
  // Star spikes
  g.strokeStyle = 'rgba(255,235,190,0.9)';
  g.lineWidth = 4;
  g.lineCap = 'round';
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    g.beginPath();
    g.moveTo(c, c);
    g.lineTo(c + Math.cos(a) * c * 0.95, c + Math.sin(a) * c * 0.95);
    g.stroke();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

// ------------------------------------------------------------------ gun parts
// Guns are built in "gun space": +f is forward toward the muzzle (gun -z),
// y is up, x is the width axis (the player sees the left side, -x).

/** A bevelled slab extruded from a side-view outline. Points are [f, y]. */
function slab(points, width, material, { bevel = 0.003, holes = [] } = {}) {
  const shape = new Shape();
  points.forEach(([f, y], i) => (i === 0 ? shape.moveTo(f, y) : shape.lineTo(f, y)));
  shape.closePath();
  for (const hole of holes) {
    const path = new Path();
    hole.forEach(([f, y], i) => (i === 0 ? path.moveTo(f, y) : path.lineTo(f, y)));
    path.closePath();
    shape.holes.push(path);
  }
  const geometry = new ExtrudeGeometry(shape, {
    depth: Math.max(0.001, width - bevel * 2),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 8,
  });
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  geometry.translate(0, 0, -(bb.min.z + bb.max.z) / 2);
  // Shape x (forward) -> gun -z, extrusion z -> gun x.
  geometry.rotateY(-Math.PI / 2);
  geometry.scale(1, 1, -1);
  geometry.computeVertexNormals();
  return new Mesh(geometry, material);
}

function buildGun(weapon, materials) {
  const { metal, dark, accent, grip, steel, polymer } = materials;
  const gun = new Group();
  const add = (mesh) => {
    gun.add(mesh);
    return mesh;
  };
  const part = (points, width, material, opts) => add(slab(points, width, material, opts));
  const bx = (w, h, d, f, y, material = metal, { x = 0, rx = 0, rz = 0 } = {}) => {
    const mesh = new Mesh(new BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, -f);
    mesh.rotation.set(rx, 0, rz);
    return add(mesh);
  };
  /** Cylinder along the barrel axis from f0 forward by length. */
  const cyl = (radius, length, f0, y = 0.008, material = dark, segments = 28, radiusFront = radius) => {
    const mesh = new Mesh(new CylinderGeometry(radiusFront, radius, length, segments), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, y, -(f0 + length / 2));
    return add(mesh);
  };
  const ring = (radius, tubeRadius, f, y = 0.008, material = steel) => {
    const mesh = new Mesh(new TorusGeometry(radius, tubeRadius, 10, 36), material);
    mesh.position.set(0, y, -f);
    return add(mesh);
  };
  const railSlots = (f0, f1, y, width = 0.028) => {
    for (let f = f0; f < f1; f += 0.018) bx(width, 0.004, 0.008, f, y, steel);
  };
  const vents = (f0, f1, y, count, width) => {
    for (let i = 0; i < count; i++) bx(width, 0.004, 0.012, f0 + ((f1 - f0) * (i + 0.5)) / count, y, steel);
  };
  const triggerGroup = (f, y, material = dark) => {
    bx(0.022, 0.004, 0.075, f + 0.035, y - 0.032, material);
    bx(0.022, 0.03, 0.004, f, y - 0.016, material);
    bx(0.022, 0.03, 0.004, f + 0.07, y - 0.016, material);
    bx(0.005, 0.026, 0.006, f + 0.03, y - 0.014, steel, { rx: 0.25 });
  };
  const chargingHandle = (f, y, side = 1) => bx(0.02, 0.01, 0.03, f, y, dark, { x: side * 0.03 });
  const ironSights = (rearF, frontF, topY) => {
    bx(0.028, 0.02, 0.02, rearF, topY + 0.01, dark);
    const ap = ring(0.006, 0.0015, rearF, topY + 0.026, steel);
    ap.rotation.y = 0;
    bx(0.004, 0.014, 0.018, rearF, topY + 0.028, dark, { x: -0.013 });
    bx(0.004, 0.014, 0.018, rearF, topY + 0.028, dark, { x: 0.013 });
    bx(0.004, 0.026, 0.006, frontF, topY + 0.014, dark);
    bx(0.004, 0.02, 0.008, frontF, topY + 0.016, dark, { x: -0.011 });
    bx(0.004, 0.02, 0.008, frontF, topY + 0.016, dark, { x: 0.011 });
  };

  let muzzleF = 0.6;
  let muzzleY = 0.008;

  if (weapon.id === 'vandal') {
    // AK-style rifle: dust cover, curved magazine, gas tube, slanted brake.
    part([[-0.06, -0.032], [0.2, -0.032], [0.2, 0.024], [0.14, 0.03], [-0.02, 0.03], [-0.06, 0.02]], 0.042, metal);
    for (let i = 0; i < 8; i++) bx(0.03, 0.0025, 0.004, 0.02 + i * 0.016, 0.031, steel); // dust cover ribs
    bx(0.006, 0.02, 0.09, 0.04, 0.0, steel, { x: -0.024 }); // side rail mount (left)
    bx(0.044, 0.012, 0.09, 0.02, 0.004, accent); // accent panel
    part([[-0.06, -0.02], [-0.06, 0.022], [-0.2, 0.012], [-0.38, 0.03], [-0.38, -0.06], [-0.2, -0.036]], 0.036, polymer);
    bx(0.04, 0.09, 0.012, -0.385, -0.015, dark); // butt plate
    part([[0.0, -0.03], [0.048, -0.03], [0.018, -0.13], [-0.03, -0.13]], 0.03, grip);
    triggerGroup(0.05, -0.03);
    part([[0.07, -0.03], [0.135, -0.03], [0.155, -0.1], [0.14, -0.165], [0.1, -0.21], [0.06, -0.2], [0.065, -0.14], [0.055, -0.09]], 0.03, polymer);
    part([[0.2, -0.03], [0.4, -0.022], [0.4, 0.012], [0.2, 0.016]], 0.038, polymer); // lower handguard
    part([[0.2, 0.02], [0.4, 0.02], [0.4, 0.036], [0.2, 0.038]], 0.026, polymer); // upper handguard
    vents(0.24, 0.38, -0.005, 4, 0.044);
    cyl(0.008, 0.26, 0.2, 0.038, steel, 16); // gas tube
    bx(0.024, 0.036, 0.03, 0.43, 0.03, dark); // gas block
    cyl(0.011, 0.33, 0.4, 0.008, dark); // barrel
    ironSights(0.17, 0.62, 0.034);
    cyl(0.015, 0.06, 0.66, 0.008, steel, 20, 0.014); // brake
    bx(0.036, 0.004, 0.02, 0.7, 0.008, dark, { rz: 0.2 }); // slant cut
    chargingHandle(0.17, 0.012);
    muzzleF = 0.725;
  } else if (weapon.id === 'phantom') {
    // Sleek suppressed rifle: angular receiver, skeleton stock, integrated can.
    part([[-0.05, -0.04], [0.24, -0.04], [0.27, 0.0], [0.24, 0.05], [0.1, 0.056], [-0.03, 0.05], [-0.05, 0.02]], 0.05, metal);
    bx(0.03, 0.014, 0.22, 0.09, 0.062, dark); // top rail
    railSlots(0.0, 0.2, 0.07, 0.024);
    bx(0.052, 0.018, 0.13, 0.08, 0.012, accent);
    bx(0.006, 0.026, 0.06, 0.15, -0.01, steel, { x: -0.028 }); // side vent plate
    part([[-0.05, -0.02], [-0.05, 0.035], [-0.28, 0.04], [-0.33, 0.0], [-0.33, -0.075], [-0.22, -0.045]], 0.04, polymer, {
      holes: [[[-0.1, -0.005], [-0.24, 0.0], [-0.26, -0.03], [-0.13, -0.025]]],
    });
    bx(0.044, 0.08, 0.012, -0.335, -0.02, dark); // butt pad
    part([[0.0, -0.04], [0.052, -0.04], [0.03, -0.145], [-0.022, -0.15]], 0.032, grip);
    triggerGroup(0.055, -0.04);
    part([[0.08, -0.04], [0.145, -0.04], [0.155, -0.2], [0.09, -0.215]], 0.032, polymer);
    part([[0.27, -0.03], [0.52, -0.022], [0.52, 0.024], [0.27, 0.038]], 0.04, dark); // handguard
    vents(0.3, 0.5, 0.008, 6, 0.046);
    vents(0.3, 0.5, -0.012, 6, 0.046);
    bx(0.028, 0.05, 0.03, 0.34, -0.05, grip, { rx: 0.15 }); // foregrip
    cyl(0.01, 0.06, 0.52); // barrel
    cyl(0.025, 0.2, 0.55, 0.008, dark, 32); // suppressor
    for (const f of [0.58, 0.65, 0.72]) ring(0.0255, 0.002, f);
    cyl(0.02, 0.012, 0.75, 0.008, steel, 32); // end cap
    ironSights(0.02, 0.5, 0.062);
    chargingHandle(0.2, 0.05);
    muzzleF = 0.765;
  } else if (weapon.id === 'spectre') {
    // Compact SMG with a suppressor shroud, straight magazine and wire stock.
    part([[-0.04, -0.035], [0.17, -0.035], [0.17, 0.03], [-0.04, 0.03]], 0.046, metal);
    bx(0.03, 0.012, 0.18, 0.06, 0.036, dark);
    railSlots(-0.02, 0.15, 0.043, 0.024);
    bx(0.048, 0.014, 0.1, 0.05, -0.002, accent);
    bx(0.006, 0.006, 0.2, -0.16, 0.012, steel, { x: -0.018 }); // wire stock rods
    bx(0.006, 0.006, 0.2, -0.16, 0.012, steel, { x: 0.018 });
    bx(0.042, 0.052, 0.014, -0.265, -0.004, dark); // butt plate
    part([[0.0, -0.035], [0.046, -0.035], [0.02, -0.125], [-0.026, -0.125]], 0.03, grip);
    triggerGroup(0.05, -0.035);
    part([[0.075, -0.035], [0.11, -0.035], [0.118, -0.225], [0.083, -0.225]], 0.027, polymer);
    cyl(0.026, 0.3, 0.17, 0.004, dark, 32); // suppressor shroud
    for (let i = 0; i < 10; i++) {
      const f = 0.2 + i * 0.026;
      const angle = (i * 0.9) % (Math.PI * 2);
      const hole = bx(0.006, 0.006, 0.012, f, 0.004 + Math.sin(angle) * 0.026, steel, { x: Math.cos(angle) * 0.026 });
      hole.rotation.z = angle;
    }
    ring(0.0265, 0.0025, 0.19, 0.004);
    ring(0.0265, 0.0025, 0.46, 0.004);
    cyl(0.021, 0.012, 0.47, 0.004, steel, 32);
    bx(0.026, 0.044, 0.028, 0.24, -0.045, grip, { rx: 0.15 }); // foregrip
    ironSights(0.0, 0.16, 0.036);
    chargingHandle(0.14, 0.012, -1);
    muzzleF = 0.482;
    muzzleY = 0.004;
  } else {
    // Odin: heavy LMG with carry handle, box magazine, vented shroud and bipod.
    part([[-0.06, -0.045], [0.3, -0.045], [0.3, 0.04], [0.2, 0.05], [-0.06, 0.05]], 0.06, metal);
    part([[0.04, 0.05], [0.22, 0.05], [0.22, 0.11], [0.04, 0.11]], 0.03, dark, { holes: [[[0.07, 0.065], [0.19, 0.065], [0.19, 0.095], [0.07, 0.095]]] }); // carry handle
    bx(0.06, 0.02, 0.16, 0.1, 0.02, accent);
    bx(0.006, 0.03, 0.16, 0.12, -0.02, steel, { x: -0.033 }); // feed tray latch plate
    part([[-0.06, -0.03], [-0.06, 0.045], [-0.3, 0.045], [-0.33, -0.02], [-0.3, -0.095], [-0.2, -0.065], [-0.15, -0.03]], 0.046, polymer);
    bx(0.05, 0.11, 0.014, -0.335, -0.03, dark); // butt pad
    part([[0.0, -0.045], [0.052, -0.045], [0.03, -0.145], [-0.022, -0.145]], 0.034, grip);
    triggerGroup(0.055, -0.045);
    part([[0.06, -0.045], [0.24, -0.045], [0.24, -0.18], [0.06, -0.18]], 0.075, polymer); // box magazine
    bx(0.08, 0.005, 0.185, 0.15, -0.183, steel); // base plate
    bx(0.068, 0.016, 0.1, 0.15, -0.05, steel); // feed cover lip
    cyl(0.03, 0.34, 0.3, 0.008, dark, 32); // barrel shroud
    for (let i = 0; i < 8; i++) {
      const f = 0.33 + i * 0.038;
      bx(0.07, 0.006, 0.02, f, 0.008, steel);
      bx(0.006, 0.07, 0.02, f, 0.008, steel);
    }
    ring(0.031, 0.003, 0.31);
    ring(0.031, 0.003, 0.63);
    cyl(0.015, 0.2, 0.64, 0.008, dark); // heavy barrel
    cyl(0.021, 0.07, 0.83, 0.008, steel, 24, 0.019); // brake
    for (let i = 0; i < 3; i++) bx(0.05, 0.004, 0.008, 0.85 + i * 0.015, 0.008, dark);
    bx(0.03, 0.05, 0.03, 0.42, -0.05, grip, { rx: 0.15 }); // foregrip
    bx(0.006, 0.006, 0.2, 0.55, -0.03, steel, { x: -0.02, rx: 0.4 }); // folded bipod legs
    bx(0.006, 0.006, 0.2, 0.55, -0.03, steel, { x: 0.02, rx: 0.4 });
    ironSights(0.02, 0.62, 0.05);
    chargingHandle(0.22, 0.02, -1);
    muzzleF = 0.9;
  }

  const muzzle = new Object3D();
  muzzle.position.set(0, muzzleY, -muzzleF);
  gun.add(muzzle);
  return { gun, muzzle };
}

export function createViewmodel(environment) {
  const scene = new Scene();
  scene.environment = environment;
  scene.environmentIntensity = 0.7;
  scene.environmentIntensity = 0.75;
  const camera = new PerspectiveCamera(50, 16 / 9, 0.01, 20);
  scene.add(new HemisphereLight('#e4ecff', '#1a2029', 1.4));
  const key = new DirectionalLight('#fff4e4', 2.2);
  key.position.set(-2, 3, 1.5);
  const rim = new DirectionalLight('#8fd8ff', 0.9);
  rim.position.set(2.5, 1, -2);
  scene.add(key, rim);

  const brushed = brushedTexture();
  const stipple = stippleTexture();
  const materials = {
    metal: new MeshStandardMaterial({ color: '#2e343d', roughness: 0.55, roughnessMap: brushed, metalness: 0.6 }),
    dark: new MeshStandardMaterial({ color: '#1c2026', roughness: 0.55, roughnessMap: brushed, metalness: 0.7 }),
    accent: new MeshStandardMaterial({ color: '#1d8f7a', emissive: '#36e2c4', emissiveIntensity: 0.4, roughness: 0.35, metalness: 0.4 }),
    grip: new MeshStandardMaterial({ color: '#262b33', roughness: 0.85, metalness: 0.1, bumpMap: stipple, bumpScale: 0.35 }),
    steel: new MeshStandardMaterial({ color: '#7a8492', roughness: 0.35, roughnessMap: brushed, metalness: 0.95 }),
    polymer: new MeshStandardMaterial({ color: '#22272e', roughness: 0.75, metalness: 0.15, bumpMap: stipple, bumpScale: 0.3 }),
  };

  const rig = new Group();
  rig.position.copy(BASE_POSITION);
  scene.add(rig);

  const flash = new Sprite(new SpriteMaterial({ map: flashTexture(), transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
  flash.visible = false;
  flash.scale.setScalar(0.11);

  let built = null;
  let flashLife = 0;
  const recoil = { z: 0, vz: 0, pitch: 0, vPitch: 0 };
  const sway = { x: 0, y: 0 };
  let time = 0;
  let visible = true;

  const ndc = new Vector3();
  const world = new Vector3();

  function setWeapon(weapon) {
    if (built) rig.remove(built.gun);
    built = buildGun(weapon, materials);
    built.muzzle.add(flash);
    rig.add(built.gun);
  }

  return {
    scene,
    camera,
    rig,
    setWeapon,
    setVisible(value) {
      visible = value;
    },
    setAccent(hex) {
      materials.accent.emissive.set(hex);
      materials.accent.color.copy(new Color(hex)).multiplyScalar(0.55);
    },
    resize(aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    },
    /** One shot: kick the gun back and up and show the muzzle flash. */
    kick(weapon) {
      const strength = weapon.kind === 'smg' ? 0.7 : weapon.kind === 'lmg' ? 1.25 : 1;
      recoil.vz += 0.75 * strength;
      recoil.vPitch += 1.4 * strength;
      flashLife = FLASH_LIFE;
      flash.visible = true;
      flash.material.rotation = Math.random() * Math.PI * 2;
      flash.scale.setScalar((0.09 + Math.random() * 0.05) * (weapon.suppressed ? 0.55 : 1));
    },
    /**
     * @param {number} dt
     * @param {{yawRate: number, pitchRate: number}} motion camera turn rates in rad/s
     */
    update(dt, motion) {
      time += dt;
      // Critically damped springs (closed form, so any frame time is stable)
      // bring the recoil back in about a tenth of a second.
      const spring = (value, velocity, omega) => {
        const decay = Math.exp(-omega * dt);
        const c = velocity + omega * value;
        return [(value + c * dt) * decay, (velocity - c * omega * dt) * decay];
      };
      [recoil.z, recoil.vz] = spring(recoil.z, recoil.vz, 24);
      [recoil.pitch, recoil.vPitch] = spring(recoil.pitch, recoil.vPitch, 27);
      recoil.z = Math.max(-0.01, Math.min(recoil.z, 0.06));
      recoil.pitch = Math.max(-0.02, Math.min(recoil.pitch, 0.12));

      // The gun lags a little behind fast turns.
      const targetX = Math.max(-0.028, Math.min(0.028, -motion.yawRate * 0.0035));
      const targetY = Math.max(-0.022, Math.min(0.022, -motion.pitchRate * 0.003));
      const k = 1 - Math.exp(-11 * dt);
      sway.x += (targetX - sway.x) * k;
      sway.y += (targetY - sway.y) * k;

      const bob = Math.sin(time * 1.7) * 0.0012;
      rig.position.set(BASE_POSITION.x + sway.x, BASE_POSITION.y + sway.y + bob, BASE_POSITION.z + recoil.z);
      rig.rotation.set(BASE_ROTATION.x + recoil.pitch + sway.y * 0.6, BASE_ROTATION.y - sway.x * 0.9, BASE_ROTATION.z - sway.x * 0.7);

      if (flash.visible) {
        flashLife -= dt;
        if (flashLife <= 0) flash.visible = false;
      }
    },
    render(renderer) {
      if (!visible || !built) return;
      renderer.clearDepth();
      renderer.render(scene, camera);
    },
    /**
     * Where a tracer should start in the main world so it lines up with the
     * muzzle on screen: project the muzzle through the viewmodel camera and
     * unproject through the game camera.
     */
    muzzleWorld(gameCamera, distance = 0.7) {
      if (!built || !visible) {
        return world.set(0.2, -0.15, -0.5).applyMatrix4(gameCamera.matrixWorld);
      }
      built.muzzle.getWorldPosition(ndc).project(camera);
      world.set(ndc.x, ndc.y, 0.5).unproject(gameCamera);
      world.sub(gameCamera.position).normalize().multiplyScalar(distance).add(gameCamera.position);
      return world;
    },
  };
}
