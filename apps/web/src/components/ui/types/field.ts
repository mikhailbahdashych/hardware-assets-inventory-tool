import type { ReactNode } from 'react';

export interface FieldProps {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: ReactNode | ((id: string) => ReactNode);
}

/**
 * What `Field` puts on its control when it is showing an error: the state, and
 * a pointer to the words. Named because it is what the `cloneElement` cast
 * says the control accepts — `Input`, `Textarea` and `Dropdown` all do.
 */
export interface FieldErrorAria {
  'aria-invalid': true;
  'aria-describedby': string;
}
