import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import type { Library, ServerInfo } from '../backend/types';

export type Route =
  | { name: 'servers' }
  | { name: 'login'; server: ServerInfo; expired?: boolean }
  | { name: 'home' }
  | { name: 'library'; library: Library }
  | { name: 'detail'; itemId: string; /** Series page: the season to show first. */ seasonId?: string }
  | { name: 'search' }
  | { name: 'settings' }
  | { name: 'randomizerHistory' }
  | { name: 'player'; itemId: string; startPositionMs?: number; /** Playing from the Randomizer: next is a random episode. */ shuffle?: boolean };

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
/** Per-screen state shared with the focusable elements on that screen. */
export interface ScreenState {
  active: boolean;
  /** The element that last had focus on this screen, restored when the screen is shown again. */
  lastFocused: { current: unknown };
}
const ScreenContext = createContext<ScreenState>({ active: true, lastFocused: { current: null } });

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

export function useScreenState(): ScreenState {
  return useContext(ScreenContext);
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
  children,
}: {
  initial: Route[];
  render: (route: Route) => React.ReactNode;
  onBackAtRoot?: () => boolean;
  /** Rendered inside the navigation context, for components that navigate on app events. */
  children?: React.ReactNode;
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

  // Stable context values per entry, so screens only re-render when they become (in)active.
  // Hidden screens stay mounted, and Android keeps their views focusable, so Focusable turns
  // itself off on inactive screens and puts focus back on the remembered element on return.
  const states = useRef(new Map<number, { focus: { current: unknown }; on: ScreenState; off: ScreenState }>());
  const screenState = (key: number, active: boolean): ScreenState => {
    let s = states.current.get(key);
    if (!s) {
      const focus = { current: null as unknown };
      s = { focus, on: { active: true, lastFocused: focus }, off: { active: false, lastFocused: focus } };
      states.current.set(key, s);
    }
    for (const k of states.current.keys()) {
      if (!stack.some(e => e.key === k)) {
        states.current.delete(k);
      }
    }
    return active ? s.on : s.off;
  };

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => back() || (onBackAtRoot?.() ?? false));
    return () => sub.remove();
  }, [back, onBackAtRoot]);

  return (
    <NavContext.Provider value={nav}>
      {stack.map((e, i) => {
        const active = i === stack.length - 1;
        return (
          <ScreenContext.Provider key={e.key} value={screenState(e.key, active)}>
            <View style={active ? styles.screen : styles.hidden} testID={active ? `screen-${e.route.name}` : undefined}>
              {render(e.route)}
            </View>
          </ScreenContext.Provider>
        );
      })}
      {children}
    </NavContext.Provider>
  );
}


const styles = StyleSheet.create({
  screen: { ...StyleSheet.absoluteFillObject },
  hidden: { display: 'none' },
});
