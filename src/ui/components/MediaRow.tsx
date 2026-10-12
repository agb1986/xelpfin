import React, { useCallback } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import type { MediaItem } from '../../backend/types';
import { card, colors, font, space } from '../theme';
import { Card, cardSize, cardStride, type CardVariant } from './Card';

interface MediaRowProps {
  title: string;
  items: MediaItem[];
  variant: CardVariant;
  onPress(item: MediaItem): void;
  /** Episode thumbs show the episode title; others show the item name. */
  titleFor?(item: MediaItem): string;
  preferFirst?: boolean;
  testID?: string;
}

/**
 * Horizontal, virtualised row of cards. Fixed card sizes let FlatList skip measuring
 * (getItemLayout), which keeps D-pad scrolling smooth on low-end Fire TV hardware.
 */
export function MediaRow({ title, items, variant, onPress, titleFor, preferFirst, testID }: MediaRowProps) {
  const stride = cardStride(variant);
  const getItemLayout = useCallback((_: unknown, index: number) => ({ length: stride, offset: stride * index, index }), [stride]);
  const renderItem = useCallback(
    ({ item, index }: { item: MediaItem; index: number }) => (
      <Card item={item} variant={variant} onPress={onPress} title={titleFor?.(item)} hasTVPreferredFocus={preferFirst && index === 0} />
    ),
    [variant, onPress, titleFor, preferFirst],
  );
  if (items.length === 0) {
    return null;
  }
  const h = cardSize(variant).height + 52 + card.focusPad * 2;
  return (
    <View style={styles.row} testID={testID}>
      <Text style={styles.title}>{title}</Text>
      <FlatList
        horizontal
        data={items}
        keyExtractor={i => i.id}
        renderItem={renderItem}
        getItemLayout={getItemLayout}
        initialNumToRender={8}
        maxToRenderPerBatch={6}
        windowSize={5}
        showsHorizontalScrollIndicator={false}
        style={{ height: h }}
        contentContainerStyle={styles.content}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { marginBottom: space.sm },
  title: { color: colors.text, fontSize: font.heading, fontWeight: '700', marginLeft: space.safeX, marginBottom: space.xs },
  content: { paddingHorizontal: space.safeX, paddingVertical: card.focusPad },
});
