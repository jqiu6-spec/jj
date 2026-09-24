// Skin fire effects in the world: tracers that fly from the muzzle to the
// impact point, impact bursts, and a muzzle glow. Everything is pooled so a
// rifle at 11 rounds per second doesn't allocate.
import * as THREE from '../vendor/three.module.min.js';

export const FX_TYPES = {
  none: 'None',
  tracer: 'Tracer',
  plasma: 'Plasma bolt',
  flame: 'Flame',
  spectral: 'Spectral',
  lightning: 'Lightning',
};

// Per-type tuning: bolt length and width in metres, speed in m/s, how many
// trail ghosts a bolt leaves per second, impact burst size and lifetime.
const TYPES = {
  tracer: { len: 3, width: 0.045, speed: 140, trail: 0, burst: 8, burstSpeed: 4, burstLife: 0.18, gravity: 0 },
  plasma: { len: 1.2, width: 0.09, speed: 80, trail: 90, burst: 14, burstSpeed: 3, burstLife: 0.3, gravity: 0, ring: true },
  flame: { len: 0.9, width: 0.12, speed: 55, trail: 120, burst: 22, burstSpeed: 5, burstLife: 0.55, gravity: -6, embers: true },
  spectral: { len: 1.8, width: 0.1, speed: 40, trail: 60, burst: 12, burstSpeed: 1.5, burstLife: 0.7, gravity: 1.5, wave: true },
  lightning: { len: 0, width: 0.05, speed: 0, trail: 0, burst: 16, burstSpeed: 6, burstLife: 0.16, gravity: 0, bolt: true },
};

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

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
    this.boltGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true).rotateX(Math.PI / 2); // along +Z
    this.color = new THREE.Color('#ffffff');
    this.type = 'none';
  }

  // Called when the equipped skin changes.
  setStyle(type, color) {
    this.type = TYPES[type] ? type : 'none';
    this.color.set(color || '#ffffff');
  }

  get active() {
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
  shot(from, to, hit) {
    if (!this.active) return;
    const T = TYPES[this.type];
    if (T.bolt) {
      this.lightning(from, to);
      this.burst(to, T, hit);
      this.flash(from, 0.35);
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
    b.dist = 0;
    b.life = 1;
    b.hit = hit;
    b.phase = Math.random() * Math.PI * 2;
    b.mesh.material.color.copy(this.color);
    b.head.material.color.copy(this.color);
    b.head.scale.setScalar(T.width * 4);
    b.obj.quaternion.setFromUnitVectors(_a.set(0, 0, 1), b.dir);
    b.trailAcc = 0;
    this.flash(from, T.width * 3);
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
      const jag = i === 0 || i === n - 1 ? 0 : Math.min(0.35, len * 0.03) * (Math.random() - 0.5) * 2;
      const jag2 = i === 0 || i === n - 1 ? 0 : Math.min(0.35, len * 0.03) * (Math.random() - 0.5) * 2;
      pos.setXYZ(i, from.x + _a.x * len * t + _b.x * jag + _c.x * jag2, from.y + _a.y * len * t + _b.y * jag + _c.y * jag2, from.z + _a.z * len * t + _b.z * jag + _c.z * jag2);
    }
    pos.needsUpdate = true;
    l.life = 0.07;
    l.max = 0.07;
  }

  ghost(at, size, life) {
    const g = this.take(this.ghosts, () => ({ obj: new THREE.Sprite(this.spriteMat()) }));
    g.obj.material.color.copy(this.color);
    g.obj.position.copy(at);
    g.obj.scale.setScalar(size);
    g.life = life;
    g.max = life;
  }

  burst(at, T, hit) {
    const n = hit ? T.burst : Math.ceil(T.burst / 2);
    for (let i = 0; i < n; i++) {
      const s = this.take(this.sparks, () => ({ obj: new THREE.Sprite(this.spriteMat()), vel: new THREE.Vector3() }));
      s.obj.material.color.copy(this.color);
      if (hit) s.obj.material.color.lerp(_a.setScalar(1), 0.35);
      s.obj.position.copy(at);
      s.vel.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar(T.burstSpeed * (0.4 + Math.random()));
      s.size = T.width * (T.embers ? 1.2 : 2) * (0.5 + Math.random());
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
      b.dist += T.speed * dt;
      if (b.dist >= b.total) {
        b.life = 0;
        b.obj.visible = false;
        this.burst(b.to, T, b.hit);
        continue;
      }
      const head = Math.min(b.dist, b.total);
      const tail = Math.max(0, b.dist - T.len);
      _a.copy(b.from).addScaledVector(b.dir, (head + tail) / 2);
      if (T.wave) {
        _b.crossVectors(b.dir, UP).normalize();
        _a.addScaledVector(_b, Math.sin(b.dist * 6 + b.phase) * 0.08);
      }
      b.obj.position.copy(_a);
      const len = Math.max(0.05, head - tail);
      b.mesh.scale.set(T.width, T.width, len);
      b.mesh.material.opacity = 0.85;
      b.head.position.set(0, 0, len / 2);
      if (T.trail) {
        b.trailAcc += dt * T.trail;
        while (b.trailAcc >= 1) {
          b.trailAcc -= 1;
          _c.copy(b.from).addScaledVector(b.dir, head - Math.random() * T.len);
          if (T.wave) _c.addScaledVector(_b, Math.sin(b.dist * 6 + b.phase) * 0.08);
          this.ghost(_c, T.width * (T.embers ? 2.5 : 1.6), T.embers ? 0.25 : 0.18);
        }
      }
    }
    for (const g of this.ghosts) {
      if (g.life <= 0) continue;
      g.life -= dt;
      const k = Math.max(0, g.life / g.max);
      g.obj.material.opacity = k * 0.8;
      if (T && T.embers) g.obj.position.y += dt * 0.6;
      if (g.life <= 0) g.obj.visible = false;
    }
    for (const s of this.sparks) {
      if (s.life <= 0) continue;
      s.life -= dt;
      s.vel.y += s.gravity * dt;
      s.obj.position.addScaledVector(s.vel, dt);
      const k = Math.max(0, s.life / s.max);
      s.obj.scale.setScalar(s.size * (0.4 + k * 0.6));
      s.obj.material.opacity = k;
      if (s.life <= 0) s.obj.visible = false;
    }
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
