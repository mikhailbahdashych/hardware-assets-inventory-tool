import type { SegmentedControlProps } from './types/segmentedControl';
import styles from './SegmentedControl.module.css';

export function SegmentedControl<V extends string>({
  options,
  value,
  onChange,
  grow = false,
}: SegmentedControlProps<V>) {
  return (
    <div className={styles.control} data-grow={grow}>
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
