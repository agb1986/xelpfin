/* global jest */

/**
 * react-native exports every component through a lazy getter, and `findNodeHandle` loads the whole
 * dev renderer on its first call. Under Jest each of those modules is required, and on an empty
 * transform cache babel-transformed, the first time a test touches it, so the first test in a file
 * that renders anything can spend seconds loading modules and run past Jest's 5 s test timeout. CI
 * starts with an empty cache and collects coverage, which makes that cost largest exactly there.
 *
 * Call it from `beforeAll` with its own timeout, so the one-off loading happens where a slow start
 * is expected and each test's timeout only measures the test:
 *
 *     beforeAll(warmUpReactNative, WARM_UP_TIMEOUT_MS);
 */
export function warmUpReactNative() {
  const rn = require('react-native') as Record<string, unknown>;
  // Some exports log a deprecation warning when first read.
  const quiet = [
    jest.spyOn(console, 'warn').mockImplementation(() => {}),
    jest.spyOn(console, 'error').mockImplementation(() => {}),
  ];
  try {
    for (const key of Object.keys(rn)) {
      try {
        Reflect.get(rn, key);
      } catch {
        // Removed or platform-only exports throw on access; nothing under test uses them.
      }
    }
    (rn.findNodeHandle as (n: null) => unknown)(null);
  } finally {
    quiet.forEach(s => s.mockRestore());
  }
}

/** Generous because it only bounds a cold start; a warm cache finishes in well under a second. */
export const WARM_UP_TIMEOUT_MS = 60_000;
