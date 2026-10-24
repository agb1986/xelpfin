import type { DisplayControl, DisplayMode } from '../platform/types';
import type { RefreshRateMatch } from '../state/settings';

/** What the video stream of the plan reports; frame rate is the only required part. */
export interface VideoFormat {
  frameRate: number;
  width?: number;
  height?: number;
}

/**
 * How far refreshRate / frameRate may sit from a whole number for the mode to count as a
 * multiple of the frame rate. 0.5 % lets a 24 Hz mode serve 23.976 fps (ratio 1.001) and a
 * 60 Hz mode serve 29.97 fps (ratio 2.002), while 25 fps on 60 Hz (ratio 2.4) is rejected.
 */
const MULTIPLE_TOLERANCE = 0.005;

function multipleOf(mode: DisplayMode, frameRate: number) {
  const ratio = mode.refreshRate / frameRate;
  const multiple = Math.round(ratio);
  if (multiple < 1) {
    return undefined;
  }
  const error = Math.abs(ratio - multiple);
  return error <= MULTIPLE_TOLERANCE ? { multiple, error } : undefined;
}

/**
 * Picks the display mode for a video, or undefined when no supported mode fits and the current
 * one should stay. A mode fits when its refresh rate is a whole multiple of the frame rate (see
 * {@link MULTIPLE_TOLERANCE}); the lowest multiple wins, then the smallest error, so 23.976 fps
 * prefers 24 Hz over 48 Hz and 24.000 fps prefers 24 Hz over 23.976 Hz.
 *
 * Only modes at the active resolution are considered unless the policy also matches the
 * resolution, in which case modes as wide as the video and at least as tall (the smallest such
 * height) take precedence, so a 1920x800 film goes to a 1920x1080 mode. When no mode at the
 * video's width exists the active resolution is kept.
 */
export function pickDisplayMode(
  modes: DisplayMode[],
  active: DisplayMode | undefined,
  video: VideoFormat,
  policy: RefreshRateMatch,
): DisplayMode | undefined {
  if (policy === 'off' || !(video.frameRate > 0)) {
    return undefined;
  }
  const candidates = candidateModes(modes, active, video, policy);
  let best: { mode: DisplayMode; multiple: number; error: number } | undefined;
  for (const mode of candidates) {
    const fit = multipleOf(mode, video.frameRate);
    if (!fit) {
      continue;
    }
    if (
      !best ||
      fit.multiple < best.multiple ||
      (fit.multiple === best.multiple && fit.error < best.error)
    ) {
      best = { mode, ...fit };
    }
  }
  return best?.mode;
}

function candidateModes(
  modes: DisplayMode[],
  active: DisplayMode | undefined,
  video: VideoFormat,
  policy: RefreshRateMatch,
): DisplayMode[] {
  if (policy === 'frameRateAndResolution' && video.width && video.height) {
    const { width, height } = video;
    const tall = modes.filter(m => m.width === width && m.height >= height);
    if (tall.length) {
      const smallest = Math.min(...tall.map(m => m.height));
      return tall.filter(m => m.height === smallest);
    }
  }
  if (!active) {
    return modes;
  }
  return modes.filter(
    m => m.width === active.width && m.height === active.height,
  );
}

/**
 * Switches the display to the mode {@link pickDisplayMode} chooses for the video. Resolves true
 * when the display changed mode (the caller restores it with `setPreferredMode(0)` on exit and
 * may wait for the TV to show a picture again), false when it stays as it is. Never rejects.
 */
export async function matchDisplayMode(
  display: DisplayControl | undefined,
  video: VideoFormat | undefined,
  policy: RefreshRateMatch,
): Promise<boolean> {
  if (!display || !video || policy === 'off') {
    return false;
  }
  try {
    const { modes, activeModeId } = await display.modes();
    const active = modes.find(m => m.id === activeModeId);
    const target = pickDisplayMode(modes, active, video, policy);
    if (!target || target.id === activeModeId) {
      return false;
    }
    return await display.setPreferredMode(target.id);
  } catch {
    return false;
  }
}
