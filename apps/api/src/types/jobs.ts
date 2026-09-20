/**
 * What a scheduled inbox job did. `skipped` counts what a guard stopped — a
 * settings toggle, a dedupe key that already delivered, or a holder with no
 * linked member — so a log line can tell "nothing to do" apart from "unheard".
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
  /** Inbox rows past ninety days, read or not. */
  notificationRowsPruned: number;
}

/**
 * The running scheduler. `stop()` is what a test (and a graceful shutdown) uses
 * to put the cron tasks down again; there is nothing else to ask it.
 */
export interface SchedulerHandle {
  stop: () => void;
}
