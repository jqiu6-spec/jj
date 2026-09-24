// First-person weapon view: renders the equipped gun on top of the world with
// its own camera, applies skins and stickers, and animates sway, recoil and
// muzzle flash. Also drives the turntable inspect view in the Weapon tab.
import * as THREE from 'three';
import { GUNS, buildGun } from './guns.js';
import {
  SKIN_KEYS, FINISHES, ZONE_FINISHES, skinCanvas, woodCanvas, stickerCanvas, STICKERS,
} from './skins.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

const FIXED = {
  metal: new THREE.MeshStandardMaterial({ color: 0x1c1f23, roughness: 0.42, metalness: 0.85 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x08090a, roughness: 0.85, metalness: 0.2 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x14314d, roughness: 0.06, metalness: 0.95 }),
  glow: new THREE.MeshBasicMaterial({ color: 0x5fd8ff }),
};

// Where each gun sits in first person, in the viewmodel camera's space.
// The receiver sits low and right; the muzzle ends just below-right of centre.
const PLAY_POSE = {
  m4a1s: { x: 0.13, y: -0.15, z: -0.34 },
  ak47: { x: 0.13, y: -0.14, z: -0.34 },
  xm7: { x: 0.13, y: -0.15, z: -0.33 },
  phantom: { x: 0.13, y: -0.152, z: -0.34 },
  awp: { x: 0.14, y: -0.18, z: -0.38 },
};

let woodTexture = null;
function wood() {
  if (!woodTexture) {
    woodTexture = new THREE.CanvasTexture(woodCanvas());
    woodTexture.colorSpace = THREE.SRGBColorSpace;
    woodTexture.wrapS = woodTexture.wrapT = THREE.RepeatWrapping;
    woodTexture.repeat.set(3, 3);
  }
  return woodTexture;
}

function flashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,248,220,1)');
  grd.addColorStop(0.25, 'rgba(255,196,90,0.85)');
  grd.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = grd;
  g.translate(64, 64);
  for (let i = 0; i < 5; i++) {
    g.rotate(TAU / 5);
    g.beginPath();
    g.moveTo(0, -6);
    g.lineTo(64, 0);
    g.lineTo(0, 6);
    g.fill();
  }
  g.beginPath();
  g.arc(0, 0, 26, 0, TAU);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function stickerMaterial(finish, map) {
  const base = { map, alphaTest: 0.4, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
  if (finish === 'holo') {
    return new THREE.MeshPhysicalMaterial({
      ...base, roughness: 0.18, metalness: 0.55, iridescence: 1, iridescenceIOR: 1.7, iridescenceThicknessRange: [180, 820],
    });
  }
  if (finish === 'gold') return new THREE.MeshStandardMaterial({ ...base, color: 0xffd98a, roughness: 0.22, metalness: 1 });
  if (finish === 'glossy') return new THREE.MeshPhysicalMaterial({ ...base, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06 });
  return new THREE.MeshStandardMaterial({ ...base, roughness: 0.85, metalness: 0 });
}

// One built gun with its skin materials and sticker decals.
class GunView {
  constructor(id, flashMap) {
    this.id = id;
    this.info = GUNS[id];
    this.model = buildGun(id, FIXED);
    this.paint = new THREE.MeshStandardMaterial({ vertexColors: true });
    this.furniture = new THREE.MeshStandardMaterial();
    this.accent = new THREE.MeshStandardMaterial();
    for (const m of this.model.zones.body) m.material = this.paint;
    this.stickers = new THREE.Group();
    this.model.group.add(this.stickers);
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flashMap, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    this.flash.visible = false;
    this.model.group.add(this.flash);
    this.sig = '';
    this.stickerSig = '';
  }

  apply(skin) {
    const m = this.model;
    if (m.suppressor) {
      m.suppressor.visible = skin.suppressor !== false;
      m.hider.visible = skin.suppressor === false;
    }
    const [mx, my] = m.muzzle(skin);
    this.flash.position.set(mx + 0.035, my, 0);
    this.suppressed = !!m.suppressor && skin.suppressor !== false;
    const sig = SKIN_KEYS.map((k) => skin[k]).join('|');
    if (sig !== this.sig) {
      this.sig = sig;
      this.applySkin(skin);
    }
    const ssig = JSON.stringify(skin.stickers || []);
    if (ssig !== this.stickerSig) {
      this.stickerSig = ssig;
      this.applyStickers(skin.stickers || []);
    }
  }

  applySkin(s) {
    if (this.texture) this.texture.dispose();
    const c = skinCanvas(s);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    const tiles = 4 * (s.scale || 1); // one tile is 25 cm at scale 1
    tex.repeat.set(tiles, tiles * (c.width / c.height));
    this.texture = tex;
    const f = FINISHES[s.finish] || FINISHES.satin;
    this.paint.map = tex;
    this.paint.roughness = Math.min(1, f.roughness + s.wear * 0.15);
    this.paint.metalness = f.metalness;
    this.paint.needsUpdate = true;

    const zone = (meshes, choice, mat) => {
      const z = ZONE_FINISHES[choice] || ZONE_FINISHES.black;
      if (choice === 'skin') {
        for (const m of meshes) m.material = this.paint;
        return;
      }
      mat.color.set(z.color);
      mat.roughness = z.roughness;
      mat.metalness = z.metalness;
      mat.map = z.wood ? wood() : null;
      mat.needsUpdate = true;
      for (const m of meshes) m.material = mat;
    };
    zone(this.model.zones.furniture, s.furniture || this.info.defaultFurniture, this.furniture);
    zone(this.model.zones.accent, s.accent || 'black', this.accent);

    // Fade runs rear to front through three colours along the painted body.
    const stops = [new THREE.Color(s.c1), new THREE.Color(s.c2), new THREE.Color(s.c3)];
    const [x0, x1] = this.model.fade;
    const tmp = new THREE.Color();
    const all = [...this.model.zones.body, ...this.model.zones.furniture, ...this.model.zones.accent];
    for (const mesh of all) {
      const p = mesh.geometry.attributes.position;
      const col = mesh.geometry.attributes.color;
      for (let i = 0; i < p.count; i++) {
        if (s.pattern === 'fade') {
          const t = Math.min(1, Math.max(0, (p.getX(i) - x0) / (x1 - x0)));
          if (t < 0.5) tmp.copy(stops[0]).lerp(stops[1], t * 2);
          else tmp.copy(stops[1]).lerp(stops[2], (t - 0.5) * 2);
          col.setXYZ(i, tmp.r, tmp.g, tmp.b);
        } else {
          col.setXYZ(i, 1, 1, 1);
        }
      }
      col.needsUpdate = true;
    }
  }

  applyStickers(list) {
    for (const m of [...this.stickers.children]) {
      this.stickers.remove(m);
      m.geometry.dispose();
      m.material.map.dispose();
      m.material.dispose();
    }
    this.model.slots.forEach((slot, i) => {
      const st = list[i];
      if (!st || !STICKERS[st.id]) return;
      const tex = new THREE.CanvasTexture(stickerCanvas(st));
      tex.colorSpace = THREE.SRGBColorSpace;
      const size = slot.size * (st.scale || 1);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), stickerMaterial(st.finish, tex));
      // Planes face -Z (the left side); roll about the surface normal.
      mesh.rotation.set(0, Math.PI, -(st.rot || 0) * DEG);
      mesh.position.set(slot.x + (st.dx || 0) * slot.size * 0.5, slot.y + (st.dy || 0) * slot.size * 0.5, slot.z - 0.0004);
      this.stickers.add(mesh);
    });
  }
}

// A small studio for metallic reflections: dark room with bright panels.
function studioEnvironment(renderer) {
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(
    new THREE.BoxGeometry(10, 6, 10),
    new THREE.MeshBasicMaterial({ color: 0x1b1f26, side: THREE.BackSide }),
  ));
  const panel = (w, h, x, y, z, k, color = 0xffffff) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }),
    );
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    scene.add(m);
  };
  panel(4, 1.2, 0, 2.9, 0, 5);
  panel(1.5, 3, -4.9, 0.5, 1, 2.5, 0xdde8ff);
  panel(1.5, 3, 4.9, 0.5, -1.5, 1.6, 0xffe6cc);
  panel(3, 1, 0, 0.2, -4.9, 1.2);
  // Behind the viewer, so faces turned toward the camera still catch light.
  panel(5, 2.2, 0, 1.2, 4.9, 2.2);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(scene, 0.04).texture;
  pmrem.dispose();
  return tex;
}

export class Viewmodel {
  constructor(renderer) {
    this.scene = new THREE.Scene();
    this.scene.environment = studioEnvironment(renderer);
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight(0xe6eeff, 0x2e333b, 0.8));
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(-1, 2, 1.4);
    const rim = new THREE.DirectionalLight(0xa9c8ff, 0.7);
    rim.position.set(1.5, 0.6, -2);
    this.scene.add(key, rim);

