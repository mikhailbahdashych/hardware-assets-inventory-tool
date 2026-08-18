import { useRoles } from '@/api/queries';
import { RadioCard, Spinner } from '@/components/ui';
import type { RoleCardsProps } from './types/roleCards';
import styles from './Members.module.css';

/**
 * The design's radio cards, shared by the invite form and the role change.
 *
 * The cards are rows now, so this reads the same payload the Roles page edits —
 * a workspace that invented "Auditor" offers it here the moment it exists,
 * with the description its admin wrote.
 */
export function RoleCards({ name, value, onChange }: RoleCardsProps) {
  const roles = useRoles();

  if (roles.data === undefined) {
    return (
      <div className={styles.loading}>
        <Spinner size={16} />
      </div>
    );
  }

  return (
    <div className={styles.roleCards}>
      {roles.data.roles.map((role) => (
        <RadioCard
          key={role.id}
          name={name}
          value={role.id}
          checked={role.id === value}
          onChange={onChange}
          title={role.label}
          // A nullable column: no description is simply no line under the name.
          description={role.description ?? ''}
        />
      ))}
    </div>
  );
}
