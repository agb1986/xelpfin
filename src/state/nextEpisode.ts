import type { Backend } from '../backend/Backend';
import type { MediaItem } from '../backend/types';

/** The episode after `currentId` in series order, or undefined at the end (or if not found). */
export function episodeAfter(episodes: MediaItem[], currentId: string): MediaItem | undefined {
  const at = episodes.findIndex(e => e.id === currentId);
  return at < 0 ? undefined : episodes[at + 1];
}

/**
 * Finds the episode to autoplay after `current`. Uses the series' episode list, which is
 * deterministic, rather than the server's Next Up (which depends on watch state that the
 * stop report may not have updated yet). Falls back to Next Up when the list has no answer.
 */
export async function findNextEpisode(backend: Backend, current: { id: string; seriesId?: string }): Promise<MediaItem | undefined> {
  if (!current.seriesId) {
    return undefined;
  }
  const list = await backend.episodes(current.seriesId).catch(() => [] as MediaItem[]);
  if (list.some(e => e.id === current.id)) {
    return episodeAfter(list, current.id);
  }
  const next = (await backend.nextUp(1, current.seriesId).catch(() => [] as MediaItem[]))[0];
  return next && next.id !== current.id ? next : undefined;
}
