import { ApiError } from './client';

/** Field-level messages from a 422 validation response, keyed by field name. */
export function fieldErrors(error: unknown): Record<string, string> {
  return error instanceof ApiError ? (error.fields ?? {}) : {};
}
