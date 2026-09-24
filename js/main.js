import { Game } from './game.js';
import { SCENARIOS, CATEGORIES, describe } from './scenarios.js';
import {
  loadSettings, saveSettings, DEFAULTS, GAMES, CROSSHAIR_STYLES, degPerCount, cmPer360,
} from './settings.js';
import { drawCrosshair } from './crosshair.js';
import { initAudio, setVolume } from './audio.js';
import { runsFor, bestRun, addRun, clearRuns, average } from './stats.js';
import { paceChart, sparkline } from './chart.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const catOf = (id) => CATEGORIES.find((c) => c.id === id);

let settings = loadSettings();
let selected = SCENARIOS[0];
let rawInput = null; // true / false once pointer lock has been taken
let lastResult = null;
let lastPrevBest = null;
let pausedAt = 0;

const canvas = $('view');
const xhair = $('crosshair');

const game = new Game(canvas, settings, {
  onState: onGameState,
  onHud: renderHud,
  onFinish: showResults,
  onHit: flashHitmarker,
});

// ------------------------------------------------------------ pointer lock
async function lockPointer() {
  $('lock-error').hidden = true;
  if (!canvas.requestPointerLock) throw new Error('unsupported');
  try {
    const p = canvas.requestPointerLock({ unadjustedMovement: true });
    if (p && p.then) await p;
    rawInput = !!(p && p.then);
  } catch (err) {
    if (err && err.name === 'NotSupportedError') {
      const p = canvas.requestPointerLock();
      if (p && p.then) await p;
      rawInput = false;
    } else {
      throw err;
    }
  }
  game.skipMove = 1;
  renderSensReadout();
}

async function play(scn) {
  initAudio();
  if (scn !== game.scn) game.load(scn);
  try {
    await lockPointer();
  } catch (err) {
    const msg = $('lock-error');
    msg.textContent = 'The browser refused to lock the mouse. Click Start again, or open Trackline in a desktop browser tab.';
    msg.hidden = false;
    return;
  }
  hideOverlays();
  game.start();
}

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== canvas) game.pause();
});
document.addEventListener('pointerlockerror', () => {
  if (game.state === 'paused') $('pause-msg').textContent = 'The browser needs a moment before it will lock the mouse again. Click Resume once more.';
});

// ----------------------------------------------------------------- states
function hideOverlays() {
  $('pause').hidden = true;
  $('results').hidden = true;
}

function onGameState(s) {
  const inGame = s === 'countdown' || s === 'running';
  document.body.classList.toggle('in-menu', s === 'menu' || s === 'results');
  $('menu').hidden = s !== 'menu';
  $('hud').hidden = !(inGame || s === 'paused');
  $('hud-fps').hidden = !(inGame && settings.showFps);
  $('countdown').hidden = s !== 'countdown';
  $('pause').hidden = s !== 'paused';
  if (s === 'results' && document.pointerLockElement === canvas) document.exitPointerLock();
  if (s === 'paused') {
    pausedAt = performance.now();
    $('pause-name').textContent = game.scn.name;
    $('pause-msg').textContent = 'The run is frozen. Resume locks the mouse again.';
  }
  if (s === 'menu') {
    $('results').hidden = true;
    renderList();
    renderDetail();
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  }
  if (inGame) {
    $('hud-name').textContent = game.scn.name;
    $('hud-acc-lbl').textContent = game.scn.weapon.type === 'beam' ? 'On target' : 'Accuracy';
    $('countdown-hint').textContent = game.scn.weapon.type === 'beam'
      ? (settings.autoFire ? 'Auto-fire is on. Just track.' : 'Hold mouse 1 on the target')
      : 'Click each target';
  }
}

let hudFpsTimer = 0;
function renderHud(h) {
  if (!h) return;
  $('hud-time').textContent = h.time.toFixed(1);
  $('hud-score').textContent = fmt(h.score);
  $('hud-acc').textContent = h.acc === null ? '–' : pct(h.acc);
  $('hud').classList.toggle('on-target', !!h.onTarget);
  if (h.countdown) $('countdown-num').textContent = h.countdown;
  if (settings.showFps && performance.now() - hudFpsTimer > 250) {
    hudFpsTimer = performance.now();
    $('hud-fps').textContent = `${Math.round(h.fps)} fps`;
  }
}

function flashHitmarker() {
  const hm = $('hitmarker');
  hm.classList.remove('show');
  void hm.offsetWidth;
  hm.classList.add('show');
}

