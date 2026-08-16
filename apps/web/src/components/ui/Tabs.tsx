import styles from './Tabs.module.css';

export function Tabs<V extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: V; label: string }[];
  value: V;
  onChange: (value: V) => void;
}) {
  return (
    <div role="tablist" className={styles.tabs}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={tab.value === value}
          className={styles.tab}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
