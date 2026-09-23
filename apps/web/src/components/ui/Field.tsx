import { cloneElement, isValidElement, useId, type ReactElement } from 'react';
import type { FieldErrorAria, FieldProps } from './types/field';
import styles from './Field.module.css';

/**
 * Form field wrapper: 12px/500 muted label, optional accent asterisk,
 * faint hint below, error line in --err. Pass a render-prop child to wire
 * the generated id to the control for label association.
 *
 * The asterisk is drawn by CSS rather than markup, so the field's accessible
 * name stays "Name" instead of "Name*" — the footer's "* Required" line is
 * what explains it, and screen readers should not read punctuation as part of
 * the label.
 *
 * **An error is announced on the control, not only painted under it.** The
 * message gets an id and the control is cloned with `aria-invalid` and an
 * `aria-describedby` pointing at it, so somebody who never sees the red line
 * still meets the words when they reach the input. Doing it here rather than
 * at each of the forty call sites is what makes it true of every form at once;
 * a child that is not a single element (a control sitting inside a row of
 * them) keeps the message visible and simply gains no attributes.
 */
export function Field({ label, required = false, hint, error, children }: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const control = typeof children === 'function' ? children(id) : children;

  return (
    <div className={styles.field}>
      <label
        className={styles.label}
        data-required={required}
        htmlFor={typeof children === 'function' ? id : undefined}
      >
        {label}
      </label>
      {error && isValidElement(control)
        ? cloneElement(control as ReactElement<FieldErrorAria>, {
            'aria-invalid': true,
            'aria-describedby': errorId,
          })
        : control}
      {hint && !error && <div className={styles.hint}>{hint}</div>}
      {error && (
        <div id={errorId} className={styles.error}>
          {error}
        </div>
      )}
    </div>
  );
}
