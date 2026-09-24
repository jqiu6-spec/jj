import { $, h } from './dom.js';
import { renderLineChart } from './charts.js';
import { formatDelta, formatInt, formatPercent, formatSeconds } from './format.js';

function tile(label, value, sub) {
  return h('div', { class: 'tile' }, h('span', { class: 'tile-label' }, label), h('span', { class: 'tile-value' }, value), sub && h('span', { class: 'tile-sub' }, sub));
}

/** Fill the results overlay for a finished run. */
export function renderResults({ run, previousBest, isPersonalBest }) {
  $('#results-title').textContent = run.scenarioName;
  $('#results-meta').textContent = [run.difficultyLabel, `${run.duration} s`, run.weaponName, run.fireMode === 'hold' ? 'Hold to fire' : 'Always firing']
    .filter(Boolean)
    .join(' · ');
  $('#results-score').textContent = formatInt(run.score);

  const badge = $('#results-pb');
  badge.classList.toggle('is-best', isPersonalBest);
  if (isPersonalBest && previousBest) badge.textContent = `New personal best · ${formatDelta(run.score - previousBest.score)}`;
  else if (isPersonalBest) badge.textContent = 'First run · new personal best';
  else badge.textContent = `Best ${formatInt(previousBest.score)} · ${formatDelta(run.score - previousBest.score)}`;

  const tiles = [
    tile('Accuracy', formatPercent(run.accuracy)),
    tile('Time on target', formatSeconds(run.timeOnTarget, 1), `of ${formatSeconds(run.firingTime, 1)} firing`),
    tile('Longest streak', formatSeconds(run.longestStreak)),
    tile(
      'Avg recovery',
      run.avgRecovery == null ? '—' : formatSeconds(run.avgRecovery),
      run.targetLosses ? `${run.targetLosses} target losses` : 'Never lost the target',
    ),
  ];
  if (run.headshotRate != null) tiles.push(tile('Head share', formatPercent(run.headshotRate), 'of time on target'));
  if (run.shots > 0) {
    tiles.push(
      tile('Damage', formatInt(run.damage ?? 0), `${formatInt(run.hits ?? 0)} / ${formatInt(run.shots)} shots hit · ${formatPercent((run.hits ?? 0) / run.shots, 0)}`),
    );
  }
  $('#results-tiles').replaceChildren(...tiles);

  const timeline = run.timeline ?? [];
  const half = Math.round(run.duration / 2);
  renderLineChart($('#results-chart'), {
    points: timeline.map((value, i) => ({
      x: i + 0.5,
      y: value,
      value: value == null ? '—' : formatPercent(value, 0),
      label: `${i}–${i + 1} s`,
    })),
    xDomain: [0, run.duration],
    yDomain: [0, 1],
    yTicks: [0, 0.5, 1],
    yFormat: (v) => formatPercent(v, 0),
    xTicks: [
      { x: 0, label: '0 s' },
      { x: half, label: `${half} s` },
      { x: run.duration, label: `${run.duration} s` },
    ],
    area: true,
    ariaLabel: `Accuracy for each second of the run, overall ${formatPercent(run.accuracy)}`,
  });

  $('#results-table tbody').replaceChildren(
    ...timeline.map((value, i) =>
      h('tr', {}, h('td', {}, `${i}–${i + 1} s`), h('td', { class: 'num' }, value == null ? 'not firing' : formatPercent(value, 0))),
    ),
  );
}
