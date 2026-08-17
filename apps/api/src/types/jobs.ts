/**
 * What a scheduled mail job did. `skipped` counts the messages a guard stopped
 * — no mailer, a settings toggle, or one already sent — so a log line can tell
 * "nothing to do" apart from "not configured".
 */
export interface JobResult {
  sent: number;
  skipped: number;
}
