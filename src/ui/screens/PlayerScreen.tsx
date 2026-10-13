import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Image, ScrollView, StyleSheet, Text, useTVEventHandler, View, type HWEvent } from 'react-native';
import type { ItemDetail, MediaSegment, PlaybackPlan } from '../../backend/types';
import { getEngine } from '../../player';
import { playerError } from '../../player/errors';
import { activeSegment, currentSceneIndex, episodeCode, scenesFor, skipLabel, TAP_BURST_MS, tapOffsetMs } from '../../player/seeking';
import { useSubtitleCues } from '../../player/useSubtitleCues';
import type { PlayerViewHandle } from '../../player/PlayerEngine';
import { useApp, useBackend } from '../../state/AppState';
import { useIsActive, useNavigation } from '../../state/navigation';
import { findNextEpisode } from '../../state/nextEpisode';
import { pickAudio, pickSubtitle } from '../../state/trackDefaults';
import { Button, ErrorView, Focusable, LoadingView, OptionPicker, SubtitleText, type Option } from '../components';
import { formatDuration } from '../hooks';
import { colors, font, radius, space } from '../theme';

const HIDE_AFTER_MS = 5000;

function cancel(t: ReturnType<typeof setTimeout> | undefined) {
  if (t) {
    clearTimeout(t);
  }
}

const REPORT_EVERY_MS = 10_000;
const SEEK_STEP_MS = 10_000;
const PROGRESS_RENDER_MS = 250;
const SKIP_STEP_MS = 30_000;
/** How long after the last tap a rewind/forward burst is committed as one seek. */
const TAP_COMMIT_MS = 700;
/** A held key counts as one tap per this interval, so holding scans fast but not instantly. */
const HELD_TAP_MS = 500;
/** A second BACK within this window of the first leaves the player. */
const EXIT_WINDOW_MS = 2000;

type Overlay = 'hidden' | 'seek' | 'controls';

function audioOptions(plan: PlaybackPlan): Option<number>[] {
  return plan.audioTracks.map(a => ({
    label: a.label,
    detail: [a.language, a.codec?.toUpperCase(), a.channels ? `${a.channels} ch` : undefined].filter(Boolean).join(' · '),
    value: a.index,
  }));
}

function subtitleOptions(plan: PlaybackPlan): Option<number>[] {
  return [
    { label: 'Off', value: -1 },
    ...plan.subtitleTracks.map(s => ({
      label: s.label,
      detail: [s.language, s.codec?.toUpperCase(), s.isForced ? 'forced' : undefined, s.delivery === 'burn-in' ? 'burned in by server' : undefined]
        .filter(Boolean)
        .join(' · '),
      value: s.index,
    })),
  ];
}

/** Track labels carry codec and flags; buttons keep the first part so the row stays on screen. */
const SHORT_LABEL_CHARS = 22;
function shortLabel(label: string | undefined): string | undefined {
  if (!label || label.length <= SHORT_LABEL_CHARS) {
    return label;
  }
  const first = label.split(' - ')[0];
  return first.length <= SHORT_LABEL_CHARS ? first : `${first.slice(0, SHORT_LABEL_CHARS - 1)}…`;
}

/**
 * Full-screen playback: negotiates a plan with the backend, renders the engine view, reports
 * progress, and offers seek, audio and subtitle selection with the remote.
 */
