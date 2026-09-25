// Small synthesized sound set. The AudioContext starts on the first user gesture.

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

// Fire sounds the player can pick per gun. 'auto' uses the gun's own.
export const FIRE_SOUNDS = {
  auto: 'Match the gun',
  suppressed: 'Suppressed thump',
  rifle: 'Rifle crack',
  heavy: 'Heavy rifle',
  smg: 'SMG snap',
  sniper: 'Sniper boom',
  laser: 'Laser',
  soft: 'Soft click',
  off: 'Silent',
};

const GUN_SOUNDS = {
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

export const sfx = {
  gun(kind) { (GUN_SOUNDS[kind] || GUN_SOUNDS.rifle)(); },
  dry() { tone(2600, 0.02, { type: 'square', gain: 0.04 }); },
  scope() { noise(0.05, { freq: 5200, q: 4, gain: 0.04 }); },
  reload() {
    tone(700, 0.04, { type: 'square', gain: 0.05 });
    tone(520, 0.05, { type: 'square', gain: 0.05, delay: 0.9 });
    tone(900, 0.04, { type: 'square', gain: 0.06, delay: 3.4 });
  },
  shot() { noise(0.05, { freq: 3200, q: 0.8, gain: 0.12 }); },
  kill() {
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
