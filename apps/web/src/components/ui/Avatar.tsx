import { avatarColor } from '@/lib/avatar';
import { initials } from '@/lib/format';
import type { AvatarProps } from './types/avatar';
import styles from './Avatar.module.css';

/** Sizes used by the design: 24 (sidebar/lists), 26 (table rows), 30 (holder card), 44 (employee header). */
export function Avatar({ name, colorKey, size = 26, square = false }: AvatarProps) {
  const fontSize = size >= 44 ? 15 : size >= 30 ? 11 : size >= 24 ? 10 : 9.5;
  return (
    <span
      className={styles.avatar}
      data-square={square}
      style={{ width: size, height: size, fontSize, background: avatarColor(colorKey ?? name) }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
