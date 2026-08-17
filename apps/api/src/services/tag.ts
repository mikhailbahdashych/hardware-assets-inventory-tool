/**
 * Next asset tag: settings prefix + (highest existing numeric suffix + 1),
 * zero-padded to at least 4 digits ("AST-0224"). Tags with other prefixes or
 * non-numeric suffixes are ignored. The result is a suggestion — the form
 * keeps it editable and uniqueness is enforced by the database.
 */
export function computeNextTag(prefix: string, existingTags: string[]): string {
  const pattern = new RegExp(`^${escapeRegExp(prefix)}-(\\d+)$`);
  let highest = 0;
  for (const tag of existingTags) {
    // Group 1 is the digits; a tag that matched without them is impossible for
    // this pattern, and reading the group directly says so without an assertion.
    const digits = pattern.exec(tag)?.[1];
    if (digits) highest = Math.max(highest, Number.parseInt(digits, 10));
  }
  const next = String(highest + 1).padStart(4, '0');
  return `${prefix}-${next}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
