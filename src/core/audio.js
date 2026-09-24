// Synthesised sound effects (no audio files to load). The AudioContext is
// created lazily on the first user gesture, as browsers require.

export function createAudio() {
  let ctx = null;
  let master = null;
  let volume = 0.5;

  function ensure() {
    if (!ctx) {
      const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function tone({ freq, duration, type = 'sine', gain = 0.3, endFreq = freq, delay = 0 }) {
    const audio = ensure();
    if (!audio || volume <= 0) return;
    const start = audio.currentTime + delay;
    const osc = audio.createOscillator();
    const env = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (endFreq !== freq) osc.frequency.exponentialRampToValueAtTime(endFreq, start + duration);
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(gain, start + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(env).connect(master);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  return {
    /** Call from a user gesture so later sounds are allowed to play. */
    unlock: ensure,
    setVolume(value) {
      volume = value;
      if (master) master.gain.value = value;
    },
    hit() {
      tone({ freq: 2100, endFreq: 1500, duration: 0.035, type: 'triangle', gain: 0.12 });
    },
    countdown() {
      tone({ freq: 660, duration: 0.12, type: 'square', gain: 0.08 });
    },
    go() {
      tone({ freq: 990, duration: 0.2, type: 'square', gain: 0.1 });
    },
    finish() {
      tone({ freq: 740, duration: 0.14, type: 'triangle', gain: 0.2 });
      tone({ freq: 1110, duration: 0.3, type: 'triangle', gain: 0.2, delay: 0.12 });
    },
    personalBest() {
      [660, 880, 1320].forEach((freq, i) => tone({ freq, duration: 0.18, type: 'triangle', gain: 0.18, delay: i * 0.1 }));
    },
  };
}
