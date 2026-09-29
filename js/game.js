// 3D arena, first-person camera, targets, weapons and the run state machine.
import * as THREE from '../vendor/three.module.min.js';
import { MOTIONS, AGENT, agentDims } from './motion.js';
import { eyeOf, defaultSetup, setupKey, effectiveScenario, SNIPERS, FLASH_SCORE } from './scenarios.js';
import { degPerCount, verticalFov } from './settings.js';
import { sfx } from './audio.js';
import { Viewmodel } from './weapon.js';
import { GUNS, PRIMARY_GUNS, RECOIL } from './guns.js';
import { Effects } from './effects.js';

// macOS reports Ctrl+click as a left button; treat it as the right button.
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || '') || /Macintosh/.test(navigator.userAgent || '');

const DEG = Math.PI / 180;
const MAX_PITCH = 89 * DEG;
// CS2's jump and crouch, in metres (1 unit = 1 inch): jump impulse 301.993
// units/s against 800 units/s² of gravity, and the eye 18 units lower
// crouched.
const JUMP_SPEED = 301.993 * 0.0254;
const GRAVITY = 800 * 0.0254;
const CROUCH_DROP = 18 * 0.0254;
// Running: each gun's CS2 (or Valorant) speed, half as fast again, with
// CS2's own acceleration and friction (Source movement): on the ground,
// friction takes sv_friction of your speed off each second (or of
// sv_stopspeed, when slower), and the keys add up to sv_accelerate times
// the run speed per second toward where they point, never past the run
// speed. So you reach full speed in about 0.45 s, stop about 0.5 s after
// letting go, and in about 0.13 s by counter-strafing. In the air the
// keys can only add 30 units/s along where they point (sv_airaccelerate).
const RUN_SCALE = 1.5;
const SV_ACCELERATE = 5.5;
const SV_FRICTION = 5.2;
const SV_STOPSPEED = 80 * 0.0254;
const SV_AIRACCELERATE = 12;
const AIR_WISH_CAP = 30 * 0.0254;
// Apex's slide: Shift from a run for a burst of speed, 1.8 times the run
// speed (about 15 m/s), that friction bleeds off over about a second, low
// to the ground (the burst again only after 0.8 s). Jump out of it to keep
// the speed.
const SLIDE_BOOST = 1.8; // start speed, times the run speed
const SLIDE_END = 0.7; // ends below this share of the run speed
const SLIDE_DRAG = 0.6; // exponential slowdown per second
const SLIDE_FRICTION = 3; // and linear, m/s²
const SLIDE_MAX = 1.1; // seconds
// Jett's Tailwind: E dashes about 6.5 m in 0.2 s the way you're moving
// (forward if you aren't), even in the air. Two charges, each back 3 s
// after it's used.
const DASH_DIST = 6.5;
const DASH_TIME = 0.2;
const DASH_CHARGES = 2;
const DASH_RECHARGE = 3;
// Jett's Updraft: Q launches you about 4 m straight up after a 0.2 s
// windup, keeping your momentum, on the ground or in the air. Two charges,
// each back 4 s after it's used. Her Drift: hold Space while falling to
// float down slowly and steer more freely.
const UPDRAFT_HEIGHT = 4;
const UPDRAFT_WINDUP = 0.2;
const UPDRAFT_CHARGES = 2;
const UPDRAFT_RECHARGE = 4;
const DRIFT_FALL = 1.8; // m/s: the fastest you fall while drifting
const COUNTDOWN = 3;

// Share of frame intervals (seconds) that missed the display's refresh:
// the refresh interval is taken from the quickest fifth of the frames, and a
// frame half again as long as that came a refresh late.
function lateShare(ints) {
  if (ints.length < 10) return 0;
  const sorted = ints.slice().sort((a, b) => a - b);
  const vsync = sorted[Math.floor(sorted.length * 0.2)];
  let late = 0;
  for (const d of ints) if (d > vsync * 1.5) late++;
  return late / ints.length;
}

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

