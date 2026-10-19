import React from 'react';
import { ErrorView } from './StatusViews';

interface State {
  error?: unknown;
}

/**
 * Catches a render error in one screen and shows the error view in its place, so a bug or an
 * unexpected server answer costs that screen and not the whole app. BACK still leaves the screen,
 * and Retry renders it again from scratch.
 */
export class ScreenBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = {};

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  componentDidCatch(error: unknown) {
    console.warn('xelpfin: screen render failed', error);
  }

  render() {
    if (this.state.error !== undefined) {
      return (
        <ErrorView
          error={this.state.error}
          onRetry={() => this.setState({ error: undefined })}
          hasTVPreferredFocus
        />
      );
    }
    return this.props.children;
  }
}
