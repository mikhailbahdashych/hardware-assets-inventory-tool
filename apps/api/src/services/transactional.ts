import type { FastifyBaseLogger } from 'fastify';
import type { AppDeps } from '@/types/app.js';
import type { MailContent } from '@/types/mail.js';
import type { AssignmentMail, CheckinMail, InviteMail } from '@/types/mail-templates.js';
import {
  assignmentEmail,
  checkinEmail,
  inviteEmail,
  passwordResetEmail,
} from './mail-templates.js';
import { getSettings } from './settings.js';

/**
 * Mail somebody asked for by doing something: an invitation, a reset link, a
 * notification on an assignment. Unlike the scheduled jobs these are not
 * deduped — they cannot repeat, because a person pressing a button is what
 * causes them.
 *
 * **Delivery never fails a request.** The invitation and reset flows put the
 * link in the response precisely so an instance with no SMTP still works; a
 * broken relay is the same situation with a worse mood. The send is attempted,
 * a failure is logged, and the operation that triggered it still succeeded —
 * because it did.
 */
async function deliver(
  deps: AppDeps,
  log: FastifyBaseLogger,
  to: string,
  content: MailContent,
): Promise<void> {
  if (!deps.mailer) return;
  try {
    await deps.mailer.send({ to, ...content });
  } catch (error) {
    log.warn({ err: error, to, subject: content.subject }, 'could not send mail');
  }
}

/** Gated by the workspace's invite-email switch as well as by SMTP existing. */
export async function sendInviteMail(
  deps: AppDeps,
  log: FastifyBaseLogger,
  input: { to: string } & Omit<InviteMail, 'orgName'>,
): Promise<void> {
  const settings = getSettings(deps.db);
  if (!settings.emailInvites) return;
  await deliver(deps, log, input.to, inviteEmail({ ...input, orgName: settings.orgName }));
}

/**
 * A reset link an admin issued. Deliberately **not** gated by a settings
 * toggle: there is no switch for it, because handing somebody back their own
 * account is not a notification a workspace turns off.
 */
export async function sendResetMail(
  deps: AppDeps,
  log: FastifyBaseLogger,
  input: { to: string; url: string },
): Promise<void> {
  const settings = getSettings(deps.db);
  await deliver(
    deps,
    log,
    input.to,
    passwordResetEmail({ orgName: settings.orgName, url: input.url }),
  );
}

/** Only when the person handing the asset over ticked the box. */
export async function sendAssignmentMail(
  deps: AppDeps,
  log: FastifyBaseLogger,
  input: { to: string } & Omit<AssignmentMail, 'orgName'>,
): Promise<void> {
  const settings = getSettings(deps.db);
  await deliver(deps, log, input.to, assignmentEmail({ ...input, orgName: settings.orgName }));
}

export async function sendCheckinMail(
  deps: AppDeps,
  log: FastifyBaseLogger,
  input: { to: string } & Omit<CheckinMail, 'orgName'>,
): Promise<void> {
  const settings = getSettings(deps.db);
  await deliver(deps, log, input.to, checkinEmail({ ...input, orgName: settings.orgName }));
}
