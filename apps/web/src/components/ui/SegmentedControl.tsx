import styles from './SegmentedControl.module.css';

export type SegmentOption<V extends string> = {
  value: V;
  label: string;
  title?: string;
};

export function SegmentedControl<V extends string>({
  options,
  value,
  onChange,
}: {
  options: SegmentOption<V>[];
  value: V;
  onChange: (value: V) => void;
}) {
  return (
    <div className={styles.control}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.title}
          data-active={option.value === value}
          className={styles.segment}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
