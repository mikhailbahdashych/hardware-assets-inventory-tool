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
 * What the nightly tidy-up removed, across sessions, spent tokens and audit
 * events past the workspace's retention. One number because a self-hoster reads
 * it as "something was cleaned", not as an inventory of what.
 */
export interface MaintenanceResult {
  pruned: number;
}

/**
 * The running scheduler. `stop()` is what a test (and a graceful shutdown) uses
 * to put the cron tasks down again; there is nothing else to ask it.
 */
export interface SchedulerHandle {
  stop: () => void;
}
