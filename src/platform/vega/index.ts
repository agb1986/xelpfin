import AsyncStorage from '@react-native-async-storage/async-storage';
import { BASELINE_CAPABILITIES } from '../../player/capabilities';
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
 *  - udp: discovery through Vega's networking API (or leave undefined and rely on manual entry),
 *  - capabilities: query the Vega media stack instead of Android MediaCodecList,
 *  - a PlayerEngine on Vega's W3C media player instead of react-native-video/ExoPlayer.
 * Until then this adapter reports the baseline codec set and has no discovery.
 */
export function createVegaPlatform(): PlatformServices {
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
    capabilities: async () => BASELINE_CAPABILITIES,
    discoveryHints: () => [],
    addressHint: () => '192.168.1.10:8096',
  };
}
