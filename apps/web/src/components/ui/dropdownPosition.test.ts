import { describe, expect, it } from 'vitest';
import { panelPosition } from './dropdownPosition';
import type { PanelAnchor } from './types/dropdown';

const VIEWPORT = 800;

/** A 31px trigger — the primitive's own height — with its top where asked. */
function trigger(top: number, extra: Partial<PanelAnchor> = {}): PanelAnchor {
  return { top, bottom: top + 31, left: 120, width: 72, viewportHeight: VIEWPORT, ...extra };
}

/**
 * Where the panel's top edge lands once the browser has drawn it. That is the
 * number the bug was about: the position is computed before the panel exists,
 * so a height it never gets to see decides where it ends up.
 */
function renderedTop(anchor: PanelAnchor, panelHeight: number): number {
  const position = panelPosition(anchor);
  if (position.top !== undefined) return position.top;
  if (position.bottom === undefined)
    throw new Error('a panel is anchored to one edge or the other');
  return anchor.viewportHeight - position.bottom - panelHeight;
}

describe('a trigger with room below it', () => {
  it('opens downward, just under the trigger', () => {
    const position = panelPosition(trigger(200));
    expect(position.top).toBe(235); // 231 + the 4px gap
    expect(position.bottom).toBeUndefined();
  });

  it('is never taller than the room it opened into', () => {
    const position = panelPosition(trigger(200));
    expect(position.maxHeight).toBeLessThanOrEqual(VIEWPORT - 231);
  });

  it('takes the left edge and width of the trigger', () => {
    const position = panelPosition(trigger(200));
    expect(position.left).toBe(120);
    expect(position.width).toBe(72);
  });
});

describe('a trigger with no room below it', () => {
  it('flips upward, anchored to the trigger rather than to the viewport', () => {
    const position = panelPosition(trigger(745));
    expect(position.top).toBeUndefined();
    // The panel's bottom edge sits 4px above the trigger's top, whatever its height.
    expect(position.bottom).toBe(VIEWPORT - 745 + 4);
  });

  it('is never taller than the room above', () => {
    expect(panelPosition(trigger(745)).maxHeight).toBeLessThanOrEqual(745);
  });

  /**
   * The regression, in numbers: the pagination bar's "Rows per page" sits at
   * the bottom edge and its list is four short options. Pinned by its top, that
   * panel rendered at y=8 — a screen away from the control that opened it.
   */
  it('keeps a short list beside its trigger instead of at the top of the viewport', () => {
    const top = renderedTop(trigger(745), 170);
    expect(top).toBeGreaterThan(400);
    expect(745 - top).toBeLessThan(250); // it meets the trigger
  });

  it('keeps a list too tall for the room on screen', () => {
    const anchor = trigger(745);
    const position = panelPosition(anchor);
    expect(renderedTop(anchor, position.maxHeight)).toBeGreaterThanOrEqual(0);
  });
});

describe('choosing a direction', () => {
  it('stays downward when the room below is merely tight but usable', () => {
    // 380px below: less than above, but more than enough for a list.
    expect(panelPosition(trigger(380)).top).toBeDefined();
  });

  it('stays downward when there is no more room above either', () => {
    expect(panelPosition(trigger(60, { viewportHeight: 200 })).top).toBeDefined();
  });
});
