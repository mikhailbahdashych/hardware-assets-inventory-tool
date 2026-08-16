import type { ComponentPropsWithoutRef } from 'react';
import styles from './Select.module.css';

export function Select({ className, children, ...rest }: ComponentPropsWithoutRef<'select'>) {
  return (
    <select className={className ? `${styles.select} ${className}` : styles.select} {...rest}>
      {children}
    </select>
  );
}
