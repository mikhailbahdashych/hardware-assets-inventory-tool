import type { FastifyRequest } from 'fastify';
import type { AssignInput, CheckinInput } from '@inventory/shared';

/**
 * An audited status move, recorded on its own as `asset.status_changed`. Both
 * ends are the statuses' **labels** as they read when the move happened — a
 * snapshot, so renaming or deleting a status never rewrites the log.
 */
export interface StatusMove {
  from: string;
  to: string;
}

/** Every per-asset route is addressed the same way, so the shape is named once. */
export interface AssetIdParams {
  id: string;
}

// The two ownership routes' requests, named so their helpers can take them —
// handing an asset over and taking it back are operations, not edits, and each
// one does work after the transaction that a route handler should not inline.

export type AssignRequest = FastifyRequest<{ Params: AssetIdParams; Body: AssignInput }>;

export type CheckinRequest = FastifyRequest<{ Params: AssetIdParams; Body: CheckinInput }>;
