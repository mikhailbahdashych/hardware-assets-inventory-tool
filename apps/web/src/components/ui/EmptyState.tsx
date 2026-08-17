import type { EmptyStateProps } from './types/emptyState';

export function EmptyState({ children }: EmptyStateProps) {
  return (
    <div style={{ padding: 22, textAlign: 'center', fontSize: '12.5px', color: 'var(--muted)' }}>
      {children}
    </div>
  );
}
