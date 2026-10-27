import { BackendError } from '../backend/types';

/**
 * The `error` object of react-native-video's `onError` event (`OnVideoErrorData['error']` in
 * 6.19). Android fills `errorString`, `errorException`, `errorStackTrace` and `errorCode`
 * (all strings); iOS fills `code`, `domain` and the `localized*` fields. Every field is
 * optional because the shape differs per platform, and `string` covers engines that only have
 * a message.
 */
export interface PlayerErrorInfo {
  errorString?: string;
  errorException?: string;
  errorStackTrace?: string;
  errorCode?: string | number;
  error?: string;
  code?: number;
  localizedDescription?: string;
  localizedFailureReason?: string;
  domain?: string;
}

export type PlayerFailure = string | PlayerErrorInfo;

/**
 * Message-only fallbacks. react-native-video 6.19 always sets `errorCode` on Android, so these
 * only run when an engine hands over a bare string or an unknown code.
 */
const NETWORK =
  /NETWORK|CONNECTION|UnknownHost|ConnectException|SocketTimeout|Unable to connect|ECONNREFUSED|IO_UNSPECIFIED|\b200[0-9]\b/i;
const BAD_HTTP = /BAD_HTTP_STATUS|Response code: (\d{3})|\b2004\b/i;
const FORMAT =
  /DECODER|DECODING|PARSING|UNSUPPORTED|FORMAT|\b300[0-9]\b|\b400[0-9]\b/i;

/**
 * media3 `PlaybackException` error codes, grouped by their thousands digit. react-native-video's
 * `ReactExoplayerView.onPlayerError` forwards them as `"2" + errorCode` (so 2004 arrives as
 * `"22004"`) with `errorString` set to `ExoPlaybackException: ERROR_CODE_<NAME>`.
 */
const EXO = {
  BEHIND_LIVE_WINDOW: 1002,
  TIMEOUT: 1003,
  IO_UNSPECIFIED: 2000,
  IO_NETWORK_CONNECTION_FAILED: 2001,
  IO_NETWORK_CONNECTION_TIMEOUT: 2002,
  IO_BAD_HTTP_STATUS: 2004,
  IO_CLEARTEXT_NOT_PERMITTED: 2007,
} as const;

/**
 * Codes react-native-video raises itself (not prefixed): player set-up and DRM session
 * failures in `ReactExoplayerView`.
 */
const RNV_PLAYER_INIT_FAILED = '1001';
const RNV_DRM_CODES = new Set(['3002', '3003', '3006', '3007']);

/**
 * media3 reports an exception its loader did not expect (a parser reading a bad value, such as
 * `IllegalStateException: Top bit not zero`) as ERROR_CODE_IO_UNSPECIFIED, the same code as a
 * dropped connection. Only the stack trace tells them apart.
 */
const UNEXPECTED_LOAD_EXCEPTION =
  /Unexpected (?:IllegalState|IllegalArgument|Runtime|ArrayIndexOutOfBounds|NullPointer)Exception|ParserException/;

/**
 * True when the stream reached the player but its bytes could not be parsed. Retrying the same
 * stream will fail again; asking the server for a different segment format may not.
 */
export function isStreamParseFailure(failure: PlayerFailure): boolean {
  if (typeof failure === 'string') {
    return false;
  }
  const code = exoCode(failure);
  if (code === undefined) {
    return false;
  }
  if (Math.floor(code / 1000) === 3) {
    return true;
  }
  return (
    code === EXO.IO_UNSPECIFIED &&
    [failure.errorStackTrace, failure.errorException].some(
      t => t !== undefined && UNEXPECTED_LOAD_EXCEPTION.test(t),
    )
  );
}

/** The media3 error code behind react-native-video's `"2" + errorCode`, if there is one. */
function exoCode(failure: PlayerErrorInfo): number | undefined {
  const code =
    failure.errorCode === undefined ? undefined : String(failure.errorCode);
  return code && /^2\d{4}$/.test(code) ? Number(code.slice(1)) : undefined;
}

/**
 * Turns a react-native-video error (or a bare message from another engine) into an error the
 * UI can explain. Losing the server mid-playback shows the same message as anywhere else.
 */
