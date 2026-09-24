// Run history, stored per scenario in localStorage.

const KEY = 'trackline.runs.v1';
const CAP = 200;
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

export function runsFor(id) {
  return load()[id] || [];
}

export function bestRun(id) {
  let best = null;
  for (const r of runsFor(id)) if (!best || r.score > best.score) best = r;
  return best;
}

// Stores the run and reports how it compares with earlier ones.
export function addRun(run) {
  const all = load();
  const prevBest = bestRun(run.scenario);
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
