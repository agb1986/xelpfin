import React from 'react';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';
import { cueTextAt, type Cue } from '../../player/webvtt';
import type { SubtitleBackground } from '../../state/settings';

export interface SubtitleLook {
  size: number;
  color: string;
  background: SubtitleBackground;
}

const DEFAULT_LOOK: SubtitleLook = {
  size: 22,
  color: '#ffffff',
  background: 'box',
};

/** Text style for a subtitle look; exported for tests. */
export function subtitleTextStyle(look: SubtitleLook): TextStyle {
  const base: TextStyle = {
    color: look.color,
    fontSize: look.size,
    lineHeight: Math.round(look.size * 1.35),
  };
  switch (look.background) {
    case 'solid':
      return { ...base, backgroundColor: '#000' };
    case 'shadow':
      return {
        ...base,
        textShadowColor: '#000',
        textShadowOffset: { width: 0, height: 0 },
        textShadowRadius: 4,
      };
    default:
      return { ...base, backgroundColor: 'rgba(0,0,0,0.6)' };
  }
}

/**
 * Draws the current subtitle cue over the video. `lift` is the height of whatever covers the
 * bottom of the screen (the player controls); the cue is drawn just above it.
 */
export function SubtitleText({
  cues,
  positionMs,
  lift = 0,
  look = DEFAULT_LOOK,
}: {
  cues: Cue[];
  positionMs: number;
  lift?: number;
  look?: SubtitleLook;
}) {
  const text = cues.length ? cueTextAt(cues, positionMs) : '';
  if (!text) {
    return null;
  }
  return (
    <View
      style={[styles.wrap, lift > 0 && { bottom: lift + 12 }]}
      pointerEvents="none"
      testID="player-subtitle-text"
    >
      <Text style={[styles.text, subtitleTextStyle(look)]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 36,
    alignItems: 'center',
    paddingHorizontal: 48,
  },
  text: {
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 6,
  },
});
