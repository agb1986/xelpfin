import React from 'react';
import { BackHandler, type HWEvent } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import type { MediaSegment } from '../../../src/backend/types';
import {
  EXIT_WINDOW_MS,
  HIDE_AFTER_MS,
  useRemoteKeys,
} from '../../../src/ui/player/useRemoteKeys';
import {
  WARM_UP_TIMEOUT_MS,
  warmUpReactNative,
} from '../../../test-utils/warmUpReactNative';

// The remote: the hook's newest key handler, called the way react-native-tvos calls it.
let mockOnKey: ((evt: HWEvent) => void) | undefined;
jest.mock(
  'react-native/Libraries/Components/TV/useTVEventHandler',
  () => ({
    __esModule: true,
    default: (fn: (evt: HWEvent) => void) => {
      mockOnKey = fn;
    },
  }),
);

beforeAll(warmUpReactNative, WARM_UP_TIMEOUT_MS);

type Keys = ReturnType<typeof useRemoteKeys>;
type Props = Parameters<typeof useRemoteKeys>[0];

const intro: MediaSegment = { kind: 'intro', startMs: 0, endMs: 60_000 };

/** A key-up, or with `held` the repeated key-down of a held key. */
const key = (eventType: string, held = false) =>
  act(() =>
    mockOnKey!({
      eventType: held
        ? `long${eventType.charAt(0).toUpperCase()}${eventType.slice(1)}`
        : eventType,
      eventKeyAction: held ? 0 : 1,
    } as HWEvent),
  );

let listeners: (() => boolean)[];
const pressBack = () => {
  let handled = false;
  act(() => {
    handled = [...listeners].reverse().some(fn => fn());
  });
  return handled;
};

function setup(over: Partial<Props> = {}) {
  const props: Props = {
    active: true,
    playing: { url: 'u' },
    error: undefined,
    paused: false,
    hasEnded: () => false,
    upcomingCount: 2,
    segment: undefined,
    togglePaused: jest.fn(),
    tapSeek: jest.fn(),
    ...over,
  };
  const out = { current: undefined as unknown as Keys };
  function Probe(p: Props) {
    out.current = useRemoteKeys(p);
    return null;
  }
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(<Probe {...props} />);
  });
  const update = (more: Partial<Props>) =>
    act(() => {
      Object.assign(props, more);
      r.update(<Probe {...props} />);
    });
  return { out, props, update, renderer: r };
}

