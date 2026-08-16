import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import styles from './Checkbox.module.css';

type CheckboxProps = Omit<ComponentPropsWithoutRef<'input'>, 'type'> & {
  label: ReactNode;
};

export function Checkbox({ label, className, ...rest }: CheckboxProps) {
  return (
    <label className={className ? `${styles.label} ${className}` : styles.label}>
      <input type="checkbox" className={styles.input} {...rest} />
      {label}
    </label>
  );
}
