import { BackendError } from '../../src/backend/types';
import { playerError, type PlayerErrorInfo } from '../../src/player/errors';

/**
 * Error objects as react-native-video 6.19.3 emits them on Android (media3 1.8):
 * `VideoEventEmitter.onVideoError` puts `errorString`, `errorException` (`exception.toString()`),
 * `errorCode` and `errorStackTrace` on `event.error`. `ReactExoplayerView.onPlayerError` builds
 * `errorString` as `ExoPlaybackException: <code name>` and `errorCode` as `"2" + errorCode`, so
 * the HTTP status only survives in the stack trace. The codes it raises itself (player set-up,
 * DRM) are not prefixed.
 */
function exo(
  codeName: string,
  code: number,
  causedBy: string[],
  message = 'Source error',
): PlayerErrorInfo {
  const outer = `androidx.media3.exoplayer.ExoPlaybackException: ${message}`;
  return {
    errorString: `ExoPlaybackException: ${codeName}`,
    errorException: outer,
    errorCode: `2${code}`,
    errorStackTrace: [
      outer,
      '\tat androidx.media3.exoplayer.ExoPlayerImplInternal.handleIoException(ExoPlayerImplInternal.java:2001)',
      '\tat androidx.media3.exoplayer.ExoPlayerImplInternal.handleMessage(ExoPlayerImplInternal.java:682)',
      ...causedBy.flatMap(c => [
        `Caused by: ${c}`,
        '\tat androidx.media3.datasource.DefaultHttpDataSource.open(DefaultHttpDataSource.java:403)',
      ]),
    ].join('\n'),
  };
}

