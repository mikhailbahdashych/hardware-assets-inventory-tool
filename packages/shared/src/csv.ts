// CSV on the wire. The activity-log export uses it today; the import wizard's
// templates and column vocabulary join it in PR 7.

const NEEDS_QUOTES = /[",\r\n]/;

/**
 * RFC 4180: a field is quoted only when it would otherwise tear the row apart,
 * and an embedded quote is doubled. Asset names really do contain commas and
 * inch marks (`MacBook Pro 14"`), so this is not a theoretical case.
 */
export function csvField(value: string): string {
  return NEEDS_QUOTES.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** A whole file, CRLF-free: one header row, then the rows, newline-terminated. */
export function toCsv(headers: string[], rows: string[][]): string {
  return [headers, ...rows].map((row) => row.map(csvField).join(',')).join('\n') + '\n';
}
