import { Icon } from './Icon';
import type { ButtonProps } from './types/button';
import styles from './Button.module.css';

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      data-variant={variant}
      data-size={size}
      className={className ? `${styles.button} ${className}` : styles.button}
      {...rest}
    >
      {icon && <Icon name={icon} size={13} strokeWidth={icon === 'plus' ? 2 : 1.7} />}
      {children}
    </button>
  );
}
