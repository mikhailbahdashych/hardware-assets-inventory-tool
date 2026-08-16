import styles from './RadioCard.module.css';

export function RadioCard<V extends string>({
  name,
  value,
  checked,
  onChange,
  title,
  description,
}: {
  name: string;
  value: V;
  checked: boolean;
  onChange: (value: V) => void;
  title: string;
  description: string;
}) {
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
