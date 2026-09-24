import {
  CROSSHAIR_COLORS,
  DEFAULT_CROSSHAIR,
  DEFAULT_SETTINGS,
  getPath,
  TARGET_COLORS,
} from '../core/settings.js';
import {
  convertSensitivity,
  formatSensitivity,
  GAMES,
  SENS_MAX,
  SENS_MIN,
  sensitivityFromCm360,
  clampSensitivity,
} from '../core/sensitivity.js';
import { CrosshairCodeError, parseCrosshairCode, toCrosshairCode } from '../core/crosshairCode.js';
import { drawCrosshair } from '../game/crosshair.js';
import { $$, h, setText } from './dom.js';
import { createSensitivityControl } from './sensitivityControl.js';

let uid = 0;
const nextId = (prefix) => `${prefix}-${++uid}`;

// ------------------------------------------------------------ field builders
// Each builder returns { el, sync(state) } so the panel can refresh every
// control when settings change anywhere (another panel, a reset, ...).

function fieldWrap(label, control, { help, forId } = {}) {
  return h(
    'div',
    { class: 'setting' },
    h('div', { class: 'setting-text' }, h('label', { class: 'setting-label', for: forId }, label), help && h('p', { class: 'hint' }, help)),
    h('div', { class: 'setting-control' }, control),
  );
}

function toggleField(store, { path, label, help, enabledWhen }) {
  const id = nextId('toggle');
  const input = h('input', { id, type: 'checkbox', role: 'switch', class: 'switch' });
  input.addEventListener('change', () => store.set(path, input.checked));
  const el = fieldWrap(label, input, { help, forId: id });
  return {
    el,
    sync(state) {
      input.checked = Boolean(getPath(state, path));
      if (enabledWhen) setEnabled(el, enabledWhen(state));
    },
  };
}

function rangeField(store, { path, label, min, max, step, format = String, help, enabledWhen }) {
  const id = nextId('range');
  const input = h('input', { id, type: 'range', class: 'range', min, max, step });
  const output = h('output', { class: 'range-value', for: id });
  input.addEventListener('input', () => {
    store.set(path, Number(input.value));
  });
  const el = fieldWrap(label, h('div', { class: 'range-row' }, input, output), { help, forId: id });
  return {
    el,
    sync(state) {
      const value = getPath(state, path);
      if (document.activeElement !== input) input.value = String(value);
      input.setAttribute('aria-valuetext', format(value));
      setText(output, format(value));
      if (enabledWhen) setEnabled(el, enabledWhen(state));
    },
  };
}

function numberField(store, { path, label, min, max, step, help, decimals = 4 }) {
  const id = nextId('number');
  const input = h('input', { id, type: 'number', class: 'input narrow', min, max, step, inputmode: 'decimal' });
  const commit = () => {
    const value = Number(input.value);
    if (input.value.trim() === '' || !Number.isFinite(value)) {
      input.value = String(getPath(store.get(), path));
      return;
    }
    const clamped = Number(Math.min(max, Math.max(min, value)).toFixed(decimals));
    store.set(path, clamped);
    input.value = String(clamped);
  };
  input.addEventListener('change', commit);
  const el = fieldWrap(label, input, { help, forId: id });
  return {
    el,
    sync(state) {
      if (document.activeElement !== input) input.value = String(getPath(state, path));
    },
  };
}

function segmentedField(store, { path, label, options, help }) {
  const id = nextId('seg');
  const group = h('div', { class: 'segmented', role: 'radiogroup', 'aria-labelledby': id });
  const buttons = options.map((option) =>
    h(
      'button',
      {
        type: 'button',
        role: 'radio',
        class: 'seg',
        dataset: { value: option.value },
        onclick: () => store.set(path, option.value),
      },
      option.label,
    ),
  );
  group.append(...buttons);
  const el = h(
    'div',
    { class: 'setting' },
    h('div', { class: 'setting-text' }, h('span', { class: 'setting-label', id }, label), help && h('p', { class: 'hint' }, help)),
    h('div', { class: 'setting-control' }, group),
  );
  return {
    el,
    sync(state) {
      const value = getPath(state, path);
      for (const button of buttons) {
        const checked = button.dataset.value === String(value);
        button.setAttribute('aria-checked', String(checked));
      }
    },
  };
}

