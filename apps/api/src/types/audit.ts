import type { AuditParams, AuditType } from '@inventory/shared';

/** Who a mutation is attributed to in the audit log. */
export interface Actor {
  /**
   * Null because **an API token is an actor with no member row**: a mutation
   * through the public surface is attributed to the token's name, and
   * `audit_events.actor_member_id` has always been nullable for exactly that
   * kind of flow. Every self-check (`id === actor.id`) is therefore null-safe
   * by inequality, and `assertAdminActor` reads a null id as not-an-admin —
   * which is the right answer, since no token may reach a member account.
   */
  id: string | null;
  displayName: string;
  /**
   * Set exactly when this actor is an API token, and then `id` is null — the
   * two are the same fact from both sides. Optional rather than required
   * because every member-shaped actor in the app is a `MemberRow`, which has no
   * such field and must stay assignable here without gaining one.
   */
  apiTokenId?: string;
}

/**
 * Who an audit row is attributed to. A member and a token each carry the id
 * the row points at and the name it snapshots; only an entry with no actor at
 * all is the system's. A variant rather than three optional fields, because
 * those let a member id arrive with no name and be stored as "system" under
 * the kind "member". `auditActor` in `services/audit.ts` builds the first two
 * from a service's `Actor`.
 */
export type AuditActor =
  | { kind: 'member'; id: string; name: string }
  | { kind: 'token'; id: string; name: string }
  | { kind: 'system' };

/**
 * One audit row as its caller describes it. The optional subject ids are the
 * columns the event may hang off; `params` is the structured payload the
 * shared renderer turns into a sentence.
 */
export interface AuditEntry {
  type: AuditType;
  action: string;
  actor: AuditActor;
  assetId?: string | null;
  employeeId?: string | null;
  memberId?: string | null;
  params?: AuditParams;
}
