import type { DbOrTx } from '@/types/db.js';
import type { CustomFieldSummary } from '@/types/custom-fields.js';
import { customFieldDefs } from '@/db/schema.js';

/**
 * Reading the custom-field definitions. Writing them stays in
 * `modules/custom-fields.ts`, which is where every rule about them lives — this
 * is here only because the internal route and its public twin must send the
 * same rows through the same serializer.
 */

/** One definition as every reader sees it: never the row, which carries more. */
export const serializeCustomField = (
  def: typeof customFieldDefs.$inferSelect,
): CustomFieldSummary => ({
  id: def.id,
  key: def.key,
  label: def.label,
  type: def.type,
  sortOrder: def.sortOrder,
});

/** Every definition, in the order an asset form draws them. */
export async function listCustomFields(db: DbOrTx): Promise<CustomFieldSummary[]> {
  const rows = await db.select().from(customFieldDefs).orderBy(customFieldDefs.sortOrder);
  return rows.map(serializeCustomField);
}
