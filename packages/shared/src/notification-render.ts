import type { RenderableNotification } from './types/notifications';

// Deterministic across engines and locales — Intl's short months disagree
// between ICU builds ("Sep" vs "Sept"), and a golden test cannot.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function day(value: unknown): string {
  const [year, month, date] = String(value).split('-');
  const label = MONTHS[Number(month) - 1];
  if (!year || !label || !date) return String(value);
  return `${Number(date)} ${label} ${year}`;
}

/**
 * A param the sentence cannot do without. Every kind is written by the API,
 * and its writers always send these, so a missing one is a writer broken —
 * and "You were handed  · iPad" or "was due undefined" is a notice about a
 * device nobody can identify. The throw names the kind and the key instead.
 */
function param(event: RenderableNotification, key: string): string | number | boolean {
  const value = event.params[key];
  if (value === undefined || value === null) {
    throw new Error(
      `The "${event.kind}" notification has no "${key}" — whatever wrote it is broken.`,
    );
  }
  return value;
}

const tagged = (event: RenderableNotification): string =>
  `${String(param(event, 'assetTag'))} · ${String(param(event, 'assetName'))}`;

/**
 * kind + params → the sentence the inbox shows. One renderer, like the audit
 * log's, so the bell and any future surface cannot drift apart.
 */
const RENDERERS: Record<string, (event: RenderableNotification) => string> = {
  'warranty.expiring': (n) => {
    const days = Number(param(n, 'days'));
    const when = days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
    return `Warranty for ${tagged(n)} expires ${when}`;
  },
  'return.due': (n) =>
    param(n, 'overdue') === true
      ? `Your return of ${tagged(n)} was due ${day(param(n, 'date'))}`
      : `Your return of ${tagged(n)} is due ${day(param(n, 'date'))}`,
  'assignment.received': (n) => `You were handed ${tagged(n)}`,
  'assignment.checked_in': (n) => `${tagged(n)} was checked in from you`,
};

export const NOTIFICATION_KINDS = Object.keys(RENDERERS);

/** An unknown kind renders as itself — an inbox that hides rows is worse than an ugly one. */
export function renderNotification(event: RenderableNotification): string {
  const renderer = RENDERERS[event.kind];
  return renderer ? renderer(event) : event.kind;
}
