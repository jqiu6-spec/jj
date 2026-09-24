import '@fontsource/chakra-petch/latin-500.css';
import '@fontsource/chakra-petch/latin-600.css';
import '@fontsource/chakra-petch/latin-700.css';
import '@fontsource-variable/inter';
import './styles.css';

import { createAudio } from './core/audio.js';
import { cmPer360, formatSensitivity } from './core/sensitivity.js';
import { DURATIONS, loadSettings } from './core/settings.js';
import { clearStats, loadBests, loadHistory, recordRun, runKey } from './core/stats.js';
import { createStorage } from './core/storage.js';
import { createSettingsStore } from './core/store.js';
import { DIFFICULTIES, getScenario, resolveDifficulty, SCENARIOS } from './game/scenarios.js';
import { getWeapon, WEAPONS } from './core/weapons.js';
import { $, $$, bindRovingRadios, h, markRadios, setText } from './ui/dom.js';
import { formatCm, formatInt, formatPercent } from './ui/format.js';
import { scenarioIcon } from './ui/icons.js';
import { renderResults } from './ui/resultsView.js';
import { createSensitivityControl } from './ui/sensitivityControl.js';
import { createSettingsPanel } from './ui/settingsPanel.js';
import { createStatsView } from './ui/statsView.js';

// ---------------------------------------------------------------- state

const storage = createStorage();
const store = createSettingsStore(loadSettings(storage), storage);
const audio = createAudio();
let stats = { history: loadHistory(storage) };
stats.bests = loadBests(storage, stats.history);

// three.js is only needed once a run starts, so it loads in the background.
const enginePromise = import('./game/engine.js');
let engine = null;

const els = {
  game: $('#game'),
  canvas: $('#game-canvas'),
  crosshair: $('#crosshair-canvas'),
  fx: $('#fx-canvas'),
  overlays: {
    waiting: $('#overlay-waiting'),
    paused: $('#overlay-paused'),
    results: $('#overlay-results'),
  },
  hud: {
    run: $('#hud-run'),
    sandbox: $('#hud-sandbox'),
    timer: $('#hud-timer'),
    progress: $('#hud-progress-fill'),
    accuracy: $('#hud-accuracy'),
    score: $('#hud-score'),
    countdown: $('#hud-countdown'),
    damage: $('#hud-damage'),
    fps: $('#hud-fps'),
    scenario: $('#hud-scenario'),
    sens: $('#hud-sens'),
    heading: $('#sb-heading'),
    turned: $('#sb-turned'),
    moved: $('#sb-moved'),
    cm360: $('#sb-cm360'),
  },
};

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 3200);
}

// ---------------------------------------------------------------- routing

const VIEWS = ['play', 'stats', 'guide'];
let statsView = null;

