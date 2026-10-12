import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

/*
 * Shared render setup: a soft product-photography studio (gradient dome plus
 * softboxes baked into a PMREM environment), one shadow-casting key light,
 * a shadow-catcher floor, and camera framing helpers.
 */

export function createRenderer({ canvas, width, height, preserve = false, pixelRatio = 1 }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: preserve });
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);
  return renderer;
}

function studioEnvironment(renderer) {
  const env = new THREE.Scene();
  const dome = new THREE.SphereGeometry(100, 64, 32);
  const p = dome.attributes.position;
  const col = [];
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / 100;
    // grey studio walls, bright ceiling, mid-grey sweep below
    const v = t >= 0 ? 0.36 + 0.55 * Math.pow(t, 0.8) : 0.36 - 0.12 * Math.pow(-t, 0.7);
    col.push(v * 1.0, v * 0.975, v * 0.94);
  }
  dome.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  env.add(new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));

  // Softboxes fall off toward their edges, so flat metal faces pick up a gradient
  // instead of a uniform white patch.
  const box = (w, h, k, x, y, z) => {
    const geo = new THREE.PlaneGeometry(w, h, 12, 12);
    const uv = geo.attributes.uv, c = [];
    for (let i = 0; i < uv.count; i++) {
      const du = Math.abs(uv.getX(i) - 0.5) * 2, dv = Math.abs(uv.getY(i) - 0.5) * 2;
      const f = Math.pow(Math.max(0, 1 - Math.max(du * du, dv * dv)), 1.4);
      c.push(k * f, k * 0.98 * f, k * 0.95 * f);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  box(70, 40, 9.0, -55, 45, 55);   // key softbox, front left
  box(55, 34, 5.5, 50, 38, 70);    // front right, catches the band faces
  box(16, 90, 7.0, 75, 15, 25);    // tall strip, right
  box(100, 30, 4.5, 0, 85, -10);   // overhead
  box(60, 22, 3.0, 15, 30, -80);   // rim, behind
  box(50, 8, 2.2, -20, 4, 85);     // low front bounce
  // low cards: the vertical band faces see the studio slightly below the horizon
  box(46, 24, 2.4, 52, -26, 62);
  box(14, 60, 3.2, 74, -15, -42);
  box(14, 60, 3.0, -80, -15, -28);
  box(22, 40, 1.6, -62, -22, 52);
  // dark flags give the satin metal its contrast streaks
  const flag = (w, h, x, y, z) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0x151412, side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  flag(14, 60, 20, -10, 90);
  flag(12, 70, -80, 0, -20);
  flag(18, 60, 70, -15, -50);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(env, 0.025);
  pmrem.dispose();
  return rt.texture;
}

export function createStudio(renderer) {
  const scene = new THREE.Scene();
  scene.environment = studioEnvironment(renderer);

  const key = new THREE.DirectionalLight(0xfff4e8, 1.7);
  key.position.set(-110, 420, 140);
  key.target.position.set(20, 0, 25);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -170, right: 170, top: 170, bottom: -170, near: 10, far: 900 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.25;
  scene.add(key, key.target);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xcfc6b8, 0.25));

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(4000, 4000),
    new THREE.ShadowMaterial({ color: 0x2b2118, opacity: 0.16 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  return { scene, key, floor };
}

export function boxCorners(box) {
  const { min, max } = box;
  const out = [];
  for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
    out.push(new THREE.Vector3(x, y, z));
  }
  return out;
}

// Frame a set of world points in a perspective camera looking from azimuth/elevation
// (degrees; azimuth 0 = from the front, negative = from the left).
export function framePerspective(camera, points, { az, el, margin = 1.1, offsetY = 0 }) {
  const a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el);
  const dir = new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
  const target = new THREE.Vector3();
  points.forEach((p) => target.add(p));
  target.divideScalar(points.length);
  let dist = 600;
  const right = new THREE.Vector3(), up = new THREE.Vector3(), v = new THREE.Vector3();
  for (let it = 0; it < 8; it++) {
    camera.position.copy(target).addScaledVector(dir, dist);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of points) {
      v.copy(p).project(camera);
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x);
      y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    }
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist;
    const halfW = halfH * camera.aspect;
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    up.setFromMatrixColumn(camera.matrixWorld, 1);
    target.addScaledVector(right, ((x0 + x1) / 2) * halfW);
    target.addScaledVector(up, ((y0 + y1) / 2 - offsetY) * halfH);
    const ext = Math.max((x1 - x0) / 2, (y1 - y0) / 2);
    dist *= ext * margin;
  }
  camera.position.copy(target).addScaledVector(dir, dist);
  camera.lookAt(target);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return { target, dist };
}

// Top-down orthographic plan view: front (+Z) at the bottom of the frame.
export function framePlan(camera, points, aspect, pad = 10) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
    z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
  }
  x0 -= pad; x1 += pad; z0 -= pad; z1 += pad;
  let w = x1 - x0, h = z1 - z0;
  if (w / h > aspect) h = w / aspect; else w = h * aspect;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  camera.left = -w / 2; camera.right = w / 2; camera.top = h / 2; camera.bottom = -h / 2;
  camera.near = 1; camera.far = 2000;
  camera.up.set(0, 0, -1);
  camera.position.set(cx, 800, cz);
  camera.lookAt(cx, 0, cz);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
}

// Screen-space-width line (WebGL lines are always 1 px). Call setResolution on resize.
export function fatLine(points, { color = 0x6f675e, width = 2, dashed = false, dash = 5, gap = 4, depthTest = true, opacity = 1 } = {}) {
  const geo = new LineGeometry();
  geo.setPositions(points.flatMap((p) => [p.x, p.y, p.z]));
  const mat = new LineMaterial({
    color, linewidth: width, dashed, dashSize: dash, gapSize: gap, depthTest,
    transparent: opacity < 1 || !depthTest, opacity, toneMapped: false,
  });
  const line = new Line2(geo, mat);
  if (dashed) line.computeLineDistances();
  line.setResolution = (w, h) => mat.resolution.set(w, h);
  line.setPoints = (pts) => {
    line.geometry.dispose();
    const g = new LineGeometry();
    g.setPositions(pts.flatMap((p) => [p.x, p.y, p.z]));
    line.geometry = g;
    if (dashed) line.computeLineDistances();
  };
  return line;
}
