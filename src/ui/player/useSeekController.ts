import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Chapter } from '../../backend/types';
import type { PlayerViewHandle } from '../../player/PlayerEngine';
import {
  currentSceneIndex,
  scenesFor,
  TAP_BURST_MS,
  tapOffsetMs,
} from '../../player/seeking';
import { cancel } from './timers';

export const SEEK_STEP_MS = 10_000;
export const SKIP_STEP_MS = 30_000;
/** How long after the last tap a rewind/forward burst is committed as one seek. */
export const TAP_COMMIT_MS = 700;
/** A held key counts as one tap per this interval, so holding scans fast but not instantly. */
export const HELD_TAP_MS = 500;

/**
 * Seeking for the player: direct seeks clamped to the video, rewind/forward bursts that are
 * committed as one seek, and the scene marks the navigator jumps between.
 */
export function useSeekController({
  view,
  positionRef,
  setPosition,
  durationMs,
  chapters,
  totalMs,
}: {
  view: React.RefObject<PlayerViewHandle | null>;
  positionRef: React.RefObject<number>;
  setPosition(ms: number): void;
  /** The engine's duration, else the plan's; 0 when neither is known yet. */
  durationMs: number;
  chapters?: Chapter[];
  /** Length shown on the bar, used for the synthetic scene marks. */
  totalMs: number;
}) {
  // Target of a rewind/forward burst that has not been committed yet, shown on the bar.
  const [pending, setPending] = useState<{ target: number; delta: number }>();
  const burst = useRef<{
    dir: 1 | -1;
    taps: number;
    base: number;
    lastAt: number;
    timer?: ReturnType<typeof setTimeout>;
  }>(undefined);
  useEffect(() => () => cancel(burst.current?.timer), []);

  const clamp = useCallback(
    (ms: number) => {
      const max = durationMs || Infinity;
      return Math.max(0, Math.min(max - 1000, ms));
    },
    [durationMs],
  );

  const seekTo = useCallback(
    (ms: number) => {
      const target = clamp(ms);
      positionRef.current = target;
      setPosition(target);
      view.current?.seek(target);
    },
    [clamp, positionRef, setPosition, view],
  );
  const seekBy = useCallback(
    (delta: number) => seekTo(positionRef.current + delta),
    [positionRef, seekTo],
  );

  /** Commits the rewind/forward burst in progress as a single seek. */
  const commitBurst = useCallback(() => {
    const b = burst.current;
    burst.current = undefined;
    if (!b) {
      return;
    }
    cancel(b.timer);
    seekTo(b.base + b.dir * tapOffsetMs(b.taps));
    setPending(undefined);
  }, [seekTo]);

  /**
   * One rewind/forward tap. Taps in quick succession escalate (10 s, 30 s, 1 min, then 1 min
   * each) and are committed as one seek once the taps stop.
   */
  const tapSeek = useCallback(
    (dir: 1 | -1, held: boolean) => {
      const now = Date.now();
      let b = burst.current;
      if (b && b.dir !== dir) {
        commitBurst();
        b = undefined;
      }
      if (b && held && now - b.lastAt < HELD_TAP_MS) {
        return;
      }
      if (!b || now - b.lastAt > TAP_BURST_MS + TAP_COMMIT_MS) {
        b = { dir, taps: 0, base: positionRef.current, lastAt: now };
      }
      cancel(b.timer);
      b.taps += 1;
      b.lastAt = now;
      b.timer = setTimeout(commitBurst, TAP_COMMIT_MS);
      burst.current = b;
      const delta = dir * tapOffsetMs(b.taps);
      setPending({ target: clamp(b.base + delta), delta });
    },
    [clamp, commitBurst, positionRef],
  );

  const scenes = useMemo(
    () => scenesFor(chapters, totalMs),
    [chapters, totalMs],
  );

  return {
    pending,
    seekTo,
    seekBy,
    tapSeek,
    scenes,
    sceneIndex: (positionMs: number) => currentSceneIndex(scenes, positionMs),
  };
}
