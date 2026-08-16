import type { ChangeEvent } from 'react';
import { Icon } from './Icon';
import styles from './SearchInput.module.css';

/** Toolbar filter input with a leading search icon (29px, surface background). */
export function SearchInput({
  value,
  onChange,
  placeholder,
  width = 240,
}: {
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  width?: number | string;
}) {
  return (
    <span className={styles.wrap} style={{ width }}>
      <Icon name="search" size={13} strokeWidth={1.8} className={styles.icon} />
      <input
        type="search"
        className={styles.input}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
      />
    </span>
  );
}
