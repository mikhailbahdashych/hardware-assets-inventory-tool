import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import type { DropdownProps, PanelPosition } from './types/dropdown';
import styles from './Dropdown.module.css';

const GAP = 4;
/** Below this there is not enough room to be worth opening downward. */
const MIN_ROOM = 160;

/**
 * The design's own select. A native `<select>` renders its list with the
 * operating system's widget — grey on macOS, blue highlight, its own font —
 * which is the one place the app stopped looking like itself.
 *
 * It is the ARIA select-only combobox: a button that owns a portalled listbox.
 * Portalled for the same reason `Menu` is — a table cell clips its overflow and
 * a card clips to its radius — and keyboard-complete, because replacing a
 * native control means replacing everything it did, not just how it looked.
 */
export function Dropdown<V extends string>({
  value,
  options,
  onChange,
  id,
  disabled = false,
  'aria-label': ariaLabel,
}: DropdownProps<V>) {
  const [position, setPosition] = useState<PanelPosition | null>(null);
  const [active, setActive] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const optionId = useId();

  const open = position !== null;
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex === -1 ? undefined : options[selectedIndex];

  useEffect(() => {
    if (!open) return;
    const close = () => setPosition(null);
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (trigger.current?.contains(target) || panel.current?.contains(target)) return;
      close();
    };
    document.addEventListener('mousedown', onPointerDown);
    // A fixed panel cannot follow a scroll, so it stops instead of drifting.
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  useEffect(() => {
    panel.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function openList(): void {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom - GAP * 2;
    const above = rect.top - GAP * 2;
    // Open upward when the room below is too small to be usable and there is
    // more of it above — a dropdown near the bottom of a modal is normal.
    const upward = below < MIN_ROOM && above > below;
    setPosition({
      top: upward ? GAP * 2 : rect.bottom + GAP,
      left: rect.left,
      width: rect.width,
      maxHeight: upward ? rect.top - GAP * 3 : below,
    });
    // Start where the value already is, so a stray Enter changes nothing.
    setActive(selectedIndex === -1 ? 0 : selectedIndex);
  }

  function close(): void {
    setPosition(null);
    trigger.current?.focus();
  }

  function choose(index: number): void {
    const option = options[index];
    if (option) onChange(option.value);
    close();
  }

  /** First letter jumps to the next option starting with it, and wraps. */
  function typeahead(character: string): void {
    const wanted = character.toLowerCase();
    for (let step = 1; step <= options.length; step += 1) {
      const index = (active + step) % options.length;
      if (options[index]?.label.toLowerCase().startsWith(wanted)) {
        setActive(index);
        return;
      }
    }
  }

  function onKeyDown(event: React.KeyboardEvent): void {
    if (!open) {
      if ([' ', 'Enter', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        openList();
      }
      return;
    }

    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        close();
        return;
      case 'Tab':
        // Not prevented: the list closes and focus carries on out of the field.
        setPosition(null);
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        choose(active);
        return;
      case 'ArrowDown':
        event.preventDefault();
        // Stops at the ends rather than wrapping, which is what the native
        // control it replaces does; Home and End are how you reach them.
        setActive((current) => Math.min(current + 1, options.length - 1));
        return;
      case 'ArrowUp':
        event.preventDefault();
        setActive((current) => Math.max(current - 1, 0));
        return;
      case 'Home':
        event.preventDefault();
        setActive(0);
        return;
      case 'End':
        event.preventDefault();
        setActive(options.length - 1);
        return;
      default:
        if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) typeahead(event.key);
    }
  }

  return (
    <>
      <button
        ref={trigger}
        id={id}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open ? `${optionId}-${active}` : undefined}
        disabled={disabled}
        className={styles.trigger}
        onClick={() => (open ? setPosition(null) : openList())}
        onKeyDown={onKeyDown}
      >
        {/* A value with no matching option says so rather than showing the
            label of something else, or nothing at all. */}
        <span className={styles.value} data-placeholder={selected === undefined}>
          {selected?.label ?? 'Select…'}
        </span>
        <Icon name="chevronDown" size={13} strokeWidth={1.8} />
      </button>

      {position !== null &&
        createPortal(
          <div
            ref={panel}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            className={styles.panel}
            style={{
              top: position.top,
              left: position.left,
              minWidth: position.width,
              maxHeight: position.maxHeight,
            }}
          >
            {options.map((option, index) => (
              <div
                key={option.value}
                id={`${optionId}-${index}`}
                role="option"
                aria-selected={option.value === value}
                data-active={index === active}
                className={styles.option}
                // The keyboard owns the highlight; hovering moves it there so
                // the two never disagree about what Enter would choose.
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(index)}
              >
                <span className={styles.optionText}>
                  <span className={styles.optionLabel}>{option.label}</span>
                  {option.description && (
                    <span className={styles.optionDescription}>{option.description}</span>
                  )}
                </span>
                {option.value === value && <Icon name="check" size={13} strokeWidth={2} />}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
