import { MockBackend, MOCK_SERVER } from '../../src/backend/mock/MockBackend';
import { episodeAfter, findNextEpisode } from '../../src/state/nextEpisode';

const backend = () =>
  new MockBackend({
    server: MOCK_SERVER,
    userId: 'u1',
    userName: 'xelpfin',
    accessToken: 't',
    isAdmin: true,
  });

describe('next episode', () => {
  it('follows series order across seasons and stops at the end', async () => {
    const b = backend();
    expect((await findNextEpisode(b, { id: 'e1', seriesId: 's1' }))?.id).toBe(
      'e2',
    );
    expect((await findNextEpisode(b, { id: 'e3', seriesId: 's1' }))?.id).toBe(
      'e4',
    );
    expect(
      await findNextEpisode(b, { id: 'e4', seriesId: 's1' }),
    ).toBeUndefined();
  });

  it('is undefined for items outside a series and falls back to Next Up otherwise', async () => {
    const b = backend();
    expect(await findNextEpisode(b, { id: 'm1' })).toBeUndefined();
    expect((await findNextEpisode(b, { id: 'gone', seriesId: 's1' }))?.id).toBe(
      'e2',
    );
    b.episodes = async () => {
      throw new Error('offline');
    };
    expect((await findNextEpisode(b, { id: 'e1', seriesId: 's1' }))?.id).toBe(
      'e2',
    );
    expect(
      await findNextEpisode(b, { id: 'e2', seriesId: 's1' }),
    ).toBeUndefined();
  });

  it('episodeAfter handles unknown ids', () => {
    expect(episodeAfter([], 'x')).toBeUndefined();
  });
});
