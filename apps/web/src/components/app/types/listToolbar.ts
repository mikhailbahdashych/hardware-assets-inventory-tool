import type { ReactNode } from 'react';
import type { Role } from '@inventory/shared';

export interface ListToolbarProps {
  title: string;
  role: Role;
  children?: ReactNode;
}
