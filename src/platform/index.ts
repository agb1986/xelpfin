import { Platform } from 'react-native';
import { createFireTvPlatform } from './firetv';
import { createVegaPlatform } from './vega';
import type { PlatformServices } from './types';

export * from './types';

let current: PlatformServices | undefined;

/** Picks the adapter for the running OS. Android (Fire OS, Android TV) is the only real one today. */
export function getPlatform(): PlatformServices {
  current ??= Platform.OS === 'android' ? createFireTvPlatform() : createVegaPlatform();
  return current;
}
