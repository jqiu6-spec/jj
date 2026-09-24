// The range: floor, walls, ceiling lights, props and lighting, plus the
// target meshes. Props are also listed as boxes so shots can hit them.

import {
  ACESFilmicToneMapping,
  BackSide,
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PCFShadowMap,
  PlaneGeometry,
  PMREMGenerator,
  RepeatWrapping,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildBot } from './bot.js';

export const ROOM = Object.freeze({
  min: { x: -30, y: 0, z: -50 },
  max: { x: 30, y: 14, z: 20 },
});

const ACCENT = '#36e2c4';

function makeCanvas(width, height = width) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function texture(canvas, repeatX = 1, repeatY = 1, anisotropy = 1) {
  const t = new CanvasTexture(canvas);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = anisotropy;
  return t;
}

/** Subtle grain so large flat surfaces don't band. */
function grain(g, size, alpha, seed = 1) {
  let s = seed;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const image = g.getImageData(0, 0, size, size);
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * alpha * 255;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  g.putImageData(image, 0, 0);
}

/** One 5 m floor tile: metre lines plus a stronger 5 m seam. */
function floorTexture(anisotropy) {
  const size = 512;
  const canvas = makeCanvas(size);
  const g = canvas.getContext('2d');
  g.fillStyle = '#161c25';
  g.fillRect(0, 0, size, size);
  grain(g, size, 0.06, 7);
  g.fillStyle = '#1c2430';
  for (let i = 1; i < 5; i++) {
    const p = (i * size) / 5;
    g.fillRect(p - 1, 0, 2, size);
    g.fillRect(0, p - 1, size, 2);
  }
  g.fillStyle = '#26303f';
  g.fillRect(0, 0, 4, size);
  g.fillRect(0, 0, size, 4);
  return texture(canvas, 1, 1, anisotropy);
}

/** 4 m wall panel with bevelled seams. */
function wallTexture(anisotropy) {
  const size = 512;
  const canvas = makeCanvas(size);
  const g = canvas.getContext('2d');
  g.fillStyle = '#1a212c';
  g.fillRect(0, 0, size, size);
  grain(g, size, 0.05, 3);
  g.fillStyle = '#131922';
  g.fillRect(0, 0, size, 6);
  g.fillRect(0, 0, 6, size);
  g.fillStyle = '#232c39';
  g.fillRect(6, 6, size - 12, 2);
  g.fillRect(6, 6, 2, size - 12);
  // Panel split in the middle
  g.fillStyle = '#151b24';
  g.fillRect(size / 2 - 2, 6, 4, size - 12);
  return texture(canvas, 1, 1, anisotropy);
}

