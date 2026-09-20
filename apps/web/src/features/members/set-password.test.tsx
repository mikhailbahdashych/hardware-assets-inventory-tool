import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { setPasswordInput } from '@inventory/shared';
import { ADMIN_ROUTES } from '@/test/api-stub';
import { renderApp, resetAppState } from '@/test/render';

afterEach(resetAppState);

/** The row for one member, found by email — the one cell that is never shared. */
async function memberRow(email: string) {
  const cell = await screen.findByText(email);
  return cell.closest('[role="row"]') as HTMLElement;
}

async function openSetPassword() {
  const row = await memberRow('maya.lindqvist@acme.io');
  await userEvent.click(within(row).getByRole('button', { name: 'Actions for Maya Lindqvist' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Set a password' }));
}

describe('setting a password outright', () => {
  it('generates one that passes the policy, sets it, and shows it exactly once', async () => {
    const api = renderApp(
      { ...ADMIN_ROUTES, 'POST /members/member-3/password': { status: 204 } },
      '/members',
    );

    await openSetPassword();
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }));
    const input = screen.getByLabelText<HTMLInputElement>('New password', { exact: true });
    const password = input.value;
    expect(setPasswordInput.safeParse({ newPassword: password }).success).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));
    await waitFor(() =>
      expect(api.called('POST /members/member-3/password')?.body).toEqual({
        newPassword: password,
      }),
    );

    // The hand-over view: selectable text plus a copy button, like a one-time link.
    expect(await screen.findByText('Password set')).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toHaveValue(password);
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });

  it('renders the server complaint under the field', async () => {
    renderApp(
      {
        ...ADMIN_ROUTES,
        'POST /members/member-3/password': {
          status: 422,
          body: {
            error: {
              code: 'validation',
              message: 'Please correct the highlighted fields.',
              fields: { newPassword: 'Too guessable.' },
            },
          },
        },
      },
      '/members',
    );

    await openSetPassword();
    await userEvent.type(screen.getByLabelText('New password', { exact: true }), 'Short-pass1!');
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));
    expect(await screen.findByText('Too guessable.')).toBeInTheDocument();
  });

  it('is offered neither on your own row nor before somebody joins', async () => {
    renderApp(ADMIN_ROUTES, '/members');

    // Your own password changes through Account, with the current one in hand.
    const own = await memberRow('tomasz@acme.io');
    await userEvent.click(within(own).getByRole('button', { name: 'Actions for Tomasz Kowalski' }));
    expect(screen.getByRole('menuitem', { name: 'Copy password reset link' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Set a password' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');

    // An invited account has no password yet — the invitation link is the way in.
    const invited = await memberRow('grace@acme.io');
    await userEvent.click(within(invited).getByRole('button', { name: 'Actions for grace' }));
    expect(screen.getByRole('menuitem', { name: 'Resend invitation' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Set a password' })).not.toBeInTheDocument();
  });
});
