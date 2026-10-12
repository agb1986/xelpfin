import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Library } from '../../backend/types';
import { useNavigation } from '../../state/navigation';
import { colors, font, radius, space } from '../theme';
import { Focusable } from './Focusable';

function Tab({ label, onPress, testID, active }: { label: string; onPress(): void; testID: string; active?: boolean }) {
  return (
    <Focusable testID={testID} onPress={onPress} style={focused => [styles.tab, focused && styles.tabFocused]}>
      {focused => <Text style={[styles.tabText, active && styles.tabActive, focused && styles.tabTextFocused]}>{label}</Text>}
    </Focusable>
  );
}

/** Wordmark plus the main destinations. Shown on home; other screens are reached from it. */
export function TopBar({ libraries, current }: { libraries: Library[]; current?: string }) {
  const nav = useNavigation();
  return (
    <View style={styles.bar}>
      <Text style={styles.logo}>xelpfin</Text>
      <Tab label="Home" testID="tab-home" active={current === 'home'} onPress={() => nav.reset([{ name: 'home' }])} />
      {libraries.map(lib => (
        <Tab
          key={lib.id}
          label={lib.name}
          testID={`tab-lib-${lib.name}`}
          active={current === lib.id}
          onPress={() => nav.push({ name: 'library', library: lib })}
        />
      ))}
      <View style={styles.spacer} />
      <Tab label="Search" testID="tab-search" onPress={() => nav.push({ name: 'search' })} />
      <Tab label="Settings" testID="tab-settings" onPress={() => nav.push({ name: 'settings' })} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.safeX, paddingTop: space.safeY, paddingBottom: space.sm },
  logo: { color: colors.accent, fontSize: 28, fontWeight: '800', marginRight: space.xl, letterSpacing: 1 },
  spacer: { flex: 1 },
  tab: { paddingHorizontal: space.md, paddingVertical: space.xs + 2, borderRadius: radius.lg, marginRight: space.xs },
  tabFocused: { backgroundColor: colors.accent },
  tabText: { color: colors.textDim, fontSize: font.body, fontWeight: '600' },
  tabActive: { color: colors.text },
  tabTextFocused: { color: colors.accentText },
});