function colorField(store, { path, label, presets, help }) {
  const id = nextId('color');
  const custom = h('input', { type: 'color', class: 'color-input', id, 'aria-label': `${label}: custom color` });
  custom.addEventListener('input', () => store.set(path, custom.value));
  const swatches = presets.map((preset) =>
    h('button', {
      type: 'button',
      class: 'swatch',
      style: { '--swatch': preset.value },
      title: preset.name,
      'aria-label': preset.name,
      dataset: { value: preset.value },
      onclick: () => store.set(path, preset.value),
    }),
  );
  const el = fieldWrap(label, h('div', { class: 'swatches' }, swatches, custom), { help, forId: id });
  return {
    el,
    sync(state) {
      const value = getPath(state, path);
      for (const swatch of swatches) swatch.setAttribute('aria-pressed', String(swatch.dataset.value === value));
      if (document.activeElement !== custom) custom.value = value;
    },
  };
}

function groupField(title, fields) {
  return {
    el: h('fieldset', { class: 'setting-group' }, h('legend', {}, title), fields.map((f) => f.el)),
    sync(state) {
      for (const field of fields) field.sync(state);
    },
  };
}

function setEnabled(el, enabled) {
  el.classList.toggle('is-disabled', !enabled);
  for (const control of el.querySelectorAll('input, button, select')) control.disabled = !enabled;
}

function staticField(el) {
  return { el, sync() {} };
}

// ------------------------------------------------------------ custom blocks

function converterBlock(store) {
  const gameSelect = h(
    'select',
    { class: 'input', 'aria-label': 'Game to convert from' },
    GAMES.filter((g) => g.id !== 'valorant').map((g) => h('option', { value: g.id }, g.name)),
  );
  const gameValue = h('input', { class: 'input narrow', type: 'text', inputmode: 'decimal', value: '1', 'aria-label': 'Sensitivity in that game' });
  const gameResult = h('output', { class: 'convert-result' });
  const gameUse = h('button', { type: 'button', class: 'btn btn-secondary btn-sm' }, 'Use');

  const cmValue = h('input', { class: 'input narrow', type: 'text', inputmode: 'decimal', value: '40', 'aria-label': 'Desired cm per 360' });
  const cmResult = h('output', { class: 'convert-result' });
  const cmUse = h('button', { type: 'button', class: 'btn btn-secondary btn-sm' }, 'Use');
  const cmDpi = h('span', { class: 'muted' });

  let gameSens = null;
  let cmSens = null;

  const update = () => {
    const game = GAMES.find((g) => g.id === gameSelect.value);
    const raw = Number(gameValue.value.replace(',', '.'));
    const converted = convertSensitivity(raw, game.yaw);
    gameSens = converted === null ? null : clampSensitivity(converted);
    gameResult.textContent = gameSens === null ? '—' : `= ${formatSensitivity(gameSens)} Valorant`;
    gameUse.disabled = gameSens === null;

    const { dpi } = store.get();
    const cm = Number(cmValue.value.replace(',', '.'));
    const fromCm = sensitivityFromCm360(cm, dpi);
    cmSens = fromCm === null ? null : clampSensitivity(fromCm);
    cmResult.textContent = cmSens === null ? '—' : `= ${formatSensitivity(cmSens)} Valorant`;
    cmUse.disabled = cmSens === null;
    cmDpi.textContent = `at ${dpi} DPI`;
  };

  gameSelect.addEventListener('change', update);
  gameValue.addEventListener('input', update);
  cmValue.addEventListener('input', update);
  gameUse.addEventListener('click', () => gameSens !== null && store.set('sensitivity', gameSens));
  cmUse.addEventListener('click', () => cmSens !== null && store.set('sensitivity', cmSens));

  const el = h(
    'fieldset',
    { class: 'setting-group' },
    h('legend', {}, 'Convert to Valorant'),
    h('p', { class: 'hint' }, `Results are limited to ${SENS_MIN} – ${SENS_MAX}. Game conversions assume the same DPI.`),
    h('div', { class: 'convert-row' }, gameSelect, gameValue, gameResult, gameUse),
    h('div', { class: 'convert-row' }, h('span', { class: 'convert-label' }, 'From cm/360'), cmValue, cmDpi, cmResult, cmUse),
  );
  update();
  return { el, sync: update };
}

