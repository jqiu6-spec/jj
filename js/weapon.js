// First-person weapon view: renders the equipped gun on top of the world with
// its own camera, applies skins and stickers, and animates sway, recoil and
// muzzle flash. Also drives the turntable inspect view in the Weapon tab.
import * as THREE from '../vendor/three.module.min.js';
import { GUNS, buildGun } from './guns.js';
import { MODEL_INFO, loadDetailedGun, decals } from './models.js';
import { Effects } from './effects.js';
import { sampleKnife, knifeLength } from './knife.js';
import { AWP_BOLT_AT } from './audio.js';
import {
  SKIN_KEYS, FINISHES, ZONE_FINISHES, skinCanvas, woodCanvas, stickerCanvas, STICKERS, stickerRevision, championsWordmark,
  glowCanvas, ZONE_COLOR_DEFAULT,
} from './skins.js';

// Stickers are drawn at CS2 size: about as tall as the receiver's side.
const STICKER_SIZE = 2.0;

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
  vandal: { x: 0.13, y: -0.14, z: -0.34 },
  xm7: { x: 0.13, y: -0.15, z: -0.33 },
  phantom: { x: 0.13, y: -0.152, z: -0.34 },
  awp: { x: 0.17, y: -0.21, z: -0.5 },
};

// The detailed models are real-size and shaped differently from the built-in
// ones, so each has its own pose.
export const DETAILED_POSE = {
  m4a1s: { x: 0.2, y: -0.18, z: -0.5 },
  ak47: { x: 0.18, y: -0.16, z: -0.48 },
  vandal: { x: 0.18, y: -0.16, z: -0.48 },
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

// Soft grey puff for the smoke a sniper shot leaves at the muzzle.
function smokeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
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

// Clear plastic: see-through in the middle, denser toward the edges and
// wherever it catches a reflection, the way clear polymer looks. Paints and
// finishes share this shader hook; the CLEAR_PLASTIC define switches it on.
function plasticShader(shader) {
  shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
#ifdef CLEAR_PLASTIC
  float facing = clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0);
  float edge = pow(1.0 - facing, 2.5);
  vec3 shine = totalSpecular;
  #ifdef USE_CLEARCOAT
    shine += (clearcoatSpecularDirect + clearcoatSpecularIndirect) * material.clearcoat;
  #endif
  float gloss = dot(shine, vec3(0.299, 0.587, 0.114));
  gl_FragColor.a = clamp(gl_FragColor.a + edge * 0.5 + gloss * 0.8, 0.0, 1.0);
#endif`);
}

function physical(params) {
  const m = new THREE.MeshPhysicalMaterial(params);
  m.onBeforeCompile = plasticShader;
  return m;
}

// Turn a material into glossy clear plastic, or back to an opaque finish.
function setPlastic(mat, on) {
  if (on) {
    mat.defines = { ...(mat.defines || {}), CLEAR_PLASTIC: '' };
    mat.transparent = true;
    mat.opacity = 0.18;
    mat.depthWrite = false;
    mat.side = THREE.DoubleSide; // inside walls show through, back faces first
    mat.metalness = 0;
    mat.clearcoat = 1;
    mat.clearcoatRoughness = 0.02;
    mat.envMapIntensity = 1.8;
  } else {
    if (mat.defines) delete mat.defines.CLEAR_PLASTIC;
    mat.transparent = false;
    mat.opacity = 1;
    mat.depthWrite = true;
    mat.side = mat.userData.side;
    mat.clearcoat = 0;
    mat.envMapIntensity = 1;
  }
  mat.needsUpdate = true;
}

// One gun with its skin materials, sticker decals and fire-effect glow. It
// starts on the built-in model and moves to the detailed mesh once loaded.
class GunView {
  constructor(id, flashMap) {
    this.id = id;
    this.info = GUNS[id];
    this.root = new THREE.Group();
    this.simple = buildGun(id, FIXED);
    // Stickers wrap onto the simple model's surface too.
    this.simple.decal = (x, y, size, rot, side, aspect) => decals(this.simple.group, x, y, size, rot, side, aspect);
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
    this.glowTex = null; // the light bars' light (emissive map), or null
    this.lightsType = 'off';
    this.lightMats = new Set(); // parts in a neon or RGB finish
    this.lightT = 0;
    this.suppressed = false;
    this.skin = null;
    this.setModel(this.simple);
  }

