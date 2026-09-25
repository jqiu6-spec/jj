// First-person weapon view: renders the equipped gun on top of the world with
// its own camera, applies skins and stickers, and animates sway, recoil and
// muzzle flash. Also drives the turntable inspect view in the Weapon tab.
import * as THREE from '../vendor/three.module.min.js';
import { GUNS, buildGun } from './guns.js';
import { MODEL_INFO, loadDetailedGun } from './models.js';
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

// Where each gun sits in first person, in the viewmodel camera's space: the
// receiver low and right, the muzzle ending just below-right of the centre.
const PLAY_POSE = {
  m4a1s: { x: 0.13, y: -0.15, z: -0.34 },
  ak47: { x: 0.13, y: -0.14, z: -0.34 },
  xm7: { x: 0.13, y: -0.15, z: -0.33 },
  phantom: { x: 0.13, y: -0.152, z: -0.34 },
  awp: { x: 0.17, y: -0.21, z: -0.5 },
};

// The detailed models are real-size and shaped differently from the built-in
// ones, so each has its own pose.
export const DETAILED_POSE = {
  m4a1s: { x: 0.2, y: -0.18, z: -0.5 },
  ak47: { x: 0.18, y: -0.16, z: -0.48 },
  xm7: { x: 0.2, y: -0.18, z: -0.5 },
  phantom: { x: 0.2, y: -0.18, z: -0.5 },
  awp: { x: 0.2, y: -0.21, z: -0.6 },
};

// Every gun is held level and aimed so its bore crosses the line of sight
// this far ahead (metres): on screen the barrel points straight at the
// crosshair, and shots continue the barrel's line. A pose may set `aim`.
const CONVERGE = 4;

const _aimE = new THREE.Euler(0, 0, 0, 'YZX');
const _aimO = new THREE.Vector3();
const _aimD = new THREE.Vector3();
// Yaw and pitch that send the bore line (gun-local y = boreY, z = 0) from a
// gun placed at `pos` through the point `dist` ahead of the camera.
function aimAt(pos, boreY, dist) {
  let yaw = Math.PI / 2;
  let pitch = 0;
  for (let i = 0; i < 4; i++) {
    _aimE.set(0, yaw, pitch, 'YZX');
    _aimO.set(0, boreY, 0).applyEuler(_aimE).add(pos);
    _aimD.set(0, 0, -dist).sub(_aimO).normalize();
    pitch = Math.asin(_aimD.y);
    yaw = Math.atan2(-_aimD.z, _aimD.x);
  }
  return { yaw, pitch };
}

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
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
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

const FLASH_PLAIN = new THREE.Color('#ffc46a');

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

// One gun with its skin materials, sticker decals and fire-effect glow. It
// starts on the built-in model and moves to the detailed mesh once loaded.
class GunView {
  constructor(id, flashMap) {
    this.id = id;
    this.info = GUNS[id];
    this.root = new THREE.Group();
    this.simple = buildGun(id, FIXED);
    this.detailed = null;
    this.loading = null;
    this.wantDetailed = false;
    this.onModel = null;
    this.stickers = new THREE.Group();
    this.root.add(this.stickers);
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flashMap, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    this.flash.visible = false;
    this.root.add(this.flash);
    this.paints = new Map(); // original material (or null) -> skin paint
    this.finishMats = new Map(); // finish + original material -> solid finish
    this.inUse = new Set();
    this.fxColor = new THREE.Color('#ffffff');
    this.glowBase = 0;
    this.glowPulse = 0;
    this.suppressed = false;
    this.skin = null;
    this.setModel(this.simple);
  }

  setModel(model) {
    if (this.model) this.root.remove(this.model.group);
    this.model = model;
    this.root.add(model.group);
    this.sig = '';
    this.zoneSig = '';
    this.stickerSig = '';
    if (this.skin) this.apply(this.skin);
  }

