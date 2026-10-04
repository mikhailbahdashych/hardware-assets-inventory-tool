/**
 * Where focus goes when the row `id` leaves a list: the row after it, else the
 * row before it, else nowhere — `null` is the list now being empty, and the
 * caller sends focus to the page's own way to add one.
 */
export function survivor(ids: string[], id: string): string | null {
  const at = ids.indexOf(id);
  // Next, then previous, then nobody: the rule, read left to right.
  return ids[at + 1] ?? ids[at - 1] ?? null;
}
