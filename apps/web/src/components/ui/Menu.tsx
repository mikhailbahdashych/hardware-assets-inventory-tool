import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { MenuAnchor, MenuProps } from './types/menu';
import { Icon } from './Icon';
import styles from './Menu.module.css';

const GAP = 4;

/**
 * The design's row-overflow button (the `dots` icon on a bordered square —
 * the bare "···" glyph it drew vanished beside a column of em dashes) and the
 * menu behind it. Closes on Escape,
 * on an outside click, on a scroll, and as soon as something is chosen — a menu
 * left open over the row it just changed is a menu pointing at stale data.
 *
 * It is the ARIA menu button, because these menus hold the only way to change
 * a role or revoke a token: opening puts focus on the first item, ↑/↓ move and
 * stop at the ends (as `Dropdown` does), Home/End jump, Enter/Space choose,
 * Escape closes and hands focus back to the trigger, and Tab closes it on the
 * way out. Choosing also returns focus to the trigger *before* the item runs,
 * so a dialog the item opens remembers the trigger and gives focus back to it.
 *
 * The panel is portalled to the body and positioned from the trigger's own
 * rect, because a table cell clips its overflow (that is what gives the other
 * cells their ellipsis) and the surrounding card clips to its border radius. A
 * menu rendered in place is a menu the row eats.
 */
export function Menu({ label, items }: MenuProps) {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  // A ref is null until its element mounts, and the panel only exists while
  // open — which is what the `?.` on these two reads.
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  /**
   * The rendered items, read off the panel rather than kept in a second list.
   * No panel means a closed menu, which has no items — hence the empty list.
   */
  const renderedItems = (): HTMLElement[] =>
    panel.current ? [...panel.current.querySelectorAll<HTMLElement>('[role="menuitem"]')] : [];

  // Opening, by mouse or keyboard, lands on the first item.
  useEffect(() => {
    if (anchor) renderedItems()[0]?.focus({ preventScroll: true });
  }, [anchor]);

  useEffect(() => {
    if (!anchor) return;
    // A close that would strand focus on a removed item gives it to the trigger.
    const close = () => {
      if (panel.current?.contains(document.activeElement)) trigger.current?.focus();
      setAnchor(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Answered here, so a modal behind the row leaves this Escape alone.
        event.preventDefault();
        close();
        trigger.current?.focus();
      }
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

  function onPanelKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const all = renderedItems();
    const at = all.findIndex((item) => item === document.activeElement);
    const move = (to: number) => {
      event.preventDefault();
      all[Math.max(0, Math.min(all.length - 1, to))]?.focus();
    };
    switch (event.key) {
      case 'ArrowDown':
        return move(at + 1);
      case 'ArrowUp':
        return move(at - 1);
      case 'Home':
        return move(0);
      case 'End':
        return move(all.length - 1);
      case 'Tab':
        // Not prevented: focus goes back to the trigger and Tab carries on
        // from there, rather than off the end of the body where the panel sits.
        trigger.current?.focus();
        setAnchor(null);
        return;
    }
  }

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
        <Icon name="dots" size={14} />
      </button>
      {anchor !== null &&
        createPortal(
          <div
            ref={panel}
            role="menu"
            aria-label={label}
            className={styles.menu}
            onKeyDown={onPanelKeyDown}
            style={{ top: anchor.top, right: anchor.right, maxHeight: anchor.maxHeight }}
          >
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={styles.item}
                data-danger={item.danger}
                onClick={(event) => {
                  event.stopPropagation();
                  trigger.current?.focus();
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
