// Run history, stored per scenario in localStorage. Each run records the setup
// it was played with (target count, health, hitbox) as a key; runs saved before
// setups existed count as the scenario's default setup.

const KEY = 'trackline.runs.v1';
const CAP = 300;
let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY)) || {};
  } catch (e) {
    cache = {};
  }
  return cache;
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch (e) { /* ignore */ }
}

// Runs of one scenario played with setup `key`; `defKey` is the default setup.
export function runsFor(id, key, defKey) {
  return (load()[id] || []).filter((r) => (r.setup || defKey) === key);
}

export function bestRun(id, key, defKey) {
  let best = null;
  for (const r of runsFor(id, key, defKey)) if (!best || r.score > best.score) best = r;
  return best;
}

// Stores the run and reports how it compares with earlier runs of the same setup.
export function addRun(run, defKey) {
  const all = load();
  const prevBest = bestRun(run.scenario, run.setup, defKey);
  const list = all[run.scenario] || (all[run.scenario] = []);
  list.push(run);
  if (list.length > CAP) list.splice(0, list.length - CAP);
  save();
  return { prevBest, isPB: !prevBest || run.score > prevBest.score };
}

export function clearRuns() {
  cache = {};
  save();
}

export function average(list, key, n = 10) {
  const xs = list.slice(-n).map((r) => r[key]).filter((v) => typeof v === 'number');
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}
