import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules, Platform } from 'react-native';
import type { UdpReply, UdpTransport } from '../../backend/jellyfin/discovery';
import {
  BASELINE_CAPABILITIES,
  capabilitiesFromAndroid,
  type AndroidAudioCapabilities,
  type AndroidDecoder,
  type AndroidDisplayCapabilities,
  type DeviceCapabilities,
} from '../../player/capabilities';
import type {
  CertificatePin,
  DeviceInfo,
  DisplayControl,
  DisplayModes,
  KeyValueStore,
  PlatformServices,
  TlsInspection,
  TlsTrust,
} from '../types';

interface XelpfinPlatformNative {
  getConstants?: () => Record<string, unknown>;
  udpBroadcast(
    message: string,
    port: number,
    timeoutMs: number,
    extraHosts: string[],
  ): Promise<UdpReply[]>;
  getDecoders(): Promise<AndroidDecoder[]>;
  /** Optional: older builds of the module lack it, so it is called defensively. */
  getDisplayCapabilities?(): Promise<AndroidDisplayCapabilities>;
  getAudioCapabilities?(): Promise<AndroidAudioCapabilities>;
  /** Optional: builds without TLS pinning lack them, and then `tls` is undefined. */
  inspectCertificate?(
    host: string,
    port: number,
    timeoutMs: number,
  ): Promise<TlsInspection>;
  setPinnedCertificates?(pins: CertificatePin[]): Promise<void>;
  /** Optional: builds without refresh rate matching lack them, and then `display` is undefined. */
  getDisplayModes?(): Promise<DisplayModes>;
  setPreferredDisplayMode?(modeId: number, timeoutMs: number): Promise<boolean>;
  [k: string]: unknown;
}

const native = NativeModules.XelpfinPlatform as
  XelpfinPlatformNative | undefined;

function constants(): Record<string, unknown> {
  if (!native) {
    return {};
  }
  return native.getConstants?.() ?? native;
}

const asyncStore: KeyValueStore = {
  get: key => AsyncStorage.getItem(key),
  set: (key, value) => AsyncStorage.setItem(key, value),
  remove: key => AsyncStorage.removeItem(key),
};

function deviceInfo(): DeviceInfo {
  const c = constants();
  const model = String(c.model ?? 'Android TV');
  const isFireTv = Boolean(c.isFireTv) || /^AFT/.test(model);
  return {
    name: isFireTv ? `Fire TV ${model}` : model,
    manufacturer: String(c.manufacturer ?? 'unknown'),
    model,
    osVersion: String(c.sdkInt ?? Platform.Version),
    abis: String(c.abis ?? '')
      .split(',')
      .filter(Boolean),
    isEmulator: Boolean(c.isEmulator),
    isFireTv,
  };
}

const udp: UdpTransport | undefined = native
  ? {
      broadcast: (message, port, timeoutMs, extraHosts = []) =>
        native.udpBroadcast(message, port, timeoutMs, extraHosts),
    }
  : undefined;

const INSPECT_TIMEOUT_MS = 5000;

const tls: TlsTrust | undefined =
  native &&
  typeof native.inspectCertificate === 'function' &&
  typeof native.setPinnedCertificates === 'function'
    ? {
        inspect: (host, port) =>
          native.inspectCertificate!(host, port, INSPECT_TIMEOUT_MS),
        setPins: pins => native.setPinnedCertificates!(pins),
      }
    : undefined;

/** How long to wait for the display to report a mode switch; HDMI renegotiation takes a few seconds. */
const MODE_SWITCH_TIMEOUT_MS = 5000;

const display: DisplayControl | undefined =
  native &&
  typeof native.getDisplayModes === 'function' &&
  typeof native.setPreferredDisplayMode === 'function'
    ? {
        modes: () =>
          native.getDisplayModes!().catch(() => ({
            modes: [],
            activeModeId: 0,
          })),
        setPreferredMode: modeId =>
          native.setPreferredDisplayMode!(modeId, MODE_SWITCH_TIMEOUT_MS).catch(
            () => false,
          ),
      }
    : undefined;

/** Calls an optional native query; a missing method or a rejection means "unknown". */
async function optional<T>(
  query: (() => Promise<T>) | undefined,
): Promise<T | undefined> {
  if (typeof query !== 'function') {
    return undefined;
  }
  try {
    return await query();
  } catch {
    return undefined;
  }
}

/**
 * Asks the module for decoders, display HDR formats and audio sink formats. Only the decoder
 * list is essential: without it (or when it is empty, as on an emulator without video
 * decoders) the baseline profile is used; the other two degrade to "none".
 */
async function queryCapabilities(
  mod: XelpfinPlatformNative,
): Promise<DeviceCapabilities> {
  const [decoders, display, audio] = await Promise.all([
    mod.getDecoders(),
    optional(mod.getDisplayCapabilities?.bind(mod)),
    optional(mod.getAudioCapabilities?.bind(mod)),
  ]);
  const caps = capabilitiesFromAndroid(decoders, { display, audio });
  return caps.video.length ? caps : BASELINE_CAPABILITIES;
}

let capsPromise: Promise<DeviceCapabilities> | undefined;

/** Fire TV / Android TV implementation of {@link PlatformServices}. */
export function createFireTvPlatform(): PlatformServices {
  const device = deviceInfo();
  return {
    id: 'firetv',
    device,
    storage: asyncStore,
    udp,
    tls,
    display,
    capabilities() {
      capsPromise ??= native
        ? queryCapabilities(native).catch(() => BASELINE_CAPABILITIES)
        : Promise.resolve(BASELINE_CAPABILITIES);
      return capsPromise;
    },
    discoveryHints: () => (device.isEmulator ? ['10.0.2.2'] : []),
    addressHint: () =>
      device.isEmulator ? 'http://10.0.2.2:8096' : '192.168.1.10:8096',
  };
}
