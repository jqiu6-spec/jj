// The range mannequin. Every part is generated from the skeleton in hit.js:
// the torso is a surface of revolution whose profile is the exact union of
// the torso hit capsules, limbs are capsules of the hitbox radii around the
// same joints, and joints are the hitbox spheres. Detail comes from
// high segment counts and painted panel textures with bump maps, never from
// geometry that pokes outside a hit volume.

import {
  BackSide,
  CanvasTexture,
  CapsuleGeometry,
  Color,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Quaternion,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from 'three';
import { BOT_SHAPE, botFrame, botSkeleton, REST_POSE } from './hit.js';

const OUTLINE = 0.012; // metres of outline around each part
const RADIAL = 48;
const CAP_SEGMENTS = 16;

// ------------------------------------------------------------------ textures

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function toTexture(canvas, { srgb = true, repeat = [1, 1] } = {}) {
  const texture = new CanvasTexture(canvas);
  if (srgb) texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(repeat[0], repeat[1]);
  texture.anisotropy = 8;
  return texture;
}

/** Panel seams and vents for the torso. u runs around the body (front at 0.25), v from feet to neck. */
function torsoMaps() {
  const w = 1024;
  const h = 512;
  const albedo = makeCanvas(w, h);
  const bump = makeCanvas(w, h);
  const a = albedo.getContext('2d');
  const b = bump.getContext('2d');
  a.fillStyle = '#ffffff';
  a.fillRect(0, 0, w, h);
  b.fillStyle = '#808080';
  b.fillRect(0, 0, w, h);

  const seam = (x1, y1, x2, y2, width = 6) => {
    for (const [ctx, style] of [
      [a, 'rgba(0,0,0,0.55)'],
      [b, '#303030'],
    ]) {
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  };
  const plate = (x, y, pw, ph, shade) => {
    a.fillStyle = shade;
    a.fillRect(x, y, pw, ph);
    b.fillStyle = '#9a9a9a';
    b.fillRect(x, y, pw, ph);
    seam(x, y, x + pw, y, 4);
    seam(x, y + ph, x + pw, y + ph, 4);
    seam(x, y, x, y + ph, 4);
    seam(x + pw, y, x + pw, y + ph, 4);
  };

  // Dark belt and collar bands (they are raised in the shell profile), plus seams.
  const band = (v0, v1) => {
    a.fillStyle = '#12161c';
    a.fillRect(0, h * (1 - v1), w, h * (v1 - v0));
    b.fillStyle = '#6a6a6a';
    b.fillRect(0, h * (1 - v1), w, h * (v1 - v0));
  };
  band(0.31, 0.37); // belt: y 1.045–1.075 of a shell spanning 0.805–1.55
  band(0.86, 0.91); // collar
  seam(0, h * 0.42, w, h * 0.42, 5);
  seam(0, h * 0.86, w, h * 0.86, 5);
  // Front chest plates (front centre at u = 0.25, back at 0.75).
  const front = w * 0.25;
  plate(front - 150, h * 0.6, 140, 150, 'rgba(0,0,0,0.12)');
  plate(front + 10, h * 0.6, 140, 150, 'rgba(0,0,0,0.12)');
  // Abdominal segments
  for (let i = 0; i < 3; i++) plate(front - 70, h * 0.44 + i * 22, 140, 16, 'rgba(0,0,0,0.18)');
  // Back plate and spine seam
  const back = w * 0.75;
  plate(back - 120, h * 0.55, 240, 190, 'rgba(0,0,0,0.1)');
  seam(back, h * 0.44, back, h * 0.86, 6);
  // Side vents
  for (const x of [w * 0.5, w * 1.0, 0]) {
    for (let i = 0; i < 4; i++) seam(x - 30, h * 0.66 + i * 14, x + 30, h * 0.66 + i * 14, 4);
  }
  // Emblem on the chest
  a.fillStyle = 'rgba(0,0,0,0.35)';
  a.beginPath();
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2;
    a.lineTo(front + Math.cos(ang) * 34, h * 0.68 + Math.sin(ang) * 34);
  }
  a.closePath();
  a.fill();
  a.fillStyle = 'rgba(255,255,255,0.6)';
  a.beginPath();
  a.arc(front, h * 0.68, 14, 0, Math.PI * 2);
  a.fill();

  return { map: toTexture(albedo), bumpMap: toTexture(bump, { srgb: false }) };
}

/** Ridged bands for limbs (u around, v along the capsule). */
function limbMaps() {
  const w = 256;
  const h = 512;
  const albedo = makeCanvas(w, h);
  const bump = makeCanvas(w, h);
  const a = albedo.getContext('2d');
  const b = bump.getContext('2d');
  a.fillStyle = '#ffffff';
  a.fillRect(0, 0, w, h);
  b.fillStyle = '#808080';
  b.fillRect(0, 0, w, h);
  for (const y of [h * 0.3, h * 0.5, h * 0.7]) {
    a.fillStyle = 'rgba(0,0,0,0.4)';
    a.fillRect(0, y - 3, w, 6);
    b.fillStyle = '#2a2a2a';
    b.fillRect(0, y - 3, w, 6);
  }
  a.fillStyle = 'rgba(0,0,0,0.14)';
  a.fillRect(0, h * 0.32, w, h * 0.16);
  b.fillStyle = '#9c9c9c';
  b.fillRect(0, h * 0.32, w, h * 0.16);
  // A long seam down one side of the limb
  a.fillStyle = 'rgba(0,0,0,0.45)';
  a.fillRect(w * 0.5 - 2, h * 0.08, 4, h * 0.84);
  b.fillStyle = '#303030';
  b.fillRect(w * 0.5 - 2, h * 0.08, 4, h * 0.84);
  return { map: toTexture(albedo), bumpMap: toTexture(bump, { srgb: false }) };
}

/** Helmet: dark visor band across the face with a glowing slit, seams over the crown. */
function headMaps() {
  const w = 1024;
  const h = 512;
  const albedo = makeCanvas(w, h);
  const emissive = makeCanvas(w, h);
  const bump = makeCanvas(w, h);
  const a = albedo.getContext('2d');
  const e = emissive.getContext('2d');
  const b = bump.getContext('2d');
  a.fillStyle = '#ffffff';
  a.fillRect(0, 0, w, h);
  e.fillStyle = '#000000';
  e.fillRect(0, 0, w, h);
  b.fillStyle = '#808080';
  b.fillRect(0, 0, w, h);
  const front = w * 0.25;
  // Visor band, wrapping a third of the way around.
  a.fillStyle = '#0c1016';
  a.fillRect(front - 180, h * 0.4, 360, 78);
  b.fillStyle = '#5a5a5a';
  b.fillRect(front - 180, h * 0.4, 360, 78);
  // Glowing slit
  e.fillStyle = '#ffffff';
  e.fillRect(front - 130, h * 0.43, 260, 12);
  a.fillStyle = '#ffffff';
  a.fillRect(front - 130, h * 0.43, 260, 12);
  // Crown seam and cheek plates
  a.strokeStyle = 'rgba(0,0,0,0.45)';
  a.lineWidth = 6;
  b.strokeStyle = '#303030';
  b.lineWidth = 6;
  for (const ctx of [a, b]) {
    ctx.beginPath();
    ctx.moveTo(front, 0);
    ctx.lineTo(front, h * 0.38);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, h * 0.3);
    ctx.lineTo(w, h * 0.3);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, h * 0.62);
    ctx.lineTo(w, h * 0.62);
    ctx.stroke();
  }
  return { map: toTexture(albedo), emissiveMap: toTexture(emissive), bumpMap: toTexture(bump, { srgb: false }) };
}

