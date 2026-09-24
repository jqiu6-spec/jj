// Synthesised sound effects (no audio files to load). The AudioContext is
// created lazily on the first user gesture, as browsers require.

export function createAudio() {
  let ctx = null;
  let master = null;
  let noise = null;
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

  /** One second of white noise, shared by every gunshot. */
  function noiseBuffer(audio) {
    if (noise) return noise;
    noise = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return noise;
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

  /** Filtered noise burst: the crack of a shot. */
  function burst({ duration, gain, filterFreq, q = 0.8, type = 'bandpass' }) {
    const audio = ensure();
    if (!audio || volume <= 0) return;
    const start = audio.currentTime;
    const source = audio.createBufferSource();
    source.buffer = noiseBuffer(audio);
    source.loop = true;
    source.loopStart = Math.random() * 0.5;
    source.loopEnd = source.loopStart + 0.5;
    const filter = audio.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    filter.Q.value = q;
    const env = audio.createGain();
    env.gain.setValueAtTime(gain, start);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter).connect(env).connect(master);
    source.start(start, source.loopStart);
    source.stop(start + duration + 0.02);
  }

  return {
    /** Call from a user gesture so later sounds are allowed to play. */
    unlock: ensure,
    setVolume(value) {
      volume = value;
      if (master) master.gain.value = value;
    },
    /** A gunshot shaped by the weapon: suppressed ones are softer and duller. */
    shot(weapon) {
      const suppressed = Boolean(weapon?.suppressed);
      const heavy = weapon?.kind === 'lmg';
      burst({
        duration: suppressed ? 0.07 : 0.11,
        gain: suppressed ? 0.09 : heavy ? 0.2 : 0.16,
        filterFreq: suppressed ? 900 : heavy ? 1500 : 2200,
        q: 0.6,
        type: suppressed ? 'lowpass' : 'bandpass',
      });
      tone({ freq: heavy ? 110 : 150, endFreq: 55, duration: suppressed ? 0.05 : 0.08, type: 'sine', gain: suppressed ? 0.12 : 0.28 });
    },
    /** Body hit: a short damage tick. */
    hit() {
      tone({ freq: 1900, endFreq: 1300, duration: 0.03, type: 'triangle', gain: 0.14 });
    },
    /** Headshot: the brighter, ringing tick. */
    headshot() {
      tone({ freq: 2600, endFreq: 2100, duration: 0.05, type: 'triangle', gain: 0.18 });
      tone({ freq: 3900, duration: 0.09, type: 'sine', gain: 0.08, delay: 0.005 });
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
