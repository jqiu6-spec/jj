// Target movement models. Each model has spawn(t, ctx) and update(t, dt, ctx).
// `t` is a target record: { pos: Vector3, vel: Vector3, m: {...model state} }.
// `ctx` gives access to the scenario, the eye position and the other targets.

const DEG = Math.PI / 180;

export const rand = (a, b) => a + Math.random() * (b - a);
const randIn = (range) => rand(range[0], range[1]);
const sign = () => (Math.random() < 0.5 ? -1 : 1);

function farEnough(t, pos, ctx) {
  const sep = ctx.scn.minSep || 0;
  if (!sep) return true;
  for (const o of ctx.targets) {
    if (o === t || !o.alive) continue;
    if (o.pos.distanceTo(pos) < sep) return false;
  }
  // Keep a respawn away from the crosshair so it is a real flick.
  if (ctx.aimPoint && ctx.aimPoint.distanceTo(pos) < sep * 0.8) return false;
  return true;
}

function spawnInBox(t, ctx, b) {
  for (let i = 0; i < 40; i++) {
    t.pos.set(randIn(b.x), randIn(b.y), randIn(b.z));
    if (farEnough(t, t.pos, ctx)) return;
  }
}

// Smooth wandering: velocity eases toward a new random heading every so often.
const wander = {
  spawn(t, ctx) {
    spawnInBox(t, ctx, ctx.scn.motion.bounds);
    t.vel.set(0, 0, 0);
    t.m.desired = { x: 0, y: 0, z: 0 };
    t.m.timer = 0;
  },
  update(t, dt, ctx) {
    const m = ctx.scn.motion;
    const s = t.m;
    s.timer -= dt;
    if (s.timer <= 0) {
      let x = rand(-1, 1);
      let y = rand(-1, 1) * 0.8;
      let z = rand(-1, 1) * (m.zScale ?? 1);
      const len = Math.hypot(x, y, z) || 1;
      const sp = randIn(m.speed);
      s.desired.x = (x / len) * sp;
      s.desired.y = (y / len) * sp;
      s.desired.z = (z / len) * sp;
      s.timer = randIn(m.retarget);
    }
    // Turn back before reaching a wall: margin is roughly the stopping distance.
    const b = m.bounds;
    const d = s.desired;
    for (const ax of ['x', 'y', 'z']) {
      const v = t.vel[ax];
      const stop = (v * v) / (2 * m.accel) + 0.2;
      const lo = b[ax][0];
      const hi = b[ax][1];
      const margin = Math.min(stop, (hi - lo) / 2);
      if (t.pos[ax] < lo + margin && d[ax] < 0) d[ax] = -d[ax];
      if (t.pos[ax] > hi - margin && d[ax] > 0) d[ax] = -d[ax];
    }
    const dx = d.x - t.vel.x;
    const dy = d.y - t.vel.y;
    const dz = d.z - t.vel.z;
    const dl = Math.hypot(dx, dy, dz);
    const step = m.accel * dt;
    const k = dl > step ? step / dl : 1;
    t.vel.x += dx * k;
    t.vel.y += dy * k;
    t.vel.z += dz * k;
    t.pos.addScaledVector(t.vel, dt);
    for (const ax of ['x', 'y', 'z']) {
      if (t.pos[ax] < b[ax][0]) { t.pos[ax] = b[ax][0]; t.vel[ax] = Math.abs(t.vel[ax]); }
      if (t.pos[ax] > b[ax][1]) { t.pos[ax] = b[ax][1]; t.vel[ax] = -Math.abs(t.vel[ax]); }
    }
  },
};

// Ground bot doing ADAD strafes with occasional jumps.
const strafe = {
  spawn(t, ctx) {
    const m = ctx.scn.motion;
    const baseY = ctx.scn.target.height / 2;
    for (let i = 0; i < 40; i++) {
      t.pos.set(randIn(m.x), baseY, randIn(m.z));
      if (farEnough(t, t.pos, ctx)) break;
    }
    t.vel.set(0, 0, 0);
    t.m.dir = sign();
    t.m.timer = randIn(m.switchTime);
    t.m.zTarget = t.pos.z;
    t.m.zTimer = rand(1, 3);
    t.m.baseY = baseY;
  },
  update(t, dt, ctx) {
    const m = ctx.scn.motion;
    const s = t.m;
    s.timer -= dt;
    if (s.timer <= 0) {
      s.dir = -s.dir;
      s.timer = randIn(m.switchTime);
    }
    if (t.pos.x < m.x[0] + 0.5) s.dir = 1;
    if (t.pos.x > m.x[1] - 0.5) s.dir = -1;
    const want = s.dir * m.speed;
    const dv = want - t.vel.x;
    const step = m.accel * dt;
    t.vel.x += Math.abs(dv) > step ? Math.sign(dv) * step : dv;

    // Slow drift forward/back so the range changes over time.
    s.zTimer -= dt;
    if (s.zTimer <= 0) {
      s.zTarget = randIn(m.z);
      s.zTimer = rand(1.5, 3.5);
    }
    const dz = s.zTarget - t.pos.z;
    t.vel.z = Math.max(-1.6, Math.min(1.6, dz * 1.5));

    const grounded = t.pos.y <= s.baseY + 1e-3;
    if (grounded && Math.random() < m.jumpRate * dt) t.vel.y = m.jumpVel;
    t.vel.y -= m.gravity * dt;
    t.pos.addScaledVector(t.vel, dt);
    if (t.pos.y < s.baseY) { t.pos.y = s.baseY; t.vel.y = 0; }
    t.pos.x = Math.max(m.x[0], Math.min(m.x[1], t.pos.x));
  },
};

