import React from 'react';
import { StyleSheet } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SubtitleText, subtitleTextStyle } from '../../src/ui/components/SubtitleText';

describe('SubtitleText', () => {
  it('styles text by size, colour and background', () => {
    expect(subtitleTextStyle({ size: 28, color: '#ffe14d', background: 'box' })).toMatchObject({ fontSize: 28, color: '#ffe14d', backgroundColor: 'rgba(0,0,0,0.6)' });
    expect(subtitleTextStyle({ size: 18, color: '#fff', background: 'solid' }).backgroundColor).toBe('#000');
    const outline = subtitleTextStyle({ size: 18, color: '#fff', background: 'shadow' });
    expect(outline.backgroundColor).toBeUndefined();
    expect(outline.textShadowRadius).toBeGreaterThan(0);
  });

  it('shows only the current cue', async () => {
    const cues = [{ startMs: 1000, endMs: 2000, text: 'Hello' }];
    let r!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      r = ReactTestRenderer.create(<SubtitleText cues={cues} positionMs={1500} />);
    });
    expect(JSON.stringify(r.toJSON())).toContain('Hello');
    await act(async () => r.update(<SubtitleText cues={cues} positionMs={2500} />));
    expect(r.toJSON()).toBeNull();
  });

  it('sits above the player controls when they are showing', async () => {
    const cues = [{ startMs: 0, endMs: 2000, text: 'Hello' }];
    let r!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      r = ReactTestRenderer.create(<SubtitleText cues={cues} positionMs={500} />);
    });
    const bottom = () => StyleSheet.flatten(r.root.findByProps({ testID: 'player-subtitle-text' }).props.style).bottom;
    expect(bottom()).toBe(36);
    await act(async () => r.update(<SubtitleText cues={cues} positionMs={500} lift={200} />));
    expect(bottom()).toBe(212);
  });
});
