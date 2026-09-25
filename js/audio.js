// Small synthesized sound set, plus recorded sounds for the Vandal, M4A1-S,
// AK-47 and AWP (shots, draws, the AWP's bolt) and CS:GO's headshot.
// The AudioContext starts on the first user gesture.
import {
  VANDAL_FIRE, M4A1S_FIRE, AK47_FIRE, AK47_DRAW, AWP_FIRE, AWP_BOLT_BACK, AWP_BOLT_FORWARD, AWP_DRAW, AFTERGLOW_FIRE, KNIFE_DRAW, HEADSHOT,
} from './gun-sounds.js';

let ctx = null;
let master = null;
let noiseBuf = null;
let verb = null; // room echo for the sniper
let volume = 0.6;

export function initAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = volume;
  // Soft clipper (out = tanh(in)): quiet sounds pass unchanged, and a loud
  // sniper shot is rounded off instead of clipping harshly.
  const pre = ctx.createGain();
  pre.gain.value = 0.25;
  const clip = ctx.createWaveShaper();
  const curve = new Float32Array(2048);
  for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(4 * ((i / (curve.length - 1)) * 2 - 1));
  clip.curve = curve;
  clip.oversample = '2x';
  master.connect(pre).connect(clip).connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  // Room echo: a decaying noise impulse, like a shot in a big hall.
  const len = Math.floor(ctx.sampleRate * 1.6);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const ch = ir.getChannelData(c);
    for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3.2;
  }
  verb = ctx.createConvolver();
  verb.buffer = ir;
  const wet = ctx.createGain();
  wet.gain.value = 0.55;
  verb.connect(wet).connect(master);
  for (const c of Object.values(customSounds)) decodeCustom(c);
  for (const [kind, list] of Object.entries(SAMPLE_DATA)) {
    samples[kind] = [];
    for (const b64 of list) {
      ctx.decodeAudioData(b64ToBuffer(b64)).then((b) => samples[kind].push(b)).catch(() => {});
    }
  }
}

// Recorded sounds that ship with Trackline.
const SAMPLE_DATA = {
  champions: VANDAL_FIRE,
  afterglow: AFTERGLOW_FIRE,
  m4a1s: M4A1S_FIRE,
  ak47: AK47_FIRE,
  awp: AWP_FIRE,
  awpBoltBack: AWP_BOLT_BACK,
  awpBoltForward: AWP_BOLT_FORWARD,
  awpDraw: AWP_DRAW,
  rifleDraw: AK47_DRAW,
  knifeDraw: KNIFE_DRAW,
  knifeFlip: KNIFE_DRAW,
  headshot: HEADSHOT,
};
const SAMPLE_GAIN = {
  champions: 0.22,
  afterglow: 0.3,
  m4a1s: 0.2,
  ak47: 0.24,
  awp: 0.65,
  awpBoltBack: 0.2,
  awpBoltForward: 0.2,
  awpDraw: 0.3,
  rifleDraw: 0.22,
  knifeDraw: 0.2,
  knifeFlip: 0.1,
  headshot: 0.28,
};
const samples = {}; // kind -> decoded AudioBuffers

function b64ToBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

// One of `kind`'s recordings, slightly re-pitched (up to +-`pitch`), after
// `delay` seconds. False until decoded.
function playSample(kind, { delay = 0, pitch = 0.03 } = {}) {
  const list = samples[kind];
  if (!ctx || volume === 0 || !list || !list.length) return false;
  const src = ctx.createBufferSource();
  src.buffer = list[Math.floor(Math.random() * list.length)];
  src.playbackRate.value = 1 + (Math.random() * 2 - 1) * pitch;
  const g = ctx.createGain();
  g.gain.value = SAMPLE_GAIN[kind] || 0.3;
  src.connect(g).connect(master);
  src.start(ctx.currentTime + delay);
  return true;
}

