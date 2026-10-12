import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import type { Library, ServerInfo } from '../backend/types';

export type Route =
  | { name: 'servers' }
  | { name: 'login'; server: ServerInfo }
  | { name: 'home' }
  | { name: 'library'; library: Library }
  | { name: 'detail'; itemId: string }
  | { name: 'search' }
  | { name: 'settings' }
  | { name: 'player'; itemId: string; startPositionMs?: number };

interface Entry {
  key: number;
  route: Route;
}

export interface Navigation {
  push(route: Route): void;
  replace(route: Route): void;
  /** Returns false when already at the root. */
  back(): boolean;
  reset(routes: Route[]): void;
  readonly depth: number;
}

const NavContext = createContext<Navigation | null>(null);
const ScreenContext = createContext<{ active: boolean }>({ active: true });

export function useNavigation(): Navigation {
  const nav = useContext(NavContext);
  if (!nav) {
    throw new Error('useNavigation outside NavigationStack');
  }
  return nav;
}

/** True while this screen is the visible top of the stack. */
export function useIsActive(): boolean {
  return useContext(ScreenContext).active;
}

/**
 * Minimal stack navigator for a TV app: one screen visible at a time, BACK pops.
 * Screens below the top stay mounted (hidden) so their data, scroll position and last
 * focused element survive a round trip to a detail page. The player is the exception: it is
 * always the top entry and is unmounted when popped, which stops playback.
 */
export function NavigationStack({
  initial,
  render,
  onBackAtRoot,
}: {
  initial: Route[];
  render: (route: Route) => React.ReactNode;
  onBackAtRoot?: () => boolean;
}) {
  const nextKey = useRef(initial.length);
  const [stack, setStack] = useState<Entry[]>(() => initial.map((route, key) => ({ key, route })));
  const stackRef = useRef(stack);
  stackRef.current = stack;

  const entry = (route: Route): Entry => ({ key: nextKey.current++, route });

  const back = useCallback(() => {
    if (stackRef.current.length <= 1) {
      return false;
    }
    setStack(s => s.slice(0, -1));
    return true;
  }, []);

  const nav = useMemo<Navigation>(
    () => ({
      push: route => setStack(s => [...s, entry(route)]),
      replace: route => setStack(s => [...s.slice(0, -1), entry(route)]),
      back,
      reset: routes => setStack(routes.map(entry)),
      get depth() {
        return stackRef.current.length;
      },
    }),
    [back],
  );

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => back() || (onBackAtRoot?.() ?? false));
    return () => sub.remove();
  }, [back, onBackAtRoot]);

  return (
    <NavContext.Provider value={nav}>
      {stack.map((e, i) => {
        const active = i === stack.length - 1;
        return (
          <ScreenContext.Provider key={e.key} value={active ? ACTIVE : INACTIVE}>
            <View style={active ? styles.screen : styles.hidden} testID={active ? `screen-${e.route.name}` : undefined}>
              {render(e.route)}
            </View>
          </ScreenContext.Provider>
        );
      })}
    </NavContext.Provider>
  );
}

const ACTIVE = { active: true };
const INACTIVE = { active: false };

const styles = StyleSheet.create({
  screen: { ...StyleSheet.absoluteFillObject },
  hidden: { display: 'none' },
});
