import type { Assignment } from '@/api/types';
import { buildTimeline } from './timeline';
import styles from './Timeline.module.css';

/**
 * The vertical timeline from the design: a dot per entry, coloured by what it
 * is (accent = current holder, green = origin, neutral = past or in stock),
 * joined by a connector line.
 */
export function OwnershipTimeline({
  history,
  assetCreatedAt,
}: {
  history: Assignment[];
  assetCreatedAt: string;
}) {
  const entries = buildTimeline(history, assetCreatedAt);

  return (
    <ol className={styles.timeline}>
      {entries.map((entry, index) => (
        <li key={entry.id} className={styles.entry} data-last={index === entries.length - 1}>
          <span className={styles.rail} aria-hidden="true">
            <span className={styles.dot} data-sv={entry.sv} />
            <span className={styles.line} />
          </span>
          <span className={styles.body}>
            <span className={styles.title}>{entry.title}</span>
            <span className={styles.range}>{entry.range}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
