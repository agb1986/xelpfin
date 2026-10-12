import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { cueTextAt, type Cue } from '../../player/webvtt';

/** Draws the current subtitle cue over the video, lifted above the controls when they show. */
export function SubtitleText({ cues, positionMs, raised }: { cues: Cue[]; positionMs: number; raised?: boolean }) {
  const text = cues.length ? cueTextAt(cues, positionMs) : '';
  if (!text) {
    return null;
  }
  return (
    <View style={[styles.wrap, raised && styles.raised]} pointerEvents="none" testID="player-subtitle-text">
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 36, alignItems: 'center', paddingHorizontal: 48 },
  raised: { bottom: 180 },
  text: {
    color: '#fff',
    fontSize: 22,
    lineHeight: 30,
    fontWeight: '600',
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 6,
  },
});
