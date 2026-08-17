import type { ReactNode } from 'react';

export type Setter = (label: string | null) => void;

export interface BreadcrumbContextValue {
  label: string | null;
  set: Setter;
}

export interface BreadcrumbDetailProviderProps {
  children: ReactNode;
}
