import { BackendError } from '../../src/backend/types';
import { playerError } from '../../src/player/errors';

describe('playerError', () => {
  it('maps HTTP failures of the stream', () => {
    const auth = playerError('Response code: 401 (ERROR_CODE_IO_BAD_HTTP_STATUS)');
    expect(auth).toBeInstanceOf(BackendError);
    expect((auth as BackendError).kind).toBe('auth');
    expect((auth as BackendError).status).toBe(401);
    const server = playerError('Response code: 500');
    expect((server as BackendError).kind).toBe('server');
    expect(server.message).toContain('HTTP 500');
  });

  it('maps lost connections to network errors', () => {
    for (const msg of ['ERROR_CODE_IO_NETWORK_CONNECTION_FAILED (2001)', 'java.net.ConnectException: failed to connect', 'Unable to connect to http://x']) {
      const e = playerError(msg);
      expect(e).toBeInstanceOf(BackendError);
      expect((e as BackendError).kind).toBe('network');
    }
  });

  it('explains decoder problems and keeps anything else', () => {
    expect(playerError('ERROR_CODE_DECODER_INIT_FAILED (4001)').message).toMatch(/could not be decoded/);
    expect(playerError('weird').message).toBe('weird');
    expect(playerError('').message).toBe('Playback failed');
  });
});
