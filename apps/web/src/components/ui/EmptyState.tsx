import type { ReactNode } from 'react';

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: 22, textAlign: 'center', fontSize: '12.5px', color: 'var(--muted)' }}>
      {children}
    </div>
  );
}
