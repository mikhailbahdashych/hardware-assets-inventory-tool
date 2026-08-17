import type { ChangeEvent } from 'react';

export interface SearchInputProps {
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  width?: number | string;
  icon?: boolean;
  'aria-label'?: string;
}