// Ballistic hops with mid-air direction changes.
const air = {
  spawn(t, ctx) {
    const b = ctx.scn.motion.bounds;
    spawnInBox(t, ctx, { x: b.x, y: [b.y[0] + 1, (b.y[0] + b.y[1]) / 2], z: b.z });
    t.vel.set(0, 0, 0);
    this.hop(t, ctx.scn.motion);
    t.vel.y *= 0.5;
  },
  hop(t, m) {
    t.vel.y = randIn(m.jumpVel);
    t.vel.x = sign() * randIn(m.speedX);
    t.vel.z = rand(-1, 1) * m.speedZ;
    t.m.timer = randIn(m.strafeTime);
  },
  update(t, dt, ctx) {
    const m = ctx.scn.motion;
    const b = m.bounds;
    t.m.timer -= dt;
    if (t.m.timer <= 0) {
      t.vel.x = -Math.sign(t.vel.x || 1) * randIn(m.speedX);
      t.m.timer = randIn(m.strafeTime);
    }
    t.vel.y -= m.gravity * dt;
    t.pos.addScaledVector(t.vel, dt);
    if (t.pos.y < b.y[0]) { t.pos.y = b.y[0]; this.hop(t, m); }
    if (t.pos.y > b.y[1]) { t.pos.y = b.y[1]; t.vel.y = -Math.abs(t.vel.y) * 0.5; }
    if (t.pos.x < b.x[0]) { t.pos.x = b.x[0]; t.vel.x = Math.abs(t.vel.x); }
    if (t.pos.x > b.x[1]) { t.pos.x = b.x[1]; t.vel.x = -Math.abs(t.vel.x); }
    if (t.pos.z < b.z[0]) { t.pos.z = b.z[0]; t.vel.z = Math.abs(t.vel.z); }
    if (t.pos.z > b.z[1]) { t.pos.z = b.z[1]; t.vel.z = -Math.abs(t.vel.z); }
  },
};

// Circles the player at close range with sudden reversals.
const orbit = {
  spawn(t, ctx) {
    const m = ctx.scn.motion;
    const s = t.m;
    s.az = rand(-0.4, 0.4);
    s.el = randIn(m.elev) * DEG * 0.5;
    s.dist = randIn(m.dist);
    s.azVel = 0;
    s.azWant = sign() * randIn(m.angSpeed) * DEG;
    s.elWant = randIn(m.elev) * DEG;
    s.distWant = randIn(m.dist);
    s.timer = randIn(m.retarget);
    this.place(t, ctx);
    t.vel.set(0, 0, 0);
  },
  place(t, ctx) {
    const s = t.m;
    const e = ctx.eye;
    const c = Math.cos(s.el);
    t.pos.set(
      e.x - Math.sin(s.az) * c * s.dist,
      Math.max(ctx.scn.target.radius + 0.2, e.y + Math.sin(s.el) * s.dist),
      e.z - Math.cos(s.az) * c * s.dist,
    );
  },
  update(t, dt, ctx) {
    const m = ctx.scn.motion;
    const s = t.m;
    s.timer -= dt;
    if (s.timer <= 0) {
      const flip = Math.random() < 0.7 ? -Math.sign(s.azWant || 1) : Math.sign(s.azWant || 1);
      s.azWant = flip * randIn(m.angSpeed) * DEG;
      s.elWant = randIn(m.elev) * DEG;
      s.distWant = randIn(m.dist);
      s.timer = randIn(m.retarget);
    }
    const dv = s.azWant - s.azVel;
    const step = m.angAccel * DEG * dt;
    s.azVel += Math.abs(dv) > step ? Math.sign(dv) * step : dv;
    s.az += s.azVel * dt;
    s.el += (s.elWant - s.el) * Math.min(1, dt * 1.6);
    s.dist += (s.distWant - s.dist) * Math.min(1, dt * 1.2);
    const px = t.pos.x;
    const py = t.pos.y;
    const pz = t.pos.z;
    this.place(t, ctx);
    if (dt > 0) t.vel.set((t.pos.x - px) / dt, (t.pos.y - py) / dt, (t.pos.z - pz) / dt);
  },
};

// Drifts in a wall plane and bounces off the edges.
const bounce = {
  spawn(t, ctx) {
    const m = ctx.scn.motion;
    spawnInBox(t, ctx, m.bounds);
    const a = rand(0, Math.PI * 2);
    const sp = randIn(m.speed);
    t.vel.set(Math.cos(a) * sp, Math.sin(a) * sp * 0.8, 0);
  },
  update(t, dt, ctx) {
    const b = ctx.scn.motion.bounds;
    t.pos.addScaledVector(t.vel, dt);
    if (t.pos.x < b.x[0]) { t.pos.x = b.x[0]; t.vel.x = Math.abs(t.vel.x); }
    if (t.pos.x > b.x[1]) { t.pos.x = b.x[1]; t.vel.x = -Math.abs(t.vel.x); }
    if (t.pos.y < b.y[0]) { t.pos.y = b.y[0]; t.vel.y = Math.abs(t.vel.y); }
    if (t.pos.y > b.y[1]) { t.pos.y = b.y[1]; t.vel.y = -Math.abs(t.vel.y); }
  },
};

const still = {
  spawn(t, ctx) {
    spawnInBox(t, ctx, ctx.scn.motion.bounds);
    t.vel.set(0, 0, 0);
  },
  update() {},
};

export const MOTIONS = { wander, strafe, air, orbit, bounce, static: still };
