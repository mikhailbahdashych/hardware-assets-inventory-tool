import type { TabsProps } from './types/tabs';
import styles from './Tabs.module.css';

export function Tabs<V extends string>({ tabs, value, onChange }: TabsProps<V>) {
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
