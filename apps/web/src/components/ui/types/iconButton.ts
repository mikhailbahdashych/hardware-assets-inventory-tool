import type { ComponentPropsWithoutRef } from 'react';
import type { IconName } from '../Icon';

export type IconButtonProps = Omit<ComponentPropsWithoutRef<'button'>, 'children'> & {
  icon: IconName;
  /** Accessible name — icon-only buttons must always have one. */
  label: string;
  size?: number;
  iconSize?: number;
  bordered?: boolean;
};
