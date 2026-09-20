import type { NotificationParams, RenderableNotification } from './types/notifications';

// Deterministic across engines and locales — Intl's short months disagree
// between ICU builds ("Sep" vs "Sept"), and a golden test cannot.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function day(value: unknown): string {
  const [year, month, date] = String(value).split('-');
  const label = MONTHS[Number(month) - 1];
  if (!year || !label || !date) return String(value);
  return `${Number(date)} ${label} ${year}`;
}

const text = (params: NotificationParams, key: string): string => String(params[key] ?? '');
const tagged = (params: NotificationParams): string =>
  `${text(params, 'assetTag')} · ${text(params, 'assetName')}`;

/**
 * kind + params → the sentence the inbox shows. One renderer, like the audit
 * log's, so the bell and any future surface cannot drift apart.
 */
const RENDERERS: Record<string, (params: NotificationParams) => string> = {
  'warranty.expiring': (p) => {
    const days = Number(p.days);
    const when = days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
    return `Warranty for ${tagged(p)} expires ${when}`;
  },
  'return.due': (p) =>
    p.overdue === true
      ? `Your return of ${tagged(p)} was due ${day(p.date)}`
      : `Your return of ${tagged(p)} is due ${day(p.date)}`,
  'assignment.received': (p) => `You were handed ${tagged(p)}`,
  'assignment.checked_in': (p) => `${tagged(p)} was checked in from you`,
};

export const NOTIFICATION_KINDS = Object.keys(RENDERERS);

/** An unknown kind renders as itself — an inbox that hides rows is worse than an ugly one. */
export function renderNotification(event: RenderableNotification): string {
  const renderer = RENDERERS[event.kind];
  return renderer ? renderer(event.params) : event.kind;
}
