// Transient shot effects: tracers, sparks on the target, impact marks on the
// room and a muzzle light. Everything is pooled, so firing allocates nothing.

import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  Color,
  Mesh,
  MeshBasicMaterial,
  PointLight,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
} from 'three';

const TRACER_LIFE = 0.07;
const SPARK_LIFE = 0.16;
const IMPACT_LIFE = 3;
const IMPACT_FADE = 0.6;

function radialTexture(stops) {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  const gradient = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  g.fillStyle = gradient;
  g.fillRect(0, 0, size, size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function pool(count, make) {
  const items = Array.from({ length: count }, () => ({ life: 0, object: make() }));
  let next = 0;
  return {
    items,
    /** Reuse the oldest slot when the pool is full. */
    take() {
      const item = items[next];
      next = (next + 1) % items.length;
      return item;
    },
  };
}

export function createEffects(scene) {
  const sparkTexture = radialTexture([
    [0, 'rgba(255,255,255,1)'],
    [0.35, 'rgba(255,255,255,0.8)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  const impactTexture = radialTexture([
    [0, 'rgba(6,8,12,0.95)'],
    [0.55, 'rgba(6,8,12,0.85)'],
    [1, 'rgba(6,8,12,0)'],
  ]);

  const tracers = pool(10, () => {
    const mesh = new Mesh(
      new BoxGeometry(1, 1, 1),
      new MeshBasicMaterial({ color: '#ffd9a6', transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    mesh.visible = false;
    scene.add(mesh);
    return mesh;
  });
  const sparks = pool(16, () => {
    const sprite = new Sprite(new SpriteMaterial({ map: sparkTexture, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
    sprite.visible = false;
    scene.add(sprite);
    return sprite;
  });
  const impacts = pool(48, () => {
    const sprite = new Sprite(new SpriteMaterial({ map: impactTexture, transparent: true, depthWrite: false }));
    sprite.visible = false;
    scene.add(sprite);
    return sprite;
  });

  const light = new PointLight('#ffc27a', 0, 7, 2);
  light.visible = false;
  scene.add(light);
  let lightEnergy = 0;

  const from = new Vector3();
  const to = new Vector3();
  const sparkColor = new Color();
  let enabled = true;

  return {
    setEnabled(value) {
      enabled = value;
    },
    /**
     * @param {{from: Vector3, to: {x,y,z}, hitTarget: boolean, zone: string|null, normal: {x,y,z}|null, color: string}} shot
     */
    shot(shot) {
      if (!enabled) return;
      from.copy(shot.from);
      to.set(shot.to.x, shot.to.y, shot.to.z);

      const tracer = tracers.take();
      tracer.life = TRACER_LIFE;
      const length = from.distanceTo(to);
      tracer.object.position.copy(from).lerp(to, 0.5);
      tracer.object.lookAt(to);
      tracer.object.scale.set(0.008, 0.008, Math.max(0.1, length - 0.3));
      tracer.object.visible = true;

      if (shot.hitTarget) {
        const spark = sparks.take();
        spark.life = SPARK_LIFE;
        spark.object.position.copy(to);
        sparkColor.set(shot.color).lerp(new Color('#ffffff'), shot.zone === 'head' ? 0.7 : 0.35);
        spark.object.material.color.copy(sparkColor);
        spark.object.material.rotation = Math.random() * Math.PI;
        spark.object.scale.setScalar(shot.zone === 'head' ? 0.5 : 0.36);
        spark.object.visible = true;
      } else if (shot.normal) {
        const impact = impacts.take();
        impact.life = IMPACT_LIFE;
        impact.object.position.copy(to).addScaledVector(new Vector3(shot.normal.x, shot.normal.y, shot.normal.z), 0.015);
        impact.object.scale.setScalar(0.09 + Math.random() * 0.03);
        impact.object.material.rotation = Math.random() * Math.PI;
        impact.object.material.opacity = 0.9;
        impact.object.visible = true;
      }

      light.position.copy(from);
      light.visible = true;
      lightEnergy = 1;
    },
    update(dt) {
      for (const item of tracers.items) {
        if (!item.object.visible) continue;
        item.life -= dt;
        if (item.life <= 0) item.object.visible = false;
        else item.object.material.opacity = Math.min(1, item.life / TRACER_LIFE + 0.2);
      }
      for (const item of sparks.items) {
        if (!item.object.visible) continue;
        item.life -= dt;
        if (item.life <= 0) {
          item.object.visible = false;
          continue;
        }
        const age = 1 - item.life / SPARK_LIFE;
        item.object.material.opacity = 1 - age;
        item.object.scale.multiplyScalar(1 + dt * 9);
      }
      for (const item of impacts.items) {
        if (!item.object.visible) continue;
        item.life -= dt;
        if (item.life <= 0) item.object.visible = false;
        else if (item.life < IMPACT_FADE) item.object.material.opacity = (0.9 * item.life) / IMPACT_FADE;
      }
      if (light.visible) {
        lightEnergy *= Math.exp(-dt * 45);
        light.intensity = lightEnergy * 18;
        if (lightEnergy < 0.02) light.visible = false;
      }
    },
    clear() {
      for (const p of [tracers, sparks, impacts]) for (const item of p.items) item.object.visible = false;
      light.visible = false;
    },
  };
}
