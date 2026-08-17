import { ApiError } from './client';

/**
 * Field-level messages from a 422 validation response, keyed by field name.
 *
 * `fields` is absent on every status but 422, so "no field errors" is the
 * honest reading of an absent one — the empty object is the answer, not a
 * stand-in for one.
 */
export function fieldErrors(error: unknown): Record<string, string> {
  return error instanceof ApiError ? (error.fields ?? {}) : {};
}
