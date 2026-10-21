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

/** One certificate of a chain a server presented, as shown to the user before trusting it. */
export interface CertificateSummary {
  /** SHA-256 of the DER encoding, upper-case hex pairs joined by colons. */
  sha256: string;
  subject: string;
  issuer: string;
  /** Validity window, ms since the epoch. */
  notBefore: number;
  notAfter: number;
  selfSigned: boolean;
}

/** What a TLS server presented, read without sending it any request. */
export interface TlsInspection {
  host: string;
  port: number;
  /** True when the system trust store accepts the chain, so no pin is needed. */
  trusted: boolean;
  /** Why the system trust store rejected the chain. */
  trustError?: string;
  /** Leaf first. */
  chain: CertificateSummary[];
}

/** A leaf certificate the user accepted for exactly one host and port. */
export interface CertificatePin {
  host: string;
  port: number;
  sha256: string;
}

/**
 * Trust on first use for self-signed servers. The platform keeps its system trust store and
 * consults pins only when that store rejects a chain; a pin never widens trust to any other
 * certificate, host or port.
 */
export interface TlsTrust {
  inspect(host: string, port: number): Promise<TlsInspection>;
  /** Replaces the whole pin list. Resolve before making requests that depend on it. */
  setPins(pins: CertificatePin[]): Promise<void>;
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
  /** Certificate pinning for self-signed https servers; undefined when unsupported. */
  readonly tls?: TlsTrust;
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
