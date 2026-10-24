import React from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { MediaItem } from '../../backend/types';
import { episodeCode } from '../../player/seeking';
import { Focusable } from '../components';
import { space } from '../theme';
import { thumbStyles } from './thumbStyles';

/** The strip Down opens below the bar: the episodes after this one, the next one focused. */
export function EpisodeReel({
  episodes,
  onPick,
}: {
  episodes: MediaItem[];
  onPick(episode: MediaItem): void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.reel}
      testID="player-episodes"
    >
      {episodes.map((ep, i) => {
        const image = ep.thumbUrl ?? ep.posterUrl;
        return (
          <Focusable
            key={ep.id}
            hasTVPreferredFocus={i === 0}
            testID={`player-episode-${i}`}
            onPress={() => onPick(ep)}
            style={(f: boolean) => [
              thumbStyles.card,
              f && thumbStyles.cardFocused,
            ]}
          >
            {image ? (
              <Image source={{ uri: image }} style={thumbStyles.image} />
            ) : (
              <View style={thumbStyles.image} />
            )}
            <Text style={thumbStyles.time}>
              {episodeCode(ep.parentIndexNumber, ep.indexNumber)}
            </Text>
            <Text style={thumbStyles.name} numberOfLines={1}>
              {ep.name}
            </Text>
          </Focusable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  reel: { marginTop: space.md },
});
