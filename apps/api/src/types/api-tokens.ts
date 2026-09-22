import type { ApiScope } from '@inventory/shared';

/**
 * One token as every reader sees it. The hash is not here and never will be:
 * the row exists to say a credential was issued, not to hand it back.
 */
export interface ApiTokenSummary {
  id: string;
  name: string;
  scopes: ApiScope[];
  /** Null is the "Unlimited" an admin picked, not an expiry nobody set. */
  expiresAt: string | null;
  createdByName: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** The create response: the raw token, once, beside the row it belongs to. */
export interface MintedApiToken {
  token: string;
  apiToken: ApiTokenSummary;
}

/**
 * A raw token that checked out, as the Bearer guard will carry it. Narrower
 * than the summary on purpose — what a request needs to know is who is calling
 * and what they may reach.
 */
export interface ResolvedApiToken {
  id: string;
  name: string;
  scopes: ApiScope[];
}
