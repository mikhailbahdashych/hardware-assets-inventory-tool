import type { Action } from '@inventory/shared';

export type OpenModal = 'edit' | 'assign' | 'checkin' | 'status' | 'fields' | null;

export interface PrimaryAction {
  label: string;
  modal: OpenModal;
  permission: Action;
}

export interface AssetDetailPageProps {
  /** What the signed-in member may do, resolved server-side — see `can`. */
  permissions: Action[];
}
