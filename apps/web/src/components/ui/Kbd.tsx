import type { KbdProps } from './types/kbd';

export function Kbd({ children }: KbdProps) {
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
