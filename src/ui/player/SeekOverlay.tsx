import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type {
  ItemDetail,
  PlaybackPlan,
  Trickplay,
} from '../../backend/types';
import { episodeCode } from '../../player/seeking';
import { formatDuration } from '../hooks';
import { colors, font, space } from '../theme';
import { PREVIEW_WIDTH, previewHeight, SeekPreview } from './SeekPreview';

/** "Series · S01E02 · Name" for an episode, else the item's name. */
function titleOf(item: ItemDetail | undefined): string {
  if (!item) {
    return '';
  }
  if (item.kind !== 'episode' || !item.seriesName) {
    return item.name;
  }
  const code = episodeCode(item.parentIndexNumber, item.indexNumber);
  return [item.seriesName, code, item.name].filter(Boolean).join(' · ');
}

/**
 * The panel at the bottom of the screen: title, progress bar and times. A seek shows it on its
 * own; the controls add their buttons as children, and the scene navigator sits above it.
 */
export function SeekOverlay({
  item,
  plan,
  positionMs,
  bufferedMs,
  totalMs,
  pending,
  trickplay,
  onHeight,
  above,
  children,
}: {
  item?: ItemDetail;
  plan?: PlaybackPlan;
  positionMs: number;
  bufferedMs: number;
  totalMs: number;
  /** A rewind/forward burst not committed yet; the bar shows its target. */
  pending?: { target: number; delta: number };
  /** Seek preview thumbnails; without them the preview shows the chapter's image, if any. */
  trickplay?: Trickplay;
  /** The panel's height, so subtitles can be lifted clear of it. */
  onHeight(height: number): void;
  above?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const shown = pending?.target ?? positionMs;
  const pct = totalMs ? Math.min(1, shown / totalMs) : 0;
  const bufPct = totalMs ? Math.min(1, bufferedMs / totalMs) : 0;
  const [barWidth, setBarWidth] = useState(0);
  return (
    <View
      style={styles.overlay}
      testID="player-overlay"
      onLayout={e => onHeight(e.nativeEvent.layout.height)}
    >
      {above}
      <Text style={styles.title} numberOfLines={1}>
        {titleOf(item)}
      </Text>
      <View onLayout={e => setBarWidth(e.nativeEvent.layout.width)}>
        {pending ? (
          // Above the bar, centred on the target and kept inside the bar's ends.
          <View
            style={[
              styles.preview,
              {
                left: Math.max(
                  0,
                  Math.min(
                    barWidth - PREVIEW_WIDTH,
                    pct * barWidth - PREVIEW_WIDTH / 2,
                  ),
                ),
                top: -previewHeight(trickplay) - space.sm,
              },
            ]}
          >
            <SeekPreview
              trickplay={trickplay}
              chapters={item?.chapters}
              targetMs={pending.target}
            />
          </View>
        ) : null}
        <View style={styles.bar}>
          <View style={[styles.barBuffered, { width: `${bufPct * 100}%` }]} />
          <View style={[styles.barFill, { width: `${pct * 100}%` }]} />
        </View>
      </View>
      <View style={styles.times}>
        <Text style={styles.time} testID="player-position">
          {formatDuration(shown)}
        </Text>
        <Text
          style={pending ? styles.timePending : styles.time}
          testID="player-pending"
        >
          {pending
            ? `${pending.delta < 0 ? '−' : '+'}${formatDuration(Math.abs(pending.delta))}`
            : plan
              ? plan.method.replace(/([a-z])([A-Z])/g, '$1 $2')
              : ''}
        </Text>
        <Text style={styles.time}>{formatDuration(totalMs)}</Text>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
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
  title: {
    color: colors.text,
    fontSize: font.title,
    fontWeight: '700',
    marginBottom: space.md,
  },
  preview: { position: 'absolute' },
  bar: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surfaceHi,
    overflow: 'hidden',
  },
  barBuffered: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.textDim,
    opacity: 0.4,
  },
  barFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.accent,
  },
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: space.xs,
  },
  time: { color: colors.textDim, fontSize: font.small },
  timePending: {
    color: colors.accent,
    fontSize: font.small,
    fontWeight: '700',
  },
});