// A soft round glow, for Phoenix's Curveball and its pop.
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.22, 'rgba(255,238,200,0.95)');
  grad.addColorStop(0.55, 'rgba(255,150,60,0.4)');
  grad.addColorStop(1, 'rgba(255,110,30,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Dodge flash: how far you must look away from the Curveball when it pops.
// Within FULL degrees of it you're blind for the whole FLASH_BLIND seconds;
// the flash weakens out to SAFE degrees (a 103° view ends 51.5° out, so one
// just off-screen still catches you a little), and past that you've dodged.
const FLASH_FULL = 40;
const FLASH_SAFE = 75;
const FLASH_BLIND = 1.1; // s, Phoenix's longest blind (full white)
const FLASH_RISE = 0.05; // s, whiting out
const FLASH_FADE = 0.6; // s, clearing afterwards, from the middle out
const CURVEBALL_TRAIL = 7;

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
    // Low latency: a desynchronized context draws straight to the screen
    // instead of waiting a frame for the page compositor, so the view keeps
    // up with the mouse (Chrome and Edge; other browsers ignore it).
    const low = !settings.render || settings.render.lowLatency !== false;
    const context = canvas.getContext('webgl2', {
      antialias: true, alpha: false, depth: true, stencil: false, premultipliedAlpha: true,
      preserveDrawingBuffer: false, powerPreference: 'high-performance', desynchronized: low,
    });
    this.renderer = new THREE.WebGLRenderer({ canvas, context: context || undefined, antialias: true, powerPreference: 'high-performance' });
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
    this.vel = new THREE.Vector3(); // on the ground, m/s (WASD)
    this.keys = new Set(); // movement keys held
    this.baseEye = 1.7; // eye height standing on the floor
    this.jumpY = 0; // feet above the floor, m (in the air, or on a crate)
    this.vy = 0;
    this.grounded = true; // on the floor or a crate top
    this.crouching = false; // Shift held
    this.crouchT = 0; // 0 standing .. 1 crouched
    this.sliding = null; // { t, dir, speed } while sliding
    this.dashing = null; // { t, dir } while dashing
    this.dashCharges = DASH_CHARGES;
    this.dashRecharge = 0; // seconds until the next charge is back
    this.updraftCharges = UPDRAFT_CHARGES;
    this.updraftRecharge = 0;
    this.updraftWind = null; // seconds of windup left before an updraft lifts you
    this.drifting = false; // Space held: fall slowly
    this.moveClock = 0; // seconds of movement, for the slide's cooldown
    this.lastSlide = -9;
    this.viewRoll = 0; // the view tilts a little in a slide
    this.fovKick = 0; // degrees, wider for a moment in a dash
    this.rifleId = null; // the rifle in slot 2 of a sniping run
    this.lastSlot = 'knife'; // where 'toggle' goes back to
    this.recoil = { p: 0, y: 0, index: 0, last: -9 }; // view kick (radians) and place in the spray
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
      glow: glowTexture(),
    };
    this.curveballs = []; // Phoenix's flashes in flight (or popping)
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
    this.zoomLevel = 0; // 0 unscoped, 1 first zoom, 2 second zoom
    this.scopeT = 0; // 0..1 progress into the current zoom
    this.scopeAge = 0; // seconds since scoping in from unscoped
    this.slot = 'gun'; // 'gun' or 'knife': what the player holds in a run
    this.lastWheel = 0;
    this.vm = new Viewmodel(this.renderer);
    // Draw sounds play as the weapon comes up, in time with its animation.
    this.vm.onDraw = (id) => {
      if (this.state !== 'running' && this.state !== 'countdown') return;
      if (GUNS[id].melee) sfx.knifeDraw();
      else sfx.gunDraw(id);
    };
    // Largest point sprite the GPU draws, for the effect particles.
    const gl = this.renderer.getContext();
    this.maxPointSize = (gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) || [1, 64])[1];
    this.vm.maxPointSize = this.maxPointSize;
    // Automatic resolution: the share of the device pixel ratio drawn now,
    // lowered when frames run slow and raised again when there's headroom.
    this.dynScale = 1;
    this.perf = { frames: 0, time: 0, good: 0 };
    this.applySettings(settings);
    // Compile the effects' shaders now, not on the first shot.
    const unprime = this.fx.prime();
    try { this.renderer.compile(this.scene, this.camera); } catch (e) { /* only an optimisation */ }
    unprime();

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
    if (this.preloaded) this.preloadWeapons(); // the equipped gun may have changed
  }

  // Per-gun skins, stickers and sounds from the Weapon tab.
  setSkins(skins) {
    this.skins = skins;
    this.refreshGun();
    if (!this.preloaded) {
      this.preloaded = true;
      setTimeout(() => this.preloadWeapons(), 300);
    }
  }

  // The gun for this scenario: the AWP in sniping, the primary otherwise.
  get gunId() {
    if (this.scn && this.scn.weapon.type === 'sniper') return this.slot === 'rifle' && this.rifleId ? this.rifleId : 'awp';
    return this.settings.weapon.primary;
  }

  // The AWP is in hand: sniping runs start with it; 2 swaps to a rifle.
  get awpHeld() {
    return this.sniper && this.slot === 'gun';
  }

  // What the player holds: the scenario's gun, or the knife.
  get heldId() {
    return this.slot === 'knife' ? 'karambit' : this.gunId;
  }

  get knifeOut() {
    return this.slot === 'knife';
  }

  // Get the equipped gun, the AWP and the knife loaded and ready while the
  // menu is idle, so nothing loads or compiles in the middle of a run.
  preloadWeapons() {
    for (const id of [this.settings.weapon.primary, 'awp', 'karambit']) {
      if (this.skins[id]) this.vm.preload(id, this.skins[id]);
    }
  }

  // Automatic resolution. It keeps frames coming at the display's refresh
  // rate, not just above some fixed rate: a game that can't keep up with the
  // screen shows each frame for one refresh or two in turn, which judders on
  // slow, small aiming movements and adds lag (so small corrections
  // overshoot). The display's frame interval is read from the quickest
  // frames; when more than one frame in ten over a second comes late (or
  // the rate falls under 50 fps), the resolution steps down. Changing it
  // resizes the drawing buffer, which can hitch a frame, so during a run it
  // only steps down (at most once a second) and steps back up between runs
  // when the last one kept pace.
  adaptResolution(rawDt) {
    const render = this.settings.render || {};
    if (render.auto === false) return;
    const p = this.perf;
    if (rawDt > 0.25) { p.frames = 0; p.time = 0; p.ints = []; return; } // a stall or a hidden tab, not load
    if (!p.ints) p.ints = [];
    p.ints.push(rawDt);
    p.frames++;
    p.time += rawDt;
    p.runFrames = (p.runFrames || 0) + 1;
    p.runTime = (p.runTime || 0) + rawDt;
    if (p.time < 1) return;
    const late = lateShare(p.ints);
    const fps = p.frames / p.time;
    p.runLate = (p.runLate || 0) + late * p.frames;
    p.frames = 0;
    p.time = 0;
    p.ints = [];
    this.pacing = { fps, late };
    if ((fps < 50 || late > 0.1) && this.dynScale > 0.5) {
      this.dynScale = Math.max(0.5, this.dynScale - (fps < 35 || late > 0.3 ? 0.2 : 0.1));
      this.applyResolution();
    }
  }

  // Between runs: give resolution back if the last run kept pace.
  recoverResolution() {
    const p = this.perf;
    const fps = p.runTime > 3 ? p.runFrames / p.runTime : 0;
    const late = p.runFrames ? (p.runLate || 0) / p.runFrames : 1;
    p.runFrames = 0;
    p.runTime = 0;
    p.runLate = 0;
    p.frames = 0;
    p.time = 0;
    p.ints = [];
    if (fps >= 50 && late < 0.03 && this.dynScale < 1) {
      this.dynScale = Math.min(1, this.dynScale + 0.1);
      this.applyResolution();
    }
  }

  applyResolution() {
    if (Math.abs(this.renderer.getPixelRatio() - this.pixelRatio) > 1e-3) this.resize();
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

  // CS:GO's headshot sound, unless it's turned off in the Weapon tab.
  headshotSound() {
    if (this.settings.weapon.headshot !== false) sfx.headshot();
  }

  fireSound() {
    if (!this.settings.weapon.sounds) return;
    const skin = this.skins[this.gunId];
    const choice = skin && skin.sound && skin.sound !== 'auto' ? skin.sound : GUNS[this.gunId].sound(skin || {});
    sfx.gun(choice);
  }

  // Pixel ratio to draw at: a fixed share of the device's, or the automatic one.
  get pixelRatio() {
    const render = (this.settings && this.settings.render) || {};
    const base = Math.min(window.devicePixelRatio || 1, 2);
    if (render.auto !== false) return Math.max(Math.min(base, 0.75), base * this.dynScale);
    return base * (render.scale || 1);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.hipFov = verticalFov(this.settings ? this.settings.fov : 103, w / h);
    this.applyZoom();
    this.vm.setAspect(w / h);
  }

  // The sniper handling chosen in Settings.
  get sniperSpec() {
    return SNIPERS[this.settings.sniper.handling] || SNIPERS.cs2;
  }

  // Magnification of zoom `level` (1 or 2) against the player's own FOV. CS2
  // sets the scoped FOV itself (4:3 horizontal degrees); the Operator scales.
  zoomMag(level) {
    const spec = this.sniperSpec;
    if (spec.zoomFov) {
      const scopedV = 2 * Math.atan(Math.tan(((spec.zoomFov[level - 1] / 2) * Math.PI) / 180) * 0.75);
      return Math.tan((this.hipFov * Math.PI) / 360) / Math.tan(scopedV / 2);
    }
    return spec.zooms[level - 1];
  }

  // Mouse sensitivity multiplier while scoped at `level`.
  scopedSensitivity(level) {
    const spec = this.sniperSpec;
    const ratio = this.settings.sniper.scopedSens; // zoom_sensitivity_ratio in CS2
    return spec.zoomFov ? (ratio * spec.zoomFov[level - 1]) / 90 : ratio / spec.zooms[level - 1];
  }

  // How settled the scope is, 0..1: hip-fire spread closes as it settles.
  get scopeSettled() {
    if (!this.zoomLevel) return 0;
    const spec = this.sniperSpec;
    return spec.settleTime ? Math.min(1, this.scopeAge / spec.settleTime) : this.scopeT;
  }

  // Current magnification, eased in over the scope-in time.
  get zoom() {
    if (!this.zoomLevel) return 1;
    const z = this.zoomMag(this.zoomLevel);
    return 1 + (z - 1) * this.scopeT;
  }

  applyZoom() {
    const half = (this.hipFov * Math.PI) / 360;
    this.camera.fov = (Math.atan(Math.tan(half) / this.zoom) * 360) / Math.PI + (this.zoomLevel ? 0 : this.fovKick || 0);
    this.camera.updateProjectionMatrix();
  }

  setZoom(level) {
    if (level === this.zoomLevel) return;
    // Going between zoom levels keeps the scope settled; only scoping in
    // from unscoped starts it over.
    if (!this.zoomLevel && level) this.scopeAge = 0;
    this.scopeT = this.zoomLevel && level ? Math.min(this.scopeT, 0.5) : 0;
    this.zoomLevel = level;
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
    this.clearCurveballs();
    this.resetTargets();
    this.lookAtTargets(true);
    this.captureReflections();
    // Compile the Curveball's shaders now, not on the first throw.
    if (scn.motion.type === 'flash') {
      const probe = this.makeCurveball();
      this.scene.add(probe.group);
      try { this.renderer.compile(this.scene, this.camera); } catch (e) { /* only an optimisation */ }
      this.disposeCurveball(probe);
    }
  }

  makeTarget(spec, hp) {
    const mat = () => new THREE.MeshStandardMaterial({
      color: this.targetColor, roughness: 0.42, metalness: 0.0,
      emissive: this.targetColor, emissiveIntensity: 0.22,
    });
    const t = {
      shape: spec.shape,
      color: spec.color ? new THREE.Color(spec.color) : null, // its own colour (Phoenix), else the setting
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
        if (o.isMesh) { o.geometry.dispose(); if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
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

  // What the gun reflects: the room around the player (without the
  // targets), captured once per arena from the eye, with lights that show
  // only in reflections: strips along the ceiling and round the walls, and
  // softboxes round the player like a photo studio's. The viewmodel turns it
  // with the view, so the room stays put in the reflections as you look
  // around.
  captureReflections() {
    const a = this.scn.arena;
    const rig = new THREE.Group();
    const e = this.eye;
    const light = (w, h, k, x, y, z, face) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.98, 0.95).multiplyScalar(k), side: THREE.DoubleSide }),
      );
      m.position.set(x, y, z);
      if (face) m.lookAt(face);
      rig.add(m);
    };
    const depth = a.zMax - a.zMin;
    const cz = (a.zMin + a.zMax) / 2;
    const across = Math.max(2, Math.round(a.w / 9));
    for (let i = 0; i < across; i++) {
      light(0.7, depth - 2, 6, (i + 0.5 - across / 2) * (a.w / across), a.h - 0.05, cz, null);
      rig.children[rig.children.length - 1].rotation.x = Math.PI / 2;
    }
    const band = Math.min(3.4, a.h * 0.4);
    const inside = (x, z) => new THREE.Vector3(x, band, z);
    light(a.w - 1, 0.35, 3, 0, band, a.zMin + 0.05, inside(0, cz));
    light(a.w - 1, 0.35, 3, 0, band, a.zMax - 0.05, inside(0, cz));
    light(depth - 1, 0.35, 3, -a.w / 2 + 0.05, band, cz, inside(0, cz));
    light(depth - 1, 0.35, 3, a.w / 2 - 0.05, band, cz, inside(0, cz));
    // Softboxes: one overhead and one on each side of the player, with a
    // long low strip under each that polished metal shows as a horizon.
    // All round, so the gun looks as bright whichever way you face.
    const back = Math.min(3.5, a.zMax - e.z - 0.2);
    light(2.4, 0.8, 3, e.x, e.y + 2.6, e.z - 0.5, e);
    for (const [dx, dz] of [[0, back], [0, -3.5], [-3.5, 0], [3.5, 0]]) {
      light(3, 1.3, 1.5, e.x + dx, e.y + 0.75, e.z + dz, e);
      light(6, 0.25, 1.2, e.x + dx, e.y - 0.15, e.z + dz, e);
    }
    const hidden = [];
    const lights = [];
    for (const o of this.scene.children) {
      if (o.isLight) lights.push([o, o.intensity]);
      if (o === this.arena || o.isLight || !o.visible) continue;
      o.visible = false;
      hidden.push(o);
    }
    // The room lit up brighter than it's drawn, so polished metal reads as
    // polished metal rather than as a dark mirror.
    for (const [l, k] of lights) l.intensity = k * 2.2;
    this.scene.add(rig);
    try {
      if (!this.pmrem) this.pmrem = new THREE.PMREMGenerator(this.renderer);
      this.vm.setEnvironment(this.pmrem.fromScene(this.scene, 0, 0.05, 400, { position: e }));
    } catch (err) {
      console.warn('Trackline: no room reflections', err);
    }
    this.scene.remove(rig);
    rig.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    for (const o of hidden) o.visible = true;
    for (const [l, k] of lights) l.intensity = k;
  }

  ctx() {
    if (!this.flashCtx) {
      // Phoenix's hooks into the game (the dodge-flash motion).
      this.flashCtx = {
        facing: (t) => this.facing(t, 50),
        curveball: (t, path) => this.throwCurveball(t, path),
        peekLost: (t) => this.peekLost(t),
      };
    }
    return { scn: this.eff, eye: this.eye, targets: this.targets, aimPoint: this.aimPoint, ...this.flashCtx };
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
  // Change what the player holds: 'gun' (1: the scenario's gun, the AWP
  // when sniping), 'rifle' (2, sniping runs: a rifle, and pressed again the
  // next one, so every gun is on hand), 'knife' (3), 'toggle' (back to the
  // last one), or 'next' / 'prev' (the mouse wheel, round the slots).
  switchWeapon(slot) {
    const live = this.state === 'running' || this.state === 'countdown';
    if (!live) return;
    const slots = this.sniper ? ['gun', 'rifle', 'knife'] : ['gun', 'knife'];
    let next = slot;
    if (slot === 'toggle') next = slots.includes(this.lastSlot) && this.lastSlot !== this.slot ? this.lastSlot : (this.slot === 'knife' ? 'gun' : 'knife');
    else if (slot === 'next' || slot === 'prev') next = slots[(slots.indexOf(this.slot) + (slot === 'next' ? 1 : slots.length - 1)) % slots.length];
    if (!slots.includes(next)) return;
    if (next === this.slot) {
      if (next !== 'rifle') return;
      this.rifleId = PRIMARY_GUNS[(PRIMARY_GUNS.indexOf(this.rifleId) + 1) % PRIMARY_GUNS.length];
    } else {
      this.lastSlot = this.slot;
      this.slot = next;
    }
    this.firing = false;
    this.wasFiring = false;
    if (next !== 'gun' || !this.sniper) this.setZoom(0); // only the AWP scopes
    this.refreshGun();
  }

  onWheel(e) {
    if (document.pointerLockElement !== this.canvas) return;
    e.preventDefault();
    // Trackpads send a stream of wheel events; one swap per flick.
    const now = performance.now();
    if (Math.abs(e.deltaY) < 1 || now - this.lastWheel < 250) return;
    this.lastWheel = now;
    this.switchWeapon(e.deltaY > 0 ? 'next' : 'prev');
  }

  // F: spin the knife around the finger.
  inspectWeapon() {
    const live = this.state === 'running' || this.state === 'countdown';
    if (live && this.knifeOut && this.vm.knifeInspect()) sfx.knifeInspect();
  }

  start() {
    this.recoverResolution();
    this.slot = this.scn.startSlot || 'gun';
    this.lastSlot = 'knife';
    if (!PRIMARY_GUNS.includes(this.rifleId)) this.rifleId = this.settings.weapon.primary;
    Object.assign(this.recoil, { p: 0, y: 0, index: 0, last: -9 });
    this.run = {
      scenario: this.scn.id,
      free: !!this.settings.freePlay, // no time limit
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
      throws: 0, // dodge flash: Curveballs thrown, dodged, and those that caught you
      dodges: 0,
      flashed: 0,
      turnSum: 0, // seconds from a throw to turning your back on it, for the dodged ones
      turnCount: 0,
      lost: 0, // peeks Phoenix won
      lastShot: -99,
      nextShot: 0, // run time the gun may fire its next round (held fire)
      timeline: [],
      tickTimer: 0,
    };
    this.firing = false;
    this.setZoom(0);
    this.wasFiring = false;
    this.pressAt = null;
    // Every run starts from the scenario's spot, standing still.
    const [ex, ey, ez] = eyeOf(this.scn);
    this.eye.set(ex, ey, ez);
    this.baseEye = ey;
    this.jumpY = 0;
    this.vy = 0;
    this.grounded = true;
    this.crouchT = 0;
    this.vel.set(0, 0, 0);
    this.vm.moving = 0;
    this.vm.lean = 0;
    this.sliding = null;
    this.dashing = null;
    this.dashCharges = DASH_CHARGES;
    this.dashRecharge = 0;
    this.updraftCharges = UPDRAFT_CHARGES;
    this.updraftRecharge = 0;
    this.updraftWind = null;
    this.lastSlide = -9;
    this.viewRoll = 0;
    this.fovKick = 0;
    this.applyZoom();
    this.clearCurveballs();
    this.resetTargets();
    this.lookAtTargets(true);
    this.pitch = Math.max(-0.35, Math.min(0.35, this.pitch));
    this.countdown = COUNTDOWN;
    this.lastCount = COUNTDOWN + 1;
    this.setState('countdown');
    this.vm.pickUp(); // the gun is picked up as the countdown starts
  }

  setState(s) {
    this.state = s;
    this.refreshGun();
    this.hooks.onState(s);
  }

  // Finish a run with no time limit from the pause screen: its results.
  endRun() {
    if (this.run && this.state === 'paused') this.finish();
  }

  pause() {
    if (this.state === 'running' || this.state === 'countdown') {
      this.pausedFrom = this.state;
      this.firing = false;
      this.keys.clear();
      this.crouching = false;
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
    this.clearCurveballs();
    this.run = null;
    this.setState('menu');
    this.resetTargets();
  }

  finish() {
    const r = this.run;
    const beam = this.scn.weapon.type === 'beam';
    const accuracy = beam ? (r.fireTime > 0 ? r.onTime / r.fireTime : 0) : (r.shots ? r.hits / r.shots : 0);
    if (!r.free) while (r.timeline.length < this.scn.duration) r.timeline.push(Math.round(r.score));
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
      flash: this.scn.motion.type === 'flash' ? {
        peek: !!this.eff.motion.peek,
        throws: r.throws,
        dodges: r.dodges,
        flashed: r.flashed,
        turn: r.turnCount ? r.turnSum / r.turnCount : null,
        lost: r.lost,
      } : null,
      gun: this.gunId,
      timeline: r.timeline,
      free: r.free, // no time limit: shown, not saved
      duration: r.free ? r.elapsed : this.scn.duration,
      fps: Math.round(this.fps),
    };
    this.firing = false;
    this.clearCurveballs();
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
    const scoped = this.zoomLevel ? this.scopedSensitivity(this.zoomLevel) : 1;
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
    // When, on the run clock, the trigger was pulled: between frames, so
    // held fire can start exactly then rather than on a frame boundary.
    if (this.run) this.pressAt = this.run.elapsed + Math.min(0.05, Math.max(0, (performance.now() - this.last) / 1000));
    if (this.scn.weapon.type === 'click') this.shoot();
    else if (this.awpHeld) this.sniperShoot();
    else if (this.sniper && this.slot === 'rifle' && this.run && this.run.elapsed >= this.run.nextShot) {
      // A rifle in a sniping run: the first round leaves on the click itself
      // (so even the quickest tap fires), the rest from step(), at its own
      // rate while held.
      this.run.nextShot = this.run.elapsed + (GUNS[this.gunId].fireInterval || 0.1);
      this.rifleShot();
    }
  }

  onMouseUp(e) {
    if (e.button === 0 && !(e.ctrlKey && IS_MAC)) this.firing = false;
    if (e.button === 2 || (e.button === 0 && e.ctrlKey && IS_MAC)) this.scopeRelease();
  }

  // Right mouse button, or Ctrl+click on a Mac. Only the AWP scopes.
  // Toggle cycles first zoom, second zoom, off; hold keeps the first zoom
  // while held.
  scopePress() {
    const live = this.state === 'running' || this.state === 'countdown';
    if (!this.awpHeld || !live) return;
    if (this.settings.sniper.scopeMode === 'hold') this.setZoom(1);
    else this.setZoom((this.zoomLevel + 1) % 3);
  }

  scopeRelease() {
    if (this.awpHeld && this.settings.sniper.scopeMode === 'hold') this.setZoom(0);
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
    if (this.pickPart === 'head' && t.shape === 'agent') this.headshotSound();
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
    this.kickRecoil();
    if (t) {
      r.hits++;
      r.score += w.points;
      if (w.headBonus && this.pickPart === 'head' && t.shape === 'agent') {
        r.score += w.headBonus;
        r.headshots++;
      }
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
    this.fx.shot(this.muzzleStart(_from), _to, hitDist > 0);
  }

  // Where shots start in the world: where the muzzle is drawn. The gun renders
  // with its own camera, so take the muzzle's screen position and put the
  // start on the world ray through that pixel, at the depth that gives the
  // same apparent size. Shots then leave the barrel exactly, in any pose,
  // sway or recoil. Also sets the world camera to the current view.
  muzzleStart(out) {
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
    this.camera.rotation.set(this.pitch, this.yaw, this.viewRoll);
    this.camera.updateMatrixWorld();
    this.updateForward();
    out.set(nx, ny, 0.5).unproject(this.camera).sub(this.eye).normalize();
    return out.multiplyScalar(depth / Math.max(0.2, out.dot(this.fwd))).add(this.eye);
  }

  // Sniper shot, with the chosen handling (CS2 AWP or Valorant Operator):
  // one shot per bolt, hip-fire spread that closes as the scope settles.
  sniperShoot() {
    const r = this.run;
    const w = this.scn.weapon;
    const spec = this.sniperSpec;
    if (r.elapsed - r.lastShot < spec.fireInterval) { sfx.dry(); return; }
    r.lastShot = r.elapsed;
    r.shots++;
    const settled = this.scopeSettled;
    if (settled < 1) r.unscoped++;
    this.vm.shot(true);
    this.fireSound();
    this.updateForward();
    const dir = this.fwd.clone();
    const spread = spec.hipSpread * DEG * (1 - settled);
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
      // The AWP kills with one hit anywhere.
      t.hp = 0;
      t.flash = 1;
      t.flashPart = part === 'head' ? 'head' : 'body';
      if (t.hp <= 0) {
        r.score += w.points + (part === 'head' ? w.headBonus : 0);
        if (part === 'head') r.headshots++;
        this.kill(t);
      } else {
        if (part === 'head') this.headshotSound();
        this.hooks.onHit(false);
      }
    } else {
      r.score = Math.max(0, r.score - w.missPenalty);
    }
    // Out of the scope after the shot; you scope in again yourself.
    if (this.settings.sniper.unscope) this.setZoom(0);
  }

  // One round from a rifle in a sniping run. A headshot kills; body and leg
  // hits take the gun's `bodyShots` (M4A1-S 5, XM7 3, the others 4). Misses
  // cost the AWP's penalty scaled by fire rate, so a spray costs no more a
  // second than missing with the AWP.
  rifleShot() {
    const r = this.run;
    const w = this.scn.weapon;
    const gun = GUNS[this.gunId];
    r.shots++;
    this.vm.shot();
    if (this.settings.weapon.sounds) this.fireSound();
    else sfx.shot();
    const t = this.pick();
    this.tracer(this.fwd, t ? this.pickDist : 0);
    this.kickRecoil();
    if (!t) {
      r.score = Math.max(0, r.score - w.missPenalty * Math.min(1, (gun.fireInterval || 0.1) / this.sniperSpec.fireInterval));
      return;
    }
    r.hits++;
    const head = this.pickPart === 'head';
    t.hp = head ? 0 : t.hp - t.maxHp / (gun.bodyShots || 4);
    t.flash = 1;
    t.flashPart = head ? 'head' : 'body';
    if (t.hp <= t.maxHp * 1e-6) {
      r.score += w.points + (head ? w.headBonus : 0);
      if (head) r.headshots++;
      this.kill(t);
    } else {
      this.hooks.onHit(false);
    }
  }

  // Recoil (clicking and sniping scenarios): each round of a spray kicks
  // the view by the gun's pattern (RECOIL in guns.js), and the kick settles
  // back once you stop firing, as in CS2. The view itself moves, so shots
  // land on the crosshair and you pull down against the climb.
  kickRecoil() {
    const kind = GUNS[this.gunId] && GUNS[this.gunId].recoil;
    if (!kind || this.knifeOut || this.settings.weapon.recoil === false || !this.run) return;
    const R = this.recoil;
    const pat = RECOIL[kind];
    const r = this.run;
    if (r.elapsed - R.last > 0.35) R.index = 0;
    const n = pat.up.length;
    const i = R.index < n ? R.index : n - 4 + ((R.index - n) % 4);
    const dp = pat.up[i] * DEG;
    const dy = -pat.right[i] * DEG; // yaw grows to the left
    R.p += dp;
    R.y += dy;
    this.pitch = Math.min(MAX_PITCH, this.pitch + dp);
    this.yaw += dy;
    R.index++;
    R.last = r.elapsed;
  }

  settleRecoil(dt) {
    const R = this.recoil;
    if (!R.p && !R.y) return;
    // Slowly while the spray goes on, quickly once it stops.
    const rate = this.run.elapsed - R.last > 0.12 ? 7 : 1.2;
    const k = 1 - Math.exp(-dt * rate);
    const dp = R.p * k;
    const dy = R.y * k;
    R.p -= dp;
    R.y -= dy;
    this.pitch -= dp;
    this.yaw -= dy;
    if (Math.abs(R.p) < 1e-5 && Math.abs(R.y) < 1e-5) { R.p = 0; R.y = 0; }
  }

  // ------------------------------------------------------------ dodge flash
  // Whether the view points within `deg` degrees of target t's head.
  facing(t, deg) {
    this.updateForward();
    _v.set(t.pos.x, t.pos.y + agentDims(t).headY, t.pos.z).sub(this.eye).normalize();
    return this.fwd.dot(_v) > Math.cos(deg * DEG);
  }

  // The orb: a white-hot core in an orange glow, with a fading trail.
  makeCurveball() {
    if (!this.orbGeo) this.orbGeo = new THREE.SphereGeometry(0.11, 16, 10);
    const group = new THREE.Group();
    const core = new THREE.Mesh(this.orbGeo, new THREE.MeshBasicMaterial({ color: 0xfff6e0 }));
    const glowMat = (opacity) => new THREE.SpriteMaterial({
      map: this.tex.glow, color: 0xffa24c, transparent: true, opacity,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const glow = new THREE.Sprite(glowMat(1));
    glow.scale.setScalar(0.9);
    const trail = [];
    for (let i = 0; i < CURVEBALL_TRAIL; i++) {
      const sp = new THREE.Sprite(glowMat(0.5 * (1 - i / CURVEBALL_TRAIL)));
      sp.scale.setScalar(0.8 * (1 - i / (CURVEBALL_TRAIL + 2)));
      trail.push(sp);
      group.add(sp);
    }
    group.add(core, glow);
    return { group, core, glow, trail, hist: [] };
  }

  disposeCurveball(b) {
    this.scene.remove(b.group);
    b.core.material.dispose();
    b.glow.material.dispose();
    for (const sp of b.trail) sp.material.dispose();
  }

  clearCurveballs() {
    for (const b of this.curveballs) this.disposeCurveball(b);
    this.curveballs = [];
    this.blind = null;
  }

  // How the flash looks now, or null: `a` the white's opacity and `clear`
  // how far the clear patch has spread from the middle (0 none, 1 to the
  // corners). Every flash plays the same way on the run clock: a fast
  // white-out, full white while it lasts, then it clears from the middle
  // of the screen outward as the edges fade, like Valorant's.
  flashLook() {
    const B = this.blind;
    if (!B) return null;
    if (B.t < FLASH_RISE) return { a: 1 - (1 - B.t / FLASH_RISE) ** 2, clear: 0 };
    if (B.t < B.hold) return { a: 1, clear: 0 };
    const u = Math.min(1, (B.t - B.hold) / FLASH_FADE);
    const e = u * u * (3 - 2 * u);
    return { a: 1 - u * u, clear: e * 1.35 };
  }

  // Phoenix throws: the orb flies a curve from p0 past p1 to p2 and pops
  // there `fuse` seconds after the throw.
  throwCurveball(t, path) {
    if (this.state !== 'running') return;
    const b = this.makeCurveball();
    b.p0 = new THREE.Vector3().fromArray(path.p0);
    b.p1 = new THREE.Vector3().fromArray(path.p1);
    b.p2 = new THREE.Vector3().fromArray(path.p2);
    b.fuse = path.fuse;
    b.age = 0;
    b.turned = null; // seconds after the throw you looked FLASH_SAFE° away
    b.popped = false;
    this.curveballs.push(b);
    this.scene.add(b.group);
    sfx.curveball();
    this.placeCurveball(b, 0);
  }

  // Place the orb (and its trail) at u (0..1) along its curve.
  placeCurveball(b, u) {
    const k = 1 - u;
    _c.copy(b.p0).multiplyScalar(k * k).addScaledVector(b.p1, 2 * k * u).addScaledVector(b.p2, u * u);
    b.core.position.copy(_c);
    b.glow.position.copy(_c);
    b.glow.scale.setScalar(1.25 + 0.25 * Math.sin(b.age * 55));
    b.hist.unshift(_c.clone());
    if (b.hist.length > CURVEBALL_TRAIL) b.hist.pop();
    b.trail.forEach((sp, i) => {
      const h = b.hist[Math.min(i + 1, b.hist.length - 1)];
      sp.position.copy(h);
      sp.visible = i + 1 < b.hist.length;
    });
    return _c;
  }

  updateCurveballs(dt) {
    if (this.blind) {
      this.blind.t += dt;
      if (this.blind.t >= this.blind.hold + FLASH_FADE) this.blind = null;
    }
    for (let i = this.curveballs.length - 1; i >= 0; i--) {
      const b = this.curveballs[i];
      b.age += dt;
      if (!b.popped) {
        const pos = this.placeCurveball(b, Math.min(1, b.age / b.fuse));
        // Reaction: the moment you turned your back on the orb.
        if (b.turned === null) {
          this.updateForward();
          _v.copy(pos).sub(this.eye).normalize();
          if (this.fwd.dot(_v) < Math.cos(FLASH_SAFE * DEG)) b.turned = b.age;
        }
        if (b.age >= b.fuse) this.popCurveball(b, pos.clone());
      } else {
        // The pop: a burst of light that swells and fades.
        const k = (b.age - b.fuse) / 0.35;
        b.glow.scale.setScalar(1 + 9 * Math.min(1, k * 3));
        b.glow.material.opacity = Math.max(0, 1 - k);
        if (k >= 1) {
          this.disposeCurveball(b);
          this.curveballs.splice(i, 1);
        }
      }
    }
  }

  // The flash goes off: blind if you're looking at it (in the open),
  // partly if it's off to the side, not at all once you've turned away.
  popCurveball(b, pos) {
    const r = this.run;
    b.popped = true;
    b.core.visible = false;
    for (const sp of b.trail) sp.visible = false;
    b.glow.position.copy(pos);
    this.updateForward();
    _v.copy(pos).sub(this.eye);
    const dist = _v.length();
    _v.divideScalar(dist);
    const blocked = this.coverHit(this.eye, _v) < dist - 0.1;
    const angle = Math.acos(Math.max(-1, Math.min(1, this.fwd.dot(_v)))) / DEG;
    const strength = blocked ? 0 : Math.max(0, Math.min(1, (FLASH_SAFE - angle) / (FLASH_SAFE - FLASH_FULL)));
    r.throws++; // counted as it pops, so one still in the air at the end doesn't count
    sfx.flashPop();
    if (strength < 0.15) {
      r.dodges++;
      r.score += FLASH_SCORE.dodge;
      if (b.turned !== null) {
        r.turnSum += b.turned;
        r.turnCount++;
      }
      return;
    }
    r.flashed++;
    r.score = Math.max(0, r.score - FLASH_SCORE.flashed * strength);
    sfx.flashed(strength);
    // A glancing flash looks the same, only shorter.
    this.blind = { t: 0, hold: Math.max(0.2, FLASH_BLIND * strength) };
  }

  // Phoenix held his peek and you didn't kill him: he has you.
  peekLost() {
    if (this.state !== 'running') return;
    const r = this.run;
    r.lost++;
    r.score = Math.max(0, r.score - FLASH_SCORE.lost);
    sfx.peekLost();
    if (this.hooks.onHurt) this.hooks.onHurt();
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
    const rawDt = Math.max((now - this.last) / 1000, 0);
    const dt = Math.min(rawDt, 0.05);
    this.last = now;
    if (this.state === 'running' || this.state === 'countdown') this.adaptResolution(rawDt);

    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }

    const motion = this.scn ? MOTIONS[this.scn.motion.type] : null;
    const ctx = this.ctx();

    // Pose the gun before this frame's shots, so a tracer starts from the
    // muzzle exactly where it is drawn this frame (recoil shows next frame).
    const viewMode = () => {
      const live = this.state === 'countdown' || this.state === 'running' || this.state === 'paused';
      if (this.inspect && this.state === 'menu') return 'inspect';
      return live && this.gunVisible ? 'play' : null;
    };
    const posed = viewMode();
    if (posed) this.vm.update(dt, posed);

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

    if (this.zoomLevel) this.scopeAge += dt;
    if (this.zoomLevel && this.scopeT < 1) {
      const zoomTime = this.sniperSpec.zoomTime || this.settings.sniper.scopeTime;
      this.scopeT = Math.min(1, this.scopeT + dt / Math.max(0.01, zoomTime));
      this.applyZoom();
    }
    // Tracers stay on the muzzle while they show, however the gun recoils or
    // sways. The view itself never kicks, so a shot lands where it's aimed.
    const muzzle = this.fx.anchored() ? this.muzzleStart(_from) : null;
    this.camera.position.copy(this.eye);
    this.camera.rotation.set(this.pitch, this.yaw, this.viewRoll);
    this.updateTargetVisuals(dt);
    this.updatePops(dt);
    this.fx.update(dt, muzzle);
    this.fx.setView(this.renderer.domElement.height, this.camera.fov, this.maxPointSize);
    this.renderer.render(this.scene, this.camera);

    // The gun renders on top with its own camera, so it never clips walls.
    const mode = viewMode();
    if (mode) {
      if (mode !== posed) this.vm.update(0, mode);
      this.vm.viewFrom(this.camera);
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
      const base = t.color || this.targetColor;
      const paint = (m, k, f) => {
        m.color.copy(base).multiplyScalar(hpK * k).lerp(this.hitColor, f);
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
    this.move(dt);
    for (const t of this.targets) {
      if (t.alive) motion.update(t, dt, ctx);
      else if (t.respawnAt !== null && r.elapsed >= t.respawnAt) this.spawn(t);
    }
    this.trackVisibility(dt);
    this.updateCurveballs(dt);

    if (this.knifeOut && this.firing && this.vm.knifeAttack('slash')) sfx.slash();
    const firing = !this.knifeOut && (this.firing || (w.type === 'beam' && this.settings.autoFire));
    if (w.type === 'beam' && firing) {
      // The gun cycles at its own rate while the trigger is held, timed on
      // the run clock rather than by frames: the first round leaves when the
      // trigger is pulled (once the gun has cycled from the last burst), the
      // rest exactly one interval apart, whatever the frame rate.
      const interval = GUNS[this.gunId].fireInterval || 0.1;
      if (!this.wasFiring) r.nextShot = Math.max(r.nextShot, this.pressAt ?? r.elapsed);
      r.nextShot = Math.max(r.nextShot, r.elapsed - interval * 2); // no burst of catch-up after a hitch
      let rounds = 0;
      while (r.nextShot <= r.elapsed) {
        rounds++;
        r.nextShot += interval;
      }
      r.fireTime += dt;
      const t = this.pick();
      for (let i = 0; i < rounds; i++) {
        this.vm.shot();
        this.fireSound();
        this.tracer(this.fwd, t ? this.pickDist : 0);
        // No view kick while tracking: it would shake the aim under every
        // small correction. The gun still kicks in your hands.
      }
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
    // A rifle in a sniping run: automatic, at its own rate, timed like the
    // tracking guns above.
    const spraying = this.sniper && this.slot === 'rifle' && this.firing;
    if (spraying) {
      const interval = GUNS[this.gunId].fireInterval || 0.1;
      if (!this.wasFiring) r.nextShot = Math.max(r.nextShot, this.pressAt ?? r.elapsed);
      r.nextShot = Math.max(r.nextShot, r.elapsed - interval * 2);
      while (r.nextShot <= r.elapsed) {
        r.nextShot += interval;
        this.rifleShot();
      }
    }
    // Where the scenario allows it (dodge flash), the AWP fires again while
    // held, as soon as its bolt is back.
    if (this.scn.holdFire && this.awpHeld && this.firing && r.elapsed - r.lastShot >= this.sniperSpec.fireInterval) this.sniperShoot();
    this.settleRecoil(dt);
    this.wasFiring = (w.type === 'beam' && firing) || spraying;
    if (!firing) this.pressAt = null;

    while (r.timeline.length < Math.floor(r.elapsed) && (r.free || r.timeline.length < this.scn.duration)) {
      r.timeline.push(Math.round(r.score));
    }
    if (!r.free && r.elapsed >= this.scn.duration) this.finish();
  }

  // Full running speed with the held weapon, m/s.
  get runSpeed() {
    return ((GUNS[this.heldId] || {}).run || 5.4) * RUN_SCALE;
  }

  // WASD held (KeyW, KeyA, KeyS, KeyD) or let go.
  moveKey(code, down) {
    if (down) this.keys.add(code);
    else this.keys.delete(code);
  }

  // Space: jump, if standing on the floor (CS2's jump: 1.45 m up, 0.75 s in
  // the air).
  jump() {
    if (this.state !== 'running' || !this.grounded) return;
    this.vy = JUMP_SPEED;
  }

  // Space held or let go: Jett's Drift while falling.
  drift(on) {
    this.drifting = !!on;
  }

  // Q: Jett's Updraft, if a charge is left. The lift comes after the
  // windup (see move).
  updraft() {
    if (this.state !== 'running' || this.dashing || this.updraftWind !== null || this.updraftCharges < 1) return;
    this.updraftCharges--;
    if (!this.updraftRecharge) this.updraftRecharge = UPDRAFT_RECHARGE;
    this.updraftWind = UPDRAFT_WINDUP;
    this.sliding = null;
    sfx.updraft();
    if (this.hooks.onUpdraft) this.hooks.onUpdraft();
  }

  // Height of the ground under (x, z) for feet at height `feet`: the floor,
  // or the top of a crate you're over and not below.
  groundAt(x, z, feet) {
    const R = 0.3;
    let g = 0;
    for (const b of this.covers) {
      if (x < b.min.x - R || x > b.max.x + R || z < b.min.z - R || z > b.max.z + R) continue;
      if (feet >= b.max.y - 0.05 && b.max.y > g) g = b.max.y;
    }
    return g;
  }

  // Shift held: crouch.
  crouch(on) {
    this.crouching = !!on;
  }

  // Shift while running on the ground: slide (a tap is enough; holding it
  // crouches once the slide is over). It goes the way the movement keys
  // point, so you can slide forward, sideways, diagonally or backwards;
  // with none held, the way you're already moving. Pressing it again, or
  // jumping, ends it early. Not running, Shift only crouches.
  slide() {
    if (this.state !== 'running' || this.dashing) return;
    if (this.sliding) {
      this.sliding = null;
      return;
    }
    const run = this.runSpeed;
    const v = Math.hypot(this.vel.x, this.vel.z);
    if (!this.grounded || v < run * 0.6) return;
    const burst = this.moveClock - this.lastSlide > 0.8;
    const dir = this.wishDir(new THREE.Vector3());
    if (!dir.lengthSq()) dir.set(this.vel.x, 0, this.vel.z);
    this.sliding = { t: 0, dir: dir.normalize(), speed: Math.max(v, run * (burst ? SLIDE_BOOST : 1)) };
    this.lastSlide = this.moveClock;
    sfx.slide();
  }

  // E: dash the way the movement keys point (forward with none), if a
  // charge is left.
  dash() {
    if (this.state !== 'running' || this.dashing || this.dashCharges < 1) return;
    const dir = this.wishDir(new THREE.Vector3());
    if (!dir.lengthSq()) dir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.dashing = { t: 0, dir: dir.normalize() };
    this.sliding = null;
    this.dashCharges--;
    if (!this.dashRecharge) this.dashRecharge = DASH_RECHARGE;
    this.vy = Math.max(0, this.vy); // a dash holds you up
    sfx.dash();
    if (this.hooks.onDash) this.hooks.onDash();
  }

  // The direction the movement keys point, flat, not normalised (zero with
  // none held).
  wishDir(out) {
    const k = this.keys;
    const f = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const s = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    return out.set(-sin * f + cos * s, 0, -cos * f - sin * s);
  }

  // WASD: run around the arena at the held weapon's speed (CS2's, or
  // Valorant's for the Riot guns, half as fast again; half that with the
  // AWP scoped), speeding up and stopping as in CS2 (see RUN_SCALE), so
  // counter-strafing works. Walls and crates stop you.
  move(dt) {
    this.moveClock += dt;
    // Dash charges come back one at a time.
    if (this.dashCharges < DASH_CHARGES) {
      this.dashRecharge -= dt;
      if (this.dashRecharge <= 0) {
        this.dashCharges++;
        this.dashRecharge = this.dashCharges < DASH_CHARGES ? DASH_RECHARGE : 0;
      }
    }
    if (this.updraftCharges < UPDRAFT_CHARGES) {
      this.updraftRecharge -= dt;
      if (this.updraftRecharge <= 0) {
        this.updraftCharges++;
        this.updraftRecharge = this.updraftCharges < UPDRAFT_CHARGES ? UPDRAFT_RECHARGE : 0;
      }
    }
    // Updraft: after the windup, straight up at the speed that rises
    // UPDRAFT_HEIGHT under gravity.
    if (this.updraftWind !== null) {
      this.updraftWind -= dt;
      if (this.updraftWind <= 0) {
        this.updraftWind = null;
        this.dashing = null;
        this.vy = Math.sqrt(2 * GRAVITY * UPDRAFT_HEIGHT);
        this.fovKick = Math.max(this.fovKick, 4);
      }
    }
    const run = this.runSpeed;
    // Crouching lowers the eye 0.46 m (CS2's 64 to 46 units) in 0.12 s, as
    // does a slide; a jump rises and falls under CS2's gravity (not during
    // a dash).
    const low = this.crouching || !!this.sliding;
    this.crouchT = Math.max(0, Math.min(1, this.crouchT + (low ? dt : -dt) / 0.12));
    // You land on the floor or on top of a crate.
    const ground = this.groundAt(this.eye.x, this.eye.z, this.jumpY);
    if ((this.jumpY > ground || this.vy > 0) && !this.dashing) {
      if (this.drifting && this.vy <= 0) {
        // Drift: holding Space, the fall speeds up only to a float (and a
        // faster one eases off to it).
        if (this.vy > -DRIFT_FALL) this.vy = Math.max(-DRIFT_FALL, this.vy - GRAVITY * dt);
        else this.vy += (-DRIFT_FALL - this.vy) * (1 - Math.exp(-dt * 8));
      } else {
        this.vy -= GRAVITY * dt;
      }
      this.jumpY += this.vy * dt;
      if (this.jumpY <= ground && this.vy <= 0) { // landed (not the frame it left)
        this.jumpY = ground;
        this.vy = 0;
      }
    }
    const grounded = this.jumpY === ground && this.vy === 0;
    this.grounded = grounded;
    const c = this.crouchT;
    this.eye.y = this.baseEye + this.jumpY - CROUCH_DROP * c * c * (3 - 2 * c);
    this.wishDir(_v);
    const wish = _v.length();
    if (this.dashing) {
      // Fast at first, easing off as it arrives; you come out of it at a
      // run in the same direction.
      const D = this.dashing;
      D.t += dt;
      const u = Math.min(1, D.t / DASH_TIME);
      this.vel.copy(D.dir).multiplyScalar((DASH_DIST / DASH_TIME) * 1.5 * (1 - u * u));
      if (u >= 1) {
        this.vel.copy(D.dir).multiplyScalar(run);
        this.dashing = null;
      }
      this.fovKick = 7 * Math.sin(Math.PI * Math.min(1, D.t / (DASH_TIME * 1.6)));
    } else if (this.sliding) {
      // Friction bleeds the speed off; you can steer a little. It ends when
      // slow, when you leave the ground (a slide jump keeps the speed), or
      // after its time.
      const S = this.sliding;
      S.t += dt;
      S.speed = S.speed * Math.exp(-dt * SLIDE_DRAG) - SLIDE_FRICTION * dt;
      if (wish > 0) S.dir.lerp(_v.clone().divideScalar(wish), 1 - Math.exp(-dt * 0.8)).normalize();
      this.vel.copy(S.dir).multiplyScalar(Math.max(0, S.speed));
      if (!grounded || S.speed < run * SLIDE_END || S.t > SLIDE_MAX) this.sliding = null;
    } else {
      let speed = run;
      if (this.zoomLevel) speed *= 0.5;
      if (this.crouching) speed *= 0.34; // CS2 crouch-walks at a third of a run
      if (wish > 0) _v.divideScalar(wish); // where the keys point
      // Source movement, in small fixed steps so it plays the same at any
      // frame rate. In the air there's no friction and the keys add little
      // (more while drifting down, as Jett).
      const cap = grounded ? speed : this.drifting && this.vy < 0 ? Math.min(speed, 2) : Math.min(speed, AIR_WISH_CAP);
      const accel = grounded ? SV_ACCELERATE : SV_AIRACCELERATE;
      const n = Math.max(1, Math.ceil(dt * 128));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        if (grounded) {
          const sp = Math.hypot(this.vel.x, this.vel.z);
          if (sp > 0) {
            const k = Math.max(0, sp - Math.max(sp, SV_STOPSPEED) * SV_FRICTION * h) / sp;
            this.vel.x *= k;
            this.vel.z *= k;
          }
        }
        if (wish > 0) {
          const add = cap - (this.vel.x * _v.x + this.vel.z * _v.z);
          if (add > 0) {
            const a = Math.min(accel * speed * h, add);
            this.vel.x += _v.x * a;
            this.vel.z += _v.z * a;
          }
        }
      }
      if (wish === 0 && this.vel.lengthSq() < 1e-4) this.vel.set(0, 0, 0);
    }
    if (!this.dashing) this.fovKick *= Math.exp(-dt * 12);
    if (this.fovKick > 0.01 || this.fovKick !== this.fovShown) {
      if (this.fovKick < 0.01) this.fovKick = 0;
      this.fovShown = this.fovKick;
      this.applyZoom();
    }
    // In a slide the view tips a little (to the left in a slide to the
    // left, otherwise to the right) and the gun leans in; it doesn't bob.
    const lean = this.sliding ? 1 : 0;
    let tip = 1;
    if (this.sliding) {
      const side = this.sliding.dir.x * Math.cos(this.yaw) - this.sliding.dir.z * Math.sin(this.yaw);
      tip = Math.max(-1, Math.min(1, 1 + 2 * side));
    }
    this.viewRoll += (lean * tip * -0.045 - this.viewRoll) * (1 - Math.exp(-dt * 10));
    this.vm.lean += (lean - this.vm.lean) * (1 - Math.exp(-dt * 10));
    this.vm.moving = this.sliding || this.dashing ? 0 : Math.min(1, this.vel.length() / run);
    if (!this.vel.x && !this.vel.z) return;
    const e = this.eye;
    e.x += this.vel.x * dt;
    e.z += this.vel.z * dt;
    // Crates: step back out along the shallower side.
    const R = 0.3;
    for (const b of this.covers) {
      if (this.jumpY >= b.max.y - 0.05) continue; // over the top, or standing on it
      const ox = Math.min(e.x - (b.min.x - R), b.max.x + R - e.x);
      const oz = Math.min(e.z - (b.min.z - R), b.max.z + R - e.z);
      if (ox <= 0 || oz <= 0) continue;
      if (ox < oz) {
        e.x = e.x < (b.min.x + b.max.x) / 2 ? b.min.x - R : b.max.x + R;
        this.vel.x = 0;
      } else {
        e.z = e.z < (b.min.z + b.max.z) / 2 ? b.min.z - R : b.max.z + R;
        this.vel.z = 0;
      }
    }
    const a = this.arenaBox;
    const cx = Math.max(a.min.x + R, Math.min(a.max.x - R, e.x));
    const cz = Math.max(a.min.z + R, Math.min(a.max.z - R, e.z));
    if (cx !== e.x) { e.x = cx; this.vel.x = 0; }
    if (cz !== e.z) { e.z = cz; this.vel.z = 0; }
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
      time: r.free ? r.elapsed : Math.max(0, this.scn.duration - r.elapsed),
      free: r.free,
      countdown: this.state === 'countdown' ? Math.ceil(this.countdown) : 0,
      score: Math.round(r.score),
      acc,
      kills: r.kills,
      fps: this.fps,
      late: this.pacing ? this.pacing.late : 0, // share of frames that missed the display's refresh
      flash: this.flashLook(), // Phoenix's flash on screen, or null
      ammo: this.sniper ? Infinity : null, // guns in sniping runs never run dry
      awp: this.awpHeld,
      gunName: (GUNS[this.heldId] || {}).name || '',
      dash: { charges: this.dashCharges, max: DASH_CHARGES, back: this.dashCharges < DASH_CHARGES ? 1 - this.dashRecharge / DASH_RECHARGE : 1 },
      updraft: { charges: this.updraftCharges, max: UPDRAFT_CHARGES, back: this.updraftCharges < UPDRAFT_CHARGES ? 1 - this.updraftRecharge / UPDRAFT_RECHARGE : 1 },
      zoom: this.zoomLevel ? this.zoomMag(this.zoomLevel) : 0,
      onTarget: beam && this.targets.some((t) => t.flash > 0.9),
    };
  }
}
