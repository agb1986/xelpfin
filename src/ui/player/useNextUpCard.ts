import { useCallback, useEffect, useRef, useState } from 'react';
import type { MediaItem } from '../../backend/types';
import { useNavigation } from '../../state/navigation';
import type { useNextEpisode } from './useNextEpisode';

type Phase = 'idle' | 'loading' | 'shown' | 'dismissed' | 'none';

/**
 * The next-episode card: offered once per item, when the Credits segment starts or the item
 * ends, whichever comes first. Nothing is offered with autoplay off or when nothing follows.
 * Cancel leaves the credits running; with the card dismissed, the end of the item goes back
 * instead of autoplaying.
 */
export function useNextUpCard(
  next: Pick<ReturnType<typeof useNextEpisode>, 'peekNext' | 'playPeeked'>,
  inCredits: boolean,
) {
  const nav = useNavigation();
  const [card, setCard] = useState<MediaItem>();
  const phase = useRef<Phase>('idle');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** Looks up the next episode and raises the card; resolves false when there is none. */
  const offer = useCallback(async () => {
    phase.current = 'loading';
    const ep = await next.peekNext().catch(() => undefined);
    if (!alive.current) {
      return true;
    }
    phase.current = ep ? 'shown' : 'none';
    setCard(ep);
    return !!ep;
  }, [next]);

  useEffect(() => {
    if (inCredits && phase.current === 'idle') {
      offer();
    }
  }, [inCredits, offer]);

  /** The item played to its end: raise the card, or go back when it cannot or must not show. */
  const onEnd = useCallback(async () => {
    if (phase.current === 'loading' || phase.current === 'shown') {
      return;
    }
    if (phase.current === 'idle' && (await offer())) {
      return;
    }
    if (alive.current) {
      nav.back();
    }
  }, [nav, offer]);

  const play = useCallback(() => {
    if (card) {
      next.playPeeked(card);
    }
  }, [card, next]);
  const cancel = useCallback(() => {
    phase.current = 'dismissed';
    setCard(undefined);
  }, []);

  return { card, play, cancel, onEnd };
}
