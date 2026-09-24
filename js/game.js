// 3D arena, first-person camera, targets, weapons and the run state machine.
import * as THREE from 'three';
import { MOTIONS } from './motion.js';
import { eyeOf } from './scenarios.js';
import { degPerCount, verticalFov } from './settings.js';
import { sfx } from './audio.js';

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

// ---------------------------------------------------------------- hit tests
const _w = new THREE.Vector3();
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();

// Distance along the ray to the target surface, or -1 on a miss.
function rayHit(o, d, t) {
  const r = t.radius;
  if (t.shape === 'sphere') {
    _w.subVectors(o, t.pos);
    const b = _w.dot(d);
    const c = _w.lengthSq() - r * r;
    const disc = b * b - c;
    if (disc < 0) return -1;
    const s = -b - Math.sqrt(disc);
    return s > 0 ? s : -1;
  }
  // Vertical capsule: closest approach between the ray and its core segment.
  const half = t.half;
  const ax = t.pos.x, ay = t.pos.y - half, az = t.pos.z;
  _v.set(0, 2 * half, 0);
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
  if (tr < 0) { tr = 0; s = Math.max(0, Math.min(1, E / C)); }
  _p.copy(d).multiplyScalar(tr).add(o);
  _q.set(ax, ay + s * 2 * half, az);
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
    this.applySettings(settings);

    this.resize();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('mousemove', (e) => this.onMouseMove(e));
    document.addEventListener('mousedown', (e) => this.onMouseDown(e));
    document.addEventListener('mouseup', (e) => { if (e.button === 0) this.firing = false; });

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
    this.resize();
    for (const t of this.targets) t.mesh.material.color.copy(this.targetColor);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = verticalFov(this.settings ? this.settings.fov : 103, w / h);
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ scenario
  load(scn) {
    this.scn = scn;
    this.buildArena(scn.arena);
    const [ex, ey, ez] = eyeOf(scn);
    this.eye.set(ex, ey, ez);
    this.camera.position.copy(this.eye);
    for (const t of this.targets) {
      this.scene.remove(t.mesh, t.shadow);
      t.mesh.geometry.dispose();
      t.mesh.material.dispose();
    }
    this.targets = [];
    const spec = scn.target;
    for (let i = 0; i < scn.count; i++) {
      const geo = spec.shape === 'capsule'
        ? new THREE.CapsuleGeometry(spec.radius, spec.height - spec.radius * 2, 8, 20)
        : new THREE.SphereGeometry(spec.radius, 40, 24);
      const mat = new THREE.MeshStandardMaterial({
        color: this.targetColor, roughness: 0.42, metalness: 0.0,
        emissive: this.targetColor, emissiveIntensity: 0.22,
      });
      const mesh = new THREE.Mesh(geo, mat);
      const shadow = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: this.tex.blob, transparent: true, depthWrite: false }),
      );
      shadow.rotation.x = -Math.PI / 2;
      this.scene.add(mesh, shadow);
      this.targets.push({
        mesh, shadow,
        shape: spec.shape,
        radius: spec.radius,
        half: spec.shape === 'capsule' ? spec.height / 2 - spec.radius : 0,
        hp: spec.hp || Infinity,
        maxHp: spec.hp || Infinity,
        pos: mesh.position,
        vel: new THREE.Vector3(),
        m: {},
        alive: true,
        flash: 0,
      });
    }
    this.resetTargets();
    this.lookAtTargets(true);
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
    this.arena = g;
    this.scene.add(g);
  }

  ctx() {
    return { scn: this.scn, eye: this.eye, targets: this.targets, aimPoint: this.aimPoint };
  }

  spawn(t) {
    const motion = MOTIONS[this.scn.motion.type];
    t.alive = true;
    t.hp = t.maxHp;
    t.flash = 0;
    motion.spawn(t, this.ctx());
    t.mesh.visible = true;
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
    for (const t of this.targets) _v.add(t.pos);
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
  start() {
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
      timeline: [],
      tickTimer: 0,
    };
    this.firing = false;
    this.resetTargets();
    this.lookAtTargets(true);
    this.pitch = Math.max(-0.35, Math.min(0.35, this.pitch));
    this.countdown = COUNTDOWN;
    this.lastCount = COUNTDOWN + 1;
    this.setState('countdown');
  }

  setState(s) {
    this.state = s;
    this.hooks.onState(s);
  }

  pause() {
    if (this.state === 'running' || this.state === 'countdown') {
      this.pausedFrom = this.state;
      this.firing = false;
      this.setState('paused');
    }
  }

  resume() {
    if (this.state === 'paused') this.setState(this.pausedFrom || 'running');
  }

  toMenu() {
    this.firing = false;
    this.run = null;
    this.setState('menu');
    this.resetTargets();
  }

  finish() {
    const r = this.run;
    const beam = this.scn.weapon.type === 'beam';
    const accuracy = beam ? (r.fireTime > 0 ? r.onTime / r.fireTime : 0) : (r.shots ? r.hits / r.shots : 0);
    while (r.timeline.length < this.scn.duration) r.timeline.push(Math.round(r.score));
    const result = {
      scenario: this.scn.id,
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
    const k = this.radPerCount;
    this.yaw -= e.movementX * k;
    this.pitch -= e.movementY * k * (this.settings.invertY ? -1 : 1);
    if (this.pitch > MAX_PITCH) this.pitch = MAX_PITCH;
    if (this.pitch < -MAX_PITCH) this.pitch = -MAX_PITCH;
  }

  onMouseDown(e) {
    if (e.button !== 0 || document.pointerLockElement !== this.canvas) return;
    this.firing = true;
    if (this.state === 'running' && this.scn.weapon.type === 'click') this.shoot();
  }

  updateForward() {
    const cp = Math.cos(this.pitch);
    this.fwd.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  pick() {
    this.updateForward();
    let best = null;
    let bestD = Infinity;
    for (const t of this.targets) {
      if (!t.alive) continue;
      const d = rayHit(this.eye, this.fwd, t);
      if (d > 0 && d < bestD) { bestD = d; best = t; }
    }
    return best;
  }

  kill(t) {
    const r = this.run;
    r.kills++;
    r.ttkSum += r.elapsed - r.lastKill;
    r.lastKill = r.elapsed;
    this.popAt(t);
    sfx.kill();
    this.hooks.onHit(true);
    // Keep respawns away from where the player is currently aiming.
    this.updateForward();
    this.aimPoint = this.eye.clone().addScaledVector(this.fwd, this.eye.distanceTo(t.pos));
    t.alive = false;
    this.spawn(t);
  }

  shoot() {
    const r = this.run;
    const w = this.scn.weapon;
    r.shots++;
    sfx.shot();
    const t = this.pick();
    if (t) {
      r.hits++;
      r.score += w.points;
      this.kill(t);
    } else {
      r.score = Math.max(0, r.score - w.missPenalty);
    }
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
    p.base = t.radius;
    p.mesh.material.color.copy(this.hitColor);
    p.mesh.position.copy(t.pos);
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
    const dt = Math.min((now - this.last) / 1000, 0.05);
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

    // Visual state of targets.
    for (const t of this.targets) {
      const m = t.mesh.material;
      t.flash = Math.max(0, t.flash - dt * 6);
      const hpK = t.maxHp === Infinity ? 1 : 0.45 + 0.55 * (t.hp / t.maxHp);
      m.color.copy(this.targetColor).multiplyScalar(hpK).lerp(this.hitColor, t.flash);
      m.emissive.copy(m.color);
      m.emissiveIntensity = 0.22 + t.flash * 0.5;
      const h = Math.max(0, t.pos.y - t.radius - t.half);
      const s = (t.radius * 2.6) * (1 + h * 0.08);
      t.shadow.position.set(t.pos.x, 0.01, t.pos.z);
      t.shadow.scale.set(s, s, 1);
      t.shadow.material.opacity = Math.max(0.15, 1 - h * 0.12);
      t.shadow.visible = t.alive;
    }
    this.updatePops(dt);

    this.camera.position.copy(this.eye);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    this.renderer.render(this.scene, this.camera);

    if (this.state === 'running' || this.state === 'countdown') this.hooks.onHud(this.hud());
  }

  step(dt, motion, ctx) {
    const r = this.run;
    const w = this.scn.weapon;
    r.elapsed += dt;
    for (const t of this.targets) if (t.alive) motion.update(t, dt, ctx);

    const firing = this.firing || (w.type === 'beam' && this.settings.autoFire);
    if (w.type === 'beam' && firing) {
      r.fireTime += dt;
      const t = this.pick();
      if (t) {
        r.onTime += dt;
        let dmg = w.dps * dt;
        if (t.hp !== Infinity) dmg = Math.min(dmg, t.hp);
        t.hp -= dmg;
        r.damage += dmg;
        r.score += dmg;
        t.flash = 1;
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

  // Signed angular offset of the crosshair along the target's direction of
  // travel: positive means aiming ahead of it, negative means trailing.
  measureLead(dt) {
    this.updateForward();
    let best = null;
    let bestCos = Math.cos(10 * DEG);
    for (const t of this.targets) {
      if (!t.alive) continue;
      _v.subVectors(t.pos, this.eye).normalize();
      const c = _v.dot(this.fwd);
      if (c > bestCos) { bestCos = c; best = t; }
    }
    if (!best) return;
    const dist = this.eye.distanceTo(best.pos);
    _v.subVectors(best.pos, this.eye).normalize(); // u
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
      onTarget: beam && this.targets.some((t) => t.flash > 0.9),
    };
  }
}
