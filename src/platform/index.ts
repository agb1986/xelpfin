import type { PlatformServices } from './types';

export * from './types';

let current: PlatformServices | undefined;

/**
 * Registers the adapter for the running OS. Each app entry point (index.js for Fire TV and
 * Android TV, vega/index.js for Vega OS) calls this once before the app renders, so a bundle
 * only contains the adapter it uses.
 */
export function setPlatform(platform: PlatformServices): void {
  current = platform;
}

export function getPlatform(): PlatformServices {
  if (!current) {
    throw new Error(
      'No platform registered: call setPlatform() from the app entry point',
    );
  }
  return current;
}
