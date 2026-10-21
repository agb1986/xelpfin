import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import type { SubtitleTrack } from '../../src/backend/types';
import { useSubtitleCues } from '../../src/player/useSubtitleCues';
import {
  WARM_UP_TIMEOUT_MS,
  warmUpReactNative,
} from '../../test-utils/warmUpReactNative';

beforeAll(warmUpReactNative, WARM_UP_TIMEOUT_MS);

const track: SubtitleTrack = {
  index: 3,
  label: 'English',
  language: 'eng',
  isDefault: false,
  isForced: false,
  delivery: 'external',
  url: 'http://srv:8096/Videos/i1/ms1/Subtitles/3/0/Stream.vtt',
};

const headers = { Authorization: 'MediaBrowser Token="tok"' };

function Probe(props: {
  track?: SubtitleTrack;
  headers?: Record<string, string>;
}) {
  const cues = useSubtitleCues(props.track, props.headers);
  return <Text>{JSON.stringify(cues)}</Text>;
}

const flush = () => new Promise<void>(r => setTimeout(r, 0));

describe('useSubtitleCues', () => {
  const realFetch = globalThis.fetch;
  let fetchMock: jest.Mock;
  beforeEach(() => {
    fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n',
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('sends the plan headers with the subtitle fetch and parses the cues', async () => {
    let r!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      r = ReactTestRenderer.create(<Probe track={track} headers={headers} />);
    });
    await act(flush);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(track.url, { headers });
    // The token is only in the header, never in the requested URL.
    expect(fetchMock.mock.calls[0][0]).not.toContain('tok');
    expect(JSON.stringify(r.toJSON())).toContain('Hello');
  });

  it('fetches nothing for embedded or missing tracks', async () => {
    let r!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      r = ReactTestRenderer.create(
        <Probe track={{ ...track, delivery: 'embedded', url: undefined }} />,
      );
    });
    await act(flush);
    await act(async () => {
      r.update(<Probe track={undefined} />);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(r.toJSON())).toContain('[]');
  });

  it('clears the cues when the server rejects the request', async () => {
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 401,
      text: async () => '',
    }));
    let r!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      r = ReactTestRenderer.create(<Probe track={track} headers={headers} />);
    });
    await act(flush);
    expect(fetchMock).toHaveBeenCalledWith(track.url, { headers });
    expect(JSON.stringify(r.toJSON())).toContain('[]');
  });
});
