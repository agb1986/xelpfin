import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import type { PlaybackPlan } from '../../src/backend/types';
import { VideoEngine } from '../../src/player/rnv/VideoEngine';

const plan: PlaybackPlan = {
  itemId: 'i1',
  mediaSourceId: 'ms1',
  playSessionId: 'ps1',
  method: 'DirectPlay',
  reasons: [],
  url: 'http://srv:8096/Videos/i1/stream?static=true&mediaSourceId=ms1',
  streamType: 'progressive',
  startPositionMs: 5000,
  audioTracks: [],
  subtitleTracks: [],
  headers: { Authorization: 'MediaBrowser Token="tok"' },
};

async function render(p: PlaybackPlan) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    r = ReactTestRenderer.create(<VideoEngine.View plan={p} paused={false} />);
  });
  return r.root.findByProps({ testID: 'video' }).props;
}

describe('VideoEngine', () => {
  it('passes the plan headers to the media source for direct play', async () => {
    const props = await render(plan);
    expect(props.source).toMatchObject({
      uri: plan.url,
      headers: { Authorization: 'MediaBrowser Token="tok"' },
      startPosition: 5000,
    });
    expect(props.source.type).toBeUndefined();
    expect(props.source.uri).not.toContain('api_key');
  });

  it('marks HLS transcodes as m3u8 and keeps their headers too', async () => {
    const props = await render({
      ...plan,
      method: 'Transcode',
      streamType: 'hls',
      url: 'http://srv:8096/videos/i1/master.m3u8?api_key=tok',
    });
    expect(props.source.type).toBe('m3u8');
    expect(props.source.headers).toEqual(plan.headers);
  });
});
