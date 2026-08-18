import type { ReactNode } from 'react';
import type { Action } from '@inventory/shared';

export interface ListToolbarProps {
  title: string;
  /** What the signed-in member may do, resolved server-side — see `can`. */
  permissions: Action[];
  children?: ReactNode;
}
