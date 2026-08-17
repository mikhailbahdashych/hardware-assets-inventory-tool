import type { RadioCardProps } from './types/radioCard';
import styles from './RadioCard.module.css';

export function RadioCard<V extends string>({
  name,
  value,
  checked,
  onChange,
  title,
  description,
}: RadioCardProps<V>) {
  return (
    <label className={styles.card} data-checked={checked}>
      <input
        type="radio"
        className={styles.input}
        name={name}
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
      />
      <span className={styles.dot} aria-hidden="true" />
      <span>
        <span className={styles.title}>{title}</span>
        <span className={styles.description}>{description}</span>
      </span>
    </label>
  );
}
