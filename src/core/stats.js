// Run history and personal bests, persisted through the storage wrapper.

export const HISTORY_KEY = 'tracklock.history.v1';
export const BESTS_KEY = 'tracklock.bests.v1';
export const HISTORY_LIMIT = 500;

/** Runs are only comparable with the same scenario, difficulty and length. */
export function runKey({ scenario, difficulty, duration }) {
  return `${scenario}|${difficulty}|${duration}`;
}

function isValidRun(run) {
  return (
    run &&
    typeof run === 'object' &&
    typeof run.scenario === 'string' &&
    typeof run.difficulty === 'string' &&
    Number.isFinite(run.duration) &&
    Number.isFinite(run.score) &&
    Number.isFinite(run.accuracy)
  );
}

export function loadHistory(storage) {
  const list = storage.getJSON(HISTORY_KEY, []);
  return Array.isArray(list) ? list.filter(isValidRun) : [];
}

/** Personal bests keyed by runKey. Kept separately so trimming history never loses a PB. */
export function loadBests(storage, history = []) {
  const stored = storage.getJSON(BESTS_KEY, {});
  const bests = stored && typeof stored === 'object' && !Array.isArray(stored) ? { ...stored } : {};
  for (const [key, run] of Object.entries(bests)) {
    if (!isValidRun(run)) delete bests[key];
  }
  for (const run of history) {
    const key = runKey(run);
    if (!bests[key] || run.score > bests[key].score) bests[key] = summarize(run);
  }
  return bests;
}

function summarize(run) {
  const { timeline, ...rest } = run;
  return rest;
}

/**
 * Save a finished run. Returns the new history/bests plus the best that stood
 * before this run, so the results screen can show the difference.
 */
export function recordRun(storage, { history, bests }, run) {
  const key = runKey(run);
  const previousBest = bests[key] ?? null;
  const isPersonalBest = !previousBest || run.score > previousBest.score;
  const nextHistory = [...history, run].slice(-HISTORY_LIMIT);
  const nextBests = isPersonalBest ? { ...bests, [key]: summarize(run) } : bests;
  storage.setJSON(HISTORY_KEY, nextHistory);
  if (isPersonalBest) storage.setJSON(BESTS_KEY, nextBests);
  return { history: nextHistory, bests: nextBests, previousBest, isPersonalBest };
}

export function clearStats(storage) {
  storage.remove(HISTORY_KEY);
  storage.remove(BESTS_KEY);
  return { history: [], bests: {} };
}

const CSV_COLUMNS = [
  ['date', (r) => r.date],
  ['scenario', (r) => r.scenarioName ?? r.scenario],
  ['difficulty', (r) => r.difficultyLabel ?? r.difficulty],
  ['duration_s', (r) => r.duration],
  ['score', (r) => r.score],
  ['accuracy_pct', (r) => (r.accuracy * 100).toFixed(2)],
  ['time_on_target_s', (r) => r.timeOnTarget?.toFixed(2)],
  ['longest_streak_s', (r) => r.longestStreak?.toFixed(2)],
  ['avg_recovery_s', (r) => (r.avgRecovery == null ? '' : r.avgRecovery.toFixed(3))],
  ['headshot_pct', (r) => (r.headshotRate == null ? '' : (r.headshotRate * 100).toFixed(2))],
  ['weapon', (r) => r.weaponName ?? r.weapon ?? ''],
  ['shots', (r) => r.shots ?? ''],
  ['hits', (r) => r.hits ?? ''],
  ['damage', (r) => r.damage ?? ''],
  ['valorant_sens', (r) => r.sensitivity],
  ['dpi', (r) => r.dpi],
  ['fov', (r) => r.fov],
  ['fire_mode', (r) => r.fireMode],
];

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function historyToCsv(history) {
  const header = CSV_COLUMNS.map(([name]) => name).join(',');
  const rows = history.map((run) => CSV_COLUMNS.map(([, get]) => csvCell(get(run))).join(','));
  return [header, ...rows].join('\n');
}
