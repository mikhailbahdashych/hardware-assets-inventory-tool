/** One message, already rendered. Templates produce these; the mailer sends them. */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * How this instance sends mail — or `null` on `AppDeps`, which is what an
 * instance with no SMTP looks like. It is null rather than a no-op object on
 * purpose: the compiler then makes every call site say what it does without
 * email, and invitations and resets are copyable links precisely so they can.
 */
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** A rendered template, before it knows who it is going to. */
export interface MailContent {
  subject: string;
  text: string;
  html: string;
}

/**
 * What kind of notification a row in `notification_log` records. The dedupe key
 * is what actually prevents a repeat; this is for reading the table later.
 */
export type NotificationKind =
  | 'invite'
  | 'password_reset'
  | 'assignment'
  | 'checkin'
  | 'warranty'
  | 'return_reminder'
  | 'weekly_digest';

/** One thing to send at most once, whatever happens to the process meanwhile. */
export interface Notification {
  kind: NotificationKind;
  /**
   * What "the same notification" means, e.g. `warranty:{assetId}:{date}`.
   * Changing the warranty date changes the key, which re-arms the alert.
   */
  dedupeKey: string;
  to: string;
  content: MailContent;
}
