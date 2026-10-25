import { useCallback, useEffect, useState } from 'react';
import type { ItemQuery, Resolution, SortField } from '../backend/types';
import { useLocalList } from './localLists';

/**
 * How the user last looked at one library: sort, jump letter and filters. Every filter is a
 * single value or absent, which means "any".
 */
export interface LibraryView {
  sort: SortField;
  /** Jump letter, '#' for non-letters, '' for all. */
  letter: string;
  /** True for watched only, false for unwatched only. */
  played?: boolean;
  genre?: string;
  year?: number;
  officialRating?: string;
  tag?: string;
  studio?: string;
  resolution?: Resolution;
}

/** Saved views by library id. */
export type LibraryViews = Record<string, LibraryView>;

export const DEFAULT_VIEW: LibraryView = { sort: 'name', letter: '' };

const SORT_FIELDS: readonly SortField[] = [
  'name',
  'dateAdded',
  'year',
  'rating',
  'runtime',
  'premiereDate',
  'playCount',
  'datePlayed',
  'criticRating',
  'random',
];
const RESOLUTIONS: readonly Resolution[] = ['4k', 'hd', 'sd'];
const LETTER = /^([A-Z#])?$/;

const text = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v : undefined;

/**
 * Reads one stored view. Anything missing or not understood falls back to the default, so a
 * view saved by an older or newer version of the app never stops the library from loading.
 */
export function sanitizeView(raw: unknown): LibraryView {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >;
  const view: LibraryView = {
    sort: SORT_FIELDS.includes(r.sort as SortField)
      ? (r.sort as SortField)
      : DEFAULT_VIEW.sort,
    letter:
      typeof r.letter === 'string' && LETTER.test(r.letter)
        ? r.letter
        : DEFAULT_VIEW.letter,
  };
  if (typeof r.played === 'boolean') {
    view.played = r.played;
  }
  if (typeof r.year === 'number' && Number.isInteger(r.year) && r.year > 0) {
    view.year = r.year;
  }
  if (RESOLUTIONS.includes(r.resolution as Resolution)) {
    view.resolution = r.resolution as Resolution;
  }
  for (const key of ['genre', 'officialRating', 'tag', 'studio'] as const) {
    const v = text(r[key]);
    if (v !== undefined) {
      view[key] = v;
    }
  }
  return view;
}

export function sanitizeViews(raw: unknown): LibraryViews {
  const out: LibraryViews = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
      out[id] = sanitizeView(v);
    }
  }
  return out;
}

/** How many filters narrow the list, not counting sort and jump letter. */
export function activeFilterCount(view: LibraryView): number {
  return [
    view.played,
    view.genre,
    view.year,
    view.officialRating,
    view.tag,
    view.studio,
    view.resolution,
  ].filter(v => v !== undefined).length;
}

/** The query fields for a view's sort and filters. */
export function viewQuery(view: LibraryView): ItemQuery {
  return {
    sort: view.sort,
    // Names read A to Z; every other sort shows the most, newest or highest first.
    descending: view.sort !== 'name' && view.sort !== 'random',
    nameStartsWith: view.letter || undefined,
    played: view.played,
    genres: view.genre !== undefined ? [view.genre] : undefined,
    years: view.year !== undefined ? [view.year] : undefined,
    officialRatings:
      view.officialRating !== undefined ? [view.officialRating] : undefined,
    tags: view.tag !== undefined ? [view.tag] : undefined,
    studios: view.studio !== undefined ? [view.studio] : undefined,
    resolution: view.resolution,
  };
}

/**
 * The saved view of one library for the signed-in user, kept on the device. `loaded` turns true
 * once the stored views were read (or could not be), so the screen asks the server once, with the
 * saved filters, instead of first loading the unfiltered list.
 */
export function useLibraryView(libraryId: string): {
  view: LibraryView;
  loaded: boolean;
  change(patch: Partial<LibraryView>): void;
} {
  const { value, list } = useLocalList<LibraryViews>(
    'library-views',
    () => ({}),
    sanitizeViews,
  );
  const [loaded, setLoaded] = useState(() => list.isLoaded());
  useEffect(() => {
    let live = true;
    setLoaded(list.isLoaded());
    list.load().then(() => live && setLoaded(true));
    return () => {
      live = false;
    };
  }, [list]);
  const view = value[libraryId] ?? DEFAULT_VIEW;
  const change = useCallback(
    (patch: Partial<LibraryView>) =>
      list.update(all => {
        const next: LibraryView = { ...(all[libraryId] ?? DEFAULT_VIEW) };
        for (const [k, v] of Object.entries(patch) as [
          keyof LibraryView,
          unknown,
        ][]) {
          if (v === undefined) {
            delete next[k];
          } else {
            (next as unknown as Record<string, unknown>)[k] = v;
          }
        }
        return { ...all, [libraryId]: sanitizeView(next) };
      }),
    [list, libraryId],
  );
  return { view, loaded, change };
}
