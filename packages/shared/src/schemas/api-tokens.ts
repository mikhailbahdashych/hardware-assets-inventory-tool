import { z } from 'zod';
import { API_SCOPES, TOKEN_TTL_OPTIONS } from '../enums.js';

// The wire contract for the token management API. Shape only: whether the
// caller is an admin, and whether a token still exists to revoke, are facts
// about the request and the rows — they answer 403/404 in the API.

export const apiTokenCreateSchema = z.object({
  /** What the token is for, as the person creating it would say it. */
  name: z.string().trim().min(1, 'Give the token a name.').max(100),
  /**
   * Deduped rather than refused: the grid a person ticks cannot check a box
   * twice, and a client that repeats a scope is asking for the same reach
   * either way. Deduping also bounds what is stored at the eight that exist.
   */
  scopes: z
    .array(z.enum(API_SCOPES))
    .min(1, 'Choose at least one scope — a token that may do nothing has no purpose.')
    .transform((scopes) => [...new Set(scopes)]),
  /** Required, because `null` is the "Unlimited" a person picked, not an absence. */
  expiresInDays: z.union(TOKEN_TTL_OPTIONS.map((days) => z.literal(days))),
});
// Beside its schema, per the convention: the schema is the truth.
export type ApiTokenCreateInput = z.infer<typeof apiTokenCreateSchema>;
