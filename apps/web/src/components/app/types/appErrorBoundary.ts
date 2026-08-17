import type { ReactNode } from 'react';

export interface AppErrorBoundaryProps {
  children: ReactNode;
}

export interface AppErrorBoundaryState {
  message: string | null;
}
