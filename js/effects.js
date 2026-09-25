// Skin fire effects in the world: tracers that fly from the muzzle to the
// impact point, impact bursts, and a muzzle glow. Everything is pooled so a
// rifle at 11 rounds per second doesn't allocate.
import * as THREE from '../vendor/three.module.min.js';

export const FX_TYPES = {
  none: 'Standard bullet',
  tracer: 'Tracer',
  plasma: 'Plasma bolt',
  flame: 'Flame',
  spectral: 'Spectral',
  lightning: 'Lightning',
};

// Per-type tuning: bolt length and width in metres, speed in m/s, how many
// trail ghosts a bolt leaves per second, impact burst size and lifetime.
const TYPES = {
  // Every gun fires a visible bullet: skins without an effect get a thin,
  // warm tracer like CS2's, with a small puff of sparks where it lands.
  none: { len: 1.6, width: 0.016, speed: 900, trail: 0, burst: 7, burstSpeed: 3.5, burstLife: 0.16, gravity: -5, standard: true },
  tracer: { len: 3, width: 0.045, speed: 140, trail: 0, burst: 8, burstSpeed: 4, burstLife: 0.18, gravity: 0 },
  plasma: { len: 1.2, width: 0.09, speed: 80, trail: 90, burst: 14, burstSpeed: 3, burstLife: 0.3, gravity: 0, ring: true },
  flame: { len: 0.9, width: 0.12, speed: 55, trail: 120, burst: 22, burstSpeed: 5, burstLife: 0.55, gravity: -6, embers: true },
  spectral: { len: 1.8, width: 0.1, speed: 40, trail: 60, burst: 12, burstSpeed: 1.5, burstLife: 0.7, gravity: 1.5, wave: true },
  lightning: { len: 0, width: 0.05, speed: 0, trail: 0, burst: 16, burstSpeed: 6, burstLife: 0.16, gravity: 0, bolt: true },
};

// Near the muzzle every effect starts barrel-thin and grows to full size over
// the first few metres, so nothing spills past the gun where the shot leaves.
const ramp = (d) => 0.25 + 0.75 * Math.min(1, Math.max(0, d) / 4);

// Hits are instant (hitscan), so in play a shot is drawn as one: on the first
// frame it is shown, the streak runs all the way from the muzzle to where it
// lands, and the impact bursts with it. Then the streak pulls back toward the
// impact and fades over TRACER_LIFE. Everything is timed in seconds, never in
// frames, so every shot looks the same at 30, 60 or 144 fps.
const TRACER_LIFE = 0.07; // seconds
// Weapon-tab test shots instead fly at the style's own speed, slowed down.
const STREAK_TIME = 0.03; // seconds of travel the streak spans

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const WHITE = new THREE.Color(1, 1, 1);
const STANDARD_COLOR = '#ffdcaa';

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Trail embers and impact sparks, all drawn as one batch of point sprites:
// one draw call however many there are, instead of one each.
const MAX_PARTICLES = 600;
const PARTICLE_VS = `
attribute float size;
attribute float alpha;
attribute vec3 tint;
uniform float scale;
uniform float maxSize;
varying vec3 vTint;
varying float vAlpha;
void main() {
  vTint = tint;
  vAlpha = alpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = min(maxSize, size * scale / max(0.05, -mv.z));
  gl_Position = projectionMatrix * mv;
}`;
const PARTICLE_FS = `
uniform sampler2D map;
varying vec3 vTint;
varying float vAlpha;
void main() {
  float a = texture2D(map, gl_PointCoord).a * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vTint, a);
  #include <colorspace_fragment>
}`;