function route() {
  const view = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'play';
  for (const section of $$('[data-view]')) section.hidden = section.dataset.view !== view;
  for (const link of $$('[data-view-link]')) {
    if (link.dataset.viewLink === view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (view === 'stats') statsView.render();
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------- play view

const scenarioGrid = $('#scenario-grid');
const difficultyPicker = $('#difficulty-picker');
const durationPicker = $('#duration-picker');
const weaponPicker = $('#weapon-picker');
const scenarioCards = new Map();

function currentDifficulty(state = store.get()) {
  return resolveDifficulty(state.difficulty, { speed: state.customSpeed, size: state.customSize });
}

function buildPlayView() {
  for (const scenario of SCENARIOS) {
    const pb = h('span', { class: 'scenario-pb' });
    const card = h(
      'button',
      {
        type: 'button',
        role: 'radio',
        class: 'scenario-card',
        dataset: { value: scenario.id },
        onclick: () => store.set('scenario', scenario.id),
        ondblclick: () => startRun(),
      },
      h('span', { class: 'scenario-icon' }, scenarioIcon(scenario.id)),
      h(
        'span',
        { class: 'scenario-body' },
        h('span', { class: 'scenario-top' }, h('span', { class: 'scenario-name' }, scenario.name), h('span', { class: 'tag' }, scenario.focus)),
        h('span', { class: 'scenario-desc' }, scenario.description),
        pb,
      ),
    );
    scenarioCards.set(scenario.id, { card, pb });
    scenarioGrid.append(card);
  }
  bindRovingRadios(scenarioGrid, (value) => store.set('scenario', value));

  const difficultyOptions = [
    ...Object.entries(DIFFICULTIES).map(([id, d]) => ({ value: id, label: d.label })),
    { value: 'custom', label: 'Custom' },
  ];
  difficultyPicker.append(
    ...difficultyOptions.map((o) =>
      h('button', { type: 'button', role: 'radio', class: 'seg', dataset: { value: o.value }, onclick: () => store.set('difficulty', o.value) }, o.label),
    ),
  );
  bindRovingRadios(difficultyPicker, (value) => store.set('difficulty', value));

  durationPicker.append(
    ...DURATIONS.map((d) =>
      h('button', { type: 'button', role: 'radio', class: 'seg', dataset: { value: d }, onclick: () => store.set('duration', d) }, `${d}s`),
    ),
  );
  bindRovingRadios(durationPicker, (value) => store.set('duration', Number(value)));

  weaponPicker.append(
    ...WEAPONS.map((w) =>
      h('button', { type: 'button', role: 'radio', class: 'seg', dataset: { value: w.id }, onclick: () => store.set('weapon', w.id) }, w.name),
    ),
  );
  bindRovingRadios(weaponPicker, (value) => store.set('weapon', value));

  $('#guide-weapons').append(
    ...WEAPONS.flatMap((w) => [
      h('dt', {}, w.name),
      h(
        'dd',
        {},
        `${w.fireRate}${w.spinUp ? `–${w.spinUp.fireRate}` : ''} rounds/s · ${w.damage.head} head · ${w.damage.body} body · ${w.damage.legs} legs${w.suppressed ? ' · suppressed' : ''}`,
      ),
    ]),
  );

  $('#quick-sens').append(createSensitivityControl(store).root);
  $('#start-btn').addEventListener('click', () => startRun());
  $('#sandbox-btn').addEventListener('click', () => startSandbox());

  $('#guide-scenarios').append(
    ...SCENARIOS.flatMap((s) => [h('dt', {}, s.name, h('span', { class: 'tag' }, s.focus)), h('dd', {}, s.description)]),
  );
}

function updatePlayView(state = store.get()) {
  const scenario = getScenario(state.scenario);
  const difficulty = currentDifficulty(state);
  for (const [id, { pb }] of scenarioCards) {
    const best = stats.bests[runKey({ scenario: id, difficulty: difficulty.key, duration: state.duration })];
    setText(pb, best ? `Best ${formatInt(best.score)} · ${formatPercent(best.accuracy)}` : 'No best yet');
    pb.classList.toggle('has-best', Boolean(best));
  }
  markRadios(scenarioGrid, scenario.id);
  markRadios(difficultyPicker, state.difficulty);
  markRadios(durationPicker, state.duration);
  markRadios(weaponPicker, state.weapon);
  const weapon = getWeapon(state.weapon);
  setText(
    $('#weapon-hint'),
    `${weapon.fireRate}${weapon.spinUp ? `–${weapon.spinUp.fireRate}` : ''} rounds/s · ${weapon.damage.head} / ${weapon.damage.body} / ${weapon.damage.legs} damage (head / body / legs)`,
  );

  setText($('#launch-focus'), scenario.focus);
  setText($('#launch-name'), scenario.name);
  setText($('#launch-desc'), scenario.description);

  const customHint = $('#custom-hint');
  customHint.hidden = state.difficulty !== 'custom';
  setText(customHint, `${difficulty.speed}× speed · ${difficulty.size}× size. Change these in Settings → Gameplay.`);

  const best = stats.bests[runKey({ scenario: scenario.id, difficulty: difficulty.key, duration: state.duration })];
  const pbLine = $('#launch-pb');
  pbLine.replaceChildren(
    h('span', { class: 'label' }, 'Personal best'),
    h('span', { class: 'pb-value' }, best ? `${formatInt(best.score)} · ${formatPercent(best.accuracy)}` : '—'),
  );
  setText($('#fire-mode-hint'), state.fireMode === 'hold' ? 'hold left mouse' : 'always firing');
}

// ---------------------------------------------------------------- game layer

let engineBuild = null;

/** Create the engine once; concurrent callers share the same build. */
function ensureEngine() {
  if (engine) return Promise.resolve(engine);
  engineBuild ??= buildEngine();
  return engineBuild;
}

async function buildEngine() {
  try {
    const { Engine } = await enginePromise;
    engine = new Engine({
      canvas: els.canvas,
      crosshairCanvas: els.crosshair,
      fxCanvas: els.fx,
      audio,
      settings: store.get(),
      onState: handleState,
      onHud: updateHud,
      onFinish: handleFinish,
      onLockError: showLockError,
    });
    return engine;
  } catch (error) {
    console.error(error);
    hideGame();
    toast('Could not start the 3D view. Your browser or graphics driver may not support WebGL.');
    return null;
  }
}

function showGame() {
  els.game.hidden = false;
  document.body.classList.add('in-game');
}

function hideGame() {
  els.game.hidden = true;
  document.body.classList.remove('in-game', 'is-locked');
  hideOverlays();
}

function hideOverlays() {
  for (const overlay of Object.values(els.overlays)) overlay.hidden = true;
  for (const error of $$('.lock-error', els.game)) error.hidden = true;
}

function showOverlay(name) {
  hideOverlays();
  els.overlays[name].hidden = false;
  const focusTarget = els.overlays[name].querySelector('[data-action="resume"], [data-action="restart"], .clickable');
  focusTarget?.focus({ preventScroll: true });
}

function showLockError(message) {
  for (const error of $$('.lock-error', els.game)) {
    if (!error.closest('.overlay').hidden) {
      error.textContent = message;
      error.hidden = false;
    }
  }
}

function sensSummary(state = store.get()) {
  return `VAL ${formatSensitivity(state.sensitivity)} · ${state.dpi} DPI · ${formatCm(cmPer360(state.sensitivity, state.dpi))}/360`;
}

function updateCorners() {
  const state = store.get();
  const raw = engine?.locked ? (engine.rawActive ? 'raw input on' : 'raw input off') : '';
  setText(els.hud.sens, [sensSummary(state), raw].filter(Boolean).join(' · '));
  const weapon = getWeapon(state.weapon).name;
  if (engine?.mode === 'sandbox') setText(els.hud.scenario, `Sensitivity check room · ${weapon} (hold LMB to test-fire)`);
  else if (engine?.run) setText(els.hud.scenario, `${engine.run.scenario.name} · ${engine.run.difficulty.label} · ${weapon}`);
  setText(els.hud.cm360, formatCm(cmPer360(state.sensitivity, state.dpi)));
}

async function enterFullscreen() {
  if (!store.get().fullscreen || document.fullscreenElement || !els.game.requestFullscreen) return;
  try {
    await els.game.requestFullscreen({ navigationUI: 'hide' });
  } catch {
    // Denied (e.g. no user gesture left): keep playing in the window.
  }
}

function exitFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

/** Call from a click or key press: go fullscreen if enabled, then lock the mouse. */
async function lockPointer() {
  await enterFullscreen();
  return engine?.requestLock();
}

async function startRun() {
  audio.unlock();
  const state = store.get();
  showGame();
  // Ask for fullscreen while the click's user activation is still fresh.
  const fullscreen = enterFullscreen();
  const eng = await ensureEngine();
  await fullscreen;
  if (!eng) return;
  eng.resize();
  const scenario = getScenario(state.scenario);
  const difficulty = currentDifficulty(state);
  setText($('#waiting-eyebrow'), `${difficulty.label} · ${state.duration} s`);
  setText($('#waiting-title'), scenario.name);
  setText(
    $('#waiting-desc'),
    `${state.fireMode === 'hold' ? 'Hold left mouse to fire.' : 'Firing is automatic, just track.'} ${sensSummary(state)}.`,
  );
  eng.prepareRun({ scenarioId: scenario.id, difficulty, duration: state.duration });
  els.hud.run.hidden = false;
  els.hud.sandbox.hidden = true;
  updateCorners();
  lockPointer();
}

async function startSandbox() {
  audio.unlock();
  showGame();
  const fullscreen = enterFullscreen();
  const eng = await ensureEngine();
  await fullscreen;
  if (!eng) return;
  eng.resize();
  setText($('#waiting-eyebrow'), 'No timer, no score');
  setText($('#waiting-title'), 'Sensitivity check room');
  setText($('#waiting-desc'), `Markers every 45°. Move your mouse your cm/360 and you should land where you started. ${sensSummary()}.`);
  eng.prepareSandbox();
  els.hud.run.hidden = true;
  els.hud.sandbox.hidden = false;
  updateCorners();
  lockPointer();
}

function goToMenu() {
  engine?.quit();
  exitFullscreen();
  hideGame();
  updatePlayView();
}

function handleState(state) {
  document.body.classList.toggle('is-locked', state === 'countdown' || state === 'running' || state === 'ending' || state === 'sandbox');
  if (state === 'waiting') showOverlay('waiting');
  else if (state === 'paused') {
    setText($('#paused-desc'), engine.mode === 'sandbox' ? 'Resume to keep checking, or head back to the menu.' : 'Click resume to lock the mouse again.');
    showOverlay('paused');
  } else if (state === 'idle') hideGame();
  else hideOverlays();
  if (state !== 'countdown') setText(els.hud.countdown, '');
  if (state === 'waiting' || state === 'paused' || state === 'idle' || state === 'finished') {
    setText(els.hud.damage, '');
    els.hud.countdown.classList.remove('is-flash', 'is-time');
  }
  updateCorners();
}

function updateHud(hud) {
  const { settings } = engine;
  setText(els.hud.fps, settings.showFps ? `${hud.fps} FPS` : '');
  if (hud.mode === 'sandbox') {
    // 359.96° would print as "360.0°"; show it as 0.0° like the markers.
    setText(els.hud.heading, `${(hud.heading >= 359.95 ? 0 : hud.heading).toFixed(1)}°`);
    setText(els.hud.turned, `${hud.turned.toFixed(1)}° (${(hud.turned / 360).toFixed(2)} turns)`);
    const cm = (hud.counts / settings.dpi) * 2.54;
    setText(els.hud.moved, `${cm.toFixed(2)} cm (${formatInt(hud.counts)} counts)`);
    return;
  }
  const duration = engine.run?.duration ?? 1;
  setText(els.hud.timer, hud.remaining.toFixed(1));
  els.hud.progress.style.transform = `scaleX(${1 - hud.remaining / duration})`;
  setText(els.hud.accuracy, formatPercent(hud.accuracy));
  setText(els.hud.score, formatInt(hud.score));
  els.hud.timer.parentElement.classList.toggle('on-target', hud.onTarget && hud.state === 'running');
  const flash = hud.state === 'countdown' ? String(hud.countdown) : hud.flash;
  setText(els.hud.countdown, flash);
  els.hud.countdown.classList.toggle('is-flash', Boolean(hud.flash) && hud.state !== 'countdown');
  els.hud.countdown.classList.toggle('is-time', hud.flash === 'TIME');
  // Damage ticker: the total pops on every new hit.
  setText(els.hud.damage, hud.damage > 0 ? formatInt(hud.damage) : '');
  if (hud.damageHits !== lastDamageHits) {
    lastDamageHits = hud.damageHits;
    els.hud.damage.classList.remove('pop');
    void els.hud.damage.offsetWidth; // restart the animation
    els.hud.damage.classList.add('pop');
  }
}

let lastDamageHits = 0;

function handleFinish(result) {
  const state = store.get();
  const run = {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    date: new Date().toISOString(),
    ...result,
    sensitivity: state.sensitivity,
    dpi: state.dpi,
    fov: state.fov,
    fireMode: state.fireMode,
    weapon: result.weapon,
    weaponName: result.weaponName,
  };
  const outcome = recordRun(storage, stats, run);
  stats = { history: outcome.history, bests: outcome.bests };
  showOverlay('results');
  renderResults({ run, previousBest: outcome.previousBest, isPersonalBest: outcome.isPersonalBest });
  if (state.uiSounds) {
    if (outcome.isPersonalBest && outcome.previousBest) audio.personalBest();
    else audio.finish();
  }
  updatePlayView();
}

function bindGameLayer() {
  els.game.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'menu') return goToMenu();
    if (action === 'settings') return settingsPanel.open();
    if (action === 'resume') return lockPointer();
    if (action === 'restart') {
      if (engine?.mode === 'sandbox') return startSandbox();
      return startRun();
    }
    if (event.target.closest('#waiting-card')) lockPointer();
  });

  document.addEventListener('keydown', (event) => {
    if (settingsPanel.isOpen || event.repeat) return;
    const target = event.target;
    const typing = target.matches?.('input, select, textarea');

    if (!els.game.hidden) {
      if (engine?.locked) return;
      const visible = Object.entries(els.overlays).find(([, el]) => !el.hidden)?.[0];
      // A focused button handles Enter/Space itself; don't trigger a second action.
      const onButton = target.matches?.('button, a');
      if (visible === 'results') {
        if ((event.key === 'Enter' && !onButton) || event.code === 'KeyR') {
          event.preventDefault();
          startRun();
        } else if (event.code === 'KeyM' || event.key === 'Escape') {
          event.preventDefault();
          goToMenu();
        }
      } else if ((visible === 'waiting' || visible === 'paused') && (event.key === 'Enter' || event.key === ' ')) {
        if (onButton) return;
        event.preventDefault();
        lockPointer();
      }
      return;
    }

    const onPlay = !$('#view-play').hidden;
    if (onPlay && event.key === 'Enter' && !typing && !target.matches?.('button, a')) {
      event.preventDefault();
      startRun();
    }
  });
}

