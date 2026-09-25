import { Game } from './game.js';
import {
  SCENARIOS, CATEGORIES, HP_CHOICES, LEVEL_NAMES, OPERATOR, describe, defaultSetup, normalizeSetup, setupKey, setupLabel, countLimit,
} from './scenarios.js';
import {
  loadSettings, saveSettings, loadSetups, saveSetups, loadSkins, saveSkins, defaultSkin, presetSkin,
  DEFAULTS, GAMES, CROSSHAIR_STYLES, degPerCount, cmPer360,
} from './settings.js';
import { drawCrosshair } from './crosshair.js';
import { initAudio, setVolume, sfx, FIRE_SOUNDS } from './audio.js';
import { GUNS, ZONE_LABELS } from './guns.js';
import { MODEL_INFO } from './models.js';
import {
  SKIN_PRESETS, PATTERNS, COLOR_ROLES, FINISHES, ZONE_FINISHES, STICKERS, STICKER_FINISHES, SKIN_KEYS,
  stickerCanvas, wearLabel, randomSkin,
} from './skins.js';
import { FX_TYPES } from './effects.js';

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || '') || /Macintosh/.test(navigator.userAgent || '');
import { runsFor, bestRun, addRun, clearRuns, average } from './stats.js';
import { paceChart, sparkline } from './chart.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const catOf = (id) => CATEGORIES.find((c) => c.id === id);

let settings = loadSettings();
const setups = loadSetups();
let skins = loadSkins();
let weaponGun = settings.weapon.primary; // gun shown in the Weapon tab
let stickerSlot = 0;
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
  onScope: renderScope,
});
game.setSkins(skins);

// ------------------------------------------------------------------ setups
const setupFor = (s) => normalizeSetup(s, setups[s.id]);
const keyFor = (s) => setupKey(setupFor(s));
const defKeyFor = (s) => setupKey(defaultSetup(s));

// Load the scenario into the arena with the player's setup, if not already.
function ensureLoaded(s) {
  const v = setupFor(s);
  if (game.loadedKey !== `${s.id}|${setupKey(v)}`) game.load(s, v);
}

function changeSetup(patch) {
  const s = selected;
  setups[s.id] = normalizeSetup(s, { ...setupFor(s), ...patch });
  saveSetups(setups);
  ensureLoaded(s);
  renderDetail();
  const row = document.querySelector(`.scn-row[data-id="${s.id}"] .pb`);
  if (row) {
    const best = bestRun(s.id, keyFor(s), defKeyFor(s));
    row.textContent = best ? fmt(best.score) : '—';
    row.classList.toggle('has', !!best);
  }
}

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
  ensureLoaded(scn);
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
  $('hud-ammo').hidden = !((inGame || s === 'paused') && game.sniper);
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
    let hint = 'Click each target';
    if (game.scn.weapon.type === 'beam') hint = settings.autoFire ? 'Auto-fire is on. Just track.' : 'Hold mouse 1 on the target';
    if (game.sniper) {
      hint = settings.sniper.scopeMode === 'hold'
        ? 'Hold right click to scope. Left click fires.'
        : 'Right click scopes to 2.5x, again for 5x. Left click fires.';
    }
    $('countdown-hint').textContent = hint;
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
  if (h.ammo !== null) {
    $('hud-ammo-n').textContent = h.reload > 0 ? '—' : h.ammo;
    $('hud-ammo-info').textContent = h.reload > 0
      ? `RELOADING ${h.reload.toFixed(1)} S`
      : `${h.zoom ? `${h.zoom}X SCOPE` : 'UNSCOPED'} · ${OPERATOR.magazine} ROUNDS`;
  }
  if (settings.showFps && performance.now() - hudFpsTimer > 250) {
    hudFpsTimer = performance.now();
    $('hud-fps').textContent = `${Math.round(h.fps)} fps`;
  }
}

// The scope overlay fades in over the last half of the scope-in.
let scopeShown = -1;
function renderScope(t, level) {
  const o = level ? Math.max(0, (t - 0.5) / 0.5) : 0;
  if (o === scopeShown) return;
  scopeShown = o;
  $('scope').style.opacity = o;
  document.body.classList.toggle('scoped', o > 0.5);
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
      const best = bestRun(s.id, keyFor(s), defKeyFor(s));
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
  ensureLoaded(s);
  for (const b of document.querySelectorAll('.scn-row')) {
    b.setAttribute('aria-current', String(b.dataset.id === s.id));
  }
  renderDetail();
}