// --------------------------------------------------------------- scenarios
function renderList() {
  const list = $('scn-list');
  list.textContent = '';
  for (const cat of CATEGORIES) {
    const items = SCENARIOS.filter((s) => s.category === cat.id);
    const group = document.createElement('div');
    group.className = 'cat';
    group.style.setProperty('--c', `var(--cat-${cat.id})`);
    group.innerHTML = `<div class="cat-head">${cat.name}<span class="n">${items.length}</span></div>`;
    for (const s of items) {
      const best = bestRun(s.id);
      const b = document.createElement('button');
      b.className = 'scn-row';
      b.type = 'button';
      b.setAttribute('aria-current', s === selected ? 'true' : 'false');
      b.innerHTML = `<span class="nm"></span><span class="pb${best ? ' has' : ''}">${best ? fmt(best.score) : '—'}</span>`;
      b.querySelector('.nm').textContent = s.name;
      b.title = best ? `Personal best ${fmt(best.score)}` : 'Not played yet';
      b.dataset.id = s.id;
      b.addEventListener('click', () => select(s));
      b.addEventListener('dblclick', () => play(s));
      group.appendChild(b);
    }
    list.appendChild(group);
  }
}

function select(s) {
  if (s === selected && game.scn === s) return;
  selected = s;
  game.load(s);
  for (const b of document.querySelectorAll('.scn-row')) {
    b.setAttribute('aria-current', String(b.dataset.id === s.id));
  }
  renderDetail();
}

function renderDetail() {
  const s = selected;
  const d = describe(s);
  const cat = catOf(s.category);
  const eyebrow = $('d-cat');
  eyebrow.textContent = cat.name;
  eyebrow.dataset.cat = cat.id;
  $('d-name').textContent = s.name;
  $('d-blurb').textContent = s.blurb;
  const rows = [
    ['Duration', `${s.duration} s`],
    ['Targets', `${d.targets} × ${d.size}`],
    ['Distance', `~${d.distance}`],
    ['Angular size', `${d.angular} at that range`],
    ['Movement', d.speed],
    ['Weapon', d.fire],
    ['Scoring', d.scoring],
  ];
  $('d-specs').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  const runs = runsFor(s.id);
  const best = bestRun(s.id);
  const avg = average(runs, 'score');
  $('d-pb').textContent = best ? fmt(best.score) : '—';
  $('d-avg').textContent = avg === null ? '—' : fmt(avg);
  $('d-runs').textContent = runs.length;
  $('btn-start').textContent = `Start ${s.name}`;
  sparkline($('d-spark'), runs.slice(-20).map((r) => r.score));
}

// ----------------------------------------------------------------- results
function showResults(result) {
  const { prevBest, isPB } = addRun(result);
  lastResult = result;
  lastPrevBest = prevBest;
  const s = game.scn;
  const cat = catOf(s.category);
  const beam = s.weapon.type === 'beam';
  $('r-cat').textContent = cat.name;
  $('r-cat').dataset.cat = cat.id;
  $('r-name').textContent = s.name;
  $('r-score').textContent = fmt(result.score);
  const delta = $('r-delta');
  if (isPB) {
    delta.className = 'delta pb';
    delta.textContent = prevBest ? `New personal best, +${fmt(result.score - prevBest.score)}` : 'First run, new personal best';
  } else {
    delta.className = 'delta down';
    delta.textContent = `${fmt(prevBest.score - result.score)} below best (${fmt(prevBest.score)})`;
  }

  const stats = [];
  if (beam) {
    stats.push(['On target', pct(result.accuracy)]);
    stats.push(['Damage', fmt(result.damage)]);
    if (s.target.hp) stats.push(['Kills', result.kills]);
    else stats.push(['Time on target', `${result.onTime.toFixed(1)}<small>s</small>`]);
    stats.push(['Avg. offset', result.err === null ? '–' : `${result.err.toFixed(2)}<small>°</small>`]);
  } else {
    stats.push(['Accuracy', pct(result.accuracy)]);
    stats.push(['Kills', result.kills]);
    stats.push(['Shots', result.shots]);
    stats.push(['Avg. kill time', result.ttk === null ? '–' : `${Math.round(result.ttk * 1000)}<small>ms</small>`]);
  }
  $('r-stats').innerHTML = stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  $('r-coach').innerHTML = coaching(result, s);

  $('results').hidden = false;
  // A lone series needs no legend; the chart title names it.
  $('r-legend').hidden = !(prevBest && prevBest.timeline);
  paceChart($('r-chart'), result.timeline, prevBest ? prevBest.timeline : null, s.duration);
}