class Particles {
  constructor(map) {
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX_PARTICLES * 3);
    this.tint = new Float32Array(MAX_PARTICLES * 3);
    this.size = new Float32Array(MAX_PARTICLES);
    this.alpha = new Float32Array(MAX_PARTICLES);
    const attr = (a, n) => new THREE.BufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', attr(this.pos, 3));
    this.geo.setAttribute('tint', attr(this.tint, 3));
    this.geo.setAttribute('size', attr(this.size, 1));
    this.geo.setAttribute('alpha', attr(this.alpha, 1));
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: map }, scale: { value: 600 }, maxSize: { value: 256 } },
      vertexShader: PARTICLE_VS,
      fragmentShader: PARTICLE_FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
  }

  // Pixels per metre at 1 m for a view `heightPx` tall with vertical `fov`.
  setView(heightPx, fov, maxSize) {
    this.mat.uniforms.scale.value = heightPx / (2 * Math.tan((fov * Math.PI) / 360));
    if (maxSize) this.mat.uniforms.maxSize.value = maxSize;
  }

  // Write the live particles of `lists` (records with pos, color, size, a).
  write(lists) {
    let n = 0;
    for (const list of lists) {
      for (const p of list) {
        if (p.life <= 0 || n >= MAX_PARTICLES) continue;
        this.pos[n * 3] = p.pos.x;
        this.pos[n * 3 + 1] = p.pos.y;
        this.pos[n * 3 + 2] = p.pos.z;
        this.tint[n * 3] = p.color.r;
        this.tint[n * 3 + 1] = p.color.g;
        this.tint[n * 3 + 2] = p.color.b;
        this.size[n] = p.drawSize;
        this.alpha[n] = p.a;
        n++;
      }
    }
    for (const k of ['position', 'tint', 'size', 'alpha']) this.geo.attributes[k].needsUpdate = true;
    this.geo.setDrawRange(0, n);
  }
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.glow = glowTexture();
    this.bolts = [];
    this.ghosts = [];
    this.sparks = [];
    this.flashes = [];
    this.lines = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    this.particles = new Particles(this.glow);
    this.group.add(this.particles.points);
    // A streak along +Z, full width at the head (+Z) and thin at the tail, so
    // the end at the muzzle never covers more than the barrel.
    this.boltGeo = new THREE.CylinderGeometry(1, 0.45, 1, 8, 1, true).rotateX(Math.PI / 2);
    this.color = new THREE.Color('#ffffff');
    this.type = 'none';
  }

  // The camera the effects are seen through, so particles size correctly.
  setView(heightPx, fov, maxSize) {
    this.particles.setView(heightPx, fov, maxSize);
  }

  // Called when the equipped skin changes.
  setStyle(type, color) {
    this.type = TYPES[type] ? type : 'none';
    this.color.set(this.type === 'none' ? STANDARD_COLOR : color || '#ffffff');
  }

  // A skin effect (not the standard bullet) is chosen.
  get styled() {
    return this.type !== 'none';
  }

  additive(extra = {}) {
    return new THREE.MeshBasicMaterial({
      color: this.color.clone(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, ...extra,
    });
  }

  spriteMat() {
    return new THREE.SpriteMaterial({
      map: this.glow, color: this.color.clone(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
  }

  take(pool, make) {
    let p = pool.find((x) => x.life <= 0);
    if (!p) {
      p = make();
      p.life = 0;
      pool.push(p);
      this.group.add(p.obj);
    }
    p.obj.visible = true;
    return p;
  }

  // A shot from `from` to `to`. `hit` colours the impact as a hit or a miss.
  // `burst: false` skips the impact; `travel: true` makes the bolt fly at the
  // style's speed (the slow-motion test shot).
  shot(from, to, hit, { burst = true, travel = false } = {}) {
    const T = TYPES[this.type];
    if (T.bolt) {
      this.lightning(from, to);
      if (burst) this.burst(to, T, hit);
      this.flash(from, 0.07);
      return;
    }
    const b = this.take(this.bolts, () => {
      const mesh = new THREE.Mesh(this.boltGeo, this.additive({ side: THREE.DoubleSide }));
      const head = new THREE.Sprite(this.spriteMat());
      const obj = new THREE.Group();
      obj.add(mesh, head);
      return { obj, mesh, head, from: new THREE.Vector3(), to: new THREE.Vector3(), dir: new THREE.Vector3() };
    });
    b.from.copy(from);
    b.to.copy(to);
    b.dir.subVectors(to, from);
    b.total = b.dir.length();
    b.dir.normalize();
    b.travel = travel;
    // Every shot is first drawn whole, however far into a frame it was fired,
    // so each one looks the same.
    b.t = 0;
    b.fresh = true;
    b.dist = 0;
    b.speed = T.speed;
    b.len = Math.max(T.len, b.speed * STREAK_TIME);
    b.burst = burst;
    b.landed = false;
    b.life = 1;
    b.hit = hit;
    b.phase = Math.random() * Math.PI * 2;
    b.mesh.material.color.copy(this.color);
    b.head.material.color.copy(this.color);
    b.head.scale.setScalar(T.width * 4 * ramp(0));
    b.obj.quaternion.setFromUnitVectors(_a.set(0, 0, 1), b.dir);
    b.trailAcc = 0;
    b.trailDone = 0; // how far along trail particles have been laid
    if (!travel && burst) {
      this.burst(to, T, hit);
      b.landed = true;
    }
    this.flash(from, Math.min(0.08, T.width * 1.5));
  }

  // Make one of every effect object and show it, so the renderer can compile
  // their shaders before the first shot rather than during it. Returns a
  // function that hides them again.
  prime() {
    const saved = this.type;
    this.type = 'plasma';
    const a = new THREE.Vector3(0, -50, 0);
    const b = new THREE.Vector3(0, -50, -1);
    this.shot(a, b, false, { burst: false });
    this.lightning(a, b);
    this.type = saved;
    const objs = [...this.bolts, ...this.flashes, ...this.lines].filter((o) => o.life > 0 || o.obj.visible);
    for (const o of objs) o.obj.visible = true;
    return () => {
      for (const o of objs) {
        o.life = 0;
        o.obj.visible = false;
      }
    };
  }

  flash(at, size) {
    const f = this.take(this.flashes, () => ({ obj: new THREE.Sprite(this.spriteMat()) }));
    f.obj.material.color.copy(this.color);
    f.obj.position.copy(at);
    f.obj.scale.setScalar(size);
    f.life = 0.06;
    f.max = 0.06;
  }

  lightning(from, to) {
    const l = this.take(this.lines, () => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(14 * 3), 3));
      const obj = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: this.color.clone(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      return { obj, geo };
    });
    l.obj.material.color.copy(this.color);
    const pos = l.geo.attributes.position;
    const n = pos.count;
    _c.subVectors(to, from);
    const len = _c.length();
    _a.copy(_c).normalize();
    _b.crossVectors(_a, UP).normalize();
    if (_b.lengthSq() < 0.01) _b.set(1, 0, 0);
    _c.crossVectors(_a, _b);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      // Jagged in the middle, pinned to the muzzle and the impact.
      const amp = i === 0 || i === n - 1 ? 0 : Math.min(0.35, len * 0.03) * Math.min(1, (t * len) / 3);
      const jag = amp * (Math.random() - 0.5) * 2;
      const jag2 = amp * (Math.random() - 0.5) * 2;
      pos.setXYZ(i, from.x + _a.x * len * t + _b.x * jag + _c.x * jag2, from.y + _a.y * len * t + _b.y * jag + _c.y * jag2, from.z + _a.z * len * t + _b.z * jag + _c.z * jag2);
    }
    pos.needsUpdate = true;
    l.life = 0.07;
    l.max = 0.07;
  }

  // A particle record from `pool` (ghosts or sparks), reused when spent.
  particle(pool) {
    let p = pool.find((x) => x.life <= 0);
    if (!p) {
      if (pool.length >= MAX_PARTICLES / 2) return null;
      p = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), color: new THREE.Color(), life: 0 };
      pool.push(p);
    }
    return p;
  }

  ghost(at, size, life) {
    const g = this.particle(this.ghosts);
    if (!g) return;
    g.color.copy(this.color);
    g.pos.copy(at);
    g.size = size;
    g.drawSize = size;
    g.a = 0.8;
    g.life = life;
    g.max = life;
  }

  burst(at, T, hit) {
    const n = hit ? T.burst : Math.ceil(T.burst / 2);
    for (let i = 0; i < n; i++) {
      const s = this.particle(this.sparks);
      if (!s) break;
      s.color.copy(this.color);
      if (hit) s.color.lerp(WHITE, 0.35);
      s.pos.copy(at);
      s.a = 1;
      s.vel.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar(T.burstSpeed * (0.4 + Math.random()));
      s.size = T.width * (T.embers ? 1.2 : 2) * (0.5 + Math.random());
      s.drawSize = s.size;
      s.life = T.burstLife * (0.6 + Math.random() * 0.6);
      s.max = s.life;
      s.gravity = T.gravity;
    }
    if (T.ring) {
      const r = this.take(this.flashes, () => ({ obj: new THREE.Sprite(this.spriteMat()) }));
      r.obj.material.color.copy(this.color);
      r.obj.position.copy(at);
      r.obj.scale.setScalar(T.width * 10);
      r.life = 0.12;
      r.max = 0.12;
    }
  }

  update(dt) {
    const T = TYPES[this.type];
    for (const b of this.bolts) {
      if (b.life <= 0) continue;
      // The effect was switched off mid-flight: drop the bolt quietly.
      if (!T) { b.life = 0; b.obj.visible = false; continue; }
      let head;
      let tail;
      let fade = 1;
      if (b.travel) {
        // Flies at the style's speed, streak `len` long.
        b.dist += b.speed * dt;
        head = Math.min(b.dist, b.total);
        tail = Math.max(0, b.dist - b.len);
        if (!b.landed && b.dist >= b.total) {
          b.landed = true;
          if (b.burst) this.burst(b.to, T, b.hit);
        }
      } else {
        // Hitscan: full length at once, then the muzzle end pulls back toward
        // the impact (slowly at first, so it stays on the gun a moment).
        if (b.fresh) b.fresh = false;
        else b.t += dt;
        const u = b.t / TRACER_LIFE;
        head = b.total;
        tail = b.total * Math.min(1, u) ** 3;
        fade = u < 0.55 ? 1 : Math.max(0, 1 - (u - 0.55) / 0.45);
        if (u >= 1) tail = b.total;
      }
      if (T.trail) {
        // Trail particles along the stretch now drawn, a set number per metre.
        const perMetre = T.trail / T.speed;
        const from = Math.max(b.trailDone, tail);
        if (head > from) {
          b.trailAcc += (head - from) * perMetre;
          b.trailDone = head;
        }
        let n = Math.min(Math.floor(b.trailAcc), 30);
        b.trailAcc -= Math.floor(b.trailAcc);
        if (T.wave) _b.crossVectors(b.dir, UP).normalize();
        while (n-- > 0) {
          const along = from + Math.random() * (head - from);
          _c.copy(b.from).addScaledVector(b.dir, along);
          if (T.wave) _c.addScaledVector(_b, Math.sin(along * 1.6 + b.phase) * 0.08 * Math.min(1, along / 3));
          this.ghost(_c, T.width * (T.embers ? 2.5 : 1.6) * ramp(along), T.embers ? 0.25 : 0.18);
        }
      }
      if (tail >= b.total || fade <= 0) {
        b.life = 0;
        b.obj.visible = false;
        continue;
      }
      const k = ramp(tail);
      _a.copy(b.from).addScaledVector(b.dir, (head + tail) / 2);
      b.obj.position.copy(_a);
      const len = Math.max(0.02, head - tail);
      b.mesh.scale.set(T.width * Math.max(k, ramp(head) * 0.6), T.width * Math.max(k, ramp(head) * 0.6), len);
      b.mesh.material.opacity = 0.85 * fade;
      b.head.material.opacity = fade;
      b.head.position.set(0, 0, len / 2);
      b.head.scale.setScalar(T.width * 4 * ramp(head));
    }
    for (const g of this.ghosts) {
      if (g.life <= 0) continue;
      g.life -= dt;
      g.a = Math.max(0, g.life / g.max) * 0.8;
      if (T && T.embers) g.pos.y += dt * 0.6;
    }
    for (const s of this.sparks) {
      if (s.life <= 0) continue;
      s.life -= dt;
      s.vel.y += s.gravity * dt;
      s.pos.addScaledVector(s.vel, dt);
      const k = Math.max(0, s.life / s.max);
      s.drawSize = s.size * (0.4 + k * 0.6);
      s.a = k;
    }
    this.particles.write([this.ghosts, this.sparks]);
    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      f.obj.material.opacity = Math.max(0, f.life / f.max);
      if (f.life <= 0) f.obj.visible = false;
    }
    for (const l of this.lines) {
      if (l.life <= 0) continue;
      l.life -= dt;
      l.obj.material.opacity = Math.max(0, l.life / l.max);
      if (l.life <= 0) l.obj.visible = false;
    }
  }
}
