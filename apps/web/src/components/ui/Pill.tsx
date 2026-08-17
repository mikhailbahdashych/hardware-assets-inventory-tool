import type { PillProps } from './types/pill';
import styles from './Pill.module.css';

/**
 * Status/role/type pill. `sv` is a semantic color key from @inventory/shared —
 * pills never hardcode colors; they resolve via the token pair --{sv}/--{sv}-bg.
 * Note: 'acc' intentionally maps to --accent/--acc-bg.
 */
export function Pill({ sv, dot = false, size = 'md', strong = false, children }: PillProps) {
  return (
    <span className={styles.pill} data-sv={sv} data-size={size} data-strong={strong}>
      {dot && <span className={styles.dot} data-dot aria-hidden="true" />}
      {children}
    </span>
  );
}
