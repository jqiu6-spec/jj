// Generic settings controls. Each builder returns { el, sync(state) } so a
// panel can refresh every control whenever the settings store changes.

import { getPath } from '../core/settings.js';
import { h, setText } from './dom.js';

let uid = 0;
const nextId = (prefix) => `${prefix}-${++uid}`;

// ------------------------------------------------------------ field builders
// Each builder returns { el, sync(state) } so the panel can refresh every
// control when settings change anywhere (another panel, a reset, ...).

export function fieldWrap(label, control, { help, forId } = {}) {
  return h(
    'div',
    { class: 'setting' },
    h('div', { class: 'setting-text' }, h('label', { class: 'setting-label', for: forId }, label), help && h('p', { class: 'hint' }, help)),
    h('div', { class: 'setting-control' }, control),
  );
}

export function toggleField(store, { path, label, help, enabledWhen }) {
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

export function rangeField(store, { path, label, min, max, step, format = String, help, enabledWhen }) {
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

export function numberField(store, { path, label, min, max, step, help, decimals = 4 }) {
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

export function segmentedField(store, { path, label, options, help }) {
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

export function colorField(store, { path, label, presets, help }) {
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

export function groupField(title, fields) {
  return {
    el: h('fieldset', { class: 'setting-group' }, h('legend', {}, title), fields.map((f) => f.el)),
    sync(state) {
      for (const field of fields) field.sync(state);
    },
  };
}

export function setEnabled(el, enabled) {
  el.classList.toggle('is-disabled', !enabled);
  for (const control of el.querySelectorAll('input, button, select')) control.disabled = !enabled;
}

export function staticField(el) {
  return { el, sync() {} };
}

