import type { ReactNode } from 'react';

/**
 * A sentence from the document with its backticked spans set in mono. That is
 * the only markup the document's prose uses — scopes, field names, a header —
 * so this is a split on the backtick rather than a markdown renderer; the
 * odd-numbered pieces are the ones that sat between a pair.
 */
export function withCode(text: string): ReactNode[] {
  return text
    .split('`')
    .map((piece, index) => (index % 2 === 1 ? <code key={index}>{piece}</code> : piece));
}
