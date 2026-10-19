import type { UdpTransport } from '../backend/jellyfin/discovery';
import type { DeviceCapabilities } from '../player/capabilities';

/** Small async key/value store (AsyncStorage on Fire TV). Values are strings. */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface DeviceInfo {
  /** Human readable device name sent to the server, e.g. "AFTKA" or "Fire TV Stick". */
  name: string;
  manufacturer: string;
  model: string;
  osVersion: string;
  abis: string[];
  isEmulator: boolean;
  isFireTv: boolean;
}

/**
 * Everything the shared app code needs from the host OS. Fire TV (Android) implements it with
 * a small Kotlin module plus AsyncStorage; Vega OS gets its own implementation later. Nothing
 * outside src/platform imports react-native NativeModules directly.
 */
export interface PlatformServices {
  readonly id: 'firetv' | 'vega' | 'test';
  readonly device: DeviceInfo;
  readonly storage: KeyValueStore;
  /** UDP round trip for LAN discovery; undefined when the platform cannot send UDP. */
  readonly udp?: UdpTransport;
  /** Decoder capabilities used for the playback device profile. */
  capabilities(): Promise<DeviceCapabilities>;
  /**
   * Hosts to ask directly during discovery in addition to the broadcast, e.g. the host loopback
   * alias 10.0.2.2 on the Android emulator, where broadcasts do not leave the virtual network.
   */
  discoveryHints(): string[];
  /** Placeholder shown in the manual address field. */
  addressHint(): string;
}

const DEVICE_ID_KEY = 'xelpfin.deviceId';

/** Stable per-install id the server uses to tell sessions apart. Created on first launch. */
export async function getOrCreateDeviceId(
  storage: KeyValueStore,
  random: () => number = Math.random,
): Promise<string> {
  const existing = await storage.get(DEVICE_ID_KEY).catch(() => null);
  if (existing) {
    return existing;
  }
  let id = 'xelpfin-';
  for (let i = 0; i < 24; i++) {
    id += Math.floor(random() * 16).toString(16);
  }
  await storage.set(DEVICE_ID_KEY, id).catch(() => undefined);
  return id;
}

/** In-memory store for tests and as a fallback when persistent storage is unavailable. */
export class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, string>();
  async get(key: string) {
    return this.data.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.data.set(key, value);
  }
  async remove(key: string) {
    this.data.delete(key);
  }
}
