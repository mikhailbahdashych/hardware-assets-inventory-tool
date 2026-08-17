// CSV on the wire. The activity-log export uses it today; the import wizard's
// templates and column vocabulary join it in PR 7.

const NEEDS_QUOTES = /[",\r\n]/;

/**
 * A leading character that makes Excel, LibreOffice and Google Sheets treat the
 * cell as a formula rather than text. Quoting does not help — the parser strips
 * quotes before evaluating.
 */
const READS_AS_FORMULA = /^[=+\-@\t\r]/;

/**
 * RFC 4180: a field is quoted only when it would otherwise tear the row apart,
 * and an embedded quote is doubled. Asset names really do contain commas and
 * inch marks (`MacBook Pro 14"`), so this is not a theoretical case.
 *
 * A cell that would read as a formula is prefixed with an apostrophe first,
 * which is the spreadsheet convention for "this is text". Every value in these
 * files came from somebody typing it — an asset name, a display name, a
 * rendered audit sentence — and the person who opens the export is the admin
 * who asked for it. `=HYPERLINK(...)` in an asset name would otherwise run on
 * their machine, with their sheet, at their privilege.
 *
 * Neutralising here rather than at each call site is deliberate: the audit
 * export, the import templates and anything added later all pass through this
 * one function, so none of them can forget.
 */
export function csvField(value: string): string {
  const safe = READS_AS_FORMULA.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** A whole file, CRLF-free: one header row, then the rows, newline-terminated. */
export function toCsv(headers: string[], rows: string[][]): string {
  return [headers, ...rows].map((row) => row.map(csvField).join(',')).join('\n') + '\n';
}