  // Switch between the detailed mesh (loading it the first time) and the
  // built-in model.
  useDetailed(on) {
    this.wantDetailed = on && !!MODEL_INFO[this.id];
    if (!this.wantDetailed) {
      if (this.model !== this.simple) this.setModel(this.simple);
      return;
    }
    if (this.detailed) {
      if (this.model !== this.detailed) this.setModel(this.detailed);
      return;
    }
    if (!this.loading) {
      this.loading = loadDetailedGun(this.id, FIXED).then((m) => {
        this.detailed = m;
        if (this.wantDetailed) {
          this.setModel(m);
          if (this.onModel) this.onModel(this);
        }
      }).catch((e) => {
        this.failed = String(e && e.message ? e.message : e);
        console.warn(`Trackline: using the simple ${this.info.name} model (${this.failed})`);
        if (this.onModel) this.onModel(this);
      });
    }
  }

  get zoneList() {
    return this.model.zoneList || this.info.zones;
  }

  apply(skin) {
    this.skin = skin;
    const m = this.model;
    if (m.suppressor) {
      m.suppressor.visible = skin.suppressor !== false;
      if (m.hider) m.hider.visible = skin.suppressor === false;
    }
    const [mx, my] = m.muzzle(skin);
    this.muzzle = { x: mx, y: my };
    this.flash.position.set(mx + 0.035, my, 0);
    this.suppressed = !!m.suppressor && skin.suppressor !== false;
    const sig = SKIN_KEYS.map((k) => skin[k]).join('|');
    const zsig = JSON.stringify(skin.zones || {});
    if (sig !== this.sig) {
      this.sig = sig;
      this.applySkin(skin);
    }
    if (zsig !== this.zoneSig || this.pattern !== skin.pattern) {
      this.zoneSig = zsig;
      this.pattern = skin.pattern;
      this.assign(skin);
    }
    const ssig = JSON.stringify(skin.stickers || []) + (m.suppressor ? String(skin.suppressor !== false) : '');
    if (ssig !== this.stickerSig) {
      this.stickerSig = ssig;
      this.applyStickers(skin.stickers || []);
    }
    const fx = skin.fx || { type: 'none' };
    this.fxType = fx.type || 'none';
    this.fxColor.set(fx.color || '#ffffff');
    this.glowBase = fx.glow && this.fxType !== 'none' ? 0.12 : 0;
    this.flash.material.color.copy(this.fxType === 'none' ? FLASH_PLAIN : this.fxColor);
  }

  // The skin paint for a part. Detailed parts keep their own normal map so
  // the paint follows every machined edge and screw.
  paintFor(orig) {
    const key = orig || null;
    let p = this.paints.get(key);
    if (!p) {
      p = new THREE.MeshStandardMaterial({ vertexColors: true });
      p.userData.paint = true;
      if (orig) {
        p.side = THREE.DoubleSide;
        if (orig.normalMap) {
          p.normalMap = orig.normalMap;
          p.normalScale.copy(orig.normalScale);
        }
      }
      this.paints.set(key, p);
      if (this.skin) this.paintSetup(p, this.skin);
    }
    return p;
  }

  paintSetup(p, s) {
    const f = FINISHES[s.finish] || FINISHES.satin;
    p.map = this.texture || null;
    p.roughness = Math.min(1, f.roughness + s.wear * 0.15);
    p.metalness = f.metalness;
    p.needsUpdate = true;
  }

