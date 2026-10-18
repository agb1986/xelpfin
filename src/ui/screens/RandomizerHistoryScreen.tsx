import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { episodeCode } from '../../player/seeking';
import { useBackend } from '../../state/AppState';
import { useNavigation } from '../../state/navigation';
import { loadHistory, recentDraws, useRandomizer } from '../../state/randomizer';
import { EmptyView, ErrorView, Focusable, LoadingView, Screen, bleed } from '../components';
import { useAsync } from '../hooks';
import { colors, font, radius, space } from '../theme';
import { openItem } from './navigate';

/** How many of the latest Randomizer picks the list shows. */
export const HISTORY_SHOWN = 25;

/** The episodes the Randomizer drew most recently, newest first. */
export function RandomizerHistoryScreen() {
  const backend = useBackend();
  const nav = useNavigation();
  const randomizer = useRandomizer();
  const ids = recentDraws(randomizer.state, HISTORY_SHOWN);
  const key = ids.join(',');
  const history = useAsync(() => loadHistory(backend, ids), [backend, key]);

  return (
    <Screen title="Randomizer history" testID="randomizer-history">
      {history.status === 'error' ? (
        <ErrorView error={history.error} onRetry={history.reload} hasTVPreferredFocus />
      ) : !ids.length ? (
        <EmptyView title="Nothing played yet" message="Episodes the Randomizer picks show up here." />
      ) : !history.data ? (
        <LoadingView />
      ) : (
        <ScrollView style={bleed.outer} contentContainerStyle={[bleed.inner, styles.body]}>
          {history.data.map((ep, i) => {
            const code = episodeCode(ep.parentIndexNumber, ep.indexNumber);
            return (
              <Focusable
                key={ep.id}
                testID={`history-${i}`}
                hasTVPreferredFocus={i === 0}
                onPress={() => openItem(nav, ep)}
                style={focused => [styles.row, focused && styles.rowFocused]}>
                {focused => (
                  <>
                    <Text style={[styles.show, focused && styles.textOn]} numberOfLines={1}>
                      {[ep.seriesName, code].filter(Boolean).join(' · ')}
                    </Text>
                    <Text style={[styles.name, focused && styles.textOn]} numberOfLines={1}>
                      {ep.name}
                    </Text>
                  </>
                )}
              </Focusable>
            );
          })}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { paddingBottom: space.xl, maxWidth: 760 },
  row: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.md, marginBottom: space.xs },
  rowFocused: { backgroundColor: colors.accent },
  show: { color: colors.textDim, fontSize: font.small },
  name: { color: colors.text, fontSize: font.body, marginTop: space.xs },
  textOn: { color: colors.accentText },
});
