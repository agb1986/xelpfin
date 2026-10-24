import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  BackHandler,
  useTVEventHandler,
  type HWEvent,
  type View,
} from 'react-native';
import type { MediaSegment } from '../../backend/types';
import {
  initialOverlay,
  overlayReducer,
  segmentKey,
  type Navigator,
  type Overlay,
  type Picker,
} from './overlayState';
import { cancel } from './timers';

export const HIDE_AFTER_MS = 5000;
/** A second BACK within this window of the first leaves the player. */
export const EXIT_WINDOW_MS = 3000;

/**
 * The remote on the player: which overlay is up and for how long, what each key does, and what
 * BACK lowers before it leaves. Seeking and pausing are handed in; this only decides when.
 */
export function useRemoteKeys({
  active,
  playing,
  error,
  paused,
  hasEnded,
  upcomingCount,
  segment,
  togglePaused,
  tapSeek,
}: {
  active: boolean;
  /** The current plan; keys do nothing until there is one, and a new one shows the controls. */
  playing: unknown;
  error: unknown;
  paused: boolean;
  hasEnded(): boolean;
  /** Episodes after this one; Down opens their reel when there are any. */
  upcomingCount: number;
  /** The skippable segment playing now, before the viewer's dismissals are applied. */
  segment: MediaSegment | undefined;
  togglePaused(): void;
  tapSeek(dir: 1 | -1, held: boolean): void;
}) {
  const [state, dispatch] = useReducer(overlayReducer, initialOverlay);
  const { mode: overlay, navigator, picker } = state;
  const skip =
    segment && !state.dismissed.includes(segmentKey(segment))
      ? segment
      : undefined;

  const surface = useRef<View>(null);
  // Preferred focus is only claimed when the controls first appear, so progress re-renders cannot pull focus back to Pause.
  const claimFocus = useRef(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const exitArmedUntil = useRef(0);
  const exitTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const playingRef = useRef<unknown>(undefined);
  const pausedRef = useRef(false);
  const overlayRef = useRef<Overlay>('controls');
  const navigatorRef = useRef<Navigator>(false);
  const upcomingRef = useRef(0);
  const skipRef = useRef<MediaSegment>(undefined);
  playingRef.current = playing;
  pausedRef.current = paused;
  overlayRef.current = overlay;
  navigatorRef.current = navigator;
  upcomingRef.current = upcomingCount;
  skipRef.current = skip;

  const showOverlay = useCallback((mode: Overlay) => {
    dispatch({ type: 'show', mode });
    cancel(hideTimer.current);
    hideTimer.current = setTimeout(
      () => !pausedRef.current && dispatch({ type: 'autoHide' }),
      HIDE_AFTER_MS,
    );
  }, []);
  useEffect(
    () => () => {
      cancel(hideTimer.current);
      cancel(exitTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (playing && !paused) {
      showOverlay('controls');
    }
    // Start the auto-hide timer once a plan is playing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  useEffect(() => {
    claimFocus.current = overlay !== 'controls';
  }, [overlay]);

  const closeNavigator = useCallback(() => {
    dispatch({ type: 'navigator', navigator: false });
    navigatorRef.current = false;
    showOverlay('controls');
  }, [showOverlay]);

  const togglePause = useCallback(() => {
    togglePaused();
    showOverlay('controls');
  }, [togglePaused, showOverlay]);

  const onKey = useCallback(
    (evt: HWEvent) => {
      if (!active || !playingRef.current || picker) {
        return;
      }
      // Android TV delivers remote keys on key-up only (key-down events are off by default);
      // a held key arrives as repeated "longX" key-down events, which seek repeatedly.
      const held = evt.eventKeyAction === 0 && evt.eventType.startsWith('long');
      if (evt.eventKeyAction !== 1 && !held) {
        return;
      }
      if (evt.eventKeyAction === 1 && evt.eventType.startsWith('long')) {
        return; // The key-up that ends a long press; the press itself was already handled.
      }
      const type = held
        ? evt.eventType.charAt(4).toLowerCase() + evt.eventType.slice(5)
        : evt.eventType;
      switch (type) {
        case 'playPause':
          togglePause();
          break;
        case 'fastForward':
        case 'rewind':
          tapSeek(type === 'rewind' ? -1 : 1, held);
          showOverlay(overlay === 'controls' ? 'controls' : 'seek');
          break;
        case 'left':
        case 'right':
          if (overlay === 'controls') {
            showOverlay('controls'); // D-pad moves between buttons; just keep the overlay up.
          } else {
            tapSeek(type === 'left' ? -1 : 1, held);
            showOverlay('seek');
          }
          break;
        case 'up':
          // Controls already up: Up opens the scene navigator.
          if (overlay === 'controls' && !navigatorRef.current) {
            dispatch({ type: 'navigator', navigator: 'scenes' });
          }
          showOverlay('controls');
          break;
        case 'down':
          // Controls already up: Down opens the reel of the episodes that follow.
          if (
            overlay === 'controls' &&
            !navigatorRef.current &&
            upcomingRef.current
          ) {
            dispatch({ type: 'navigator', navigator: 'episodes' });
          }
          showOverlay('controls');
          break;
        case 'select':
          // Hidden controls and a skippable segment: the surface's press skips it instead.
          if (overlay === 'hidden' && skipRef.current) {
            break;
          }
          showOverlay('controls');
          break;
        case 'info':
        case 'menu':
          showOverlay('controls');
          break;
        default:
          break;
      }
    },
    [active, picker, overlay, tapSeek, showOverlay, togglePause],
  );
  useTVEventHandler(onKey);

  // Remote keys only reach the app while some view has focus. When the controls (and the
  // button that had focus) go away, hand focus to the full-screen surface explicitly.
  useEffect(() => {
    if (!active || picker || overlay === 'controls' || error) {
      return;
    }
    const t = setTimeout(() => surface.current?.requestTVFocus?.(), 0);
    return () => cancel(t);
  }, [active, picker, overlay, error, playing]);

  // BACK lowers the navigator, then the controls. With nothing showing, the first BACK asks
  // for confirmation and a second one within a couple of seconds leaves the player.
  useEffect(() => {
    if (!active) {
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!playingRef.current || hasEnded()) {
        return false;
      }
      if (navigatorRef.current) {
        closeNavigator();
        return true;
      }
      const now = Date.now();
      if (overlayRef.current === 'hidden' && skipRef.current) {
        dispatch({ type: 'dismiss', key: segmentKey(skipRef.current) });
        return true;
      }
      if (overlayRef.current !== 'hidden') {
        cancel(hideTimer.current);
        dispatch({ type: 'show', mode: 'hidden' });
        // A quick second BACK right after lowering the controls leaves.
        exitArmedUntil.current = now + EXIT_WINDOW_MS;
        return true;
      }
      if (now < exitArmedUntil.current) {
        return false;
      }
      exitArmedUntil.current = now + EXIT_WINDOW_MS;
      dispatch({ type: 'exitHint', shown: true });
      cancel(exitTimer.current);
      exitTimer.current = setTimeout(
        () => dispatch({ type: 'exitHint', shown: false }),
        EXIT_WINDOW_MS,
      );
      return true;
    });
    return () => sub.remove();
    // hasEnded reads a ref; re-subscribing for it would only reorder the BACK listeners.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, closeNavigator]);

  return {
    overlay,
    navigator,
    picker,
    exitHint: state.exitHint,
    skip,
    surface,
    claimFocus,
    showOverlay,
    closeNavigator,
    togglePause,
    setPicker: (p?: Picker) => dispatch({ type: 'picker', picker: p }),
  };
}
