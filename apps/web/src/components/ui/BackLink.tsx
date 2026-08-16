import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Icon } from './Icon';
import styles from './BackLink.module.css';

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className={styles.back}>
      <Icon name="chevronLeft" size={13} strokeWidth={2} />
      {children}
    </Link>
  );
}
