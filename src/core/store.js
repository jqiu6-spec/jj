import { sanitizeSettings, saveSettings, setPath } from './settings.js';

/**
 * Observable settings. Every write is sanitized, so listeners always receive
 * a valid settings object, and persisted shortly after the last change.
 */
export function createSettingsStore(initial, storage, saveDelay = 250) {
  let state = sanitizeSettings(initial);
  const listeners = new Set();
  let saveTimer = null;

  const commit = (next, path) => {
    state = sanitizeSettings(next);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveSettings(storage, state), saveDelay);
    for (const listener of listeners) listener(state, path);
  };

  return {
    get: () => state,
    set: (path, value) => commit(setPath(state, path, value), path),
    replace: (next) => commit(next, '*'),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    flush() {
      clearTimeout(saveTimer);
      saveSettings(storage, state);
    },
  };
}
