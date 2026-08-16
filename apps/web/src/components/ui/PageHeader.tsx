import type { ReactNode } from 'react';

/** Page title row: 18px/600 title (with optional subtitle) left, actions right. */
export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ marginRight: 'auto' }}>
        <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{title}</h1>
        {subtitle && (
          <div style={{ fontSize: '12.5px', color: 'var(--muted)', marginTop: 2 }}>{subtitle}</div>
        )}
      </div>
      {children}
    </div>
  );
}
