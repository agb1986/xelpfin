import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  FlatList,
  type HWEvent,
  StyleSheet,
  Text,
  useTVEventHandler,
  useWindowDimensions,
  View,
  type ViewToken,
} from 'react-native';
import type { Backend } from '../../backend/Backend';
import type {
  ItemQuery,
  Library,
  MediaItem,
  Resolution,
  SortField,
} from '../../backend/types';
import { useBackend } from '../../state/AppState';
import {
  activeFilterCount,
  type LibraryView,
  useLibraryView,
  viewQuery,
} from '../../state/libraryViews';
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
  prefetchCardImages,
  type Option,
} from '../components';
import { nextPageDue } from '../paging';
import { card, colors, font, space } from '../theme';
import { openItem } from './navigate';

const PAGE = 60;

const SORTS: Option<SortField>[] = [
  { label: 'Name', value: 'name' },
  { label: 'Date added', value: 'dateAdded' },
  { label: 'Release year', value: 'year' },
  { label: 'Community rating', value: 'rating' },
  { label: 'Runtime', value: 'runtime' },
  { label: 'Premiere date', value: 'premiereDate' },
  { label: 'Play count', value: 'playCount' },
  { label: 'Date played', value: 'datePlayed' },
  { label: 'Critic rating', value: 'criticRating' },
  { label: 'Random', value: 'random' },
];

const LETTERS: Option<string>[] = [
  { label: 'All', value: '' },
  { label: '#', value: '#' },
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(l => ({ label: l, value: l })),
];

/** The filters the filter panel offers, each a key of the saved view. */
type FilterKey =
  | 'played'
  | 'genre'
  | 'year'
  | 'officialRating'
  | 'tag'
  | 'studio'
  | 'resolution';
type FilterValue = string | number | boolean | undefined;

const FILTER_TITLES: Record<FilterKey, string> = {
  played: 'Watched state',
  genre: 'Genre',
  year: 'Year',
  officialRating: 'Parental rating',
  tag: 'Tag',
  studio: 'Studio',
  resolution: 'Resolution',
};

const ANY: Option<FilterValue> = { label: 'Any', value: undefined };

const RESOLUTIONS: Option<Resolution>[] = [
  { label: '4K', value: '4k' },
  { label: 'HD', detail: 'Includes 4K', value: 'hd' },
  { label: 'SD', value: 'sd' },
];

/** Choices that do not come from the server. */
const FIXED_VALUES: Partial<Record<FilterKey, Option<FilterValue>[]>> = {
  played: [
    ANY,
    { label: 'Unwatched', value: false },
    { label: 'Watched', value: true },
  ],
  resolution: [ANY, ...RESOLUTIONS],
};

/** The values the server knows for one filter in one library. */
function fetchValues(
  backend: Backend,
  key: FilterKey,
  libraryId: string,
): Promise<FilterValue[]> {
  switch (key) {
    case 'genre':
      return backend.genres(libraryId);
    case 'year':
      return backend.years(libraryId);
    case 'officialRating':
      return backend.officialRatings(libraryId);
    case 'tag':
      return backend.tags(libraryId);
    default:
      return backend.studios(libraryId);
  }
}

function valueLabel(key: FilterKey, value: FilterValue): string {
  if (value === undefined) {
    return 'Any';
  }
  const fixed = FIXED_VALUES[key]?.find(o => o.value === value);
  return fixed ? fixed.label : String(value);
}

interface ListState {
  items: MediaItem[];
  total: number;
  /** How far into the server's list the loaded pages reach, repeats included. */
  offset: number;
  loading: boolean;
  error?: unknown;
}

const EMPTY_LIST: ListState = { items: [], total: 0, offset: 0, loading: true };

/**
 * Poster grid for one library with paging, sort, a jump letter and filters. Sort, letter and
 * filters are saved per library, so the grid looks the same when the user comes back to it. The
 * Menu key opens the filter panel.
 */