export function PlayerScreen({ itemId, startPositionMs = 0 }: { itemId: string; startPositionMs?: number }) {
  const backend = useBackend();
  const app = useApp();
  const nav = useNavigation();
  const active = useIsActive();
  const engine = getEngine();
  const { settings } = app;
  const look = useMemo(
    () => ({ size: settings.subtitleSize, color: settings.subtitleColor, background: settings.subtitleBackground }),
    [settings.subtitleSize, settings.subtitleColor, settings.subtitleBackground],
  );

  const [item, setItem] = useState<ItemDetail>();
  const [plan, setPlan] = useState<PlaybackPlan>();
  const [error, setError] = useState<unknown>();
  const [paused, setPaused] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [position, setPosition] = useState(startPositionMs);
  const lastRender = useRef(0);
  // Preferred focus is only claimed when the controls first appear, so progress re-renders cannot pull focus back to Pause.
  const claimFocus = useRef(true);
  const [buffered, setBuffered] = useState(0);
  const [controlsHeight, setControlsHeight] = useState(0);
  const [duration, setDuration] = useState(0);
  const [audio, setAudio] = useState<number>();
  const [subtitle, setSubtitle] = useState<number>(-1);
  const [overlay, setOverlay] = useState<Overlay>('controls');
  const [picker, setPicker] = useState<'audio' | 'subtitles'>();
  const [segments, setSegments] = useState<MediaSegment[]>([]);
  const [navigator, setNavigator] = useState(false);
  // Target of a rewind/forward burst that has not been committed yet, shown on the bar.
  const [pending, setPending] = useState<{ target: number; delta: number }>();
  const [exitHint, setExitHint] = useState(false);

  const view = useRef<PlayerViewHandle>(null);
  const surface = useRef<View>(null);
  const planRef = useRef<PlaybackPlan>(undefined);
  const positionRef = useRef(startPositionMs);
  const pausedRef = useRef(false);
  const started = useRef(false);
  // False once the screen unmounts; true once the current plan has played to its end. Late
  // native callbacks and the async next-episode lookup check these so they cannot act on a
  // screen the user already left.
  const alive = useRef(true);
  const ended = useRef(false);
  const tracksRef = useRef<{ audio?: number; subtitle: number }>({ subtitle: -1 });
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const overlayRef = useRef<Overlay>('controls');
  const navigatorRef = useRef(false);
  const skipRef = useRef<MediaSegment>(undefined);
  const exitArmedUntil = useRef(0);
  const exitTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const burst = useRef<{ dir: 1 | -1; taps: number; base: number; lastAt: number; timer?: ReturnType<typeof setTimeout> }>(undefined);
  planRef.current = plan;
  overlayRef.current = overlay;
  navigatorRef.current = navigator;
  pausedRef.current = paused;
  tracksRef.current = { audio, subtitle };
  // Side-loaded subtitles are drawn by the app (see useSubtitleCues).
  const cues = useSubtitleCues(plan?.subtitleTracks.find(t => t.index === subtitle), plan?.headers);

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
      const call = kind === 'start' ? backend.reportStart(r) : kind === 'progress' ? backend.reportProgress(r) : backend.reportStop(r);
      call.catch(() => undefined);
    },
    [backend],
  );

  /** Asks the backend for a (new) plan. Stops the session of the previous plan first. */
  const requestPlan = useCallback(
    async (fromMs: number, audioIndex: number | undefined, subtitleIndex: number) => {
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
          { itemId, startPositionMs: fromMs, audioStreamIndex: audioIndex, subtitleStreamIndex: subtitleIndex },
          caps,
        );
        positionRef.current = fromMs;
        setPosition(fromMs);
        setAudio(next.selectedAudioIndex ?? audioIndex);
        setSubtitle(subtitleIndex);
        setPlan(next);
      } catch (e) {
        setError(e);
      }
    },
    [app, backend, itemId, report],
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
    const t = setInterval(() => started.current && report('progress'), REPORT_EVERY_MS);
    alive.current = true;
    return () => {
      alive.current = false;
      clearInterval(t);
      if (started.current) {
        report('stop');
        started.current = false;
      }
    };
  }, [report]);

  useEffect(() => {
    if (started.current) {
      report('progress');
    }
  }, [paused, report]);

  const showOverlay = useCallback((mode: Overlay) => {
    setOverlay(mode);
    if (hideTimer.current) {
      cancel(hideTimer.current);
    }
    hideTimer.current = setTimeout(() => !pausedRef.current && !navigatorRef.current && setOverlay('hidden'), HIDE_AFTER_MS);
  }, []);
  useEffect(
    () => () => {
      cancel(hideTimer.current);
      cancel(exitTimer.current);
      cancel(burst.current?.timer);
    },
    [],
  );
  useEffect(() => {
    if (plan && !paused) {
      showOverlay('controls');
    }
    // Start the auto-hide timer once a plan is playing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);

  useEffect(() => {
    claimFocus.current = overlay !== 'controls';
  }, [overlay]);

  const seekTo = useCallback(
    (ms: number) => {
      const max = duration || planRef.current?.durationMs || Infinity;
      const target = Math.max(0, Math.min(max - 1000, ms));
      positionRef.current = target;
      setPosition(target);
      view.current?.seek(target);
    },
    [duration],
  );
  const seekBy = useCallback((delta: number) => seekTo(positionRef.current + delta), [seekTo]);

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
   * One rewind/forward tap. Taps in quick succession escalate (10 s, 30 s, 1 min, then 5 min
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
      const max = duration || planRef.current?.durationMs || Infinity;
      const delta = dir * tapOffsetMs(b.taps);
      setPending({ target: Math.max(0, Math.min(max - 1000, b.base + delta)), delta });
    },
    [commitBurst, duration],
  );

  const closeNavigator = useCallback(() => {
    setNavigator(false);
    navigatorRef.current = false;
    showOverlay('controls');
  }, [showOverlay]);

  const skipSegment = useCallback(
    (seg: MediaSegment) => {
      seekTo(seg.endMs);
      showOverlay('seek');
    },
    [seekTo, showOverlay],
  );

  const togglePause = useCallback(() => {
    setPaused(p => !p);
    showOverlay('controls');
  }, [showOverlay]);

  const onKey = useCallback(
    (evt: HWEvent) => {
      if (!active || !planRef.current || picker) {
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
      const type = held ? evt.eventType.charAt(4).toLowerCase() + evt.eventType.slice(5) : evt.eventType;
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
            setNavigator(true);
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
        case 'down':
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
  }, [active, picker, overlay, error, plan]);

  // BACK lowers the navigator, then the controls. With nothing showing, the first BACK asks
  // for confirmation and a second one within a couple of seconds leaves the player.
  useEffect(() => {
    if (!active) {
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!planRef.current || ended.current) {
        return false;
      }
      if (navigatorRef.current) {
        closeNavigator();
        return true;
      }
      const now = Date.now();
      if (overlayRef.current !== 'hidden') {
        cancel(hideTimer.current);
        setOverlay('hidden');
        // A quick second BACK right after lowering the controls leaves.
        exitArmedUntil.current = now + EXIT_WINDOW_MS;
        return true;
      }
      if (now < exitArmedUntil.current) {
        return false;
      }
      exitArmedUntil.current = now + EXIT_WINDOW_MS;
      setExitHint(true);
      cancel(exitTimer.current);
      exitTimer.current = setTimeout(() => setExitHint(false), EXIT_WINDOW_MS);
      return true;
    });
    return () => sub.remove();
  }, [active, closeNavigator]);

  const onEnd = useCallback(async () => {
    if (ended.current || !alive.current) {
      return;
    }
    ended.current = true;
    positionRef.current = duration || positionRef.current;
    if (started.current) {
      report('stop');
    }
    started.current = false;
    if (settings.autoplayNext && item?.kind === 'episode' && item.seriesId) {
      const next = await findNextEpisode(backend, item).catch(() => undefined);
      // BACK during the lookup already popped this screen; replacing now would replace the page
      // below it.
      if (!alive.current) {
        return;
      }
      if (next) {
        nav.replace({ name: 'player', itemId: next.id, startPositionMs: 0 });
        return;
      }
    }
    nav.back();
  }, [backend, duration, item, nav, report, settings.autoplayNext]);

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

  if (error) {
    return (
      <View style={styles.root} testID="player">
        <ErrorView error={error} onRetry={() => requestPlan(positionRef.current, audio, subtitle)} hasTVPreferredFocus />
        <View style={styles.center}>
          <Button label="Back" onPress={() => nav.back()} testID="player-back" />
        </View>
      </View>
    );
  }

  const total = duration || plan?.durationMs || item?.runtimeMs || 0;
  const pct = total ? Math.min(1, (pending?.target ?? position) / total) : 0;
  const bufPct = total ? Math.min(1, buffered / total) : 0;
  const code = item?.kind === 'episode' ? episodeCode(item.parentIndexNumber, item.indexNumber) : undefined;
  const title = item
    ? item.kind === 'episode' && item.seriesName
      ? [item.seriesName, code, item.name].filter(Boolean).join(' · ')
      : item.name
    : '';
  const shown = pending?.target ?? position;
  const skip = active && plan && !buffering ? activeSegment(segments, position) : undefined;
  skipRef.current = skip;
  const scenes = navigator ? scenesFor(item?.chapters, total) : [];
  const sceneNow = currentSceneIndex(scenes, position);
  const audioLabel = plan?.audioTracks.find(a => a.index === audio)?.label;
  const subLabel = subtitle >= 0 ? plan?.subtitleTracks.find(s => s.index === subtitle)?.label : 'Off';

  return (
    <View style={styles.root} testID="player">
      {plan ? (
        <engine.View
          key={plan.playSessionId + plan.url}
          ref={view}
          plan={plan}
          paused={paused || !active}
          audioStreamIndex={audio}
          subtitleStreamIndex={subtitle}
          subtitleSize={settings.subtitleSize}
          onLoad={e => {
            setDuration(e.durationMs);
            setBuffering(false);
            if (!started.current && alive.current && !ended.current) {
              started.current = true;
              report('start');
            }
          }}
          onProgress={e => {
            positionRef.current = e.positionMs;
            // Re-render at ~4 Hz at most: every tick re-lays out the overlay, which janks the stick.
            const now = Date.now();
            if (now - lastRender.current >= PROGRESS_RENDER_MS) {
              lastRender.current = now;
              setPosition(e.positionMs);
              setBuffered(e.bufferedMs);
            }
          }}
          onBuffering={setBuffering}
          onEnd={onEnd}
          onError={msg => setError(playerError(msg))}
        />
      ) : null}
      <SubtitleText cues={cues} positionMs={position} lift={overlay !== 'hidden' ? controlsHeight : 0} look={look} />

      {/* Holds focus while the controls are hidden so remote keys still reach the player. */}
      {overlay !== 'controls' ? (
        <Focusable ref={surface} testID="player-surface" hasTVPreferredFocus style={StyleSheet.absoluteFill} onPress={() => (skipRef.current ? skipSegment(skipRef.current) : showOverlay('controls'))}>
          <View />
        </Focusable>
      ) : null}

      {!plan || buffering ? (
        <View style={styles.spinner} pointerEvents="none">
          <LoadingView />
        </View>
      ) : null}

      {settings.showDebugOverlay && plan ? (
        <View style={styles.debug} pointerEvents="none" testID="player-debug">
          <Text style={styles.debugText}>engine {engine.name}</Text>
          <Text style={styles.debugText}>
            {plan.method} · {plan.streamType} · {plan.container ?? '?'}
          </Text>
          {plan.reasons.length ? <Text style={styles.debugText}>{plan.reasons.join(', ')}</Text> : null}
          <Text style={styles.debugText}>
            audio {audio ?? 'default'} · subtitle {subtitle} · buffered {formatDuration(buffered)}
          </Text>
          <Text style={styles.debugText}>session {plan.playSessionId.slice(0, 8)}</Text>
        </View>
      ) : null}

      {skip && overlay === 'hidden' ? (
        <View style={styles.skip} pointerEvents="none" testID="player-skip-hint">
          <Text style={styles.skipText}>{skipLabel(skip.kind)}</Text>
          <Text style={styles.skipSub}>press OK</Text>
        </View>
      ) : null}

      {exitHint ? (
        <View style={styles.hint} pointerEvents="none" testID="player-exit-hint">
          <Text style={styles.hintText}>Press back again to exit</Text>
        </View>
      ) : null}

      {overlay !== 'hidden' ? (
        <View style={styles.overlay} testID="player-overlay" onLayout={e => setControlsHeight(e.nativeEvent.layout.height)}>
          {navigator && scenes.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scenes} testID="player-scenes">
              {scenes.map((sc, i) => (
                <Focusable
                  key={`${sc.startMs}-${i}`}
                  hasTVPreferredFocus={i === sceneNow}
                  testID={`player-scene-${i}`}
                  onPress={() => {
                    seekTo(sc.startMs);
                    closeNavigator();
                  }}
                  style={(f: boolean) => [styles.scene, f && styles.sceneFocused]}
                >
                  {sc.imageUrl ? <Image source={{ uri: sc.imageUrl }} style={styles.sceneImage} /> : <View style={styles.sceneImage} />}
                  <Text style={styles.sceneTime}>{formatDuration(sc.startMs)}</Text>
                  <Text style={styles.sceneName} numberOfLines={1}>
                    {sc.name}
                  </Text>
                </Focusable>
              ))}
            </ScrollView>
          ) : null}
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <View style={styles.bar}>
            <View style={[styles.barBuffered, { width: `${bufPct * 100}%` }]} />
            <View style={[styles.barFill, { width: `${pct * 100}%` }]} />
          </View>
          <View style={styles.times}>
            <Text style={styles.time} testID="player-position">
              {formatDuration(shown)}
            </Text>
            <Text style={pending ? styles.timePending : styles.time} testID="player-pending">
              {pending
                ? `${pending.delta < 0 ? '−' : '+'}${formatDuration(Math.abs(pending.delta))}`
                : plan
                ? plan.method.replace(/([a-z])([A-Z])/g, '$1 $2')
                : ''}
            </Text>
            <Text style={styles.time}>{formatDuration(total)}</Text>
          </View>
          {overlay === 'controls' ? (
            <View style={styles.buttons}>
              {skip ? (
                <Button variant="primary" hasTVPreferredFocus={claimFocus.current} label={skipLabel(skip.kind)} onPress={() => skipSegment(skip)} testID="player-skip" />
              ) : null}
              <Button variant={skip ? undefined : 'primary'} hasTVPreferredFocus={claimFocus.current && !skip} label={paused ? '▶ Play' : '❚❚ Pause'} onPress={togglePause} testID="player-playpause" />
              <Button label="−10 s" onPress={() => { seekBy(-SEEK_STEP_MS); showOverlay('controls'); }} testID="player-rew" />
              <Button label="+30 s" onPress={() => { seekBy(SKIP_STEP_MS); showOverlay('controls'); }} testID="player-ffwd" />
              {plan && plan.audioTracks.length > 1 ? (
                <Button label={`Audio: ${shortLabel(audioLabel) ?? 'default'}`} onPress={() => setPicker('audio')} testID="player-audio" />
              ) : null}
              {plan && plan.subtitleTracks.length > 0 ? (
                <Button label={`Subtitles: ${shortLabel(subLabel) ?? 'Off'}`} onPress={() => setPicker('subtitles')} testID="player-subtitles" />
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      {plan ? (
        <>
          <OptionPicker
            visible={picker === 'audio'}
            title="Audio"
            options={audioOptions(plan)}
            selected={audio ?? -2}
            onSelect={chooseAudio}
            onClose={() => setPicker(undefined)}
            testID="pick-audio"
          />
          <OptionPicker
            visible={picker === 'subtitles'}
            title="Subtitles"
            options={subtitleOptions(plan)}
            selected={subtitle}
            onSelect={chooseSubtitle}
            onClose={() => setPicker(undefined)}
            testID="pick-subtitle"
          />
        </>
      ) : null}
    </View>
  );
}


const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { position: 'absolute', bottom: space.xl * 2, left: 0, right: 0, alignItems: 'center' },
  spinner: { ...StyleSheet.absoluteFillObject, justifyContent: 'center' },
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space.safeX,
    paddingTop: space.xl,
    paddingBottom: space.safeY + space.sm,
    backgroundColor: 'rgba(10,6,20,0.78)',
  },
  title: { color: colors.text, fontSize: font.title, fontWeight: '700', marginBottom: space.md },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceHi, overflow: 'hidden' },
  barBuffered: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: colors.textDim, opacity: 0.4 },
  barFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: colors.accent },
  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.xs },
  time: { color: colors.textDim, fontSize: font.small },
  buttons: { flexDirection: 'row', marginTop: space.md },
  timePending: { color: colors.accent, fontSize: font.small, fontWeight: '700' },
  scenes: { marginBottom: space.md },
  scene: { width: 200, marginRight: space.sm, padding: space.xs, borderRadius: radius.sm, borderWidth: 2, borderColor: 'transparent' },
  sceneFocused: { borderColor: colors.accent, backgroundColor: colors.surfaceHi },
  sceneImage: { width: 192, height: 108, borderRadius: radius.sm, backgroundColor: colors.surface },
  sceneTime: { color: colors.text, fontSize: font.small, fontWeight: '700', marginTop: space.xs },
  sceneName: { color: colors.textDim, fontSize: font.small },
  skip: {
    position: 'absolute',
    right: space.safeX,
    bottom: space.safeY + space.lg,
    backgroundColor: 'rgba(10,6,20,0.85)',
    borderColor: colors.accent,
    borderWidth: 2,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  skipText: { color: colors.text, fontSize: font.title, fontWeight: '700' },
  skipSub: { color: colors.textDim, fontSize: font.small },
  hint: { position: 'absolute', bottom: space.safeY + space.lg, alignSelf: 'center', backgroundColor: 'rgba(10,6,20,0.85)', borderRadius: radius.sm, padding: space.sm },
  hintText: { color: colors.text, fontSize: font.small },
  debug: { position: 'absolute', top: space.safeY, right: space.safeX, backgroundColor: 'rgba(0,0,0,0.7)', padding: space.sm, borderRadius: radius.sm },
  debugText: { color: '#9EF59E', fontSize: 12, fontFamily: 'monospace' },
});
