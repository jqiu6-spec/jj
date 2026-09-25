// Settings → Skins: paint each weapon and watch it turn in a live preview.
// The 3D preview (three.js) loads on demand the first time the tab is shown.

import { DEFAULT_SKIN, FINISHES, matchingPreset, PATTERNS, SKIN_PRESETS, SKIN_SWATCHES } from '../core/skins.js';
import { getWeapon, WEAPONS } from '../core/weapons.js';
import { h } from './dom.js';
import { colorField, segmentedField, toggleField } from './fields.js';

export function skinEditor(store) {
  let weaponId = store.get().weapon;
  let fields = [];
  let preview = null;
  let previewPromise = null;
  let lastState = store.get();

  const canvas = h('canvas', { class: 'skin-preview', role: 'img', 'aria-label': 'Weapon skin preview' });
  const note = h('p', { class: 'hint skin-preview-note' }, 'Drag nothing: the gun turns by itself. Changes apply to the first-person weapon straight away.');
  const fieldHost = h('div');

  const weaponButtons = WEAPONS.map((w) =>
    h(
      'button',
      {
        type: 'button',
        role: 'radio',
        class: 'seg',
        dataset: { value: w.id },
        onclick: () => {
          weaponId = w.id;
          rebuildFields();
          sync(lastState);
        },
      },
      w.name,
    ),
  );
  const weaponPicker = h('div', { class: 'segmented skin-weapons', role: 'radiogroup', 'aria-label': 'Weapon to paint' }, weaponButtons);

  const presetChips = SKIN_PRESETS.map((preset) =>
    h(
      'button',
      {
        type: 'button',
        class: 'chip preset-chip',
        dataset: { value: preset.id },
        onclick: () => store.set(`skins.${weaponId}`, { ...preset.skin }),
      },
      h('span', { class: 'preset-dot', 'aria-hidden': 'true', style: { '--body': preset.skin.body, '--accent': preset.skin.accent } }),
      preset.name,
    ),
  );

  const applyAll = h(
    'button',
    {
      type: 'button',
      class: 'btn btn-secondary btn-sm',
      onclick: () => {
        const current = store.get().skins[weaponId];
        store.set('skins', Object.fromEntries(WEAPONS.map((w) => [w.id, { ...current }])));
      },
    },
    'Apply to all weapons',
  );
  const reset = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => store.set(`skins.${weaponId}`, { ...DEFAULT_SKIN }) }, 'Reset this skin');

  const el = h(
    'div',
    { class: 'skin-editor' },
    canvas,
    note,
    weaponPicker,
    h('span', { class: 'label' }, 'Presets'),
    h('div', { class: 'skin-presets' }, presetChips),
    fieldHost,
    h('div', { class: 'skin-actions' }, applyAll, reset),
  );

  const swatches = (list) => list.map((value) => ({ name: value, value }));

  function rebuildFields() {
    const base = `skins.${weaponId}`;
    fields = [
      colorField(store, { path: `${base}.body`, label: 'Body colour', presets: swatches(SKIN_SWATCHES.body) }),
      colorField(store, { path: `${base}.accent`, label: 'Accent colour', presets: swatches(SKIN_SWATCHES.accent) }),
      colorField(store, { path: `${base}.grip`, label: 'Grip and stock', presets: swatches(SKIN_SWATCHES.grip) }),
      segmentedField(store, {
        path: `${base}.finish`,
        label: 'Finish',
        options: Object.entries(FINISHES).map(([value, f]) => ({ value, label: f.label })),
      }),
      segmentedField(store, {
        path: `${base}.pattern`,
        label: 'Pattern',
        options: Object.entries(PATTERNS).map(([value, p]) => ({ value, label: p.label })),
      }),
      toggleField(store, { path: `${base}.glow`, label: 'Accent glow', help: 'Lights the accent panels like a Valorant skin.' }),
    ];
    fieldHost.replaceChildren(...fields.map((f) => f.el));
  }

  function ensurePreview() {
    previewPromise ??= import('../game/viewmodel.js')
      .then((module) => {
        preview = module.createGunPreview(canvas);
        return preview;
      })
      .catch((error) => {
        console.error(error);
        note.textContent = 'The live preview needs WebGL, which this browser could not start. Your skin still applies in game.';
        return null;
      });
    return previewPromise;
  }

  function visible() {
    if (!el.isConnected || el.closest('[hidden]')) return false;
    const dialog = el.closest('dialog');
    return dialog ? dialog.open : true;
  }

  function sync(state) {
    lastState = state;
    for (const button of weaponButtons) button.setAttribute('aria-checked', String(button.dataset.value === weaponId));
    const skin = state.skins?.[weaponId] ?? DEFAULT_SKIN;
    const match = matchingPreset(skin);
    for (const chip of presetChips) chip.setAttribute('aria-pressed', String(chip.dataset.value === match));
    for (const field of fields) field.sync(state);
    if (visible()) {
      ensurePreview().then((p) => {
        if (!p || !visible()) return;
        p.setVisible(true);
        p.setGun(getWeapon(weaponId), state.skins?.[weaponId] ?? DEFAULT_SKIN);
      });
    } else {
      preview?.setVisible(false);
    }
  }

  rebuildFields();
  return { el, sync };
}
