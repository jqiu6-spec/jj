// 3D arena, first-person camera, targets, weapons and the run state machine.
import * as THREE from '../vendor/three.module.min.js';
import { MOTIONS, AGENT, agentDims } from './motion.js';
import { eyeOf, defaultSetup, setupKey, effectiveScenario, OPERATOR } from './scenarios.js';
import { degPerCount, verticalFov } from './settings.js';
import { sfx } from './audio.js';
import { Viewmodel } from './weapon.js';
import { GUNS } from './guns.js';
import { Effects } from './effects.js';

// macOS reports Ctrl+click as a left button; treat it as the right button.
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || '') || /Macintosh/.test(navigator.userAgent || '');

const DEG = Math.PI / 180;
const MAX_PITCH = 89 * DEG;
const COUNTDOWN = 3;

// ------------------------------------------------------------------ textures
function gridTexture(base, line, major) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = line;
  // Thin lines every 64px (1 m), a heavier line on the tile edge (4 m).
  for (let i = 64; i < 256; i += 64) {
    g.fillRect(i - 1, 0, 2, 256);
    g.fillRect(0, i - 1, 256, 2);
  }
  g.fillStyle = major;
  g.fillRect(0, 0, 4, 256);
  g.fillRect(0, 0, 256, 4);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function blobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function crateTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#5b5f66';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#4d5158';
  for (let y = 0; y < 256; y += 32) g.fillRect(0, y, 256, 3);
  g.strokeStyle = '#3a3d43';
  g.lineWidth = 14;
  g.strokeRect(7, 7, 242, 242);
  g.beginPath();
  g.moveTo(14, 14);
  g.lineTo(242, 242);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------- hit tests
const _w = new THREE.Vector3();
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _c = new THREE.Vector3();
const _ray = new THREE.Ray();
const _hit = new THREE.Vector3();
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();

// Distance along the ray to a sphere's surface, or -1 on a miss.
function raySphere(o, d, cx, cy, cz, r) {
  _w.set(o.x - cx, o.y - cy, o.z - cz);
  const b = _w.dot(d);
  const c = _w.lengthSq() - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const s = -b - Math.sqrt(disc);
  return s > 0 ? s : -1;
}

// Vertical capsule whose core runs from (ax, ay, az) up by `len`:
// closest approach between the ray and the core segment.
function rayCapsule(o, d, ax, ay, az, len, r) {
  _v.set(0, len, 0);
  _w.set(o.x - ax, o.y - ay, o.z - az);
  const B = d.dot(_v);
  const C = _v.dot(_v);
  const D = d.dot(_w);
  const E = _v.dot(_w);
  const den = C - B * B;
  let tr;
  let s;
  if (den < 1e-9) { tr = -D; s = 0; } else { tr = (B * E - C * D) / den; s = (E - B * D) / den; }
  if (s < 0) { s = 0; tr = -D; } else if (s > 1) { s = 1; tr = B - D; }
  if (tr < 0) { tr = 0; s = C > 0 ? Math.max(0, Math.min(1, E / C)) : 0; }
  _p.copy(d).multiplyScalar(tr).add(o);
  _q.set(ax, ay + s * len, az);
  return _p.distanceToSquared(_q) <= r * r ? Math.max(tr, 0.001) : -1;
}

// ------------------------------------------------------------------- game
export class Game {
  constructor(canvas, settings, hooks) {
    this.canvas = canvas;
    this.hooks = hooks; // { onHud, onState, onFinish, onHit }
    this.state = 'menu'; // menu | countdown | running | paused | results
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#161b23');
    this.fx = new Effects(this.scene);
    this.arenaBox = new THREE.Box3();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 400);
    this.camera.rotation.order = 'YXZ';
    this.yaw = 0;
    this.pitch = 0;
    this.eye = new THREE.Vector3(0, 1.7, 0);
    this.fwd = new THREE.Vector3(0, 0, -1);

