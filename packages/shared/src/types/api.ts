// The wire contract both apps speak. Imports here stay relative: this package
// is consumed as raw TypeScript source, so a `@/` would resolve against the
// consumer's alias and break the web build.

/**
 * The body of the one error envelope the API ever sends. `apps/api` builds it
 * in `src/plugins/error-handler.ts`; `apps/web` reads it in `src/api/client.ts`.
 * Both sides import this shape, so neither can drift from the other.
 */
export interface ApiErrorBody {
  /** Machine-readable reason, e.g. `invalid_credentials`, `status_locked`. */
  code: string;
  /** The sentence shown to the person who made the request. */
  message: string;
  /** Per-field messages on a 422; absent on every other status. */
  fields?: Record<string, string>;
}

/** Every non-2xx response carries exactly this: `{ error: { code, message, fields? } }`. */
export interface ApiErrorEnvelope {
  error: ApiErrorBody;
}
