import type { ComponentPropsWithRef } from 'react';
import type { IconName } from '../Icon';

export type ButtonProps = ComponentPropsWithRef<'button'> & {
  variant?: 'primary' | 'ghost' | 'danger';
  size?: 'md' | 'sm';
  icon?: IconName;
};
