import { Icon } from './Icon';
import type { SearchInputProps } from './types/searchInput';
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
}: SearchInputProps) {
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
        // Toolbar inputs carry no visible label, so the placeholder is the
        // accessible name unless a caller gives a better one.
        aria-label={ariaLabel ?? placeholder}
      />
    </span>
  );
}
