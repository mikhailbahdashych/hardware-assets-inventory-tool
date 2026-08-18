import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_MEMBER,
  ADMIN_ROUTES,
  AUDITOR_ROLE,
  INVITED_SUMMARY,
  LINKED_SUMMARY,
  MAYA,
  NO_SMTP_META,
  ROLES,
} from '@/test/api-stub';
import { renderApp, resetAppState } from '@/test/render';
import { choose } from '@/test/dropdown';

const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetAppState();
});

/** The row for one member, found by email — the one cell that is never shared. */
async function memberRow(email: string) {
  const cell = await screen.findByText(email);
  return cell.closest('[role="row"]') as HTMLElement;
}

describe('the members list', () => {
  it('shows who can sign in, their role, link and status', async () => {
    renderApp(ADMIN_ROUTES, '/members');

    const row = await memberRow('maya.lindqvist@acme.io');
    expect(within(row).getByText('Viewer')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'Maya Lindqvist' })).toHaveAttribute(
      'href',
      '/employees/emp-1',
    );
    expect(within(row).getByText('Active')).toBeInTheDocument();

    const invited = await memberRow('grace@acme.io');
    expect(within(invited).getByText('Invited')).toBeInTheDocument();
    expect(within(invited).getByText('Manager')).toBeInTheDocument();
    // No employee link and no last-active time: two em dashes, both meant.
    expect(within(invited).getAllByText('—')).toHaveLength(2);
  });

  it('explains the difference from employees, and links there', async () => {
    renderApp(ADMIN_ROUTES, '/members');
    const summary = await screen.findByText(/people who can sign in to this app/i);
    expect(within(summary).getByRole('link', { name: 'Employees' })).toHaveAttribute(
      'href',
      '/employees',
    );
  });

  it('counts the members and names the workspace’s roles in the footer', async () => {
    renderApp(ADMIN_ROUTES, '/members');
    expect(await screen.findByText(/^3 members · roles:/)).toHaveTextContent(
      'roles: Admin, Manager, Viewer',
    );
  });

  it('draws a role the workspace invented, in the words and colour it chose', async () => {
    renderApp(
      {
        ...ADMIN_ROUTES,
        'GET /roles': { body: { roles: [...ROLES.roles, AUDITOR_ROLE] } },
        'GET /members': {
          body: { members: [{ ...LINKED_SUMMARY, role: 'auditor' }] },
        },
      },
      '/members',
    );

    const row = await memberRow('maya.lindqvist@acme.io');
    expect(within(row).getByText('Auditor')).toHaveAttribute('data-sv', 'warn');
  });

  it('renders a role nobody has any more as the id the account still carries', async () => {
    renderApp(
      {
        ...ADMIN_ROUTES,
        'GET /members': { body: { members: [{ ...LINKED_SUMMARY, role: 'auditor' }] } },
      },
      '/members',
    );

    // Historical data: the role was deleted while this page was open. Showing
    // the slug is uglier than showing nothing, and far more useful.
    const row = await memberRow('maya.lindqvist@acme.io');
    expect(within(row).getByText('auditor')).toHaveAttribute('data-sv', 'neut');
  });

  it('offers no invite or row actions to a role that cannot manage members', async () => {
    renderApp(
      {
        ...ADMIN_ROUTES,
        'GET /auth/me': { body: { member: { ...ADMIN_MEMBER, role: 'viewer' } } },
      },
      '/members',
    );
    await screen.findByRole('heading', { name: 'Members' });
    expect(screen.queryByRole('button', { name: /invite member/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /actions for/i })).toBeNull();
  });
});

