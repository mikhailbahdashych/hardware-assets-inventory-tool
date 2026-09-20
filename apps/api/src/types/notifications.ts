import type { NotificationParams } from '@inventory/shared';

/** One inbox write: who hears it, what it says, and whether it may repeat. */
export interface NotifyInput {
  memberId: string;
  kind: string;
  params: NotificationParams;
  /** Set where a job must not repeat itself; unique per member. */
  dedupeKey?: string;
}
