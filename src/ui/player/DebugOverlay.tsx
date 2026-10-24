import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { PlaybackPlan } from '../../backend/types';
import { formatDuration } from '../hooks';
import { radius, space } from '../theme';

/** How the item is being played, for the "Show debug overlay" setting. */
export function DebugOverlay({
  engineName,
  plan,
  audio,
  subtitle,
  bufferedMs,
}: {
  engineName: string;
  plan: PlaybackPlan;
  audio?: number;
  subtitle: number;
  bufferedMs: number;
}) {
  return (
    <View style={styles.debug} pointerEvents="none" testID="player-debug">
      <Text style={styles.debugText}>engine {engineName}</Text>
      <Text style={styles.debugText}>
        {plan.method} · {plan.streamType} · {plan.container ?? '?'}
      </Text>
      {plan.reasons.length ? (
        <Text style={styles.debugText}>{plan.reasons.join(', ')}</Text>
      ) : null}
      <Text style={styles.debugText}>
        audio {audio ?? 'default'} · subtitle {subtitle} · buffered{' '}
        {formatDuration(bufferedMs)}
      </Text>
      <Text style={styles.debugText}>
        session {plan.playSessionId.slice(0, 8)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  debug: {
    position: 'absolute',
    top: space.safeY,
    right: space.safeX,
    backgroundColor: 'rgba(0,0,0,0.7)',
    padding: space.sm,
    borderRadius: radius.sm,
  },
  debugText: { color: '#9EF59E', fontSize: 12, fontFamily: 'monospace' },
});
