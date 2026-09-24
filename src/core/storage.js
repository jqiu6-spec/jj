// localStorage can be missing or throw (private windows, blocked site data,
// sandboxed iframes). Every access goes through this wrapper so the trainer
// keeps working with in-memory state when persistence is unavailable.

function defaultBackend() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function createStorage(backend = defaultBackend()) {
  return {
    getJSON(key, fallback = null) {
      try {
        const raw = backend?.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    setJSON(key, value) {
      try {
        backend?.setItem(key, JSON.stringify(value));
        return Boolean(backend);
      } catch {
        return false;
      }
    },
    remove(key) {
      try {
        backend?.removeItem(key);
      } catch {
        // Nothing to do: storage is unavailable.
      }
    },
  };
}

/** Minimal in-memory Storage implementation, used by tests. */
export function createMemoryBackend() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}