    // Ground colour lights downward faces, so the ceiling doesn't go black.
    this.scene.add(new THREE.HemisphereLight(0xe4ecff, 0x7c8698, 1.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.3);
    sun.position.set(6, 20, 8);
    this.scene.add(sun);

    this.tex = {
      wall: gridTexture('#3b4554', '#4a576a', '#5d6c84'),
      floor: gridTexture('#2a313c', '#353f4c', '#465368'),
      ceil: gridTexture('#343c49', '#3e4755', '#4a5566'),
      blob: blobTexture(),
      crate: crateTexture(),
    };
    const aniso = this.renderer.capabilities.getMaxAnisotropy();
    for (const k of ['wall', 'floor', 'ceil']) this.tex[k].anisotropy = aniso;

    this.arena = null;
    this.targets = [];
    this.pops = [];
    this.scn = null;
    this.firing = false;
    this.skipMove = 0;
    this.fpsFrames = 0;
    this.fpsTime = 0;
    this.fps = 0;
    this.covers = [];
    this.skins = {};
    this.inspect = null; // gun id shown on the turntable, or null
    this.zoomLevel = 0; // 0 unscoped, 1 = 2.5x, 2 = 5x
    this.scopeT = 0; // 0..1 progress into the current zoom
    this.punch = 0; // view kick from a sniper shot, decays to 0 (visual only)
    this.slot = 'gun'; // 'gun' or 'knife': what the player holds in a run
    this.lastWheel = 0;
    this.vm = new Viewmodel(this.renderer);
    this.applySettings(settings);

    this.resize();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('mousemove', (e) => this.onMouseMove(e));
    document.addEventListener('mousedown', (e) => this.onMouseDown(e));
    document.addEventListener('mouseup', (e) => this.onMouseUp(e));
    // Mouse wheel swaps between the gun and the knife, as in CS2.
    document.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    document.addEventListener('contextmenu', (e) => {
      if (document.pointerLockElement === this.canvas) e.preventDefault();
    });

    this.last = performance.now();
    const loop = (now) => {
      this.frame(now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------ settings
  applySettings(s) {
    this.settings = s;
    this.radPerCount = degPerCount(s) * DEG;
    this.targetColor = new THREE.Color(s.targetColor);
    this.hitColor = new THREE.Color(s.hitColor);
    this.vm.applyView(s.weapon);
    this.refreshGun();
    this.resize();
  }

  // Per-gun skins, stickers and sounds from the Weapon tab.
  setSkins(skins) {
    this.skins = skins;
    this.refreshGun();
  }

  // The gun for this scenario: the AWP in sniping, the primary otherwise.
  get gunId() {
    if (this.scn && this.scn.weapon.type === 'sniper') return 'awp';
    return this.settings.weapon.primary;
  }

  // What the player holds: the scenario's gun, or the knife.
  get heldId() {
    return this.slot === 'knife' ? 'karambit' : this.gunId;
  }

  get knifeOut() {
    return this.slot === 'knife';
  }

  refreshGun() {
    const menuInspect = this.inspect && this.state === 'menu';
    const id = menuInspect ? this.inspect : this.heldId;
    if (this.skins[id]) {
      if (menuInspect) this.vm.setGun(id, this.skins[id]);
      else this.vm.equip(id, this.skins[id]); // animates a swap in first person
    }
    const eq = this.skins[this.gunId];
    const fx = (eq && eq.fx) || { type: 'none' };
    this.fx.setStyle(fx.type, fx.color);
  }

  // Turntable view of `gunId` in the menu; `at` is its centre in NDC.
  setInspect(gunId, at) {
    this.inspect = gunId;
    if (at) this.vm.inspectAt = at;
    this.refreshGun();
  }

  get sniper() {
    return this.scn && this.scn.weapon.type === 'sniper';
  }

  // The first-person gun is drawn (not hidden in settings, not scoped in).
  get gunVisible() {
    return this.settings.weapon.show && !(this.zoomLevel && this.scopeT > 0.25);
  }

  // The equipped gun's kill sound: the player's choice, else the gun's own.
  killSound() {
    const skin = this.skins[this.gunId];
    const choice = skin && skin.killSound && skin.killSound !== 'auto' ? skin.killSound : null;
    return choice || GUNS[this.gunId].killSound || 'classic';
  }

  fireSound() {
    if (!this.settings.weapon.sounds) return;
    const skin = this.skins[this.gunId];
    const choice = skin && skin.sound && skin.sound !== 'auto' ? skin.sound : GUNS[this.gunId].sound(skin || {});
    sfx.gun(choice);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const scale = (this.settings && this.settings.render && this.settings.render.scale) || 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * scale);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.hipFov = verticalFov(this.settings ? this.settings.fov : 103, w / h);
    this.applyZoom();
    this.vm.setAspect(w / h);
  }

  // Current magnification, eased in over the scope-in time.
  get zoom() {
    if (!this.zoomLevel) return 1;
    const z = OPERATOR.zooms[this.zoomLevel - 1];
    return 1 + (z - 1) * this.scopeT;
  }

  applyZoom() {
    const half = (this.hipFov * Math.PI) / 360;
    this.camera.fov = (Math.atan(Math.tan(half) / this.zoom) * 360) / Math.PI;
    this.camera.updateProjectionMatrix();
  }

  setZoom(level) {
    if (level === this.zoomLevel) return;
    this.zoomLevel = level;
    this.scopeT = 0;
    if (level) sfx.scope();
    this.applyZoom();
  }

  // ------------------------------------------------------------ scenario
  // `setup` is the player's choice of target count, health and hitbox.
  load(scn, setup = defaultSetup(scn)) {
    this.scn = scn;
    this.setup = setup;
    this.eff = effectiveScenario(scn, setup); // what the motion models read
    this.loadedKey = `${scn.id}|${setupKey(setup)}`;
    this.buildArena(scn.arena);
    this.setZoom(0);
    this.refreshGun();
    const [ex, ey, ez] = eyeOf(scn);
    this.eye.set(ex, ey, ez);
    this.camera.position.copy(this.eye);
    for (const t of this.targets) this.disposeTarget(t);
    this.targets = [];
    for (let i = 0; i < setup.count; i++) this.targets.push(this.makeTarget(scn.target, setup.hp));
    this.resetTargets();
    this.lookAtTargets(true);
  }

  makeTarget(spec, hp) {
    const mat = () => new THREE.MeshStandardMaterial({
      color: this.targetColor, roughness: 0.42, metalness: 0.0,
      emissive: this.targetColor, emissiveIntensity: 0.22,
    });
    const t = {
      shape: spec.shape,
      radius: spec.shape === 'agent' ? AGENT.radius : spec.radius,
      half: spec.shape === 'capsule' ? spec.height / 2 - spec.radius : 0, // capsule core half-length
      hp: hp || Infinity,
      maxHp: hp || Infinity,
      vel: new THREE.Vector3(),
      m: {},
      alive: true,
      flash: 0,
      respawnAt: null,
      body: mat(),
      head: null,
    };
    if (spec.shape === 'agent') {
      // Body capsule built from a cylinder and two caps so crouching can
      // shorten it without squashing the ends; a separate head sphere.
      const r = AGENT.radius;
      const root = new THREE.Group();
      const cap = new THREE.SphereGeometry(r, 24, 14);
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 24, 1, true), t.body);
      const capB = new THREE.Mesh(cap, t.body);
      const capT = new THREE.Mesh(cap, t.body);
      capB.position.y = r;
      t.head = mat();
      const head = new THREE.Mesh(new THREE.SphereGeometry(AGENT.head, 28, 18), t.head);
      root.add(cyl, capB, capT, head);
      t.parts = { cyl, capT, head };
      t.root = root;
    } else if (spec.shape === 'capsule') {
      t.root = new THREE.Mesh(new THREE.CapsuleGeometry(spec.radius, spec.height - spec.radius * 2, 8, 20), t.body);
    } else {
      t.root = new THREE.Mesh(new THREE.SphereGeometry(spec.radius, 40, 24), t.body);
    }
    t.pos = t.root.position;
    t.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: this.tex.blob, transparent: true, depthWrite: false }),
    );
    t.shadow.rotation.x = -Math.PI / 2;
    this.scene.add(t.root, t.shadow);
    if (t.maxHp !== Infinity) {
      // Health bar that always faces the camera.
      const w = spec.shape === 'sphere' ? Math.max(0.8, spec.radius * 2.2) : 0.8;
      const bar = new THREE.Group();
      const bg = new THREE.Mesh(
        new THREE.PlaneGeometry(w + 0.04, 0.11),
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false }),
      );
      const fill = new THREE.Mesh(
        new THREE.PlaneGeometry(w, 0.07).translate(w / 2, 0, 0),
        new THREE.MeshBasicMaterial({ color: 0xf2f5f9 }),
      );
      fill.position.set(-w / 2, 0, 0.001);
      bar.add(bg, fill);
      this.scene.add(bar);
      t.bar = { group: bar, fill };
    }
    return t;
  }

  disposeTarget(t) {
    for (const o of [t.root, t.shadow, t.bar && t.bar.group]) {
      if (!o) continue;
      this.scene.remove(o);
      o.traverse((x) => {
        if (x.isMesh) { x.geometry.dispose(); x.material.dispose(); }
      });
    }
  }

  // Point the aim metrics use: the head in head-only mode, else the chest.
  center(t, out) {
    if (t.shape !== 'agent') return out.copy(t.pos);
    const { top, headY } = agentDims(t);
    return out.set(t.pos.x, t.pos.y + (this.setup.headOnly ? headY : top * 0.6), t.pos.z);
  }

  buildArena(a) {
    if (this.arena) {
      this.scene.remove(this.arena);
      this.arena.traverse((o) => {
        if (o.isMesh) { o.geometry.dispose(); o.material.map.dispose(); o.material.dispose(); }
      });
    }
    const g = new THREE.Group();
    const depth = a.zMax - a.zMin;
    const cz = (a.zMin + a.zMax) / 2;
    this.arenaBox.min.set(-a.w / 2, 0, a.zMin);
    this.arenaBox.max.set(a.w / 2, a.h, a.zMax);
    const cell = 4; // one texture tile = 4 m
    const plane = (w, h, tex, setup) => {
      const t = tex.clone();
      t.repeat.set(w / cell, h / cell);
      t.needsUpdate = true;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: t }));
      setup(m);
      g.add(m);
    };
    plane(a.w, depth, this.tex.floor, (m) => { m.rotation.x = -Math.PI / 2; m.position.set(0, 0, cz); });
    plane(a.w, depth, this.tex.ceil, (m) => { m.rotation.x = Math.PI / 2; m.position.set(0, a.h, cz); });
    plane(a.w, a.h, this.tex.wall, (m) => { m.position.set(0, a.h / 2, a.zMin); });
    plane(a.w, a.h, this.tex.wall, (m) => { m.rotation.y = Math.PI; m.position.set(0, a.h / 2, a.zMax); });
    plane(depth, a.h, this.tex.wall, (m) => { m.rotation.y = Math.PI / 2; m.position.set(-a.w / 2, a.h / 2, cz); });
    plane(depth, a.h, this.tex.wall, (m) => { m.rotation.y = -Math.PI / 2; m.position.set(a.w / 2, a.h / 2, cz); });
    // Crates block bullets and line of sight.
    this.covers = [];
    for (const c of a.covers || []) {
      const t = this.tex.crate.clone();
      t.needsUpdate = true;
      const m = new THREE.Mesh(new THREE.BoxGeometry(c.w, c.h, c.d), new THREE.MeshLambertMaterial({ map: t }));
      m.position.set(c.x, c.h / 2, c.z);
      g.add(m);
      this.covers.push(new THREE.Box3(
        new THREE.Vector3(c.x - c.w / 2, 0, c.z - c.d / 2),
        new THREE.Vector3(c.x + c.w / 2, c.h, c.z + c.d / 2),
      ));
    }
    this.arena = g;
    this.scene.add(g);
  }

  ctx() {
    return { scn: this.eff, eye: this.eye, targets: this.targets, aimPoint: this.aimPoint };
  }

  spawn(t) {
    const motion = MOTIONS[this.scn.motion.type];
    t.alive = true;
    t.hp = t.maxHp;
    t.flash = 0;
    t.respawnAt = null;
    t.seenFor = 0; // seconds continuously visible, for reaction time
    t.hiddenFor = 0;
    motion.spawn(t, this.ctx());
    t.root.visible = true;
  }

  resetTargets() {
    this.aimPoint = null;
    for (const t of this.targets) t.alive = false;
    for (const t of this.targets) this.spawn(t);
  }

  lookAtTargets(snap) {
    // Menu preview: ease the camera toward the average target position.
    if (!this.targets.length) return;
    _v.set(0, 0, 0);
    for (const t of this.targets) _v.add(this.center(t, _p));
    _v.multiplyScalar(1 / this.targets.length).sub(this.eye);
    const yaw = Math.atan2(-_v.x, -_v.z);
    const pitch = Math.atan2(_v.y, Math.hypot(_v.x, _v.z));
    if (snap) { this.yaw = yaw; this.pitch = pitch; return; }
    let dy = yaw - this.yaw;
    while (dy > Math.PI) dy -= 2 * Math.PI;
    while (dy < -Math.PI) dy += 2 * Math.PI;
    this.yaw += dy * 0.04;
    this.pitch += (pitch - this.pitch) * 0.04;
  }

  // ------------------------------------------------------------ run flow
  // Swap between the gun and the knife: 'gun', 'knife' or 'toggle'.
  switchWeapon(slot) {
    const live = this.state === 'running' || this.state === 'countdown';
    if (!live) return;
    const next = slot === 'toggle' ? (this.slot === 'knife' ? 'gun' : 'knife') : slot;
    if (next === this.slot) return;
    this.slot = next;
    this.firing = false;
    if (next === 'knife') this.setZoom(0);
    this.refreshGun();
    if (next === 'knife') sfx.knifeDraw();
    else sfx.gunDraw();
  }

  onWheel(e) {
    if (document.pointerLockElement !== this.canvas) return;
    e.preventDefault();
    // Trackpads send a stream of wheel events; one swap per flick.
    const now = performance.now();
    if (Math.abs(e.deltaY) < 1 || now - this.lastWheel < 250) return;
    this.lastWheel = now;
    this.switchWeapon('toggle');
  }

  // F: spin the knife around the finger.
  inspectWeapon() {
    const live = this.state === 'running' || this.state === 'countdown';
    if (live && this.knifeOut && this.vm.knifeInspect()) sfx.knifeInspect();
  }

  start() {
    this.slot = 'gun';
    this.run = {
      scenario: this.scn.id,
      elapsed: 0,
      score: 0,
      shots: 0,
      hits: 0,
      kills: 0,
      damage: 0,
      fireTime: 0,
      onTime: 0,
      lastKill: 0,
      ttkSum: 0,
      leadSum: 0,
      errSum: 0,
      leadTime: 0,
      headTime: 0,
      headshots: 0,
      reactSum: 0,
      reactCount: 0,
      unscoped: 0,
      lastShot: -99,
      timeline: [],
      tickTimer: 0,
    };
    this.firing = false;
    this.setZoom(0);
    this.vm.resetFire(GUNS[this.gunId].fireInterval || 0.1);
    this.resetTargets();
    this.lookAtTargets(true);
    this.pitch = Math.max(-0.35, Math.min(0.35, this.pitch));
    this.countdown = COUNTDOWN;
    this.lastCount = COUNTDOWN + 1;
    this.setState('countdown');
  }

  setState(s) {
    this.state = s;
    this.refreshGun();
    this.hooks.onState(s);
  }

  pause() {
    if (this.state === 'running' || this.state === 'countdown') {
      this.pausedFrom = this.state;
      this.firing = false;
      if (this.settings.sniper.scopeMode === 'hold') this.setZoom(0);
      this.setState('paused');
    }
  }

  resume() {
    if (this.state === 'paused') this.setState(this.pausedFrom || 'running');
  }

  toMenu() {
    this.firing = false;
    this.setZoom(0);
    this.run = null;
    this.setState('menu');
    this.resetTargets();
  }

  finish() {
    const r = this.run;
    const beam = this.scn.weapon.type === 'beam';
    const accuracy = beam ? (r.fireTime > 0 ? r.onTime / r.fireTime : 0) : (r.shots ? r.hits / r.shots : 0);
    while (r.timeline.length < this.scn.duration) r.timeline.push(Math.round(r.score));
    this.setZoom(0);
    const result = {
      scenario: this.scn.id,
      setup: setupKey(this.setup),
      date: Date.now(),
      score: Math.round(r.score),
      accuracy,
      kills: r.kills,
      shots: r.shots,
      hits: r.hits,
      damage: Math.round(r.damage),
      onTime: r.onTime,
      ttk: r.kills ? r.ttkSum / r.kills : null,
      lead: r.leadTime > 0.5 ? r.leadSum / r.leadTime / DEG : null,
      err: r.leadTime > 0.5 ? r.errSum / r.leadTime / DEG : null,
      headShare: this.scn.target.shape === 'agent' && r.onTime > 0 ? r.headTime / r.onTime : null,
      headshots: r.headshots,
      react: r.reactCount ? r.reactSum / r.reactCount : null,
      unscoped: r.unscoped,
      gun: this.gunId,
      timeline: r.timeline,
      fps: Math.round(this.fps),
    };
    this.firing = false;
    this.setState('results');
    sfx.end();
    this.hooks.onFinish(result);
  }

  // --------------------------------------------------------------- input
  onMouseMove(e) {
    if (document.pointerLockElement !== this.canvas) return;
    if (this.state !== 'running' && this.state !== 'countdown') return;
    if (this.skipMove > 0) { this.skipMove--; return; }
    // Scoped: slower in proportion to the zoom, times the scoped multiplier.
    const scoped = this.zoomLevel ? this.settings.sniper.scopedSens / OPERATOR.zooms[this.zoomLevel - 1] : 1;
    const k = this.radPerCount * scoped;
    const dx = e.movementX * k;
    const dy = e.movementY * k * (this.settings.invertY ? -1 : 1);
    this.yaw -= dx;
    this.pitch -= dy;
    if (this.pitch > MAX_PITCH) this.pitch = MAX_PITCH;
    if (this.pitch < -MAX_PITCH) this.pitch = -MAX_PITCH;
    this.vm.addSway(dx, dy);
  }

  onMouseDown(e) {
    if (document.pointerLockElement !== this.canvas) return;
    const right = e.button === 2 || (e.button === 0 && e.ctrlKey && IS_MAC);
    if (this.knifeOut) {
      // Left slashes (held, it keeps slashing), right stabs. Knives don't
      // shoot, so nothing scores while the knife is out.
      if (e.button !== 0 && !right) return;
      if (!right) this.firing = true;
      const live = this.state === 'running' || this.state === 'countdown';
      if (live && this.vm.knifeAttack(right ? 'stab' : 'slash')) (right ? sfx.stab : sfx.slash)();
      return;
    }
    if (right) { this.scopePress(); return; }
    if (e.button !== 0) return;
    this.firing = true;
    if (this.state !== 'running') return;
    if (this.scn.weapon.type === 'click') this.shoot();
    else if (this.sniper) this.sniperShoot();
  }

  onMouseUp(e) {
    if (e.button === 0 && !(e.ctrlKey && IS_MAC)) this.firing = false;
    if (e.button === 2 || (e.button === 0 && e.ctrlKey && IS_MAC)) this.scopeRelease();
  }

  // Right mouse button, Ctrl+click on a Mac, or the Shift key. Only the
  // sniper scopes. Toggle cycles 2.5x, 5x, off; hold is 2.5x while held.
  scopePress() {
    const live = this.state === 'running' || this.state === 'countdown';
    if (!this.sniper || !live || this.knifeOut) return;
    if (this.settings.sniper.scopeMode === 'hold') this.setZoom(1);
    else this.setZoom((this.zoomLevel + 1) % 3);
  }

  scopeRelease() {
    if (this.sniper && this.settings.sniper.scopeMode === 'hold') this.setZoom(0);
  }

  updateForward() {
    const cp = Math.cos(this.pitch);
    this.fwd.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  // Distance along a ray to the nearest crate, or Infinity.
  coverHit(o, d) {
    if (!this.covers.length) return Infinity;
    _ray.set(o, d);
    let best = Infinity;
    for (const b of this.covers) {
      if (_ray.intersectBox(b, _hit)) best = Math.min(best, _hit.distanceTo(o));
    }
    return best;
  }

  // Nearest target along `dir` (default: the crosshair). Sets this.pickPart
  // to 'head', 'body' or 'legs'. Crates stop the ray.
  pick(dir) {
    this.updateForward();
    const o = this.eye;
    const d = dir || this.fwd;
    let best = null;
    let bestD = this.coverHit(o, d);
    for (const t of this.targets) {
      if (!t.alive) continue;
      if (t.shape === 'agent') {
        const { top, headY } = agentDims(t);
        const r = AGENT.radius;
        const h = raySphere(o, d, t.pos.x, t.pos.y + headY, t.pos.z, AGENT.head);
        const b = this.setup.headOnly ? -1 : rayCapsule(o, d, t.pos.x, t.pos.y + r, t.pos.z, top - 2 * r, r);
        if (h > 0 && h < bestD && (b < 0 || h <= b)) { bestD = h; best = t; this.pickPart = 'head'; }
        else if (b > 0 && b < bestD) {
          bestD = b;
          best = t;
          const hy = o.y + d.y * b - t.pos.y;
          this.pickPart = hy < top * 0.48 ? 'legs' : 'body';
        }
      } else if (t.shape === 'capsule') {
        const c = rayCapsule(o, d, t.pos.x, t.pos.y - t.half, t.pos.z, 2 * t.half, t.radius);
        if (c > 0 && c < bestD) { bestD = c; best = t; this.pickPart = 'body'; }
      } else {
        const s = raySphere(o, d, t.pos.x, t.pos.y, t.pos.z, t.radius);
        if (s > 0 && s < bestD) { bestD = s; best = t; this.pickPart = 'body'; }
      }
    }
    this.pickDist = best ? bestD : 0;
    return best;
  }

  kill(t) {
    const r = this.run;
    r.kills++;
    r.ttkSum += r.elapsed - r.lastKill;
    r.lastKill = r.elapsed;
    if (t.seenFor > 0) {
      r.reactSum += t.seenFor;
      r.reactCount++;
    }
    this.popAt(t);
    // Kills close together build a streak (up to 5), as in Valorant, and
    // the Champions kill sound climbs with it.
    r.streak = r.elapsed - (r.lastStreakKill ?? -99) < 2.5 ? Math.min(5, (r.streak || 0) + 1) : 1;
    r.lastStreakKill = r.elapsed;
    sfx.kill(this.killSound(), r.streak);
    this.hooks.onHit(true);
    // Keep respawns away from where the player is currently aiming.
    this.updateForward();
    this.aimPoint = this.eye.clone().addScaledVector(this.fwd, this.eye.distanceTo(t.pos));
    t.alive = false;
    t.root.visible = false;
    if (this.scn.respawn) t.respawnAt = r.elapsed + this.scn.respawn;
    else this.spawn(t);
  }

  shoot() {
    const r = this.run;
    const w = this.scn.weapon;
    // Fire no faster than the equipped gun's cyclic rate.
    const interval = GUNS[this.gunId].fireInterval || 0;
    if (r.elapsed - r.lastShot < interval * 0.95) return;
    r.lastShot = r.elapsed;
    r.shots++;
    this.vm.shot();
    if (this.settings.weapon.sounds) this.fireSound();
    else sfx.shot();
    const t = this.pick();
    this.tracer(this.fwd, t ? this.pickDist : 0);
    if (t) {
      r.hits++;
      r.score += w.points;
      this.kill(t);
    } else {
      r.score = Math.max(0, r.score - w.missPenalty);
    }
  }

  // Fire-effect tracer from the gun's muzzle to where the shot lands: the
  // target hit, else the nearest crate or wall along `dir`.
  tracer(dir, hitDist) {
    let dist = hitDist;
    if (!(dist > 0)) {
      _ray.set(this.eye, dir);
      dist = Math.min(this.coverHit(this.eye, dir), _ray.intersectBox(this.arenaBox, _hit) ? _hit.distanceTo(this.eye) : 60);
    }
    _to.copy(this.eye).addScaledVector(dir, dist);
    // Start where the muzzle is drawn. The gun renders with its own camera, so
    // take the muzzle's screen position and put the start on the world ray
    // through that pixel, at the depth that gives the same apparent size.
    // The shot then leaves the barrel exactly, in any pose, sway or recoil.
    let nx;
    let ny;
    let depth;
    const mv = this.gunVisible ? this.vm.muzzleView() : null;
    if (mv && mv.depth > 0.05) {
      nx = mv.x;
      ny = mv.y;
      depth = (mv.depth * Math.tan((mv.fov * DEG) / 2)) / Math.tan((this.camera.fov * DEG) / 2);
    } else {
      // No gun on screen (hidden, or scoped in): from just under the view.
      const side = this.settings.weapon.hand === 'left' ? -1 : 1;
      nx = this.zoomLevel ? 0 : 0.28 * side;
      ny = this.zoomLevel ? -0.2 : -0.42;
      depth = 0.9;
    }
    this.camera.position.copy(this.eye);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    this.camera.updateMatrixWorld();
    _from.set(nx, ny, 0.5).unproject(this.camera).sub(this.eye).normalize();
    _from.multiplyScalar(depth / Math.max(0.2, _from.dot(this.fwd))).add(this.eye);
    this.fx.shot(_from, _to, hitDist > 0);
  }

  // Operator handling: 1.67 s between shots, 5 rounds, 3.7 s reload,
  // hip-fire spread that closes as the scope settles.
  sniperShoot() {
    const r = this.run;
    const w = this.scn.weapon;
    if (r.elapsed - r.lastShot < OPERATOR.fireInterval) { sfx.dry(); return; }
    r.lastShot = r.elapsed;
    r.shots++;
    const settled = this.zoomLevel ? this.scopeT : 0;
    if (settled < 1) r.unscoped++;
    this.vm.shot(true);
    this.punch = 1;
    this.fireSound();
    this.updateForward();
    const dir = this.fwd.clone();
    const spread = OPERATOR.hipSpread * DEG * (1 - settled);
    if (spread > 0) {
      // Uniform point in a cone around the aim direction.
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * Math.tan(spread);
      _p.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); // camera right
      _q.crossVectors(_p, dir).normalize(); // up
      dir.addScaledVector(_p, Math.cos(a) * rr).addScaledVector(_q, Math.sin(a) * rr).normalize();
    }
    const t = this.pick(dir);
    this.tracer(dir, t ? this.pickDist : 0);
    if (t) {
      r.hits++;
      const part = this.pickPart;
      const dmg = OPERATOR.damage[part];
      t.hp -= dmg;
      t.flash = 1;
      t.flashPart = part === 'head' ? 'head' : 'body';
      if (t.hp <= 0) {
        r.score += w.points + (part === 'head' ? w.headBonus : 0);
        if (part === 'head') r.headshots++;
        this.kill(t);
      } else {
        this.hooks.onHit(false);
      }
    } else {
      r.score = Math.max(0, r.score - w.missPenalty);
    }
    if (this.settings.sniper.unscope) this.setZoom(0);
  }

  // ------------------------------------------------------------- effects
  popAt(t) {
    let p = this.pops.find((x) => x.life <= 0);
    if (!p) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(1, 24, 16),
        new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }),
      );
      p = { mesh, life: 0 };
      this.pops.push(p);
      this.scene.add(mesh);
    }
    p.life = 0.22;
    p.base = t.shape === 'agent' ? 0.45 : t.radius;
    p.mesh.material.color.copy(this.fx.styled ? this.fx.color : this.hitColor);
    this.center(t, p.mesh.position);
    p.mesh.visible = true;
  }

  updatePops(dt) {
    for (const p of this.pops) {
      if (p.life <= 0) continue;
      p.life -= dt;
      const k = 1 - Math.max(p.life, 0) / 0.22;
      p.mesh.scale.setScalar(p.base * (1 + k * 1.4));
      p.mesh.material.opacity = 0.7 * (1 - k);
      if (p.life <= 0) p.mesh.visible = false;
    }
  }

  // ---------------------------------------------------------------- loop
  frame(now) {
    // A frame timestamp can predate this.last on the first frame; never step backwards.
    const dt = Math.min(Math.max((now - this.last) / 1000, 0), 0.05);
    this.last = now;

    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }

    const motion = this.scn ? MOTIONS[this.scn.motion.type] : null;
    const ctx = this.ctx();

    if (this.state === 'menu' && motion) {
      for (const t of this.targets) motion.update(t, dt, ctx);
      this.lookAtTargets(false);
    } else if (this.state === 'countdown') {
      this.countdown -= dt;
      const c = Math.ceil(this.countdown);
      if (c !== this.lastCount && c > 0) { this.lastCount = c; sfx.count(); }
      if (this.countdown <= 0) { sfx.go(); this.setState('running'); }
    } else if (this.state === 'running') {
      this.step(dt, motion, ctx);
    } else if (this.state === 'results' && motion) {
      for (const t of this.targets) motion.update(t, dt, ctx);
    }

    if (this.zoomLevel && this.scopeT < 1) {
      this.scopeT = Math.min(1, this.scopeT + dt / Math.max(0.01, this.settings.sniper.scopeTime));
      this.applyZoom();
    }
    this.camera.position.copy(this.eye);
    // A sniper shot kicks the view up for a moment; aim itself doesn't move.
    this.punch *= Math.exp(-dt * 11);
    this.camera.rotation.set(this.pitch + this.punch * 0.014, this.yaw, 0);
    this.updateTargetVisuals(dt);
    this.updatePops(dt);
    this.fx.update(dt);
    this.renderer.render(this.scene, this.camera);

    // The gun renders on top with its own camera, so it never clips walls.
    const live = this.state === 'countdown' || this.state === 'running' || this.state === 'paused';
    let mode = null;
    if (this.inspect && this.state === 'menu') mode = 'inspect';
    else if (live && this.gunVisible) mode = 'play';
    if (mode) {
      this.vm.update(dt, mode);
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.vm.render(this.renderer);
      this.renderer.autoClear = true;
    }
    if (this.hooks.onScope) this.hooks.onScope(this.zoomLevel ? this.scopeT : 0, this.zoomLevel);

    if (this.state === 'running' || this.state === 'countdown') this.hooks.onHud(this.hud());
  }

  updateTargetVisuals(dt) {
    const dim = this.setup && this.setup.headOnly;
    for (const t of this.targets) {
      t.flash = Math.max(0, t.flash - dt * 6);
      const hpK = t.maxHp === Infinity ? 1 : 0.45 + 0.55 * (t.hp / t.maxHp);
      const paint = (m, k, f) => {
        m.color.copy(this.targetColor).multiplyScalar(hpK * k).lerp(this.hitColor, f);
        m.emissive.copy(m.color);
        m.emissiveIntensity = 0.22 + f * 0.5;
      };
      let feet = t.pos.y - t.radius - t.half;
      let top = t.pos.y + t.radius + t.half;
      if (t.shape === 'agent') {
        // Only the part being hit lights up. In head-only mode the body goes
        // dark so the head reads as the target.
        const onHead = t.flashPart === 'head';
        paint(t.body, dim ? 0.3 : 1, onHead ? 0 : t.flash);
        paint(t.head, 1, onHead ? t.flash : 0);
        const r = AGENT.radius;
        const d = agentDims(t);
        const core = Math.max(0.001, d.top - 2 * r);
        t.parts.cyl.scale.y = core;
        t.parts.cyl.position.y = r + core / 2;
        t.parts.capT.position.y = r + core;
        t.parts.head.position.y = d.headY;
        feet = t.pos.y;
        top = t.pos.y + d.headY + AGENT.head;
      } else {
        paint(t.body, 1, t.flash);
      }
      const h = Math.max(0, feet);
      const s = (t.radius * 2.6) * (1 + h * 0.08);
      t.shadow.position.set(t.pos.x, 0.01, t.pos.z);
      t.shadow.scale.set(s, s, 1);
      t.shadow.material.opacity = Math.max(0.15, 1 - h * 0.12);
      t.shadow.visible = t.alive;
      if (t.bar) {
        t.bar.group.visible = t.alive;
        t.bar.group.position.set(t.pos.x, top + 0.25, t.pos.z);
        t.bar.group.quaternion.copy(this.camera.quaternion);
        t.bar.fill.scale.x = Math.max(0.001, t.hp / t.maxHp);
      }
    }
  }

  step(dt, motion, ctx) {
    const r = this.run;
    const w = this.scn.weapon;
    r.elapsed += dt;
    for (const t of this.targets) {
      if (t.alive) motion.update(t, dt, ctx);
      else if (t.respawnAt !== null && r.elapsed >= t.respawnAt) this.spawn(t);
    }
    this.trackVisibility(dt);

    if (this.knifeOut && this.firing && this.vm.knifeAttack('slash')) sfx.slash();
    const firing = !this.knifeOut && (this.firing || (w.type === 'beam' && this.settings.autoFire));
    if (w.type === 'beam' && firing) {
      // The gun cycles at its own rate while the beam is held.
      const rounds = this.vm.autoFire(dt, GUNS[this.gunId].fireInterval || 0.1);
      if (rounds) this.fireSound();
      r.fireTime += dt;
      const t = this.pick();
      for (let i = 0; i < rounds; i++) this.tracer(this.fwd, t ? this.pickDist : 0);
      if (t) {
        r.onTime += dt;
        if (this.pickPart === 'head' && t.shape === 'agent') r.headTime += dt;
        let dmg = w.dps * dt;
        if (t.hp !== Infinity) dmg = Math.min(dmg, t.hp);
        t.hp -= dmg;
        r.damage += dmg;
        r.score += dmg;
        t.flash = 1;
        t.flashPart = this.pickPart;
        r.tickTimer -= dt;
        if (r.tickTimer <= 0) { sfx.tick(); r.tickTimer = 0.09; }
        if (t.hp <= 0) this.kill(t);
      }
    }
    if (w.type === 'beam' && firing) this.measureLead(dt);

    while (r.timeline.length < Math.floor(r.elapsed) && r.timeline.length < this.scn.duration) {
      r.timeline.push(Math.round(r.score));
    }
    if (r.elapsed >= this.scn.duration) this.finish();
  }

  // How long each target has been in view (line of sight to head or chest),
  // so a kill can be scored as a reaction time from its first appearance.
  trackVisibility(dt) {
    for (const t of this.targets) {
      if (!t.alive) continue;
      let seen = true;
      if (this.covers.length) {
        seen = false;
        for (const y of [t.shape === 'agent' ? agentDims(t).headY : 0, 1.0]) {
          _v.set(t.pos.x, t.pos.y + y, t.pos.z).sub(this.eye);
          const dist = _v.length();
          if (this.coverHit(this.eye, _v.normalize()) > dist) { seen = true; break; }
        }
      }
      if (seen) { t.seenFor += dt; t.hiddenFor = 0; } else {
        t.hiddenFor += dt;
        if (t.hiddenFor > 0.25) t.seenFor = 0;
      }
    }
  }

  // Signed angular offset of the crosshair along the target's direction of
  // travel: positive means aiming ahead of it, negative means trailing.
  measureLead(dt) {
    this.updateForward();
    let best = null;
    let bestCos = Math.cos(10 * DEG);
    const c0 = _c;
    for (const t of this.targets) {
      if (!t.alive) continue;
      _v.subVectors(this.center(t, _p), this.eye).normalize();
      const c = _v.dot(this.fwd);
      if (c > bestCos) { bestCos = c; best = t; c0.copy(_p); }
    }
    if (!best) return;
    const dist = this.eye.distanceTo(c0);
    _v.subVectors(c0, this.eye).normalize(); // u
    _p.copy(best.vel).addScaledVector(_v, -best.vel.dot(_v)); // tangential velocity
    const angSpeed = _p.length() / dist;
    if (angSpeed < 0.2) return;
    _p.normalize();
    _q.copy(this.fwd).addScaledVector(_v, -this.fwd.dot(_v)); // aim error vector
    const r = this.run;
    r.leadSum += _q.dot(_p) * dt;
    r.errSum += _q.length() * dt;
    r.leadTime += dt;
  }

  hud() {
    const r = this.run;
    if (!r) return null;
    const beam = this.scn.weapon.type === 'beam';
    const acc = beam ? (r.fireTime > 0 ? r.onTime / r.fireTime : null) : (r.shots ? r.hits / r.shots : null);
    return {
      time: Math.max(0, this.scn.duration - r.elapsed),
      countdown: this.state === 'countdown' ? Math.ceil(this.countdown) : 0,
      score: Math.round(r.score),
      acc,
      kills: r.kills,
      fps: this.fps,
      ammo: this.sniper ? Infinity : null, // the AWP never runs dry
      zoom: this.zoomLevel ? OPERATOR.zooms[this.zoomLevel - 1] : 0,
      onTarget: beam && this.targets.some((t) => t.flash > 0.9),
    };
  }
}
