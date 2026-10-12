import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Backend, ServerConnector } from '../backend/Backend';
import type { ServerInfo, Session } from '../backend/types';
import type { DeviceCapabilities } from '../player/capabilities';
import { withBitrateCap } from '../player/capabilities';
import type { PlatformServices } from '../platform/types';
import { loadServers, loadSession, rememberServer, saveServers, saveSession } from './servers';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from './settings';

export interface AppStateValue {
  platform: PlatformServices;
  connector: ServerConnector;
  settings: Settings;
  updateSettings(patch: Partial<Settings>): void;
  servers: ServerInfo[];
  forgetServer(id: string): void;
  backend?: Backend;
  signIn(session: Session): void;
  /** Forgets the token. `server` stays in the saved list. */
  signOut(): Promise<void>;
  /** Device capabilities with the user's bitrate cap applied. */
  capabilities(): Promise<DeviceCapabilities>;
}

const Ctx = createContext<AppStateValue | null>(null);

export function useApp(): AppStateValue {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error('useApp outside AppStateProvider');
  }
  return v;
}

/** Same as useApp but for screens that require a signed-in backend. */
export function useBackend(): Backend {
  const { backend } = useApp();
  if (!backend) {
    throw new Error('No signed-in backend');
  }
  return backend;
}

export interface Boot {
  settings: Settings;
  servers: ServerInfo[];
  session?: Session;
}

/** Reads persisted state. Does no network I/O, so the first screen shows immediately. */
export async function loadBoot(platform: PlatformServices): Promise<Boot> {
  const [settings, servers, session] = await Promise.all([
    loadSettings(platform.storage),
    loadServers(platform.storage),
    loadSession(platform.storage),
  ]);
  return { settings, servers, session };
}

export function AppStateProvider({
  platform,
  connector,
  boot,
  children,
}: {
  platform: PlatformServices;
  connector: ServerConnector;
  boot: Boot;
  children: React.ReactNode;
}) {
  const [settings, setSettings] = useState<Settings>(boot.settings ?? DEFAULT_SETTINGS);
  const [servers, setServers] = useState<ServerInfo[]>(boot.servers);
  const [session, setSession] = useState<Session | undefined>(boot.session);
  const backend = useMemo(() => (session ? connector.open(session) : undefined), [connector, session]);

  useEffect(() => {
    saveSettings(platform.storage, settings);
  }, [platform, settings]);

  const updateSettings = useCallback((patch: Partial<Settings>) => setSettings(s => ({ ...s, ...patch })), []);

  const signIn = useCallback(
    (s: Session) => {
      setSession(s);
      saveSession(platform.storage, s);
      setServers(list => {
        const next = rememberServer(list, s.server);
        saveServers(platform.storage, next);
        return next;
      });
    },
    [platform],
  );

  const signOut = useCallback(async () => {
    await backend?.logout().catch(() => undefined);
    setSession(undefined);
    await saveSession(platform.storage, undefined);
  }, [backend, platform]);

  const forgetServer = useCallback(
    (id: string) =>
      setServers(list => {
        const next = list.filter(s => s.id !== id);
        saveServers(platform.storage, next);
        return next;
      }),
    [platform],
  );

  const capabilities = useCallback(
    async () => withBitrateCap(await platform.capabilities(), settings.maxBitrate || undefined),
    [platform, settings.maxBitrate],
  );

  const value = useMemo<AppStateValue>(
    () => ({ platform, connector, settings, updateSettings, servers, forgetServer, backend, signIn, signOut, capabilities }),
    [platform, connector, settings, updateSettings, servers, forgetServer, backend, signIn, signOut, capabilities],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