  setModel(model) {
    this.modelVersion = (this.modelVersion || 0) + 1; // stickers reshape onto it
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
    const sig = SKIN_KEYS.map((k) => skin[k]).join('|') + JSON.stringify(skin.lights || null);
    const zsig = JSON.stringify(skin.zones || {}) + JSON.stringify(skin.zoneColors || {});
    if (sig !== this.sig) {
      this.sig = sig;
      this.applySkin(skin);
    }
    if (zsig !== this.zoneSig || this.pattern !== skin.pattern) {
      this.zoneSig = zsig;
      this.pattern = skin.pattern;
      this.assign(skin);
    }
    const ssig = JSON.stringify(skin.stickers || []) + (m.suppressor ? String(skin.suppressor !== false) : '') + stickerRevision()
      + (skin.pattern === 'champions' ? `|${skin.c1}${skin.c2}${skin.c3}` : '');
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
      p = physical({ vertexColors: true });
      p.userData.paint = true;
      p.userData.side = orig ? THREE.DoubleSide : THREE.FrontSide;
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
    // The light bars give off light (see setGlow).
    p.emissiveMap = this.glowTex;
    p.userData.lit = !!this.glowTex;
    setPlastic(p, !!f.clear);
    p.roughness = Math.min(1, f.roughness + s.wear * 0.15);
    p.metalness = f.metalness;
    p.needsUpdate = true;
  }

  // `zone` and `color` matter only for the custom and lit finishes, which
  // get a material per part so each can have its own colour.
  finishFor(choice, orig, zone = '', color = null) {
    const z = ZONE_FINISHES[choice];
    const own = z.custom || z.light;
    const key = `${choice}|${own ? zone : ''}|${orig ? orig.uuid : ''}`;
    let mat = this.finishMats.get(key);
    if (mat && own) this.colorFinish(mat, z, color || ZONE_COLOR_DEFAULT[choice]);
    if (!mat) {
      mat = physical({ color: z.color || '#ffffff', roughness: z.roughness, metalness: z.metalness, map: z.wood ? wood() : null });
      mat.userData.side = orig ? THREE.DoubleSide : THREE.FrontSide;
      mat.userData.tint = !!z.tint;
      if (z.clear) setPlastic(mat, true);
      if (z.tint && this.skin) mat.color.set(this.skin.c1);
      if (orig) {
        mat.side = THREE.DoubleSide;
        if (orig.normalMap) {
          mat.normalMap = orig.normalMap;
          mat.normalScale.copy(orig.normalScale);
        }
      }
      if (own) this.colorFinish(mat, z, color || ZONE_COLOR_DEFAULT[choice]);
      this.finishMats.set(key, mat);
    }
    return mat;
  }

