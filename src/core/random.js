/** Small seedable PRNG (mulberry32) so target movement can be reproduced in tests. */
export function createRng(seed = Math.floor(Math.random() * 2 ** 32)) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomBetween(rng, min, max) {
  return min + (max - min) * rng();
}

export function randomSign(rng) {
  return rng() < 0.5 ? -1 : 1;
}
