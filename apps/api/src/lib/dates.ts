/** ISO-8601 UTC timestamp, e.g. "2026-08-16T14:03:12.000Z". */
export function nowIso(now: Date = new Date()): string {
  return now.toISOString();
}

/** Date-only string, e.g. "2026-08-16" (UTC). */
export function todayDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
