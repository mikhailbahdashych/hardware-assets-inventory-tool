import type { SpinnerProps } from './types/spinner';
import styles from './Spinner.module.css';

export function Spinner({ size = 14 }: SpinnerProps) {
  return (
    <span
      className={styles.spinner}
      style={{ width: size, height: size }}
      role="status"
      aria-label="Loading"
    />
  );
}
