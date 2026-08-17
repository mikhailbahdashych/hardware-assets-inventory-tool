import type { Role } from '@inventory/shared';

export interface CommandPaletteProps {
  role: Role;
  onClose: () => void;
}
