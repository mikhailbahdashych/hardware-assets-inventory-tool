import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
}
