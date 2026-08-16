import styles from './FilterPills.module.css';

export type FilterPillOption<V extends string> = {
  value: V;
  label: string;
  count?: number;
};

export function FilterPills<V extends string>({
  options,
  value,
  onChange,
}: {
  options: FilterPillOption<V>[];
  value: V;
  onChange: (value: V) => void;
}) {
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
