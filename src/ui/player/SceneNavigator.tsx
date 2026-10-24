import React, { useRef } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Scene } from '../../player/seeking';
import { Focusable } from '../components';
import { formatDuration } from '../hooks';
import { space } from '../theme';
import { THUMB_CARD_WIDTH, thumbStyles } from './thumbStyles';

/** The strip Up opens above the bar: one card per chapter (or mark), the current one focused. */
export function SceneNavigator({
  scenes,
  current,
  onPick,
}: {
  scenes: Scene[];
  /** Index of the scene playing now; it takes focus and is scrolled into view. */
  current: number;
  onPick(scene: Scene): void;
}) {
  const scroll = useRef<ScrollView>(null);
  return (
    <ScrollView
      ref={scroll}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scenes}
      testID="player-scenes"
      // The card with preferred focus can start off-screen; bring it into view once.
      onContentSizeChange={() =>
        scroll.current?.scrollTo({
          x: Math.max(
            0,
            current * (THUMB_CARD_WIDTH + space.sm) - THUMB_CARD_WIDTH,
          ),
          animated: false,
        })
      }
    >
      {scenes.map((sc, i) => (
        <Focusable
          key={`${sc.startMs}-${i}`}
          hasTVPreferredFocus={i === current}
          testID={`player-scene-${i}`}
          onPress={() => onPick(sc)}
          style={(f: boolean) => [
            thumbStyles.card,
            f && thumbStyles.cardFocused,
          ]}
        >
          {sc.imageUrl ? (
            <Image source={{ uri: sc.imageUrl }} style={thumbStyles.image} />
          ) : (
            <View style={thumbStyles.image} />
          )}
          <Text style={thumbStyles.time}>{formatDuration(sc.startMs)}</Text>
          <Text style={thumbStyles.name} numberOfLines={1}>
            {sc.name}
          </Text>
        </Focusable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scenes: { marginBottom: space.md },
});
