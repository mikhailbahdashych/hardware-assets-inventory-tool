import { useUpdatePrefs } from '@/api/mutations';
import { Button, Modal, ToggleSwitch } from '@/components/ui';
import { DASHBOARD_WIDGETS, isWidgetVisible } from './widgets';
import type { CustomizeWidgetsModalProps } from './types/customizeWidgetsModal';
import styles from './Dashboard.module.css';

/**
 * Changes apply live, as the design says: `useUpdatePrefs` writes the member the
 * server returns straight into the cache, so the page behind the modal
 * re-renders on the response without a refetch to wait for.
 */
export function CustomizeWidgetsModal({ member, onClose }: CustomizeWidgetsModalProps) {
  const update = useUpdatePrefs();

  return (
    <Modal
      title="Customize dashboard"
      subtitle="Toggle widgets on or off — changes apply live"
      width={420}
      topOffset="14vh"
      onClose={onClose}
      footer={
        <>
          <span className={styles.footnote}>Saved per member, not per workspace</span>
          <Button variant="ghost" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      {DASHBOARD_WIDGETS.map((widget) => (
        <div key={widget.key} className={styles.toggleRow}>
          <div className={styles.listText}>
            <div className={styles.toggleLabel}>{widget.label}</div>
            <div className={styles.toggleHint}>{widget.description}</div>
          </div>
          <ToggleSwitch
            label={widget.label}
            checked={isWidgetVisible(member.widgets, widget.key)}
            onChange={(checked) =>
              update.mutate({ widgets: { ...member.widgets, [widget.key]: checked } })
            }
          />
        </div>
      ))}
    </Modal>
  );
}
