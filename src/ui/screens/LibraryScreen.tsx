import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import type { Library, MediaItem, SortField } from '../../backend/types';
import { useBackend } from '../../state/AppState';
import { useIsActive, useNavigation } from '../../state/navigation';
import {
  Button,
  Card,
  cardHeight,
  cardStride,
  describeError,
  EmptyView,
  ErrorView,
  LoadingView,
  OptionPicker,
  type Option,
} from '../components';
import { card, colors, font, space } from '../theme';
import { openItem } from './navigate';

const PAGE = 60;

const SORTS: Option<SortField>[] = [
  { label: 'Name', value: 'name' },
  { label: 'Date added', value: 'dateAdded' },
  { label: 'Release year', value: 'year' },
  { label: 'Rating', value: 'rating' },
];

const LETTERS: Option<string>[] = [
  { label: 'All', value: '' },
  { label: '#', value: '#' },
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(l => ({ label: l, value: l })),
];

interface ListState {
  items: MediaItem[];
  total: number;
  loading: boolean;
  error?: unknown;
}

/** Poster grid for one library with paging, sort, letter filter and an unwatched filter. */
export function LibraryScreen({ library }: { library: Library }) {
  const backend = useBackend();
  const nav = useNavigation();
  const active = useIsActive();
  const { width } = useWindowDimensions();
  const columns = Math.max(
    3,
    Math.floor((width - space.safeX * 2) / cardStride('poster')),
  );

  const [sort, setSort] = useState<SortField>('name');
  const [letter, setLetter] = useState('');
  const [unplayed, setUnplayed] = useState(false);
  const [picker, setPicker] = useState<'sort' | 'letter' | null>(null);
  const [list, setList] = useState<ListState>({
    items: [],
    total: 0,
    loading: true,
  });
  const generation = useRef(0);

  const descending = sort !== 'name';
  const load = useCallback(
    async (startIndex: number) => {
      const gen = generation.current;
      setList(l => ({ ...l, loading: true, error: undefined }));
      try {
        const page = await backend.items({
          libraryId: library.id,
          sort,
          descending,
          nameStartsWith: letter || undefined,
          unplayedOnly: unplayed,
          startIndex,
          limit: PAGE,
        });
        if (gen !== generation.current) {
          return;
        }
        setList(l => ({
          items: startIndex === 0 ? page.items : [...l.items, ...page.items],
          total: page.totalCount,
          loading: false,
        }));
      } catch (error) {
        if (gen === generation.current) {
          setList(l => ({ ...l, loading: false, error }));
        }
      }
    },
    [backend, library.id, sort, descending, letter, unplayed],
  );

  useEffect(() => {
    generation.current++;
    setList({ items: [], total: 0, loading: true });
    load(0);
  }, [load]);

  // Pick up watched state changes made on the detail page or by playback.
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current && list.items.length <= PAGE) {
      load(0);
    }
    wasActive.current = active;
  }, [active, load, list.items.length]);

  const onEnd = () => {
    if (!list.loading && !list.error && list.items.length < list.total) {
      load(list.items.length);
    }
  };

  const open = useCallback((item: MediaItem) => openItem(nav, item), [nav]);
  const rowHeight = cardHeight('poster') + card.gap;
  const renderItem = useCallback(
    ({ item, index }: { item: MediaItem; index: number }) => (
      <Card
        item={item}
        variant="poster"
        onPress={open}
        hasTVPreferredFocus={index === 0}
      />
    ),
    [open],
  );
  // With numColumns the list virtualises rows, so `index` here is a row index, not an item index.
  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({
      length: rowHeight,
      offset: rowHeight * index,
      index,
    }),
    [rowHeight],
  );
  const sortLabel = SORTS.find(s => s.value === sort)!.label;

  return (
    <View style={styles.root} testID="library">
      <View style={styles.header}>
        <Text style={styles.title}>{library.name}</Text>
        <Text style={styles.count}>
          {list.total
            ? `${list.total} ${list.total === 1 ? 'item' : 'items'}`
            : ''}
        </Text>
        <View style={styles.spacer} />
        <Button
          compact
          label={`Sort: ${sortLabel}`}
          onPress={() => setPicker('sort')}
          testID="sort"
        />
        <Button
          compact
          label={`Letter: ${letter || 'All'}`}
          onPress={() => setPicker('letter')}
          testID="letter"
        />
        <Button
          compact
          label={unplayed ? 'Unwatched only' : 'All items'}
          onPress={() => setUnplayed(u => !u)}
          testID="unplayed"
        />
      </View>
      {list.items.length === 0 && list.loading ? (
        <LoadingView />
      ) : list.items.length === 0 && list.error ? (
        <ErrorView
          error={list.error}
          onRetry={() => load(0)}
          hasTVPreferredFocus
        />
      ) : list.items.length === 0 ? (
        <EmptyView
          title="No items"
          message={
            letter || unplayed
              ? 'Nothing matches the current filter.'
              : 'This library is empty.'
          }
        />
      ) : (
        <FlatList
          key={columns}
          data={list.items}
          numColumns={columns}
          keyExtractor={i => i.id}
          renderItem={renderItem}
          getItemLayout={getItemLayout}
          onEndReached={onEnd}
          onEndReachedThreshold={1.5}
          initialNumToRender={columns * 3}
          maxToRenderPerBatch={columns * 2}
          windowSize={5}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={styles.gridRow}
          ListFooterComponent={
            list.error ? (
              <Text style={styles.error}>{describeError(list.error)}</Text>
            ) : null
          }
        />
      )}
      <OptionPicker
        visible={picker === 'sort'}
        title="Sort by"
        options={SORTS}
        selected={sort}
        onSelect={setSort}
        onClose={() => setPicker(null)}
        testID="sort-picker"
      />
      <OptionPicker
        visible={picker === 'letter'}
        title="Starts with"
        options={LETTERS}
        selected={letter}
        onSelect={setLetter}
        onClose={() => setPicker(null)}
        testID="letter-picker"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.safeX,
    paddingTop: space.safeY,
    paddingBottom: space.sm,
  },
  title: { color: colors.text, fontSize: font.title, fontWeight: '700' },
  count: { color: colors.textDim, fontSize: font.small, marginLeft: space.md },
  spacer: { flex: 1 },
  grid: {
    paddingHorizontal: space.safeX,
    paddingTop: card.focusPad,
    paddingBottom: space.xl,
  },
  gridRow: { marginBottom: card.gap },
  error: { color: colors.danger, fontSize: font.body, padding: space.lg },
});
