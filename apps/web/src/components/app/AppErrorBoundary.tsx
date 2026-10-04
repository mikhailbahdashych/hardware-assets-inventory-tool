import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ApiError, MalformedApiResponse } from '@/api/client';
import { MetaUnanswered } from '@/api/queries';
import { Button, Icon } from '@/components/ui';
import type { AppErrorBoundaryProps, AppErrorBoundaryState } from './types/appErrorBoundary';
import styles from './AppErrorBoundary.module.css';

/**
 * The app fails loudly rather than guessing — `AppRoutes` throws when `/meta`
 * cannot say whether this instance is set up, because guessing would send an
 * uninitialized instance to a login nobody can pass. A throw with nothing to
 * catch it is a white page, though, which tells the person running the server
 * even less than a wrong guess would.
 *
 * So this catches it and says what happened, in the words of the error itself.
 * It is the last resort, not a fallback: nothing carries on afterwards.
 *
 * It catches two different failures and must not describe them alike. A
 * request nothing answered (`/meta` failing, or any `ApiError` /
 * `MalformedApiResponse` that escapes a renderer) is the startup case, and
 * keeps the hedged container-logs hint `ErrorState` shares word for word. Any
 * other throw is a screen that could not be drawn — the app started and the
 * server answered — so it says that, with the error's own message and no hint
 * blaming a server that is fine.
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { caught: null };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return {
      caught: {
        message: error instanceof Error ? error.message : String(error),
        startup:
          error instanceof MetaUnanswered ||
          error instanceof ApiError ||
          error instanceof MalformedApiResponse,
      },
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Self-hosters read their own browser console when something breaks.
    console.error('Inventory stopped on an error', error, info.componentStack);
  }

  render(): ReactNode {
    const { caught } = this.state;
    if (caught === null) return this.props.children;

    return (
      <div className={styles.screen} role="alert">
        <div className={styles.tile}>
          <Icon name="cube" size={20} />
        </div>
        <h1 className={styles.title}>
          {caught.startup ? 'Inventory could not start' : 'Inventory could not draw this screen'}
        </h1>
        <p className={styles.detail}>{caught.message}</p>
        {caught.startup && (
          <p className={styles.hint}>
            This usually means the server is unreachable or still starting. Check the container logs
            if it keeps happening.
          </p>
        )}
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </div>
    );
  }
}
