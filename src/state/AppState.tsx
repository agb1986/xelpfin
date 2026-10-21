import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Backend, ServerConnector } from '../backend/Backend';
import { ResponseCache } from '../backend/cache';
import { CachedBackend } from '../backend/CachedBackend';
import type { ServerInfo, Session } from '../backend/types';
import type { DeviceCapabilities } from '../player/capabilities';
import { withAudioPassthrough, withBitrateCap } from '../player/capabilities';
import type { CertificatePin, PlatformServices } from '../platform/types';
import { guardBackend } from './authGuard';
import {
  loadServers,
  loadSession,
  pinForUrl,
  pinsFor,
  rememberServer,
  saveServers,
  saveSession,
  sameTlsEndpoint,
  withCertificate,
} from './servers';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type Settings,
} from './settings';

export interface AppStateValue {
  platform: PlatformServices;
  connector: ServerConnector;
  settings: Settings;
  updateSettings(patch: Partial<Settings>): void;
  servers: ServerInfo[];
  forgetServer(id: string): void;
  backend?: Backend;
  signIn(session: Session): void;
  /**
   * Logs out on the server and forgets the token; the server stays in the saved list.
   * `leave` must move the navigator off the signed-in screens. It runs in the same render as the
   * session going away, because a signed-in screen that renders without a backend throws.
   */
  signOut(leave: () => void): Promise<void>;
  /**
   * Set when the server rejected the session token (revoked or expired). The navigator sends
   * the user to the sign-in screen of that server and then calls {@link finishExpiry}.
   */
  authExpired?: ServerInfo;
  /** Drops the expired session; call after navigating away from signed-in screens. */
  finishExpiry(): void;
  /** Device capabilities with the user's bitrate cap and audio passthrough choice applied. */
  capabilities(): Promise<DeviceCapabilities>;
  /**
   * Trusts this exact certificate for its host and port from now on. Saved servers on that
   * endpoint take the new pin. Resolves once the platform enforces it, so a retry right after
   * goes through. Rejects when the platform cannot pin certificates.
   */
  trustCertificate(pin: CertificatePin): Promise<void>;
  /** The certificate pinned for this URL's https host and port, if any. */
  certificatePin(url: string): string | undefined;
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

/**
 * Reads persisted state and hands the saved certificate pins to the platform before anything
 * connects. Does no network I/O, so the first screen shows immediately.
 */
export async function loadBoot(platform: PlatformServices): Promise<Boot> {
  const [settings, servers, session] = await Promise.all([
    loadSettings(platform.storage),
    loadServers(platform.storage),
    loadSession(platform.storage),
  ]);
  await pushPins(platform, pinsFor([session?.server, ...servers]));
  return { settings, servers, session };
}

async function pushPins(platform: PlatformServices, pins: CertificatePin[]) {
  try {
    await platform.tls?.setPins(pins);
  } catch {
    // Without pins a self-signed server fails closed, which is the safe direction.
  }
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
  const [settings, setSettings] = useState<Settings>(
    boot.settings ?? DEFAULT_SETTINGS,
  );
  const [servers, setServers] = useState<ServerInfo[]>(boot.servers);
  const [session, setSession] = useState<Session | undefined>(boot.session);
  const [authExpired, setAuthExpired] = useState<ServerInfo>();
  // Responses are keyed by server and user, and the cache is emptied whenever the session ends.
  const [cache] = useState(() => new ResponseCache());
  // Certificates accepted in this run for servers not saved yet (the user has not signed in).
  const accepted = useRef<CertificatePin[]>([]);
  const latest = useRef({ servers, session });
  latest.current = { servers, session };
  const currentPins = useCallback(
    () =>
      pinsFor([
        latest.current.session?.server,
        ...latest.current.servers,
        ...accepted.current.map(p => ({
          id: '',
          name: '',
          url: `https://${bracket(p.host)}:${p.port}`,
          certSha256: p.sha256,
        })),
      ]),
    [],
  );
  const backend = useMemo(
    () =>
      session
        ? guardBackend(new CachedBackend(connector.open(session), cache), () =>
            setAuthExpired(session.server),
          )
        : undefined,
    [cache, connector, session],
  );

  useEffect(() => {
    saveSettings(platform.storage, settings);
  }, [platform, settings]);

  useEffect(() => {
    pushPins(platform, currentPins());
  }, [platform, currentPins, servers, session]);

  const updateSettings = useCallback(
    (patch: Partial<Settings>) => setSettings(s => ({ ...s, ...patch })),
    [],
  );

  const signIn = useCallback(
    (s: Session) => {
      cache.clear();
      setAuthExpired(undefined);
      setSession(s);
      saveSession(platform.storage, s);
      setServers(list => {
        const next = rememberServer(list, s.server);
        saveServers(platform.storage, next);
        return next;
      });
    },
    [cache, platform],
  );

  const signOut = useCallback(
    async (leave: () => void) => {
      await backend?.logout().catch(() => undefined);
      await saveSession(platform.storage, undefined);
      cache.clear();
      // Synchronous, so React applies both updates in one render.
      leave();
      setSession(undefined);
    },
    [backend, cache, platform],
  );

  const finishExpiry = useCallback(() => {
    // The token is already dead on the server, so there is nothing to log out of.
    cache.clear();
    setAuthExpired(undefined);
    setSession(undefined);
    saveSession(platform.storage, undefined);
  }, [cache, platform]);

  const forgetServer = useCallback(
    (id: string) =>
      setServers(list => {
        const gone = list.find(s => s.id === id);
        if (gone) {
          accepted.current = accepted.current.filter(
            p =>
              !sameTlsEndpoint(
                gone.url,
                `https://${bracket(p.host)}:${p.port}`,
              ),
          );
        }
        const next = list.filter(s => s.id !== id);
        saveServers(platform.storage, next);
        return next;
      }),
    [platform],
  );

  const trustCertificate = useCallback(
    async (pin: CertificatePin) => {
      const tls = platform.tls;
      if (!tls) {
        throw new Error('This device cannot trust self-signed certificates');
      }
      const url = `https://${bracket(pin.host)}:${pin.port}`;
      accepted.current = [
        ...accepted.current.filter(
          p => !sameTlsEndpoint(url, `https://${bracket(p.host)}:${p.port}`),
        ),
        pin,
      ];
      const next = withCertificate(latest.current.servers, url, pin.sha256);
      latest.current = { ...latest.current, servers: next };
      await tls.setPins(currentPins());
      setServers(next);
      saveServers(platform.storage, next);
    },
    [platform, currentPins],
  );

  const certificatePin = useCallback(
    (url: string) => pinForUrl(currentPins(), url),
    [currentPins],
  );

  const capabilities = useCallback(
    async () =>
      withAudioPassthrough(
        withBitrateCap(
          await platform.capabilities(),
          settings.maxBitrate || undefined,
        ),
        settings.audioPassthrough,
      ),
    [platform, settings.maxBitrate, settings.audioPassthrough],
  );

  const value = useMemo<AppStateValue>(
    () => ({
      platform,
      connector,
      settings,
      updateSettings,
      servers,
      forgetServer,
      backend,
      signIn,
      signOut,
      authExpired,
      finishExpiry,
      capabilities,
      trustCertificate,
      certificatePin,
    }),
    [
      platform,
      connector,
      settings,
      updateSettings,
      servers,
      forgetServer,
      backend,
      signIn,
      signOut,
      authExpired,
      finishExpiry,
      capabilities,
      trustCertificate,
      certificatePin,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const bracket = (host: string) => (host.includes(':') ? `[${host}]` : host);
