import { customFieldDefs } from './schema.js';
import type { Db } from './client.js';
import { newId } from '../lib/ids.js';
import { nowIso } from '../lib/dates.js';

const DEFAULT_CUSTOM_FIELDS = [
  { key: 'mdm_enrolled', label: 'MDM enrolled', type: 'boolean' },
  { key: 'disk_encryption', label: 'Disk encryption', type: 'boolean' },
  { key: 'hostname', label: 'Hostname', type: 'text' },
  { key: 'cost_center', label: 'Cost center', type: 'text' },
] as const;

/** Idempotent boot seed: default custom-field definitions only. Org settings
 *  are created by the first-run setup flow; demo data only via seed:demo. */
export function seed(db: Db): void {
  DEFAULT_CUSTOM_FIELDS.forEach((field, index) => {
    db.insert(customFieldDefs)
      .values({
        id: newId(),
        key: field.key,
        label: field.label,
        type: field.type,
        sortOrder: index,
        createdAt: nowIso(),
      })
      .onConflictDoNothing({ target: customFieldDefs.key })
      .run();
  });
}