// ---------------------------------------------------------------- settings

const settingsPanel = createSettingsPanel({
  dialog: $('#settings-dialog'),
  store,
  confirmReset: () => window.confirm('Reset every setting (sensitivity, crosshair, gameplay, video and audio) to its default?'),
  onClose: () => {
    const overlay = Object.values(els.overlays).find((el) => !el.hidden);
    overlay?.querySelector('[data-action="resume"], [data-action="restart"]')?.focus({ preventScroll: true });
  },
});

$('#open-settings').addEventListener('click', () => settingsPanel.open());

store.subscribe((state) => {
  engine?.applySettings(state);
  updatePlayView(state);
  if (!els.game.hidden) updateCorners();
});

// ---------------------------------------------------------------- boot

statsView = createStatsView({
  getStats: () => stats,
  getSettings: () => store.get(),
  onClear: () => {
    if (!stats.history.length && !Object.keys(stats.bests).length) return toast('There are no stats to clear.');
    if (!window.confirm('Delete every saved run and personal best? This cannot be undone.')) return;
    stats = clearStats(storage);
    statsView.render();
    updatePlayView();
    toast('Stats cleared.');
  },
});

buildPlayView();
bindGameLayer();
updatePlayView();
route();
window.addEventListener('hashchange', route);
window.addEventListener('pagehide', () => store.flush());

const finePointer = window.matchMedia?.('(pointer: fine)').matches ?? true;
if (!finePointer || !('requestPointerLock' in Element.prototype)) $('#device-notice').hidden = false;

enginePromise.catch((error) => console.error('Failed to load the game engine', error));

// Build the renderer while the menu is idle so the first Start is instant.
const warmUp = () => ensureEngine();
if ('requestIdleCallback' in window) requestIdleCallback(warmUp, { timeout: 3000 });
else setTimeout(warmUp, 800);

// Dev-server only hook for poking at the engine from the console / browser tests.
if (import.meta.env.DEV) {
  window.__tracklock = { store, get engine() { return engine; } };
}
