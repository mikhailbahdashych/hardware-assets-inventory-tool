import type { ReactNode } from 'react';

export interface AuthLayoutProps {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  below?: ReactNode;
}

export interface AuthFieldProps {
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  error?: string;
  hint?: string;
  /** Rendered opposite the label, e.g. the "Forgot?" link. */
  trailing?: ReactNode;
}

export interface FormErrorProps {
  error: unknown;
}
