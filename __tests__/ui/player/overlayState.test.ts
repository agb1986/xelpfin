import {
  initialOverlay,
  overlayReducer,
  segmentKey,
} from '../../../src/ui/player/overlayState';

describe('overlayReducer', () => {
  it('starts with the controls up and nothing else open', () => {
    expect(initialOverlay).toEqual({
      mode: 'controls',
      navigator: false,
      exitHint: false,
      dismissed: [],
    });
  });

  it('returns the same state when an action changes nothing, so React skips the render', () => {
    const s = initialOverlay;
    expect(overlayReducer(s, { type: 'show', mode: 'controls' })).toBe(s);
    expect(overlayReducer(s, { type: 'navigator', navigator: false })).toBe(s);
    expect(overlayReducer(s, { type: 'picker', picker: undefined })).toBe(s);
    expect(overlayReducer(s, { type: 'exitHint', shown: false })).toBe(s);
    const hidden = overlayReducer(s, { type: 'show', mode: 'hidden' });
    expect(overlayReducer(hidden, { type: 'autoHide' })).toBe(hidden);
  });

  it('changes one field per action', () => {
    let s = overlayReducer(initialOverlay, { type: 'show', mode: 'seek' });
    expect(s.mode).toBe('seek');
    s = overlayReducer(s, { type: 'navigator', navigator: 'scenes' });
    expect(s.navigator).toBe('scenes');
    s = overlayReducer(s, { type: 'picker', picker: 'audio' });
    expect(s.picker).toBe('audio');
    s = overlayReducer(s, { type: 'exitHint', shown: true });
    expect(s.exitHint).toBe(true);
    expect(s.mode).toBe('seek');
  });

  it('auto-hide lowers the controls unless a navigator is open', () => {
    const open = overlayReducer(initialOverlay, {
      type: 'navigator',
      navigator: 'episodes',
    });
    expect(overlayReducer(open, { type: 'autoHide' })).toBe(open);
    expect(overlayReducer(initialOverlay, { type: 'autoHide' }).mode).toBe(
      'hidden',
    );
  });

  it('remembers every dismissed segment', () => {
    let s = overlayReducer(initialOverlay, { type: 'dismiss', key: 'intro:0' });
    s = overlayReducer(s, { type: 'dismiss', key: 'outro:9000' });
    expect(s.dismissed).toEqual(['intro:0', 'outro:9000']);
  });
});

test('segmentKey tells segments apart by kind and start', () => {
  expect(segmentKey({ kind: 'intro', startMs: 1000 })).toBe('intro:1000');
  expect(segmentKey({ kind: 'intro', startMs: 1000 })).not.toBe(
    segmentKey({ kind: 'outro', startMs: 1000 }),
  );
});
