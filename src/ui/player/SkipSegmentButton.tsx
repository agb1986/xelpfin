import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { MediaSegment } from '../../backend/types';
import { skipLabel } from '../../player/seeking';
import { Button } from '../components';
import { colors, font, radius, space } from '../theme';

/** "Skip intro" in the controls row; it takes focus first when the controls come up. */
export function SkipSegmentButton({
  segment,
  claimFocus,
  onSkip,
}: {
  segment: MediaSegment;
  claimFocus: boolean;
  onSkip(segment: MediaSegment): void;
}) {
  return (
    <Button
      variant="primary"
      hasTVPreferredFocus={claimFocus}
      label={skipLabel(segment.kind)}
      onPress={() => onSkip(segment)}
      testID="player-skip"
    />
  );
}

/** The corner hint while the controls are hidden: OK on the surface skips the segment. */
export function SkipSegmentHint({ segment }: { segment: MediaSegment }) {
  return (
    <View style={styles.skip} pointerEvents="none" testID="player-skip-hint">
      <Text style={styles.skipText}>
        {skipLabel(segment.kind)} <Text style={styles.skipSub}>· OK</Text>
      </Text>
    </View>
  );
}

/** Shown after the first BACK with nothing on screen. */
export function ExitHint() {
  return (
    <View style={styles.hint} pointerEvents="none" testID="player-exit-hint">
      <Text style={styles.hintText}>Press back again to exit</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  skip: {
    position: 'absolute',
    right: space.safeX,
    bottom: space.safeY + space.lg,
    backgroundColor: 'rgba(10,6,20,0.85)',
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
  skipText: { color: colors.text, fontSize: font.small, fontWeight: '700' },
  skipSub: { color: colors.textDim, fontSize: font.small },
  hint: {
    position: 'absolute',
    bottom: space.safeY + space.lg,
    alignSelf: 'center',
    backgroundColor: 'rgba(10,6,20,0.85)',
    borderRadius: radius.sm,
    padding: space.sm,
  },
  hintText: { color: colors.text, fontSize: font.small },
});
