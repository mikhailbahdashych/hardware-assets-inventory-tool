import type { ReactNode } from 'react';

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd
      style={{
        fontSize: '10.5px',
        fontFamily: 'var(--font-mono)',
        border: '1px solid var(--border)',
        borderRadius: 4,
        padding: '1px 5px',
        color: 'var(--faint)',
      }}
    >
      {children}
    </kbd>
  );
}
