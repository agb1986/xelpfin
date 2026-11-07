import {
  useHideSplashScreenCallback,
  usePreventHideSplashScreen,
} from '@amazon-devices/react-native-kepler';
import React, { useCallback, useEffect, useRef } from 'react';
import App from '../App';
import type { ServerConnector } from '../src/backend/Backend';

/** Upper bound on the native splash, so a start-up that never settles still shows the app. */
const SPLASH_MAX_MS = 10000;

/**
 * Keeps Vega's native splash screen up until the app has finished start-up, instead of letting
 * it drop on the first frame and showing the app's own loading view in between.
 */
export function AppRoot({ connector }: { connector?: ServerConnector }) {
  usePreventHideSplashScreen();
  const hideSplash = useHideSplashScreenCallback();

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelFallback = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };

  useEffect(() => {
    timer.current = setTimeout(hideSplash, SPLASH_MAX_MS);
    return cancelFallback;
  }, [hideSplash]);

  const onReady = useCallback(() => {
    // Hiding twice logs an error on the stick, so the fallback is dropped once start-up settles.
    cancelFallback();
    hideSplash();
  }, [hideSplash]);

  return <App connector={connector} onReady={onReady} />;
}
