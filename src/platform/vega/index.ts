import { BASELINE_CAPABILITIES } from '../../player/capabilities';
import { MemoryStore, type PlatformServices } from '../types';

/**
 * Vega OS boundary. Vega apps are React Native too, so everything above src/platform and the
 * PlayerEngine is meant to be reused unchanged. What has to be written for Vega:
 *  - storage: Vega's persistent key/value API instead of AsyncStorage,
 *  - udp: discovery through Vega's networking API (or leave undefined and rely on manual entry),
 *  - capabilities: query the Vega media stack instead of Android MediaCodecList,
 *  - a PlayerEngine on Vega's W3C media player instead of react-native-video/ExoPlayer.
 * Until then this stub keeps data in memory and reports the baseline codec set.
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
    storage: new MemoryStore(),
    udp: undefined,
    capabilities: async () => BASELINE_CAPABILITIES,
    discoveryHints: () => [],
    addressHint: () => '192.168.1.10:8096',
  };
}