function renderDetail() {
  const s = selected;
  const v = setupFor(s);
  const d = describe(s, v);
  const cat = catOf(s.category);
  const eyebrow = $('d-cat');
  eyebrow.textContent = cat.name;
  eyebrow.dataset.cat = cat.id;
  $('d-name').textContent = s.name;
  $('d-blurb').textContent = s.blurb;
  const rows = [
    ['Targets', `${v.count} × ${d.size}`],
    ['Health', d.health],
    ['Range', `~${d.distance}, ${d.angular}`],
    ['Speed', d.speed],
  ];
  if (d.moves) rows.push(['Moves', d.moves]);
  rows.push(['Weapon', `${d.fire}`], ['Scoring', d.scoring]);
  $('d-specs').innerHTML = rows.map(([k, val]) => `<dt>${k}</dt><dd>${val}</dd>`).join('');

  const beam = s.weapon.type === 'beam';
  const max = countLimit(s);
  $('d-count').textContent = v.count;
  $('d-count-dec').disabled = v.count <= 1;
  $('d-count-inc').disabled = v.count >= max;
  $('d-hp-wrap').hidden = !beam;
  $('d-hp').value = String(v.hp);
  $('d-hitbox-wrap').hidden = s.target.shape !== 'agent';
  $('d-hit-full').checked = !v.headOnly;
  $('d-hit-head').checked = v.headOnly;
  $('d-level-wrap').hidden = !s.levels;
  $('d-level-hint').hidden = !s.levels;
  if (s.levels) {
    for (const lv of ['easy', 'medium', 'hard']) $(`d-level-${lv}`).checked = v.level === lv;
    $('d-level-hint').textContent = `${LEVEL_NAMES[v.level]}: ${s.levels[v.level].hint}.`;
  }
  const isDefault = setupKey(v) === defKeyFor(s);
  $('d-setup-reset').hidden = isDefault;
  $('d-setup-note').textContent = isDefault
    ? 'Default setup. Scores are compared only with runs on the same setup.'
    : `Custom setup: ${setupLabel(s, v)}. Scores are compared only with runs on the same setup.`;

  const runs = runsFor(s.id, setupKey(v), defKeyFor(s));
  const best = bestRun(s.id, setupKey(v), defKeyFor(s));
  const avg = average(runs, 'score');
  $('d-pb').textContent = best ? fmt(best.score) : '—';
  $('d-avg').textContent = avg === null ? '—' : fmt(avg);
  $('d-runs').textContent = runs.length;
  $('btn-start').innerHTML = `Start <span class="dur">· ${s.duration} s</span>`;
  $('btn-start').setAttribute('aria-label', `Start ${s.name}, ${s.duration} seconds`);
  sparkline($('d-spark'), runs.slice(-20).map((r) => r.score));
}

// ----------------------------------------------------------------- results
function showResults(result) {
  const { prevBest, isPB } = addRun(result, defKeyFor(game.scn));
  lastResult = result;
  lastPrevBest = prevBest;
  const s = game.scn;
  const cat = catOf(s.category);
  const beam = s.weapon.type === 'beam';
  $('r-cat').textContent = cat.name;
  $('r-cat').dataset.cat = cat.id;
  $('r-name').textContent = s.name;
  $('r-setup').textContent = setupLabel(s, game.setup);
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
  if (s.weapon.type === 'sniper') {
    stats.push(['Accuracy', pct(result.accuracy)]);
    stats.push(['Kills', result.kills]);
    stats.push(['Headshots', result.kills ? `${result.headshots}<small>${pct(result.headshots / result.kills)}</small>` : '0']);
    stats.push(['Avg. reaction', result.react === null ? '–' : `${Math.round(result.react * 1000)}<small>ms</small>`]);
    stats.push(['Early shots', `${result.unscoped}<small>of ${result.shots}</small>`]);
  } else if (beam) {
    stats.push(['On target', pct(result.accuracy)]);
    stats.push(['Damage', fmt(result.damage)]);
    if (game.setup.hp) stats.push(['Kills', result.kills]);
    else stats.push(['Time on target', `${result.onTime.toFixed(1)}<small>s</small>`]);
    if (result.headShare !== null && !game.setup.headOnly) stats.push(['On head', pct(result.headShare)]);
    stats.push(['Avg. offset', result.err === null ? '–' : `${result.err.toFixed(2)}<small>°</small>`]);
  } else {
    stats.push(['Accuracy', pct(result.accuracy)]);
    stats.push(['Kills', result.kills]);
    stats.push(['Shots', result.shots]);
    stats.push(['Avg. kill time', result.ttk === null ? '–' : `${Math.round(result.ttk * 1000)}<small>ms</small>`]);
  }
  $('r-stats').innerHTML = stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  $('r-coach').innerHTML = coaching(result, s, game.setup);

  $('results').hidden = false;
  // A lone series needs no legend; the chart title names it.
  $('r-legend').hidden = !(prevBest && prevBest.timeline);
  paceChart($('r-chart'), result.timeline, prevBest ? prevBest.timeline : null, s.duration);
}

