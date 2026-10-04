import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './IconButton';
import type { ModalProps } from './types/modal';
import styles from './Modal.module.css';

/** What Tab can land on. Disabled controls and `tabindex="-1"` are skipped, as the browser would. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Design modal: rgba(10,10,14,.45) overlay, top-aligned card (offset varies
 * per modal), header with title/subtitle/X, bordered footer. Esc and
 * outside-click close. Footer children: first child is pushed left
 * (e.g. "* Required"), the rest align right.
 *
 * `aria-modal` promises that nothing behind the dialog is reachable, so Tab
 * wraps inside the card rather than walking off into the page under the
 * overlay. An Escape somebody inside already answered — an open `Dropdown`
 * closing its list calls `preventDefault` — is theirs, not the modal's.
 *
 * Focus comes in and goes back: whatever had it when the modal rendered is
 * remembered, the card takes focus on mount unless something inside already
 * has it (a field marked `autoFocus`), and the remembered element gets it back
 * on close — so a keyboard user lands where they were, not on the body.
 */
export function Modal({
  title,
  subtitle,
  width = 520,
  topOffset = '10vh',
  maxHeight,
  onClose,
  footer,
  children,
}: ModalProps) {
  const titleId = useId();
  // Null until the card mounts; the listener only runs after it has.
  const card = useRef<HTMLDivElement>(null);
  // Read during the first render — before a child's `autoFocus` has run in the
  // commit — so it is the element that opened the modal, not the modal's field.
  const [returnTo] = useState(() => document.activeElement);

  useEffect(() => {
    if (card.current && !card.current.contains(document.activeElement)) card.current.focus();
    return () => {
      // A trigger that left with its row (a removed member) has nothing to take it.
      if (returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus();
    };
  }, [returnTo]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
      if (event.key === 'Tab' && card.current) trapTab(event, card.current);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      className={styles.overlay}
      data-testid="modal-overlay"
      style={{ paddingTop: topOffset }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={card}
        tabIndex={-1}
        className={styles.card}
        style={{ width, maxHeight }}
      >
        <div className={styles.header}>
          <div>
            <div id={titleId} className={styles.title}>
              {title}
            </div>
            {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
          </div>
          <IconButton icon="x" label="Close" size={26} onClick={onClose} />
        </div>
        <div className={styles.body} data-scroll={Boolean(maxHeight)}>
          {children}
        </div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Wraps Tab at the card's two ends and brings focus in from outside. Focus
 * inside *another* dialog is left alone: that one is on top and owns it.
 */
function trapTab(event: KeyboardEvent, card: HTMLElement): void {
  const focusable = [...card.querySelectorAll<HTMLElement>(FOCUSABLE)];
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) return;

  const active = document.activeElement;
  const inside = active instanceof Node && card.contains(active);
  if (!inside) {
    if (active instanceof Element && active.closest('[role="dialog"]')) return;
    event.preventDefault();
    first.focus();
  } else if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}
