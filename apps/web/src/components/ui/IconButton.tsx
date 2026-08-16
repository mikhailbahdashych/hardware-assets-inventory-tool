import type { ComponentPropsWithoutRef } from 'react';
import { Icon, type IconName } from './Icon';
import styles from './IconButton.module.css';

type IconButtonProps = Omit<ComponentPropsWithoutRef<'button'>, 'children'> & {
  icon: IconName;
  /** Accessible name — icon-only buttons must always have one. */
  label: string;
  size?: number;
  iconSize?: number;
  bordered?: boolean;
};

export function IconButton({
  icon,
  label,
  size = 29,
  iconSize = 14,
  bordered = false,
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      data-bordered={bordered}
      className={className ? `${styles.iconButton} ${className}` : styles.iconButton}
      style={{ width: size, height: size, borderRadius: size <= 26 ? 5 : 6 }}
      {...rest}
    >
      <Icon name={icon} size={iconSize} />
    </button>
  );
}
