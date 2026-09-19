import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DASHBOARD_ROUTES, type StubRoutes } from '@/test/api-stub';
import { renderApp, resetAppState } from '@/test/render';

afterEach(() => {
  vi.unstubAllGlobals();
  resetAppState();
});

/** Signs in, opens the sidebar's Change password modal, fills both fields. */
async function submitChange(routes: StubRoutes) {
  const api = renderApp({ ...DASHBOARD_ROUTES, ...routes }, '/dashboard');
  await userEvent.click(await screen.findByRole('button', { name: 'Change password' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.type(screen.getByLabelText(/current password/i), 'the-old-password');
  await userEvent.type(screen.getByLabelText(/new password/i), 'the-new-password-here');
  // The sidebar button shares the name; the submit is the dialog's own.
  await userEvent.click(within(dialog).getByRole('button', { name: 'Change password' }));
  return { api, dialog };
}

describe('changing your own password', () => {
  it('sends both fields, closes, and says what else it signed out', async () => {
    const { api } = await submitChange({ 'POST /me/password': { status: 204 } });

    await waitFor(() =>
      expect(api.called('POST /me/password')?.body).toEqual({
        currentPassword: 'the-old-password',
        newPassword: 'the-new-password-here',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // The consequence is the sentence: other browsers are signed out.
    expect(screen.getByText(/signed out everywhere else/i)).toBeInTheDocument();
  });

  it("shows the server's words under the field that was wrong", async () => {
    await submitChange({
      'POST /me/password': {
        status: 422,
        body: {
          error: {
            code: 'validation',
            message: 'Please correct the highlighted fields.',
            fields: { currentPassword: 'That is not your current password.' },
          },
        },
      },
    });

    expect(await screen.findByText('That is not your current password.')).toBeInTheDocument();
    // Still open: nothing changed, the person fixes it in place.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
