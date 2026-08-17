import type { ReactNode } from 'react';
import type { SemanticColor } from '@inventory/shared';

export interface PillProps {
  sv: SemanticColor;
  dot?: boolean;
  size?: 'md' | 'sm';
  strong?: boolean;
  children: ReactNode;
}
