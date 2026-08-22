/**
 * What a scheduled mail job did. `skipped` counts the messages a guard stopped
 * — no mailer, a settings toggle, or one already sent — so a log line can tell
 * "nothing to do" apart from "not configured".
 */
export interface JobResult {
  sent: number;
  skipped: number;
}

/**
 * What the nightly tidy-up removed. `pruned` covers the rows a self-hoster
 * reads as "something was cleaned" — sessions, spent tokens and audit events
 * past the workspace's retention. The other two are counted apart because they
 * are operational rather than the workspace's own data, and because the number
 * that matters is what a log line says: the scheduler logs this whole object,
 * so a volume quietly collecting stray files says so every night.
 */
export interface MaintenanceResult {
  pruned: number;
  /** Files on the volume that no attachment row names, older than a day. */
  orphanUploadsRemoved: number;
  /** `notification_log` rows past a year — long after any dedupe window. */
  notificationRowsPruned: number;
}

/**
 * The running scheduler. `stop()` is what a test (and a graceful shutdown) uses
 * to put the cron tasks down again; there is nothing else to ask it.
 */
export interface SchedulerHandle {
  stop: () => void;
}
