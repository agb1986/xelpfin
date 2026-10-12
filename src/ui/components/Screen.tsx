import React from 'react';
import { StyleSheet, Text, View, type ViewProps } from 'react-native';
import { colors, font, space } from '../theme';

/** Full-screen background with optional title, inside the overscan-safe area. */
export function Screen({ title, children, padded = true, style, ...rest }: ViewProps & { title?: string; padded?: boolean }) {
  return (
    <View style={[styles.root, padded && styles.padded, style]} {...rest}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  padded: { paddingHorizontal: space.safeX, paddingTop: space.safeY },
  title: { color: colors.text, fontSize: font.title, fontWeight: '700', marginBottom: space.lg },
});
