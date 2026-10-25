import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { MockBackend } from '../../../src/backend/mock/MockBackend';
import type { ItemDetail, Session } from '../../../src/backend/types';
import type { RandomizerState } from '../../../src/state/randomizer';
import { DEFAULT_SETTINGS, type Settings } from '../../../src/state/settings';
import { useNextEpisode } from '../../../src/ui/player/useNextEpisode';
import {
  WARM_UP_TIMEOUT_MS,
  warmUpReactNative,
} from '../../../test-utils/warmUpReactNative';

let mockApp: { backend: MockBackend; settings: Settings };
jest.mock('../../../src/state/AppState', () => ({
  useApp: () => mockApp,
  useBackend: () => mockApp.backend,
}));

const mockNav = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  reset: jest.fn(),
};
jest.mock('../../../src/state/navigation', () => ({
  useNavigation: () => mockNav,
  useIsActive: () => true,
}));

let mockRandomizer: {
  state: RandomizerState;
  list: {
    get(): RandomizerState;
    update(fn: (s: RandomizerState) => RandomizerState): void;
  };
};
jest.mock('../../../src/state/randomizer', () => ({
  ...jest.requireActual('../../../src/state/randomizer'),
  useRandomizer: () => mockRandomizer,
}));

beforeAll(warmUpReactNative, WARM_UP_TIMEOUT_MS);

const SESSION: Session = {
  server: { id: 'mock-server', name: 'Mock', url: 'http://mock.local:8096' },
  userId: 'u1',
  userName: 'xelpfin',
  accessToken: 'tok-u1',
  isAdmin: true,
};

type Next = ReturnType<typeof useNextEpisode>;

async function setup(
  itemId: string | undefined,
  opts: { shuffle?: boolean; autoplay?: boolean; series?: string[] } = {},
) {
  const backend = new MockBackend(SESSION);
  mockApp = {
    backend,
    settings: { ...DEFAULT_SETTINGS, autoplayNext: opts.autoplay ?? true },
  };
  let state: RandomizerState = {
    series: opts.series ?? ['s1'],
    played: [],
    history: [],
  };
  mockRandomizer = {
    state,
    list: {
      get: () => state,
      update: fn => {
        state = fn(state);
      },
    },
  };
  const item: ItemDetail | undefined = itemId
    ? await backend.item(itemId)
    : undefined;
  const out = { current: undefined as unknown as Next };
  function Probe() {
    out.current = useNextEpisode(item, opts.shuffle ?? false);
    return null;
  }
  let r!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    r = ReactTestRenderer.create(<Probe />);
  });
  return { out, renderer: r, randomizer: () => state };
}

describe('useNextEpisode', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists the episodes around the current one', async () => {
    const { out } = await setup('e2');
    expect(out.current.upcoming.map(e => e.id)).toEqual(['e3', 'e4']);
    expect(out.current.previous?.id).toBe('e1');
  });

  it('lists nothing for a movie or in shuffle mode', async () => {
    const movie = await setup('m1');
    expect(movie.out.current.upcoming).toEqual([]);
    const shuffled = await setup('e2', { shuffle: true });
    expect(shuffled.out.current.upcoming).toEqual([]);
  });

  it('plays the next episode at the end when autoplay is on', async () => {
    const { out } = await setup('e2');
    await act(() => out.current.playNext());
    expect(mockNav.replace).toHaveBeenCalledWith({
      name: 'player',
      itemId: 'e3',
      startPositionMs: 0,
    });
    expect(mockNav.back).not.toHaveBeenCalled();
  });

  it('goes back at the end with autoplay off, after a movie or after the last episode', async () => {
    const off = await setup('e2', { autoplay: false });
    await act(() => off.out.current.playNext());
    const movie = await setup('m1');
    await act(() => movie.out.current.playNext());
    const last = await setup('e4');
    await act(() => last.out.current.playNext());
    expect(mockNav.back).toHaveBeenCalledTimes(3);
    expect(mockNav.replace).not.toHaveBeenCalled();
  });

  it('draws the next Randomizer episode in shuffle mode and records it', async () => {
    const { out, randomizer } = await setup('e2', { shuffle: true });
    await act(() => out.current.playNext());
    const drawn = randomizer().played[0];
    expect(drawn).toBeDefined();
    expect(mockNav.replace).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: drawn, shuffle: true }),
    );
  });

  it('goes back in shuffle mode when the Randomizer list is empty', async () => {
    const { out } = await setup('e2', { shuffle: true, series: [] });
    await act(() => out.current.playNext());
    expect(mockNav.back).toHaveBeenCalled();
  });

  it('does not navigate when the screen left during the lookup', async () => {
    const { out, renderer } = await setup('e2');
    let pending!: Promise<void>;
    act(() => {
      pending = out.current.playNext();
    });
    act(() => renderer.unmount());
    await act(() => pending);
    expect(mockNav.replace).not.toHaveBeenCalled();
    expect(mockNav.back).not.toHaveBeenCalled();
  });

  it('jumps to a picked episode at its resume point', async () => {
    const { out } = await setup('e2');
    act(() =>
      out.current.goTo({
        ...out.current.upcoming[0],
        userData: { played: false, playbackPositionMs: 7000, favorite: false },
      }),
    );
    expect(mockNav.replace).toHaveBeenCalledWith({
      name: 'player',
      itemId: 'e3',
      startPositionMs: 7000,
    });
  });

  it('draws one random episode at a time', async () => {
    const { out, randomizer } = await setup('e2', { shuffle: true });
    await act(async () => {
      await Promise.all([out.current.playRandom(), out.current.playRandom()]);
    });
    expect(mockNav.replace).toHaveBeenCalledTimes(1);
    expect(randomizer().played).toHaveLength(1);
    await act(() => out.current.playRandom());
    expect(mockNav.replace).toHaveBeenCalledTimes(2);
  });

  it('peeks at the next episode without moving on, and plays it', async () => {
    const { out } = await setup('e2');
    const ep = await out.current.peekNext();
    expect(ep?.id).toBe('e3');
    expect(mockNav.replace).not.toHaveBeenCalled();
    act(() => out.current.playPeeked(ep!));
    expect(mockNav.replace).toHaveBeenCalledWith({
      name: 'player',
      itemId: 'e3',
      startPositionMs: 0,
    });
  });

  it('peeks at nothing with autoplay off, after a movie or after the last episode', async () => {
    const off = await setup('e2', { autoplay: false });
    expect(await off.out.current.peekNext()).toBeUndefined();
    const movie = await setup('m1');
    expect(await movie.out.current.peekNext()).toBeUndefined();
    const last = await setup('e4');
    expect(await last.out.current.peekNext()).toBeUndefined();
  });

  it('records a peeked Randomizer draw only when it is played', async () => {
    const { out, randomizer } = await setup('e2', { shuffle: true });
    const ep = await out.current.peekNext();
    expect(ep).toBeDefined();
    expect(randomizer().played).toEqual([]);
    act(() => out.current.playPeeked(ep!));
    expect(randomizer().played).toEqual([ep!.id]);
    expect(mockNav.replace).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: ep!.id, shuffle: true }),
    );
  });

  it('peeks at nothing in shuffle mode when the list is empty', async () => {
    const { out } = await setup('e2', { shuffle: true, series: [] });
    expect(await out.current.peekNext()).toBeUndefined();
  });

  it('does not play a peeked episode after the screen left', async () => {
    const { out, renderer } = await setup('e2');
    const ep = await out.current.peekNext();
    act(() => renderer.unmount());
    out.current.playPeeked(ep!);
    expect(mockNav.replace).not.toHaveBeenCalled();
  });
});
