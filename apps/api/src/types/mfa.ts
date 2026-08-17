/** What enrolment hands the browser: enough to scan, and enough to type. */
export interface MfaEnrolment {
  /** Base32, shown so somebody can add the account by hand. */
  secret: string;
  /** The `otpauth://` URI behind the QR code. */
  otpauthUri: string;
}

/**
 * The result of confirming enrolment. The codes are raw and appear exactly
 * once — only their hashes are stored, like every other token in this app.
 */
export interface MfaRecoveryCodes {
  recoveryCodes: string[];
}

/** Where a member stands, as every guard and the web app need to know it. */
export interface MfaStatus {
  /** The workspace demands a second factor of everybody. */
  required: boolean;
  /** This member has confirmed an authenticator. */
  enrolled: boolean;
  /** Required but not enrolled: they may do nothing else until they are. */
  mustEnrol: boolean;
}
