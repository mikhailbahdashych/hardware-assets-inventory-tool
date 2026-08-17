import type { ComponentPropsWithoutRef } from 'react';
import type { IconName } from '../Icon';

export type ButtonProps = ComponentPropsWithoutRef<'button'> & {
  variant?: 'primary' | 'ghost' | 'danger';
  size?: 'md' | 'sm';
  icon?: IconName;
};
