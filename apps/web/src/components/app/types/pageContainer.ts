import type { ReactNode } from 'react';

export interface PageContainerProps {
  maxWidth?: number;
  variant?: 'list' | 'detail';
  gap?: number;
  children: ReactNode;
}
