import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ItemDetail,
  MediaSegment,
  PlaybackPlan,
} from '../../backend/types';
import { matchDisplayMode } from '../../player/displayMode';
import { isStreamParseFailure, playerError } from '../../player/errors';
import type {
  PlayerEngine,
  PlayerViewHandle,
  PlayerViewProps,
} from '../../player/PlayerEngine';
import { playedToEnd } from '../../player/seeking';
import { useApp, useBackend } from '../../state/AppState';
import { pickAudio, pickSubtitle } from '../../state/trackDefaults';

export const REPORT_EVERY_MS = 10_000;
const PROGRESS_RENDER_MS = 250;
// After a display mode switch the TV shows no picture while HDMI renegotiates; the player stays
// black for this long so the first seconds of the video are not lost to it.
export const MODE_SETTLE_MS = 1500;

export type PlaybackSession = ReturnType<typeof usePlaybackSession>;

/**
 * One item's playback against the server: loads the item and its segments, negotiates a plan
 * with the default (or chosen) tracks, matches the display mode, and reports start, progress
 * every REPORT_EVERY_MS and stop, marking the item played when it stopped at the end.
 *
 * With `unreported` (Randomizer playback) nothing is reported and nothing is marked played, so
 * the item stays off Continue Watching and Next Up; the server is only told to keep a transcode
 * alive in place of each progress report, and to end it in place of the stop.
 */
