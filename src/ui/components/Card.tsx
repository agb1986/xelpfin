import React, { memo, useEffect, useRef, useState } from 'react';
import { findNodeHandle, Image, StyleSheet, Text, View } from 'react-native';
import type { MediaItem } from '../../backend/types';
import { card, colors, focusScale, font, radius, space } from '../theme';
import { Focusable } from './Focusable';

export type CardVariant = 'poster' | 'thumb';

export function itemSubtitle(item: MediaItem): string | undefined {
  if (item.kind === 'episode') {
    const se =
      item.parentIndexNumber !== undefined && item.indexNumber !== undefined
        ? `S${item.parentIndexNumber}:E${item.indexNumber}`
        : undefined;
    return [item.seriesName, se].filter(Boolean).join(' · ') || undefined;
  }
  if (item.kind === 'season') {
    return undefined;
  }
  return item.year ? String(item.year) : undefined;
}

export function progressOf(item: MediaItem): number {
  const ud = item.userData;
  // Only things you can resume have progress; collections and series report a watched share instead.
  if (
    !ud ||
    ud.played ||
    (item.kind !== 'movie' && item.kind !== 'episode' && item.kind !== 'video')
  ) {
    return 0;
  }
  if (ud.playedPercentage) {
    return ud.playedPercentage / 100;
  }
  return item.runtimeMs && ud.playbackPositionMs
    ? Math.min(1, ud.playbackPositionMs / item.runtimeMs)
    : 0;
}

export function imageFor(
  item: MediaItem,
  variant: CardVariant,
): string | undefined {
  return variant === 'poster'
    ? (item.posterUrl ?? item.thumbUrl)
    : (item.thumbUrl ?? item.backdropUrl ?? item.posterUrl);
}

export const cardSize = (variant: CardVariant) => card[variant];

/**
 * Device pixels a card's image needs: its dp size at the focus scale, at the given density.
 * The backend's image boxes are derived from this at density 2 so the server never sends a
 * bigger image than a focused card shows.
 */
export function cardImagePixels(
  variant: CardVariant,
  density = 2,
): { width: number; height: number } {
  const { width, height } = card[variant];
  return {
    width: Math.ceil(width * focusScale * density),
    height: Math.ceil(height * focusScale * density),
  };
}

/** Remembers what has been prefetched so scrolling back and forth does not re-request it. */
const prefetched = new Set<string>();
const PREFETCH_MEMORY = 2000;

/**
 * Warms the image cache with the card images of items that are not on screen yet, such as the
 * next page of a grid. Failures are ignored: the card simply loads the image itself later.
 */
export function prefetchCardImages(
  items: readonly MediaItem[],
  variant: CardVariant,
): number {
  let started = 0;
  for (const item of items) {
    const uri = imageFor(item, variant);
    if (!uri || prefetched.has(uri)) {
      continue;
    }
    if (prefetched.size >= PREFETCH_MEMORY) {
      prefetched.clear();
    }
    prefetched.add(uri);
    started++;
    const forget = () => prefetched.delete(uri);
    try {
      Promise.resolve(Image.prefetch(uri)).then(ok => {
        if (ok === false) {
          forget();
        }
      }, forget);
    } catch {
      forget();
    }
  }
  return started;
}

/** Test hook: forgets what was prefetched. */
export function resetCardPrefetch(): void {
  prefetched.clear();
}
/** Full width a card takes in a row, for getItemLayout. */
export const cardStride = (variant: CardVariant) =>
  card[variant].width + card.gap;
/** Room under the image for the title and subtitle; fixed so every card has the same height. */
export const cardLabelHeight = 52;
/** Full height of a card including its labels, for getItemLayout in grids. */
export const cardHeight = (variant: CardVariant) =>
  card[variant].height + cardLabelHeight;

interface CardProps {
  item: MediaItem;
  variant: CardVariant;
  onPress(item: MediaItem): void;
  onFocus?(item: MediaItem): void;
  hasTVPreferredFocus?: boolean;
  /** Last card of a row: D-pad right stays here instead of jumping to whatever is nearest. */
  lastInRow?: boolean;
  /** Title under the image; thumbs of episodes show the episode name with the series as subtitle. */
  title?: string;
  testID?: string;
}

export const Card = memo(function Card({
  item,
  variant,
  onPress,
  onFocus,
  hasTVPreferredFocus,
  lastInRow,
  title,
  testID,
}: CardProps) {
  const ref = useRef<View>(null);
  // Pointing nextFocusRight at the card itself is how Android is told "nothing further right".
  const [self, setSelf] = useState<number>();
  useEffect(() => {
    if (lastInRow) {
      setSelf(findNodeHandle(ref.current) ?? undefined);
    }
  }, [lastInRow]);
  const size = card[variant];
  const uri = imageFor(item, variant);
  const progress = progressOf(item);
  const subtitle = itemSubtitle(item);
  const unplayed =
    item.kind === 'series' ? item.userData?.unplayedItemCount : undefined;
  return (
    <Focusable
      ref={ref}
      nextFocusRight={lastInRow ? self : undefined}
      testID={testID ?? `card-${item.id}`}
      accessibilityLabel={item.name}
      onPress={() => onPress(item)}
      onFocus={() => onFocus?.(item)}
      hasTVPreferredFocus={hasTVPreferredFocus}
      style={[styles.wrap, { width: size.width }]}
    >
      {focused => (
        <>
          <View style={[styles.frame, size, focused && styles.frameFocused]}>
            {uri ? (
              <Image
                source={{ uri }}
                style={styles.image}
                resizeMode="cover"
                resizeMethod="resize"
                fadeDuration={0}
              />
            ) : (
              <View style={[styles.image, styles.placeholder]}>
                <Text style={styles.placeholderText} numberOfLines={3}>
                  {item.name}
                </Text>
              </View>
            )}
            {item.userData?.played ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>✓</Text>
              </View>
            ) : unplayed ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unplayed}</Text>
              </View>
            ) : null}
            {progress > 0 ? (
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${Math.max(4, progress * 100)}%` },
                  ]}
                />
              </View>
            ) : null}
          </View>
          <View style={styles.labels}>
            <Text
              style={[styles.title, focused && styles.titleFocused]}
              numberOfLines={1}
            >
              {title ?? item.name}
            </Text>
            {subtitle ? (
              <Text style={styles.subtitle} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>
        </>
      )}
    </Focusable>
  );
});

const styles = StyleSheet.create({
  wrap: { marginRight: card.gap },
  frame: {
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  frameFocused: {
    borderColor: colors.accent,
    transform: [{ scale: focusScale }],
  },
  image: { width: '100%', height: '100%' },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.sm,
    backgroundColor: colors.surfaceHi,
  },
  placeholderText: {
    color: colors.textDim,
    fontSize: font.body,
    textAlign: 'center',
  },
  badge: {
    position: 'absolute',
    top: space.xs,
    right: space.xs,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 5,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: colors.accentText, fontSize: 12, fontWeight: '700' },
  progressTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  progressFill: { height: 4, backgroundColor: colors.accent },
  labels: { height: cardLabelHeight },
  title: {
    color: colors.textDim,
    fontSize: font.small,
    marginTop: space.sm,
    fontWeight: '600',
  },
  titleFocused: { color: colors.text },
  subtitle: { color: colors.textDim, fontSize: 12, opacity: 0.8 },
});
