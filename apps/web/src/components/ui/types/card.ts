import type { CSSProperties, ReactNode } from 'react';

export interface CardProps {
  title?: ReactNode;
  padding?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}
