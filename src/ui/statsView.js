import { DIFFICULTIES, resolveDifficulty, SCENARIOS } from '../game/scenarios.js';
import { DURATIONS } from '../core/settings.js';
import { historyToCsv, runKey } from '../core/stats.js';
import { formatSensitivity } from '../core/sensitivity.js';
import { $, h } from './dom.js';
import { clearChart, niceTicks, renderLineChart } from './charts.js';
import { formatDate, formatDuration, formatInt, formatPercent, formatSeconds } from './format.js';

const ALL = 'all';

function scenarioName(id) {
  return SCENARIOS.find((s) => s.id === id)?.name ?? id;
}

function tile(label, value, sub) {
  return h('div', { class: 'tile' }, h('span', { class: 'tile-label' }, label), h('span', { class: 'tile-value' }, value), sub && h('span', { class: 'tile-sub' }, sub));
}

function fillSelect(select, options, value) {
  select.replaceChildren(...options.map((o) => h('option', { value: o.value }, o.label)));
  select.value = options.some((o) => o.value === value) ? value : options[0].value;
}

/** The Stats page: filters scope the tiles, the progress chart and the table. */
export function createStatsView({ getStats, getSettings, onClear }) {
  const scenarioSelect = $('#filter-scenario');
  const difficultySelect = $('#filter-difficulty');
  const durationSelect = $('#filter-duration');
  const tiles = $('#stats-tiles');
  const chartHost = $('#progress-chart');
  const chartCaption = $('#progress-caption');
  const tableBody = $('#runs-table tbody');
  const runsCaption = $('#runs-caption');
  const empty = $('#runs-empty');
  let initialized = false;

  const filters = () => ({
    scenario: scenarioSelect.value,
    difficulty: difficultySelect.value,
    duration: durationSelect.value,
  });

  function populate() {
    const { history } = getStats();
    const settings = getSettings();
    const current = initialized
      ? filters()
      : {
          scenario: settings.scenario,
          difficulty: resolveDifficulty(settings.difficulty, { speed: settings.customSpeed, size: settings.customSize }).key,
          duration: String(settings.duration),
        };

    fillSelect(scenarioSelect, [{ value: ALL, label: 'All scenarios' }, ...SCENARIOS.map((s) => ({ value: s.id, label: s.name }))], current.scenario);

    const difficultyKeys = new Set(Object.keys(DIFFICULTIES));
    for (const run of history) difficultyKeys.add(run.difficulty);
    const labelFor = (key) =>
      DIFFICULTIES[key]?.label ?? history.find((r) => r.difficulty === key)?.difficultyLabel ?? key;
    fillSelect(
      difficultySelect,
      [{ value: ALL, label: 'All difficulties' }, ...[...difficultyKeys].map((key) => ({ value: key, label: labelFor(key) }))],
      current.difficulty,
    );
    fillSelect(
      durationSelect,
      [{ value: ALL, label: 'All lengths' }, ...DURATIONS.map((d) => ({ value: String(d), label: `${d} s` }))],
      current.duration,
    );
    initialized = true;
  }

  function render() {
    populate();
    const { history, bests } = getStats();
    const f = filters();
    const runs = history.filter(
      (r) =>
        (f.scenario === ALL || r.scenario === f.scenario) &&
        (f.difficulty === ALL || r.difficulty === f.difficulty) &&
        (f.duration === ALL || String(r.duration) === f.duration),
    );

    // Tiles
    const best = runs.reduce((top, r) => (!top || r.score > top.score ? r : top), null);
    const lastTen = runs.slice(-10);
    const avgAccuracy = lastTen.length ? lastTen.reduce((sum, r) => sum + r.accuracy, 0) / lastTen.length : null;
    const trained = runs.reduce((sum, r) => sum + r.duration, 0);
    const comparable = f.scenario !== ALL && f.difficulty !== ALL && f.duration !== ALL;
    const pb = comparable ? bests[runKey({ scenario: f.scenario, difficulty: f.difficulty, duration: Number(f.duration) })] : null;
    const bestRun = pb && (!best || pb.score >= best.score) ? pb : best;
    tiles.replaceChildren(
      tile('Runs', formatInt(runs.length)),
      tile('Best score', bestRun ? formatInt(bestRun.score) : '—', bestRun ? `${formatPercent(bestRun.accuracy)} accuracy` : null),
      tile('Avg accuracy, last 10', avgAccuracy === null ? '—' : formatPercent(avgAccuracy)),
      tile('Time trained', formatDuration(trained)),
    );

    // Progress chart: only runs that can be compared with each other.
    if (!comparable) {
      chartCaption.textContent = '';
      clearChart(chartHost, 'Pick one scenario, difficulty and length to chart your score over time.');
    } else if (runs.length < 2) {
      chartCaption.textContent = '';
      clearChart(chartHost, runs.length ? 'One run so far. Play another to see a trend.' : 'No runs yet for this combination.');
    } else {
      chartCaption.textContent = `${scenarioName(f.scenario)} · ${difficultySelect.selectedOptions[0]?.textContent} · ${f.duration} s`;
      const { top, ticks } = niceTicks(Math.max(...runs.map((r) => r.score)) * 1.08);
      const bestIndex = runs.reduce((bi, r, i) => (r.score > runs[bi].score ? i : bi), 0);
      renderLineChart(chartHost, {
        points: runs.map((r, i) => ({
          x: i + 1,
          y: r.score,
          value: formatInt(r.score),
          label: `Run ${i + 1} · ${formatDate(r.date)} · ${formatPercent(r.accuracy)}`,
        })),
        xDomain: [1, runs.length],
        yDomain: [0, top],
        yTicks: ticks,
        yFormat: (v) => formatInt(v),
        xTicks: [
          { x: 1, label: 'Run 1' },
          { x: runs.length, label: `Run ${runs.length}` },
        ],
        showDots: runs.length <= 40,
        highlight: { index: bestIndex, text: `Best ${formatInt(runs[bestIndex].score)}` },
        ariaLabel: `Score for each of ${runs.length} runs. Best ${formatInt(runs[bestIndex].score)}.`,
      });
    }

    // Table: newest first, capped for speed.
    const rows = runs.slice(-100).reverse();
    runsCaption.textContent = runs.length > 100 ? `Latest 100 of ${runs.length} runs` : runs.length ? `${runs.length} runs` : '';
    tableBody.replaceChildren(
      ...rows.map((r) =>
        h(
          'tr',
          {},
          h('td', {}, formatDate(r.date)),
          h('td', {}, scenarioName(r.scenario)),
          h('td', {}, r.difficultyLabel ?? r.difficulty),
          h('td', { class: 'num' }, `${r.duration} s`),
          h('td', { class: 'num strong' }, formatInt(r.score)),
          h('td', { class: 'num' }, formatPercent(r.accuracy)),
          h('td', { class: 'num' }, formatSeconds(r.longestStreak ?? 0)),
          h('td', { class: 'num' }, r.avgRecovery == null ? '—' : formatSeconds(r.avgRecovery)),
          h('td', { class: 'num' }, r.sensitivity == null ? '—' : formatSensitivity(r.sensitivity)),
        ),
      ),
    );
    empty.hidden = rows.length > 0;
  }

  for (const select of [scenarioSelect, difficultySelect, durationSelect]) select.addEventListener('change', render);

  $('#export-csv').addEventListener('click', () => {
    const { history } = getStats();
    const blob = new Blob([historyToCsv(history)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = h('a', { href: url, download: `tracklock-stats-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('#clear-stats').addEventListener('click', onClear);

  return { render };
}
