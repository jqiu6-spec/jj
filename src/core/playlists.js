// Playlists: ordered drills played back to back with a combined score.
// Built-in playlists ship with the app; custom ones live in localStorage.

import { DURATIONS } from './settings.js';
import { SCENARIOS } from '../game/scenarios.js';

export const PLAYLISTS_KEY = 'tracklock.playlists.v1';
export const PLAYLIST_BESTS_KEY = 'tracklock.playlistBests.v1';
export const PLAYLIST_DIFFICULTIES = ['easy', 'normal', 'hard', 'insane'];
export const MAX_PLAYLIST_ITEMS = 12;

const item = (scenario, difficulty = 'normal', duration = 60) => ({ scenario, difficulty, duration });

export const BUILTIN_PLAYLISTS = [
  {
    id: 'warmup',
    name: 'Tracking Warm-up',
    description: 'Ease in: slow sweeps, then a smooth orb, then the strafe bot.',
    items: [item('cinematic', 'easy'), item('smooth', 'normal'), item('strafe', 'normal')],
  },
  {
    id: 'balls',
    name: 'Ball Tracking',
    description: 'Every orb drill in one sitting, Aim Lab style.',
    items: [item('smooth'), item('sphere'), item('reactive'), item('speedtrack'), item('air'), item('orbit')],
  },
  {
    id: 'valorant',
    name: 'Valorant Duel Prep',
    description: 'Strafe bots at rising difficulty with close-range control in between.',
    items: [item('strafe', 'normal'), item('micro', 'normal'), item('strafe', 'hard'), item('reactive', 'normal'), item('strafe', 'insane', 30)],
  },
  {
    id: 'precision',
    name: 'Precision & Smoothness',
    description: 'Long, calm runs that punish overshooting.',
    items: [item('cinematic', 'normal', 90), item('smooth', 'hard', 90), item('micro', 'normal', 60)],
  },
  {
    id: 'everything',
    name: 'All Drills',
    description: 'One minute of every scenario.',
    items: SCENARIOS.map((s) => item(s.id)),
  },
];

const scenarioIds = new Set(SCENARIOS.map((s) => s.id));

export function sanitizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!scenarioIds.has(raw.scenario)) return null;
  const duration = Number(raw.duration);
  return {
    scenario: raw.scenario,
    difficulty: PLAYLIST_DIFFICULTIES.includes(raw.difficulty) ? raw.difficulty : 'normal',
    duration: DURATIONS.includes(duration) ? duration : 60,
  };
}

/** Returns a clean playlist or null when it cannot be played. */
export function sanitizePlaylist(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const items = (Array.isArray(raw.items) ? raw.items : []).map(sanitizeItem).filter(Boolean).slice(0, MAX_PLAYLIST_ITEMS);
  if (items.length === 0) return null;
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 40) : '';
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newPlaylistId(),
    name: name || 'Untitled playlist',
    description: typeof raw.description === 'string' ? raw.description.slice(0, 140) : '',
    items,
  };
}

export function newPlaylistId() {
  return `pl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function playlistDuration(playlist) {
  return playlist.items.reduce((sum, i) => sum + i.duration, 0);
}

export function isBuiltin(id) {
  return BUILTIN_PLAYLISTS.some((p) => p.id === id);
}

export function findPlaylist(custom, id) {
  return BUILTIN_PLAYLISTS.find((p) => p.id === id) ?? custom.find((p) => p.id === id) ?? null;
}

export function loadPlaylists(storage) {
  const list = storage.getJSON(PLAYLISTS_KEY, []);
  return Array.isArray(list) ? list.map(sanitizePlaylist).filter(Boolean) : [];
}

export function savePlaylists(storage, list) {
  storage.setJSON(PLAYLISTS_KEY, list);
  return list;
}

/** Insert or replace a custom playlist by id. */
export function upsertPlaylist(list, playlist) {
  const index = list.findIndex((p) => p.id === playlist.id);
  if (index === -1) return [...list, playlist];
  return list.map((p, i) => (i === index ? playlist : p));
}

export function loadPlaylistBests(storage) {
  const stored = storage.getJSON(PLAYLIST_BESTS_KEY, {});
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
  return Object.fromEntries(Object.entries(stored).filter(([, v]) => v && Number.isFinite(v.score)));
}

/** Store a finished playlist's total; bests are keyed by playlist id and the item list, so edits start fresh. */
export function playlistBestKey(playlist) {
  return `${playlist.id}|${playlist.items.map((i) => `${i.scenario}:${i.difficulty}:${i.duration}`).join(',')}`;
}

export function recordPlaylistResult(storage, bests, playlist, score) {
  const key = playlistBestKey(playlist);
  const previousBest = bests[key] ?? null;
  const isBest = !previousBest || score > previousBest.score;
  const next = isBest ? { ...bests, [key]: { score, date: new Date().toISOString() } } : bests;
  if (isBest) storage.setJSON(PLAYLIST_BESTS_KEY, next);
  return { bests: next, previousBest, isBest };
}
