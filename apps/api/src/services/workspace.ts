import type { AppDeps } from '@/types/app.js';
import {
  assetCustomValues,
  assets,
  assetStatuses,
  assetStatusTransitions,
  assignments,
  attachments,
  auditEvents,
  authTokens,
  customFieldDefs,
  employees,
  members,
  notificationLog,
  orgSettings,
  rolePermissions,
  roles,
  sessions,
} from '@/db/schema.js';
import { invalidFields } from '@/lib/errors.js';
import { seed } from '@/db/seed.js';
import { removeStoredFiles } from './attachments.js';
import { getSettings } from './settings.js';

/**
 * The danger zone. Everything goes: the instance ends up exactly where a fresh
 * container starts, at /setup with the default custom-field definitions and
 * nothing else. There is no audit event because there is no log left to hold
 * one — the deletion is the record.
 *
 * Deliberately not `DROP`/recreate: the tables and their migrations stay, so
 * restarting is not part of the procedure.
 */
export async function deleteWorkspace(deps: AppDeps, confirmText: string): Promise<void> {
  const settings = getSettings(deps.db);
  if (confirmText !== settings.orgName) {
    throw invalidFields({
      confirmText: `Type the organization name exactly: ${settings.orgName}`,
    });
  }
  await emptyWorkspace(deps);
}

/**
 * The wipe itself, with no question asked. `deleteWorkspace` is this behind the
 * type-the-name guard; the demo seeder is this behind a `--reset` flag, which
 * is the only other caller that legitimately wants a workspace gone.
 *
 * Never export a route to this directly — the guard is the whole point of the
 * danger zone.
 */
export async function emptyWorkspace(deps: AppDeps): Promise<void> {
  // Read the file names before the rows go, or nothing knows what to unlink.
  const storedNames = deps.db
    .select({ storedName: attachments.storedName })
    .from(attachments)
    .all()
    .map((row) => row.storedName);

  deps.db.transaction((tx) => {
    // Children first, so the wipe never depends on which cascades are enabled.
    tx.delete(notificationLog).run();
    tx.delete(auditEvents).run();
    tx.delete(attachments).run();
    tx.delete(assetCustomValues).run();
    tx.delete(assignments).run();
    tx.delete(assets).run();
    // The workflow goes too, so the seed below lays the default one back down:
    // a workspace that edited its statuses is not what a fresh container has.
    tx.delete(assetStatusTransitions).run();
    tx.delete(assetStatuses).run();
    tx.delete(customFieldDefs).run();
    tx.delete(authTokens).run();
    tx.delete(sessions).run();
    tx.delete(members).run();
    // The roles go with the members that held them, so the seed below lays the
    // default three back down — a workspace that edited its roles is not what a
    // fresh container has either.
    tx.delete(rolePermissions).run();
    tx.delete(roles).run();
    tx.delete(employees).run();
    tx.delete(orgSettings).run();
  });

  await removeStoredFiles(deps, storedNames);
  seed(deps.db);
}