// ------------------------------------------------------------------ geometry

/** Radius of a vertical capsule at height y (0 outside it). */
function capsuleRadiusAt(capsule, y) {
  const lo = Math.min(capsule.a.y, capsule.b.y);
  const hi = Math.max(capsule.a.y, capsule.b.y);
  const r = capsule.radius;
  if (y >= lo && y <= hi) return r;
  const d = y < lo ? lo - y : y - hi;
  return d >= r ? 0 : Math.sqrt(r * r - d * d);
}

/** Lathe profile equal to the union of the torso capsules, so the mesh is exactly the hit volume. */
function torsoGeometry(capsules) {
  const lo = Math.min(...capsules.map((c) => Math.min(c.a.y, c.b.y) - c.radius));
  const hi = Math.max(...capsules.map((c) => Math.max(c.a.y, c.b.y) + c.radius));
  const points = [];
  const steps = 96;
  for (let i = 0; i <= steps; i++) {
    const y = lo + ((hi - lo) * i) / steps;
    const r = Math.max(...capsules.map((c) => capsuleRadiusAt(c, y)));
    points.push(new Vector2(Math.max(r, 0.0005), y));
  }
  const geometry = new LatheGeometry(points, RADIAL);
  // Lathe UVs run v from the first point (bottom) to the last (top); rotate so the front faces +z.
  geometry.rotateY(Math.PI / 2);
  return geometry;
}