const fixtures = {
  networkUnreachable: exo('ERROR_CODE_IO_NETWORK_CONNECTION_FAILED', 2001, [
    'androidx.media3.datasource.HttpDataSource$HttpDataSourceException: java.net.ConnectException: Failed to connect to /192.168.1.20:8096',
    'java.net.ConnectException: Failed to connect to /192.168.1.20:8096',
  ]),
  networkTimeout: exo('ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT', 2002, [
    'androidx.media3.datasource.HttpDataSource$HttpDataSourceException: java.net.SocketTimeoutException: timeout',
  ]),
  http401: exo('ERROR_CODE_IO_BAD_HTTP_STATUS', 2004, [
    'androidx.media3.datasource.HttpDataSource$InvalidResponseCodeException: Response code: 401',
  ]),
  http403: exo('ERROR_CODE_IO_BAD_HTTP_STATUS', 2004, [
    'androidx.media3.datasource.HttpDataSource$InvalidResponseCodeException: Response code: 403',
  ]),
  http404: exo('ERROR_CODE_IO_BAD_HTTP_STATUS', 2004, [
    'androidx.media3.datasource.HttpDataSource$InvalidResponseCodeException: Response code: 404',
  ]),
  http503: exo('ERROR_CODE_IO_BAD_HTTP_STATUS', 2004, [
    'androidx.media3.datasource.HttpDataSource$InvalidResponseCodeException: Response code: 503',
  ]),
  containerUnsupported: exo('ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED', 3003, [
    'androidx.media3.exoplayer.source.UnrecognizedInputFormatException: None of the available extractors (FlvExtractor, FlacExtractor, WavExtractor, FragmentedMp4Extractor, Mp4Extractor, AmrExtractor, PsExtractor, OggExtractor, TsExtractor, MatroskaExtractor, AdtsExtractor, Ac3Extractor, Ac4Extractor, Mp3Extractor, AviExtractor, JpegExtractor, PngExtractor, WebpExtractor, BmpExtractor, HeifExtractor, AvifExtractor) could read the stream.',
  ]),
  decoderInitFailed: exo(
    'ERROR_CODE_DECODER_INIT_FAILED',
    4001,
    [
      'androidx.media3.exoplayer.mediacodec.MediaCodecRenderer$DecoderInitializationException: Decoder init failed: OMX.amlogic.avc.decoder.awesome, Format(1, null, null, video/hevc, hvc1.2.4.L153.B0, -1, null, [3840, 2160, 23.976, ColorInfo(BT2020, Limited range, ST 2084 PQ, null, 10, 10)], [-1, -1])',
    ],
    'MediaCodecVideoRenderer error, index=0, format=Format(1, null, null, video/hevc, hvc1.2.4.L153.B0, -1, null, [3840, 2160, 23.976, ColorInfo(BT2020, Limited range, ST 2084 PQ, null, 10, 10)], [-1, -1]), format_supported=NO_UNSUPPORTED_TYPE',
  ),
  formatUnsupported: exo(
    'ERROR_CODE_DECODING_FORMAT_UNSUPPORTED',
    4005,
    [],
    'MediaCodecAudioRenderer error, index=1, format=Format(2, null, null, audio/true-hd, null, -1, eng, [-1, -1, -1.0, null], [8, 48000]), format_supported=NO_UNSUPPORTED_TYPE',
  ),
  audioTrackInitFailed: exo(
    'ERROR_CODE_AUDIO_TRACK_INIT_FAILED',
    5001,
    [
      'androidx.media3.exoplayer.audio.AudioSink$InitializationException: AudioTrack init failed 0 Config(48000, 12, 32768)',
    ],
    'MediaCodecAudioRenderer error, index=1, format=Format(2, null, null, audio/eac3, null, -1, eng, [-1, -1, -1.0, null], [6, 48000]), format_supported=YES',
  ),
  drmLicense: exo('ERROR_CODE_DRM_LICENSE_ACQUISITION_FAILED', 6004, [
    'androidx.media3.exoplayer.drm.DrmSession$DrmSessionException: androidx.media3.exoplayer.drm.MediaDrmCallbackException',
  ]),
  // ReactExoplayerView.initializePlayerDrm: an UnsupportedDrmException with the library's own code.
  drmUnsupported: {
    errorString: 'This device does not support the required DRM scheme',
    errorException:
      'androidx.media3.exoplayer.drm.UnsupportedDrmException: null',
    errorCode: '3003',
    errorStackTrace:
      'androidx.media3.exoplayer.drm.UnsupportedDrmException: null\n\tat com.brentvatne.exoplayer.ReactExoplayerView.buildDrmSessionManager(ReactExoplayerView.java:1120)',
  } satisfies PlayerErrorInfo,
  // ReactExoplayerView.initializePlayerCore: the activity went away before the player existed.
  playerInit: {
    errorString: 'Failed to initialize Player!',
    errorException: 'java.lang.Exception: Current Activity is null!',
    errorCode: '1001',
    errorStackTrace:
      'java.lang.Exception: Current Activity is null!\n\tat com.brentvatne.exoplayer.ReactExoplayerView$2.run(ReactExoplayerView.java:764)',
  } satisfies PlayerErrorInfo,
  unspecified: exo('ERROR_CODE_UNSPECIFIED', 1000, [
    'java.lang.IllegalStateException: boom',
  ]),
};

function backend(e: Error): BackendError {
  expect(e).toBeInstanceOf(BackendError);
  return e as BackendError;
}