  finishFor(choice, orig) {
    const key = `${choice}|${orig ? orig.uuid : ''}`;
    let mat = this.finishMats.get(key);
    if (!mat) {
      const z = ZONE_FINISHES[choice];
      mat = new THREE.MeshStandardMaterial({ color: z.color, roughness: z.roughness, metalness: z.metalness, map: z.wood ? wood() : null });
      if (orig) {
        mat.side = THREE.DoubleSide;
        if (orig.normalMap) {
          mat.normalMap = orig.normalMap;
          mat.normalScale.copy(orig.normalScale);
        }
      }
      this.finishMats.set(key, mat);
    }
    return mat;
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
    for (const p of this.paints.values()) this.paintSetup(p, s);

    // Fade runs through three colours along the painted body, rear to front
    // unless reversed. Other patterns keep the vertex colour white.
    const stops = [new THREE.Color(s.c1), new THREE.Color(s.c2), new THREE.Color(s.c3)];
    const [x0, x1] = this.model.fade;
    const tmp = new THREE.Color();
    for (const zone of Object.values(this.model.zones)) {
      for (const mesh of zone) {
        const p = mesh.geometry.attributes.position;
        const col = mesh.geometry.attributes.color;
        for (let i = 0; i < p.count; i++) {
          if (s.pattern === 'fade') {
            let t = Math.min(1, Math.max(0, (p.getX(i) - x0) / (x1 - x0)));
            if (s.fadeReverse) t = 1 - t;
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
  }

  // Every painted part gets the skin, a solid finish, or (on detailed models)
  // its factory textures. 'body' always follows the pattern.
  assign(s) {
    const zones = s.zones || {};
    const original = s.pattern === 'original';
    this.inUse.clear();
    for (const [zone, meshes] of Object.entries(this.model.zones)) {
      const choice = zone === 'body' ? 'skin' : (zones[zone] || 'skin');
      for (const mesh of meshes) {
        const orig = mesh.userData.orig;
        let mat;
        if (choice === 'factory' || (choice === 'skin' && original)) {
          mat = orig || (choice === 'factory' ? this.finishFor('black', null) : this.paintFor(null));
        } else if (choice === 'skin' || !ZONE_FINISHES[choice]) {
          mat = this.paintFor(orig);
        } else {
          mat = this.finishFor(choice, orig);
        }
        mesh.material = mat;
        if (mat.userData.paint) this.inUse.add(mat);
      }
    }
  }

  applyStickers(list) {
    for (const m of [...this.stickers.children]) {
      this.stickers.remove(m);
      m.geometry.dispose();
      if (!m.userData.shared) {
        m.material.map.dispose();
        m.material.dispose();
      }
    }
    const detailed = !!this.model.decal;
    this.model.slots.forEach((slot, i) => {
      const st = list[i];
      if (!st || !STICKERS[st.id]) return;
      const tex = new THREE.CanvasTexture(stickerCanvas(st));
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = stickerMaterial(st.finish, tex);
      const size = slot.size * (st.scale || 1);
      const x = slot.x + (st.dx || 0) * slot.size * 0.5;
      const y = slot.y + (st.dy || 0) * slot.size * 0.5;
      if (detailed) {
        // Wrapped onto the mesh around the slot.
        this.model.decal(x, y, size, (st.rot || 0) * DEG).forEach((geo, k) => {
          const mesh = new THREE.Mesh(geo, mat);
          mesh.userData.decal = true;
          mesh.userData.shared = k > 0;
          this.stickers.add(mesh);
        });
        return;
      }
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
      // Planes face -Z (the left side); roll about the surface normal.
      mesh.rotation.set(0, Math.PI, -(st.rot || 0) * DEG);
      mesh.position.set(x, y, slot.z - 0.0004);
      this.stickers.add(mesh);
    });
  }

  // Emissive glow from the fire effect on the skin paint (not on solid or
  // factory parts): a faint base plus a pulse per shot.
  setGlow(dt) {
    this.glowPulse *= Math.exp(-dt * 9);
    const k = this.glowBase + this.glowPulse;
    for (const m of this.inUse) {
      if (!m.emissive) continue;
      if (k > 0.001) {
        m.emissive.copy(this.fxColor);
        m.emissiveIntensity = k;
      } else if (m.emissiveIntensity !== 0) {
        m.emissive.setRGB(0, 0, 0);
        m.emissiveIntensity = 0;
      }
    }
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

const _m = new THREE.Vector3();

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
    this.mode = 'play';
    this.detailed = true;
    this.onModel = null; // called with the gun id when a detailed model arrives
  }

  // Equip gun `id` wearing `skin` (pattern, zones, stickers, fx, suppressor).
  setGun(id, skin) {
    if (!this.guns[id]) {
      const gv = new GunView(id, this.flashMap);
      gv.onModel = () => { if (this.onModel) this.onModel(id); };
      this.guns[id] = gv;
    }
    const gv = this.guns[id];
    gv.useDetailed(this.detailed);
    if (this.current !== gv) {
      if (this.current) this.rig.remove(this.current.root);
      this.rig.add(gv.root);
      this.current = gv;
    }
    gv.apply(skin);
  }

  // Parts of gun `id` that take a finish, for the skin editor.
  zonesFor(id) {
    const gv = this.guns[id];
    return gv ? gv.zoneList : GUNS[id].zones;
  }

  isDetailed(id) {
    const gv = this.guns[id];
    return !!gv && !!gv.model.detailed;
  }

  get suppressed() {
    return this.current ? this.current.suppressed : false;
  }

  applyView(w) {
    this.hand.scale.x = w.hand === 'left' ? -1 : 1;
    this.fov = w.fov;
    this.detailed = w.models !== 'simple';
    for (const gv of Object.values(this.guns)) gv.useDetailed(this.detailed);
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
    if (this.current) {
      this.current.flash.material.rotation = Math.random() * TAU;
      this.current.glowPulse = Math.min(1, this.current.glowPulse + 0.5);
    }
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

  // Where the muzzle is drawn: its screen position in NDC and its distance in
  // front of the viewmodel camera, so shots can start right at the gun.
  muzzleView() {
    const gv = this.current;
    if (!gv || !gv.muzzle) return null;
    gv.root.updateWorldMatrix(true, false);
    _m.set(gv.muzzle.x, gv.muzzle.y, 0);
    gv.root.localToWorld(_m);
    const depth = -_m.z;
    _m.project(this.camera);
    return { x: _m.x, y: _m.y, depth, fov: this.camera.fov };
  }

  // mode: 'play' (first person) or 'inspect' (turntable in the menu).
  update(dt, mode) {
    this.mode = mode;
    this.t += dt;
    this.kick *= Math.exp(-dt * 14);
    this.swayX *= Math.exp(-dt * 7);
    this.swayY *= Math.exp(-dt * 7);
    this.flashT -= dt;
    const gv = this.current;
    if (!gv) return;
    gv.setGlow(dt);
    const rig = this.rig;
    const gun = gv.root;
    const { rear, front } = gv.model;
    gv.flash.visible = this.flashT > 0;
    const big = gv.info.sniper ? 0.2 : 0.11;
    const s = gv.suppressed ? 0.035 : big;
    gv.flash.scale.set(s, s, s);
    gv.flash.material.opacity = gv.suppressed ? 0.45 : 0.95;
    if (mode === 'inspect') {
      this.camera.fov = 32;
      this.camera.updateProjectionMatrix();
      const dist = (front - rear) * 2.4;
      const halfH = Math.tan((this.camera.fov * Math.PI) / 360) * dist;
      gun.position.set(-(rear + front) / 2, -0.02, 0);
      rig.position.set(this.inspectAt.x * halfH * this.camera.aspect, this.inspectAt.y * halfH, -dist + this.kick * 0.03);
      // Yaw of pi shows the left side with the muzzle pointing left.
      rig.rotation.set(0.1 * Math.sin(this.t * 0.7), Math.PI + this.inspectYaw + 0.22 * Math.sin(this.t * 0.4), this.inspectPitch + this.kick * 0.02);
      return;
    }
    this.camera.fov = this.fov || 60;
    this.camera.updateProjectionMatrix();
    const P = (gv.model.detailed && DETAILED_POSE[gv.id]) || PLAY_POSE[gv.id];
    const bob = Math.sin(this.t * 1.7) * 0.0018;
    gun.position.set(0, 0, 0);
    // Aim from the resting pose; sway, bob and recoil move it off briefly.
    _m.set(P.x, P.y, P.z);
    const aim = aimAt(_m, gv.muzzle ? gv.muzzle.y : 0, P.aim || CONVERGE);
    rig.position.set(
      P.x - this.swayX * 0.25,
      P.y + bob + this.swayY * 0.2 - this.kick * 0.004,
      P.z + this.kick * 0.022,
    );
    rig.rotation.set(
      this.swayX * 0.4,
      aim.yaw + this.swayX,
      aim.pitch - this.swayY + this.kick * 0.03,
    );
  }

  render(renderer) {
    renderer.render(this.scene, this.camera);
  }
}
