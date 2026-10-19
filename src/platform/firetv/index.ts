import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules, Platform } from 'react-native';
import type { UdpReply, UdpTransport } from '../../backend/jellyfin/discovery';
import {
  BASELINE_CAPABILITIES,
  capabilitiesFromAndroid,
  type AndroidDecoder,
  type DeviceCapabilities,
} from '../../player/capabilities';
import type { DeviceInfo, KeyValueStore, PlatformServices } from '../types';

interface XelpfinPlatformNative {
  getConstants?: () => Record<string, unknown>;
  udpBroadcast(
    message: string,
    port: number,
    timeoutMs: number,
    extraHosts: string[],
  ): Promise<UdpReply[]>;
  getDecoders(): Promise<AndroidDecoder[]>;
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

let capsPromise: Promise<DeviceCapabilities> | undefined;

/** Fire TV / Android TV implementation of {@link PlatformServices}. */
export function createFireTvPlatform(): PlatformServices {
  const device = deviceInfo();
  return {
    id: 'firetv',
    device,
    storage: asyncStore,
    udp,
    capabilities() {
      capsPromise ??= native
        ? native
            .getDecoders()
            .then(d => {
              const caps = capabilitiesFromAndroid(d);
              return caps.video.length ? caps : BASELINE_CAPABILITIES;
            })
            .catch(() => BASELINE_CAPABILITIES)
        : Promise.resolve(BASELINE_CAPABILITIES);
      return capsPromise;
    },
    discoveryHints: () => (device.isEmulator ? ['10.0.2.2'] : []),
    addressHint: () =>
      device.isEmulator ? 'http://10.0.2.2:8096' : '192.168.1.10:8096',
  };
}
