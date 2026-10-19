import { BackendError } from '../../src/backend/types';
import { describeError } from '../../src/ui/components';

describe('describeError', () => {
  it('never shows what the server sent with a failure', () => {
    const e = new BackendError(
      'GET /Items failed: HTTP 500',
      'server',
      500,
      'Call +1 555 0100 to unlock your account',
    );
    expect(describeError(e)).toBe(
      'The server could not complete the request (HTTP 500).',
    );
    expect(
      describeError(
        new BackendError('GET /Users/Me failed: HTTP 401', 'auth', 401),
      ),
    ).toBe('Your sign-in is no longer valid.');
  });

  it('keeps messages the app wrote itself', () => {
    expect(
      describeError(
        new BackendError('Wrong user name or password', 'auth', 401),
      ),
    ).toBe('Wrong user name or password');
    expect(
      describeError(
        new BackendError(
          'The server refused the stream (HTTP 500).',
          'server',
          500,
        ),
      ),
    ).toBe('The server refused the stream (HTTP 500).');
    expect(describeError(new Error('Storage is full'))).toBe('Storage is full');
  });
});