function crosshairPreview() {
  const canvas = h('canvas', { class: 'crosshair-preview-canvas', 'aria-label': 'Crosshair preview', role: 'img' });
  const view = { background: 'dark', zoom: 1 };
  let lastState = null;
  const chip = (key, value, text) =>
    h(
      'button',
      {
        type: 'button',
        class: 'chip',
        dataset: { key, value },
        onclick: () => {
          view[key] = value;
          draw(lastState);
        },
      },
      text,
    );
  const chips = [
    chip('background', 'dark', 'Dark background'),
    chip('background', 'bright', 'Bright background'),
    chip('zoom', 1, 'Actual size'),
    chip('zoom', 4, 'Zoom 4×'),
  ];
  const draw = (state) => {
    if (!state) return;
    lastState = state;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.round((canvas.clientWidth || 320) * dpr);
    const height = Math.round((canvas.clientHeight || 150) * dpr);
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    if (view.background === 'dark') {
      gradient.addColorStop(0, '#1b222c');
      gradient.addColorStop(1, '#2a3442');
    } else {
      gradient.addColorStop(0, '#c9d6e3');
      gradient.addColorStop(1, '#f2efe6');
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    // Draw at true device-pixel size, then optionally blow it up with hard pixel edges.
    const zoom = view.zoom;
    const sw = Math.ceil(width / zoom);
    const sh = Math.ceil(height / zoom);
    const small = document.createElement('canvas');
    small.width = sw;
    small.height = sh;
    const sctx = small.getContext('2d');
    drawCrosshair(sctx, Math.floor(sw / 2), Math.floor(sh / 2), state.crosshair);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, Math.floor((width - sw * zoom) / 2), Math.floor((height - sh * zoom) / 2), sw * zoom, sh * zoom);
    for (const button of chips) button.setAttribute('aria-pressed', String(String(view[button.dataset.key]) === button.dataset.value));
  };
  const el = h('div', { class: 'crosshair-preview' }, canvas, h('div', { class: 'chip-row' }, chips));
  return { el, sync: draw };
}

function crosshairCodeBlock(store) {
  const importInput = h('input', {
    class: 'input code-input',
    type: 'text',
    placeholder: '0;P;c;5;h;0;0l;4;0o;2;0a;1;0f;0;1b;0',
    spellcheck: 'false',
    autocomplete: 'off',
    'aria-label': 'Valorant crosshair code to import',
  });
  const exportInput = h('input', { class: 'input code-input', type: 'text', readonly: true, 'aria-label': 'Valorant code for this crosshair' });
  const status = h('p', { class: 'hint', role: 'status' }, 'Paste a code from Valorant (Settings → Crosshair → Profile → Import/Export).');
  const say = (message, isError = false) => {
    status.textContent = message;
    status.classList.toggle('is-error', isError);
  };

  const doImport = () => {
    try {
      store.set('crosshair', parseCrosshairCode(importInput.value));
      say('Crosshair imported. Tracklock uses your primary crosshair without movement or firing error.');
    } catch (error) {
      if (!(error instanceof CrosshairCodeError)) throw error;
      say(error.message, true);
    }
  };
  importInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') doImport();
  });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exportInput.value);
      say('Code copied. In Valorant: Settings → Crosshair → Import Profile Code.');
    } catch {
      exportInput.select();
      say('Your browser blocked clipboard access. The code is selected, press Ctrl+C (⌘C) to copy it.');
    }
  };

  const el = h(
    'fieldset',
    { class: 'setting-group' },
    h('legend', {}, 'Valorant crosshair code'),
    h(
      'div',
      { class: 'code-row' },
      h('span', { class: 'code-label', 'aria-hidden': 'true' }, 'From Valorant'),
      importInput,
      h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: doImport }, 'Import'),
    ),
    h(
      'div',
      { class: 'code-row' },
      h('span', { class: 'code-label', 'aria-hidden': 'true' }, 'To Valorant'),
      exportInput,
      h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: copy }, 'Copy'),
    ),
    status,
  );
  return {
    el,
    sync(state) {
      exportInput.value = toCrosshairCode(state.crosshair);
    },
  };
}

// ------------------------------------------------------------------- tabs

const pct = (v) => `${Math.round(v * 100)}%`;
const px = (v) => `${v}px`;
const times = (v) => `${Number(v).toFixed(2)}×`;

