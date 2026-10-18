import React, { useCallback, useEffect, useState } from 'react';
import { BackHandler, StatusBar, StyleSheet, Text, View } from 'react-native';
import type { ServerConnector } from './src/backend/Backend';
import { JellyfinConnector } from './src/backend/jellyfin/JellyfinBackend';
import { BackendError } from './src/backend/types';
import { getPlatform, getOrCreateDeviceId, type PlatformServices } from './src/platform';
import { AppStateProvider, loadBoot, useApp, type Boot } from './src/state/AppState';
import { NavigationStack, useNavigation, type Route } from './src/state/navigation';
import { LoadingView, ScreenBoundary } from './src/ui/components';
import {
  DetailScreen,
  HomeScreen,
  LibraryScreen,
  LoginScreen,
  PlayerScreen,
  SearchScreen,
  ServerSelectScreen,
  RandomizerHistoryScreen,
  SettingsScreen,
} from './src/ui/screens';
import { colors } from './src/ui/theme';
import { APP_NAME, APP_VERSION } from './src/version';

interface Ready {
  connector: ServerConnector;
  boot: Boot;
  initial: Route[];
}

const VALIDATE_TIMEOUT_MS = 4000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new BackendError('timeout', 'timeout')), ms);
    p.then(
      v => {
        clearTimeout(t);
        resolve(v);
      },
      e => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Reads persisted state and decides the first screen. Never blocks long on the network. */
async function bootstrap(platform: PlatformServices, connectorOverride?: ServerConnector): Promise<Ready> {
  const connector =
    connectorOverride ??
    new JellyfinConnector({
      client: { client: APP_NAME, device: platform.device.name, deviceId: await getOrCreateDeviceId(platform.storage), version: APP_VERSION },
      udp: platform.udp,
    });
  const boot = await loadBoot(platform);
  if (!boot.session) {
    return { connector, boot, initial: [{ name: 'servers' }] };
  }
  try {
    await withTimeout(connector.open(boot.session).validate(), VALIDATE_TIMEOUT_MS);
  } catch (e) {
    if (e instanceof BackendError && e.kind === 'auth') {
      // Token revoked: go straight to the user picker of the same server.
      const server = boot.session.server;
      return { connector, boot: { ...boot, session: undefined }, initial: [{ name: 'servers' }, { name: 'login', server, expired: true }] };
    }
    // Server offline or slow: start on home anyway; it shows its own error with retry.
  }
  return { connector, boot, initial: [{ name: 'home' }] };
}

function renderRoute(route: Route): React.ReactNode {
  return <ScreenBoundary>{screenFor(route)}</ScreenBoundary>;
}

function screenFor(route: Route): React.ReactNode {
  switch (route.name) {
    case 'servers':
      return <ServerSelectScreen />;
    case 'login':
      return <LoginScreen server={route.server} expired={route.expired} />;
    case 'home':
      return <HomeScreen />;
    case 'library':
      return <LibraryScreen library={route.library} />;
    case 'detail':
      return <DetailScreen itemId={route.itemId} seasonId={route.seasonId} />;
    case 'search':
      return <SearchScreen />;
    case 'settings':
      return <SettingsScreen />;
    case 'randomizerHistory':
      return <RandomizerHistoryScreen />;
    case 'player':
      return <PlayerScreen itemId={route.itemId} startPositionMs={route.startPositionMs} shuffle={route.shuffle} />;
  }
}

/** Sends the user to sign in again when the server rejects the session token mid-use. */
function AuthExpiryWatcher() {
  const { authExpired, finishExpiry } = useApp();
  const nav = useNavigation();
  useEffect(() => {
    if (authExpired) {
      // Both updates land in one render, so no signed-in screen renders without a backend.
      nav.reset([{ name: 'servers' }, { name: 'login', server: authExpired, expired: true }]);
      finishExpiry();
    }
  }, [authExpired, finishExpiry, nav]);
  return null;
}

export default function App({ platform, connector }: { platform?: PlatformServices; connector?: ServerConnector } = {}) {
  const [ready, setReady] = useState<Ready>();
  const [failure, setFailure] = useState<string>();
  const services = platform ?? getPlatform();

  useEffect(() => {
    bootstrap(services, connector).then(setReady, e => setFailure(String(e)));
    // Bootstrap once per process.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exitApp = useCallback(() => {
    BackHandler.exitApp();
    return true;
  }, []);

  return (
    <View style={styles.root}>
      <StatusBar hidden />
      {ready ? (
        <AppStateProvider platform={services} connector={ready.connector} boot={ready.boot}>
          <NavigationStack initial={ready.initial} render={renderRoute} onBackAtRoot={exitApp}>
            <AuthExpiryWatcher />
          </NavigationStack>
        </AppStateProvider>
      ) : (
        <View style={styles.splash} testID="splash">
          <Text style={styles.logo}>{APP_NAME}</Text>
          {failure ? <Text style={styles.error}>{failure}</Text> : <LoadingView />}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logo: { color: colors.accent, fontSize: 64, fontWeight: '800', letterSpacing: 2, marginTop: 80 },
  error: { color: colors.danger, fontSize: 16, marginTop: 24 },
});
