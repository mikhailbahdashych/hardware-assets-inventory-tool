import { AssetFormModal } from '@/features/assets/AssetFormModal';
import { CustomizeWidgetsModal } from '@/features/dashboard/CustomizeWidgetsModal';
import { EmployeeFormModal } from '@/features/employees/EmployeeFormModal';
import { ImportWizardModal } from '@/features/import/ImportWizardModal';
import { InviteMemberModal } from '@/features/members/InviteMemberModal';
import { useModals } from '@/providers/ModalProvider';
import { CommandPalette } from './CommandPalette';
import type { ModalHostProps } from './types/modalHost';

/**
 * Renders whichever app-level modal is open. Mounted once in the shell, so the
 * command palette can open any of them from any page — and so a toolbar button
 * and a palette action are the same call rather than two copies of one modal.
 *
 * Lazily rendered: nothing here exists until it is asked for, so the palette's
 * query subscriptions and the wizard's file state start clean each time.
 */
export function ModalHost({ member, permissions }: ModalHostProps) {
  const { open, closeModal } = useModals();

  switch (open) {
    case 'palette':
      return <CommandPalette permissions={permissions} onClose={closeModal} />;
    case 'newAsset':
      return <AssetFormModal permissions={permissions} onClose={closeModal} />;
    case 'addEmployee':
      return <EmployeeFormModal permissions={permissions} onClose={closeModal} />;
    case 'inviteMember':
      return <InviteMemberModal onClose={closeModal} />;
    case 'import':
      return <ImportWizardModal onClose={closeModal} />;
    case 'widgets':
      return <CustomizeWidgetsModal member={member} onClose={closeModal} />;
    case null:
      return null;
  }
}