function coaching(r, s) {
  if (s.weapon.type === 'beam') {
    if (r.lead === null) return 'Hold mouse 1 while tracking so Trackline can measure how closely you follow the target.';
    const lag = r.lead;
    const amt = `${Math.abs(lag).toFixed(2)}°`;
    if (lag < -0.15) return `On average your crosshair <b>trailed the target by ${amt}</b> along its path. Anticipate direction changes and let your aim run slightly ahead.`;
    if (lag > 0.15) return `On average your crosshair <b>ran ${amt} ahead</b> of the target. Ease off after direction changes and let it come back to you.`;
    return `Your crosshair was <b>level with the target</b> along its path (${lag >= 0 ? '+' : '−'}${amt}). Keep the offset low and push the on-target time up.`;
  }
  if (r.shots === 0) return 'No shots fired. Click while the crosshair is over a target.';
  if (r.accuracy < 0.75) return `Accuracy was <b>${pct(r.accuracy)}</b>. Each miss costs ${s.weapon.missPenalty} points, so slow down slightly and confirm before clicking.`;
  if (r.accuracy > 0.93 && r.ttk) return `Accuracy was <b>${pct(r.accuracy)}</b> with ${Math.round(r.ttk * 1000)} ms per kill. You can afford to push the pace.`;
  return `Accuracy <b>${pct(r.accuracy)}</b>, ${r.ttk ? `${Math.round(r.ttk * 1000)} ms per kill` : 'no kills yet'}. Balanced run; aim to cut kill time without losing accuracy.`;
}

// ---------------------------------------------------------------- settings
function fillSelect(sel, map) {
  sel.innerHTML = Object.entries(map).map(([k, v]) => `<option value="${k}">${typeof v === 'string' ? v : v.name}</option>`).join('');
}

function syncForm() {
  const s = settings;
  $('s-mode-game').checked = s.sensMode === 'game';
  $('s-mode-cm').checked = s.sensMode === 'cm360';
  $('s-game').value = s.game;
  $('s-sens').value = s.sens;
  $('s-cm360').value = s.cm360;
  $('s-dpi').value = s.dpi;
  $('s-fov').value = s.fov;
  $('s-invertY').checked = s.invertY;
  $('s-x-style').value = s.crosshair.style;
  $('s-x-color').value = s.crosshair.color;
  $('s-x-length').value = s.crosshair.length;
  $('s-x-thickness').value = s.crosshair.thickness;
  $('s-x-gap').value = s.crosshair.gap;
  $('s-x-dot').value = s.crosshair.dot;
  $('s-x-outline').checked = s.crosshair.outline;
  $('s-targetColor').value = s.targetColor;
  $('s-hitColor').value = s.hitColor;
  $('s-volume').value = s.volume;
  $('s-autoFire').checked = s.autoFire;
  $('s-showFps').checked = s.showFps;
  syncOutputs();
}

function syncOutputs() {
  const s = settings;
  $('o-fov').textContent = `${s.fov}°`;
  $('o-x-length').textContent = `${s.crosshair.length}px`;
  $('o-x-thickness').textContent = `${s.crosshair.thickness}px`;
  $('o-x-gap').textContent = `${s.crosshair.gap}px`;
  $('o-x-dot').textContent = `${s.crosshair.dot}px`;
  $('o-volume').textContent = `${s.volume}%`;
  for (const el of document.querySelectorAll('[data-mode]')) el.hidden = el.dataset.mode !== s.sensMode;
  renderSensReadout();
  drawCrosshair($('xhair-preview'), s.crosshair);
  drawCrosshair(xhair, s.crosshair);
}

function renderSensReadout() {
  const cm = cmPer360(settings);
  const deg = degPerCount(settings);
  $('sens-readout').innerHTML = `<b>${cm.toFixed(2)} cm/360°</b> <span>·</span> ${(cm / 2.54).toFixed(2)} in/360° <span>·</span> ${deg.toFixed(4)}° per count <span>·</span> ${Math.round(360 / deg).toLocaleString('en-US')} counts per turn`;
  $('sens-chip').textContent = `${cm.toFixed(1)} cm/360 · ${settings.fov}° FOV`;
  if (rawInput === true) $('raw-status').textContent = 'Raw input is active: the browser reports unaccelerated mouse counts.';
  else if (rawInput === false) $('raw-status').textContent = 'This browser does not offer raw input, so OS pointer speed and acceleration apply. On Windows, set pointer speed to 6/11 and turn off Enhance pointer precision for accurate conversion. Chrome and Edge on Windows support raw input.';
}