describe('inviting a member', () => {
  it('sends the form the design draws, then hands back a copyable link', async () => {
    const api = renderApp(
      {
        ...ADMIN_ROUTES,
        'POST /members/invites': {
          body: {
            member: INVITED_SUMMARY,
            inviteUrl: 'http://localhost:3000/accept-invite?token=abc123',
          },
        },
      },
      '/members',
    );

    await userEvent.click(await screen.findByRole('button', { name: /invite member/i }));
    await userEvent.type(screen.getByLabelText('Email', { exact: true }), 'grace@acme.io');
    await choose(screen, /link to employee/i, MAYA.displayName);
    await userEvent.click(screen.getByRole('radio', { name: /manager/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Send invite' }));

    await waitFor(() => expect(api.called('POST /members/invites')).toBeDefined());
    expect(api.called('POST /members/invites')!.body).toEqual({
      email: 'grace@acme.io',
      role: 'manager',
      employeeId: 'emp-1',
      sendEmail: true,
    });

    // Without SMTP the link is the whole delivery mechanism, so it is shown
    // as text as well as copied — a clipboard can fail, a readable field cannot.
    const link = await screen.findByLabelText('Invitation link');
    expect(link).toHaveValue('http://localhost:3000/accept-invite?token=abc123');
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('http://localhost:3000/accept-invite?token=abc123');
  });

  it('cannot offer to email the invitation on an instance with no SMTP', async () => {
    renderApp({ ...ADMIN_ROUTES, 'GET /meta': { body: NO_SMTP_META } }, '/members');

    await userEvent.click(await screen.findByRole('button', { name: /invite member/i }));
    const checkbox = screen.getByRole('checkbox', { name: /send invitation email now/i });
    expect(checkbox).toBeDisabled();
    expect(checkbox).not.toBeChecked();
    expect(screen.getByText(/No SMTP is configured/)).toBeInTheDocument();
  });

  it('offers every role the workspace has, with the words it gave them', async () => {
    renderApp(
      { ...ADMIN_ROUTES, 'GET /roles': { body: { roles: [...ROLES.roles, AUDITOR_ROLE] } } },
      '/members',
    );

    await userEvent.click(await screen.findByRole('button', { name: /invite member/i }));
    const auditor = await screen.findByRole('radio', { name: /auditor/i });
    expect(auditor).toBeInTheDocument();
    expect(screen.getByText('Reads the books: activity log and exports')).toBeInTheDocument();
  });

  it('starts on the role that grants the least, whatever it is called', async () => {
    renderApp(
      { ...ADMIN_ROUTES, 'GET /roles': { body: { roles: [...ROLES.roles, AUDITOR_ROLE] } } },
      '/members',
    );
    await userEvent.click(await screen.findByRole('button', { name: /invite member/i }));

    // Viewer grants nothing at all; Auditor, added last, grants two actions.
    // A default of "the last row" would quietly hand out the wrong one.
    expect(await screen.findByRole('radio', { name: /viewer/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /auditor/i })).not.toBeChecked();
  });

  it('shows the server message when the email already signs in', async () => {
    renderApp(
      {
        ...ADMIN_ROUTES,
        'POST /members/invites': {
          status: 422,
          body: {
            error: {
              code: 'validation',
              message: 'Please correct the highlighted fields.',
              fields: { email: 'Someone already signs in with that email address.' },
            },
          },
        },
      },
      '/members',
    );

    await userEvent.click(await screen.findByRole('button', { name: /invite member/i }));
    await userEvent.type(screen.getByLabelText('Email', { exact: true }), 'tomasz@acme.io');
    await userEvent.click(screen.getByRole('button', { name: 'Send invite' }));

    expect(
      await screen.findByText('Someone already signs in with that email address.'),
    ).toBeInTheDocument();
  });
});

describe('the row actions', () => {
  async function openMenu(email: string) {
    const row = await memberRow(email);
    await userEvent.click(within(row).getByRole('button', { name: /actions for/i }));
  }

  it('offers a fresh invitation to someone who has not joined', async () => {
    const api = renderApp(
      {
        ...ADMIN_ROUTES,
        'POST /members/member-2/resend-invite': {
          body: { inviteUrl: 'http://localhost:3000/accept-invite?token=fresh' },
        },
      },
      '/members',
    );

    await openMenu('grace@acme.io');
    expect(screen.queryByRole('menuitem', { name: /reset link/i })).toBeNull();
    await userEvent.click(screen.getByRole('menuitem', { name: /resend invitation/i }));

    await waitFor(() => expect(api.called('POST /members/member-2/resend-invite')).toBeDefined());
    expect(await screen.findByLabelText('Invitation link')).toHaveValue(
      'http://localhost:3000/accept-invite?token=fresh',
    );
  });

  it('issues a reset link for someone who has joined, and not an invite', async () => {
    const api = renderApp(
      {
        ...ADMIN_ROUTES,
        'POST /members/member-3/reset-link': {
          body: { resetUrl: 'http://localhost:3000/reset-password?token=reset' },
        },
      },
      '/members',
    );

    await openMenu('maya.lindqvist@acme.io');
    expect(screen.queryByRole('menuitem', { name: /resend invitation/i })).toBeNull();
    await userEvent.click(screen.getByRole('menuitem', { name: /reset link/i }));

    await waitFor(() => expect(api.called('POST /members/member-3/reset-link')).toBeDefined());
    expect(await screen.findByLabelText('Password reset link')).toHaveValue(
      'http://localhost:3000/reset-password?token=reset',
    );
  });

  it('changes a role through the same cards the invite uses', async () => {
    const api = renderApp(
      { ...ADMIN_ROUTES, 'PATCH /members/member-3': { body: { member: {} } } },
      '/members',
    );

    await openMenu('maya.lindqvist@acme.io');
    await userEvent.click(screen.getByRole('menuitem', { name: /change role/i }));
    await userEvent.click(screen.getByRole('radio', { name: /manager/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Save role' }));

    await waitFor(() => expect(api.called('PATCH /members/member-3')).toBeDefined());
    expect(api.called('PATCH /members/member-3')!.body).toEqual({ role: 'manager' });
  });

  it('asks before removing someone, and says what they lose', async () => {
    const api = renderApp(
      { ...ADMIN_ROUTES, 'DELETE /members/member-3': { status: 204 } },
      '/members',
    );

    await openMenu('maya.lindqvist@acme.io');
    await userEvent.click(screen.getByRole('menuitem', { name: /remove/i }));

    expect(await screen.findByText(/will no longer be able to sign in/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove member' }));
    await waitFor(() => expect(api.called('DELETE /members/member-3')).toBeDefined());
  });

  it('never offers to remove you, or to change your own role', async () => {
    renderApp(ADMIN_ROUTES, '/members');
    await openMenu('tomasz@acme.io');

    expect(screen.getByRole('menuitem', { name: /reset link/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /change role/i })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /remove/i })).toBeNull();
  });
});
