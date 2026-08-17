import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import type { Role } from '@inventory/shared';
import { useAssets, useEmployees } from '@/api/queries';
import { Icon, Kbd } from '@/components/ui';
import { useModals } from '@/providers/ModalProvider';
import { useThemeControls } from './useThemeControls';
import { paletteGroups, paletteRows, type PaletteEffect } from './palette';
import styles from './CommandPalette.module.css';

/**
 * ⌘K. The design promises "↑↓ navigate · ↵ open · esc close" in its footer and
 * the prototype implements none of it, so this does: one flat roving index over
 * the grouped rows, wrapping at both ends.
 *
 * Everything is filtered client-side from the lists the app has already loaded.
 * At this scale that is instant and adds no search endpoint to defend.
 */
export function CommandPalette({ role, onClose }: { role: Role; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();

  const navigate = useNavigate();
  const { openModal } = useModals();
  const { toggleTheme } = useThemeControls();
  const assets = useAssets();
  const employees = useEmployees();
  const listRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(
    // Lists that have not arrived are no rows to search yet.
    () =>
      paletteGroups({ query, role, assets: assets.data ?? [], employees: employees.data ?? [] }),
    [query, role, assets.data, employees.data],
  );
  const rows = useMemo(() => paletteRows(groups), [groups]);
  // `active` is an index this component maintains across renders while the
  // results change underneath it. Reading the row once — and checking it — is
  // the honest shape: the invariant is kept by hand, so it can be broken by
  // hand, and ↵ on nothing should do nothing rather than throw.
  const activeRow = rows[active];

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function run(effect: PaletteEffect): void {
    onClose();
    if (effect.kind === 'navigate') navigate(effect.to);
    else if (effect.kind === 'modal') openModal(effect.modal);
    else toggleTheme();
  }

  function onKeyDown(event: React.KeyboardEvent): void {
    if (event.key === 'Escape') {
      onClose();
      return;
    }
    if (rows.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => (current + 1) % rows.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => (current - 1 + rows.length) % rows.length);
    } else if (event.key === 'Enter' && activeRow) {
      event.preventDefault();
      run(activeRow.effect);
    }
  }

  return createPortal(
    <div
      className={styles.overlay}
      data-testid="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label="Command palette" className={styles.card}>
        <div className={styles.search}>
          <Icon name="search" size={15} strokeWidth={1.8} />
          <input
            className={styles.input}
            role="combobox"
            aria-label="Search assets, people, or type a command"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={activeRow?.id}
            autoFocus
            value={query}
            placeholder="Search assets, people, or type a command…"
            onChange={(event) => {
              setQuery(event.target.value);
              // Typing changes the list under the highlight, so it goes back to
              // the top — otherwise ↵ opens whatever slid into that position.
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          <Kbd>esc</Kbd>
        </div>

        <div className={styles.results} id={listId} role="listbox" ref={listRef}>
          {groups.map((group) => (
            <div key={group.label}>
              <div className={styles.groupLabel}>{group.label}</div>
              {group.rows.map((row) => (
                <button
                  key={row.id}
                  id={row.id}
                  type="button"
                  role="option"
                  aria-selected={activeRow?.id === row.id}
                  className={styles.row}
                  // The keyboard owns the highlight; hovering moves it there so
                  // the two never disagree about what ↵ would open.
                  onMouseEnter={() => setActive(rows.findIndex((entry) => entry.id === row.id))}
                  onClick={() => run(row.effect)}
                >
                  <Icon name={row.icon} size={14} strokeWidth={1.7} />
                  <span className={styles.title}>{row.title}</span>
                  <span className={styles.subtitle}>{row.subtitle}</span>
                  <span className={styles.hint}>{row.hint}</span>
                </button>
              ))}
            </div>
          ))}
          {rows.length === 0 && <div className={styles.empty}>No results for “{query}”</div>}
        </div>

        <div className={styles.footer}>
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
