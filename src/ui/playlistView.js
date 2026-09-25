// Playlist cards on the Play page and the playlist editor dialog.

import {
  BUILTIN_PLAYLISTS,
  isBuiltin,
  MAX_PLAYLIST_ITEMS,
  newPlaylistId,
  PLAYLIST_DIFFICULTIES,
  playlistBestKey,
  playlistDuration,
  sanitizePlaylist,
} from '../core/playlists.js';
import { DURATIONS } from '../core/settings.js';
import { DIFFICULTIES, getScenario, SCENARIOS } from '../game/scenarios.js';
import { $, h } from './dom.js';
import { formatDuration, formatInt } from './format.js';

export function createPlaylistView({ host, dialog, getPlaylists, getBests, onPlay, onSave, onDelete }) {
  const form = $('#playlist-form', dialog);
  const nameInput = $('#playlist-name', dialog);
  const rowsHost = $('#playlist-rows', dialog);
  const totalHint = $('#playlist-total', dialog);
  const title = $('#playlist-dialog-title', dialog);
  let editing = null; // { id, items: [...] }

  // ------------------------------------------------------------------ cards

  function card(playlist) {
    const custom = !isBuiltin(playlist.id);
    const best = getBests()[playlistBestKey(playlist)];
    const chips = playlist.items.map((item) =>
      h('span', { class: 'playlist-chip' }, `${getScenario(item.scenario).name} · ${DIFFICULTIES[item.difficulty]?.label ?? item.difficulty} · ${item.duration}s`),
    );
    const deleteButton = h('button', { type: 'button', class: 'btn btn-danger-ghost btn-sm' }, 'Delete');
    let armed = false;
    let disarm = null;
    deleteButton.addEventListener('click', () => {
      // Two clicks to delete: dialogs are not available everywhere the page runs.
      if (!armed) {
        armed = true;
        deleteButton.textContent = 'Confirm delete';
        disarm = setTimeout(() => {
          armed = false;
          deleteButton.textContent = 'Delete';
        }, 4000);
        return;
      }
      clearTimeout(disarm);
      onDelete(playlist.id);
    });
    return h(
      'article',
      { class: `playlist-card${custom ? ' is-custom' : ''}` },
      h('div', { class: 'playlist-top' }, h('span', { class: 'playlist-name' }, playlist.name), h('span', { class: 'tag' }, custom ? 'Custom' : 'Preset')),
      playlist.description ? h('p', { class: 'playlist-desc' }, playlist.description) : null,
      h('div', { class: 'playlist-items' }, chips),
      h(
        'div',
        { class: 'playlist-meta' },
        h('span', {}, `${playlist.items.length} drill${playlist.items.length === 1 ? '' : 's'}`),
        h('span', {}, formatDuration(playlistDuration(playlist))),
        h('span', { class: best ? 'has-best' : '' }, best ? `Best ${formatInt(best.score)}` : 'No best yet'),
      ),
      h(
        'div',
        { class: 'playlist-actions' },
        h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => onPlay(playlist) }, 'Play'),
        custom
          ? h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => openEditor(playlist) }, 'Edit')
          : h(
              'button',
              {
                type: 'button',
                class: 'btn btn-secondary btn-sm',
                onclick: () => openEditor({ ...playlist, id: newPlaylistId(), name: `${playlist.name} (copy)`, description: '' }),
              },
              'Copy & edit',
            ),
        custom ? deleteButton : null,
      ),
    );
  }

  function render() {
    host.replaceChildren(...BUILTIN_PLAYLISTS.map(card), ...getPlaylists().map(card));
  }

  // ----------------------------------------------------------------- editor

  const select = (options, value, onChange) => {
    const el = h('select', { class: 'input' }, options.map((o) => h('option', { value: o.value }, o.label)));
    el.value = value;
    el.addEventListener('change', () => onChange(el.value));
    return el;
  };

  function renderRows() {
    const rows = editing.items.map((item, index) =>
      h(
        'div',
        { class: 'playlist-row' },
        h('span', { class: 'row-index' }, String(index + 1)),
        select(
          SCENARIOS.map((s) => ({ value: s.id, label: s.name })),
          item.scenario,
          (value) => (item.scenario = value),
        ),
        select(
          PLAYLIST_DIFFICULTIES.map((d) => ({ value: d, label: DIFFICULTIES[d].label })),
          item.difficulty,
          (value) => (item.difficulty = value),
        ),
        select(
          DURATIONS.map((d) => ({ value: String(d), label: `${d} s` })),
          String(item.duration),
          (value) => {
            item.duration = Number(value);
            updateTotal();
          },
        ),
        h(
          'div',
          { class: 'row-tools' },
          h('button', { type: 'button', class: 'btn btn-ghost', 'aria-label': 'Move up', disabled: index === 0, onclick: () => move(index, -1) }, '↑'),
          h('button', { type: 'button', class: 'btn btn-ghost', 'aria-label': 'Move down', disabled: index === editing.items.length - 1, onclick: () => move(index, 1) }, '↓'),
          h('button', { type: 'button', class: 'btn btn-ghost', 'aria-label': 'Remove', disabled: editing.items.length === 1, onclick: () => remove(index) }, '✕'),
        ),
      ),
    );
    rowsHost.replaceChildren(...rows);
    $('#playlist-add', dialog).disabled = editing.items.length >= MAX_PLAYLIST_ITEMS;
    updateTotal();
  }

  function updateTotal() {
    const total = editing.items.reduce((sum, i) => sum + i.duration, 0);
    totalHint.textContent = `${editing.items.length} of ${MAX_PLAYLIST_ITEMS} drills · ${formatDuration(total)} in total`;
  }

  function move(index, delta) {
    const items = editing.items;
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target], items[index]];
    renderRows();
  }

  function remove(index) {
    editing.items.splice(index, 1);
    renderRows();
  }

  function openEditor(playlist) {
    editing = playlist
      ? { id: playlist.id, name: playlist.name, description: playlist.description ?? '', items: playlist.items.map((i) => ({ ...i })) }
      : { id: newPlaylistId(), name: '', description: '', items: [{ scenario: 'smooth', difficulty: 'normal', duration: 60 }] };
    title.textContent = playlist && !isBuiltin(playlist.id) && getPlaylists().some((p) => p.id === playlist.id) ? 'Edit playlist' : 'New playlist';
    nameInput.value = editing.name;
    renderRows();
    if (!dialog.open) dialog.showModal();
    nameInput.focus();
  }

  $('#playlist-add', dialog).addEventListener('click', () => {
    if (editing.items.length >= MAX_PLAYLIST_ITEMS) return;
    const last = editing.items[editing.items.length - 1];
    editing.items.push({ ...last });
    renderRows();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const playlist = sanitizePlaylist({ ...editing, name: nameInput.value });
    if (!playlist) return;
    onSave(playlist);
    dialog.close();
  });
  for (const close of dialog.querySelectorAll('[data-close]')) close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  return { render, openEditor, get isOpen() { return dialog.open; } };
}