function readForm() {
  const num = (id, fb) => {
    const v = parseFloat($(id).value);
    return Number.isFinite(v) && v > 0 ? v : fb;
  };
  const s = settings;
  s.sensMode = $('s-mode-cm').checked ? 'cm360' : 'game';
  s.game = $('s-game').value;
  s.sens = num('s-sens', s.sens);
  s.cm360 = num('s-cm360', s.cm360);
  s.dpi = num('s-dpi', s.dpi);
  s.fov = parseInt($('s-fov').value, 10);
  s.invertY = $('s-invertY').checked;
  s.crosshair.style = $('s-x-style').value;
  s.crosshair.color = $('s-x-color').value;
  s.crosshair.length = parseFloat($('s-x-length').value);
  s.crosshair.thickness = parseFloat($('s-x-thickness').value);
  s.crosshair.gap = parseFloat($('s-x-gap').value);
  s.crosshair.dot = parseFloat($('s-x-dot').value);
  s.crosshair.outline = $('s-x-outline').checked;
  s.targetColor = $('s-targetColor').value;
  s.hitColor = $('s-hitColor').value;
  s.volume = parseInt($('s-volume').value, 10);
  s.autoFire = $('s-autoFire').checked;
  s.showFps = $('s-showFps').checked;
  saveSettings(s);
  setVolume(s.volume / 100);
  game.applySettings(s);
  syncOutputs();
}

function armButton(btn, label, action) {
  if (btn.classList.contains('armed')) {
    btn.classList.remove('armed');
    btn.textContent = label;
    action();
    return;
  }
  btn.classList.add('armed');
  btn.textContent = 'Click again to confirm';
  setTimeout(() => {
    if (btn.classList.contains('armed')) { btn.classList.remove('armed'); btn.textContent = label; }
  }, 3000);
}

// -------------------------------------------------------------------- tabs
function showTab(name) {
  const scen = name === 'scenarios';
  $('tab-scenarios').setAttribute('aria-selected', String(scen));
  $('tab-settings').setAttribute('aria-selected', String(!scen));
  $('panel-scenarios').hidden = !scen;
  $('panel-settings').hidden = scen;
  if (!scen) drawCrosshair($('xhair-preview'), settings.crosshair);
}

// ------------------------------------------------------------------ wiring
fillSelect($('s-game'), GAMES);
fillSelect($('s-x-style'), CROSSHAIR_STYLES);
syncForm();
setVolume(settings.volume / 100);

$('settings-form').addEventListener('input', readForm);
$('settings-form').addEventListener('change', readForm);
$('settings-form').addEventListener('submit', (e) => e.preventDefault());
$('tab-scenarios').addEventListener('click', () => showTab('scenarios'));
$('tab-settings').addEventListener('click', () => showTab('settings'));
$('sens-chip').addEventListener('click', () => showTab('settings'));
$('btn-start').addEventListener('click', () => play(selected));
$('btn-again').addEventListener('click', () => play(game.scn));
$('btn-menu').addEventListener('click', () => game.toMenu());
$('btn-quit').addEventListener('click', () => { document.exitPointerLock?.(); game.toMenu(); });
$('btn-restart').addEventListener('click', () => play(game.scn));
$('btn-resume').addEventListener('click', async () => {
  try {
    await lockPointer();
    game.resume();
  } catch (e) {
    $('pause-msg').textContent = 'The browser needs a moment before it will lock the mouse again. Click Resume once more.';
  }
});
$('btn-reset-settings').addEventListener('click', (e) => armButton(e.currentTarget, 'Reset settings', () => {
  settings = JSON.parse(JSON.stringify(DEFAULTS));
  saveSettings(settings);
  game.applySettings(settings);
  setVolume(settings.volume / 100);
  syncForm();
  $('danger-msg').textContent = 'Settings reset to defaults.';
}));
$('btn-clear-runs').addEventListener('click', (e) => armButton(e.currentTarget, 'Clear run history', () => {
  clearRuns();
  renderList();
  renderDetail();
  $('danger-msg').textContent = 'Run history cleared.';
}));

document.addEventListener('keydown', (e) => {
  const tag = e.target && e.target.tagName;
  if (tag === 'INPUT' || tag === 'SELECT') return;
  const k = e.key.toLowerCase();
  if (k === 'r' && (game.state === 'running' || game.state === 'countdown')) {
    e.preventDefault();
    game.start();
  } else if (k === 'r' && game.state === 'paused') {
    play(game.scn);
  } else if ((k === ' ' || k === 'enter') && game.state === 'results') {
    e.preventDefault();
    play(game.scn);
  } else if (k === 'escape' && game.state === 'results') {
    game.toMenu();
  } else if (k === 'escape' && game.state === 'paused' && performance.now() - pausedAt > 400) {
    // The Esc that released the mouse can arrive here too; only a second press quits.
    game.toMenu();
  }
});

window.addEventListener('resize', () => {
  if (!$('results').hidden && lastResult) {
    paceChart($('r-chart'), lastResult.timeline, lastPrevBest ? lastPrevBest.timeline : null, game.scn.duration);
  }
});

const noLock = !('requestPointerLock' in Element.prototype) || matchMedia('(pointer: coarse)').matches;
$('device-notice').hidden = !noLock;

drawCrosshair(xhair, settings.crosshair);
game.load(selected);
onGameState('menu');
