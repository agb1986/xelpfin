import React from 'react';
import { StyleSheet } from 'react-native';
import ReactTestRenderer, {
  act,
  type ReactTestInstance,
  type ReactTestRenderer as Renderer,
} from 'react-test-renderer';
import { MockBackend } from '../../../src/backend/mock/MockBackend';
import type {
  Chapter,
  ItemDetail,
  Session,
  Trickplay,
} from '../../../src/backend/types';
import { SeekOverlay } from '../../../src/ui/player/SeekOverlay';
import {
  PREVIEW_WIDTH,
  previewHeight,
  SeekPreview,
  TrickplayPrefetch,
} from '../../../src/ui/player/SeekPreview';
import { useTrickplay } from '../../../src/ui/player/useTrickplay';
import {
  WARM_UP_TIMEOUT_MS,
  warmUpReactNative,
} from '../../../test-utils/warmUpReactNative';

let mockApp: { backend: MockBackend };
jest.mock('../../../src/state/AppState', () => ({
  useBackend: () => mockApp.backend,
}));

beforeAll(warmUpReactNative, WARM_UP_TIMEOUT_MS);

const SESSION: Session = {
  server: { id: 'mock-server', name: 'Mock', url: 'http://mock.local:8096' },
  userId: 'u1',
  userName: 'xelpfin',
  accessToken: 'tok-u1',
  isAdmin: true,
};

/** 10x10 thumbnails of 320x180 per sheet, one every 10 s: a sheet covers 1000 s. */
const TP: Trickplay = {
  width: 320,
  height: 180,
  columns: 10,
  rows: 10,
  thumbnailCount: 150,
  intervalMs: 10_000,
  sheetUrls: ['http://s/0.jpg', 'http://s/1.jpg'],
  headers: { Authorization: 'MediaBrowser Token="t"' },
};
const CHAPTERS: Chapter[] = [
  { name: 'Start', startMs: 0, imageUrl: 'http://c/0' },
  { name: 'Middle', startMs: 600_000, imageUrl: 'http://c/1' },
];

let mounted: Renderer[] = [];
function render(el: React.ReactElement): Renderer {
  let root!: Renderer;
  act(() => {
    root = ReactTestRenderer.create(el);
  });
  mounted.push(root);
  return root;
}
afterEach(() => {
  act(() => mounted.forEach(r => r.unmount()));
  mounted = [];
});

const all = (root: Renderer, id: string) =>
  root.root.findAll(n => n.props.testID === id && typeof n.type !== 'string');
const one = (root: Renderer, id: string): ReactTestInstance | undefined =>
  all(root, id)[0];
const flat = (n: ReactTestInstance) => StyleSheet.flatten(n.props.style);

