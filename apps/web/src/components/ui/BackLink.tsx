import { Link } from 'react-router';
import { Icon } from './Icon';
import type { BackLinkProps } from './types/backLink';
import styles from './BackLink.module.css';

export function BackLink({ to, children }: BackLinkProps) {
  return (
    <Link to={to} className={styles.back}>
      <Icon name="chevronLeft" size={13} strokeWidth={2} />
      {children}
    </Link>
  );
}
