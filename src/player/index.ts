import type { PlayerEngine } from './PlayerEngine';
import { VideoEngine } from './rnv/VideoEngine';

export * from './PlayerEngine';
export * from './capabilities';
export { VideoEngine };

/**
 * The engine the screens use. Fire TV (and any Android TV) uses react-native-video; a Vega OS
 * build would return its own engine here, chosen the same way as the platform adapter.
 */
export function getEngine(): PlayerEngine {
  return VideoEngine;
}
