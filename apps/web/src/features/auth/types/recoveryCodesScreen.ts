export interface RecoveryCodesScreenProps {
  /** The ten raw codes, from the one response that will ever carry them. */
  codes: string[];
  /**
   * Why they are on screen, when that is not obvious. Enrolment needs no
   * explanation — the member just asked for an authenticator — but a set that
   * arrives mid sign-in does, because nobody asked for it.
   */
  reason?: string;
  /** What "I have kept them" means here: the app, one way or another. */
  onDone: () => void;
}
