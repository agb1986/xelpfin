import type { Backend } from '../backend/Backend';
import type { MediaItem } from '../backend/types';
import { useLocalList } from './localLists';
import { mapLimit, SERVER_CONCURRENCY } from './mapLimit';

/**
 * The Randomizer list: series chosen by the user, and the episodes already drawn in the current
 * cycle. Drawing never repeats an episode until every episode of the list has been drawn.
 */
export interface RandomizerState {
  series: string[];
  /** Episode ids drawn in the current cycle, in order. */
  played: string[];
  /** Every episode drawn, oldest first, kept across cycles so Settings can list recent picks. */
  history: string[];
}

export const HISTORY_LIMIT = 100;

export const emptyRandomizer = (): RandomizerState => ({ series: [], played: [], history: [] });

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export function sanitizeRandomizer(raw: unknown): RandomizerState {
  if (!raw || typeof raw !== 'object') {
    return emptyRandomizer();
  }
  const r = raw as Record<string, unknown>;
  return { series: [...new Set(strings(r.series))], played: [...new Set(strings(r.played))], history: strings(r.history).slice(-HISTORY_LIMIT) };
}

export function toggleSeries(state: RandomizerState, seriesId: string): RandomizerState {
  return state.series.includes(seriesId)
    ? { ...state, series: state.series.filter(s => s !== seriesId) }
    : { ...state, series: [...state.series, seriesId] };
}

export interface Draw {
  episode: MediaItem;
  state: RandomizerState;
}

/**
 * Picks the next episode from `pool` (every episode of every listed series).
 *
 * - Only episodes not yet drawn this cycle are candidates.
 * - When none are left a new cycle starts: the drawn list is emptied, and the episode drawn last
 *   is left out of the first pick of the new cycle so it never plays twice in a row.
 * - When another series is available, the series that just played is skipped, so the same
 *   show does not come up back to back.
 * `rng` returns a number in [0, 1).
 */
export function drawEpisode(state: RandomizerState, pool: MediaItem[], rng: () => number, previous?: MediaItem): Draw | undefined {
  if (!pool.length) {
    return undefined;
  }
  const inPool = new Set(pool.map(e => e.id));
  // Ids of episodes that left the server (or series that left the list) must not pile up.
  let played = state.played.filter(id => inPool.has(id));
  let candidates = pool.filter(e => !played.includes(e.id));
  if (!candidates.length) {
    played = [];
    candidates = pool.length > 1 ? pool.filter(e => e.id !== previous?.id) : pool;
  }
  const otherSeries = previous?.seriesId ? candidates.filter(e => e.seriesId !== previous.seriesId) : [];
  if (otherSeries.length) {
    candidates = otherSeries;
  }
  const episode = candidates[Math.min(candidates.length - 1, Math.floor(rng() * candidates.length))];
  return { episode, state: { ...state, played: [...played, episode.id], history: [...state.history, episode.id].slice(-HISTORY_LIMIT) } };
}

/** All episodes of the listed series; series that fail to load are skipped. */
export async function loadPool(backend: Backend, seriesIds: string[]): Promise<MediaItem[]> {
  const lists = await mapLimit(seriesIds, SERVER_CONCURRENCY, id => backend.episodes(id).catch(() => [] as MediaItem[]));
  return lists.flat().filter(e => e.kind === 'episode');
}

/** The last `count` drawn episode ids, newest first. */
export const recentDraws = (state: RandomizerState, count: number): string[] => state.history.slice(-count).reverse();

/** Resolves ids to items in order; ids the server no longer has are dropped. */
export async function loadHistory(backend: Backend, ids: string[]): Promise<MediaItem[]> {
  const items = await mapLimit(ids, SERVER_CONCURRENCY, id => backend.item(id).catch(() => undefined));
  return items.filter((i): i is NonNullable<typeof i> => !!i);
}

export function useRandomizer() {
  const { value, list } = useLocalList('randomizer', emptyRandomizer, sanitizeRandomizer);
  return { state: value, list };
}
