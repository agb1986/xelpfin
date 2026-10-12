import type { MediaItem } from '../../backend/types';
import type { Navigation } from '../../state/navigation';

/** Where selecting a card goes: playable items with progress resume, everything else opens detail. */
export function openItem(nav: Navigation, item: MediaItem, opts: { resume?: boolean } = {}) {
  if (opts.resume && (item.kind === 'movie' || item.kind === 'episode' || item.kind === 'video')) {
    nav.push({ name: 'player', itemId: item.id, startPositionMs: item.userData?.playbackPositionMs ?? 0 });
    return;
  }
  nav.push({ name: 'detail', itemId: item.id });
}
