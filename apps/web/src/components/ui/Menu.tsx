import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './Menu.module.css';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  /** Rendered in --err: removing a member, deleting a record. */
  danger?: boolean;
}

/** Where the panel sits, measured from the trigger when the menu opens. */
interface MenuAnchor {
  top: number;
  right: number;
  maxHeight: number;
}

const GAP = 4;

/**
 * The design's "···" overflow button and the menu behind it. Closes on Escape,
 * on an outside click, on a scroll, and as soon as something is chosen — a menu
 * left open over the row it just changed is a menu pointing at stale data.
 *
 * The panel is portalled to the body and positioned from the trigger's own
 * rect, because a table cell clips its overflow (that is what gives the other
 * cells their ellipsis) and the surrounding card clips to its border radius. A
 * menu rendered in place is a menu the row eats.
 */
export function Menu({ label, items }: { label: string; items: MenuItem[] }) {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!anchor) return;
    const close = () => setAnchor(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (trigger.current?.contains(target) || panel.current?.contains(target)) return;
      close();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    // Fixed position cannot follow a scroll, so it stops instead of drifting.
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('scroll', close, true);
    };
  }, [anchor]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={(event) => {
          // Rows are clickable; opening a menu is not opening the row.
          event.stopPropagation();
          if (anchor) {
            setAnchor(null);
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          setAnchor({
            top: rect.bottom + GAP,
            right: window.innerWidth - rect.right,
            // Never taller than the room below it; the panel scrolls instead.
            maxHeight: window.innerHeight - rect.bottom - GAP * 3,
          });
        }}
      >
        ···
      </button>
      {anchor !== null &&
        createPortal(
          <div
            ref={panel}
            role="menu"
            className={styles.menu}
            style={{ top: anchor.top, right: anchor.right, maxHeight: anchor.maxHeight }}
          >
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={styles.item}
                data-danger={item.danger}
                onClick={(event) => {
                  event.stopPropagation();
                  setAnchor(null);
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