describe('playerError with react-native-video 6.19 error objects', () => {
  it('maps the HTTP status of a bad-status data source failure', () => {
    const auth = backend(playerError(fixtures.http401));
    expect(auth.kind).toBe('auth');
    expect(auth.status).toBe(401);
    const forbidden = backend(playerError(fixtures.http403));
    expect(forbidden.kind).toBe('forbidden');
    expect(forbidden.status).toBe(403);
    const gone = backend(playerError(fixtures.http404));
    expect(gone.kind).toBe('notFound');
    expect(gone.status).toBe(404);
    const server = backend(playerError(fixtures.http503));
    expect(server.kind).toBe('server');
    expect(server.status).toBe(503);
    expect(server.message).toContain('HTTP 503');
  });

  it('maps a bad HTTP status without a readable code to a server error', () => {
    const e = backend(
      playerError({
        errorString: 'ExoPlaybackException: ERROR_CODE_IO_BAD_HTTP_STATUS',
        errorException:
          'androidx.media3.exoplayer.ExoPlaybackException: Source error',
        errorCode: '22004',
      }),
    );
    expect(e.kind).toBe('server');
    expect(e.status).toBeUndefined();
    expect(e.message).toBe('The server refused the stream.');
  });

  it('maps an unreachable server to a network error and a timeout to a timeout', () => {
    const net = backend(playerError(fixtures.networkUnreachable));
    expect(net.kind).toBe('network');
    expect(net.message).toContain('ERROR_CODE_IO_NETWORK_CONNECTION_FAILED');
    expect(net.detail).toBe(
      'androidx.media3.exoplayer.ExoPlaybackException: Source error',
    );
    expect(backend(playerError(fixtures.networkTimeout)).kind).toBe('timeout');
  });

  it('explains unsupported containers and decoder failures', () => {
    expect(playerError(fixtures.containerUnsupported).message).toBe(
      'This stream is in a format this device cannot read (ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED).',
    );
    for (const f of [fixtures.decoderInitFailed, fixtures.formatUnsupported]) {
      const e = playerError(f);
      expect(e).not.toBeInstanceOf(BackendError);
      expect(e.message).toMatch(/could not be decoded on this device/);
    }
    expect(playerError(fixtures.decoderInitFailed).message).toContain(
      'ERROR_CODE_DECODER_INIT_FAILED',
    );
    expect(playerError(fixtures.audioTrackInitFailed).message).toMatch(
      /audio .* could not be played/,
    );
  });

  it('explains DRM failures from both the player and the library', () => {
    expect(playerError(fixtures.drmLicense).message).toMatch(
      /protected by DRM.*ERROR_CODE_DRM_LICENSE_ACQUISITION_FAILED/,
    );
    expect(playerError(fixtures.drmUnsupported).message).toMatch(
      /protected by DRM.*3003/,
    );
  });

  it('reports a player that could not be set up', () => {
    expect(playerError(fixtures.playerInit).message).toBe(
      'The player could not be started (1001).',
    );
  });

  it('does not read line numbers in the stack trace as error codes', () => {
    // The stack trace carries ":2001" and ":682"; only the code decides.
    const e = playerError(fixtures.unspecified);
    expect(e).not.toBeInstanceOf(BackendError);
    expect(e.message).toBe(
      'ExoPlaybackException: ERROR_CODE_UNSPECIFIED (21000)',
    );
  });

  it('falls back to the text when the code is unknown or missing', () => {
    // An unknown library code with a telling message.
    const unknown = backend(
      playerError({
        errorString: 'DAI stream request failed: java.net.UnknownHostException',
        errorException: 'java.net.UnknownHostException: media.example',
        errorCode: 'DAI_REQUEST_ERROR',
      }),
    );
    expect(unknown.kind).toBe('network');
    // An iOS-shaped error: no errorCode, a numeric code and a localized description.
    const ios = playerError({
      code: -11800,
      domain: 'AVFoundationErrorDomain',
      localizedDescription: 'The operation could not be completed',
    });
    expect(ios.message).toBe('The operation could not be completed (-11800)');
    expect(playerError({}).message).toBe('Playback failed');
  });
});

describe('playerError with a bare message', () => {
  it('maps HTTP failures of the stream', () => {
    const auth = playerError(
      'Response code: 401 (ERROR_CODE_IO_BAD_HTTP_STATUS)',
    );
    expect(auth).toBeInstanceOf(BackendError);
    expect((auth as BackendError).kind).toBe('auth');
    expect((auth as BackendError).status).toBe(401);
    const forbidden = playerError('Response code: 403');
    expect((forbidden as BackendError).kind).toBe('forbidden');
    expect((forbidden as BackendError).status).toBe(403);
    const server = playerError('Response code: 500');
    expect((server as BackendError).kind).toBe('server');
    expect(server.message).toContain('HTTP 500');
  });

  it('maps lost connections to network errors', () => {
    for (const msg of [
      'ERROR_CODE_IO_NETWORK_CONNECTION_FAILED (2001)',
      'java.net.ConnectException: failed to connect',
      'Unable to connect to http://x',
    ]) {
      const e = playerError(msg);
      expect(e).toBeInstanceOf(BackendError);
      expect((e as BackendError).kind).toBe('network');
    }
  });

  it('explains decoder problems and keeps anything else', () => {
    expect(
      playerError('ERROR_CODE_DECODER_INIT_FAILED (4001)').message,
    ).toMatch(/could not be decoded/);
    expect(playerError('weird').message).toBe('weird');
    expect(playerError('').message).toBe('Playback failed');
  });
});