  // A custom colour on a part; a neon part glows in it (and is dark
  // otherwise); RGB parts are coloured each frame in setGlow.
  colorFinish(mat, z, color) {
    mat.userData.light = z.light ? (z.rgb ? 'rgb' : 'neon') : null;
    if (z.rgb) {
      mat.color.set(z.color);
    } else if (z.light) {
      mat.color.set(color).multiplyScalar(0.25);
      mat.emissive.set(color);
      mat.emissiveIntensity = 1.3;
    } else {
      mat.color.set(color);
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
    if (this.glowTex) this.glowTex.dispose();
    this.glowTex = null;
    this.lightsType = (s.lights && s.lights.type) || 'off';
    const gc = glowCanvas(s);
    if (gc) {
      const gt = new THREE.CanvasTexture(gc);
      gt.colorSpace = THREE.SRGBColorSpace;
      gt.wrapS = gt.wrapT = THREE.RepeatWrapping;
      gt.anisotropy = 8;
      gt.repeat.copy(tex.repeat);
      this.glowTex = gt;
    }
    for (const p of this.paints.values()) this.paintSetup(p, s);
    for (const m of this.finishMats.values()) if (m.userData.tint) m.color.set(s.c1);

    // Fade runs through three colours along the painted body, rear to front
    // unless reversed. Other patterns keep the vertex colour white.
    const stops = [new THREE.Color(s.c1), new THREE.Color(s.c2), new THREE.Color(s.c3)];
    const [x0, x1] = this.model.fade;
    const alongY = this.model.fadeAxis === 'y'; // a knife fades tip to ring
    const tmp = new THREE.Color();
    for (const zone of Object.values(this.model.zones)) {
      for (const mesh of zone) {
        const p = mesh.geometry.attributes.position;
        const col = mesh.geometry.attributes.color;
        for (let i = 0; i < p.count; i++) {
          if (s.pattern === 'fade') {
            let t = Math.min(1, Math.max(0, ((alongY ? p.getY(i) : p.getX(i)) - x0) / (x1 - x0)));
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
    const colors = s.zoneColors || {};
    const original = s.pattern === 'original';
    this.inUse.clear();
    this.lightMats.clear();
    for (const [zone, meshes] of Object.entries(this.model.zones)) {
      // The barrel and other metal parts stay as they are unless chosen.
      const fallback = (this.info.defaultZones && this.info.defaultZones[zone]) || (zone === 'metal' ? 'factory' : 'skin');
      const choice = zone === 'body' ? 'skin' : (zones[zone] || fallback);
      for (const mesh of meshes) {
        const orig = mesh.userData.orig;
        let mat;
        if (choice === 'factory' || (choice === 'skin' && original)) {
          mat = orig || (choice === 'factory' ? this.finishFor('black', null) : this.paintFor(null));
        } else if (choice === 'skin' || !ZONE_FINISHES[choice]) {
          mat = this.paintFor(orig);
        } else {
          mat = this.finishFor(choice, orig, zone, colors[zone]);
        }
        mesh.material = mat;
        if (mat.userData.paint) this.inUse.add(mat);
        if (mat.userData.light) this.lightMats.add(mat);
      }
    }
  }

  // Stickers are cached per slot: moving one only reshapes that one against
  // the nearby surface, and its artwork is redrawn only when it changes.
  applyStickers(list) {
    const cache = this.stickerCache || (this.stickerCache = {});
    const supp = this.model.suppressor ? String(this.model.suppressor.visible) : '';
    const rev = stickerRevision();
    const entries = [];
    this.model.slots.forEach((slot, i) => {
      const st = list[i];
      if (!st || !STICKERS[st.id]) return;
      const size = slot.size * STICKER_SIZE * (st.scale || 1);
      // Where it sits: dragged onto the gun (`at`: x, y, side) or the slot.
      const [ax, ay, side] = st.at || [slot.x, slot.y, -1];
      const x = ax + (st.dx || 0) * size * 0.5;
      const y = ay + (st.dy || 0) * size * 0.5;
      const rot = (st.rot || 0) * DEG;
      entries.push({
        key: String(i),
        slot: i,
        look: JSON.stringify([st.id, st.color, st.text, st.finish, st.scrape, st.seed, rev]),
        makeMat: () => {
          const tex = new THREE.CanvasTexture(stickerCanvas(st));
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = 8;
          return stickerMaterial(st.finish, tex);
        },
        place: `${this.modelVersion}|${supp}|${x}|${y}|${size}|${rot}|${side}`,
        build: () => this.model.decal(x, y, size, rot, side),
      });
    });
    // The Champions 2021 skin's wordmark, on the receiver's side that faces
    // the player, under any sticker placed there.
    const logo = this.model.slots.find((sl) => /receiver/i.test(sl.name)) || this.model.slots[0];
    if (this.skin && this.skin.pattern === 'champions' && logo) {
      const skin = this.skin;
      entries.push({
        key: 'logo',
        slot: -1,
        look: `${skin.c1}${skin.c2}${skin.c3}`,
        makeMat: () => {
          const tex = new THREE.CanvasTexture(championsWordmark(skin));
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = 8;
          return new THREE.MeshStandardMaterial({
            map: tex, transparent: true, alphaTest: 0.35, roughness: 0.35, metalness: 0.6,
            polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
          });
        },
        place: `${this.modelVersion}|${supp}`,
        build: () => this.model.decal(logo.x, logo.y, logo.size * 1.3, 0, -1, 3),
      });
    }
    const clearMeshes = (c) => {
      for (const m of c.meshes) {
        this.stickers.remove(m);
        m.geometry.dispose();
      }
      c.meshes = [];
    };
    const keep = new Set(entries.map((e) => e.key));
    for (const [k, c] of Object.entries(cache)) {
      if (keep.has(k)) continue;
      clearMeshes(c);
      if (c.mat) { c.mat.map.dispose(); c.mat.dispose(); }
      delete cache[k];
    }
    for (const e of entries) {
      const c = cache[e.key] || (cache[e.key] = { meshes: [] });
      if (c.look !== e.look) {
        if (c.mat) { c.mat.map.dispose(); c.mat.dispose(); }
        c.mat = e.makeMat();
        c.look = e.look;
        c.place = null;
      }
      if (c.place !== e.place) {
        clearMeshes(c);
        for (const geo of e.build()) {
          const mesh = new THREE.Mesh(geo, c.mat);
          mesh.userData.decal = true;
          mesh.userData.slot = e.slot;
          this.stickers.add(mesh);
          c.meshes.push(mesh);
        }
        c.place = e.place;
      }
    }
  }

  // Emissive glow from the fire effect on the skin paint (not on solid or
  // factory parts): a faint base plus a pulse per shot.
  setGlow(dt) {
    this.glowPulse *= Math.exp(-dt * 9);
    this.lightT += dt;
    // RGB lights cycle through the rainbow, all together.
    const hue = (this.lightT * 0.15) % 1;
    const flare = 1 + this.glowPulse * 0.9; // lights flare with each shot
    for (const m of this.lightMats) {
      if (m.userData.light === 'rgb') m.emissive.setHSL(hue, 1, 0.5);
      m.emissiveIntensity = 1.3 * flare;
    }
    // Only a skin with its glow switched on lights up; shots never tint the
    // paint otherwise.
    const k = this.glowBase > 0 ? this.glowBase + this.glowPulse : 0;
    for (const m of this.inUse) {
      if (!m.emissive) continue;
      if (m.userData.lit) {
        // Light bars: the emissive map is the light (white for RGB,
        // coloured by the cycle here).
        if (this.lightsType === 'rgb') m.emissive.setHSL(hue, 1, 0.5);
        else m.emissive.setRGB(1, 1, 1);
        m.emissiveIntensity = 1.6 * flare;
      } else if (k > 0.001) {
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
const _rc = new THREE.Raycaster();
const _inv = new THREE.Matrix4();
const _kp = new THREE.Vector3();
const _kq = new THREE.Quaternion();
const _bq = new THREE.Quaternion();
const _inv4 = new THREE.Matrix4();
// Motion blur for the knife's spins: this many faint copies spread over the
// last frame's motion.
const BLUR_COPIES = 3;
const _up = new THREE.Vector3(0, 1, 0);
const _right = new THREE.Vector3(1, 0, 0);
const HOLSTER = 0.14; // seconds to lower the held weapon when switching
const easeOut = (u) => 1 - (1 - u) ** 3;
const easeInOut = (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);

// Gun animations, as offsets from the resting pose: `p` moves the gun
// (metres: x right, y up, z toward the viewer) and `r` turns it (radians:
// roll about the barrel, where negative turns its right side up to the
// view, then yaw, where positive swings the muzzle left, then pitch, where
// positive lifts it). `ease` is how a segment arrives at its keyframe.
const [BOLT_BACK, BOLT_HOME] = AWP_BOLT_AT;
const REST = { p: [0, 0, 0], r: [0, 0, 0] };
const GUN_ANIMS = {
  // Picking a rifle up, as in CS2: it swings up from low on the right,
  // turned to show its right side, and the charging handle is pulled back
  // and let go (with the clicks of the recorded draw) before it settles.
  draw: [
    { t: 0, p: [0.06, -0.22, 0.07], r: [-0.25, 0.3, -0.95] },
    { t: 0.25, p: [0.004, -0.016, 0.014], r: [-0.42, 0.06, 0.05], ease: 'out' },
    { t: 0.4, p: [0.01, -0.03, 0.05], r: [-0.55, 0.1, 0.01] },
    { t: 0.46, p: [0.002, -0.01, -0.006], r: [-0.38, 0.05, 0.08], ease: 'out' },
    { t: 0.85, ...REST },
  ],
  // The AWP: up the same way, then rolled over to check the bolt.
  drawSniper: [
    { t: 0, p: [0.06, -0.24, 0.07], r: [-0.15, 0.3, -0.95] },
    { t: 0.3, p: [0.004, -0.012, 0.012], r: [-0.05, 0.05, 0.05], ease: 'out' },
    { t: 0.44, p: [0.002, -0.02, 0.018], r: [0.26, 0.04, 0.02] },
    { t: 0.6, p: [0.002, -0.012, 0.01], r: [0.2, 0.03, 0.04] },
    { t: 0.68, p: [0, -0.006, 0.002], r: [0.06, 0.02, 0.06], ease: 'out' },
    { t: 1.0, ...REST },
  ],
  // The AWP's bolt worked after each shot, on the recorded bolt sounds:
  // rolled over and rocked back as the bolt goes up and back, level again
  // as it's pushed home.
  bolt: [
    { t: 0, ...REST },
    { t: BOLT_BACK - 0.14, ...REST },
    { t: BOLT_BACK, p: [0, -0.014, 0.022], r: [0.3, 0.02, 0.02], ease: 'out' },
    { t: BOLT_HOME - 0.06, p: [0, -0.012, 0.03], r: [0.32, 0.02, 0.015] },
    { t: BOLT_HOME, p: [0, -0.006, 0.004], r: [0.1, 0.01, 0.05], ease: 'out' },
    { t: BOLT_HOME + 0.3, ...REST },
  ],
};
const gunAnimLength = (name) => {
  const keys = GUN_ANIMS[name];
  return keys ? keys[keys.length - 1].t : 0;
};
const _ga = { p: [0, 0, 0], r: [0, 0, 0] };
// Offsets of animation `name` at `t` seconds; all zero when none is playing.
function sampleGunAnim(name, t) {
  const keys = GUN_ANIMS[name];
  if (!keys || t >= keys[keys.length - 1].t) {
    _ga.p.fill(0);
    _ga.r.fill(0);
    return _ga;
  }
  let i = 0;
  while (i < keys.length - 2 && t >= keys[i + 1].t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const v = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
  const u = b.ease === 'out' ? easeOut(v) : easeInOut(v);
  for (let k = 0; k < 3; k++) {
    _ga.p[k] = a.p[k] + (b.p[k] - a.p[k]) * u;
    _ga.r[k] = a.r[k] + (b.r[k] - a.r[k]) * u;
  }
  return _ga;
}

export class Viewmodel {
  constructor(renderer) {
    this.renderer = renderer;
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
    this.smokeMap = smokeTexture();
    this.puffs = [];
    this.heavyFlash = false;
    // Test shots in the Weapon tab fly from the turntable gun in this scene.
    this.fx = new Effects(this.scene);
    this.guns = {};
    this.current = null;

    this.t = 0;
    this.kick = 0;
    this.flashT = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.inspectYaw = -0.3;
    this.inspectPitch = 0.06;
    this.inspectAt = { x: 0.3, y: 0 };
    this.fov = 60;
    this.mode = 'play';
    this.detailed = true;
    this.onModel = null; // called with the gun id when a detailed model arrives
    this.gunAnim = null; // playing gun animation (a draw, the AWP's bolt), or null
    this.gunAnimT = 0;
    this.onDraw = null; // called with the weapon id as it is drawn
    this.drawnAt = -1; // this.t when the last draw started
    this.moving = 0; // 0..1, how fast the player is running (set by the game)
    this.stepPhase = 0;
    this.switching = null; // { id, skin, t } while the held weapon is lowered
    this.knifeAnim = null; // playing knife animation, or null for idle
    this.knifeT = 0;
    this.slashAlt = false;
  }

  // Change the held weapon in first person: lower the current one, then
  // draw the new one (a knife flips out around its ring, a gun comes up).
  equip(id, skin) {
    if (this.switching) {
      this.switching.id = id;
      this.switching.skin = skin;
      return;
    }
    if (this.current && this.current.id === id) {
      this.setGun(id, skin);
      return;
    }
    if (!this.current || this.mode !== 'play') {
      this.setGun(id, skin);
      this.startDraw();
      return;
    }
    this.switching = { id, skin, t: 0 };
  }

  // Draw the held weapon: a gun is picked up, a knife flipped out.
  startDraw() {
    const gv = this.current;
    const melee = !!gv && !!gv.info.melee;
    this.knifeAnim = melee ? 'draw' : null;
    this.knifeT = 0;
    this.gunAnim = melee ? null : gv && gv.info.sniper ? 'drawSniper' : 'draw';
    this.gunAnimT = 0;
    this.drawnAt = this.t;
    if (gv && this.onDraw) this.onDraw(gv.id);
  }

  // Pick up the held weapon at the start of a run, unless a switch is under
  // way or a draw started this frame.
  pickUp() {
    if (!this.switching && this.drawnAt !== this.t) this.startDraw();
  }

  get knifeOut() {
    return !!this.current && !!this.current.info.melee && !this.switching;
  }

  // A knife attack: 'slash' alternates forehand and backhand, 'stab' is the
  // heavy one. Returns false while another attack is still playing.
  knifeAttack(kind) {
    if (!this.knifeOut) return false;
    const busy = this.knifeAnim && this.knifeAnim !== 'inspect' && this.knifeT < knifeLength(this.knifeAnim) - 0.12;
    if (busy) return false;
    if (kind === 'stab') this.knifeAnim = 'stab';
    else {
      this.knifeAnim = this.slashAlt ? 'slash2' : 'slash';
      this.slashAlt = !this.slashAlt;
    }
    this.knifeT = 0;
    return true;
  }

  knifeInspect() {
    if (!this.knifeOut || (this.knifeAnim && this.knifeAnim !== 'draw' && this.knifeT < knifeLength(this.knifeAnim))) return false;
    this.knifeAnim = 'inspect';
    this.knifeT = 0;
    return true;
  }

  view(id) {
    if (!this.guns[id]) {
      const gv = new GunView(id, this.flashMap);
      gv.onModel = () => {
        this.warm(gv);
        if (this.onModel) this.onModel(id);
      };
      this.guns[id] = gv;
    }
    return this.guns[id];
  }

  // Load gun `id` ahead of time and get it ready to draw (shaders compiled,
  // textures on the GPU), so switching to it never stalls a run.
  preload(id, skin) {
    const gv = this.view(id);
    if (!gv.skin) gv.apply(skin);
    gv.useDetailed(this.detailed);
    this.warm(gv);
  }

  warm(gv) {
    const r = this.renderer;
    if (!r || !gv.skin) return;
    if (gv.info.melee) this.buildBlur(gv);
    try {
      r.compile(gv.root, this.camera, this.scene);
      gv.root.traverse((o) => {
        if (!o.isMesh) return;
        for (const m of [].concat(o.material)) {
          if (!m) continue;
          for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']) if (m[k]) r.initTexture(m[k]);
        }
      });
    } catch (e) { /* warming is only an optimisation */ }
  }

  // Equip gun `id` wearing `skin` (pattern, zones, stickers, fx, suppressor).
  setGun(id, skin) {
    const gv = this.view(id);
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
    this.swayOn = !!w.sway;
    if (!this.swayOn) {
      this.swayX = 0;
      this.swayY = 0;
    }
    this.hand.scale.x = w.hand === 'left' ? -1 : 1;
    this.fov = w.fov;
    this.detailed = w.models !== 'simple';
    for (const gv of Object.values(this.guns)) gv.useDetailed(this.detailed);
  }

  setAspect(a) {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  // Look delta in radians. Off by default, the gun is locked to the view;
  // with sway on it trails the view a little (gently, so small hand
  // movements don't shake it).
  addSway(dx, dy) {
    if (!this.swayOn) return;
    this.swayX = Math.max(-0.025, Math.min(0.025, this.swayX + dx * 0.2));
    this.swayY = Math.max(-0.02, Math.min(0.02, this.swayY + dy * 0.2));
  }

  // `heavy` is a sniper shot: a bigger, longer blast, a hard kick and smoke.
  shot(heavy = false) {
    this.kick = Math.min(heavy ? 3.4 : 1.4, this.kick + (heavy ? 3.4 : 1));
    // Seconds the flash stays up: two frames at 60 fps, five at 144.
    this.flashT = heavy ? 0.06 : 0.03;
    this.heavyFlash = heavy;
    const gv = this.current;
    if (!gv) return;
    // Shown on this frame, with the tracer, rather than on the next.
    this.showFlash(gv);
    gv.flash.material.rotation = Math.random() * TAU;
    gv.glowPulse = Math.min(1, gv.glowPulse + 0.5);
    if (heavy && gv.muzzle) {
      for (let i = 0; i < 5; i++) this.puff(gv, i);
    }
    if (heavy && gv.info.sniper) {
      this.gunAnim = 'bolt';
      this.gunAnimT = 0;
    }
  }

  puff(gv, i) {
    let p = this.puffs.find((x) => x.life <= 0);
    if (!p) {
      p = {
        sprite: new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeMap, color: 0xc4c8cf, transparent: true, depthWrite: false })),
        vel: new THREE.Vector3(),
        life: 0,
      };
      this.puffs.push(p);
    }
    if (p.sprite.parent !== gv.root) gv.root.add(p.sprite);
    p.sprite.visible = true;
    p.sprite.material.rotation = Math.random() * TAU;
    p.sprite.position.set(gv.muzzle.x + 0.02 + i * 0.015, gv.muzzle.y, 0);
    // Gun space: +X out of the muzzle, drifting up and spreading.
    p.vel.set(0.35 + Math.random() * 0.5, 0.05 + Math.random() * 0.12, (Math.random() - 0.5) * 0.2);
    p.max = 0.7 + Math.random() * 0.5;
    p.life = p.max;
    p.size = 0.04 + Math.random() * 0.03;
  }

  showFlash(gv) {
    gv.flash.visible = this.flashT > 0;
    const big = gv.info.sniper ? (this.heavyFlash ? 0.34 : 0.2) : 0.11;
    const s = gv.suppressed ? 0.035 : big;
    gv.flash.scale.set(s, s, s);
    gv.flash.material.opacity = gv.suppressed ? 0.45 : 1;
  }

  // Sticker slot under the pointer (NDC) on the turntable gun, or -1.
  pickSticker(ndc) {
    const gv = this.current;
    if (!gv) return -1;
    this.scene.updateMatrixWorld();
    _rc.setFromCamera(ndc, this.camera);
    const hit = _rc.intersectObjects(gv.stickers.children, false)[0];
    return hit ? hit.object.userData.slot : -1;
  }

  // The point on the gun's surface under the pointer, in gun space, and
  // which side it is on (-1 left, +1 right). Null off the gun.
  surfaceAt(ndc) {
    const gv = this.current;
    if (!gv) return null;
    this.scene.updateMatrixWorld();
    _rc.setFromCamera(ndc, this.camera);
    const meshes = [];
    gv.model.group.traverse((o) => {
      if (!o.isMesh) return;
      for (let a = o; a; a = a.parent) if (!a.visible) return;
      meshes.push(o);
    });
    const hit = _rc.intersectObjects(meshes, false)[0];
    if (!hit) return null;
    const p = gv.root.worldToLocal(hit.point.clone());
    const dir = _rc.ray.direction.clone().transformDirection(_inv.copy(gv.root.matrixWorld).invert());
    return { x: p.x, y: p.y, side: dir.z > 0 ? -1 : 1 };
  }

  // A test shot from the turntable gun's muzzle along its barrel, shown in
  // slow motion so the skin's effect can be seen in the Weapon tab.
  testShot(fx) {
    const gv = this.current;
    if (!gv || !gv.muzzle || this.mode !== 'inspect') return;
    this.fx.setStyle(fx.type, fx.color);
    // Built in gun space and carried by the gun, so the shot stays on the
    // barrel's line while the turntable moves and the gun recoils.
    if (this.fx.group.parent !== gv.root) gv.root.add(this.fx.group);
    const len = (gv.model.front - gv.model.rear) * 2.2;
    const from = new THREE.Vector3(gv.muzzle.x, gv.muzzle.y, 0);
    const to = new THREE.Vector3(gv.muzzle.x + len, gv.muzzle.y, 0);
    this.fx.shot(from, to, false, { burst: false, travel: true });
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
    this.fx.update(mode === 'inspect' ? dt * 0.3 : dt);
    for (const p of this.puffs) {
      if (p.life <= 0) continue;
      p.life -= dt;
      const k = Math.max(0, p.life / p.max);
      p.vel.multiplyScalar(Math.exp(-dt * 2.5));
      p.sprite.position.addScaledVector(p.vel, dt);
      p.sprite.scale.setScalar(p.size * (1 + (1 - k) * 4));
      p.sprite.material.opacity = 0.32 * k;
      if (p.life <= 0) p.sprite.visible = false;
    }
    const gv = this.current;
    if (!gv) return;
    gv.setGlow(dt);
    const rig = this.rig;
    const gun = gv.root;
    const { rear, front } = gv.model;
    this.showFlash(gv);
    if (mode === 'inspect') {
      this.switching = null;
      this.hideBlur();
      this.camera.fov = 32;
      this.camera.updateProjectionMatrix();
      // A knife is framed as if it were a rifle's length, so it shows at
      // its real size next to the guns.
      const dist = (gv.info.melee ? Math.max(front - rear, 0.9) : front - rear) * 2.4;
      const halfH = Math.tan((this.camera.fov * Math.PI) / 360) * dist;
      // A knife lies along X on the turntable, blade tip where a muzzle would be.
      gun.rotation.set(0, 0, gv.info.melee ? Math.PI / 2 : 0);
      gun.position.set(-(rear + front) / 2, -0.02, 0);
      rig.position.set(this.inspectAt.x * halfH * this.camera.aspect, this.inspectAt.y * halfH, -dist + this.kick * 0.03);
      // Yaw of pi shows the left side with the muzzle pointing left.
      rig.rotation.set(0.1 * Math.sin(this.t * 0.7), Math.PI + this.inspectYaw + 0.22 * Math.sin(this.t * 0.4), this.inspectPitch + this.kick * 0.02);
      return;
    }
    this.camera.fov = this.fov || 60;
    this.camera.updateProjectionMatrix();
    gun.position.set(0, 0, 0);
    gun.rotation.set(0, 0, 0);
    // Switching: lower the held weapon, then swap and draw the next one.
    let lower = 0;
    if (this.switching) {
      this.switching.t += dt;
      lower = easeInOut(Math.min(1, this.switching.t / HOLSTER));
      if (this.switching.t >= HOLSTER) {
        const { id, skin } = this.switching;
        this.switching = null;
        this.setGun(id, skin);
        this.startDraw();
        lower = 1;
        return this.update(0, mode);
      }
    }
    const bob = Math.sin(this.t * 1.7) * 0.0018;
    // Running: the weapon sways side to side and dips with each step.
    this.stepPhase += dt * 9.5 * this.moving;
    const runX = Math.sin(this.stepPhase) * 0.007 * this.moving;
    const runY = -Math.abs(Math.cos(this.stepPhase)) * 0.008 * this.moving;
    if (gv.info.melee) {
      this.knifeT += dt;
      if (this.knifeAnim && this.knifeT >= knifeLength(this.knifeAnim)) this.knifeAnim = null;
      const offset = { x: runX - this.swayX * 0.25, y: bob + runY + this.swayY * 0.2 - lower * 0.4, z: lower * 0.05, lower };
      this.poseKnife(rig, this.knifeAnim, this.knifeT, offset);
      this.knifeBlur(gv, dt, offset);
      return;
    }
    this.hideBlur();
    this.gunAnimT += dt;
    if (this.gunAnim && this.gunAnimT >= gunAnimLength(this.gunAnim)) this.gunAnim = null;
    const { p: ap, r: ar } = sampleGunAnim(this.gunAnim, this.gunAnimT);
    const P = (gv.model.detailed && DETAILED_POSE[gv.id]) || PLAY_POSE[gv.id];
    // Aim from the resting pose; sway, bob and recoil move it off briefly.
    _m.set(P.x, P.y, P.z);
    const aim = aimAt(_m, gv.muzzle ? gv.muzzle.y : 0, P.aim || CONVERGE);
    rig.position.set(
      P.x + ap[0] + runX - this.swayX * 0.25,
      P.y + ap[1] + bob + runY + this.swayY * 0.2 - this.kick * 0.004 - lower * 0.24,
      P.z + ap[2] + this.kick * 0.022 + lower * 0.06,
    );
    rig.rotation.set(
      ar[0] + this.swayX * 0.4,
      aim.yaw + ar[1] + this.swayX,
      aim.pitch + ar[2] - this.swayY + this.kick * 0.03 - lower * 0.7,
    );
  }

  // The knife's pose at animation time `t`, with sway, bob and holstering.
  poseKnife(obj, anim, t, off) {
    sampleKnife(anim, t, _kp, _kq);
    obj.position.set(_kp.x + off.x, _kp.y + off.y, _kp.z + off.z);
    obj.quaternion.copy(_kq);
    obj.rotateOnWorldAxis(_up, this.swayX * 0.8);
    obj.rotateOnWorldAxis(_right, -this.swayY * 0.8 - off.lower * 0.6);
  }

  // Motion blur while the knife spins fast: faint copies posed a fraction of
  // a frame back, fading with age, so a flip reads as a spin rather than a
  // knife jumping between angles. They show only above about 7 degrees of
  // turn per frame.
  knifeBlur(gv, dt, off) {
    this.buildBlur(gv);
    const anim = this.knifeAnim;
    let k = 0;
    const span = Math.max(1 / 144, Math.min(dt || 1 / 60, 1 / 30));
    if (anim && this.mode === 'play') {
      sampleKnife(anim, this.knifeT, _kp, _kq);
      _bq.copy(_kq);
      sampleKnife(anim, this.knifeT - span, _kp, _kq);
      const angle = 2 * Math.acos(Math.min(1, Math.abs(_bq.dot(_kq))));
      k = Math.min(1, (angle - 0.12) / 0.35);
    }
    const B = this.blur;
    B.copies.forEach((c, i) => {
      c.group.visible = k > 0;
      if (k <= 0) return;
      const f = (i + 1) / (BLUR_COPIES + 1);
      this.poseKnife(c.group, anim, this.knifeT - span * f, off);
      for (const m of c.mats.values()) m.opacity = k * (0.42 - 0.3 * f);
    });
  }

  hideBlur() {
    if (this.blur) for (const c of this.blur.copies) c.group.visible = false;
  }

  // The blur copies share the knife's geometry, with flat see-through
  // versions of its materials; rebuilt when the knife or its skin changes.
  buildBlur(gv) {
    const sig = `${gv.id}|${gv.modelVersion}|${gv.sig}|${gv.zoneSig}`;
    if (this.blur && this.blur.sig === sig) return;
    if (this.blur) {
      for (const c of this.blur.copies) {
        this.hand.remove(c.group);
        for (const m of c.mats.values()) m.dispose();
      }
    }
    gv.root.updateMatrixWorld(true);
    _inv4.copy(gv.root.matrixWorld).invert();
    const copies = [];
    for (let i = 0; i < BLUR_COPIES; i++) {
      const group = new THREE.Group();
      const mats = new Map();
      gv.model.group.traverse((o) => {
        if (!o.isMesh || !o.visible || !o.material || Array.isArray(o.material)) return;
        const src = o.material;
        let m = mats.get(src);
        if (!m) {
          m = new THREE.MeshBasicMaterial({
            map: src.map || null,
            color: src.color ? src.color.clone().multiplyScalar(0.85) : 0xb8bcc4,
            vertexColors: !!src.vertexColors,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            side: THREE.DoubleSide,
          });
          mats.set(src, m);
        }
        const mesh = new THREE.Mesh(o.geometry, m);
        mesh.matrixAutoUpdate = false;
        mesh.matrix.multiplyMatrices(_inv4, o.matrixWorld);
        mesh.renderOrder = 1;
        group.add(mesh);
      });
      group.visible = false;
      this.hand.add(group);
      copies.push({ group, mats });
    }
    this.blur = { sig, copies };
    try {
      for (const c of copies) this.renderer.compile(c.group, this.camera, this.scene);
    } catch (e) { /* compiling ahead is only an optimisation */ }
  }

  render(renderer) {
    this.fx.setView(renderer.domElement.height, this.camera.fov, this.maxPointSize);
    renderer.render(this.scene, this.camera);
  }
}
