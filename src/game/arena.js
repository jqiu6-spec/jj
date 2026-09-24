import {
  BoxGeometry,
  CanvasTexture,
  CapsuleGeometry,
  CircleGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
} from 'three';
import { BOT_SHAPE } from './hit.js';

export const ROOM_HALF = 40;
export const ROOM_HEIGHT = 20;
const TILE = 4; // metres per grid texture tile

function makeCanvas(width, height = width) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function gridTexture({ base, minor, major }, repeatX, repeatY, anisotropy) {
  const size = 256;
  const canvas = makeCanvas(size);
  const g = canvas.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  g.fillStyle = minor;
  for (let i = 1; i < 4; i++) {
    const p = (i * size) / 4;
    g.fillRect(p - 1, 0, 2, size);
    g.fillRect(0, p - 1, size, 2);
  }
  g.fillStyle = major;
  g.fillRect(0, 0, 3, size);
  g.fillRect(size - 3, 0, 3, size);
  g.fillRect(0, 0, size, 3);
  g.fillRect(0, size - 3, size, 3);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = anisotropy;
  return texture;
}

function blobTexture() {
  const size = 128;
  const canvas = makeCanvas(size);
  const g = canvas.getContext('2d');
  const gradient = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(0,0,0,0.9)');
  gradient.addColorStop(0.6, 'rgba(0,0,0,0.35)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gradient;
  g.fillRect(0, 0, size, size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function labelSprite(text, color) {
  const canvas = makeCanvas(256, 128);
  const g = canvas.getContext('2d');
  g.font = '700 72px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.fillText(text, 128, 64);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const sprite = new Sprite(new SpriteMaterial({ map: texture, depthWrite: false }));
  sprite.scale.set(2.4, 1.2, 1);
  return sprite;
}

/** The static room: floor, walls, lights. */
export function buildRoom(scene, anisotropy) {
  const room = new Group();
  const span = ROOM_HALF * 2;

  const floor = new Mesh(
    new PlaneGeometry(span, span),
    new MeshLambertMaterial({
      map: gridTexture({ base: '#1a2029', minor: '#232b36', major: '#2e3947' }, span / TILE, span / TILE, anisotropy),
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  room.add(floor);

  const wallMaterial = new MeshLambertMaterial({
    map: gridTexture({ base: '#202733', minor: '#29313e', major: '#354152' }, span / TILE, ROOM_HEIGHT / TILE, anisotropy),
  });
  const wallGeometry = new PlaneGeometry(span, ROOM_HEIGHT);
  for (let i = 0; i < 4; i++) {
    const wall = new Mesh(wallGeometry, wallMaterial);
    const angle = (i * Math.PI) / 2;
    wall.position.set(Math.sin(angle) * -ROOM_HALF, ROOM_HEIGHT / 2, Math.cos(angle) * -ROOM_HALF);
    wall.rotation.y = angle;
    room.add(wall);
  }

  const ceiling = new Mesh(new PlaneGeometry(span, span), new MeshBasicMaterial({ color: '#10141a' }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = ROOM_HEIGHT;
  room.add(ceiling);

  // Thin glowing strip along the base of each wall.
  const stripMaterial = new MeshBasicMaterial({ color: '#1f8f7c' });
  for (let i = 0; i < 4; i++) {
    const strip = new Mesh(new BoxGeometry(span, 0.08, 0.08), stripMaterial);
    const angle = (i * Math.PI) / 2;
    strip.position.set(Math.sin(angle) * -(ROOM_HALF - 0.05), 0.04, Math.cos(angle) * -(ROOM_HALF - 0.05));
    strip.rotation.y = angle;
    room.add(strip);
  }

  // Player pad, visible when looking down.
  const pad = new Mesh(new CircleGeometry(0.9, 48), new MeshBasicMaterial({ color: '#1c3a37' }));
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = 0.01;
  room.add(pad);

  scene.add(room);
  scene.add(new HemisphereLight('#c9dcff', '#1a1f26', 1.4));
  const sun = new DirectionalLight('#ffffff', 1.8);
  sun.position.set(8, 20, 10);
  scene.add(sun);
  return room;
}

/** Target meshes: an orb and a humanoid bot, plus a soft contact shadow. */
export function buildTargets(scene) {
  const sphereMaterial = new MeshStandardMaterial({ roughness: 0.32, metalness: 0.05 });
  const sphere = new Mesh(new SphereGeometry(1, 48, 24), sphereMaterial);

  const s = BOT_SHAPE;
  const bodyMaterial = new MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 });
  const headMaterial = new MeshStandardMaterial({ roughness: 0.35, metalness: 0.05 });
  const bot = new Group();
  const body = new Mesh(new CapsuleGeometry(s.bodyRadius, s.bodyTop - s.bodyBottom, 8, 24), bodyMaterial);
  body.position.y = (s.bodyTop + s.bodyBottom) / 2;
  const head = new Mesh(new SphereGeometry(s.headRadius, 32, 16), headMaterial);
  head.position.y = s.headHeight;
  bot.add(body, head);

  const shadowMaterial = new MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false });
  const shadow = new Mesh(new CircleGeometry(1, 32), shadowMaterial);
  shadow.rotation.x = -Math.PI / 2;
  shadow.renderOrder = 1;

  scene.add(sphere, bot, shadow);

  const materials = [sphereMaterial, bodyMaterial, headMaterial];
  return {
    sphere,
    bot,
    shadow,
    shadowMaterial,
    setColor(hex) {
      const base = new Color(hex);
      sphereMaterial.color.copy(base);
      sphereMaterial.emissive.copy(base);
      bodyMaterial.color.copy(base).multiplyScalar(0.8);
      bodyMaterial.emissive.copy(base);
      headMaterial.color.copy(base).lerp(new Color('#ffffff'), 0.25);
      headMaterial.emissive.copy(base);
    },
    setGlow(amount) {
      for (const material of materials) material.emissiveIntensity = 0.12 + amount * 0.85;
    },
  };
}

/** Heading markers for the sensitivity check room. */
export function buildHeadingMarkers(scene) {
  const group = new Group();
  const distance = 16;
  const pillarMaterial = new MeshBasicMaterial({ color: '#36e2c4' });
  const minorMaterial = new MeshBasicMaterial({ color: '#4b5b70' });
  for (let deg = 0; deg < 360; deg += 45) {
    const major = deg % 90 === 0;
    const rad = (deg * Math.PI) / 180;
    const height = major ? 5 : 3;
    const pillar = new Mesh(new BoxGeometry(0.12, height, 0.12), major ? pillarMaterial : minorMaterial);
    const x = Math.sin(rad) * distance;
    const z = -Math.cos(rad) * distance;
    pillar.position.set(x, height / 2, z);
    const label = labelSprite(`${deg}°`, major ? '#36e2c4' : '#8a9bb0');
    label.position.set(x, height + 0.9, z);
    group.add(pillar, label);
  }
  group.visible = false;
  scene.add(group);
  return group;
}
