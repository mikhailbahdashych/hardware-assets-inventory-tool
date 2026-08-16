import { useId, type ReactNode } from 'react';
import styles from './Field.module.css';

/**
 * Form field wrapper: 12px/500 muted label, optional accent asterisk,
 * faint hint below, error line in --err. Pass a render-prop child to wire
 * the generated id to the control for label association.
 */
export function Field({
  label,
  required = false,
  hint,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: ReactNode | ((id: string) => ReactNode);
}) {
  const id = useId();
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={typeof children === 'function' ? id : undefined}>
        {label}
        {required && <span className={styles.required}>*</span>}
      </label>
      {typeof children === 'function' ? children(id) : children}
      {hint && !error && <div className={styles.hint}>{hint}</div>}
      {error && <div className={styles.error}>{error}</div>}
    </div>
  );
}
