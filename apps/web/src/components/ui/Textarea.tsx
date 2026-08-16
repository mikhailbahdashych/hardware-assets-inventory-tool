import type { ComponentPropsWithoutRef } from 'react';
import styles from './Textarea.module.css';

export function Textarea({ className, ...rest }: ComponentPropsWithoutRef<'textarea'>) {
  return (
    <textarea
      className={className ? `${styles.textarea} ${className}` : styles.textarea}
      {...rest}
    />
  );
}
