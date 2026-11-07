import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  BASELINE_CAPABILITIES,
  type DeviceCapabilities,
} from '../../player/capabilities';
import type { KeyValueStore, PlatformServices } from '../types';

// In the Vega bundle this import resolves to Vega's AsyncStorage package (an npm alias).
const asyncStore: KeyValueStore = {
  get: key => AsyncStorage.getItem(key),
  set: (key, value) => AsyncStorage.setItem(key, value),
  remove: key => AsyncStorage.removeItem(key),
};

/**
 * Vega OS boundary. Vega apps are React Native too, so everything above src/platform and the
 * PlayerEngine is meant to be reused unchanged. What has to be written for Vega:
 *  - storage: done, Vega's AsyncStorage package through the npm alias in vega/package.json,
 *  - udp: the Vega SDK has no UDP API, so it stays undefined and the user types the address,
 *  - capabilities: queried from the Vega media stack by vega/platform/mediaCapabilities.ts, which
 *    the entry point passes in (the root app cannot import the Vega-only package),
 *  - a PlayerEngine on Vega's W3C media player: done, vega/player/VegaEngine.tsx.
 * Without a query function the adapter reports the baseline codec set.
 */
export function createVegaPlatform(
  queryCapabilities?: () => Promise<DeviceCapabilities>,
): PlatformServices {
  let caps: Promise<DeviceCapabilities> | undefined;
  return {
    id: 'vega',
    device: {
      name: 'Vega OS',
      manufacturer: 'Amazon',
      model: 'vega',
      osVersion: '0',
      abis: [],
      isEmulator: false,
      isFireTv: true,
    },
    storage: asyncStore,
    udp: undefined,
    capabilities() {
      caps ??= (
        queryCapabilities?.() ?? Promise.resolve(BASELINE_CAPABILITIES)
      ).catch(() => BASELINE_CAPABILITIES);
      return caps;
    },
    discoveryHints: () => [],
    addressHint: () => '192.168.1.10:8096',
  };
}