describe('useRemoteKeys', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    listeners = [];
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_e, fn) => {
      listeners.push(fn as () => boolean);
      return {
        remove: () =>
          listeners.splice(listeners.indexOf(fn as () => boolean), 1),
      };
    });
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('shows the controls for a while once a plan plays, then hides them', () => {
    const { out } = setup();
    expect(out.current.overlay).toBe('controls');
    act(() => {
      jest.advanceTimersByTime(HIDE_AFTER_MS);
    });
    expect(out.current.overlay).toBe('hidden');
  });

  it('keeps the controls up while paused', () => {
    const { out, update } = setup();
    update({ paused: true });
    act(() => {
      jest.advanceTimersByTime(HIDE_AFTER_MS);
    });
    expect(out.current.overlay).toBe('controls');
  });

  it('seeks with left and right only while the controls are hidden', () => {
    const { out, props } = setup();
    key('right');
    expect(props.tapSeek).not.toHaveBeenCalled();
    expect(out.current.overlay).toBe('controls');
    act(() => out.current.showOverlay('hidden'));
    key('left');
    expect(props.tapSeek).toHaveBeenLastCalledWith(-1, false);
    expect(out.current.overlay).toBe('seek');
    key('right', true);
    expect(props.tapSeek).toHaveBeenLastCalledWith(1, true);
  });

  it('seeks with rewind and fast forward, keeping the controls if they are up', () => {
    const { out, props } = setup();
    key('fastForward');
    expect(props.tapSeek).toHaveBeenLastCalledWith(1, false);
    expect(out.current.overlay).toBe('controls');
    act(() => out.current.showOverlay('hidden'));
    key('rewind');
    expect(props.tapSeek).toHaveBeenLastCalledWith(-1, false);
    expect(out.current.overlay).toBe('seek');
  });

  it('ignores the key-up that ends a long press and keys before a plan', () => {
    const { props, update } = setup({ playing: undefined });
    key('playPause');
    expect(props.togglePaused).not.toHaveBeenCalled();
    update({ playing: { url: 'u' } });
    act(() =>
      mockOnKey!({ eventType: 'longLeft', eventKeyAction: 1 } as HWEvent),
    );
    act(() => mockOnKey!({ eventType: 'left', eventKeyAction: 0 } as HWEvent));
    expect(props.tapSeek).not.toHaveBeenCalled();
    key('playPause');
    expect(props.togglePaused).toHaveBeenCalledTimes(1);
  });

  it('opens the scene navigator with Up and the episode reel with Down', () => {
    const { out } = setup();
    key('up');
    expect(out.current.navigator).toBe('scenes');
    act(() => out.current.closeNavigator());
    expect(out.current.navigator).toBe(false);
    key('down');
    expect(out.current.navigator).toBe('episodes');
    // An open navigator keeps the controls up past the auto-hide.
    act(() => {
      jest.advanceTimersByTime(HIDE_AFTER_MS);
    });
    expect(out.current.overlay).toBe('controls');
  });

  it('does not open the reel without upcoming episodes', () => {
    const { out } = setup({ upcomingCount: 0 });
    key('down');
    expect(out.current.navigator).toBe(false);
  });

  it('brings the controls back with select, info and menu', () => {
    const { out } = setup();
    for (const k of ['select', 'info', 'menu']) {
      act(() => out.current.showOverlay('hidden'));
      key(k);
      expect(out.current.overlay).toBe('controls');
    }
  });

  it('leaves select to the surface while a skippable segment plays under hidden controls', () => {
    const { out } = setup({ segment: intro });
    expect(out.current.skip).toBe(intro);
    act(() => out.current.showOverlay('hidden'));
    key('select');
    expect(out.current.overlay).toBe('hidden');
  });

  it('ignores keys while a track picker is open', () => {
    const { out, props } = setup();
    act(() => out.current.setPicker('audio'));
    expect(out.current.picker).toBe('audio');
    key('playPause');
    expect(props.togglePaused).not.toHaveBeenCalled();
  });

  it('BACK closes the navigator, then the controls, then asks before leaving', () => {
    const { out } = setup();
    key('up');
    expect(pressBack()).toBe(true);
    expect(out.current.navigator).toBe(false);
    expect(pressBack()).toBe(true);
    expect(out.current.overlay).toBe('hidden');
    act(() => {
      jest.advanceTimersByTime(EXIT_WINDOW_MS + 1);
    });
    expect(pressBack()).toBe(true);
    expect(out.current.exitHint).toBe(true);
    expect(pressBack()).toBe(false);
    act(() => {
      jest.advanceTimersByTime(EXIT_WINDOW_MS);
    });
    expect(out.current.exitHint).toBe(false);
  });

  it('a quick second BACK after lowering the controls leaves', () => {
    setup();
    expect(pressBack()).toBe(true);
    expect(pressBack()).toBe(false);
  });

  it('BACK dismisses a skip button once, for that segment only', () => {
    const { out } = setup({ segment: intro });
    act(() => out.current.showOverlay('hidden'));
    expect(pressBack()).toBe(true);
    expect(out.current.skip).toBeUndefined();
  });

  it('BACK leaves once the plan has ended or before it started', () => {
    const ended = setup({ hasEnded: () => true });
    expect(pressBack()).toBe(false);
    act(() => ended.renderer.unmount());
    setup({ playing: undefined });
    expect(pressBack()).toBe(false);
  });

  it('toggles pause and shows the controls', () => {
    const { out, props } = setup();
    act(() => out.current.showOverlay('hidden'));
    key('playPause');
    expect(props.togglePaused).toHaveBeenCalledTimes(1);
    expect(out.current.overlay).toBe('controls');
  });

  it('hands focus to the surface when the controls go away', () => {
    const { out } = setup();
    const requestTVFocus = jest.fn();
    (out.current.surface as { current: unknown }).current = { requestTVFocus };
    act(() => out.current.showOverlay('seek'));
    act(() => {
      jest.advanceTimersByTime(0);
    });
    expect(requestTVFocus).toHaveBeenCalled();
    expect(out.current.claimFocus.current).toBe(true);
  });

  it('stops listening for BACK while another screen is on top', () => {
    const { update } = setup();
    expect(listeners).toHaveLength(1);
    update({ active: false });
    expect(listeners).toHaveLength(0);
  });
});
