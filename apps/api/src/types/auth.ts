/**
 * What a row in `auth_tokens` is for. The purpose decides the token's lifetime
 * and which unconsumed token a new one retires, so a reset link never quietly
 * cancels an outstanding invitation.
 */
export type TokenPurpose = 'invite' | 'password_reset' | 'mfa_challenge';
