/**
 * xelpfin 10-foot theme. Sizes are in dp for a 960x540 dp TV canvas (1080p at density 2);
 * keep text at 14 dp or larger and leave a 5% overscan-safe margin around every screen.
 */
export const colors = {
  bg: '#14101F',
  surface: '#1F1830',
  surfaceHi: '#2A2140',
  accent: '#8E5CF7',
  accentDim: '#5B3BA8',
  accentText: '#FFFFFF',
  text: '#F2EEFF',
  textDim: '#A79FC0',
  danger: '#FF6B81',
  scrim: 'rgba(10, 6, 20, 0.72)',
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 20,
  xl: 32,
  /** Overscan-safe horizontal margin. */
  safeX: 48,
  safeY: 27,
} as const;

export const font = {
  hero: 34,
  title: 24,
  heading: 18,
  body: 15,
  small: 13,
} as const;

export const radius = { sm: 4, md: 8, lg: 14 } as const;

/** Card sizes (dp). Posters are 2:3, thumbs 16:9. */
export const card = {
  poster: { width: 118, height: 177 },
  thumb: { width: 210, height: 118 },
  gap: 14,
  /** Extra room so the focus scale does not get clipped by the row. */
  focusPad: 10,
} as const;

export const focusScale = 1.07;
