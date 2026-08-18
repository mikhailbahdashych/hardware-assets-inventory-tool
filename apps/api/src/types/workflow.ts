import type { assetStatuses } from '@/db/schema.js';

/**
 * One status row. Named here rather than beside the query because four
 * services read it — assets, assignments, dashboard and import all ask the
 * workflow what a status is before they act on one.
 */
export type AssetStatusRow = typeof assetStatuses.$inferSelect;
