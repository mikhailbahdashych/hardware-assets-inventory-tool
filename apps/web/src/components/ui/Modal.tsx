import { useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './IconButton';
import type { ModalProps } from './types/modal';
import styles from './Modal.module.css';

/**
 * Design modal: rgba(10,10,14,.45) overlay, top-aligned card (offset varies
 * per modal), header with title/subtitle/X, bordered footer. Esc and
 * outside-click close. Footer children: first child is pushed left
 * (e.g. "* Required"), the rest align right.
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
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
