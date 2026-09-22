import type { AppDeps } from '@/types/app.js';
import {
  apiTokens,
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
  mfaRecoveryCodes,
  notifications,
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
  const settings = await getSettings(deps.db);
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
  const storedNames = (
    await deps.db.select({ storedName: attachments.storedName }).from(attachments)
  ).map((row) => row.storedName);

  await deps.db.transaction(async (tx) => {
    // Children first, so the wipe never depends on which cascades are enabled.
    await tx.delete(notifications);
    await tx.delete(auditEvents);
    await tx.delete(attachments);
    await tx.delete(assetCustomValues);
    await tx.delete(assignments);
    await tx.delete(assets);
    // The workflow goes too, so the seed below lays the default one back down:
    // a workspace that edited its statuses is not what a fresh container has.
    await tx.delete(assetStatusTransitions);
    await tx.delete(assetStatuses);
    await tx.delete(customFieldDefs);
    await tx.delete(authTokens);
    // A credential for a workspace that no longer exists must die with it.
    // Nothing recalls the raw value once it is minted — deleting the row is the
    // only revocation there is — so a token left behind would go on opening the
    // public surface onto whatever the next workspace puts in these tables.
    // After `audit_events`, which points at it, and before `members`, which it
    // points at: the children-first rule reads in both directions.
    await tx.delete(apiTokens);
    await tx.delete(sessions);
    // Cascades from `members` below, so this line changes nothing today — it is
    // here because the rule at the top of this block is "never depend on which
    // cascades are enabled", and a hashed one-time password is the last row to
    // make an exception for.
    await tx.delete(mfaRecoveryCodes);
    await tx.delete(members);
    // The roles go with the members that held them, so the seed below lays the
    // default three back down — a workspace that edited its roles is not what a
    // fresh container has either.
    await tx.delete(rolePermissions);
    await tx.delete(roles);
    await tx.delete(employees);
    await tx.delete(orgSettings);
  });

  await removeStoredFiles(deps, storedNames);
  await seed(deps.db);
}