export function usePlaybackSession(
  itemId: string,
  startPositionMs: number,
  engine: PlayerEngine,
  unreported = false,
) {
  const backend = useBackend();
  const app = useApp();
  const { settings } = app;
  const display = app.platform.display;

  const [item, setItem] = useState<ItemDetail>();
  const [plan, setPlan] = useState<PlaybackPlan>();
  const [error, setError] = useState<unknown>();
  const [paused, setPaused] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [position, setPosition] = useState(startPositionMs);
  const [buffered, setBuffered] = useState(0);
  const [duration, setDuration] = useState(0);
  const [audio, setAudio] = useState<number>();
  const [subtitle, setSubtitle] = useState<number>(-1);
  const [segments, setSegments] = useState<MediaSegment[]>([]);
  const lastRender = useRef(0);

  const view = useRef<PlayerViewHandle>(null);
  const planRef = useRef<PlaybackPlan>(undefined);
  const positionRef = useRef(startPositionMs);
  const pausedRef = useRef(false);
  const started = useRef(false);
  // Bumped by every plan request; a reply for an older request is dropped. The track pickers
  // already wait for the current plan, so this only guards against later callers.
  const planRequest = useRef(0);
  // False once the screen unmounts; true once the current plan has played to its end. Late
  // native callbacks check these so they cannot act on a screen the user already left.
  const alive = useRef(true);
  // Set after the player could not parse an fMP4 stream: later plans ask for MPEG-TS segments.
  const avoidFmp4 = useRef(false);
  const ended = useRef(false);
  // Set once the display mode has been matched to the first plan; later plans (track changes)
  // are the same video and keep it. Restored when the screen closes.
  const modeMatched = useRef(false);
  const tracksRef = useRef<{ audio?: number; subtitle: number }>({
    subtitle: -1,
  });
  planRef.current = plan;
  pausedRef.current = paused;
  tracksRef.current = { audio, subtitle };

  const reportChain = useRef<Promise<unknown>>(Promise.resolve());
  const segmentsRef = useRef<MediaSegment[]>([]);
  segmentsRef.current = segments;
  const isFinished = useCallback(
    (p: PlaybackPlan, positionMs: number) =>
      ended.current ||
      playedToEnd(positionMs, p.durationMs ?? 0, segmentsRef.current),
    [],
  );

  const report = useCallback(
    (kind: 'start' | 'progress' | 'stop', p = planRef.current) => {
      if (!p) {
        return;
      }
      const r = {
        plan: p,
        positionMs: Math.round(positionRef.current),
        isPaused: pausedRef.current,
        audioStreamIndex: tracksRef.current.audio,
        subtitleStreamIndex: tracksRef.current.subtitle,
      };
      // One report at a time, in order: a progress call that lands after the stop would put the
      // episode back on Continue Watching at the position it had when the call was sent.
      const finished = kind === 'stop' && isFinished(p, r.positionMs);
      const send = () => {
        if (unreported) {
          if (kind === 'progress') {
            return backend.pingPlayback(p);
          }
          return kind === 'stop' ? backend.stopEncoding(p) : undefined;
        }
        if (kind === 'start') {
          return backend.reportStart(r);
        }
        if (kind === 'progress') {
          return backend.reportProgress(r);
        }
        // The server only clears the resume point past its own threshold; a viewer who watched
        // to the credits or the end expects the episode off Continue Watching.
        return backend
          .reportStop(r)
          .then(() =>
            finished ? backend.setPlayed(p.itemId, true) : undefined,
          );
      };
      reportChain.current = reportChain.current
        .then(send)
        .catch(() => undefined);
    },
    [backend, isFinished, unreported],
  );

  /**
   * Asks the backend for a (new) plan. Stops the session of the previous plan first. A plan that
   * arrives after a newer request or after the screen closed is dropped; it was never loaded, so
   * the server has not started streaming it.
   */
  const requestPlan = useCallback(
    async (
      fromMs: number,
      audioIndex: number | undefined,
      subtitleIndex: number,
    ) => {
      const request = ++planRequest.current;
      const current = () => alive.current && request === planRequest.current;
      if (planRef.current && started.current) {
        report('stop');
      }
      started.current = false;
      ended.current = false;
      setError(undefined);
      setPlan(undefined);
      setBuffering(true);
      try {
        const caps = await app.capabilities();
        const next = await backend.playback(
          {
            itemId,
            startPositionMs: fromMs,
            audioStreamIndex: audioIndex,
            subtitleStreamIndex: subtitleIndex,
            avoidFmp4: avoidFmp4.current,
          },
          caps,
        );
        if (!current()) {
          return;
        }
        if (!modeMatched.current) {
          modeMatched.current = true;
          const switched = await matchDisplayMode(
            display,
            next.videoFrameRate
              ? {
                  frameRate: next.videoFrameRate,
                  width: next.videoWidth,
                  height: next.videoHeight,
                }
              : undefined,
            settings.refreshRateMatch,
          );
          if (switched) {
            await new Promise<void>(r => setTimeout(r, MODE_SETTLE_MS));
          }
          if (!current()) {
            return;
          }
        }
        positionRef.current = fromMs;
        setPosition(fromMs);
        setAudio(next.selectedAudioIndex ?? audioIndex);
        setSubtitle(subtitleIndex);
        setPlan(next);
      } catch (e) {
        if (current()) {
          setError(e);
        }
      }
    },
    [app, backend, display, itemId, report, settings.refreshRateMatch],
  );

  // Initial load: item detail, default tracks from settings, then the plan.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const detail = await backend.item(itemId);
        if (cancelled) {
          return;
        }
        setItem(detail);
        backend
          .mediaSegments(itemId)
          .then(found => !cancelled && setSegments(found))
          .catch(() => undefined);
        const src = detail.mediaSources?.[0];
        const a = src ? pickAudio(src.audioTracks, settings) : undefined;
        const s = src ? pickSubtitle(src.subtitleTracks, settings) : -1;
        await requestPlan(startPositionMs, a, s);
      } catch (e) {
        if (!cancelled) {
          setError(e);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Only on mount; later track changes call requestPlan directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Periodic progress and a final stop when the screen goes away.
  useEffect(() => {
    const t = setInterval(
      () => started.current && report('progress'),
      REPORT_EVERY_MS,
    );
    alive.current = true;
    return () => {
      alive.current = false;
      clearInterval(t);
      if (modeMatched.current) {
        // Clears the window's preference even if a switch is still in flight; a no-op when
        // nothing was switched.
        display?.setPreferredMode(0);
      }
      if (started.current) {
        report('stop');
        started.current = false;
      }
    };
  }, [display, report]);

  useEffect(() => {
    if (started.current) {
      report('progress');
    }
  }, [paused, report]);

  /** Tells the server the current position right away, once playback has started. */
  const reportProgress = useCallback(() => {
    if (started.current) {
      report('progress');
    }
  }, [report]);

  /**
   * Stops the session because the plan played to its end. Returns false when it already ended or
   * the screen is gone, so a repeated end event does nothing.
   */
  const finish = useCallback(() => {
    if (ended.current || !alive.current) {
      return false;
    }
    ended.current = true;
    positionRef.current = duration || positionRef.current;
    if (started.current) {
      report('stop');
    }
    started.current = false;
    return true;
  }, [duration, report]);

  const chooseAudio = (index: number) => {
    if (!plan || index === audio) {
      return;
    }
    if (engine.canSwitchInStream(plan, { audioStreamIndex: index })) {
      setAudio(index);
      report('progress');
    } else {
      requestPlan(positionRef.current, index, subtitle);
    }
  };
  const chooseSubtitle = (index: number) => {
    if (!plan || index === subtitle) {
      return;
    }
    if (engine.canSwitchInStream(plan, { subtitleStreamIndex: index })) {
      setSubtitle(index);
      report('progress');
    } else {
      requestPlan(positionRef.current, audio, index);
    }
  };

  /** Engine callbacks for the plan's view. */
  const viewProps: Pick<
    PlayerViewProps,
    'onLoad' | 'onProgress' | 'onBuffering' | 'onError'
  > = {
    onLoad: e => {
      setDuration(e.durationMs);
      setBuffering(false);
      if (!started.current && alive.current && !ended.current) {
        started.current = true;
        report('start');
      }
    },
    onProgress: e => {
      positionRef.current = e.positionMs;
      // Re-render at ~4 Hz at most: every tick re-lays out the overlay, which janks the stick.
      const now = Date.now();
      if (now - lastRender.current >= PROGRESS_RENDER_MS) {
        lastRender.current = now;
        setPosition(e.positionMs);
        setBuffered(e.bufferedMs);
      }
    },
    onBuffering: setBuffering,
    onError: msg => {
      const p = planRef.current;
      if (
        !avoidFmp4.current &&
        p &&
        p.method !== 'DirectPlay' &&
        isStreamParseFailure(msg)
      ) {
        // Retry once with MPEG-TS segments before telling the viewer the stream is broken.
        avoidFmp4.current = true;
        requestPlan(
          positionRef.current,
          tracksRef.current.audio,
          tracksRef.current.subtitle,
        );
        return;
      }
      setError(playerError(msg));
    },
  };

  return {
    item,
    plan,
    error,
    paused,
    buffering,
    position,
    buffered,
    duration,
    audio,
    subtitle,
    segments,
    view,
    positionRef,
    setPosition,
    viewProps,
    togglePaused: () => setPaused(p => !p),
    retry: () => requestPlan(positionRef.current, audio, subtitle),
    chooseAudio,
    chooseSubtitle,
    reportProgress,
    finish,
    hasEnded: () => ended.current,
  };
}
