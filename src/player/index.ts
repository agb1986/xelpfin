import type { PlayerEngine } from './PlayerEngine';

export * from './PlayerEngine';
export * from './capabilities';

let current: PlayerEngine | undefined;

/**
 * Registers the engine the screens use. Fire TV (and any Android TV) registers the
 * react-native-video engine; the Vega OS entry point registers its own, so a bundle only
 * contains the media stack it runs on.
 */
export function setEngine(engine: PlayerEngine): void {
  current = engine;
}

export function getEngine(): PlayerEngine {
  if (!current) {
    throw new Error(
      'No player engine registered: call setEngine() from the app entry point',
    );
  }
  return current;
}
