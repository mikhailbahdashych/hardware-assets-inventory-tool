import type { MemberRow } from '@/types/members.js';

/**
 * What a row in `auth_tokens` is for. The purpose decides the token's lifetime
 * and which unconsumed token a new one retires, so a reset link never quietly
 * cancels an outstanding invitation.
 */
export type TokenPurpose = 'invite' | 'password_reset' | 'mfa_challenge';

/**
 * What a sign-in step answers instead of a session when the member holds an
 * authenticator: the proof so far was half of it, and `POST /auth/mfa/verify`
 * with this token and a code is the other half.
 */
export interface MfaChallengeResponse {
  mfaRequired: true;
  challengeToken: string;
}

/** How many of something one key may spend, and over how long. */
export interface RateWindow {
  max: number;
  /** Milliseconds. */
  timeWindow: number;
}

/**
 * A budget of failures per key. `charge` spends one up front and throws 429
 * when none is left; `refund` gives it back once the attempt turns out to have
 * succeeded. Charging first is what keeps a burst of parallel guesses inside
 * the budget — counting only after the answer would let every one of them read
 * an empty bucket.
 */
export interface FailureLimit {
  charge: (key: string) => void;
  refund: (key: string) => void;
}

/**
 * A session cookie that checked out. `slidTo` is the new expiry when this
 * request slid it, and null when it did not: the database row and the browser's
 * cookie both have to move, and only the session hook can reach the second.
 */
export interface ResolvedSession {
  member: MemberRow;
  slidTo: string | null;
}
