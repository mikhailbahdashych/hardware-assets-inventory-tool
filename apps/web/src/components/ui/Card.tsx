import type { CardProps } from './types/card';
import styles from './Card.module.css';

export function Card({ title, padding = true, className, style, children }: CardProps) {
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
