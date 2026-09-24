// Target movement models. Each model has spawn(t, ctx) and update(t, dt, ctx).
// `t` is a target record: { pos: Vector3, vel: Vector3, m: {...model state} }.
// `ctx` gives access to the scenario, the eye position and the other targets.

const DEG = Math.PI / 180;

export const rand = (a, b) => a + Math.random() * (b - a);
const randIn = (range) => rand(range[0], range[1]);
const sign = () => (Math.random() < 0.5 ? -1 : 1);

function farEnough(t, pos, ctx) {
  const sep = ctx.scn.minSep ?? 2;
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

// Valorant-style agent movement. Speeds are community-measured Valorant values
// (run, shift-walk, crouch); acceleration, jump and crouch timings are tuned to
// feel like them rather than copied from the game.
export const AGENT = {
  run: 6.75, // m/s
  walk: 3.73,
  crouch: 2.03,
  accel: 60, // m/s², reaches full run speed in about 0.11 s
  decel: 90, // counter-strafe / release: a dead stop in about 0.075 s
  airAccel: 6, // weak air control, so a jump commits the bot to its arc
  jumpVel: 6.4, // with gravity 21: about 1 m apex, 0.6 s in the air
  gravity: 21,
  crouchTime: 0.12, // s to go fully down or up
  radius: 0.3, // body capsule
  bodyStand: 1.46, // top of the body capsule, standing
  bodyCrouch: 1.02, // ... crouched (head drops 0.44 m)
  neck: 0.05,
  head: 0.14, // head hitbox radius
};

// Body top and head centre height (above the feet) for the current crouch.
export function agentDims(t) {
  const c = t.m.crouch || 0;
  const top = AGENT.bodyStand + (AGENT.bodyCrouch - AGENT.bodyStand) * c;
  return { top, headY: top + AGENT.neck + AGENT.head };
}

// What each action looks like from the other side of a duel.
export const AGENT_MOVES = {
  strafe: 'ADAD strafes',
  stop: 'counter-strafe stops',
  swing: 'wide swings',
  walk: 'shift-walks',
  crouchWalk: 'crouch-walks',
  crouchSpam: 'crouch spam',
  jump: 'jumps',
};

// The bot picks weighted actions (motion.mix) back to back, the way a player
// chains ADAD, stops to shoot, crouches, walks and jumps. Positions are feet.
const agent = {
  spawn(t, ctx) {
    const m = ctx.scn.motion;
    for (let i = 0; i < 40; i++) {
      t.pos.set(randIn(m.x), 0, randIn(m.z));
      if (farEnough(t, t.pos, ctx)) break;
    }
    t.vel.set(0, 0, 0);
    Object.assign(t.m, {
      action: 'stop', timer: rand(0.05, 0.35), ix: 0, iz: 0, mode: 'run',
      crouchWant: false, crouch: 0, spam: 0, lastDir: sign(), grounded: true,
    });
  },

  decide(t, m) {
    const s = t.m;
    let total = 0;
    for (const k in m.mix) total += m.mix[k];
    let roll = Math.random() * total;
    let act = 'strafe';
    for (const k in m.mix) {
      roll -= m.mix[k];
      if (roll <= 0) { act = k; break; }
    }
    // Near a side wall, always head back toward the middle.
    const edge = t.pos.x < m.x[0] + 1 ? 1 : t.pos.x > m.x[1] - 1 ? -1 : 0;
    const dir = (reverse) => {
      if (edge) return edge;
      if (reverse && Math.random() < (m.adad ?? 0.8)) return -s.lastDir;
      return sign();
    };

    s.action = act;
    s.mode = 'run';
    s.crouchWant = false;
    s.spam = 0;
    s.ix = 0;
    s.iz = 0;
    switch (act) {
      // `gait` lets a scenario strafe at shift-walk speed instead of running.
      case 'strafe': s.ix = dir(true); s.mode = m.gait || 'run'; s.timer = randIn(m.strafeTime); break;
      case 'swing': s.ix = dir(false); s.mode = m.gait || 'run'; s.timer = randIn(m.swingTime || [0.5, 1.1]); break;
      case 'walk': s.ix = dir(false); s.mode = 'walk'; s.timer = rand(0.35, 1.0); break;
      case 'crouchWalk': s.ix = dir(false); s.crouchWant = true; s.timer = rand(0.35, 0.9); break;
      case 'crouchSpam':
        // Often mid-strafe, so speed flickers between run and crouch speed.
        s.ix = Math.random() < (m.spamStrafe ?? 0.5) ? dir(true) : 0;
        s.crouchWant = true;
        s.spam = rand(0.1, 0.2);
        s.timer = rand(0.5, 1.1);
        break;
      case 'jump':
        s.ix = Math.random() < (m.jumpStrafe ?? 0.7) ? dir(true) : 0;
        t.vel.y = AGENT.jumpVel;
        s.grounded = false;
        s.timer = 0.05; // the next action waits for the landing
        break;
      default: // stop
        s.crouchWant = Math.random() < (m.crouchOnStop || 0);
        s.timer = randIn(m.stopTime);
    }
    if (s.ix) s.lastDir = s.ix;
    // Some moves add W or S so the range keeps changing.
    if (s.ix && Math.random() < (m.depth || 0)) {
      s.iz = t.pos.z < m.z[0] + 1 ? 1 : t.pos.z > m.z[1] - 1 ? -1 : sign();
    }
  },

  update(t, dt, ctx) {
    const m = ctx.scn.motion;
    const s = t.m;
    const A = AGENT;
    s.timer -= dt;
    if (s.spam > 0) {
      s.spam -= dt;
      if (s.spam <= 0) { s.crouchWant = !s.crouchWant; s.spam = rand(0.1, 0.22); }
    }
    if (s.timer <= 0 && s.grounded) this.decide(t, m);
    if ((t.pos.x < m.x[0] && s.ix < 0) || (t.pos.x > m.x[1] && s.ix > 0)) { s.ix = -s.ix; s.lastDir = s.ix; }
    if ((t.pos.z < m.z[0] && s.iz < 0) || (t.pos.z > m.z[1] && s.iz > 0)) s.iz = 0;

    const want = s.crouchWant ? 1 : 0;
    const cstep = dt / A.crouchTime;
    s.crouch += Math.max(-cstep, Math.min(cstep, want - s.crouch));

    const speed = s.crouch > 0.5 ? A.crouch : s.mode === 'walk' ? A.walk : A.run;
    let wx = s.ix;
    let wz = s.iz;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx = (wx / wl) * speed; wz = (wz / wl) * speed; }
    const dvx = wx - t.vel.x;
    const dvz = wz - t.vel.z;
    const dl = Math.hypot(dvx, dvz);
    if (dl > 1e-6) {
      let rate = A.accel;
      if (!s.grounded) rate = A.airAccel;
      else if (wl === 0 || wx * t.vel.x + wz * t.vel.z < 0) rate = A.decel;
      const k = Math.min(1, (rate * dt) / dl);
      t.vel.x += dvx * k;
      t.vel.z += dvz * k;
    }
    if (!s.grounded) t.vel.y -= A.gravity * dt;
    t.pos.addScaledVector(t.vel, dt);
    if (!s.grounded && t.pos.y <= 0) { t.pos.y = 0; t.vel.y = 0; s.grounded = true; }

    const lo = m.x[0] - 0.5;
    const hi = m.x[1] + 0.5;
    if (t.pos.x < lo) { t.pos.x = lo; t.vel.x = 0; }
    if (t.pos.x > hi) { t.pos.x = hi; t.vel.x = 0; }
    if (t.pos.z < m.z[0] - 0.5) { t.pos.z = m.z[0] - 0.5; t.vel.z = 0; }
    if (t.pos.z > m.z[1] + 0.5) { t.pos.z = m.z[1] + 0.5; t.vel.z = 0; }
  },
};

