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
 *
 * **A hint is described the same way**, without the invalid state: it is often
 * the only reason a control is the way it is — "Check the asset in to change
 * its status." beside a disabled dropdown — and a screen reader that hears
 * only "disabled" has been told nothing.
 */
export function Field({ label, required = false, hint, error, children }: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const control = typeof children === 'function' ? children(id) : children;
  // The error replaces the hint on screen, so it replaces it here too.
  const aria: FieldErrorAria | null = error
    ? { 'aria-invalid': true, 'aria-describedby': errorId }
    : hint
      ? { 'aria-describedby': hintId }
      : null;

  return (
    <div className={styles.field}>
      <label
        className={styles.label}
        data-required={required}
        htmlFor={typeof children === 'function' ? id : undefined}
      >
        {label}
      </label>
      {aria !== null && isValidElement(control)
        ? cloneElement(control as ReactElement<FieldErrorAria>, aria)
        : control}
      {hint && !error && (
        <div id={hintId} className={styles.hint}>
          {hint}
        </div>
      )}
      {error && (
        <div id={errorId} className={styles.error}>
          {error}
        </div>
      )}
    </div>
  );
}
