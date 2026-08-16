import type { ReactNode } from 'react';

/** Two-column key/value line used by the Details and Custom fields cards. */
export function KeyValueRow({ k, children }: { k: ReactNode; children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 12,
        borderBottom: '1px solid var(--border)',
        paddingBottom: 8,
        fontSize: '12.5px',
        minWidth: 0,
      }}
    >
      <span style={{ color: 'var(--muted)', flex: 'none' }}>{k}</span>
      <span
        style={{
          fontWeight: 500,
          textAlign: 'right',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {children}
      </span>
    </div>
  );
}
