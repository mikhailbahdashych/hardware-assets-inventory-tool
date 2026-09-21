import { asc, desc } from 'drizzle-orm';
import type { Db } from '@/types/db.js';
import type { SearchPayload } from '@/types/search.js';
import { assets, employees } from '@/db/schema.js';
import { containsAny } from '@/lib/search.js';
import { ASSET_SEARCH_FIELDS } from './assets.js';
import { EMPLOYEE_SEARCH_FIELDS } from './employees.js';

/**
 * What the command palette runs on. It used to search the two whole-list caches
 * in the browser, which stopped being an option the moment those lists were
 * paged — so the same match happens here, over the same fields, capped at what
 * the palette draws.
 *
 * An empty query is not "no results": ⌘K opens on a few of each, exactly as it
 * did when the lists were already in memory. Assets come newest first and
 * people alphabetically, which is the order each list has always had.
 */
export const PER_GROUP = 4;

export async function search(db: Db, query: string): Promise<SearchPayload> {
  const assetRows = await db
    .select({
      id: assets.id,
      name: assets.name,
      assetTag: assets.assetTag,
      status: assets.status,
      category: assets.category,
    })
    .from(assets)
    .where(containsAny(query, ASSET_SEARCH_FIELDS))
    .orderBy(desc(assets.createdAt), desc(assets.id))
    .limit(PER_GROUP);

  const employeeRows = await db
    .select({
      id: employees.id,
      firstName: employees.firstName,
      lastName: employees.lastName,
      jobTitle: employees.jobTitle,
      department: employees.department,
    })
    .from(employees)
    .where(containsAny(query, EMPLOYEE_SEARCH_FIELDS))
    .orderBy(asc(employees.firstName), asc(employees.lastName), asc(employees.id))
    .limit(PER_GROUP);

  return {
    assets: assetRows,
    employees: employeeRows.map((row) => ({
      id: row.id,
      displayName: `${row.firstName} ${row.lastName}`,
      jobTitle: row.jobTitle,
      department: row.department,
    })),
  };
}
