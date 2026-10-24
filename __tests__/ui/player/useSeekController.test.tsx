import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import type { Chapter } from '../../../src/backend/types';
import type { PlayerViewHandle } from '../../../src/player/PlayerEngine';
import {
  HELD_TAP_MS,
  TAP_COMMIT_MS,
  useSeekController,
} from '../../../src/ui/player/useSeekController';
import {
  WARM_UP_TIMEOUT_MS,
  warmUpReactNative,
} from '../../../test-utils/warmUpReactNative';

beforeAll(warmUpReactNative, WARM_UP_TIMEOUT_MS);

type Seek = ReturnType<typeof useSeekController>;

/** Renders the hook against a fake player view; `seeks` records what reached the view. */
function setup(
  opts: { durationMs?: number; chapters?: Chapter[]; totalMs?: number } = {},
) {
  const seeks: number[] = [];
  const view = { current: { seek: (ms: number) => seeks.push(ms) } } as {
    current: PlayerViewHandle | null;
  };
  const positionRef = { current: 100_000 };
  const setPosition = jest.fn();
  const out = { current: undefined as unknown as Seek };
  function Probe() {
    out.current = useSeekController({
      view,
      positionRef,
      setPosition,
      durationMs: opts.durationMs ?? 600_000,
      chapters: opts.chapters,
      totalMs: opts.totalMs ?? opts.durationMs ?? 600_000,
    });
    return null;
  }
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(<Probe />);
  });
  return { out, seeks, positionRef, setPosition, renderer: r };
}

describe('useSeekController', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('seeks to a position clamped into the video', () => {
    const { out, seeks, positionRef, setPosition } = setup();
    act(() => out.current.seekTo(-5000));
    act(() => out.current.seekTo(900_000));
    expect(seeks).toEqual([0, 599_000]);
    expect(positionRef.current).toBe(599_000);
    expect(setPosition).toHaveBeenLastCalledWith(599_000);
  });

  it('does not clamp the end while the duration is unknown', () => {
    const { out, seeks } = setup({ durationMs: 0, totalMs: 0 });
    act(() => out.current.seekTo(5_000_000));
    expect(seeks).toEqual([5_000_000]);
  });

  it('seeks by a step from the current position', () => {
    const { out, seeks } = setup();
    act(() => out.current.seekBy(-10_000));
    act(() => out.current.seekBy(30_000));
    expect(seeks).toEqual([90_000, 120_000]);
  });

  it('commits a burst of taps as one seek once the taps stop', () => {
    const { out, seeks } = setup();
    act(() => out.current.tapSeek(1, false));
    expect(out.current.pending).toEqual({ target: 110_000, delta: 10_000 });
    act(() => {
      jest.advanceTimersByTime(200);
      out.current.tapSeek(1, false);
    });
    expect(out.current.pending).toEqual({ target: 130_000, delta: 30_000 });
    expect(seeks).toEqual([]);
    act(() => {
      jest.advanceTimersByTime(TAP_COMMIT_MS);
    });
    expect(seeks).toEqual([130_000]);
    expect(out.current.pending).toBeUndefined();
  });

  it('commits the burst in progress when the direction changes', () => {
    const { out, seeks } = setup();
    act(() => out.current.tapSeek(1, false));
    act(() => out.current.tapSeek(-1, false));
    expect(seeks).toEqual([110_000]);
    expect(out.current.pending).toEqual({ target: 100_000, delta: -10_000 });
  });

  it('counts a held key as one tap per interval', () => {
    const { out } = setup();
    act(() => out.current.tapSeek(-1, true));
    act(() => out.current.tapSeek(-1, true));
    expect(out.current.pending?.delta).toBe(-10_000);
    act(() => {
      jest.advanceTimersByTime(HELD_TAP_MS);
      out.current.tapSeek(-1, true);
    });
    expect(out.current.pending?.delta).toBe(-30_000);
  });

  it('cancels a pending burst on unmount', () => {
    const { out, seeks, renderer } = setup();
    act(() => out.current.tapSeek(1, false));
    act(() => renderer.unmount());
    act(() => {
      jest.advanceTimersByTime(TAP_COMMIT_MS * 2);
    });
    expect(seeks).toEqual([]);
  });

  it('offers the chapters as scenes, else marks every five minutes', () => {
    const chapters = [
      { name: 'Two', startMs: 60_000 },
      { name: 'One', startMs: 0 },
    ];
    const withChapters = setup({ chapters });
    expect(withChapters.out.current.scenes.map(s => s.name)).toEqual([
      'One',
      'Two',
    ]);
    expect(withChapters.out.current.sceneIndex(70_000)).toBe(1);
    const synthetic = setup({ durationMs: 1_200_000 });
    expect(synthetic.out.current.scenes.map(s => s.startMs)).toEqual([
      0, 300_000, 600_000, 900_000,
    ]);
  });
});
