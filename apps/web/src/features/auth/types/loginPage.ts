/**
 * The second step of a sign-in, once the password step has answered with a
 * challenge rather than a session.
 */
export interface MfaChallengeProps {
  challengeToken: string;
  /**
   * Always known: this screen only exists on an instance that has been set up,
   * and routes.tsx has already read /meta to decide that.
   */
  orgName: string;
}
