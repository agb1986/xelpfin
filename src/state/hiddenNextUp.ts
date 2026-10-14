import type { MediaItem } from '../backend/types';
import { useLocalList } from './localLists';

/** Next Up entries the user cleared: series id to the episode that was offered. */
export type HiddenNextUp = Record<string, string>;

export function sanitizeHidden(raw: unknown): HiddenNextUp {
  const out: HiddenNextUp = {};
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'string') {
        out[k] = v;
      }
    }
  }
  return out;
}

/**
 * Leaves out the entries that were cleared. An entry comes back by itself once the series
 * offers a different episode, that is, after something in it has been watched.
 */
export function withoutHidden(items: MediaItem[], hidden: HiddenNextUp): MediaItem[] {
  return items.filter(i => !(i.seriesId && hidden[i.seriesId] === i.id));
}

export function useHiddenNextUp() {
  const { value, list } = useLocalList<HiddenNextUp>('hidden-next-up', () => ({}), sanitizeHidden);
  return { hidden: value, list };
}
