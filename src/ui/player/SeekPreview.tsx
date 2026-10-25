import React, { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import type { Chapter, Trickplay } from '../../backend/types';
import {
  chapterImageAt,
  frameLayout,
  sheetsAround,
  trickplayFrame,
} from '../../player/trickplay';
import { colors, radius } from '../theme';

/** Width of the preview above the seek bar; the height follows the thumbnail's aspect ratio. */
export const PREVIEW_WIDTH = 256;

/**
 * The picture at a seek target: the trickplay thumbnail when the server has them, else the image
 * of the chapter the target falls in, else nothing (the time under the bar is all there is).
 */
export function SeekPreview({
  trickplay,
  chapters,
  targetMs,
}: {
  trickplay?: Trickplay;
  chapters?: Chapter[];
  targetMs: number;
}) {
  // The real size of each loaded sheet, and sheets that would not load.
  const [sizes, setSizes] = useState<
    Record<string, { width: number; height: number }>
  >({});
  const [failed, setFailed] = useState<Record<string, true>>({});
  const frame = trickplay ? trickplayFrame(trickplay, targetMs) : undefined;
  if (trickplay && frame && !failed[frame.url]) {
    const box = frameLayout(trickplay, frame, PREVIEW_WIDTH, sizes[frame.url]);
    const url = frame.url;
    return (
      <View
        style={[styles.box, { width: box.width, height: box.height }]}
        testID="seek-preview"
      >
        <Image
          testID="seek-preview-sheet"
          source={{ uri: url, headers: trickplay.headers }}
          fadeDuration={0}
          style={[
            styles.sheet,
            {
              width: box.sheetWidth,
              height: box.sheetHeight,
              left: box.left,
              top: box.top,
            },
          ]}
          onLoad={e => {
            const { width, height } = e.nativeEvent.source ?? {};
            if (width > 0 && height > 0) {
              setSizes(s => ({ ...s, [url]: { width, height } }));
            }
          }}
          onError={() => setFailed(f => ({ ...f, [url]: true }))}
        />
      </View>
    );
  }
  const chapterImage = chapterImageAt(chapters, targetMs);
  if (!chapterImage) {
    return null;
  }
  return (
    <View
      style={[styles.box, { width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT }]}
      testID="seek-preview"
    >
      <Image
        testID="seek-preview-chapter"
        source={{ uri: chapterImage }}
        fadeDuration={0}
        resizeMode="cover"
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

const PREVIEW_HEIGHT = (PREVIEW_WIDTH * 9) / 16;

/** The height of the preview box, for placing it before a thumbnail has loaded. */
export function previewHeight(trickplay: Trickplay | undefined): number {
  return trickplay
    ? (PREVIEW_WIDTH * trickplay.height) / trickplay.width
    : PREVIEW_HEIGHT;
}

/**
 * Loads the sheets around a position without showing them, so the first seek and a scrub across
 * a sheet boundary find them in the image cache. `Image.prefetch` cannot send the Authorization
 * header the sheets need, so this renders invisible one-pixel images instead; they are decoded at
 * that size, which keeps only the downloaded bytes, not full-size bitmaps, in memory.
 */
export function TrickplayPrefetch({
  trickplay,
  positionMs,
}: {
  trickplay?: Trickplay;
  positionMs: number;
}) {
  if (!trickplay) {
    return null;
  }
  return (
    <View style={styles.hidden} pointerEvents="none">
      {sheetsAround(trickplay, positionMs).map(url => (
        <Image
          key={url}
          testID="trickplay-prefetch"
          source={{ uri: url, headers: trickplay.headers }}
          resizeMethod="resize"
          style={styles.pixel}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    overflow: 'hidden',
    // No border: it would sit inside the box and shift the sheet's offsets.
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  sheet: { position: 'absolute' },
  hidden: { position: 'absolute', left: 0, top: 0, opacity: 0 },
  pixel: { width: 1, height: 1 },
});
