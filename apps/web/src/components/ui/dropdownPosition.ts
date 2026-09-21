import type { PanelAnchor, PanelPosition } from './types/dropdown';

const GAP = 4;
/** Below this there is not enough room to be worth opening downward. */
const MIN_ROOM = 160;

/**
 * Where the portalled listbox goes, from the trigger's rect alone — the panel
 * does not exist yet when this runs, so its height is not a number anyone here
 * can have.
 *
 * Which is why downward is anchored by `top` and upward by `bottom`. Pinning an
 * upward panel by its top would need that height to reach the trigger, and a
 * short list — the pagination bar's four page sizes, at the foot of the page —
 * would hang at the top of the viewport instead, a screen away from the control
 * that opened it. The bottom edge is the one that has to meet the trigger, so
 * the bottom edge is what we position.
 */
export function panelPosition(anchor: PanelAnchor): PanelPosition {
  const below = anchor.viewportHeight - anchor.bottom - GAP * 2;
  const above = anchor.top - GAP * 2;
  // Open upward when the room below is too small to be usable and there is
  // more of it above — a dropdown near the bottom of a modal is normal.
  const upward = below < MIN_ROOM && above > below;
  const edge = upward
    ? { bottom: anchor.viewportHeight - anchor.top + GAP, maxHeight: above - GAP }
    : { top: anchor.bottom + GAP, maxHeight: below };
  return { ...edge, left: anchor.left, width: anchor.width };
}
