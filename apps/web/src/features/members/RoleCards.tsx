import { ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS } from '@inventory/shared';
import { RadioCard } from '@/components/ui';
import type { RoleCardsProps } from './types/roleCards';
import styles from './Members.module.css';

/** The design's radio cards, shared by the invite form and the role change. */
export function RoleCards({ name, value, onChange }: RoleCardsProps) {
  return (
    <div className={styles.roleCards}>
      {ROLES.map((role) => (
        <RadioCard
          key={role}
          name={name}
          value={role}
          checked={role === value}
          onChange={onChange}
          title={ROLE_LABELS[role]}
          description={ROLE_DESCRIPTIONS[role]}
        />
      ))}
    </div>
  );
}
