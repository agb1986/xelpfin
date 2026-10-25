import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { MediaSegment } from '../../backend/types';
import { getEngine } from '../../player';
import { activeSegment } from '../../player/seeking';
import { useApp } from '../../state/AppState';
import { useIsActive, useNavigation } from '../../state/navigation';
import { Button, ErrorView, Focusable, LoadingView } from '../components';
import { ControlsOverlay } from '../player/ControlsOverlay';
import { DebugOverlay } from '../player/DebugOverlay';
import { segmentKey } from '../player/overlayState';
import { PlayerSubtitles } from '../player/PlayerSubtitles';
import { SceneNavigator } from '../player/SceneNavigator';
import { SeekOverlay } from '../player/SeekOverlay';
import { TrickplayPrefetch } from '../player/SeekPreview';
import { ExitHint, SkipSegmentHint } from '../player/SkipSegmentButton';
import { TrackPickers } from '../player/TrackPickers';
import { useNextEpisode } from '../player/useNextEpisode';
import { usePlaybackSession } from '../player/usePlaybackSession';
import { useRemoteKeys } from '../player/useRemoteKeys';
import { useSeekController } from '../player/useSeekController';
import { useTrickplay } from '../player/useTrickplay';
import { space } from '../theme';

/**
 * Full-screen playback: negotiates a plan with the backend, renders the engine view, reports
 * progress, and offers seek, audio and subtitle selection with the remote.
 */
export function PlayerScreen({
  itemId,
  startPositionMs = 0,
  shuffle = false,
}: {
  itemId: string;
  startPositionMs?: number;
  shuffle?: boolean;
}) {
  const { settings } = useApp();
  const nav = useNavigation();
  const active = useIsActive();
  const engine = getEngine();
  const [controlsHeight, setControlsHeight] = useState(0);

  const session = usePlaybackSession(itemId, startPositionMs, engine);
  const { item, plan, error, paused, buffering, position, segments } = session;
  const total = session.duration || plan?.durationMs || item?.runtimeMs || 0;
  const next = useNextEpisode(item, shuffle);
  const trickplay = useTrickplay(plan?.itemId, plan?.mediaSourceId);
  const seek = useSeekController({
    view: session.view,
    positionRef: session.positionRef,
    setPosition: session.setPosition,
    durationMs: session.duration || plan?.durationMs || 0,
    chapters: item?.chapters,
    totalMs: total,
  });
  const found =
    active && plan && !buffering
      ? activeSegment(segments, position)
      : undefined;
  const keys = useRemoteKeys({
    active,
    playing: plan,
    error,
    paused,
    hasEnded: session.hasEnded,
    upcomingCount: next.upcoming.length,
    segment: found,
    togglePaused: session.togglePaused,
    tapSeek: seek.tapSeek,
  });
  const { overlay, navigator, skip, showOverlay } = keys;

  const { seekTo } = seek;
  const { reportProgress } = session;
  const skipSegment = useCallback(
    (seg: MediaSegment) => {
      seekTo(seg.endMs);
      showOverlay('seek');
      // Tell the server right away so the resume point follows the skip.
      reportProgress();
    },
    [seekTo, showOverlay, reportProgress],
  );

  // Randomizer playback jumps straight past recaps, openings and credits instead of offering a button.
  const autoSkipped = useRef('');
  useEffect(() => {
    if (!shuffle || !active || !plan || buffering) {
      return;
    }
    const seg = activeSegment(segments, position);
    const key = seg && segmentKey(seg);
    if (seg && key !== autoSkipped.current) {
      autoSkipped.current = key!;
      skipSegment(seg);
    }
  }, [shuffle, active, plan, buffering, segments, position, skipSegment]);

  if (error) {
    return (
      <View style={styles.root} testID="player">
        <ErrorView error={error} onRetry={session.retry} hasTVPreferredFocus />
        <View style={styles.center}>
          <Button
            label="Back"
            onPress={() => nav.back()}
            testID="player-back"
          />
        </View>
      </View>
    );
  }

  const scenes = navigator === 'scenes' ? seek.scenes : [];

  return (
    <View style={styles.root} testID="player">
      {plan ? (
        <engine.View
          key={plan.playSessionId + plan.url}
          ref={session.view}
          plan={plan}
          paused={paused || !active}
          audioStreamIndex={session.audio}
          subtitleStreamIndex={session.subtitle}
          subtitleSize={settings.subtitleSize}
          {...session.viewProps}
          onEnd={() => {
            if (session.finish()) {
              next.playNext();
            }
          }}
        />
      ) : null}
      <PlayerSubtitles
        plan={plan}
        subtitle={session.subtitle}
        positionMs={position}
        lift={overlay !== 'hidden' ? controlsHeight : 0}
      />

      {/* Holds focus while the controls are hidden so remote keys still reach the player. */}
      {overlay !== 'controls' ? (
        <Focusable
          ref={keys.surface}
          testID="player-surface"
          hasTVPreferredFocus
          style={StyleSheet.absoluteFill}
          onPress={() => (skip ? skipSegment(skip) : showOverlay('controls'))}
        >
          <View />
        </Focusable>
      ) : null}

      {!plan || buffering ? (
        <View style={styles.spinner} pointerEvents="none">
          <LoadingView />
        </View>
      ) : null}

      {settings.showDebugOverlay && plan ? (
        <DebugOverlay
          engineName={engine.name}
          plan={plan}
          audio={session.audio}
          subtitle={session.subtitle}
          bufferedMs={session.buffered}
        />
      ) : null}

      <TrickplayPrefetch
        trickplay={trickplay}
        positionMs={seek.pending?.target ?? position}
      />

      {skip && overlay === 'hidden' ? <SkipSegmentHint segment={skip} /> : null}
      {keys.exitHint ? <ExitHint /> : null}

      {overlay !== 'hidden' ? (
        <SeekOverlay
          item={item}
          plan={plan}
          positionMs={position}
          bufferedMs={session.buffered}
          totalMs={total}
          pending={seek.pending}
          trickplay={trickplay}
          onHeight={setControlsHeight}
          above={
            scenes.length ? (
              <SceneNavigator
                scenes={scenes}
                current={seek.sceneIndex(position)}
                onPick={sc => {
                  seekTo(sc.startMs);
                  keys.closeNavigator();
                }}
              />
            ) : null
          }
        >
          {overlay === 'controls' ? (
            <ControlsOverlay
              plan={plan}
              skip={skip}
              claimFocus={keys.claimFocus.current}
              paused={paused}
              shuffle={shuffle}
              showReel={navigator === 'episodes'}
              upcoming={next.upcoming}
              previous={next.previous}
              audio={session.audio}
              subtitle={session.subtitle}
              onSkip={skipSegment}
              onTogglePause={keys.togglePause}
              onGoTo={next.goTo}
              onPlayRandom={next.playRandom}
              onSeekBy={delta => {
                seek.seekBy(delta);
                showOverlay('controls');
              }}
              onPicker={keys.setPicker}
            />
          ) : null}
        </SeekOverlay>
      ) : null}

      {plan ? (
        <TrackPickers
          plan={plan}
          picker={keys.picker}
          audio={session.audio}
          subtitle={session.subtitle}
          onAudio={session.chooseAudio}
          onSubtitle={session.chooseSubtitle}
          onClose={() => keys.setPicker(undefined)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: {
    position: 'absolute',
    bottom: space.xl * 2,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  spinner: { ...StyleSheet.absoluteFillObject, justifyContent: 'center' },
});