describe('SeekPreview', () => {
  it('crops the trickplay sheet to the thumbnail at the target', () => {
    // 230 s is thumbnail 23: column 3, row 2 of the first sheet.
    const root = render(
      <SeekPreview trickplay={TP} chapters={CHAPTERS} targetMs={230_000} />,
    );
    const box = flat(one(root, 'seek-preview')!);
    expect(box).toMatchObject({ width: 256, height: 144, overflow: 'hidden' });
    const sheet = one(root, 'seek-preview-sheet')!;
    expect(sheet.props.source).toEqual({
      uri: 'http://s/0.jpg',
      headers: TP.headers,
    });
    expect(flat(sheet)).toMatchObject({
      position: 'absolute',
      width: 2560,
      height: 1440,
      left: -768,
      top: -288,
    });
    expect(one(root, 'seek-preview-chapter')).toBeUndefined();
  });

  it('sizes a loaded sheet by its real proportions', () => {
    // 1100 s is on the second, short sheet: 50 thumbnails cut to five rows, 3200x900 pixels,
    // which Android reports in density-independent units (here at 2x).
    const root = render(<SeekPreview trickplay={TP} targetMs={1_100_000} />);
    const sheet = one(root, 'seek-preview-sheet')!;
    expect(sheet.props.source.uri).toBe('http://s/1.jpg');
    act(() =>
      sheet.props.onLoad({
        nativeEvent: { source: { width: 1600, height: 450 } },
      }),
    );
    expect(flat(one(root, 'seek-preview-sheet')!)).toMatchObject({
      width: 2560,
      height: 720,
    });
    // A load event without a size keeps the size it had.
    act(() =>
      one(root, 'seek-preview-sheet')!.props.onLoad({ nativeEvent: {} }),
    );
    expect(flat(one(root, 'seek-preview-sheet')!).height).toBe(720);
  });

  it('falls back to the chapter image when a sheet will not load', () => {
    const root = render(
      <SeekPreview trickplay={TP} chapters={CHAPTERS} targetMs={700_000} />,
    );
    act(() => one(root, 'seek-preview-sheet')!.props.onError());
    expect(one(root, 'seek-preview-sheet')).toBeUndefined();
    expect(one(root, 'seek-preview-chapter')!.props.source).toEqual({
      uri: 'http://c/1',
    });
  });

  it('shows the chapter image without trickplay', () => {
    const root = render(<SeekPreview chapters={CHAPTERS} targetMs={30_000} />);
    expect(flat(one(root, 'seek-preview')!)).toMatchObject({
      width: 256,
      height: 144,
    });
    expect(one(root, 'seek-preview-chapter')!.props.source.uri).toBe(
      'http://c/0',
    );
  });

  it('shows nothing with neither thumbnails nor chapter images', () => {
    const root = render(<SeekPreview targetMs={30_000} />);
    expect(root.toJSON()).toBeNull();
  });

  it('gives the box height for the thumbnail shape', () => {
    expect(previewHeight(undefined)).toBe(144);
    expect(previewHeight({ ...TP, width: 320, height: 240 })).toBe(192);
  });
});

describe('TrickplayPrefetch', () => {
  it('loads the sheets around the position with the token, invisibly', () => {
    const root = render(<TrickplayPrefetch trickplay={TP} positionMs={0} />);
    const imgs = all(root, 'trickplay-prefetch');
    expect(imgs.map(i => i.props.source)).toEqual([
      { uri: 'http://s/0.jpg', headers: TP.headers },
      { uri: 'http://s/1.jpg', headers: TP.headers },
    ]);
    expect(flat(imgs[0])).toMatchObject({ width: 1, height: 1 });
  });

  it('renders nothing without trickplay', () => {
    const root = render(<TrickplayPrefetch positionMs={0} />);
    expect(root.toJSON()).toBeNull();
  });
});

describe('SeekOverlay preview', () => {
  const item = {
    id: 'm1',
    name: 'Long Chapters',
    kind: 'movie',
    chapters: CHAPTERS,
  } as unknown as ItemDetail;
  const overlay = (props: Partial<React.ComponentProps<typeof SeekOverlay>>) =>
    render(
      <SeekOverlay
        item={item}
        positionMs={0}
        bufferedMs={0}
        totalMs={1_500_000}
        onHeight={() => {}}
        {...props}
      />,
    );
  /** The wrapper the preview is placed in: the parent of the preview's box. */
  const placement = (root: Renderer) =>
    flat(one(root, 'seek-preview')!.parent!.parent!);
  const layOut = (root: Renderer, width: number) => {
    const bar = root.root.findAll(
      n => typeof n.type !== 'string' && !!n.props.onLayout,
    )[1];
    act(() => bar.props.onLayout({ nativeEvent: { layout: { width } } }));
  };

  it('has no preview without a pending seek', () => {
    const root = overlay({ trickplay: TP });
    expect(one(root, 'seek-preview')).toBeUndefined();
  });

  it('places the thumbnail above the bar at the target, inside the bar ends', () => {
    const root = overlay({
      trickplay: TP,
      pending: { target: 750_000, delta: 750_000 },
    });
    layOut(root, 1000);
    expect(one(root, 'seek-preview-sheet')).toBeDefined();
    expect(placement(root)).toMatchObject({
      position: 'absolute',
      left: 500 - PREVIEW_WIDTH / 2,
      top: -144 - 8,
    });
  });

  it('keeps the preview inside the bar at either end', () => {
    const start = overlay({
      trickplay: TP,
      pending: { target: 0, delta: -10_000 },
    });
    layOut(start, 1000);
    expect(placement(start).left).toBe(0);
    const end = overlay({
      trickplay: TP,
      pending: { target: 1_500_000, delta: 10_000 },
    });
    layOut(end, 1000);
    expect(placement(end).left).toBe(1000 - PREVIEW_WIDTH);
  });

  it('shows the chapter image for a seek without trickplay', () => {
    const root = overlay({ pending: { target: 650_000, delta: 30_000 } });
    expect(one(root, 'seek-preview-chapter')!.props.source.uri).toBe(
      'http://c/1',
    );
  });
});

