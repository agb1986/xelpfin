import type { DisplayControl, DisplayMode } from '../../src/platform/types';
import {
  matchDisplayMode,
  pickDisplayMode,
} from '../../src/player/displayMode';

let nextId = 1;
const mode = (width: number, height: number, refreshRate: number) => ({
  id: nextId++,
  width,
  height,
  refreshRate,
});

// What a 1080p Fire TV stick on an HDMI TV typically reports.
const hd60 = mode(1920, 1080, 60);
const hd5994 = mode(1920, 1080, 59.94);
const hd50 = mode(1920, 1080, 50);
const hd24 = mode(1920, 1080, 24);
const hd23976 = mode(1920, 1080, 23.976);
const sd60 = mode(1280, 720, 60);
const sd50 = mode(1280, 720, 50);
const uhd24 = mode(3840, 2160, 24);
const modes: DisplayMode[] = [
  hd60,
  hd5994,
  hd50,
  hd24,
  hd23976,
  sd60,
  sd50,
  uhd24,
];

describe('pickDisplayMode', () => {
  it('switches 23.976 fps film to the 23.976 Hz mode, then 24 Hz', () => {
    expect(
      pickDisplayMode(modes, hd60, { frameRate: 23.976 }, 'frameRate'),
    ).toBe(hd23976);
    const no23976 = modes.filter(m => m !== hd23976);
    expect(
      pickDisplayMode(no23976, hd60, { frameRate: 23.976 }, 'frameRate'),
    ).toBe(hd24);
  });

  it('prefers 24 Hz over 23.976 Hz for 24.000 fps', () => {
    expect(pickDisplayMode(modes, hd60, { frameRate: 24 }, 'frameRate')).toBe(
      hd24,
    );
  });

  it('uses the lowest multiple: 25 fps goes to 50 Hz, 29.97 fps to 59.94 Hz', () => {
    expect(pickDisplayMode(modes, hd60, { frameRate: 25 }, 'frameRate')).toBe(
      hd50,
    );
    expect(
      pickDisplayMode(modes, hd60, { frameRate: 29.97 }, 'frameRate'),
    ).toBe(hd5994);
  });

  it('keeps the current mode when no refresh rate is a multiple of the frame rate', () => {
    const only60 = [hd60, sd60];
    expect(
      pickDisplayMode(only60, hd60, { frameRate: 25 }, 'frameRate'),
    ).toBeUndefined();
  });

  it('only considers the active resolution for frame rate matching', () => {
    expect(pickDisplayMode(modes, sd60, { frameRate: 24 }, 'frameRate')).toBe(
      undefined,
    );
    expect(pickDisplayMode(modes, sd60, { frameRate: 25 }, 'frameRate')).toBe(
      sd50,
    );
  });

  it('matches the resolution too when asked, with the smallest mode tall enough', () => {
    const video = { frameRate: 24, width: 1920, height: 800 };
    expect(pickDisplayMode(modes, sd60, video, 'frameRateAndResolution')).toBe(
      hd24,
    );
    const uhd = { frameRate: 24, width: 3840, height: 2160 };
    expect(pickDisplayMode(modes, hd60, uhd, 'frameRateAndResolution')).toBe(
      uhd24,
    );
  });

  it('falls back to the active resolution when no mode has the video width', () => {
    const video = { frameRate: 25, width: 720, height: 576 };
    expect(pickDisplayMode(modes, hd60, video, 'frameRateAndResolution')).toBe(
      hd50,
    );
  });

  it('does nothing when off or without a frame rate', () => {
    expect(
      pickDisplayMode(modes, hd60, { frameRate: 24 }, 'off'),
    ).toBeUndefined();
    expect(
      pickDisplayMode(modes, hd60, { frameRate: 0 }, 'frameRate'),
    ).toBeUndefined();
    expect(
      pickDisplayMode(modes, hd60, { frameRate: NaN }, 'frameRate'),
    ).toBeUndefined();
  });
});

describe('matchDisplayMode', () => {
  function control(activeModeId: number, switched = true) {
    return {
      modes: jest.fn().mockResolvedValue({ modes, activeModeId }),
      setPreferredMode: jest.fn().mockResolvedValue(switched),
    } satisfies DisplayControl;
  }

  it('asks for the picked mode and reports whether the display switched', async () => {
    const display = control(hd60.id);
    expect(
      await matchDisplayMode(display, { frameRate: 23.976 }, 'frameRate'),
    ).toBe(true);
    expect(display.setPreferredMode).toHaveBeenCalledWith(hd23976.id);

    const stuck = control(hd60.id, false);
    expect(
      await matchDisplayMode(stuck, { frameRate: 23.976 }, 'frameRate'),
    ).toBe(false);
  });

  it('leaves the display alone when the mode already fits', async () => {
    const display = control(hd60.id);
    expect(
      await matchDisplayMode(display, { frameRate: 30 }, 'frameRate'),
    ).toBe(false);
    expect(display.setPreferredMode).not.toHaveBeenCalled();
  });

  it('does nothing without a display, a frame rate, or with the setting off', async () => {
    const display = control(hd60.id);
    expect(
      await matchDisplayMode(undefined, { frameRate: 24 }, 'frameRate'),
    ).toBe(false);
    expect(await matchDisplayMode(display, undefined, 'frameRate')).toBe(false);
    expect(await matchDisplayMode(display, { frameRate: 24 }, 'off')).toBe(
      false,
    );
    expect(display.modes).not.toHaveBeenCalled();
  });

  it('never rejects', async () => {
    const display: DisplayControl = {
      modes: jest.fn().mockRejectedValue(new Error('gone')),
      setPreferredMode: jest.fn(),
    };
    expect(
      await matchDisplayMode(display, { frameRate: 24 }, 'frameRate'),
    ).toBe(false);
  });
});
