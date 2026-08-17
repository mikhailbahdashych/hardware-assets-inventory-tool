import type { FilterPillsProps } from './types/filterPills';
import styles from './FilterPills.module.css';

export function FilterPills<V extends string>({ options, value, onChange }: FilterPillsProps<V>) {
  return (
    <div className={styles.pills}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          data-active={option.value === value}
          className={styles.pill}
          onClick={() => onChange(option.value)}
        >
          {option.count === undefined ? option.label : `${option.label} ${option.count}`}
        </button>
      ))}
    </div>
  );
}
