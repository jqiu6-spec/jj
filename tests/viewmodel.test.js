import { describe, expect, it } from 'vitest';
import { Euler, PerspectiveCamera, Vector3 } from 'three';
import { barrelAim } from '../src/game/viewmodel.js';

describe('weapon alignment', () => {
  const gunAt = new Vector3(0.245, -0.235, -0.6);
  const height = 0.008;

  it('points the barrel through the crosshair point on the view axis', () => {
    for (const distance of [5, 15, 40]) {
      const { yaw, pitch } = barrelAim(gunAt, distance, height);
      const dir = new Vector3(0, 0, -1).applyEuler(new Euler(pitch, yaw, 0, 'YXZ'));
      const start = gunAt.clone().add(new Vector3(0, height, 0));
      // Follow the barrel until it reaches the target depth: it must be on the view axis.
      const t = (-distance - start.z) / dir.z;
      const hit = start.clone().addScaledVector(dir, t);
      expect(hit.x).toBeCloseTo(0, 9);
      expect(hit.y).toBeCloseTo(0, 9);
    }
  });

  it('lines up on screen for any field of view', () => {
    const { yaw, pitch } = barrelAim(gunAt, 15, height);
    const dir = new Vector3(0, 0, -1).applyEuler(new Euler(pitch, yaw, 0, 'YXZ'));
    const start = gunAt.clone().add(new Vector3(0, height, 0));
    for (const fov of [30, 50, 90]) {
      const camera = new PerspectiveCamera(fov, 16 / 9, 0.01, 100);
      camera.updateMatrixWorld();
      const a = start.clone().addScaledVector(dir, 0.3).project(camera);
      const b = start.clone().addScaledVector(dir, 0.7).project(camera);
      // Distance from the screen centre (0, 0) to the projected barrel line.
      const cross = Math.abs((b.x - a.x) * -a.y - (b.y - a.y) * -a.x) / Math.hypot(b.x - a.x, b.y - a.y);
      expect(cross).toBeLessThan(1e-6);
    }
  });

  it('turns the barrel in toward the centre from the lower right', () => {
    const { yaw, pitch } = barrelAim(gunAt, 15, height);
    expect(yaw).toBeGreaterThan(0); // positive yaw swings -z toward -x (left)
    expect(pitch).toBeGreaterThan(0); // and up toward the crosshair
    expect(yaw).toBeLessThan(0.05);
  });
});
