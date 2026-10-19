import React, { useCallback, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import type { MediaItem } from '../../backend/types';
import { useBackend } from '../../state/AppState';
import { useNavigation } from '../../state/navigation';
import {
  Card,
  cardHeight,
  cardStride,
  EmptyView,
  ErrorView,
  Screen,
  TextField,
} from '../components';
import { useAsync, useDebounced } from '../hooks';
import { card, colors, font, space } from '../theme';
import { openItem } from './navigate';

/** Search across all libraries, as you type (debounced). */
export function SearchScreen() {
  const backend = useBackend();
  const nav = useNavigation();
  const { width } = useWindowDimensions();
  const [text, setText] = useState('');
  const term = useDebounced(text.trim(), 400);
  const results = useAsync(
    async () => (term.length >= 2 ? backend.search(term, 48) : []),
    [backend, term],
  );
  const open = useCallback((item: MediaItem) => openItem(nav, item), [nav]);
  const columns = Math.max(
    3,
    Math.floor((width - space.safeX * 2) / cardStride('poster')),
  );
  const renderItem = useCallback(
    ({ item }: { item: MediaItem }) => (
      <Card item={item} variant="poster" onPress={open} />
    ),
    [open],
  );
  // Rows are virtualised, so `index` is a row index.
  const rowHeight = cardHeight('poster') + card.gap;
  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({
      length: rowHeight,
      offset: rowHeight * index,
      index,
    }),
    [rowHeight],
  );

  return (
    <Screen title="Search" testID="search">
      <TextField
        label="Title"
        testID="search-input"
        value={text}
        onChangeText={setText}
        placeholder="Type at least two letters"
        hasTVPreferredFocus
        returnKeyType="search"
      />
      {term.length < 2 ? (
        <Text style={styles.hint}>
          Movies, shows and episodes from every library.
        </Text>
      ) : results.status === 'error' ? (
        <ErrorView error={results.error} onRetry={results.reload} />
      ) : results.status === 'ready' && results.data.length === 0 ? (
        <EmptyView title="No results" message={`Nothing matches “${term}”.`} />
      ) : (
        <View style={styles.flex}>
          <Text style={styles.hint}>
            {results.status === 'loading'
              ? 'Searching…'
              : `${results.data?.length ?? 0} ${results.data?.length === 1 ? 'result' : 'results'}`}
          </Text>
          <FlatList
            key={columns}
            data={results.data ?? []}
            numColumns={columns}
            keyExtractor={i => i.id}
            renderItem={renderItem}
            getItemLayout={getItemLayout}
            contentContainerStyle={styles.grid}
            columnWrapperStyle={styles.row}
          />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hint: { color: colors.textDim, fontSize: font.body, marginBottom: space.sm },
  grid: { paddingTop: card.focusPad, paddingBottom: space.xl },
  row: { marginBottom: card.gap },
});
