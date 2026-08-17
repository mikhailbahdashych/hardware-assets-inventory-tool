import { Component, type ErrorInfo, type ReactNode } from 'react';
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
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { message: null };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Self-hosters read their own browser console when something breaks.
    console.error('Inventory failed to start', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.message === null) return this.props.children;

    return (
      <div className={styles.screen} role="alert">
        <div className={styles.tile}>
          <Icon name="cube" size={20} />
        </div>
        <h1 className={styles.title}>Inventory could not start</h1>
        <p className={styles.detail}>{this.state.message}</p>
        <p className={styles.hint}>
          This usually means the server is unreachable or still starting. Check the container logs
          if it keeps happening.
        </p>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </div>
    );
  }
}
