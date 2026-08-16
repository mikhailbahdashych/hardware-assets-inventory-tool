import type { CSSProperties, ReactNode } from 'react';
import styles from './Card.module.css';

export function Card({
  title,
  padding = true,
  className,
  style,
  children,
}: {
  title?: ReactNode;
  padding?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      data-padding={padding}
      className={className ? `${styles.card} ${className}` : styles.card}
      style={style}
    >
      {title && <div className={styles.title}>{title}</div>}
      {children}
    </div>
  );
}
