// Scenario definitions. Units are metres, seconds and degrees.
// The player's eye sits at `arena.eye` (default [0, 1.7, 0]) looking down -Z.
import { AGENT, AGENT_MOVES } from './motion.js';

export const CATEGORIES = [
  { id: 'tracking', name: 'Tracking', blurb: 'Hold fire and keep the crosshair glued to a moving target.' },
  { id: 'switching', name: 'Target switching', blurb: 'Track a target down, then snap to the next one.' },
  { id: 'clicking', name: 'Clicking', blurb: 'One click per target. Speed matters, misses cost points.' },
  { id: 'valorant', name: 'Valorant movement', blurb: 'Agent-sized bots that run, counter-strafe, crouch and jump like Valorant players.' },
  { id: 'sniping', name: 'Sniping', blurb: 'Operator training with the AWP: scope with right click, one shot every 1.67 s.' },
];

// Valorant Operator numbers: 0.6 rounds/s, 2.5x and 5x zoom, 255 head /
// 150 body / 120 legs. Ammo is infinite here: no magazine, no reload, so a
// run is all aiming. The scope-in time is not published, so it is an
// estimate the player can change in Settings.
export const OPERATOR = {
  fireInterval: 1 / 0.6,
  zooms: [2.5, 5],
  damage: { head: 255, body: 150, legs: 120 },
  hipSpread: 5, // degrees; unscoped Operator shots are close to useless
};

// Long range with crates to hide behind (x, z centre; w, d footprint; h height).
const CRATES = [
  { x: -11, z: -26, w: 2.2, h: 2.1, d: 2.2 },
  { x: -3.5, z: -34, w: 2.2, h: 2.1, d: 2.2 },
  { x: 5, z: -28, w: 2.2, h: 2.1, d: 2.2 },
  { x: 12.5, z: -37, w: 2.2, h: 2.1, d: 2.2 },
  { x: -15, z: -43, w: 2.2, h: 2.1, d: 2.2 },
  { x: 3, z: -46, w: 3, h: 2.1, d: 2.2 },
];
const RANGE = { w: 50, h: 16, zMin: -70, zMax: 4, covers: CRATES };
const FIELD = { w: 50, h: 16, zMin: -70, zMax: 4 };
const OP = { type: 'sniper', points: 100, headBonus: 50, missPenalty: 20 };

const HALL = { w: 40, h: 14, zMin: -34, zMax: 4 };
const ROOM = { w: 30, h: 12, zMin: -22, zMax: 4 };

// Every behaviour in the agent model, weighted like a mid-duel player.
const DUEL_MIX = { strafe: 5, stop: 2, swing: 1.2, walk: 1.2, crouchWalk: 0.6, crouchSpam: 0.7, jump: 1.2 };

