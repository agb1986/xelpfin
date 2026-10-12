/** One timed subtitle cue. */
export interface Cue {
  startMs: number;
  endMs: number;
  text: string;
}

/** How many earlier cues are checked for overlap with the current one. */
const MAX_OVERLAP = 20;
const TIME = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{3})$/;

function parseTime(s: string): number | undefined {
  const m = TIME.exec(s.trim());
  if (!m) {
    return undefined;
  }
  const [, h = '0', min, sec, ms] = m;
  return ((Number(h) * 60 + Number(min)) * 60 + Number(sec)) * 1000 + Number(ms);
}

/**
 * Strips WebVTT/HTML-style markup (<i>, <c.class>, <v Speaker>, timestamps), decodes basic
 * entities, and removes what survives of ASS/SSA styling when the server converts such a track
 * to WebVTT: override blocks ({\an8}, {\i1}, {\pos(..)}), vector drawings ({\p1} ... {\p0}),
 * and the \N, \n and \h escapes.
 */
export function cleanText(s: string): string {
  return s
    .replace(/\{[^}]*\\p[1-9][^}]*\}[\s\S]*?(?:\{[^}]*\\p0[^}]*\}|$)/g, '')
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/\\N/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\h/g, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/**
 * Parses WebVTT (and, leniently, SRT) into cues sorted by start time. Cue settings, styles,
 * regions and notes are ignored: the app draws every cue the same way at the bottom.
 */
export function parseWebVtt(input: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').filter(l => l.length > 0);
    const at = lines.findIndex(l => l.includes('-->'));
    if (at < 0) {
      continue;
    }
    const [from, rest = ''] = lines[at].split('-->');
    const startMs = parseTime(from);
    const endMs = parseTime(rest.trim().split(/\s+/)[0] ?? '');
    if (startMs === undefined || endMs === undefined || endMs <= startMs) {
      continue;
    }
    const text = cleanText(lines.slice(at + 1).join('\n')).trim();
    if (text) {
      cues.push({ startMs, endMs, text });
    }
  }
  return cues.sort((a, b) => a.startMs - b.startMs);
}

/** Text of the cues showing at a position (overlapping cues are joined), or '' when none is. */
export function cueTextAt(cues: Cue[], positionMs: number): string {
  // Binary search for the last cue starting at or before the position, then walk back over
  // any earlier cues that are still showing.
  let lo = 0;
  let hi = cues.length - 1;
  let last = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (cues[mid].startMs <= positionMs) {
      last = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const showing: string[] = [];
  for (let i = last; i >= 0 && last - i < MAX_OVERLAP; i--) {
    if (positionMs < cues[i].endMs) {
      showing.unshift(cues[i].text);
    }
  }
  return showing.join('\n');
}