// Move an agent toward (tx, tz) at `speed` with Valorant-like acceleration
// and a counter-strafe stop on arrival. Returns true once it has arrived.
function runToward(t, dt, tx, tz, speed) {
  const dx = tx - t.pos.x;
  const dz = tz - t.pos.z;
  const dist = Math.hypot(dx, dz);
  const v = Math.hypot(t.vel.x, t.vel.z);
  let wx = 0;
  let wz = 0;
  if (dist > (v * v) / (2 * AGENT.decel) + 0.03) { wx = (dx / dist) * speed; wz = (dz / dist) * speed; }
  const dvx = wx - t.vel.x;
  const dvz = wz - t.vel.z;
  const dl = Math.hypot(dvx, dvz);
  if (dl > 1e-6) {
    const braking = (wx === 0 && wz === 0) || wx * t.vel.x + wz * t.vel.z < 0;
    const k = Math.min(1, ((braking ? AGENT.decel : AGENT.accel) * dt) / dl);
    t.vel.x += dvx * k;
    t.vel.z += dvz * k;
  }
  t.pos.x += t.vel.x * dt;
  t.pos.z += t.vel.z * dt;
  if (dist < 0.06 && v < 0.4) {
    t.pos.x = tx;
    t.pos.z = tz;
    t.vel.set(0, 0, 0);
    return true;
  }
  return false;
}

