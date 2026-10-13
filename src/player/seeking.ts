import type { Chapter, MediaSegment } from '../backend/types';

/** Taps on rewind/forward within this window of the previous one belong to the same burst. */
export const TAP_BURST_MS = 900;
/** Fixed-offset ladder: how far one burst of 1, 2 and 3 taps jumps. */
const LADDER_MS = [10_000, 30_000, 60_000];
/** Every tap after the ladder adds this much. */
const LADDER_TAIL_MS = 300_000;

/** Total distance a burst of `taps` taps jumps: 10 s, 30 s, 1 min, then 5 min more per tap. */
export function tapOffsetMs(taps: number): number {
  if (taps <= 0) {
    return 0;
  }
  if (taps <= LADDER_MS.length) {
    return LADDER_MS[taps - 1];
  }
  return LADDER_MS[LADDER_MS.length - 1] + (taps - LADDER_MS.length) * LADDER_TAIL_MS;
}

export interface Scene {
  name: string;
  startMs: number;
  imageUrl?: string;
}

const SYNTHETIC_SCENE_MS = 300_000;

/**
 * The marks the scene navigator offers: the item's chapters when it has any, otherwise evenly
 * spaced marks so files without chapters can still be jumped around.
 */
export function scenesFor(chapters: Chapter[] | undefined, durationMs: number): Scene[] {
  if (chapters && chapters.length > 1) {
    return [...chapters].sort((a, b) => a.startMs - b.startMs);
  }
  if (durationMs <= SYNTHETIC_SCENE_MS) {
    return [];
  }
  const out: Scene[] = [];
  for (let at = 0; at < durationMs - 30_000; at += SYNTHETIC_SCENE_MS) {
    out.push({ name: `${Math.round(at / 60_000)} min`, startMs: at });
  }
  return out;
}

/** Index of the scene playing at `positionMs`. */
export function currentSceneIndex(scenes: Scene[], positionMs: number): number {
  let found = 0;
  scenes.forEach((s, i) => {
    if (s.startMs <= positionMs + 500) {
      found = i;
    }
  });
  return found;
}

const SKIPPABLE = new Set(['intro', 'outro', 'recap', 'preview']);

/** The skippable segment the playhead is inside, if any. */
export function activeSegment(segments: MediaSegment[], positionMs: number): MediaSegment | undefined {
  return segments.find(s => SKIPPABLE.has(s.kind) && positionMs >= s.startMs && positionMs < s.endMs - 1000);
}

export function skipLabel(kind: MediaSegment['kind']): string {
  switch (kind) {
    case 'outro':
      return 'Skip Credits';
    case 'recap':
      return 'Skip Recap';
    case 'preview':
      return 'Skip Preview';
    default:
      return 'Skip Intro';
  }
}

/** `S01E04`, or undefined when the item has no season/episode numbers. */
export function episodeCode(season?: number, episode?: number): string | undefined {
  if (season === undefined || episode === undefined) {
    return undefined;
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `S${pad(season)}E${pad(episode)}`;
}