// ------------------------------------------------ the player's own sounds
// Sound files the player adds (a clip of a real gun, say). They live in this
// browser only and appear in the fire and kill sound lists.
const CUSTOM_SOUNDS_KEY = 'trackline.sounds.custom.v1';
const MAX_SOUND_BYTES = 1_500_000;
const customSounds = {}; // id -> { name, data, buffer }

function readCustomSounds() {
  try {
    const list = JSON.parse(localStorage.getItem(CUSTOM_SOUNDS_KEY));
    return Array.isArray(list) ? list : [];
  } catch (e) { return []; }
}

function decodeCustom(c) {
  if (!ctx || c.buffer || c.decoding) return;
  c.decoding = true;
  const bin = atob(c.data.split(',')[1] || '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  ctx.decodeAudioData(bytes.buffer).then((b) => { c.buffer = b; }).catch(() => { c.failed = true; });
}

export function loadCustomSounds() {
  for (const r of readCustomSounds()) if (r && r.id && r.data) customSounds[r.id] = { name: r.name, data: r.data };
}

export function customSoundList() {
  return Object.entries(customSounds).map(([id, c]) => [id, c.name]);
}

// Add an audio file. Resolves to its id; rejects with a message to show.
export function addCustomSound(file) {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_SOUND_BYTES) {
      reject(new Error('That file is over 1.5 MB. Trim it to the shot itself (a second or two) and try again.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('That file could not be read.'));
    reader.onload = () => {
      const probe = window.AudioContext || window.webkitAudioContext;
      const test = probe ? new probe() : null;
      const bin = atob(String(reader.result).split(',')[1] || '');
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const done = (ok) => {
        if (test) test.close();
        if (!ok) { reject(new Error('This browser can\'t play that file. MP3, WAV and OGG work everywhere.')); return; }
        const rec = { id: `snd-${Date.now().toString(36)}`, name: (file.name || 'My sound').replace(/\.[a-z0-9]+$/i, '').slice(0, 28), data: reader.result };
        const list = readCustomSounds();
        list.push(rec);
        try {
          localStorage.setItem(CUSTOM_SOUNDS_KEY, JSON.stringify(list));
        } catch (e) {
          reject(new Error('This browser has no room left for another sound. Delete one first.'));
          return;
        }
        customSounds[rec.id] = { name: rec.name, data: rec.data };
        decodeCustom(customSounds[rec.id]);
        resolve(rec.id);
      };
      if (!test) { done(true); return; }
      test.decodeAudioData(bytes.buffer).then(() => done(true)).catch(() => done(false));
    };
    reader.readAsDataURL(file);
  });
}

export function removeCustomSound(id) {
  delete customSounds[id];
  try { localStorage.setItem(CUSTOM_SOUNDS_KEY, JSON.stringify(readCustomSounds().filter((r) => r.id !== id))); } catch (e) { /* storage unavailable */ }
}

function playCustom(id, gain = 1) {
  const c = customSounds[id];
  if (!ctx || !c || volume === 0) return;
  if (!c.buffer) { decodeCustom(c); return; }
  const src = ctx.createBufferSource();
  src.buffer = c.buffer;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(g).connect(master);
  src.start();
}

export function setVolume(v) {
  volume = Math.max(0, Math.min(1, v));
  if (master) master.gain.value = volume;
}

function tone(freq, dur, { type = 'sine', gain = 0.3, slide = 0, delay = 0, out = null } = {}) {
  if (!ctx || volume === 0) return;
  const t0 = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(out || master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise(dur, { freq = 2000, q = 1, gain = 0.2, delay = 0, filter = 'bandpass', out = null } = {}) {
  if (!ctx || volume === 0) return;
  const t0 = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(out || master);
  src.start(t0, Math.random() * 1.5);
  src.stop(t0 + dur + 0.02);
}

// A whoosh: band-passed noise that swells and sweeps from f0 to f1.
function sweep(dur, f0, f1, { gain = 0.2, q = 1, delay = 0 } = {}) {
  if (!ctx || volume === 0) return;
  const t0 = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t0);
  f.frequency.exponentialRampToValueAtTime(f1, t0 + dur * 0.7);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + dur * 0.35);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t0, Math.random() * 1.5);
  src.stop(t0 + dur + 0.02);
}

