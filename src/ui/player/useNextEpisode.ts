import { useCallback, useEffect, useRef, useState } from 'react';
import type { ItemDetail, MediaItem } from '../../backend/types';
import { useApp, useBackend } from '../../state/AppState';
import { useNavigation } from '../../state/navigation';
import { findNextEpisode } from '../../state/nextEpisode';
import { drawEpisode, loadPool, useRandomizer } from '../../state/randomizer';

/**
 * What plays after this item: the episodes before and after it in its series, the next
 * Randomizer draw in shuffle mode, and where the player goes when the item ends.
 */
export function useNextEpisode(item: ItemDetail | undefined, shuffle: boolean) {
  const backend = useBackend();
  const { settings } = useApp();
  const nav = useNavigation();
  const randomizer = useRandomizer();
  const [upcoming, setUpcoming] = useState<MediaItem[]>([]);
  const [previous, setPrevious] = useState<MediaItem>();
  // False once the screen unmounts: BACK during an async lookup already popped this screen, and
  // replacing it then would replace the page below it.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (item?.kind !== 'episode' || !item.seriesId || shuffle) {
      return;
    }
    let cancelled = false;
    backend
      .episodes(item.seriesId)
      .then(list => {
        const at = list.findIndex(e => e.id === item.id);
        if (!cancelled && at >= 0) {
          setUpcoming(list.slice(at + 1));
          setPrevious(list[at - 1]);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [backend, item, shuffle]);

  /** Draws the next Randomizer episode and records it as played in this cycle. */
  const randomEpisode = useCallback(async () => {
    const pool = await loadPool(backend, randomizer.list.get().series);
    let drawn: MediaItem | undefined;
    randomizer.list.update(s => {
      const d = drawEpisode(s, pool, Math.random, item ?? undefined);
      drawn = d?.episode;
      return d?.state ?? s;
    });
    return drawn;
  }, [backend, item, randomizer.list]);

  /** Moves on after the item played to its end: the next episode when autoplay is on, else back. */
  const playNext = useCallback(async () => {
    if (settings.autoplayNext && shuffle) {
      const next = await randomEpisode().catch(() => undefined);
      if (!alive.current) {
        return;
      }
      if (next) {
        nav.replace({
          name: 'player',
          itemId: next.id,
          startPositionMs: next.userData?.playbackPositionMs ?? 0,
          shuffle: true,
        });
        return;
      }
    } else if (
      settings.autoplayNext &&
      item?.kind === 'episode' &&
      item.seriesId
    ) {
      const next = await findNextEpisode(backend, item).catch(() => undefined);
      if (!alive.current) {
        return;
      }
      if (next) {
        nav.replace({ name: 'player', itemId: next.id, startPositionMs: 0 });
        return;
      }
    }
    nav.back();
  }, [backend, item, nav, randomEpisode, settings.autoplayNext, shuffle]);

  const goTo = (ep: MediaItem) =>
    nav.replace({
      name: 'player',
      itemId: ep.id,
      startPositionMs: ep.userData?.playbackPositionMs ?? 0,
    });

  const drawing = useRef(false);
  const playRandom = async () => {
    if (drawing.current) {
      return;
    }
    drawing.current = true;
    const next = await randomEpisode()
      .catch(() => undefined)
      .finally(() => {
        drawing.current = false;
      });
    if (next && alive.current) {
      nav.replace({
        name: 'player',
        itemId: next.id,
        startPositionMs: next.userData?.playbackPositionMs ?? 0,
        shuffle: true,
      });
    }
  };

  return { upcoming, previous, playNext, goTo, playRandom };
}
