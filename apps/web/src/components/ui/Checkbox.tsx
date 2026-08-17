import type { CheckboxProps } from './types/checkbox';
import styles from './Checkbox.module.css';

export function Checkbox({ label, className, ...rest }: CheckboxProps) {
  return (
    <label className={className ? `${styles.label} ${className}` : styles.label}>
      <input type="checkbox" className={styles.input} {...rest} />
      {label}
    </label>
  );
}
