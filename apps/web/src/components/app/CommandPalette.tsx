import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { useSearch, useWorkflow } from '@/api/queries';
import { ErrorState, Icon, Kbd } from '@/components/ui';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { useModals } from '@/providers/ModalProvider';
import { useThemeControls } from './useThemeControls';
import { paletteGroups, paletteRows } from './palette';
import type { SearchPayload } from '@/types/api';
import type { CommandPaletteProps } from './types/commandPalette';
import type { PaletteEffect } from './types/palette';
import styles from './CommandPalette.module.css';

/** No results yet is no rows — the same shape the endpoint answers with. */
const NOTHING_YET: SearchPayload = { assets: [], employees: [] };

/**
 * ⌘K. The footer promises "↑↓ navigate · ↵ open · esc close", so all three
 * work: one flat roving index over the grouped rows, wrapping at both ends.
 *
 * Assets and people come from `GET /search`, debounced, because the two lists
 * this used to read are pages now — a palette that searched only the page you
 * were on would find less than the app knows. The commands are still local.
 */
export function CommandPalette({ permissions, role, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();

  const navigate = useNavigate();
  const { openModal } = useModals();
  const { toggleTheme } = useThemeControls();
  // The palette only exists while it is open, so the query is always enabled.
  const settled = useDebouncedValue(query);
  const results = useSearch(settled, true);
  const workflow = useWorkflow();
  const listRef = useRef<HTMLDivElement>(null);

  /**
   * The two server-backed groups' own failure. `/search` is obvious; the
   * workflow counts because every asset row's subtitle names a status, and
   * `statusInfo`'s slug fallback is for a status an admin has since deleted,
   * not for a read that did not answer.
   */
  const failure = results.isError ? results.error : workflow.isError ? workflow.error : null;

  function retry(): void {
    void results.refetch();
    void workflow.refetch();
  }

  /**
   * Rows for a query nobody is typing any more are not results, they are the
   * last ones — and ↵ lands on whichever is first. So while the debounce is
   * still holding the needle, or the request for it is still out, the two
   * server-backed groups are empty rather than stale. The commands are matched
   * here and stay, which is what keeps typing "invite" and hitting ↵ honest.
   *
   * A failure empties them for the same reason: the last rows that arrived are
   * not an answer to this question either.
   */
  const stale = settled !== query || results.isPlaceholderData || failure !== null;

  const groups = useMemo(
    () =>
      paletteGroups({
        query,
        permissions,
        role,
        results: stale || !results.isSuccess ? NOTHING_YET : results.data,
        statuses: workflow.isSuccess ? workflow.data.statuses : [],
      }),
    [
      query,
      permissions,
      role,
      stale,
      results.data,
      results.isSuccess,
      workflow.data,
      workflow.isSuccess,
    ],
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
          {/* "We found nothing" and "we could not look" are different answers,
              and only one of them is this palette's to give. The commands sit
              above it either way: the shell stays usable while something under
              it is broken. */}
          {failure !== null ? (
            <ErrorState error={failure} onRetry={retry}>
              Assets and people could not be searched.
            </ErrorState>
          ) : (
            rows.length === 0 && <div className={styles.empty}>No results for “{query}”</div>
          )}
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