// Fire sounds the player can pick per gun. 'auto' uses the gun's own.
export const FIRE_SOUNDS = {
  auto: 'Match the gun',
  champions: 'Champions 2021 Vandal (recorded)',
  afterglow: 'Afterglow Vandal (recorded)',
  m4a1s: 'M4A1-S suppressed (recorded)',
  ak47: 'AK-47 (recorded)',
  awp: 'AWP (recorded)',
  suppressed: 'Suppressed thump',
  rifle: 'Rifle crack',
  heavy: 'Heavy rifle',
  smg: 'SMG snap',
  sniper: 'Sniper boom',
  laser: 'Laser',
  soft: 'Soft click',
  off: 'Silent',
};

// Kill sounds. 'auto' uses the gun's own.
export const KILL_SOUNDS = {
  auto: 'Match the gun',
  classic: 'Classic ping',
  champions: 'Champions 2021 streak (made in code)',
  off: 'Silent',
};

// When the AWP's bolt goes back and forward after a shot (seconds); the
// viewmodel works the bolt at the same moments.
export const AWP_BOLT_AT = [0.5, 0.92];

const GUN_SOUNDS = {
  // CS2's M4A1-S with its suppressor, recorded; the synthesised thump
  // stands in until the recording has decoded.
  m4a1s() {
    if (playSample('m4a1s')) return;
    GUN_SOUNDS.suppressed();
  },
  // The Champions 2021 Vandal's recorded shot. Until it has decoded, a
  // synthesised stand-in: a heavy crack with a bright metallic ring.
  champions() {
    if (playSample('champions')) return;
    noise(0.05, { filter: 'highpass', freq: 3000, q: 0.7, gain: 0.34 });
    noise(0.14, { freq: 1500, q: 0.55, gain: 0.34 });
    tone(92, 0.13, { type: 'triangle', gain: 0.3, slide: -40 });
    tone(46, 0.18, { type: 'sine', gain: 0.22, slide: -14 });
    // Ring: inharmonic partials, like a struck bell.
    tone(1870, 0.2, { type: 'sine', gain: 0.045, delay: 0.004 });
    tone(2790, 0.14, { type: 'sine', gain: 0.03, delay: 0.004 });
    tone(4150, 0.09, { type: 'sine', gain: 0.018, delay: 0.004 });
    noise(0.16, { filter: 'lowpass', freq: 520, q: 0.7, gain: 0.07, delay: 0.03 });
  },
  // VALORANT's Afterglow Vandal, recorded; the Vandal stands in until it
  // decodes.
  afterglow() {
    if (playSample('afterglow')) return;
    GUN_SOUNDS.champions();
  },
  suppressed() {
    noise(0.07, { freq: 1400, q: 0.9, gain: 0.16 });
    tone(140, 0.06, { gain: 0.12, slide: -60 });
    noise(0.02, { freq: 4200, q: 3, gain: 0.05 });
  },
  rifle() {
    noise(0.16, { freq: 2200, q: 0.45, gain: 0.3 });
    tone(110, 0.1, { type: 'triangle', gain: 0.2, slide: -50 });
    noise(0.18, { freq: 650, q: 0.7, gain: 0.06, delay: 0.03 });
  },
  // CS2's AK-47, recorded; the heavy rifle stands in until it decodes.
  ak47() {
    if (playSample('ak47')) return;
    GUN_SOUNDS.heavy();
  },
  // CS2's AWP, recorded: the shot and its echo, then the bolt worked by
  // hand while the gun cycles. The made-in-code boom stands in until the
  // recordings decode.
  awp() {
    if (!playSample('awp', { pitch: 0.015 })) {
      GUN_SOUNDS.sniper();
      return;
    }
    playSample('awpBoltBack', { delay: AWP_BOLT_AT[0], pitch: 0.01 });
    playSample('awpBoltForward', { delay: AWP_BOLT_AT[1], pitch: 0.01 });
  },
  heavy() {
    noise(0.2, { freq: 1500, q: 0.5, gain: 0.32 });
    tone(80, 0.14, { type: 'triangle', gain: 0.26, slide: -35 });
    noise(0.05, { freq: 5000, q: 2, gain: 0.08 });
  },
  smg() {
    noise(0.07, { freq: 3000, q: 0.6, gain: 0.22 });
    tone(180, 0.05, { type: 'square', gain: 0.05, slide: -80 });
  },
  // The AWP: a sharp crack, a heavy blast and a low boom that rolls round
  // the room, far louder than the rifles, then the bolt worked by hand.
  sniper() {
    const bus = ctx && ctx.createGain();
    if (bus) {
      bus.gain.value = 0.75;
      bus.connect(master);
      bus.connect(verb);
    }
    noise(0.07, { filter: 'highpass', freq: 2500, q: 0.7, gain: 0.9, out: bus });
    noise(0.3, { freq: 900, q: 0.5, gain: 0.85, out: bus });
    noise(0.65, { filter: 'lowpass', freq: 190, q: 0.8, gain: 1.1, out: bus });
    tone(58, 0.55, { type: 'sine', gain: 0.9, slide: -26, out: bus });
    tone(140, 0.13, { type: 'triangle', gain: 0.35, slide: -70, out: bus });
    noise(1.3, { filter: 'lowpass', freq: 650, q: 0.5, gain: 0.22, delay: 0.04, out: bus });
    // Bolt: lift, pull back, push forward, lock down.
    noise(0.03, { freq: 3500, q: 3, gain: 0.14, delay: 0.62 });
    tone(1600, 0.02, { type: 'square', gain: 0.03, delay: 0.62 });
    noise(0.09, { freq: 2200, q: 1.5, gain: 0.1, delay: 0.71 });
    noise(0.06, { freq: 2700, q: 2, gain: 0.12, delay: 0.86 });
    noise(0.03, { freq: 4000, q: 3, gain: 0.13, delay: 0.95 });
    tone(1200, 0.025, { type: 'square', gain: 0.05, delay: 0.95 });
  },
  laser() { tone(1400, 0.12, { type: 'sawtooth', gain: 0.06, slide: -1100 }); },
  soft() {
    tone(900, 0.03, { type: 'triangle', gain: 0.1 });
    noise(0.02, { freq: 6000, q: 2, gain: 0.05 });
  },
  off() {},
};

