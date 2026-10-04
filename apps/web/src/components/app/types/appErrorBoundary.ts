import type { ReactNode } from 'react';

export interface AppErrorBoundaryProps {
  children: ReactNode;
}

export interface AppErrorBoundaryState {
  /** What was caught, or null while the app is running. */
  caught: CaughtError | null;
}

export interface CaughtError {
  message: string;
  /** A request nothing answered, rather than a screen that threw while drawing. */
  startup: boolean;
}
