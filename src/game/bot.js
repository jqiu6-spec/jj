// The humanoid training bot. Every part is built from BOT_SHAPE, the same
// numbers hit.js uses for the hitboxes, so the silhouette you see is exactly
// what your shots can hit.

import {
  BackSide,
  BoxGeometry,
  CapsuleGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
} from 'three';
import { BOT_SHAPE, botFrame, REST_POSE } from './hit.js';

const OUTLINE_SCALE = 1.07;

export function buildBot() {
  const s = BOT_SHAPE;
  const bodyMaterial = new MeshStandardMaterial({ roughness: 0.55, metalness: 0.15 });
  const headMaterial = new MeshStandardMaterial({ roughness: 0.4, metalness: 0.1 });
  const trimMaterial = new MeshStandardMaterial({ color: '#10141a', roughness: 0.5, metalness: 0.3 });
  const visorMaterial = new MeshStandardMaterial({ color: '#0b0f14', emissive: '#ffffff', emissiveIntensity: 0.5, roughness: 0.2 });
  const outlineMaterial = new MeshBasicMaterial({ side: BackSide, toneMapped: false });

  const group = new Group();
  const parts = [];

  const part = (geometry, material, x, y, z, parent = group) => {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    // Inverted hull outline, like the enemy highlight in Valorant.
    const outline = new Mesh(geometry, outlineMaterial);
    outline.scale.setScalar(OUTLINE_SCALE);
    mesh.add(outline);
    parent.add(mesh);
    parts.push(mesh);
    return mesh;
  };

  // Head with a visor strip on the front (local +z faces the player).
  part(new SphereGeometry(s.headRadius, 32, 20), headMaterial, 0, s.headY, 0);
  const visor = new Mesh(new BoxGeometry(s.headRadius * 1.3, 0.045, 0.03), visorMaterial);
  visor.position.set(0, s.headY + 0.015, s.headRadius - 0.02);
  group.add(visor);

  // Torso capsule, exactly the body hitbox, with a darker chest plate inside it.
  const torsoLength = s.bodyTop - s.bodyBottom;
  part(new CapsuleGeometry(s.bodyRadius, torsoLength, 6, 24), bodyMaterial, 0, (s.bodyTop + s.bodyBottom) / 2, 0);
  const plate = new Mesh(new BoxGeometry(0.3, 0.26, 0.1), trimMaterial);
  plate.position.set(0, s.bodyTop - 0.04, s.bodyRadius - 0.06);
  group.add(plate);

  // Arms pivot at the shoulders; legs pivot at the hips. Their rotation.z
  // is the same angle hit.js uses for the capsule end points.
  const limb = (radius, length, pivotX, pivotY, angle) => {
    const pivot = new Group();
    pivot.position.set(pivotX, pivotY, 0);
    pivot.rotation.z = angle;
    part(new CapsuleGeometry(radius, length, 4, 16), bodyMaterial, 0, -length / 2, 0, pivot);
    group.add(pivot);
    return pivot;
  };
  limb(s.armRadius, s.armLength, -s.shoulderX, s.shoulderY, -s.armAngle);
  limb(s.armRadius, s.armLength, s.shoulderX, s.shoulderY, s.armAngle);
  const legs = [
    limb(s.legRadius, s.legLength, -s.hipSpread, s.hipY, -REST_POSE.legs[0]),
    limb(s.legRadius, s.legLength, s.hipSpread, s.hipY, REST_POSE.legs[1]),
  ];

  const base = new Color();
  return {
    group,
    setColor(hex) {
      base.set(hex);
      bodyMaterial.color.copy(base).multiplyScalar(0.55);
      bodyMaterial.emissive.copy(base);
      headMaterial.color.copy(base).lerp(new Color('#ffffff'), 0.2);
      headMaterial.emissive.copy(base);
      outlineMaterial.color.copy(base).lerp(new Color('#ffffff'), 0.25);
    },
    setGlow(amount) {
      bodyMaterial.emissiveIntensity = 0.12 + amount * 0.6;
      headMaterial.emissiveIntensity = 0.15 + amount * 0.8;
    },
    /** Place the mesh so it matches botHitboxes(target). */
    applyPose(target) {
      const { position: p, scale } = target;
      const pose = target.pose ?? REST_POSE;
      group.position.set(p.x, p.y + pose.bob * scale, p.z);
      group.rotation.y = botFrame(p).yaw;
      group.scale.setScalar(scale);
      legs[0].rotation.z = -pose.legs[0];
      legs[1].rotation.z = pose.legs[1];
    },
  };
}