export const SCENARIOS = [
  // ---------------------------------------------------------------- tracking
  {
    id: 'smoothbot',
    name: 'Smoothbot',
    category: 'tracking',
    blurb: 'A single orb glides in long, curving arcs at mid range. The baseline tracking drill: smooth, reactive, no sudden stops.',
    duration: 60,
    arena: HALL,
    weapon: { type: 'beam', dps: 100 },
    count: 1,
    target: { shape: 'sphere', radius: 0.55 },
    motion: {
      type: 'wander', speed: [4.5, 9], retarget: [0.5, 1.3], accel: 11,
      bounds: { x: [-9, 9], y: [1, 5.5], z: [-18, -12] }, zScale: 0.35,
    },
  },
  {
    id: 'strafe-track',
    name: 'Strafe Track',
    category: 'tracking',
    blurb: 'A player-sized bot runs ADAD strafes with random timing and the odd jump. Read the direction change and stay on the body.',
    duration: 60,
    arena: HALL,
    weapon: { type: 'beam', dps: 100 },
    count: 1,
    target: { shape: 'capsule', radius: 0.4, height: 1.8 },
    motion: {
      type: 'strafe', speed: 6.2, accel: 55, switchTime: [0.25, 0.95],
      x: [-8, 8], z: [-16, -10], jumpRate: 0.18, jumpVel: 5.6, gravity: 16,
    },
  },
  {
    id: 'close-strafes',
    name: 'Close Strafes',
    category: 'tracking',
    blurb: 'The same strafing bot at arm’s length. At 6 m every strafe is a big angular swing, so this one is about arm control.',
    duration: 60,
    arena: ROOM,
    weapon: { type: 'beam', dps: 100 },
    count: 1,
    target: { shape: 'capsule', radius: 0.45, height: 1.8 },
    motion: {
      type: 'strafe', speed: 7, accel: 70, switchTime: [0.2, 0.7],
      x: [-6, 6], z: [-7.5, -4.5], jumpRate: 0.35, jumpVel: 6, gravity: 17,
    },
  },
  {
    id: 'air-track',
    name: 'Air Track',
    category: 'tracking',
    blurb: 'The orb bounces through the air on ballistic arcs and air-strafes mid-flight. Follow the vertical as closely as the horizontal.',
    duration: 60,
    arena: HALL,
    weapon: { type: 'beam', dps: 100 },
    count: 1,
    target: { shape: 'sphere', radius: 0.5 },
    motion: {
      type: 'air', speedX: [3, 7], speedZ: 1.5, jumpVel: [8, 11.5], gravity: 11,
      strafeTime: [0.35, 1.0], bounds: { x: [-10, 10], y: [1.2, 11], z: [-19, -12] },
    },
  },
  {
    id: 'precise-orb',
    name: 'Precise Orb',
    category: 'tracking',
    blurb: 'A small, slow orb far down the hall. Movement is gentle, the margin for error is not. Tests micro-adjustments and a steady hand.',
    duration: 60,
    arena: HALL,
    weapon: { type: 'beam', dps: 100 },
    count: 1,
    target: { shape: 'sphere', radius: 0.24 },
    motion: {
      type: 'wander', speed: [1.4, 3.4], retarget: [0.8, 2], accel: 4,
      bounds: { x: [-7, 7], y: [1, 5], z: [-26, -20] }, zScale: 0.3,
    },
  },
  {
    id: 'orbit',
    name: 'Orbit',
    category: 'tracking',
    blurb: 'The orb circles you at close range, reversing without warning. You will turn all the way around, often.',
    duration: 60,
    arena: { w: 30, h: 14, zMin: -15, zMax: 15 },
    weapon: { type: 'beam', dps: 100 },
    count: 1,
    target: { shape: 'sphere', radius: 0.5 },
    motion: {
      type: 'orbit', dist: [4.5, 7], angSpeed: [45, 115], angAccel: 320,
      elev: [-6, 38], retarget: [0.6, 1.6],
    },
  },

  // --------------------------------------------------------------- switching
  {
    id: 'switch-track',
    name: 'Switch Track',
    category: 'switching',
    blurb: 'Three orbs, 70 HP each. Track one down, then switch to whichever is closest. A new orb spawns for every kill.',
    duration: 60,
    arena: HALL,
    weapon: { type: 'beam', dps: 100 },
    count: 3,
    target: { shape: 'sphere', radius: 0.5, hp: 70 },
    motion: {
      type: 'wander', speed: [3, 6.5], retarget: [0.5, 1.4], accel: 10,
      bounds: { x: [-11, 11], y: [1, 6.5], z: [-19, -12] }, zScale: 0.35,
    },
    minSep: 3,
  },
  {
    id: 'strafe-switch',
    name: 'Strafe Switch',
    category: 'switching',
    blurb: 'Three strafing bots at staggered distances, 100 HP each. Kill, reacquire, repeat.',
    duration: 60,
    arena: HALL,
    weapon: { type: 'beam', dps: 100 },
    count: 3,
    target: { shape: 'capsule', radius: 0.42, height: 1.8, hp: 100 },
    motion: {
      type: 'strafe', speed: 5.8, accel: 50, switchTime: [0.3, 1.0],
      x: [-11, 11], z: [-20, -8], jumpRate: 0.12, jumpVel: 5.4, gravity: 16,
    },
    minSep: 3,
  },

  // ---------------------------------------------------------------- clicking
  {
    id: 'six-shot',
    name: 'Six Shot',
    category: 'clicking',
    blurb: 'Six small static targets on a close wall. Each kill spawns a replacement. Short, precise flicks between neighbours.',
    duration: 60,
    arena: ROOM,
    weapon: { type: 'click', points: 100, missPenalty: 20 },
    count: 6,
    target: { shape: 'sphere', radius: 0.3 },
    motion: { type: 'static', bounds: { x: [-4.2, 4.2], y: [0.7, 4.4], z: [-10, -10] } },
    minSep: 1.1,
  },
  {
    id: 'wide-flick',
    name: 'Wide Flick',
    category: 'clicking',
    blurb: 'Three targets spread across a wide wall. Long flicks, then stop dead on the target.',
    duration: 60,
    arena: HALL,
    weapon: { type: 'click', points: 100, missPenalty: 20 },
    count: 3,
    target: { shape: 'sphere', radius: 0.42 },
    motion: { type: 'static', bounds: { x: [-12, 12], y: [0.8, 5.5], z: [-12, -12] } },
    minSep: 5,
  },
  {
    id: 'bounce-shot',
    name: 'Bounce Shot',
    category: 'clicking',
    blurb: 'Five targets drift and bounce around a wall. Match their speed for a moment, then click.',
    duration: 60,
    arena: HALL,
    weapon: { type: 'click', points: 100, missPenalty: 20 },
    count: 5,
    target: { shape: 'sphere', radius: 0.4 },
    motion: { type: 'bounce', speed: [3, 6], bounds: { x: [-9, 9], y: [0.8, 6], z: [-13, -13] } },
    minSep: 1.5,
  },
  {
    id: 'micro-flick',
    name: 'Micro Flick',
    category: 'clicking',
    blurb: 'One tiny target at a time, anywhere on the wall. Fast reaction, precise stop, no wasted shots.',
    duration: 60,
    arena: HALL,
    weapon: { type: 'click', points: 100, missPenalty: 20 },
    count: 1,
    target: { shape: 'sphere', radius: 0.16 },
    motion: { type: 'static', bounds: { x: [-6, 6], y: [0.8, 4.8], z: [-12, -12] } },
    minSep: 1.5,
  },

  // ---------------------------------------------------------------- valorant
  {
    id: 'val-horizontal',
    name: 'Horizontal Tracking',
    category: 'valorant',
    blurb: 'Pure left-right tracking at head level. The agent strafes and counter-strafes but never jumps, crouches or changes range, so every correction is horizontal. The head-only hitbox is on by default.',
    duration: 60,
    arena: HALL,
    weapon: { type: 'beam', dps: 150 },
    count: 1,
    target: { shape: 'agent', headOnly: true },
    motion: {
      type: 'agent', x: [-9, 9], z: [-11, -9], depth: 0, adad: 0.8,
      mix: { strafe: 6, swing: 2, stop: 1.5 },
      strafeTime: [0.25, 0.8], swingTime: [0.6, 1.3], stopTime: [0.08, 0.25],
    },
    // Difficulty only changes how the agent strafes; motion keys override the above.
    levels: {
      easy: { hint: 'Shift-walk speed, long strafes, few stops', motion: { gait: 'walk', mix: { strafe: 6, swing: 2, stop: 1 }, strafeTime: [0.45, 1.2], swingTime: [0.9, 1.8] } },
      medium: { hint: 'Run speed, a mix of short and long strafes', motion: {} },
      hard: { hint: 'Run speed, ADAD spam and snap counter-strafes', motion: { mix: { strafe: 9, swing: 1, stop: 2.5 }, strafeTime: [0.12, 0.42], stopTime: [0.06, 0.2], adad: 0.9 } },
    },
    defaultLevel: 'medium',
    minSep: 2,
  },
  {
    id: 'val-adad',
    name: 'ADAD Strafes',
    category: 'valorant',
    blurb: 'The bot spams short A-D strafes at full run speed, sometimes counter-strafing to a dead stop in between. Stay on it through every reversal.',
    duration: 60,
    arena: HALL,
    weapon: { type: 'beam', dps: 150 },
    count: 1,
    target: { shape: 'agent' },
    motion: {
      type: 'agent', x: [-8, 8], z: [-15, -11],
      mix: { strafe: 10, stop: 2.5, swing: 1 },
      strafeTime: [0.14, 0.4], stopTime: [0.08, 0.28], adad: 0.85, depth: 0.08,
    },
    minSep: 2,
  },
  {
    id: 'val-crouch',
    name: 'Crouch Spam',
    category: 'valorant',
    blurb: 'Strafes, stops and crouch-spam the way players do while spraying. Every crouch drops the head 0.44 m, so correct vertically as fast as you do horizontally.',
    duration: 60,
    arena: HALL,
    weapon: { type: 'beam', dps: 150 },
    count: 1,
    target: { shape: 'agent' },
    motion: {
      type: 'agent', x: [-8, 8], z: [-15, -11],
      mix: { strafe: 5, stop: 2, crouchSpam: 2.5, crouchWalk: 1 },
      strafeTime: [0.15, 0.45], stopTime: [0.15, 0.45], adad: 0.75, crouchOnStop: 0.7, spamStrafe: 0.6, depth: 0.1,
    },
    minSep: 2,
  },
  {
    id: 'val-jump',
    name: 'Jump Peeks',
    category: 'valorant',
    blurb: 'Strafes broken up by jumps. Air control is weak, so once the bot leaves the ground its arc is committed. Follow it up and track the landing.',
    duration: 60,
    arena: HALL,
    weapon: { type: 'beam', dps: 150 },
    count: 1,
    target: { shape: 'agent' },
    motion: {
      type: 'agent', x: [-9, 9], z: [-16, -11],
      mix: { strafe: 4, jump: 2.5, swing: 1, stop: 1 },
      strafeTime: [0.15, 0.45], stopTime: [0.1, 0.3], adad: 0.8, jumpStrafe: 0.8, depth: 0.1,
    },
    minSep: 2,
  },
  {
    id: 'val-duel',
    name: 'Duel Mix',
    category: 'valorant',
    blurb: 'Every movement at once: ADAD, counter-strafe stops, crouch spam, shift-walks, jumps and wide swings. Three agents at 150 HP. Track one down, then switch.',
    duration: 60,
    arena: HALL,
    weapon: { type: 'beam', dps: 150 },
    count: 3,
    target: { shape: 'agent', hp: 150 },
    respawn: 0.35,
    motion: {
      type: 'agent', x: [-12, 12], z: [-22, -10], mix: DUEL_MIX,
      strafeTime: [0.14, 0.45], stopTime: [0.12, 0.4], adad: 0.8, crouchOnStop: 0.35, jumpStrafe: 0.7, depth: 0.2,
    },
    minSep: 3,
  },
  {
    id: 'val-close',
    name: 'Close Duel',
    category: 'valorant',
    blurb: 'The full movement mix at 5 to 8 m, where each strafe sweeps across the screen. Two agents at 150 HP.',
    duration: 60,
    arena: ROOM,
    weapon: { type: 'beam', dps: 150 },
    count: 2,
    target: { shape: 'agent', hp: 150 },
    respawn: 0.35,
    motion: {
      type: 'agent', x: [-6, 6], z: [-8, -5], mix: DUEL_MIX,
      strafeTime: [0.14, 0.4], stopTime: [0.1, 0.35], adad: 0.8, crouchOnStop: 0.35, jumpStrafe: 0.7, depth: 0.15,
    },
    minSep: 2,
  },


  // ---------------------------------------------------------------- sniping
  {
    id: 'op-angles',
    name: 'Op Angles',
    category: 'sniping',
    blurb: 'Hold an angle with the Operator. Agents wide-swing, jiggle and swap crates 26–46 m out. Scope in, wait for the peek, click.',
    duration: 60,
    arena: RANGE,
    weapon: OP,
    count: 2,
    target: { shape: 'agent', hp: 150 },
    respawn: 0.6,
    motion: { type: 'peek', peekDist: [1.2, 3.2], wait: [0.6, 2.2], hold: [0.25, 0.9], jiggle: 0.25, cross: 0.12, crouchOnHold: 0.2 },
  },
  {
    id: 'op-flicks',
    name: 'Op Flicks',
    category: 'sniping',
    blurb: 'Agents appear anywhere across an open field at 18–42 m and stand or shift-walk. Flick, let the scope settle, fire. A miss costs you 1.67 s.',
    duration: 60,
    arena: FIELD,
    weapon: OP,
    count: 1,
    target: { shape: 'agent', hp: 150 },
    respawn: 0.35,
    motion: {
      type: 'agent', x: [-16, 16], z: [-42, -18], mix: { stop: 3, walk: 1.2 },
      strafeTime: [0.3, 0.8], stopTime: [0.8, 2], adad: 0.5, depth: 0.2,
    },
    minSep: 6,
  },
  {
    id: 'op-crossing',
    name: 'Op Crossing',
    category: 'sniping',
    blurb: 'Agents sprint across the gaps between crates at full run speed. Pre-aim the gap and time the shot.',
    duration: 60,
    arena: RANGE,
    weapon: OP,
    count: 2,
    target: { shape: 'agent', hp: 150 },
    respawn: 0.6,
    motion: { type: 'peek', peekDist: [2, 4], wait: [0.5, 1.6], hold: [0.15, 0.4], jiggle: 0.05, cross: 0.8 },
  },
];

