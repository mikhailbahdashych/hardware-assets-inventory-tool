/**
 * The second step of a sign-in, once the password step has answered with a
 * challenge rather than a session.
 */
export interface MfaChallengeProps {
  challengeToken: string;
  /** Undefined only while `/meta` is in flight; the subtitle says less then. */
  orgName: string | undefined;
}
