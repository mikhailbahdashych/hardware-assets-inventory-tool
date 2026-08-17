import { ROLE_LABELS, type Role } from '@inventory/shared';
import type { MailContent } from '@/types/mail.js';
import type {
  AssignmentMail,
  CheckinMail,
  DigestMail,
  InviteMail,
  ResetMail,
  ReturnReminderMail,
  WarrantyAlertMail,
} from '@/types/mail-templates.js';

// Every message this app sends, as pure functions. Plain-text first — that is
// the version that always arrives readable — with an HTML twin that carries the
// same words and nothing an email client has to guess at.
//
// The design's tokens do not survive an email client, so these use literal
// colours close to them. That is the one place in this repo where a colour is
// written out rather than referenced.

const INK = '#18181b';
const MUTED = '#71717a';
const ACCENT = '#6d5ae0';
const BORDER = '#e4e4e7';

/** The shell every message shares: org name, body, and a quiet footer. */
function layout(orgName: string, body: string): string {
  return [
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${INK};font-size:14px;line-height:1.55;max-width:520px">`,
    `<div style="font-weight:600;font-size:15px;padding-bottom:12px;border-bottom:1px solid ${BORDER}">${orgName} · Inventory</div>`,
    `<div style="padding:16px 0">${body}</div>`,
    `<div style="padding-top:12px;border-top:1px solid ${BORDER};color:${MUTED};font-size:12px">Sent by Inventory, your team's hardware asset tracker.</div>`,
    `</div>`,
  ].join('');
}

const button = (url: string, label: string): string =>
  `<p><a href="${url}" style="display:inline-block;background:${ACCENT};color:#fff;text-decoration:none;padding:9px 16px;border-radius:6px;font-weight:600">${label}</a></p>`;

const para = (text: string): string => `<p style="margin:0 0 12px">${text}</p>`;

const list = (items: string[]): string =>
  `<ul style="margin:0 0 12px;padding-left:18px">${items.map((item) => `<li style="margin-bottom:4px">${item}</li>`).join('')}</ul>`;

/** The URL again as text, because a plain-text reader cannot click a button. */
const linkLine = (url: string): string => `\n${url}\n`;

export function inviteEmail(input: InviteMail): MailContent {
  const role = ROLE_LABELS[input.role as Role] ?? input.role;
  const intro = `${input.inviterName} invited you to ${input.orgName}'s hardware inventory as a ${role}.`;
  return {
    subject: `Join ${input.orgName} on Inventory`,
    text: `${intro}\n\nSet your password and join:${linkLine(input.url)}\nThe link expires in seven days.`,
    html: layout(
      input.orgName,
      para(intro) +
        button(input.url, 'Join the workspace') +
        para('The link expires in seven days.'),
    ),
  };
}

export function passwordResetEmail(input: ResetMail): MailContent {
  const intro = `Someone asked to reset the password for your ${input.orgName} Inventory account.`;
  return {
    subject: `Reset your ${input.orgName} Inventory password`,
    text: `${intro}\n\nChoose a new password:${linkLine(input.url)}\nThe link expires in an hour. If this was not you, nothing has changed.`,
    html: layout(
      input.orgName,
      para(intro) +
        button(input.url, 'Choose a new password') +
        para('The link expires in an hour. If this was not you, nothing has changed.'),
    ),
  };
}

export function assignmentEmail(input: AssignmentMail): MailContent {
  const due = input.expectedReturnDate
    ? ` It is due back on ${input.expectedReturnDate}.`
    : ' There is no return date set.';
  const intro = `${input.assetName} (${input.assetTag}) is now assigned to you at ${input.orgName}, as of ${input.checkedOutAt}.${due}`;
  return {
    subject: `${input.assetName} is assigned to you`,
    text: `${intro}\n\nSee it in the inventory:${linkLine(input.url)}`,
    html: layout(input.orgName, para(intro) + button(input.url, 'View the asset')),
  };
}

export function checkinEmail(input: CheckinMail): MailContent {
  const intro = `${input.assetName} (${input.assetTag}) was checked back in at ${input.orgName} on ${input.returnedAt}. Nothing is outstanding on it for you.`;
  return {
    subject: `${input.assetName} checked in`,
    text: `${intro}\n`,
    html: layout(input.orgName, para(intro)),
  };
}

export function warrantyAlertEmail(input: WarrantyAlertMail): MailContent {
  const count = input.assets.length;
  const intro = `${count} ${count === 1 ? 'device' : 'devices'} in the ${input.orgName} inventory ${count === 1 ? 'is' : 'are'} coming out of warranty.`;
  const lines = input.assets.map(
    (asset) =>
      `${asset.name} (${asset.assetTag}) — ${asset.warrantyUntil}, ${asset.daysLeft} ${asset.daysLeft === 1 ? 'day' : 'days'} left`,
  );
  return {
    subject: `Warranty ending: ${count} ${count === 1 ? 'device' : 'devices'}`,
    text: `${intro}\n\n${lines.map((line) => `· ${line}`).join('\n')}\n\nOpen the inventory:${linkLine(input.url)}`,
    html: layout(
      input.orgName,
      para(intro) + list(lines) + button(input.url, 'Open the inventory'),
    ),
  };
}

export function returnReminderEmail(input: ReturnReminderMail): MailContent {
  const count = input.assets.length;
  const intro = `Hi ${input.holderName} — ${count === 1 ? 'an item is' : `${count} items are`} due back to ${input.orgName}.`;
  const lines = input.assets.map(
    (asset) => `${asset.name} (${asset.assetTag}) — due ${asset.expectedReturnDate}`,
  );
  return {
    subject: `Please return ${count === 1 ? 'your device' : `${count} devices`}`,
    text: `${intro}\n\n${lines.map((line) => `· ${line}`).join('\n')}\n\nYour IT team can take them back any time.`,
    html: layout(
      input.orgName,
      para(intro) + list(lines) + para('Your IT team can take them back any time.'),
    ),
  };
}

export function weeklyDigestEmail(input: DigestMail): MailContent {
  const headline = `${input.assetCount} assets tracked · ${input.assignedCount} out with people · ${input.availableCount} in stock.`;
  const events =
    input.recentActivity.length > 0
      ? input.recentActivity
      : ['Nothing changed in the inventory this week.'];
  return {
    subject: `${input.orgName} Inventory · this week`,
    text: `${headline}\n\n${events.map((line) => `· ${line}`).join('\n')}\n\nOpen the dashboard:${linkLine(input.url)}`,
    html: layout(
      input.orgName,
      para(headline) + list(events) + button(input.url, 'Open the dashboard'),
    ),
  };
}