// ------------------------------------------------------------------- the bot

export function buildBot() {
  const s = BOT_SHAPE;
  const torso = torsoMaps();
  const limb = limbMaps();
  const head = headMaps();

  const shellMaterial = new MeshPhysicalMaterial({
    map: torso.map,
    bumpMap: torso.bumpMap,
    bumpScale: 0.6,
    roughness: 0.52,
    metalness: 0.2,
    clearcoat: 0.3,
    clearcoatRoughness: 0.4,
  });
  const limbMaterial = new MeshPhysicalMaterial({
    map: limb.map,
    bumpMap: limb.bumpMap,
    bumpScale: 0.4,
    roughness: 0.55,
    metalness: 0.2,
    clearcoat: 0.25,
    clearcoatRoughness: 0.45,
  });
  const headMaterial = new MeshPhysicalMaterial({
    map: head.map,
    bumpMap: head.bumpMap,
    bumpScale: 0.5,
    emissiveMap: head.emissiveMap,
    emissive: new Color('#ffffff'),
    emissiveIntensity: 1.2,
    roughness: 0.35,
    metalness: 0.2,
    clearcoat: 0.7,
    clearcoatRoughness: 0.2,
  });
  const jointMaterial = new MeshStandardMaterial({ color: '#1a1f27', roughness: 0.35, metalness: 0.85 });
  const outlineMaterial = new MeshBasicMaterial({ side: BackSide, toneMapped: false });

  const group = new Group();
  const skeleton = botSkeleton(REST_POSE);
  const prims = Object.fromEntries(skeleton.primitives.map((p) => [p.part, p]));
  const dynamic = [];

  const addOutline = (mesh, geometry, radius) => {
    const outline = new Mesh(geometry, outlineMaterial);
    outline.scale.setScalar(1 + OUTLINE / radius);
    mesh.add(outline);
  };

  const sphereMesh = (prim, material) => {
    const geometry = new SphereGeometry(prim.radius, RADIAL, 32);
    const mesh = new Mesh(geometry, material);
    mesh.position.set(prim.center.x, prim.center.y, prim.center.z);
    mesh.castShadow = true;
    addOutline(mesh, geometry, prim.radius);
    group.add(mesh);
    return mesh;
  };

  const capsuleMesh = (prim, material) => {
    const length = Math.hypot(prim.b.x - prim.a.x, prim.b.y - prim.a.y, prim.b.z - prim.a.z);
    const geometry = new CapsuleGeometry(prim.radius, length, CAP_SEGMENTS, RADIAL);
    const mesh = new Mesh(geometry, material);
    mesh.castShadow = true;
    addOutline(mesh, geometry, prim.radius);
    group.add(mesh);
    return mesh;
  };

  /** Place a capsule mesh between two joints (local space). */
  const up = new Vector3(0, 1, 0);
  const dir = new Vector3();
  const quaternion = new Quaternion();
  const placeCapsule = (mesh, a, b) => {
    mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    dir.set(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
    quaternion.setFromUnitVectors(up, dir);
    mesh.quaternion.copy(quaternion);
  };

  // Torso: one smooth shell for chest, waist and pelvis.
  const torsoGeo = torsoGeometry([prims.chest, prims.waist, prims.pelvis, prims.belt, prims.collar]);
  const torsoMesh = new Mesh(torsoGeo, shellMaterial);
  torsoMesh.castShadow = true;
  const torsoOutline = new Mesh(torsoGeo, outlineMaterial);
  // Scale the outline about the torso's centre so it stays an even shell.
  const torsoCentre = (prims.chest.b.y + prims.pelvis.a.y) / 2;
  torsoOutline.position.y = torsoCentre;
  torsoOutline.geometry = torsoGeo.clone().translate(0, -torsoCentre, 0);
  torsoOutline.scale.set(1 + OUTLINE / prims.chest.radius, 1 + OUTLINE / 0.45, 1 + OUTLINE / prims.chest.radius);
  torsoMesh.add(torsoOutline);
  group.add(torsoMesh);

  // Head and neck
  const headMesh = sphereMesh(prims.head, headMaterial);
  headMesh.rotation.y = 0; // texture front is at u = 0.25, which SphereGeometry maps to +z
  const neckMesh = capsuleMesh(prims.neck, jointMaterial);
  placeCapsule(neckMesh, prims.neck.a, prims.neck.b);

  // Limbs: joints are dark metal spheres, segments are shell capsules.
  for (const side of ['left', 'right']) {
    for (const joint of ['Shoulder', 'Elbow', 'Hip', 'Knee', 'Ankle']) {
      const prim = prims[`${side}${joint}`];
      const mesh = sphereMesh(prim, jointMaterial);
      dynamic.push({ part: prim.part, mesh, kind: 'sphere' });
    }
    for (const segment of ['UpperArm', 'Forearm', 'Hand', 'Thigh', 'Shin', 'Foot']) {
      const prim = prims[`${side}${segment}`];
      const mesh = capsuleMesh(prim, segment === 'Hand' || segment === 'Foot' ? jointMaterial : limbMaterial);
      placeCapsule(mesh, prim.a, prim.b);
      dynamic.push({ part: prim.part, mesh, kind: 'capsule' });
    }
  }

  const base = new Color();
  const white = new Color('#ffffff');
  return {
    group,
    setColor(hex) {
      base.set(hex);
      shellMaterial.color.copy(base).multiplyScalar(0.78);
      limbMaterial.color.copy(base).multiplyScalar(0.7);
      headMaterial.color.copy(base).multiplyScalar(0.85);
      headMaterial.emissive.copy(base).lerp(white, 0.6);
      shellMaterial.emissive.copy(base);
      limbMaterial.emissive.copy(base);
      outlineMaterial.color.copy(base).lerp(white, 0.12);
    },
    setGlow(amount) {
      shellMaterial.emissiveIntensity = 0.04 + amount * 0.45;
      limbMaterial.emissiveIntensity = 0.04 + amount * 0.45;
      headMaterial.emissiveIntensity = 1 + amount * 1.5;
    },
    /** Place the mesh so it matches botHitboxes(target) exactly. */
    applyPose(target) {
      const { position: p, scale } = target;
      const pose = target.pose ?? REST_POSE;
      group.position.set(p.x, p.y + pose.bob * scale, p.z);
      group.rotation.y = botFrame(p).yaw;
      group.scale.setScalar(scale);
      const current = Object.fromEntries(botSkeleton(pose).primitives.map((prim) => [prim.part, prim]));
      for (const { part, mesh, kind } of dynamic) {
        const prim = current[part];
        if (kind === 'sphere') mesh.position.set(prim.center.x, prim.center.y, prim.center.z);
        else placeCapsule(mesh, prim.a, prim.b);
      }
    },
  };
}
