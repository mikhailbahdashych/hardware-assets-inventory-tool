import { describe, expect, it } from 'vitest';
import {
  assignmentEmail,
  checkinEmail,
  inviteEmail,
  passwordResetEmail,
  returnReminderEmail,
  warrantyAlertEmail,
  weeklyDigestEmail,
} from './mail-templates.js';
import type { MailContent } from '@/types/mail.js';

const ORG = 'Acme Corp';
const URL = 'https://inventory.acme.io/assets/asset-1';

const ALL: [string, MailContent][] = [
  [
    'invite',
    inviteEmail({
      orgName: ORG,
      inviterName: 'Tomasz Kowalski',
      role: 'manager',
      url: 'https://inventory.acme.io/accept-invite?token=abc',
    }),
  ],
  [
    'password reset',
    passwordResetEmail({ orgName: ORG, url: 'https://inventory.acme.io/reset-password?token=abc' }),
  ],
  [
    'assignment',
    assignmentEmail({
      orgName: ORG,
      assetName: 'MacBook Pro 14"',
      assetTag: 'AST-0142',
      checkedOutAt: '2026-03-14',
      expectedReturnDate: null,
      url: URL,
    }),
  ],
  [
    'check-in',
    checkinEmail({
      orgName: ORG,
      assetName: 'MacBook Pro 14"',
      assetTag: 'AST-0142',
      returnedAt: '2026-07-01',
    }),
  ],
  [
    'warranty alert',
    warrantyAlertEmail({
      orgName: ORG,
      assets: [
        {
          name: 'MacBook Pro 14"',
          assetTag: 'AST-0142',
          warrantyUntil: '2026-09-12',
          daysLeft: 26,
        },
      ],
      url: URL,
    }),
  ],
  [
    'return reminder',
    returnReminderEmail({
      orgName: ORG,
      holderName: 'Maya Lindqvist',
      assets: [{ name: 'MacBook Pro 14"', assetTag: 'AST-0142', expectedReturnDate: '2026-08-24' }],
      url: URL,
    }),
  ],
  [
    'weekly digest',
    weeklyDigestEmail({
      orgName: ORG,
      assetCount: 13,
      assignedCount: 6,
      availableCount: 4,
      recentActivity: ['Assigned MacBook Pro 14" to Maya Lindqvist'],
      url: URL,
    }),
  ],
];

describe('every template', () => {
  it.each(ALL)('%s has a subject and both bodies', (_name, content) => {
    expect(content.subject.length).toBeGreaterThan(0);
    expect(content.text.trim().length).toBeGreaterThan(0);
    expect(content.html).toContain('<div');
  });

  it.each(ALL)('%s leaves no placeholder unfilled', (_name, content) => {
    // The templates are template literals, so an unfilled slot shows up as one
    // of these rather than as a blank nobody notices.
    for (const body of [content.subject, content.text, content.html]) {
      expect(body).not.toContain('undefined');
      expect(body).not.toContain('null');
      expect(body).not.toContain('[object Object]');
      expect(body).not.toContain('${');
    }
  });

  it.each(ALL)('%s says which workspace it is from', (_name, content) => {
    expect(`${content.subject} ${content.text}`).toContain(ORG);
  });
});

describe('the links', () => {
  it('are readable in the plain-text half, where nothing is clickable', () => {
    const invite = inviteEmail({
      orgName: ORG,
      inviterName: 'Tomasz Kowalski',
      role: 'admin',
      url: 'https://inventory.acme.io/accept-invite?token=abc',
    });
    expect(invite.text).toContain('https://inventory.acme.io/accept-invite?token=abc');
    expect(invite.html).toContain('href="https://inventory.acme.io/accept-invite?token=abc"');
  });
});

describe('what each one actually says', () => {
  it('names the role an invitation grants, in the words the UI uses', () => {
    const invite = inviteEmail({
      orgName: ORG,
      inviterName: 'Tomasz Kowalski',
      role: 'manager',
      url: 'https://x',
    });
    expect(invite.text).toContain('as a Manager');
    expect(invite.text).toContain('Tomasz Kowalski');
  });

  it('says when there is no return date rather than leaving a gap', () => {
    const withDate = assignmentEmail({
      orgName: ORG,
      assetName: 'MacBook Pro 14"',
      assetTag: 'AST-0142',
      checkedOutAt: '2026-03-14',
      expectedReturnDate: '2026-09-01',
      url: URL,
    });
    expect(withDate.text).toContain('due back on 2026-09-01');

    const without = assignmentEmail({
      orgName: ORG,
      assetName: 'MacBook Pro 14"',
      assetTag: 'AST-0142',
      checkedOutAt: '2026-03-14',
      expectedReturnDate: null,
      url: URL,
    });
    expect(without.text).toContain('no return date set');
  });

  it('counts devices, singular and plural, in a warranty alert', () => {
    const one = warrantyAlertEmail({
      orgName: ORG,
      assets: [{ name: 'A', assetTag: 'AST-1', warrantyUntil: '2026-09-12', daysLeft: 1 }],
      url: URL,
    });
    expect(one.subject).toBe('Warranty ending: 1 device');
    expect(one.text).toContain('1 day left');

    const two = warrantyAlertEmail({
      orgName: ORG,
      assets: [
        { name: 'A', assetTag: 'AST-1', warrantyUntil: '2026-09-12', daysLeft: 26 },
        { name: 'B', assetTag: 'AST-2', warrantyUntil: '2026-09-20', daysLeft: 34 },
      ],
      url: URL,
    });
    expect(two.subject).toBe('Warranty ending: 2 devices');
    expect(two.text).toContain('26 days left');
  });

  it('has something to say in a digest of a quiet week', () => {
    const quiet = weeklyDigestEmail({
      orgName: ORG,
      assetCount: 13,
      assignedCount: 6,
      availableCount: 4,
      recentActivity: [],
      url: URL,
    });
    expect(quiet.text).toContain('Nothing changed in the inventory this week');
  });
});
