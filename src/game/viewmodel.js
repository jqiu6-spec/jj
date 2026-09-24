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
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Scene,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
} from 'three';

const BASE_POSITION = new Vector3(0.27, -0.255, -0.6);
const BASE_ROTATION = { x: 0.02, y: 0.13, z: 0.06 };
const FLASH_LIFE = 0.045;

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

/** Build a stylised low-poly gun for a weapon definition. Barrel points down -z. */
function buildGun(weapon, materials) {
  const { metal, dark, accent, grip } = materials;
  const gun = new Group();
  const box = (w, h, d, x, y, z, material = metal, rx = 0) => {
    const mesh = new Mesh(new BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.rotation.x = rx;
    gun.add(mesh);
    return mesh;
  };
  const tube = (radius, length, z, material = dark) => {
    const mesh = new Mesh(new CylinderGeometry(radius, radius, length, 14), material);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(0, 0.008, z - length / 2);
    gun.add(mesh);
    return mesh;
  };

  const isSmg = weapon.kind === 'smg';
  const isLmg = weapon.kind === 'lmg';
  const receiverLength = isSmg ? 0.28 : 0.34;
  box(0.05, 0.075, receiverLength, 0, 0, 0); // receiver
  box(0.03, 0.02, receiverLength * 0.8, 0, 0.047, -0.02, dark); // top rail
  for (let i = 0; i < 6; i++) box(0.032, 0.006, 0.012, 0, 0.06, -0.12 + i * 0.04, metal); // rail notches
  box(0.03, 0.03, 0.02, 0, 0.066, receiverLength / 2 - 0.05, dark); // rear sight
  box(0.054, 0.02, 0.085, 0, 0.014, -0.04, accent); // accent side panels
  box(0.056, 0.012, 0.05, 0, -0.02, 0.05, dark); // ejection port block
  box(0.02, 0.012, 0.03, 0.03, 0.03, 0.1, dark); // charging handle
  box(0.03, 0.006, 0.07, 0, -0.06, 0.07, dark); // trigger guard
  box(0.006, 0.03, 0.006, 0, -0.045, 0.06, dark); // trigger

  const guardLength = isSmg ? 0.14 : isLmg ? 0.26 : 0.22;
  const guardZ = -receiverLength / 2 - guardLength / 2;
  box(0.046, 0.056, guardLength, 0, -0.004, guardZ, dark); // handguard
  for (let i = 0; i < 4; i++) box(0.05, 0.004, 0.02, 0, -0.004, guardZ - guardLength / 2 + 0.03 + i * 0.045, metal); // vents
  box(0.03, 0.05, 0.03, 0, -0.05, guardZ + 0.02, grip, 0.15); // foregrip
  box(0.01, 0.028, 0.01, 0, 0.062, guardZ - guardLength / 2 + 0.02, dark); // front sight
  if (isLmg) box(0.06, 0.03, 0.06, 0, -0.01, guardZ - guardLength / 2 - 0.02, dark); // barrel shroud

  const barrelStart = guardZ - guardLength / 2;
  const barrelLength = isSmg ? 0.1 : isLmg ? 0.24 : 0.18;
  tube(0.011, barrelLength, barrelStart);
  let muzzleZ = barrelStart - barrelLength;
  if (weapon.suppressed) {
    tube(0.021, 0.15, muzzleZ + 0.03, dark);
    muzzleZ = muzzleZ + 0.03 - 0.15;
  }

  // Magazine, grip and stock
  if (isLmg) box(0.075, 0.12, 0.13, 0, -0.11, -0.02, dark);
  else box(0.034, 0.15, 0.06, 0, -0.1, -0.02, dark, -0.16);
  box(0.035, 0.11, 0.045, 0, -0.085, receiverLength / 2 - 0.05, grip, 0.28);
  const stockLength = isSmg ? 0.1 : 0.2;
  box(0.04, 0.06, stockLength, 0, -0.012, receiverLength / 2 + stockLength / 2 - 0.01, grip);

  const muzzle = new Object3D();
  muzzle.position.set(0, 0.008, muzzleZ);
  gun.add(muzzle);
  return { gun, muzzle };
}

export function createViewmodel(environment) {
  const scene = new Scene();
  scene.environment = environment;
  scene.environmentIntensity = 0.7;
  scene.environmentIntensity = 1;
  const camera = new PerspectiveCamera(50, 16 / 9, 0.01, 20);
  scene.add(new HemisphereLight('#e4ecff', '#1a2029', 1.4));
  const key = new DirectionalLight('#fff4e4', 2.2);
  key.position.set(-2, 3, 1.5);
  const rim = new DirectionalLight('#8fd8ff', 0.9);
  rim.position.set(2.5, 1, -2);
  scene.add(key, rim);

  const materials = {
    metal: new MeshStandardMaterial({ color: '#3b434e', roughness: 0.38, metalness: 0.6 }),
    dark: new MeshStandardMaterial({ color: '#20252c', roughness: 0.48, metalness: 0.55 }),
    accent: new MeshStandardMaterial({ color: '#1d8f7a', emissive: '#36e2c4', emissiveIntensity: 0.45, roughness: 0.3, metalness: 0.4 }),
    grip: new MeshStandardMaterial({ color: '#2a2f37', roughness: 0.8, metalness: 0.15 }),
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
