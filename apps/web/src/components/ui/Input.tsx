import type { ComponentPropsWithoutRef } from 'react';
import styles from './Input.module.css';

type InputProps = ComponentPropsWithoutRef<'input'> & {
  /** JetBrains Mono — asset tags, serials, hostnames. */
  mono?: boolean;
};

export function Input({ mono = false, className, ...rest }: InputProps) {
  return (
    <input
      data-mono={mono}
      className={className ? `${styles.input} ${className}` : styles.input}
      {...rest}
    />
  );
}