// An agent holding a crate: waits hidden, then wide-swings, jiggles or runs
// across to another crate, the way players peek an Operator.
const peek = {
  hiddenAt(c) {
    return [c.x, c.z - c.d / 2 - 0.6];
  },
  spawn(t, ctx) {
    const covers = ctx.scn.arena.covers;
    const taken = new Set(ctx.targets.filter((o) => o !== t && o.alive).map((o) => o.m.cover));
    let ci = Math.floor(Math.random() * covers.length);
    for (let i = 0; i < 12 && taken.has(ci); i++) ci = Math.floor(Math.random() * covers.length);
    const [hx, hz] = this.hiddenAt(covers[ci]);
    t.pos.set(hx, 0, hz);
    t.vel.set(0, 0, 0);
    Object.assign(t.m, {
      cover: ci, state: 'wait', timer: randIn(ctx.scn.motion.wait), tx: hx, tz: hz,
      crouch: 0, crouchWant: false, grounded: true,
    });
  },
  update(t, dt, ctx) {
    const m = ctx.scn.motion;
    const covers = ctx.scn.arena.covers;
    const s = t.m;
    const c = covers[s.cover];
    s.timer -= dt;
    const arrived = runToward(t, dt, s.tx, s.tz, s.crouchWant ? AGENT.crouch : AGENT.run);
    const home = this.hiddenAt(c);
    if (s.state === 'wait' && s.timer <= 0) {
      const r = Math.random();
      if (r < (m.cross || 0) && covers.length > 1) {
        let next = s.cover;
        while (next === s.cover) next = Math.floor(Math.random() * covers.length);
        s.cover = next;
        [s.tx, s.tz] = this.hiddenAt(covers[next]);
        s.state = 'move';
      } else {
        const jiggle = r < (m.cross || 0) + (m.jiggle || 0);
        const side = sign();
        const out = jiggle ? rand(0.35, 0.8) : randIn(m.peekDist);
        s.tx = c.x + side * (c.w / 2 + 0.3 + out);
        s.tz = home[1];
        s.state = jiggle ? 'jiggle' : 'out';
      }
    } else if (arrived && s.state === 'out') {
      s.state = 'hold';
      s.timer = randIn(m.hold);
      s.crouchWant = Math.random() < (m.crouchOnHold || 0);
    } else if ((arrived && s.state === 'jiggle') || (s.state === 'hold' && s.timer <= 0)) {
      s.crouchWant = false;
      [s.tx, s.tz] = home;
      s.state = 'move';
    } else if (arrived && s.state === 'move') {
      s.state = 'wait';
      s.timer = randIn(m.wait);
    }
    const cstep = dt / AGENT.crouchTime;
    s.crouch += Math.max(-cstep, Math.min(cstep, (s.crouchWant ? 1 : 0) - s.crouch));
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

export const MOTIONS = { wander, strafe, agent, peek, air, orbit, bounce, static: still };
