/** What sits over the video: nothing, the progress bar of a seek, or the full controls. */
export type Overlay = 'hidden' | 'seek' | 'controls';
/** The strip above the controls: the scene navigator (Up) or the next-episodes reel (Down). */
export type Navigator = 'scenes' | 'episodes' | false;
export type Picker = 'audio' | 'subtitles';

export interface OverlayState {
  mode: Overlay;
  navigator: Navigator;
  picker?: Picker;
  /** "Press back again to exit" is showing. */
  exitHint: boolean;
  /** Segments the viewer waved away with BACK; keyed by kind and start so each shows once. */
  dismissed: string[];
}

export type OverlayAction =
  | { type: 'show'; mode: Overlay }
  /** The auto-hide timer ran out; an open navigator keeps the controls up. */
  | { type: 'autoHide' }
  | { type: 'navigator'; navigator: Navigator }
  | { type: 'picker'; picker?: Picker }
  | { type: 'exitHint'; shown: boolean }
  | { type: 'dismiss'; key: string };

export const initialOverlay: OverlayState = {
  mode: 'controls',
  navigator: false,
  exitHint: false,
  dismissed: [],
};

/** Returns the same state when nothing changes, so React skips the render like a useState set. */
export function overlayReducer(
  state: OverlayState,
  action: OverlayAction,
): OverlayState {
  switch (action.type) {
    case 'show':
      return state.mode === action.mode
        ? state
        : { ...state, mode: action.mode };
    case 'autoHide':
      return state.navigator || state.mode === 'hidden'
        ? state
        : { ...state, mode: 'hidden' };
    case 'navigator':
      return state.navigator === action.navigator
        ? state
        : { ...state, navigator: action.navigator };
    case 'picker':
      return state.picker === action.picker
        ? state
        : { ...state, picker: action.picker };
    case 'exitHint':
      return state.exitHint === action.shown
        ? state
        : { ...state, exitHint: action.shown };
    case 'dismiss':
      return { ...state, dismissed: [...state.dismissed, action.key] };
  }
}

/** The key a skippable segment is dismissed under. */
export const segmentKey = (seg: { kind: string; startMs: number }) =>
  `${seg.kind}:${seg.startMs}`;
