import { useEffect, useRef, useState } from 'react';
import styles from './Menu.module.css';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  /** Rendered in --err: removing a member, deleting a record. */
  danger?: boolean;
}

/**
 * The design's "···" overflow button and the menu behind it. Closes on Escape,
 * on an outside click, and as soon as something is chosen — a menu that stays
 * open over the row it just changed is a menu pointing at stale data.
 */
export function Menu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  return (
    <div className={styles.wrapper} ref={wrapper}>
      <button
        type="button"
        className={styles.trigger}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          // Rows are clickable; opening a menu is not opening the row.
          event.stopPropagation();
          setOpen((current) => !current);
        }}
      >
        ···
      </button>
      {open && (
        <div role="menu" className={styles.menu}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={styles.item}
              data-danger={item.danger}
              onClick={(event) => {
                event.stopPropagation();
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
