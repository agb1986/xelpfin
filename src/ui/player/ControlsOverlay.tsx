import React from 'react';
import { StyleSheet, View } from 'react-native';
import type {
  MediaItem,
  MediaSegment,
  PlaybackPlan,
} from '../../backend/types';
import { Button } from '../components';
import { space } from '../theme';
import { EpisodeReel } from './EpisodeReel';
import type { Picker } from './overlayState';
import { SkipSegmentButton } from './SkipSegmentButton';
import { shortLabel } from './TrackPickers';
import { SEEK_STEP_MS, SKIP_STEP_MS } from './useSeekController';

/**
 * The controls under the bar: the next-episodes reel when Down opened it, then skip, play/pause,
 * previous/next, the seek steps and the track buttons.
 */
export function ControlsOverlay({
  plan,
  skip,
  claimFocus,
  paused,
  shuffle,
  showReel,
  upcoming,
  previous,
  audio,
  subtitle,
  onSkip,
  onTogglePause,
  onGoTo,
  onPlayRandom,
  onSeekBy,
  onPicker,
}: {
  plan?: PlaybackPlan;
  skip?: MediaSegment;
  /** True only while the controls are appearing; later renders leave focus where it is. */
  claimFocus: boolean;
  paused: boolean;
  shuffle: boolean;
  showReel: boolean;
  upcoming: MediaItem[];
  previous?: MediaItem;
  audio?: number;
  subtitle: number;
  onSkip(segment: MediaSegment): void;
  onTogglePause(): void;
  onGoTo(episode: MediaItem): void;
  onPlayRandom(): void;
  onSeekBy(deltaMs: number): void;
  onPicker(picker: Picker): void;
}) {
  const audioLabel = plan?.audioTracks.find(a => a.index === audio)?.label;
  const subLabel =
    subtitle >= 0
      ? plan?.subtitleTracks.find(s => s.index === subtitle)?.label
      : 'Off';
  return (
    <>
      {showReel && upcoming.length ? (
        <EpisodeReel episodes={upcoming} onPick={onGoTo} />
      ) : null}
      <View style={styles.buttons}>
        {skip ? (
          <SkipSegmentButton
            segment={skip}
            claimFocus={claimFocus}
            onSkip={onSkip}
          />
        ) : null}
        <Button
          variant={skip ? undefined : 'primary'}
          hasTVPreferredFocus={claimFocus && !skip}
          label={paused ? '▶ Play' : '❚❚ Pause'}
          onPress={onTogglePause}
          testID="player-playpause"
        />
        {shuffle ? (
          <Button
            label="Next ▶▶"
            onPress={onPlayRandom}
            testID="player-next-episode"
          />
        ) : (
          <>
            {previous ? (
              <Button
                label="◀◀ Previous"
                onPress={() => onGoTo(previous)}
                testID="player-prev-episode"
              />
            ) : null}
            {upcoming[0] ? (
              <Button
                label="Next ▶▶"
                onPress={() => onGoTo(upcoming[0])}
                testID="player-next-episode"
              />
            ) : null}
          </>
        )}
        <Button
          label="−10 s"
          onPress={() => onSeekBy(-SEEK_STEP_MS)}
          testID="player-rew"
        />
        <Button
          label="+30 s"
          onPress={() => onSeekBy(SKIP_STEP_MS)}
          testID="player-ffwd"
        />
        {plan && plan.audioTracks.length > 1 ? (
          <Button
            label={`Audio: ${shortLabel(audioLabel) ?? 'default'}`}
            onPress={() => onPicker('audio')}
            testID="player-audio"
          />
        ) : null}
        {plan && plan.subtitleTracks.length > 0 ? (
          <Button
            label={`Subtitles: ${shortLabel(subLabel) ?? 'Off'}`}
            onPress={() => onPicker('subtitles')}
            testID="player-subtitles"
          />
        ) : null}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  buttons: { flexDirection: 'row', marginTop: space.md },
});
