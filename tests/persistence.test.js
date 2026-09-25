import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, sanitizeSettings, setPath, getPath } from '../src/core/settings.js';
import { createMemoryBackend, createStorage } from '../src/core/storage.js';
import { clearStats, HISTORY_LIMIT, historyToCsv, loadBests, loadHistory, recordRun } from '../src/core/stats.js';
import { createSettingsStore } from '../src/core/store.js';

const run = (overrides = {}) => ({
  id: Math.random().toString(36),
  date: '2026-09-24T12:00:00.000Z',
  scenario: 'smooth',
  scenarioName: 'Smooth Tracking',
  difficulty: 'normal',
  difficultyLabel: 'Normal',
  duration: 60,
  score: 4000,
  accuracy: 0.66,
  timeOnTarget: 40,
  longestStreak: 3.2,
  avgRecovery: 0.3,
  headshotRate: null,
  sensitivity: 0.4,
  dpi: 800,
  fov: 103,
  fireMode: 'auto',
  timeline: [0.5, 0.7],
  ...overrides,
});

describe('settings', () => {
  it('fills in defaults and repairs invalid values', () => {
    const s = sanitizeSettings({
      sensitivity: 500,
      dpi: -5,
      fov: 'wide',
      fireMode: 'laser',
      duration: 45,
      targetColor: 'red',
      crosshair: { innerLength: 999, color: '#ABCDEF' },
    });
    expect(s.sensitivity).toBe(100);
    expect(s.dpi).toBe(1);
    expect(s.fov).toBe(DEFAULT_SETTINGS.fov);
    expect(s.fireMode).toBe('hold');
    expect(s.duration).toBe(60);
    expect(s.targetColor).toBe(DEFAULT_SETTINGS.targetColor);
    expect(s.crosshair.innerLength).toBe(30);
    expect(s.crosshair.color).toBe('#abcdef');
    expect(s.crosshair.outline).toBe(DEFAULT_SETTINGS.crosshair.outline);
  });

  it('migrates pre-version-2 settings to hold-to-fire but keeps a deliberate choice', () => {
    expect(sanitizeSettings({ fireMode: 'auto' }).fireMode).toBe('hold'); // saved before the change
    expect(sanitizeSettings({ fireMode: 'auto', version: 2 }).fireMode).toBe('auto');
    expect(sanitizeSettings({ fireMode: 'hold', version: 2 }).fireMode).toBe('hold');
    expect(sanitizeSettings({}).version).toBe(2);
  });

  it('keeps tiny and huge sensitivities within 0.0001–100', () => {
    expect(sanitizeSettings({ sensitivity: 0.00001 }).sensitivity).toBe(0.0001);
    expect(sanitizeSettings({ sensitivity: 0.0001 }).sensitivity).toBe(0.0001);
    expect(sanitizeSettings({ sensitivity: 100 }).sensitivity).toBe(100);
    expect(sanitizeSettings({ sensitivity: 0.31415 }).sensitivity).toBe(0.3142);
  });

  it('survives broken or missing storage', () => {
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {},
    };
    const storage = createStorage(throwing);
    expect(loadSettings(storage)).toEqual(sanitizeSettings({}));
    expect(storage.setJSON('x', 1)).toBe(false);
    expect(loadSettings(createStorage(null)).sensitivity).toBe(DEFAULT_SETTINGS.sensitivity);
    const backend = createMemoryBackend();
    backend.setItem('tracklock.settings.v1', '{not json');
    expect(loadSettings(createStorage(backend)).dpi).toBe(DEFAULT_SETTINGS.dpi);
  });

  it('reads and writes dotted paths immutably', () => {
    const original = { a: { b: 1, c: 2 } };
    const next = setPath(original, 'a.b', 5);
    expect(next.a).toEqual({ b: 5, c: 2 });
    expect(original.a.b).toBe(1);
    expect(getPath(next, 'a.c')).toBe(2);
  });

  it('store sanitizes, notifies and persists', () => {
    vi.useFakeTimers();
    const backend = createMemoryBackend();
    const storage = createStorage(backend);
    const store = createSettingsStore({}, storage);
    const seen = [];
    store.subscribe((state, path) => seen.push([path, state.sensitivity]));
    store.set('sensitivity', 1000);
    expect(store.get().sensitivity).toBe(100);
    expect(seen).toEqual([['sensitivity', 100]]);
    vi.runAllTimers();
    expect(JSON.parse(backend.getItem('tracklock.settings.v1')).sensitivity).toBe(100);
    vi.useRealTimers();
  });
});

describe('stats', () => {
  it('records runs and detects personal bests per scenario/difficulty/length', () => {
    const storage = createStorage(createMemoryBackend());
    let state = { history: [], bests: {} };

    let result = recordRun(storage, state, run({ score: 4000 }));
    expect(result.isPersonalBest).toBe(true);
    expect(result.previousBest).toBeNull();
    state = result;

    result = recordRun(storage, state, run({ score: 3500 }));
    expect(result.isPersonalBest).toBe(false);
    expect(result.previousBest.score).toBe(4000);
    state = result;

    result = recordRun(storage, state, run({ score: 100, duration: 30 }));
    expect(result.isPersonalBest).toBe(true);
    state = result;

    result = recordRun(storage, state, run({ score: 4200 }));
    expect(result.isPersonalBest).toBe(true);
    expect(result.previousBest.score).toBe(4000);

    const history = loadHistory(storage);
    expect(history).toHaveLength(4);
    const bests = loadBests(storage, history);
    expect(bests['smooth|normal|60'].score).toBe(4200);
    expect(bests['smooth|normal|60'].timeline).toBeUndefined();
  });

  it('caps history but keeps personal bests', () => {
    const storage = createStorage(createMemoryBackend());
    let state = { history: [], bests: {} };
    state = recordRun(storage, state, run({ score: 9999 }));
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) state = recordRun(storage, state, run({ score: 10 }));
    const history = loadHistory(storage);
    expect(history).toHaveLength(HISTORY_LIMIT);
    expect(history.some((r) => r.score === 9999)).toBe(false);
    expect(loadBests(storage, history)['smooth|normal|60'].score).toBe(9999);
  });

  it('ignores corrupt entries and can be cleared', () => {
    const backend = createMemoryBackend();
    backend.setItem('tracklock.history.v1', JSON.stringify([run(), { nope: true }, null, 'x']));
    const storage = createStorage(backend);
    expect(loadHistory(storage)).toHaveLength(1);
    expect(clearStats(storage)).toEqual({ history: [], bests: {} });
    expect(loadHistory(storage)).toHaveLength(0);
  });

  it('exports CSV with escaping', () => {
    const csv = historyToCsv([run({ scenarioName: 'Weird, "name"' })]);
    const [header, row] = csv.split('\n');
    expect(header.startsWith('date,scenario,difficulty')).toBe(true);
    expect(row).toContain('"Weird, ""name"""');
    expect(row).toContain('66.00');
  });
});