export function eyeOf(scn) {
  return scn.arena.eye || [0, 1.7, 0];
}

// ------------------------------------------------------------------ setups
// A setup is the player's adjustable part of a scenario. Scores are only
// compared between runs with the same setup.
export const HP_CHOICES = [0, 50, 100, 150, 250, 500]; // 0 = unlimited

export function countLimit(scn) {
  if (scn.weapon.type === 'sniper') return scn.arena.covers ? scn.arena.covers.length : 6;
  return scn.weapon.type === 'click' ? 12 : 10;
}

export const LEVEL_NAMES = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

export function defaultSetup(scn) {
  const v = { count: scn.count, hp: scn.target.hp || 0, headOnly: !!scn.target.headOnly };
  if (scn.levels) v.level = scn.defaultLevel;
  return v;
}

// The scenario as it plays with this setup: difficulty levels override motion.
export function effectiveScenario(scn, v) {
  if (!scn.levels || !v || !scn.levels[v.level]) return scn;
  return { ...scn, motion: { ...scn.motion, ...scn.levels[v.level].motion } };
}

export function normalizeSetup(scn, s) {
  const d = defaultSetup(scn);
  const v = { ...d, ...(s || {}) };
  v.count = Math.max(1, Math.min(countLimit(scn), Math.round(v.count) || d.count));
  if (scn.weapon.type !== 'beam' || !HP_CHOICES.includes(v.hp)) v.hp = d.hp;
  if (scn.target.shape !== 'agent') v.headOnly = false;
  v.headOnly = !!v.headOnly;
  if (!scn.levels) delete v.level;
  else if (!scn.levels[v.level]) v.level = d.level;
  return v;
}