function crosshairLines(prefix, title) {
  const on = (s) => s.crosshair[`${prefix}Lines`];
  return (store) =>
    groupField(title, [
      toggleField(store, { path: `crosshair.${prefix}Lines`, label: `Show ${title.toLowerCase()}` }),
      rangeField(store, { path: `crosshair.${prefix}Opacity`, label: 'Opacity', min: 0, max: 1, step: 0.05, format: pct, enabledWhen: on }),
      rangeField(store, { path: `crosshair.${prefix}Length`, label: 'Length', min: 0, max: 20, step: 1, format: px, enabledWhen: on }),
      rangeField(store, { path: `crosshair.${prefix}Thickness`, label: 'Thickness', min: 1, max: 10, step: 1, format: px, enabledWhen: on }),
      rangeField(store, { path: `crosshair.${prefix}Offset`, label: 'Offset', min: 0, max: prefix === 'inner' ? 20 : 40, step: 1, format: px, enabledWhen: on }),
    ]);
}

function buildTabs(store) {
  return [
    {
      id: 'sensitivity',
      label: 'Sensitivity',
      fields: () => [
        staticField(h('div', { class: 'setting-block' }, createSensitivityControl(store).root)),
        converterBlock(store),
        toggleField(store, {
          path: 'rawInput',
          label: 'Raw input',
          help: 'Reads unadjusted mouse counts (Chrome and Edge on Windows and macOS), so OS pointer speed and acceleration are ignored, as in Valorant.',
        }),
        toggleField(store, { path: 'invertY', label: 'Invert vertical look' }),
        numberField(store, {
          path: 'inputMultiplier',
          label: 'Input multiplier',
          min: 0.01,
          max: 10,
          step: 0.0001,
          help: 'Leave at 1. Change it only if the sensitivity check shows your browser scaling mouse movement.',
        }),
        rangeField(store, {
          path: 'fov',
          label: 'Horizontal field of view',
          min: 60,
          max: 130,
          step: 1,
          format: (v) => `${v}°${v === 103 ? ' (Valorant)' : ''}`,
          help: 'Valorant uses 103°. Changing FOV changes how big targets look, not your cm/360.',
        }),
      ],
    },
    {
      id: 'crosshair',
      label: 'Crosshair',
      fields: () => [
        crosshairPreview(),
        crosshairCodeBlock(store),
        colorField(store, { path: 'crosshair.color', label: 'Color', presets: CROSSHAIR_COLORS }),
        groupField('Outlines', [
          toggleField(store, { path: 'crosshair.outline', label: 'Show outlines' }),
          rangeField(store, { path: 'crosshair.outlineOpacity', label: 'Opacity', min: 0, max: 1, step: 0.05, format: pct, enabledWhen: (s) => s.crosshair.outline }),
          rangeField(store, { path: 'crosshair.outlineThickness', label: 'Thickness', min: 1, max: 6, step: 1, format: px, enabledWhen: (s) => s.crosshair.outline }),
        ]),
        groupField('Center dot', [
          toggleField(store, { path: 'crosshair.centerDot', label: 'Show center dot' }),
          rangeField(store, { path: 'crosshair.centerDotOpacity', label: 'Opacity', min: 0, max: 1, step: 0.05, format: pct, enabledWhen: (s) => s.crosshair.centerDot }),
          rangeField(store, { path: 'crosshair.centerDotThickness', label: 'Thickness', min: 1, max: 10, step: 1, format: px, enabledWhen: (s) => s.crosshair.centerDot }),
        ]),
        crosshairLines('inner', 'Inner lines')(store),
        crosshairLines('outer', 'Outer lines')(store),
        staticField(
          h(
            'div',
            { class: 'setting-actions' },
            h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => store.set('crosshair', { ...DEFAULT_CROSSHAIR }) }, 'Reset crosshair'),
          ),
        ),
      ],
    },
    {
      id: 'gameplay',
      label: 'Gameplay',
      fields: () => [
        segmentedField(store, {
          path: 'fireMode',
          label: 'Fire mode',
          help: 'Always firing measures pure tracking. Hold mode only counts time while the left mouse button is held.',
          options: [
            { value: 'auto', label: 'Always firing' },
            { value: 'hold', label: 'Hold left mouse' },
          ],
        }),
        toggleField(store, { path: 'countdown', label: '3-second countdown', help: 'Gives you time to find the target before scoring starts.' }),
        colorField(store, { path: 'targetColor', label: 'Target color', presets: TARGET_COLORS }),
        toggleField(store, { path: 'hitFeedback', label: 'Glow while on target' }),
        groupField('Custom difficulty', [
          staticField(h('p', { class: 'hint' }, 'Used when you pick “Custom” in the launch panel.')),
          rangeField(store, { path: 'customSpeed', label: 'Target speed', min: 0.25, max: 3, step: 0.05, format: times }),
          rangeField(store, { path: 'customSize', label: 'Target size', min: 0.25, max: 3, step: 0.05, format: times }),
        ]),
      ],
    },
    {
      id: 'video-audio',
      label: 'Video & audio',
      fields: () => [
        rangeField(store, {
          path: 'renderScale',
          label: 'Render scale',
          min: 0.5,
          max: 1.5,
          step: 0.05,
          format: pct,
          help: 'Lower it if your frame rate drops below your monitor’s refresh rate.',
        }),
        toggleField(store, { path: 'showFps', label: 'Show FPS counter' }),
        toggleField(store, {
          path: 'fullscreen',
          label: 'Fullscreen while playing',
          help: 'Switches to fullscreen when a run starts and back when you return to the menu.',
        }),
        rangeField(store, { path: 'volume', label: 'Volume', min: 0, max: 1, step: 0.05, format: pct }),
        toggleField(store, { path: 'hitSounds', label: 'Hit sounds', help: 'Soft ticks at rifle fire rate while you are on target.' }),
        toggleField(store, { path: 'uiSounds', label: 'Countdown and finish sounds' }),
      ],
    },
  ];
}

