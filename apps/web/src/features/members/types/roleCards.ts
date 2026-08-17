import type { Role } from '@inventory/shared';

export interface RoleCardsProps {
  name: string;
  value: Role;
  onChange: (role: Role) => void;
}
