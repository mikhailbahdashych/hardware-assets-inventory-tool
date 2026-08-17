import type { ComponentPropsWithoutRef, ReactNode } from 'react';

export type CheckboxProps = Omit<ComponentPropsWithoutRef<'input'>, 'type'> & {
  label: ReactNode;
};
