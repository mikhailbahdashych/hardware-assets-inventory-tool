import type { ReactNode } from 'react';

export interface FieldProps {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: ReactNode | ((id: string) => ReactNode);
}
