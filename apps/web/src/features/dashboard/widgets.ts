import type { SemanticColor } from '@inventory/shared';

// Which widgets exist, and how a member's stored map decides what they see.

export const DASHBOARD_WIDGETS = [
  { key: 'kpi', label: 'Status counts', description: 'Six KPI tiles, one per asset status' },
  {
    key: 'category',
    label: 'Assets by category',
    description: 'Bar chart of the fleet composition',
  },
  { key: 'activity', label: 'Recent activity', description: 'Latest changes across the workspace' },
  {
    key: 'warranty',
    label: 'Warranty expirations',
    description: 'Devices expiring within 90 days',
  },
  { key: 'returns', label: 'Pending returns', description: 'Assets due back from offboarding' },
] as const;

export type WidgetKey = (typeof DASHBOARD_WIDGETS)[number]['key'];

/**
 * A widget nobody has touched is visible. The stored map only records the ones
 * a member turned **off**, so a widget added in a later release appears for
 * everyone instead of hiding until they go and find it.
 */
export function isWidgetVisible(widgets: Record<string, boolean>, key: WidgetKey): boolean {
  return widgets[key] !== false;
}

/**
 * The design's urgency colours for a warranty pill: under a month is a problem,
 * one to three months is a heads-up.
 */
export function warrantyUrgency(daysLeft: number): SemanticColor {
  return daysLeft < 30 ? 'err' : 'warn';
}
