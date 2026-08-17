import type { ReactNode } from 'react';

export type ToastKind = 'ok' | 'err' | 'info';

export interface ToastEntry {
  id: number;
  message: string;
  kind: ToastKind;
}

export interface ToastContextValue {
  show: (message: string, kind?: ToastKind) => void;
}

export interface ToastProviderProps {
  children: ReactNode;
}
