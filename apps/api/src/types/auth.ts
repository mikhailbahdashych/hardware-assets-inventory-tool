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
