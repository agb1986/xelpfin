/**
 * The mock backend's library sorts and filters, which the demo server and the screen tests rely
 * on to behave like Jellyfin.
 */
import { MOCK_SERVER, MockBackend } from '../../src/backend/mock/MockBackend';
import type { ItemQuery } from '../../src/backend/types';

const backend = () =>
  new MockBackend({
    server: MOCK_SERVER,
    userId: 'u1',
    userName: 'u1',
    accessToken: 't',
    isAdmin: true,
  });

const names = async (b: MockBackend, q: Partial<ItemQuery>) =>
  (await b.items({ libraryId: 'lib-movies', ...q })).items.map(i => i.name);

describe('MockBackend library filters', () => {
  it('filters by genre, studio, tag, parental rating and year', async () => {
    const b = backend();
    expect(await names(b, { genres: ['Drama'] })).toEqual([
      'Night Grid',
      'Old Codec',
    ]);
    expect(await names(b, { studios: ['Blender'] })).toEqual([
      'Big Purple Test',
    ]);
    expect(await names(b, { tags: ['Classic'] })).toEqual(['Old Codec']);
    expect(await names(b, { officialRatings: ['PG-13'] })).toEqual([
      'Night Grid',
    ]);
    expect(await names(b, { years: [2001, 2024] })).toEqual([
      'Big Purple Test',
      'Old Codec',
    ]);
    // Filters combine.
    expect(await names(b, { genres: ['Comedy'], years: [2001] })).toEqual([
      'Old Codec',
    ]);
    expect(await names(b, { genres: ['Comedy'], tags: ['Nope'] })).toEqual([]);
  });

  it('filters by resolution, with HD including 4K', async () => {
    const b = backend();
    expect(await names(b, { resolution: '4k' })).toEqual(['Big Purple Test']);
    expect(await names(b, { resolution: 'hd' })).toEqual([
      'Big Purple Test',
      'Night Grid',
    ]);
    expect(await names(b, { resolution: 'sd' })).toEqual(['Old Codec']);
    expect(
      (await b.items({ libraryId: 'lib-shows', resolution: 'hd' })).items,
    ).toEqual([]);
  });

  it('filters by watched state, with played winning over unplayed only', async () => {
    const b = backend();
    await b.setPlayed('m2', true);
    expect(await names(b, { played: true })).toEqual(['Night Grid']);
    expect(await names(b, { played: false })).toEqual([
      'Big Purple Test',
      'Old Codec',
    ]);
    expect(await names(b, { unplayedOnly: true })).toEqual([
      'Big Purple Test',
      'Old Codec',
    ]);
    expect(await names(b, { played: true, unplayedOnly: true })).toEqual([
      'Night Grid',
    ]);
  });

  it('sorts by year, runtime and rating, with names breaking ties', async () => {
    const b = backend();
    expect(await names(b, { sort: 'year', descending: true })).toEqual([
      'Big Purple Test',
      'Night Grid',
      'Old Codec',
    ]);
    expect(await names(b, { sort: 'premiereDate' })).toEqual([
      'Old Codec',
      'Night Grid',
      'Big Purple Test',
    ]);
    expect(await names(b, { sort: 'runtime' })).toEqual([
      'Big Purple Test',
      'Night Grid',
      'Old Codec',
    ]);
    expect(await names(b, { sort: 'rating' })).toHaveLength(3);
    expect(await names(b, { sort: 'random' })).toHaveLength(3);
  });

  it('lists the values found in each library', async () => {
    const b = backend();
    expect(await b.genres('lib-movies')).toEqual([
      'Animation',
      'Comedy',
      'Drama',
    ]);
    expect(await b.studios('lib-movies')).toEqual(['Blender', 'Grid Pictures']);
    expect(await b.tags('lib-movies')).toEqual(['Classic', 'Open movie']);
    expect(await b.officialRatings('lib-movies')).toEqual(['PG', 'PG-13']);
    expect(await b.years('lib-movies')).toEqual([2024, 2023, 2001]);
    expect(await b.genres('lib-shows')).toEqual(['Drama']);
    expect(await b.tags('lib-shows')).toEqual([]);
    expect(await b.officialRatings('lib-shows')).toEqual([]);
    expect(await b.years('lib-shows')).toEqual([2022]);
  });
});
