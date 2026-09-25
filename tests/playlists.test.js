import { describe, expect, it } from 'vitest';
import {
  BUILTIN_PLAYLISTS,
  findPlaylist,
  isBuiltin,
  loadPlaylistBests,
  loadPlaylists,
  MAX_PLAYLIST_ITEMS,
  playlistDuration,
  recordPlaylistResult,
  sanitizePlaylist,
  savePlaylists,
  upsertPlaylist,
} from '../src/core/playlists.js';
import { createMemoryBackend, createStorage } from '../src/core/storage.js';
import { createRng } from '../src/core/random.js';
import { getScenario, SCENARIOS } from '../src/game/scenarios.js';

describe('playlists', () => {
  it('ships valid built-in playlists over real scenarios', () => {
    const ids = new Set(SCENARIOS.map((s) => s.id));
    for (const playlist of BUILTIN_PLAYLISTS) {
      expect(sanitizePlaylist(playlist)).toEqual(playlist);
      for (const item of playlist.items) expect(ids.has(item.scenario)).toBe(true);
      expect(playlistDuration(playlist)).toBeGreaterThan(0);
    }
    expect(BUILTIN_PLAYLISTS.find((p) => p.id === 'balls').items.every((i) => getScenario(i.scenario).id === i.scenario)).toBe(true);
  });

  it('repairs custom playlists and rejects empty ones', () => {
    const cleaned = sanitizePlaylist({
      name: '  My list  ',
      items: [
        { scenario: 'smooth', difficulty: 'ultra', duration: 45 },
        { scenario: 'nope' },
        { scenario: 'strafe', difficulty: 'hard', duration: 30 },
      ],
    });
    expect(cleaned.name).toBe('My list');
    expect(cleaned.id).toMatch(/^pl-/);
    expect(cleaned.items).toEqual([
      { scenario: 'smooth', difficulty: 'normal', duration: 60 },
      { scenario: 'strafe', difficulty: 'hard', duration: 30 },
    ]);
    expect(sanitizePlaylist({ name: 'x', items: [{ scenario: 'nope' }] })).toBeNull();
    expect(sanitizePlaylist(null)).toBeNull();
    const many = sanitizePlaylist({ name: 'big', items: Array.from({ length: 30 }, () => ({ scenario: 'smooth' })) });
    expect(many.items).toHaveLength(MAX_PLAYLIST_ITEMS);
  });

  it('persists custom playlists and finds built-ins by id', () => {
    const storage = createStorage(createMemoryBackend());
    let list = loadPlaylists(storage);
    expect(list).toEqual([]);
    const mine = sanitizePlaylist({ name: 'Mine', items: [{ scenario: 'sphere' }] });
    list = savePlaylists(storage, upsertPlaylist(list, mine));
    expect(loadPlaylists(storage)).toEqual([mine]);
    const renamed = { ...mine, name: 'Renamed' };
    list = savePlaylists(storage, upsertPlaylist(list, renamed));
    expect(loadPlaylists(storage)).toEqual([renamed]);
    expect(findPlaylist(list, 'balls').name).toBe('Ball Tracking');
    expect(findPlaylist(list, mine.id).name).toBe('Renamed');
    expect(findPlaylist(list, 'missing')).toBeNull();
    expect(isBuiltin('balls')).toBe(true);
    expect(isBuiltin(mine.id)).toBe(false);
  });

  it('keeps playlist bests per item list', () => {
    const storage = createStorage(createMemoryBackend());
    const playlist = BUILTIN_PLAYLISTS[0];
    let bests = loadPlaylistBests(storage);
    let result = recordPlaylistResult(storage, bests, playlist, 5000);
    expect(result.isBest).toBe(true);
    expect(result.previousBest).toBeNull();
    bests = result.bests;
    result = recordPlaylistResult(storage, bests, playlist, 4000);
    expect(result.isBest).toBe(false);
    expect(result.previousBest.score).toBe(5000);
    expect(loadPlaylistBests(storage)).toEqual(bests);
    // Editing the items starts a fresh record.
    const edited = { ...playlist, items: [...playlist.items, { scenario: 'orbit', difficulty: 'normal', duration: 30 }] };
    expect(recordPlaylistResult(storage, bests, edited, 100).isBest).toBe(true);
  });
});

describe('ball tracking drills', () => {
  for (const id of ['sphere', 'cinematic', 'speedtrack']) {
    it(`${id} keeps its ball in bounds and moving`, () => {
      const instance = getScenario(id).create({ rng: createRng(5), speed: 1, size: 1 });
      const { target, bounds } = instance;
      let travelled = 0;
      let last = { ...target.position };
      for (let i = 0; i < 120 * 60; i++) {
        instance.update(1 / 120);
        const p = target.position;
        for (const axis of ['x', 'y', 'z']) {
          expect(p[axis]).toBeGreaterThanOrEqual(bounds.min[axis] - 1e-6);
          expect(p[axis]).toBeLessThanOrEqual(bounds.max[axis] + 1e-6);
        }
        travelled += Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z);
        last = { ...p };
      }
      expect(travelled).toBeGreaterThan(30);
      expect(target.position.y - target.radius).toBeGreaterThan(0);
    });
  }

  it('speedtrack stays at eye height and cinematic stays smooth', () => {
    const speed = getScenario('speedtrack').create({ rng: createRng(9), speed: 1, size: 1 });
    const y = speed.target.position.y;
    for (let i = 0; i < 600; i++) speed.update(1 / 60);
    expect(speed.target.position.y).toBe(y);

    const cine = getScenario('cinematic').create({ rng: createRng(3), speed: 1, size: 1 });
    let maxStep = 0;
    let last = { ...cine.target.position };
    for (let i = 0; i < 600; i++) {
      cine.update(1 / 60);
      const p = cine.target.position;
      maxStep = Math.max(maxStep, Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z));
      last = { ...p };
    }
    expect(maxStep).toBeLessThan(0.12); // under 7 m/s at 60 fps
  });
});