export function LibraryScreen({ library }: { library: Library }) {
  const backend = useBackend();
  const nav = useNavigation();
  const active = useIsActive();
  const { width } = useWindowDimensions();
  const columns = Math.max(
    3,
    Math.floor((width - space.safeX * 2) / cardStride('poster')),
  );

  const { view, loaded, change } = useLibraryView(library.id);
  const { sort, letter, played } = view;
  const [picker, setPicker] = useState<
    'sort' | 'letter' | 'filters' | FilterKey | null
  >(null);
  const [values, setValues] = useState<
    Partial<Record<FilterKey, Option<FilterValue>[]>>
  >({});
  const [list, setList] = useState<ListState>(EMPTY_LIST);
  const generation = useRef(0);

  // A new query only when the view really changed, not on every new view object.
  const queryKey = JSON.stringify(viewQuery(view));
  const query = useMemo(() => JSON.parse(queryKey) as ItemQuery, [queryKey]);
  const load = useCallback(
    async (startIndex: number) => {
      const gen = generation.current;
      setList(l => ({ ...l, loading: true, error: undefined }));
      try {
        const page = await backend.items({
          libraryId: library.id,
          ...query,
          startIndex,
          limit: PAGE,
        });
        if (gen !== generation.current) {
          return;
        }
        setList(l => {
          // A random order can repeat an item on a later page, and the grid keys items by id.
          const seen = new Set(startIndex === 0 ? [] : l.items.map(i => i.id));
          const fresh = page.items.filter(i => !seen.has(i.id));
          return {
            items: startIndex === 0 ? fresh : [...l.items, ...fresh],
            total: page.totalCount,
            offset: startIndex + page.items.length,
            loading: false,
          };
        });
        if (startIndex > 0) {
          // Off-screen rows are not mounted yet; warm the cache so they show at once.
          prefetchCardImages(page.items, 'poster');
        }
      } catch (error) {
        if (gen === generation.current) {
          setList(l => ({ ...l, loading: false, error }));
        }
      }
    },
    [backend, library.id, query],
  );

  // Start offset of the last page asked for by scrolling, so a page is requested once.
  const requested = useRef(-1);
  useEffect(() => {
    generation.current++;
    requested.current = -1;
    setList(EMPTY_LIST);
    // Wait for the saved view, so the unfiltered list is not fetched first.
    if (loaded) {
      load(0);
    }
  }, [load, loaded]);

  // Pick up watched state changes made on the detail page or by playback. A random order is
  // left alone: reloading it would shuffle the grid under the user.
  const wasActive = useRef(active);
  useEffect(() => {
    if (
      active &&
      !wasActive.current &&
      loaded &&
      sort !== 'random' &&
      list.offset <= PAGE
    ) {
      load(0);
    }
    wasActive.current = active;
  }, [active, load, loaded, sort, list.offset]);

  const loadMore = () => {
    const next = list.offset;
    if (
      !list.loading &&
      !list.error &&
      next < list.total &&
      requested.current !== next
    ) {
      requested.current = next;
      load(next);
    }
  };
  const onEnd = loadMore;
  // FlatList wants the same viewability callback for its whole life, so it reads the latest
  // state through a ref. Past the middle of the last page, the next one is fetched early.
  const onHalfway = useRef<(lastVisible: number) => void>(() => undefined);
  onHalfway.current = lastVisible => {
    if (nextPageDue(lastVisible, list.items.length, list.total, PAGE)) {
      loadMore();
    }
  };
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const last = viewableItems.reduce(
        (max, v) => Math.max(max, v.index ?? -1),
        -1,
      );
      if (last >= 0) {
        onHalfway.current(last);
      }
    },
  ).current;

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
  const filterCount = activeFilterCount(view);

  // The server only knows the resolution of videos, so in a TV library that filter would list
  // episodes instead of shows.
  const filterKeys: FilterKey[] = [
    'played',
    'genre',
    'year',
    'officialRating',
    'tag',
    'studio',
    ...(library.collectionType === 'movies' ? ['resolution' as const] : []),
  ];
  const panel: Option<FilterKey | 'clear'>[] = [
    ...filterKeys.map(key => ({
      label: FILTER_TITLES[key],
      detail: valueLabel(key, view[key]),
      value: key,
    })),
    {
      label: 'Clear filters',
      detail: filterCount ? undefined : 'No filters on',
      value: 'clear',
    },
  ];
  const openValues = (key: FilterKey) => {
    setPicker(key);
    if (FIXED_VALUES[key] || values[key]) {
      return;
    }
    fetchValues(backend, key, library.id).then(
      found =>
        setValues(v => ({
          ...v,
          [key]: [ANY, ...found.map(f => ({ label: String(f), value: f }))],
        })),
      () =>
        setValues(v => ({
          ...v,
          [key]: [{ ...ANY, detail: 'Could not load the choices' }],
        })),
    );
  };
  const clearFilters = () => {
    const patch: Partial<LibraryView> = {};
    for (const key of filterKeys) {
      patch[key] = undefined;
    }
    change(patch);
  };
  const valueKey: FilterKey | undefined =
    picker && picker !== 'sort' && picker !== 'letter' && picker !== 'filters'
      ? picker
      : undefined;

  // Menu on the remote opens the filter panel, unless another list is already open.
  const onKey = useCallback(
    (evt: HWEvent) => {
      if (active && evt.eventKeyAction === 1 && evt.eventType === 'menu') {
        setPicker(p => p ?? 'filters');
      }
    },
    [active],
  );
  useTVEventHandler(onKey);

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
          label={
            played === undefined
              ? 'All items'
              : played
                ? 'Watched only'
                : 'Unwatched only'
          }
          // All, unwatched only, watched only, and round again.
          onPress={() =>
            change({
              played: played === undefined ? false : played ? undefined : true,
            })
          }
          testID="unplayed"
        />
        <Button
          compact
          label={filterCount ? `Filters (${filterCount})` : 'Filters'}
          onPress={() => setPicker('filters')}
          testID="filters"
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
            letter || filterCount
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
          onViewableItemsChanged={onViewableItemsChanged}
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
        onSelect={s => change({ sort: s })}
        onClose={() => setPicker(null)}
        testID="sort-picker"
      />
      <OptionPicker
        visible={picker === 'letter'}
        title="Starts with"
        options={LETTERS}
        selected={letter}
        onSelect={l => change({ letter: l })}
        onClose={() => setPicker(null)}
        testID="letter-picker"
      />
      <OptionPicker<FilterKey | 'clear'>
        visible={picker === 'filters'}
        title="Filters"
        options={panel}
        selected={'none' as FilterKey}
        onSelect={key => (key === 'clear' ? clearFilters() : openValues(key))}
        // Choosing a filter has already moved on to its values; only close the panel itself.
        onClose={() => setPicker(p => (p === 'filters' ? null : p))}
        testID="filter-picker"
      />
      <OptionPicker<FilterValue>
        visible={valueKey !== undefined}
        title={valueKey ? FILTER_TITLES[valueKey] : ''}
        options={
          (valueKey && (FIXED_VALUES[valueKey] ?? values[valueKey])) || [
            { ...ANY, detail: 'Loading…' },
          ]
        }
        selected={valueKey ? view[valueKey] : undefined}
        onSelect={v => valueKey && change({ [valueKey]: v })}
        // Back to the panel, to set another filter.
        onClose={() => setPicker(p => (p === valueKey ? 'filters' : p))}
        letterJumpFrom={
          valueKey && valueKey !== 'year' && !FIXED_VALUES[valueKey]
            ? 1
            : undefined
        }
        testID="filter-value-picker"
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