// Champions-style kill: a bright bell arpeggio that starts higher with each
// kill of a streak; the fifth adds a full chord and a shimmer.
function championsKill(level) {
  const L = Math.max(1, Math.min(5, level));
  const root = 523.25 * 2 ** ((L - 1) * 2 / 12); // up a whole tone per kill
  const steps = [0, 4, 7, 12].slice(0, Math.min(4, L + 1));
  steps.forEach((st, i) => {
    const f = root * 2 ** (st / 12);
    tone(f, 0.32, { type: 'triangle', gain: 0.13, delay: i * 0.055 });
    tone(f * 2.01, 0.2, { type: 'sine', gain: 0.045, delay: i * 0.055 });
  });
  noise(0.06, { freq: 7000, q: 1.5, gain: 0.05 });
  if (L >= 5) {
    for (const st of [0, 4, 7, 12, 16]) tone(root * 2 ** (st / 12), 0.7, { type: 'triangle', gain: 0.07, delay: 0.24 });
    sweep(0.8, 3000, 9000, { gain: 0.05, q: 3, delay: 0.24 });
  }
}

export const sfx = {
  gun(kind) {
    if (customSounds[kind]) { playCustom(kind); return; }
    (GUN_SOUNDS[kind] || GUN_SOUNDS.rifle)();
  },
  // Knife, timed to the animations in knife.js: CS2's recorded flip as it's
  // drawn and in the inspect, and whooshes for the slashes and the heavy.
  knifeDraw() {
    if (playSample('knifeDraw', { delay: 0.05, pitch: 0.02 })) return;
    sweep(0.24, 2600, 7800, { gain: 0.12, q: 2.2 });
    tone(2950, 0.4, { type: 'sine', gain: 0.035, delay: 0.06 });
    tone(4420, 0.28, { type: 'sine', gain: 0.018, delay: 0.06 });
  },
  slash() { sweep(0.22, 520, 2600, { gain: 0.22, q: 1.2, delay: 0.03 }); },
  stab() {
    sweep(0.14, 900, 2400, { gain: 0.08, q: 1.2, delay: 0.1 });
    sweep(0.3, 380, 1700, { gain: 0.24, q: 1, delay: 0.36 });
  },
  knifeInspect() {
    for (const d of [0.25, 3.35]) {
      if (!playSample('knifeFlip', { delay: d, pitch: 0.03 })) sweep(0.18, 700, 2200, { gain: 0.07, q: 1.4, delay: d });
    }
    tone(3100, 0.05, { type: 'triangle', gain: 0.03, delay: 3.1 });
  },
  // A gun picked up: CS2's recorded draws (the AWP's own, the AK-47's for
  // the rifles), or clicks made in code until they decode.
  gunDraw(gunId) {
    if (playSample(gunId === 'awp' ? 'awpDraw' : 'rifleDraw', { pitch: 0.02 })) return;
    noise(0.04, { freq: 3200, q: 2, gain: 0.08, delay: 0.14 });
    tone(1250, 0.025, { type: 'square', gain: 0.04, delay: 0.16 });
    tone(880, 0.03, { type: 'square', gain: 0.05, delay: 0.26 });
  },
  // A hit to the head: CS:GO's headshot, or a bright tink until it decodes.
  headshot() {
    if (playSample('headshot', { pitch: 0.02 })) return;
    tone(2480, 0.18, { type: 'sine', gain: 0.09 });
    tone(2900, 0.12, { type: 'sine', gain: 0.05 });
    noise(0.04, { freq: 5000, q: 1.5, gain: 0.1 });
  },
  dry() { tone(2600, 0.02, { type: 'square', gain: 0.04 }); },
  scope() { noise(0.05, { freq: 5200, q: 4, gain: 0.04 }); },
  reload() {
    tone(700, 0.04, { type: 'square', gain: 0.05 });
    tone(520, 0.05, { type: 'square', gain: 0.05, delay: 0.9 });
    tone(900, 0.04, { type: 'square', gain: 0.06, delay: 3.4 });
  },
  shot() { noise(0.05, { freq: 3200, q: 0.8, gain: 0.12 }); },
  // `kind` from KILL_SOUNDS or a custom sound id; `level` 1-5 is the kill's
  // place in a streak (the Champions sound climbs with it).
  kill(kind = 'classic', level = 1) {
    if (kind === 'off') return;
    if (customSounds[kind]) { playCustom(kind); return; }
    if (kind === 'champions') { championsKill(level); return; }
    tone(1180, 0.07, { type: 'triangle', gain: 0.22 });
    tone(1770, 0.09, { type: 'triangle', gain: 0.16, delay: 0.035 });
  },
  tick() { tone(2400, 0.025, { type: 'sine', gain: 0.05 }); },
  count() { tone(660, 0.09, { type: 'square', gain: 0.06 }); },
  go() { tone(990, 0.16, { type: 'square', gain: 0.07 }); },
  end() {
    tone(740, 0.12, { type: 'triangle', gain: 0.18 });
    tone(555, 0.22, { type: 'triangle', gain: 0.18, delay: 0.12 });
  },
};