describe('useTrickplay', () => {
  function Probe(props: { itemId?: string; sourceId?: string }) {
    const tp = useTrickplay(props.itemId, props.sourceId);
    return <>{tp ? tp.sheetUrls.join(',') : 'none'}</>;
  }
  const text = (root: Renderer) => root.toJSON();
  const flush = () =>
    act(async () => {
      await new Promise<void>(r => setTimeout(r, 0));
    });

  beforeEach(() => {
    mockApp = { backend: new MockBackend(SESSION) };
  });

  it('asks the server for the planned source and returns what it has', async () => {
    const spy = jest
      .spyOn(mockApp.backend, 'trickplay')
      .mockResolvedValue({ ...TP, sheetUrls: ['a'] });
    const root = render(<Probe itemId="i1" sourceId="s1" />);
    expect(text(root)).toBe('none');
    await flush();
    expect(spy).toHaveBeenCalledWith('i1', 's1');
    expect(text(root)).toBe('a');
  });

  it('waits for a plan before asking', async () => {
    const spy = jest.spyOn(mockApp.backend, 'trickplay');
    const root = render(<Probe itemId="i1" />);
    await flush();
    expect(spy).not.toHaveBeenCalled();
    expect(text(root)).toBe('none');
  });

  it('has none when the server fails', async () => {
    jest
      .spyOn(mockApp.backend, 'trickplay')
      .mockRejectedValue(new Error('boom'));
    const root = render(<Probe itemId="i1" sourceId="s1" />);
    await flush();
    expect(text(root)).toBe('none');
  });

  it('drops the previous source thumbnails while the next ones load', async () => {
    let resolveSecond!: (tp: Trickplay) => void;
    jest
      .spyOn(mockApp.backend, 'trickplay')
      .mockResolvedValueOnce({ ...TP, sheetUrls: ['a'] })
      .mockReturnValueOnce(
        new Promise<Trickplay>(r => {
          resolveSecond = r;
        }),
      );
    const root = render(<Probe itemId="i1" sourceId="s1" />);
    await flush();
    expect(text(root)).toBe('a');
    act(() => root.update(<Probe itemId="i2" sourceId="s2" />));
    expect(text(root)).toBe('none');
    await act(async () => resolveSecond({ ...TP, sheetUrls: ['b'] }));
    expect(text(root)).toBe('b');
  });

  it('ignores an answer that arrives after unmount', async () => {
    let resolve!: (tp: Trickplay) => void;
    jest.spyOn(mockApp.backend, 'trickplay').mockReturnValue(
      new Promise<Trickplay>(r => {
        resolve = r;
      }),
    );
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    const root = render(<Probe itemId="i1" sourceId="s1" />);
    act(() => root.unmount());
    mounted = [];
    await act(async () => resolve(TP));
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