    this.hand = new THREE.Group(); // mirrors for left-handed
    this.rig = new THREE.Group(); // pose and animation
    this.rig.rotation.order = 'YZX'; // roll about the barrel, then pitch, then yaw
    this.hand.add(this.rig);
    this.scene.add(this.hand);
    this.flashMap = flashTexture();
    this.guns = {};
    this.current = null;

    this.t = 0;
    this.kick = 0;
    this.flashT = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.fireAcc = 0;
    this.inspectYaw = -0.3;
    this.inspectPitch = 0.06;
    this.inspectAt = { x: 0.3, y: 0 };
    this.fov = 60;
  }

  // Equip gun `id` wearing `skin` (pattern, zones, stickers, suppressor).
  setGun(id, skin) {
    if (!this.guns[id]) this.guns[id] = new GunView(id, this.flashMap);
    const gv = this.guns[id];
    if (this.current !== gv) {
      if (this.current) this.rig.remove(this.current.model.group);
      this.rig.add(gv.model.group);
      this.current = gv;
    }
    gv.apply(skin);
  }

  get suppressed() {
    return this.current ? this.current.suppressed : false;
  }

  applyView(w) {
    this.hand.scale.x = w.hand === 'left' ? -1 : 1;
    this.fov = w.fov;
  }

  setAspect(a) {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  // Look delta in radians; the gun lags behind the view a little.
  addSway(dx, dy) {
    this.swayX = Math.max(-0.06, Math.min(0.06, this.swayX + dx * 0.5));
    this.swayY = Math.max(-0.05, Math.min(0.05, this.swayY + dy * 0.5));
  }

  shot(heavy = false) {
    this.kick = Math.min(heavy ? 3 : 1.4, this.kick + (heavy ? 3 : 1));
    this.flashT = 0.045;
    if (this.current) this.current.flash.material.rotation = Math.random() * TAU;
  }

  // Held fire at `interval` seconds per round. Returns rounds fired now.
  autoFire(dt, interval) {
    this.fireAcc += dt;
    let n = 0;
    while (this.fireAcc >= interval) {
      this.fireAcc -= interval;
      this.shot();
      n++;
    }
    return n;
  }

  resetFire(interval) {
    this.fireAcc = interval; // the first round goes out on the next frame
  }

  inspectDrag(dx, dy) {
    this.inspectYaw += dx * 0.01;
    this.inspectPitch = Math.max(-0.6, Math.min(0.6, this.inspectPitch + dy * 0.006));
  }

  // mode: 'play' (first person) or 'inspect' (turntable in the menu).
  update(dt, mode) {
    this.t += dt;
    this.kick *= Math.exp(-dt * 14);
    this.swayX *= Math.exp(-dt * 7);
    this.swayY *= Math.exp(-dt * 7);
    this.flashT -= dt;
    const gv = this.current;
    if (!gv) return;
    const rig = this.rig;
    const gun = gv.model.group;
    const { rear, front } = gv.model;
    if (mode === 'inspect') {
      this.camera.fov = 32;
      this.camera.updateProjectionMatrix();
      const dist = (front - rear) * 2.4;
      const halfH = Math.tan((this.camera.fov * Math.PI) / 360) * dist;
      gun.position.set(-(rear + front) / 2, -0.02, 0);
      rig.position.set(this.inspectAt.x * halfH * this.camera.aspect, this.inspectAt.y * halfH, -dist);
      // Yaw of pi shows the left side with the muzzle pointing left.
      rig.rotation.set(0.1 * Math.sin(this.t * 0.7), Math.PI + this.inspectYaw + 0.22 * Math.sin(this.t * 0.4), this.inspectPitch);
      gv.flash.visible = false;
      return;
    }
    this.camera.fov = this.fov || 60;
    this.camera.updateProjectionMatrix();
    const P = PLAY_POSE[gv.id];
    const bob = Math.sin(this.t * 1.7) * 0.0018;
    gun.position.set(0, 0, 0);
    rig.position.set(
      P.x - this.swayX * 0.25,
      P.y + bob + this.swayY * 0.2 - this.kick * 0.004,
      P.z + this.kick * 0.022,
    );
    rig.rotation.set(-0.03 + this.swayX * 0.4, Math.PI / 2 + 0.035 + this.swayX, 0.012 - this.swayY + this.kick * 0.03);
    gv.flash.visible = this.flashT > 0;
    const big = gv.info.sniper ? 0.2 : 0.11;
    const s = gv.suppressed ? 0.035 : big;
    gv.flash.scale.set(s, s, s);
    gv.flash.material.opacity = gv.suppressed ? 0.45 : 0.95;
  }

  render(renderer) {
    renderer.render(this.scene, this.camera);
  }
}
