import { BackendError } from '../backend/types';

const NETWORK = /NETWORK|CONNECTION|UnknownHost|ConnectException|SocketTimeout|Unable to connect|ECONNREFUSED|IO_UNSPECIFIED|\b200[0-9]\b/i;
const BAD_HTTP = /BAD_HTTP_STATUS|Response code: (\d{3})|\b2004\b/i;
const FORMAT = /DECODER|DECODING|PARSING|UNSUPPORTED|FORMAT|\b300[0-9]\b|\b400[0-9]\b/i;

/**
 * Turns a raw player error message (ExoPlayer error codes and exception names) into an error
 * the UI can explain. Losing the server mid-playback shows the same message as anywhere else.
 */
export function playerError(message: string): Error {
  const http = BAD_HTTP.exec(message);
  if (http) {
    const status = http[1] ? Number(http[1]) : undefined;
    if (status === 401) {
      return new BackendError('Your sign-in is no longer valid.', 'auth', status);
    }
    if (status === 403) {
      return new BackendError('This account is not allowed to play this item.', 'forbidden', status);
    }
    return new BackendError(`The server refused the stream${status ? ` (HTTP ${status})` : ''}.`, 'server', status);
  }
  if (NETWORK.test(message)) {
    return new BackendError(message, 'network');
  }
  if (FORMAT.test(message)) {
    return new Error(`This video could not be decoded on this device (${message}).`);
  }
  return new Error(message || 'Playback failed');
}