function coaching(r, s, v) {
  if (s.weapon.type === 'sniper') {
    if (r.shots === 0) return 'No shots fired. Right click to scope, left click to fire.';
    let text = r.react !== null
      ? `On average you killed an agent <b>${Math.round(r.react * 1000)} ms</b> after it came into view.`
      : 'No kills this run.';
    if (r.unscoped > 0) {
      text += ` <b>${r.unscoped}</b> of ${r.shots} shots left before the scope settled, so they carried hip-fire spread. Give the scope its ${settings.sniper.scopeTime.toFixed(2)} s.`;
    }
    if (r.accuracy < 0.6) text += ` Accuracy was ${pct(r.accuracy)}; every miss locks you out for ${OPERATOR.fireInterval.toFixed(2)} s.`;
    else if (r.kills && r.headshots / r.kills < 0.3) text += ' Body shots kill with the Operator, but legs don\'t: keep the crosshair at chest height or above.';
    return text;
  }
  if (s.weapon.type === 'beam') {
    if (r.lead === null) return 'Hold mouse 1 while tracking so Trackline can measure how closely you follow the target.';
    const lag = r.lead;
    const amt = `${Math.abs(lag).toFixed(2)}°`;
    let text;
    if (lag < -0.15) text = `On average your crosshair <b>trailed the target by ${amt}</b> along its path. Anticipate direction changes and let your aim run slightly ahead.`;
    else if (lag > 0.15) text = `On average your crosshair <b>ran ${amt} ahead</b> of the target. Ease off after direction changes and let it come back to you.`;
    else text = `Your crosshair was <b>level with the target</b> along its path (${lag >= 0 ? '+' : '−'}${amt}). Keep the offset low and push the on-target time up.`;
    if (r.headShare !== null && !v.headOnly && r.onTime > 1) {
      text += r.headShare < 0.25
        ? ` Only <b>${pct(r.headShare)}</b> of your time on target was on the head. Hold the crosshair at head height and let the body be the fallback.`
        : ` <b>${pct(r.headShare)}</b> of your time on target was on the head.`;
    }
    return text;
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
  $('s-renderScale').value = String(s.render.scale);
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
  $('s-scope-toggle').checked = s.sniper.scopeMode !== 'hold';
  $('s-scope-hold').checked = s.sniper.scopeMode === 'hold';
  $('s-scopedSens').value = s.sniper.scopedSens;
  $('s-scopeTime').value = s.sniper.scopeTime;
  $('s-unscope').checked = s.sniper.unscope;
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
  $('o-scopedSens').textContent = `${s.sniper.scopedSens.toFixed(2)}×`;
  $('o-scopeTime').textContent = `${s.sniper.scopeTime.toFixed(2)} s${s.sniper.scopeTime === DEFAULTS.sniper.scopeTime ? ' (estimate)' : ''}`;
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
  const status = $('raw-status');
  if (rawInput === true) status.textContent = 'Raw input is active: the browser reports unaccelerated mouse counts, so the conversion is exact.';
  else if (rawInput === false && IS_MAC) status.textContent = 'This browser does not offer raw input, so macOS pointer acceleration applies and the cm/360 figure is approximate. Chrome and Edge on macOS give raw input.';
  else if (rawInput === false) status.textContent = 'This browser does not offer raw input, so OS pointer speed and acceleration apply. On Windows, set pointer speed to 6/11 and turn off Enhance pointer precision. Chrome and Edge on Windows give raw input.';
  else status.textContent = IS_MAC
    ? 'Chrome and Edge on macOS give raw, unaccelerated input. Safari and Firefox apply macOS pointer acceleration, so the conversion is approximate there.'
    : 'Chrome and Edge give raw, unaccelerated input. In other browsers, set Windows pointer speed to 6/11 and turn off Enhance pointer precision.';
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
  s.render.scale = parseFloat($('s-renderScale').value) || 1;
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
  s.sniper.scopeMode = $('s-scope-hold').checked ? 'hold' : 'toggle';
  s.sniper.scopedSens = parseFloat($('s-scopedSens').value);
  s.sniper.scopeTime = parseFloat($('s-scopeTime').value);
  s.sniper.unscope = $('s-unscope').checked;
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
  for (const t of ['scenarios', 'weapon', 'settings']) {
    $(`tab-${t}`).setAttribute('aria-selected', String(t === name));
    $(`panel-${t}`).hidden = t !== name;
  }
  if (name === 'settings') drawCrosshair($('xhair-preview'), settings.crosshair);
  if (name === 'weapon') {
    game.setInspect(weaponGun, stageCenter()); // builds the gun, so slot names exist
    renderWeapon();
  } else {
    game.setInspect(null);
  }
}

// ------------------------------------------------------------------ weapon
const skinOf = () => skins[weaponGun];
const STICKER_DEFAULT = { color: '#ffd166', text: 'GG', finish: 'glossy', scale: 1, rot: 0, dx: 0, dy: 0, scrape: 0 };

// Where the turntable gun should sit: the centre of the stage, in NDC.
function stageCenter() {
  const r = $('weapon-stage').getBoundingClientRect();
  if (!r.width || !r.height) return { x: 0.3, y: 0 };
  const cy = Math.min(r.top + r.height / 2, window.innerHeight * 0.55);
  return { x: ((r.left + r.width / 2) / window.innerWidth) * 2 - 1, y: -((cy / window.innerHeight) * 2 - 1) };
}

// Apply skin edits; slider drags rebuild the texture at most once a frame.
let skinFrame = 0;
function skinChanged(custom = true) {
  if (custom) skinOf().preset = 'custom';
  saveSkins(skins);
  if (!skinFrame) {
    skinFrame = requestAnimationFrame(() => {
      skinFrame = 0;
      game.setSkins(skins);
      renderPatternPreview();
    });
  }
  renderWeaponOutputs();
}

function swatch(p) {
  if (p.pattern === 'fade') return `linear-gradient(90deg, ${p.c1}, ${p.c2}, ${p.c3})`;
  if (p.pattern === 'solid') return p.c1;
  return `linear-gradient(90deg, ${p.c1} 0 45%, ${p.c2} 45% 75%, ${p.c3 === '#000000' ? p.c1 : p.c3} 75%)`;
}

function thumb(st, px) {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  c.getContext('2d').drawImage(stickerCanvas(st), 0, 0, px, px);
  return c;
}

function renderWeapon() {
  const g = GUNS[weaponGun];
  const sk = skinOf();
  for (const b of document.querySelectorAll('.gun-chip')) b.setAttribute('aria-checked', String(b.dataset.gun === weaponGun));
  $('w-kind').textContent = g.sniper ? 'Sniper · sniping scenarios' : `${g.kind} · ${Math.round(60 / g.fireInterval)} rounds per minute`;
  $('w-name').textContent = g.name;
  $('w-blurb').textContent = g.blurb;
  const equip = $('w-equip');
  if (g.sniper) {
    equip.disabled = true;
    equip.textContent = 'Used in sniping scenarios';
    $('w-equip-note').textContent = 'Only the AWP can scope.';
  } else {
    const on = settings.weapon.primary === weaponGun;
    equip.disabled = on;
    equip.textContent = on ? 'Equipped for tracking and clicking' : 'Use for tracking and clicking';
    $('w-equip-note').textContent = on ? '' : `Now equipped: ${GUNS[settings.weapon.primary].name}`;
  }
  for (const b of document.querySelectorAll('.preset')) b.setAttribute('aria-pressed', String(b.dataset.preset === sk.preset));
  $('w-pattern').value = sk.pattern;
  $('w-finish').value = sk.finish;
  const roles = COLOR_ROLES[sk.pattern] || COLOR_ROLES.solid;
  ['c1', 'c2', 'c3'].forEach((k, i) => {
    $(`w-${k}`).value = sk[k];
    $(`w-${k}-lbl`).textContent = roles[i] || '';
    $(`w-${k}-wrap`).hidden = !roles[i];
  });
  $('w-fade-wrap').hidden = sk.pattern !== 'fade';
  $('w-fadeReverse').checked = !!sk.fadeReverse;
  renderZones();
  $('w-fx-type').value = sk.fx.type;
  $('w-fx-color').value = sk.fx.color;
  $('w-fx-glow').checked = !!sk.fx.glow;
  $('w-wear').value = sk.wear;
  $('w-scale').value = sk.scale;
  $('w-seed').value = sk.seed;
  $('w-suppressor-wrap').hidden = weaponGun !== 'm4a1s';
  $('w-suppressor').checked = sk.suppressor !== false;
  $('w-sound').value = sk.sound || 'auto';
  $('w-show').checked = settings.weapon.show;
  $('w-sounds').checked = settings.weapon.sounds;
  $('w-hand-right').checked = settings.weapon.hand !== 'left';
  $('w-hand-left').checked = settings.weapon.hand === 'left';
  $('w-fov').value = settings.weapon.fov;
  $('w-models').value = settings.weapon.models;
  renderModelNote();
  renderStickers();
  renderWeaponOutputs();
  requestAnimationFrame(renderPatternPreview);
}

// Which model the Weapon tab shows, and whether a detailed one is on its way.
function renderModelNote() {
  const gv = game.vm.guns[weaponGun];
  let text = 'Simple built-in model.';
  if (settings.weapon.models !== 'simple' && MODEL_INFO[weaponGun]) {
    if (gv && gv.model.detailed) text = 'Detailed model: real mesh with its own normal maps. Pick "Original" to see its factory textures.';
    else if (gv && gv.failed) text = 'The detailed model could not load here, so the simple one is shown.';
    else text = 'Loading the detailed model…';
  }
  $('w-model-note').textContent = text;
}

// One select per part the gun has, with the finishes it can wear.
function renderZones() {
  const sk = skinOf();
  const host = $('w-zones');
  host.textContent = '';
  const detailed = game.vm.isDetailed(weaponGun);
  const opts = ['skin', ...(detailed ? ['factory'] : []), 'black', 'gray', 'tan', 'wood', 'gold', 'steel'];
  $('w-zones-hint').textContent = detailed
    ? 'Each part wears the pattern, its factory textures, or a solid finish.'
    : 'Each part wears the pattern or a solid finish.';
  for (const zone of game.vm.zonesFor(weaponGun)) {
    const label = document.createElement('label');
    label.className = 'f';
    const name = document.createElement('span');
    name.textContent = ZONE_LABELS[zone] || zone;
    const sel = document.createElement('select');
    sel.id = `w-zone-${zone}`;
    const cur = sk.zones[zone] || 'skin';
    const list = opts.includes(cur) ? opts : [...opts, cur];
    sel.innerHTML = list.map((k) => `<option value="${k}">${ZONE_FINISHES[k].label}</option>`).join('');
    sel.value = cur;
    sel.addEventListener('input', () => {
      sk.zones[zone] = sel.value;
      skinChanged(false);
    });
    label.append(name, sel);
    host.appendChild(label);
  }
}

function renderPatternPreview() {
  const gv = game.vm.guns[weaponGun];
  const img = gv && gv.texture && gv.texture.image;
  const c = $('w-pattern-preview');
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  if (!img) return;
  const sk = skinOf();
  if (sk.pattern === 'fade') {
    const grd = g.createLinearGradient(0, 0, c.width, 0);
    grd.addColorStop(0, sk.fadeReverse ? sk.c3 : sk.c1);
    grd.addColorStop(0.5, sk.c2);
    grd.addColorStop(1, sk.fadeReverse ? sk.c1 : sk.c3);
    g.fillStyle = grd;
    g.fillRect(0, 0, c.width, c.height);
    g.globalAlpha = 0.35;
  }
  // Show about 12 cm of pattern at the gun's scale.
  const px = (c.width * 0.25 * 4) / (4 * (sk.scale || 1)) * 2;
  const tile = Math.max(24, Math.min(c.width * 4, px));
  for (let y = 0; y < c.height; y += tile) for (let x = 0; x < c.width; x += tile) g.drawImage(img, x, y, tile, tile * (img.height / img.width));
  g.globalAlpha = 1;
}

function renderWeaponOutputs() {
  const sk = skinOf();
  $('w-fx-note').textContent = sk.fx.type === 'none'
    ? 'No effect: a plain muzzle flash.'
    : `${FX_TYPES[sk.fx.type]} shots from the muzzle to the impact, with a burst where they land.`;
  $('w-preset-name').textContent = sk.preset === 'custom' ? 'Custom' : SKIN_PRESETS[sk.preset] ? SKIN_PRESETS[sk.preset].name : '';
  $('o-w-wear').textContent = `${sk.wear.toFixed(2)} · ${wearLabel(sk.wear)}`;
  $('o-w-scale').textContent = `${sk.scale.toFixed(2)}×`;
  $('o-w-fov').textContent = `${settings.weapon.fov}°`;
  const st = sk.stickers[stickerSlot];
  if (st) {
    $('o-w-st-scale').textContent = `${Math.round(st.scale * 100)}%`;
    $('o-w-st-rot').textContent = `${st.rot}°`;
    $('o-w-st-scrape').textContent = `${Math.round(st.scrape * 100)}%`;
  }
}

function renderStickers() {
  const sk = skinOf();
  const slots = $('w-slots');
  slots.textContent = '';
  const gv = game.vm.guns[weaponGun];
  const names = gv ? gv.model.slots.map((sl) => sl.name) : [];
  sk.stickers.forEach((st, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'slot';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(i === stickerSlot));
    b.appendChild(st ? thumb(st, 80) : Object.assign(document.createElement('i'), { className: 'empty' }));
    const label = document.createElement('span');
    label.textContent = names[i] || `Slot ${i + 1}`;
    b.appendChild(label);
    b.title = `${names[i] || `Slot ${i + 1}`}: ${st ? STICKERS[st.id].name : 'empty'}`;
    b.addEventListener('click', () => { stickerSlot = i; renderStickers(); renderWeaponOutputs(); });
    slots.appendChild(b);
  });

  const cur = sk.stickers[stickerSlot];
  const grid = $('w-sticker-grid');
  grid.textContent = '';
  const none = document.createElement('button');
  none.type = 'button';
  none.textContent = 'None';
  none.setAttribute('aria-pressed', String(!cur));
  none.addEventListener('click', () => { sk.stickers[stickerSlot] = null; skinChanged(false); renderStickers(); });
  grid.appendChild(none);
  const color = cur ? cur.color : STICKER_DEFAULT.color;
  for (const [id, d] of Object.entries(STICKERS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = d.name;
    b.setAttribute('aria-label', `${d.name} sticker`);
    b.setAttribute('aria-pressed', String(!!cur && cur.id === id));
    b.appendChild(thumb({ ...STICKER_DEFAULT, color, text: cur ? cur.text : 'GG', id }, 96));
    b.addEventListener('click', () => {
      sk.stickers[stickerSlot] = { ...STICKER_DEFAULT, seed: 1 + Math.floor(Math.random() * 998), ...(sk.stickers[stickerSlot] || {}), id };
      skinChanged(false);
      renderStickers();
      renderWeaponOutputs();
    });
    grid.appendChild(b);
  }
  $('w-st-fields').hidden = !cur;
  if (cur) {
    $('w-st-text-wrap').hidden = cur.id !== 'text';
    $('w-st-text').value = cur.text || '';
    $('w-st-color').value = cur.color;
    $('w-st-finish').value = cur.finish;
    $('w-st-scale').value = cur.scale;
    $('w-st-rot').value = cur.rot;
    $('w-st-scrape').value = cur.scrape;
    $('w-st-dx').value = cur.dx;
    $('w-st-dy').value = cur.dy;
  }
}

// Update the current slot's sticker thumbnail without rebuilding the grid.
function refreshSlotThumb() {
  const st = skinOf().stickers[stickerSlot];
  const b = $('w-slots').children[stickerSlot];
  if (!b || !st) return;
  b.replaceChild(thumb(st, 80), b.firstChild);
}

// ------------------------------------------------------------------ wiring
fillSelect($('s-game'), GAMES);
$('d-hp').innerHTML = HP_CHOICES.map((hp) => `<option value="${hp}">${hp ? `${hp} HP` : 'Unlimited'}</option>`).join('');
fillSelect($('s-x-style'), CROSSHAIR_STYLES);
syncForm();
setVolume(settings.volume / 100);

// Weapon tab.
const fill = (sel, entries) => { sel.innerHTML = entries.map(([k, v]) => `<option value="${k}">${v}</option>`).join(''); };
$('w-guns').innerHTML = Object.entries(GUNS).map(([id, g]) => `<button type="button" class="gun-chip" role="radio" data-gun="${id}"><b>${g.name}</b><span>${g.kind}</span></button>`).join('');
$('w-presets').innerHTML = Object.entries(SKIN_PRESETS).map(([id, p]) => `<button type="button" class="preset" data-preset="${id}"><i style="background:${swatch(p)}"></i>${p.name}</button>`).join('');
fill($('w-pattern'), Object.entries(PATTERNS));
fill($('w-finish'), Object.entries(FINISHES).map(([k, f]) => [k, f.label]));
fill($('w-fx-type'), Object.entries(FX_TYPES));
fill($('w-st-finish'), Object.entries(STICKER_FINISHES));
fill($('w-sound'), Object.entries(FIRE_SOUNDS));

for (const b of document.querySelectorAll('.gun-chip')) {
  b.addEventListener('click', () => {
    weaponGun = b.dataset.gun;
    stickerSlot = 0;
    game.setInspect(weaponGun, stageCenter());
    renderWeapon();
  });
}
for (const b of document.querySelectorAll('.preset')) {
  b.addEventListener('click', () => {
    Object.assign(skinOf(), presetSkin(b.dataset.preset, weaponGun));
    skinChanged(false);
    renderWeapon();
  });
}
$('w-equip').addEventListener('click', () => {
  settings.weapon.primary = weaponGun;
  saveSettings(settings);
  game.applySettings(settings);
  renderWeapon();
});
const skinInput = (id, key, parse = (v) => v, rerender = false) => {
  $(id).addEventListener('input', (e) => {
    skinOf()[key] = parse(e.target.value);
    skinChanged();
    if (rerender) renderWeapon();
  });
};
skinInput('w-pattern', 'pattern', String, true);
skinInput('w-finish', 'finish');
skinInput('w-c1', 'c1');
skinInput('w-c2', 'c2');
skinInput('w-c3', 'c3');
$('w-fadeReverse').addEventListener('change', (e) => { skinOf().fadeReverse = e.target.checked; skinChanged(); });
skinInput('w-wear', 'wear', parseFloat);
skinInput('w-scale', 'scale', parseFloat);
skinInput('w-seed', 'seed', (v) => Math.max(1, Math.min(999, parseInt(v, 10) || 1)));
$('w-shuffle').addEventListener('click', () => {
  skinOf().seed = 1 + Math.floor(Math.random() * 998);
  $('w-seed').value = skinOf().seed;
  skinChanged();
});
$('w-suppressor').addEventListener('change', (e) => {
  skinOf().suppressor = e.target.checked;
  skinChanged(false);
});
$('w-fx-type').addEventListener('input', (e) => { skinOf().fx.type = e.target.value; skinChanged(false); });
$('w-fx-color').addEventListener('input', (e) => { skinOf().fx.color = e.target.value; skinChanged(false); });
$('w-fx-glow').addEventListener('change', (e) => { skinOf().fx.glow = e.target.checked; skinChanged(false); });
$('w-test-fire').addEventListener('click', () => {
  initAudio();
  game.vm.shot(GUNS[weaponGun].sniper);
  const sk = skinOf();
  if (settings.weapon.sounds) sfx.gun(sk.sound && sk.sound !== 'auto' ? sk.sound : GUNS[weaponGun].sound(sk));
});
$('w-random').addEventListener('click', () => {
  const sk = skinOf();
  Object.assign(sk, randomSkin());
  sk.preset = 'custom';
  skinChanged(false);
  renderWeapon();
});
$('w-apply-all').addEventListener('click', () => {
  const src = skinOf();
  for (const id of Object.keys(skins)) {
    if (id === weaponGun) continue;
    for (const k of SKIN_KEYS) skins[id][k] = src[k];
    skins[id].fx = { ...src.fx };
    skins[id].preset = src.preset;
  }
  skinChanged(false);
  $('w-msg').textContent = 'Pattern, colours, finish and fire effect copied to every gun. Parts and stickers stay as they were.';
});
const stickerInput = (id, key, parse = (v) => v) => {
  $(id).addEventListener('input', (e) => {
    const st = skinOf().stickers[stickerSlot];
    if (!st) return;
    st[key] = parse(e.target.value);
    skinChanged(false);
    refreshSlotThumb();
  });
};
stickerInput('w-st-text', 'text');
stickerInput('w-st-color', 'color');
stickerInput('w-st-finish', 'finish');
stickerInput('w-st-scale', 'scale', parseFloat);
stickerInput('w-st-rot', 'rot', (v) => parseInt(v, 10));
stickerInput('w-st-scrape', 'scrape', parseFloat);
stickerInput('w-st-dx', 'dx', parseFloat);
stickerInput('w-st-dy', 'dy', parseFloat);
// Recolour the design thumbnails once the colour is chosen.
$('w-st-color').addEventListener('change', renderStickers);
$('w-sound').addEventListener('change', (e) => {
  skinOf().sound = e.target.value;
  skinChanged(false);
});
$('w-sound-test').addEventListener('click', () => {
  initAudio();
  const sk = skinOf();
  sfx.gun(sk.sound && sk.sound !== 'auto' ? sk.sound : GUNS[weaponGun].sound(sk));
});
const viewInput = (id, apply) => {
  $(id).addEventListener('input', (e) => {
    apply(e.target);
    saveSettings(settings);
    game.applySettings(settings);
    renderWeaponOutputs();
  });
};
viewInput('w-show', (el) => { settings.weapon.show = el.checked; });
viewInput('w-sounds', (el) => { settings.weapon.sounds = el.checked; });
viewInput('w-hand-right', () => { settings.weapon.hand = 'right'; });
viewInput('w-hand-left', () => { settings.weapon.hand = 'left'; });
viewInput('w-fov', (el) => { settings.weapon.fov = parseInt(el.value, 10); });
viewInput('w-models', (el) => { settings.weapon.models = el.value === 'simple' ? 'simple' : 'detailed'; });
$('w-models').addEventListener('input', () => { renderZones(); renderStickers(); renderModelNote(); });
// A detailed model finished loading: its parts and sticker spots differ.
game.vm.onModel = (id) => {
  if (id !== weaponGun || $('panel-weapon').hidden) return;
  renderZones();
  renderStickers();
  renderModelNote();
};
$('w-reset').addEventListener('click', (e) => armButton(e.currentTarget, 'Reset this gun', () => {
  skins[weaponGun] = defaultSkin(weaponGun);
  saveSkins(skins);
  game.setSkins(skins);
  renderWeapon();
  $('w-msg').textContent = `${GUNS[weaponGun].name} reset to the Fade skin.`;
}));
// Drag the stage to turn the gun.
const stage = $('weapon-stage');
let dragging = false;
stage.addEventListener('pointerdown', (e) => { dragging = true; stage.setPointerCapture(e.pointerId); });
stage.addEventListener('pointermove', (e) => { if (dragging) game.vm.inspectDrag(e.movementX, e.movementY); });
stage.addEventListener('pointerup', () => { dragging = false; });
stage.addEventListener('pointercancel', () => { dragging = false; });
const recentre = () => { if (!$('panel-weapon').hidden) game.setInspect(weaponGun, stageCenter()); };
window.addEventListener('resize', recentre);
$('menu').addEventListener('scroll', recentre, { passive: true });

$('settings-form').addEventListener('input', readForm);
$('settings-form').addEventListener('change', readForm);
$('settings-form').addEventListener('submit', (e) => e.preventDefault());
$('tab-scenarios').addEventListener('click', () => showTab('scenarios'));
$('tab-settings').addEventListener('click', () => showTab('settings'));
$('tab-weapon').addEventListener('click', () => showTab('weapon'));
$('sens-chip').addEventListener('click', () => showTab('settings'));
$('btn-start').addEventListener('click', () => play(selected));
$('d-count-dec').addEventListener('click', () => changeSetup({ count: setupFor(selected).count - 1 }));
$('d-count-inc').addEventListener('click', () => changeSetup({ count: setupFor(selected).count + 1 }));
$('d-hp').addEventListener('change', (e) => changeSetup({ hp: parseInt(e.target.value, 10) }));
$('d-hit-full').addEventListener('change', () => changeSetup({ headOnly: false }));
$('d-hit-head').addEventListener('change', () => changeSetup({ headOnly: true }));
$('d-setup-reset').addEventListener('click', () => changeSetup(defaultSetup(selected)));
for (const lv of ['easy', 'medium', 'hard']) {
  $(`d-level-${lv}`).addEventListener('change', () => changeSetup({ level: lv }));
}
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
  renderWeapon();
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
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  // Leave browser shortcuts (Cmd+R, Ctrl+R) alone.
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.code; // physical key, so it works on any keyboard layout
  if ((k === 'ShiftLeft' || k === 'ShiftRight') && !e.repeat) {
    game.scopePress();
  } else if (k === 'KeyR' && (game.state === 'running' || game.state === 'countdown')) {
    e.preventDefault();
    game.start();
  } else if (k === 'KeyR' && game.state === 'paused') {
    play(game.scn);
  } else if ((k === 'Space' || k === 'Enter') && game.state === 'results') {
    // A focused button already fires its own click on Space or Enter.
    if (tag === 'BUTTON') return;
    e.preventDefault();
    play(game.scn);
  } else if (k === 'Escape' && game.state === 'results') {
    game.toMenu();
  } else if (k === 'Escape' && game.state === 'paused' && performance.now() - pausedAt > 400) {
    // The Esc that released the mouse can arrive here too; only a second press quits.
    game.toMenu();
  }
});
document.addEventListener('keyup', (e) => {
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') game.scopeRelease();
});

// Fullscreen helps on laptops: no browser chrome, and pointer lock stays put.
const fsBtn = $('btn-fullscreen');
const docEl = document.documentElement;
const fsSupported = !!(docEl.requestFullscreen || docEl.webkitRequestFullscreen);
fsBtn.hidden = !fsSupported;
fsBtn.addEventListener('click', () => {
  const active = document.fullscreenElement || document.webkitFullscreenElement;
  if (active) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  else (docEl.requestFullscreen || docEl.webkitRequestFullscreen).call(docEl).catch?.(() => {});
});

window.addEventListener('resize', () => {
  if (!$('results').hidden && lastResult) {
    paceChart($('r-chart'), lastResult.timeline, lastPrevBest ? lastPrevBest.timeline : null, game.scn.duration);
  }
});

const noLock = !('requestPointerLock' in Element.prototype) || matchMedia('(pointer: coarse)').matches;
$('device-notice').hidden = !noLock;

drawCrosshair(xhair, settings.crosshair);
ensureLoaded(selected);
onGameState('menu');
