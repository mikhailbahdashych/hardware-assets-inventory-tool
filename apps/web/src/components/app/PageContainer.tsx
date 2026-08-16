import type { ReactNode } from 'react';

/**
 * Page frame from the design: 24px/28px padding for list pages, 20px/28px for
 * detail pages, with a per-section max width (lists 1160, details and admin
 * 1060, members 960).
 */
export function PageContainer({
  maxWidth = 1160,
  variant = 'list',
  gap = 14,
  children,
}: {
  maxWidth?: number;
  variant?: 'list' | 'detail';
  gap?: number;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        maxWidth,
        margin: '0 auto',
        padding: variant === 'detail' ? '20px 28px' : '24px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap,
      }}
    >
      {children}
    </div>
  );
}