function labelTexture(text, color, font = '700 96px "Chakra Petch", system-ui, sans-serif', width = 512, height = 160) {
  const canvas = makeCanvas(width, height);
  const g = canvas.getContext('2d');
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.fillText(text, width / 2, height / 2);
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Image-based lighting from a neutral studio room; shared with the viewmodel. */
export function buildEnvironment(renderer) {
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  const pmrem = new PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return env;
}

/** The static room. Returns the boxes shots can hit. */
export function buildRoom(scene, anisotropy, environment) {
  const room = new Group();
  const { min, max } = ROOM;
  const width = max.x - min.x;
  const depth = max.z - min.z;
  const height = max.y - min.y;
  const cx = (min.x + max.x) / 2;
  const cz = (min.z + max.z) / 2;
  const props = [];

  scene.environment = environment;
  scene.environmentIntensity = 0.45;

  const floor = new Mesh(
    new PlaneGeometry(width, depth),
    new MeshStandardMaterial({ map: floorTexture(anisotropy), roughness: 0.62, metalness: 0.18 }),
  );
  floor.material.map.repeat.set(width / 5, depth / 5);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, 0, cz);
  floor.receiveShadow = true;
  room.add(floor);

  const wallMaterial = new MeshStandardMaterial({ map: wallTexture(anisotropy), roughness: 0.8, metalness: 0.05 });
  wallMaterial.color.set('#c9d2e0');
  const addWall = (w, x, z, rotationY) => {
    const wall = new Mesh(new PlaneGeometry(w, height), wallMaterial.clone());
    wall.material.map = wallMaterial.map.clone();
    wall.material.map.repeat.set(w / 4, height / 4);
    wall.position.set(x, height / 2, z);
    wall.rotation.y = rotationY;
    room.add(wall);
  };
  addWall(width, cx, min.z, 0); // far
  addWall(width, cx, max.z, Math.PI); // behind the player
  addWall(depth, min.x, cz, Math.PI / 2); // left
  addWall(depth, max.x, cz, -Math.PI / 2); // right

  // Darker lower band around the room, capped by the accent strip.
  const bandMaterial = new MeshStandardMaterial({ color: '#141a23', roughness: 0.75, metalness: 0.1 });
  const bandHeight = 2.3;
  for (const [length, x, z, rotationY] of [
    [width, cx, min.z + 0.02, 0],
    [width, cx, max.z - 0.02, 0],
    [depth, min.x + 0.02, cz, Math.PI / 2],
    [depth, max.x - 0.02, cz, Math.PI / 2],
  ]) {
    const band = new Mesh(new BoxGeometry(length, bandHeight, 0.04), bandMaterial);
    band.position.set(x, bandHeight / 2, z);
    band.rotation.y = rotationY;
    room.add(band);
  }

  const ceiling = new Mesh(new PlaneGeometry(width, depth), new MeshStandardMaterial({ color: '#0c1015', roughness: 0.95 }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(cx, height, cz);
  room.add(ceiling);

  // Ceiling light panels
  const panelMaterial = new MeshBasicMaterial({ color: '#dbe7ff', toneMapped: false });
  const panelGeometry = new BoxGeometry(3.2, 0.08, 1.2);
  for (let x = min.x + 6; x < max.x; x += 12) {
    for (let z = min.z + 5; z < max.z; z += 10) {
      const panel = new Mesh(panelGeometry, panelMaterial);
      panel.position.set(x, height - 0.05, z);
      room.add(panel);
    }
  }

  // Accent strips along the walls: one at the base, one at eye level.
  const stripMaterial = new MeshBasicMaterial({ color: ACCENT, toneMapped: false });
  const strips = [
    [width, cx, min.z + 0.05, 0],
    [width, cx, max.z - 0.05, 0],
    [depth, min.x + 0.05, cz, Math.PI / 2],
    [depth, max.x - 0.05, cz, Math.PI / 2],
  ];
  for (const [length, x, z, rotationY] of strips) {
    for (const y of [0.06, 2.3]) {
      const strip = new Mesh(new BoxGeometry(length, y > 1 ? 0.03 : 0.06, 0.06), stripMaterial);
      strip.position.set(x, y, z);
      strip.rotation.y = rotationY;
      room.add(strip);
    }
  }

  // Props: pillars along the sides and a crate line with a backstop behind the targets.
  const propMaterial = new MeshStandardMaterial({ color: '#28313d', roughness: 0.65, metalness: 0.3 });
  const crateMaterial = new MeshStandardMaterial({ color: '#39465a', roughness: 0.7, metalness: 0.15 });
  const addBox = (w, h, d, x, y, z, material = propMaterial) => {
    const mesh = new Mesh(new BoxGeometry(w, h, d), material);
    mesh.position.set(x, y + h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    room.add(mesh);
    props.push({ min: { x: x - w / 2, y, z: z - d / 2 }, max: { x: x + w / 2, y: y + h, z: z + d / 2 } });
    return mesh;
  };
  for (const x of [-13, 13]) {
    for (const z of [-4, -22, -40]) {
      addBox(0.8, height, 0.8, x, 0, z);
      const trim = new Mesh(new BoxGeometry(0.84, 0.04, 0.84), stripMaterial);
      trim.position.set(x, 2.3, z);
      room.add(trim);
    }
  }
  const crates = [
    [1.2, 1.2, 1.2, -7, -27],
    [1, 0.8, 1, -4.5, -28],
    [1.4, 1, 1.2, -1, -27.5],
    [1, 1.6, 1, 2.5, -28],
    [1.2, 0.9, 1.2, 5.5, -27],
    [0.9, 0.9, 0.9, 8, -28.5],
  ];
  for (const [w, h, d, x, z] of crates) addBox(w, h, d, x, 0, z, crateMaterial);
  addBox(24, 4.2, 0.5, 0, 0, -32);
  const sign = new Mesh(
    new PlaneGeometry(9, 2.2),
    new MeshBasicMaterial({ map: labelTexture('TRACKLOCK RANGE', ACCENT, '700 110px "Chakra Petch", system-ui, sans-serif', 1024, 256), transparent: true, toneMapped: false }),
  );
  sign.position.set(0, 2.4, -31.74);
  room.add(sign);

  // Distance markers painted on the floor along both sides of the lane.
  for (const metres of [5, 10, 15, 20, 25]) {
    for (const x of [-9.5, 9.5]) {
      const marker = new Mesh(
        new PlaneGeometry(2, 0.7),
        new MeshBasicMaterial({ map: labelTexture(`${metres} m`, '#4c6a7a'), transparent: true, opacity: 0.9, side: DoubleSide }),
      );
      marker.rotation.x = -Math.PI / 2;
      marker.position.set(x, 0.005, -metres);
      room.add(marker);
    }
  }

  // Player pad
  const pad = new Mesh(new CircleGeometry(0.9, 48), new MeshBasicMaterial({ color: '#1a3634' }));
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = 0.006;
  room.add(pad);
  const ring = new Mesh(new CircleGeometry(0.95, 48), new MeshBasicMaterial({ color: ACCENT }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.004;
  room.add(ring);

  scene.add(room);

  // Lighting: soft sky/ground fill plus one shadow-casting key light over the lane.
  scene.add(new HemisphereLight('#b8c8ff', '#141a22', 0.9));
  const key = new DirectionalLight('#fff2df', 1.7);
  key.position.set(-9, 16, 2);
  key.target.position.set(0, 0, -15);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -18;
  key.shadow.camera.right = 18;
  key.shadow.camera.top = 22;
  key.shadow.camera.bottom = -22;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 60;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.03;
  scene.add(key, key.target);

  return { room, props, keyLight: key };
}

/** Target meshes: a glossy orb and the humanoid bot, both with an outline, plus a contact shadow. */
export function buildTargets(scene) {
  const sphereMaterial = new MeshPhysicalMaterial({ roughness: 0.28, metalness: 0.05, clearcoat: 0.8, clearcoatRoughness: 0.2 });
  const sphere = new Mesh(new SphereGeometry(1, 48, 24), sphereMaterial);
  sphere.castShadow = true;
  const sphereOutline = new Mesh(new SphereGeometry(1, 48, 24), new MeshBasicMaterial({ side: BackSide, toneMapped: false }));
  sphereOutline.scale.setScalar(1.06);
  sphere.add(sphereOutline);

  const bot = buildBot();

  const shadowCanvas = makeCanvas(128);
  const g = shadowCanvas.getContext('2d');
  const gradient = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(0,0,0,0.85)');
  gradient.addColorStop(0.6, 'rgba(0,0,0,0.3)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gradient;
  g.fillRect(0, 0, 128, 128);
  const shadowTexture = new CanvasTexture(shadowCanvas);
  shadowTexture.colorSpace = SRGBColorSpace;
  const shadowMaterial = new MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false });
  const shadow = new Mesh(new CircleGeometry(1, 32), shadowMaterial);
  shadow.rotation.x = -Math.PI / 2;
  shadow.renderOrder = 1;

  scene.add(sphere, bot.group, shadow);

  return {
    sphere,
    bot,
    shadow,
    shadowMaterial,
    setColor(hex) {
      const base = new Color(hex);
      sphereMaterial.color.copy(base);
      sphereMaterial.emissive.copy(base);
      sphereOutline.material.color.copy(base).lerp(new Color('#ffffff'), 0.25);
      bot.setColor(hex);
    },
    setGlow(amount) {
      sphereMaterial.emissiveIntensity = 0.15 + amount * 0.9;
      bot.setGlow(amount);
    },
  };
}

/** Heading markers for the sensitivity check room. */
export function buildHeadingMarkers(scene) {
  const group = new Group();
  const distance = 14;
  const pillarMaterial = new MeshBasicMaterial({ color: ACCENT, toneMapped: false });
  const minorMaterial = new MeshBasicMaterial({ color: '#4b5b70' });
  for (let deg = 0; deg < 360; deg += 45) {
    const major = deg % 90 === 0;
    const rad = (deg * Math.PI) / 180;
    const height = major ? 5 : 3;
    const pillar = new Mesh(new BoxGeometry(0.12, height, 0.12), major ? pillarMaterial : minorMaterial);
    const x = Math.sin(rad) * distance;
    const z = -Math.cos(rad) * distance;
    pillar.position.set(x, height / 2, z);
    const label = new Sprite(new SpriteMaterial({ map: labelTexture(`${deg}°`, major ? ACCENT : '#8a9bb0', '700 84px system-ui, sans-serif', 256, 128), depthWrite: false, toneMapped: false }));
    label.scale.set(2.4, 1.2, 1);
    label.position.set(x, height + 0.9, z);
    group.add(pillar, label);
  }
  group.visible = false;
  scene.add(group);
  return group;
}