/** Wire the settings <dialog>: tabs, controls and reset. */
export function createSettingsPanel({ dialog, store, onClose, confirmReset }) {
  const tabList = dialog.querySelector('#settings-tabs');
  const panelHost = dialog.querySelector('#settings-panels');
  const tabs = buildTabs(store);
  const fields = [];
  const tabButtons = [];
  const panels = [];

  tabs.forEach((tab, index) => {
    const tabId = `tab-${tab.id}`;
    const panelId = `panel-${tab.id}`;
    const button = h(
      'button',
      { type: 'button', role: 'tab', id: tabId, 'aria-controls': panelId, class: 'tab', dataset: { index } },
      tab.label,
    );
    const panel = h('div', { role: 'tabpanel', id: panelId, 'aria-labelledby': tabId, class: 'tab-panel', tabindex: 0 });
    const tabFields = tab.fields();
    panel.append(...tabFields.map((f) => f.el));
    fields.push(...tabFields);
    tabButtons.push(button);
    panels.push(panel);
    button.addEventListener('click', () => select(index));
  });
  tabList.append(...tabButtons);
  panelHost.append(...panels);

  tabList.addEventListener('keydown', (event) => {
    const current = tabButtons.indexOf(document.activeElement);
    if (current === -1) return;
    let next = null;
    if (event.key === 'ArrowRight') next = (current + 1) % tabButtons.length;
    if (event.key === 'ArrowLeft') next = (current - 1 + tabButtons.length) % tabButtons.length;
    if (next === null) return;
    event.preventDefault();
    select(next);
    tabButtons[next].focus();
  });

  function select(index) {
    tabButtons.forEach((button, i) => {
      button.setAttribute('aria-selected', String(i === index));
      button.tabIndex = i === index ? 0 : -1;
      panels[i].hidden = i !== index;
    });
    // The crosshair preview measures its canvas, so redraw once it is visible.
    requestAnimationFrame(() => sync(store.get()));
  }

  function sync(state) {
    for (const field of fields) field.sync(state);
  }

  store.subscribe(sync);
  select(0);

  for (const close of $$('[data-close]', dialog)) close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    store.flush();
    onClose?.();
  });
  dialog.querySelector('#reset-settings').addEventListener('click', () => {
    if (!confirmReset()) return;
    const { scenario, difficulty, duration } = store.get();
    store.replace({ ...DEFAULT_SETTINGS, scenario, difficulty, duration });
  });

  return {
    open(tabId) {
      const index = tabs.findIndex((t) => t.id === tabId);
      if (index >= 0) select(index);
      if (!dialog.open) dialog.showModal();
      sync(store.get());
    },
    close: () => dialog.close(),
    get isOpen() {
      return dialog.open;
    },
  };
}
