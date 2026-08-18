import type { WorkflowTransition } from '@inventory/shared';

// The matrix edits the whole graph at once, so the thing it edits is a set of
// edges — one key per checked box. The same shape as `settingsDraft.ts`: the
// diff against what is stored *is* the dirty check, so the Save button and the
// payload can never disagree about whether there is anything to save.

/**
 * One direction of one pair. The arrow is not a separator anyone has to parse
 * back — `transitionsFromDraft` never splits a key, it keeps the pair — so a
 * status id containing an underscore, or any other character, is safe.
 */
export function draftKey(from: string, to: string): string {
  return `${from}→${to}`;
}

export function draftFromTransitions(transitions: WorkflowTransition[]): Set<string> {
  return new Set(transitions.map((edge) => draftKey(edge.from, edge.to)));
}

/**
 * The edges the boxes hold, as the PUT sends them. Built by walking the pairs
 * the draft was made of rather than by splitting keys, which is what makes the
 * key format an implementation detail.
 */
export function transitionsFromDraft(draft: Set<string>): WorkflowTransition[] {
  return [...draft].map((key) => {
    const [from, to] = key.split('→');
    // Every key in a draft came from `draftKey`, which always writes both
    // halves — a key without them would mean somebody built a draft by hand.
    if (from === undefined || to === undefined || from === '' || to === '') {
      throw new Error(`"${key}" is not a transition key.`);
    }
    return { from, to };
  });
}

/** Whether the draft differs from what is stored, in either direction. */
export function draftChanged(stored: Set<string>, draft: Set<string>): boolean {
  if (stored.size !== draft.size) return true;
  for (const key of draft) {
    if (!stored.has(key)) return true;
  }
  return false;
}
