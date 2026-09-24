// Small synthesized sound set. The AudioContext starts on the first user gesture.

let ctx = null;
let master = null;
let noiseBuf = null;
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
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

export function setVolume(v) {
  volume = Math.max(0, Math.min(1, v));
  if (master) master.gain.value = volume;
}

function tone(freq, dur, { type = 'sine', gain = 0.3, slide = 0, delay = 0 } = {}) {
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
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise(dur, { freq = 2000, q = 1, gain = 0.2 } = {}) {
  if (!ctx || volume === 0) return;
  const t0 = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

export const sfx = {
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
