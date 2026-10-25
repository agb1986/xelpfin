import { useEffect, useState } from 'react';
import type { Trickplay } from '../../backend/types';
import { useBackend } from '../../state/AppState';

/**
 * Trickplay layout of the media source being played, once the plan has picked one. Undefined
 * until it arrives, and for good when the server has none.
 */
export function useTrickplay(
  itemId: string | undefined,
  mediaSourceId: string | undefined,
): Trickplay | undefined {
  const backend = useBackend();
  const [found, setFound] = useState<{ key: string; tp?: Trickplay }>();
  const key = `${itemId}/${mediaSourceId}`;
  useEffect(() => {
    if (!itemId || !mediaSourceId) {
      return;
    }
    let live = true;
    backend
      .trickplay(itemId, mediaSourceId)
      .catch(() => undefined)
      .then(tp => {
        if (live) {
          setFound({ key: `${itemId}/${mediaSourceId}`, tp });
        }
      });
    return () => {
      live = false;
    };
  }, [backend, itemId, mediaSourceId]);
  // A plan for another source must not show the previous source's thumbnails.
  return found?.key === key ? found.tp : undefined;
}
