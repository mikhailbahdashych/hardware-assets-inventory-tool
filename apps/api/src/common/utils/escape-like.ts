/**
 * Escapes ILIKE/LIKE wildcards so user input matches literally
 * (Postgres default escape character '\').
 */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, '\\$&');
}
