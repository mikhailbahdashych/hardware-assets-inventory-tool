import type { Action } from '@inventory/shared';

/** The session's set, for the one read on the page another action gates. */
export interface ActivityLogPageProps {
  permissions: Action[];
}

export interface ActivityLogPanelProps {
  permissions: Action[];
}
