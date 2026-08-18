import type { Actor } from '@/types/audit.js';
import type { roles } from '@/db/schema.js';

/**
 * One role row. Named here rather than beside the query because the members
 * service reads it too — an invitation and a role change both have to ask
 * whether the role they name still exists.
 */
export type RoleRow = typeof roles.$inferSelect;

/**
 * An actor the roles service can answer "is this your own role?" about. Every
 * caller already has it: `request.member` carries `role`, and the guard that
 * closes quiet self-promotion needs to compare against something.
 */
export interface RoleActor extends Actor {
  role: string;
}
