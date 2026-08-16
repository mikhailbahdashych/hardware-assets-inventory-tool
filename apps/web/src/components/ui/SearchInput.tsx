import type { ChangeEvent } from 'react';
import { Icon } from './Icon';
import styles from './SearchInput.module.css';

/**
 * Toolbar filter input (29px, surface background). The list toolbars in the
 * design carry no icon — pass `icon` for search affordances that do.
 */
export function SearchInput({
  value,
  onChange,
  placeholder,
  width = 240,
  icon = false,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  width?: number | string;
  icon?: boolean;
  'aria-label'?: string;
}) {
  return (
    <span className={styles.wrap} style={{ width }}>
      {icon && <Icon name="search" size={13} strokeWidth={1.8} className={styles.icon} />}
      <input
        type="search"
        className={styles.input}
        data-icon={icon}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
      />
    </span>
  );
}
