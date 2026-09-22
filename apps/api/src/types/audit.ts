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
 * One audit row as its caller describes it. The optional subject ids are the
 * columns the event may hang off; `params` is the structured payload the
 * shared renderer turns into a sentence.
 */
export interface AuditEntry {
  type: AuditType;
  action: string;
  /** null for anonymous flows; `actorName` then reads 'system'. */
  actorMemberId?: string | null;
  /**
   * The API token behind the mutation, on the public surface only. **A service
   * a public route can reach must pass `actor.apiTokenId` here** — `writeAudit`
   * derives `actorKind` from it, so a service that drops it writes a row
   * carrying the token's name attributed to nobody, which reads as `system`.
   * The assets, employees and assignments services are the ones that can be
   * reached today, and `test/public-api.test.ts` sweeps every mutating public
   * route to hold them to it.
   */
  actorApiTokenId?: string | null;
  actorName?: string;
  assetId?: string | null;
  employeeId?: string | null;
  memberId?: string | null;
  params?: AuditParams;
}
