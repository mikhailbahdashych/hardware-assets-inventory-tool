import type { Action, Role } from '@inventory/shared';

export type OpenModal = 'edit' | 'assign' | 'checkin' | 'status' | 'fields' | null;

export interface PrimaryAction {
  label: string;
  modal: OpenModal;
  permission: Action;
}

export interface AssetDetailPageProps {
  role: Role;
}
