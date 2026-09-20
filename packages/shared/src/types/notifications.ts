/**
 * The inbox vocabulary both apps read. Params are snapshots taken when the
 * row is written — the same rule as audit events: a renamed or deleted asset
 * must not rewrite what a notification said.
 */
export type NotificationParams = Record<string, string | number | boolean | null | undefined>;

export interface RenderableNotification {
  kind: string;
  params: NotificationParams;
}

/** One inbox row, as `GET /api/v1/notifications` sends it. */
export interface NotificationItem extends RenderableNotification {
  id: string;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationsPayload {
  notifications: NotificationItem[];
  unreadCount: number;
}
