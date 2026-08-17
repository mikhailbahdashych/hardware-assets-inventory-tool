import type { InputProps } from './types/input';
import styles from './Input.module.css';

export function Input({ mono = false, className, ...rest }: InputProps) {
  return (
    <input
      data-mono={mono}
      className={className ? `${styles.input} ${className}` : styles.input}
      {...rest}
    />
  );
}