export function playerError(failure: PlayerFailure): Error {
  if (typeof failure === 'string') {
    return fromMessage(failure);
  }
  const code =
    failure.errorCode === undefined ? undefined : String(failure.errorCode);
  const name = errorCodeName(failure);
  const detail = failure.errorException ?? failure.errorString;
  const exo = exoCode(failure);

  if (exo !== undefined) {
    if (exo === EXO.IO_UNSPECIFIED && isStreamParseFailure(failure)) {
      return new BackendError(
        `The stream could not be read from the server (${name}).`,
        'server',
        undefined,
        detail,
      );
    }
    if (exo === EXO.IO_BAD_HTTP_STATUS) {
      return httpError(httpStatus(failure));
    }
    if (
      exo === EXO.IO_UNSPECIFIED ||
      exo === EXO.IO_NETWORK_CONNECTION_FAILED ||
      exo === EXO.IO_CLEARTEXT_NOT_PERMITTED
    ) {
      return new BackendError(
        `The server could not be reached (${name}).`,
        'network',
        undefined,
        detail,
      );
    }
    if (exo === EXO.IO_NETWORK_CONNECTION_TIMEOUT || exo === EXO.TIMEOUT) {
      return new BackendError(
        `The server took too long to answer (${name}).`,
        'timeout',
        undefined,
        detail,
      );
    }
    if (exo === EXO.BEHIND_LIVE_WINDOW) {
      return new Error(`Playback fell behind the live stream (${name}).`);
    }
    switch (Math.floor(exo / 1000)) {
      case 2:
        return new BackendError(
          `The stream could not be read from the server (${name}).`,
          'server',
          undefined,
          detail,
        );
      case 3:
        return new Error(
          `This stream is in a format this device cannot read (${name}).`,
        );
      case 4:
      case 7:
        return new Error(
          `This video could not be decoded on this device (${name}).`,
        );
      case 5:
        return new Error(
          `The audio in this video could not be played on this device (${name}).`,
        );
      case 6:
        return drmError(name);
      default:
        break;
    }
  } else if (code === RNV_PLAYER_INIT_FAILED) {
    return new Error(`The player could not be started (${name}).`);
  } else if (code && RNV_DRM_CODES.has(code)) {
    return drmError(name);
  }

  // No code, an iOS or web code, or one this version does not know: go by the text.
  return fromMessage(messageOf(failure));
}

function fromMessage(message: string): Error {
  const http = BAD_HTTP.exec(message);
  if (http) {
    return httpError(http[1] ? Number(http[1]) : undefined);
  }
  if (NETWORK.test(message)) {
    return new BackendError(message, 'network');
  }
  if (FORMAT.test(message)) {
    return new Error(
      `This video could not be decoded on this device (${message}).`,
    );
  }
  return new Error(message || 'Playback failed');
}

function httpError(status: number | undefined): BackendError {
  if (status === 401) {
    return new BackendError('Your sign-in is no longer valid.', 'auth', status);
  }
  if (status === 403) {
    return new BackendError(
      'This account is not allowed to play this item.',
      'forbidden',
      status,
    );
  }
  if (status === 404) {
    return new BackendError(
      'The server no longer has this stream.',
      'notFound',
      status,
    );
  }
  return new BackendError(
    `The server refused the stream${status ? ` (HTTP ${status})` : ''}.`,
    'server',
    status,
  );
}

function drmError(name: string): Error {
  return new Error(
    `This video is protected by DRM that this device cannot play (${name}).`,
  );
}

/**
 * The HTTP status of a bad-status failure. media3 wraps it as
 * `HttpDataSource$InvalidResponseCodeException: Response code: 401`, which react-native-video
 * only surfaces in the stack trace: `errorException` is the outer `ExoPlaybackException:
 * Source error`.
 */
function httpStatus(failure: PlayerErrorInfo): number | undefined {
  for (const text of [
    failure.errorStackTrace,
    failure.errorException,
    failure.errorString,
  ]) {
    const m = text && /Response code: (\d{3})/.exec(text);
    if (m) {
      return Number(m[1]);
    }
  }
  return undefined;
}

/** `ERROR_CODE_IO_BAD_HTTP_STATUS` from the error string, else the raw code or the text. */
function errorCodeName(failure: PlayerErrorInfo): string {
  const named = /ERROR_CODE_[A-Z_]+/.exec(failure.errorString ?? '');
  if (named) {
    return named[0];
  }
  if (failure.errorCode !== undefined) {
    return String(failure.errorCode);
  }
  return messageOf(failure);
}

/** The message a react-native-video error carries, with the code appended as before. */
function messageOf(failure: PlayerErrorInfo): string {
  const text = String(
    failure.errorString ??
      failure.localizedDescription ??
      failure.error ??
      failure.errorException ??
      'Playback failed',
  );
  const code = failure.errorCode ?? failure.code;
  return code !== undefined && !text.includes(String(code))
    ? `${text} (${String(code)})`
    : text;
}
