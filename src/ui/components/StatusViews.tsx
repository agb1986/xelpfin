import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { BackendError } from '../../backend/types';
import { colors, font, space } from '../theme';
import { Button } from './Button';

export function LoadingView({ label }: { label?: string }) {
  return (
    <View style={styles.center} testID="loading">
      <ActivityIndicator size="large" color={colors.accent} />
      {label ? <Text style={styles.dim}>{label}</Text> : null}
    </View>
  );
}

/** Turns any thrown value into a short message for the user. */
export function describeError(err: unknown): string {
  if (err instanceof BackendError) {
    // Messages built from a raw HTTP failure name endpoints; show a fixed sentence instead.
    const raw = / failed: HTTP \d+$/.test(err.message);
    switch (err.kind) {
      case 'network':
        return 'The server could not be reached. Check that it is running and on the same network.';
      case 'timeout':
        return 'The server took too long to answer.';
      case 'auth':
        return raw || !err.message
          ? 'Your sign-in is no longer valid.'
          : err.message;
      case 'forbidden':
        return 'This account is not allowed to do that.';
      case 'notFound':
        return 'This item no longer exists on the server.';
      default:
        return raw
          ? `The server could not complete the request (HTTP ${err.status}).`
          : err.message;
    }
  }
  return err instanceof Error ? err.message : String(err);
}

export function ErrorView({
  error,
  onRetry,
  hasTVPreferredFocus,
}: {
  error: unknown;
  onRetry?: () => void;
  hasTVPreferredFocus?: boolean;
}) {
  return (
    <View style={styles.center} testID="error">
      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.message}>{describeError(error)}</Text>
      {onRetry ? (
        <Button
          label="Retry"
          variant="primary"
          onPress={onRetry}
          hasTVPreferredFocus={hasTVPreferredFocus}
          testID="retry"
        />
      ) : null}
    </View>
  );
}

export function EmptyView({
  title,
  message,
  children,
}: {
  title: string;
  message?: string;
  children?: React.ReactNode;
}) {
  return (
    <View style={styles.center} testID="empty">
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
  },
  title: {
    color: colors.text,
    fontSize: font.title,
    fontWeight: '700',
    marginBottom: space.sm,
  },
  message: {
    color: colors.textDim,
    fontSize: font.body,
    textAlign: 'center',
    maxWidth: 560,
    marginBottom: space.lg,
  },
  dim: { color: colors.textDim, fontSize: font.body, marginTop: space.md },
});
