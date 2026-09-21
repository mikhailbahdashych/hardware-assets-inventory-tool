import type { FastifyRequest } from 'fastify';
import type { AssignInput, CheckinInput } from '@inventory/shared';
import type { SerializedAsset } from '@/lib/serialize.js';
import type { ListQuery } from '@/types/list.js';

/** The asset list's own filters on top of the page: the status pill row. */
export interface AssetListQuery extends ListQuery {
  status?: string;
  /**
   * Only assets whose status the workflow lets a handover start from. The
   * assign modal asks for this because a page of the whole inventory would
   * mostly be assets it may not offer.
   */
  assignable?: boolean;
}

export interface AssetListPage {
  /**
   * The rows behind this page — under `q` **and** the status filter, because
   * this is what the footer names and what the pager divides into pages.
   */
  total: number;
  assets: SerializedAsset[];
  /**
   * How many sit under each status, counted under `q` but **ignoring** the
   * status filter, so switching a pill never moves the other numbers. The
   * "All" pill reads the sum of these rather than `total`, which is narrower.
   * A status nothing is under is absent rather than zero; the page draws its
   * own row of pills from the workflow and reads a miss as the zero it is.
   */
  statusCounts: Record<string, number>;
}

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
