import { BASELINE_CAPABILITIES } from '../src/player/capabilities';
import { MemoryStore, type PlatformServices } from '../src/platform/types';

/** Platform adapter for UI tests: in-memory storage, no UDP, baseline decoders. */
export function testPlatform(store = new MemoryStore()): PlatformServices {
  return {
    id: 'test',
    device: {
      name: 'test-device',
      manufacturer: 'test',
      model: 'test',
      osVersion: '35',
      abis: ['x86_64'],
      isEmulator: true,
      isFireTv: false,
    },
    storage: store,
    capabilities: async () => BASELINE_CAPABILITIES,
    discoveryHints: () => [],
    addressHint: () => 'http://127.0.0.1:8096',
  };
}
