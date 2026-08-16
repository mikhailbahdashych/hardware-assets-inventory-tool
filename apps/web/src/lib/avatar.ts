/** The design's 9-color initials-avatar palette (white text on all of them). */
export const AVATAR_PALETTE: readonly string[] = [
  '#7c66dc',
  '#0d9488',
  '#d97706',
  '#2563eb',
  '#db2777',
  '#059669',
  '#dc2626',
  '#6366f1',
  '#b45309',
];

/**
 * Stable color per entity id — a hash, not a list index, so adding or removing
 * people never recolors everyone else's avatar.
 */
export function avatarColor(id: string): string {
  let hash = 5381;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash * 33) ^ id.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}