export function setupKey(v) {
  return `n${v.count}-hp${v.hp || 'inf'}${v.headOnly ? '-head' : ''}${v.level ? `-${v.level}` : ''}`;
}

export function setupLabel(scn, v) {
  const parts = [`${v.count} target${v.count === 1 ? '' : 's'}`];
  if (scn.weapon.type === 'beam') parts.push(v.hp ? `${v.hp} HP` : 'unlimited HP');
  if (v.headOnly) parts.push('head only');
  if (v.level) parts.push(LEVEL_NAMES[v.level]);
  return parts.join(' · ');
}

// ---------------------------------------------------------------- describe
// Rough numbers for the detail panel: distance, angular size, speed text.
export function describe(scn, v = defaultSetup(scn)) {
  const [ex, ey, ez] = eyeOf(scn);
  const m = effectiveScenario(scn, v).motion;
  const agent = scn.target.shape === 'agent';
  const headY = AGENT.bodyStand + AGENT.neck + AGENT.head;
  let dist;
  if (m.type === 'orbit') {
    dist = (m.dist[0] + m.dist[1]) / 2;
  } else if (m.type === 'peek') {
    const cs = scn.arena.covers;
    dist = cs.reduce((a, c) => a + Math.hypot(c.x - ex, headY - ey, c.z - ez), 0) / cs.length;
  } else if (agent) {
    dist = Math.hypot(0, headY - ey, (m.z[0] + m.z[1]) / 2 - ez);
  } else if (m.type === 'strafe') {
    dist = Math.hypot(0, 0.9 - ey, (m.z[0] + m.z[1]) / 2 - ez);
  } else {
    const b = m.bounds;
    const cx = (b.x[0] + b.x[1]) / 2 - ex;
    const cy = (b.y[0] + b.y[1]) / 2 - ey;
    const cz = (b.z[0] + b.z[1]) / 2 - ez;
    dist = Math.hypot(cx, cy, cz);
  }
  const r = agent ? AGENT.head : scn.target.radius;
  const angular = (2 * Math.atan(r / dist) * 180) / Math.PI;

  let speed = 'Static';
  const strafeOnly = agent && m.mix && Object.keys(m.mix).every((k) => ['strafe', 'swing', 'stop'].includes(k));
  if (m.type === 'peek') {
    speed = `${AGENT.run} m/s swings and runs`;
  } else if (strafeOnly) {
    const gait = m.gait === 'walk' ? `${AGENT.walk} m/s shift-walk` : `${AGENT.run} m/s run`;
    speed = `${gait} · strafes ${m.strafeTime[0]}–${m.strafeTime[1]} s`;
  } else if (agent) speed = `${AGENT.run} m/s run · ${AGENT.walk} walk · ${AGENT.crouch} crouch`;
  else if (m.type === 'wander' || m.type === 'bounce') speed = `${m.speed[0]}–${m.speed[1]} m/s`;
  else if (m.type === 'strafe') speed = `${m.speed} m/s strafes`;
  else if (m.type === 'air') speed = `${m.speedX[0]}–${m.speedX[1]} m/s + jumps`;
  else if (m.type === 'orbit') speed = `${m.angSpeed[0]}–${m.angSpeed[1]} °/s`;

  let size = `${(r * 2).toFixed(2)} m orb`;
  if (agent) size = `${(headY + AGENT.head).toFixed(2)} m agent`;
  else if (scn.target.shape === 'capsule') size = `${(r * 2).toFixed(2)} × ${scn.target.height} m bot`;

  let fire;
  let scoring;
  if (scn.weapon.type === 'sniper') {
    fire = 'AWP with Operator handling: 0.6 shots/s, 2.5x / 5x zoom';
    scoring = `+${scn.weapon.points} per kill, +${scn.weapon.headBonus} headshot, −${scn.weapon.missPenalty} per miss`;
  } else if (scn.weapon.type === 'beam') {
    fire = 'Beam, hold mouse 1';
    scoring = `${scn.weapon.dps} damage per second on ${v.headOnly ? 'the head' : 'target'}`;
  } else {
    fire = 'Hitscan, one shot per click';
    scoring = `+${scn.weapon.points} per kill · −${scn.weapon.missPenalty} per miss`;
  }

  return {
    distance: `${dist.toFixed(1)} m`,
    angular: agent ? `head spans ${angular.toFixed(2)}°` : `${angular.toFixed(2)}° wide`,
    size,
    speed,
    moves: m.type === 'peek'
      ? ['wide swings from behind crates', m.jiggle ? 'jiggle peeks' : null, m.cross ? 'crate-to-crate runs' : null, m.crouchOnHold ? 'crouched holds' : null].filter(Boolean).join(', ')
      : agent ? Object.keys(m.mix).map((k) => AGENT_MOVES[k]).join(', ') : null,
    fire,
    scoring,
    health: scn.weapon.type === 'sniper'
      ? `${scn.target.hp} HP: head 255, body 150, legs 120`
      : scn.weapon.type === 'beam'
        ? (v.hp ? `${v.hp} HP each${scn.respawn ? `, respawn after ${scn.respawn} s` : ''}` : 'Unlimited, never dies')
        : 'One shot',
  };
}
