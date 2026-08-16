// Display formatting for dates, durations, money, and names.
// All date rendering is UTC-based: date-only strings ("YYYY-MM-DD") parse as
// UTC midnight, so output never depends on the viewer's timezone.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function utcFormat(date: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(date);
}

/**
 * Relative under a week ("26m ago", "2h ago", "Yesterday", "3d ago"), absolute
 * after ("Aug 9", with the year when it differs), em dash for never.
 */
export function formatRelativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—';
  const date = new Date(iso);
  const diff = now.getTime() - date.getTime();
  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < 2 * DAY) return 'Yesterday';
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d ago`;
  if (date.getUTCFullYear() === now.getUTCFullYear()) {
    return utcFormat(date, { month: 'short', day: 'numeric' });
  }
  return utcFormat(date, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "Mar 2023" — table cells for purchased/warranty. */
export function formatMonthYear(date: string | null | undefined): string {
  if (!date) return '—';
  return utcFormat(new Date(date), { month: 'short', year: 'numeric' });
}

/** "Feb 3, 2024" — detail cards and holder info. */
export function formatFullDate(date: string | null | undefined): string {
  if (!date) return '—';
  return utcFormat(new Date(date), { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "2 yrs 6 mo" / "3 mo" / "12 days" — holding durations. Minimum "1 day". */
export function formatDuration(from: string, to?: string | null): string {
  const start = new Date(from);
  const end = to ? new Date(to) : new Date();
  let months =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth());
  if (end.getUTCDate() < start.getUTCDate()) months -= 1;
  months = Math.max(0, months);
  if (months >= 12) {
    const years = Math.floor(months / 12);
    const rest = months % 12;
    const yearPart = `${years} ${years === 1 ? 'yr' : 'yrs'}`;
    return rest > 0 ? `${yearPart} ${rest} mo` : yearPart;
  }
  if (months > 0) return `${months} mo`;
  const days = Math.max(1, Math.floor((end.getTime() - start.getTime()) / DAY));
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/** "€2,340" — decimals only when the amount has them. Amounts are integer cents. */
export function formatCurrency(cents: number | null | undefined, currency: string): string {
  if (cents === null || cents === undefined) return '—';
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(cents / 100);
}

/** "Maya Lindqvist" → "ML"; strips non-letters ("Liam O'Connor" → "LO"). */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((word) => word[0] ?? '')
    .join('')
    .replace(/[^A-Za-z]/g, '')
    .slice(0, 2)
    .toUpperCase();
}

/** "184 KB" — attachment sizes, in the units a file manager would show. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
