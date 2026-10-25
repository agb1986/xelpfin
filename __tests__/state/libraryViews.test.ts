/**
 * Saved library views: reading back what an older or newer app stored, counting filters, and
 * turning a view into an item query.
 */
import {
  activeFilterCount,
  DEFAULT_VIEW,
  sanitizeView,
  sanitizeViews,
  viewQuery,
} from '../../src/state/libraryViews';

describe('sanitizeView', () => {
  it('keeps a full, valid view', () => {
    const view = {
      sort: 'criticRating',
      letter: '#',
      played: true,
      genre: 'Drama',
      year: 2023,
      officialRating: 'PG-13',
      tag: 'Classic',
      studio: 'Blender',
      resolution: '4k',
    };
    expect(sanitizeView(view)).toEqual(view);
  });

  it.each([undefined, null, 'name', 3, []])(
    'falls back to the default for %p',
    raw => {
      expect(sanitizeView(raw)).toEqual(DEFAULT_VIEW);
    },
  );

  it('drops values it does not understand and keys it does not know', () => {
    expect(
      sanitizeView({
        sort: 'loudness',
        letter: 'ab',
        played: 'yes',
        genre: '  ',
        year: 20.5,
        officialRating: 12,
        tag: '',
        studio: null,
        resolution: '8k',
        future: 'setting',
      }),
    ).toEqual(DEFAULT_VIEW);
    expect(sanitizeView({ year: -1, played: false })).toEqual({
      ...DEFAULT_VIEW,
      played: false,
    });
  });
});

describe('sanitizeViews', () => {
  it('reads every library and ignores what is not a map', () => {
    expect(sanitizeViews({ a: { sort: 'year' }, b: 'junk' })).toEqual({
      a: { sort: 'year', letter: '' },
      b: DEFAULT_VIEW,
    });
    expect(sanitizeViews([{ sort: 'year' }])).toEqual({});
    expect(sanitizeViews(undefined)).toEqual({});
  });
});

describe('activeFilterCount', () => {
  it('counts filters, not sort or letter, and counts unwatched only', () => {
    expect(activeFilterCount({ sort: 'year', letter: 'B' })).toBe(0);
    expect(
      activeFilterCount({
        ...DEFAULT_VIEW,
        played: false,
        genre: 'Drama',
        resolution: 'sd',
      }),
    ).toBe(3);
  });
});

describe('viewQuery', () => {
  it('asks A to Z by name and in no particular direction for random', () => {
    expect(viewQuery(DEFAULT_VIEW)).toMatchObject({
      sort: 'name',
      descending: false,
    });
    expect(viewQuery({ ...DEFAULT_VIEW, sort: 'random' }).descending).toBe(
      false,
    );
    expect(viewQuery({ ...DEFAULT_VIEW, sort: 'playCount' }).descending).toBe(
      true,
    );
  });

  it('turns each filter into a one-value list and leaves unset ones out', () => {
    expect(
      viewQuery({
        sort: 'name',
        letter: 'C',
        played: false,
        genre: 'Drama',
        year: 2023,
        officialRating: 'PG',
        tag: 'Classic',
        studio: 'Blender',
        resolution: 'hd',
      }),
    ).toEqual({
      sort: 'name',
      descending: false,
      nameStartsWith: 'C',
      played: false,
      genres: ['Drama'],
      years: [2023],
      officialRatings: ['PG'],
      tags: ['Classic'],
      studios: ['Blender'],
      resolution: 'hd',
    });
    const bare = viewQuery(DEFAULT_VIEW);
    expect(JSON.parse(JSON.stringify(bare))).toEqual({
      sort: 'name',
      descending: false,
    });
  });
});
