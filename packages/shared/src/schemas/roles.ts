import { z } from 'zod';
import { SEMANTIC_COLORS } from '../enums.js';
import { ACTIONS, MAX_ROLES } from '../rbac.js';
import { slugify } from '../slug.js';
import { nullableText } from './common.js';

// The wire contract for the Roles page. Everything here describes shape only:
// whether a role is the system one, whether it is the one the caller holds,
// whether anybody still has it — all of that is a fact about the rows in the
// database, so it lives in the roles service and answers 409/422 there.

/** A role is created by its label; the slug is derived from it, once. */
export const roleCreateSchema = z.object({
  label: z.string().trim().min(1, 'Give the role a name.').max(40),
  /** The line under the name on the invite card. Blank means there isn't one. */
  description: nullableText(120).default(null),
  color: z.enum(SEMANTIC_COLORS),
});
// Beside its schema, per the convention: the schema is the truth.
export type RoleCreateInput = z.infer<typeof roleCreateSchema>;

/**
 * The id is deliberately absent: it is the slug, and `members.role` carries it.
 * Renaming a role is a label change, never an identity change — and the grant
 * set is not here either, because the matrix saves every role's at once.
 */
export const rolePatchSchema = z
  .object({
    label: z.string().trim().min(1, 'Give the role a name.').max(40),
    description: nullableText(120),
    color: z.enum(SEMANTIC_COLORS),
  })
  .partial();
export type RolePatchInput = z.infer<typeof rolePatchSchema>;

/**
 * The matrix saves every grant, because that is what a grid of checkboxes
 * naturally holds, and it makes the operation idempotent. The cap is the
 * matrix's own ceiling — ten roles over nineteen actions is 190 cells, so 400
 * is generous and still bounded.
 */
export const permissionsPutSchema = z.object({
  grants: z.array(z.object({ role: z.string().min(1), action: z.enum(ACTIONS) })).max(400),
});
export type PermissionsPutInput = z.infer<typeof permissionsPutSchema>;

/** Reordering sends every id; the service checks it really is a permutation. */
export const roleOrderSchema = z.object({
  order: z.array(z.string().min(1)).min(1).max(MAX_ROLES),
});
export type RoleOrderInput = z.infer<typeof roleOrderSchema>;

/**
 * "Read only" → "read_only". A role's permanent id, so renaming it never
 * touches the `members.role` values pointing at it. Shares its derivation with
 * `statusSlug`; the form shows what the id will be before the row exists.
 */
export function roleSlug(label: string): string {
  return slugify(label);
}
