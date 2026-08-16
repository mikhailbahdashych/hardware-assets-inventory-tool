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
    const match = pattern.exec(tag);
    if (match) highest = Math.max(highest, Number.parseInt(match[1], 10));
  }
  const next = String(highest + 1).padStart(4, '0');
  return `${prefix}-${next}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
