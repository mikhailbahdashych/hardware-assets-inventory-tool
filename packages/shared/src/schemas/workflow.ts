import { z } from 'zod';
import { MAX_ASSET_STATUSES, SEMANTIC_COLORS } from '../enums.js';

// The wire contract for the Workflow page. Everything here describes shape
// only: whether a status may be deleted, whether an edge may touch `assigned`,
// whether an id list is a permutation — all of that is a fact about the rows in
// the database, so it lives in the workflow service and answers 409/422 there.

/** A status is created by its label; the slug is derived from it, once. */
export const statusCreateSchema = z.object({
  label: z.string().trim().min(1, 'Give the status a name.').max(40),
  color: z.enum(SEMANTIC_COLORS),
  assignableFrom: z.boolean().default(false),
  checkinTarget: z.boolean().default(false),
});
// Beside its schema, per the convention: the schema is the truth.
export type StatusCreateInput = z.infer<typeof statusCreateSchema>;

/**
 * The id is deliberately absent: it is the slug, and stored asset rows carry
 * it. Renaming a status is a label change, never an identity change.
 */
export const statusPatchSchema = z
  .object({
    label: z.string().trim().min(1, 'Give the status a name.').max(40),
    color: z.enum(SEMANTIC_COLORS),
    assignableFrom: z.boolean(),
    checkinTarget: z.boolean(),
  })
  .partial();
export type StatusPatchInput = z.infer<typeof statusPatchSchema>;

/**
 * The matrix saves the whole graph, because that is what a grid of checkboxes
 * naturally holds. The cap is the matrix's own ceiling — 20 statuses can only
 * describe 20×19 = 380 edges, so 400 is generous and still bounded.
 */
export const transitionsPutSchema = z.object({
  transitions: z.array(z.object({ from: z.string().min(1), to: z.string().min(1) })).max(400),
});
export type TransitionsPutInput = z.infer<typeof transitionsPutSchema>;

/** Reordering sends every id; the service checks it really is a permutation. */
export const statusOrderSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(MAX_ASSET_STATUSES),
});
export type StatusOrderInput = z.infer<typeof statusOrderSchema>;

/**
 * "On loan!" → "on_loan". The same shape as a custom field's key, and for the
 * same reason: it is what asset rows, CSV cells and URLs carry, so it may only
 * contain characters all three can hold. An empty result means the label was
 * unusable — the caller turns that into a 422 naming the label.
 */
export function statusSlug(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
