import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Image, StyleSheet, Text, View } from 'react-native';
import type { MediaItem } from '../../backend/types';
import { episodeCode } from '../../player/seeking';
import { Button } from '../components';
import { colors, font, radius, space } from '../theme';

/** Seconds the card counts down before the next episode starts by itself. */
export const NEXT_EPISODE_COUNTDOWN_S = 10;

/**
 * "Up next" over the credits: the next episode with a countdown, Play now and Cancel. BACK
 * cancels. Play now holds focus; the player's own keys are off while the card is up.
 */
export function NextEpisodeCard({
  episode,
  onPlay,
  onCancel,
}: {
  episode: MediaItem;
  onPlay(): void;
  onCancel(): void;
}) {
  const [left, setLeft] = useState(NEXT_EPISODE_COUNTDOWN_S);
  const handlers = useRef({ onPlay, onCancel });
  handlers.current = { onPlay, onCancel };
  const done = useRef(false);
  // Whichever of play, cancel or the countdown comes first wins.
  const finish = useCallback((fn: () => void) => {
    if (!done.current) {
      done.current = true;
      fn();
    }
  }, []);

  useEffect(() => {
    const t = setInterval(() => setLeft(n => n - 1), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (left <= 0) {
      finish(handlers.current.onPlay);
    }
  }, [left, finish]);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      finish(handlers.current.onCancel);
      return true;
    });
    return () => sub.remove();
  }, [finish]);

  const image = episode.thumbUrl ?? episode.posterUrl;
  const code = episodeCode(episode.parentIndexNumber, episode.indexNumber);
  return (
    <View style={styles.card} testID="next-card">
      {image ? (
        <Image source={{ uri: image }} style={styles.image} />
      ) : (
        <View style={styles.image} />
      )}
      <View style={styles.body}>
        <Text style={styles.kicker} testID="next-card-countdown">
          Up next in {Math.max(left, 0)}
        </Text>
        {episode.seriesName ? (
          <Text style={styles.series} numberOfLines={1}>
            {episode.seriesName}
          </Text>
        ) : null}
        <Text style={styles.title} numberOfLines={2} testID="next-card-title">
          {code ? `${code} · ` : ''}
          {episode.name}
        </Text>
        <View style={styles.row}>
          <Button
            variant="primary"
            compact
            hasTVPreferredFocus
            label="Play now"
            onPress={() => finish(onPlay)}
            testID="next-card-play"
          />
          <Button
            compact
            label="Cancel"
            onPress={() => finish(onCancel)}
            testID="next-card-cancel"
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    right: space.safeX,
    bottom: space.safeY + space.lg,
    flexDirection: 'row',
    backgroundColor: 'rgba(10,6,20,0.92)',
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: space.sm,
    elevation: 8,
  },
  image: {
    width: 256,
    height: 144,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  body: { marginLeft: space.sm, width: 320, justifyContent: 'space-between' },
  kicker: { color: colors.accent, fontSize: font.small, fontWeight: '700' },
  series: { color: colors.textDim, fontSize: font.small },
  title: { color: colors.text, fontSize: font.body, fontWeight: '700' },
  row: { flexDirection: 'row', gap: space.sm },
});
