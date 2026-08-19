import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_MEMBER, READY_META, session, type StubRoutes } from '@/test/api-stub';
import { renderApp, resetAppState, UNAUTHENTICATED } from '@/test/render';

afterEach(() => {
  vi.unstubAllGlobals();
  resetAppState();
});

const FRESH_CODES = [
  'k7m2q-4xr9t',
  'b3n8p-2wq5s',
  'j9d4h-7yt2k',
  'm5r7v-3fc8n',
  'q2w9x-6hj4d',
  'z8t3m-9kp7r',
  'v4y6b-5nd2q',
  'c7k9j-4rt8w',
  'h3p5n-8mq6y',
  'd6x2w-7bk3v',
];

/**
 * The two-factor sign-in, up to the point where the code is submitted. What
 * the verify answers is the whole subject of these tests.
 */
async function signInWithMfa(routes: StubRoutes) {
  const api = renderApp(
    {
      'GET /meta': { body: READY_META },
      'POST /auth/login': { body: { mfaRequired: true, challengeToken: 'challenge-1' } },
      ...routes,
    },
    '/login',
  );

  await screen.findByRole('heading', { name: /sign in to inventory/i });
  await userEvent.type(screen.getByLabelText(/email/i), 'tomasz@acme.io');
  await userEvent.type(screen.getByLabelText(/password/i), 'correct-horse-battery');
  await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

  await screen.findByRole('heading', { name: /two-factor authentication/i });
  await userEvent.type(screen.getByLabelText(/authentication code/i), '123456');
  await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
  return api;
}

describe('signing in with a second factor', () => {
  it('goes straight into the app when nothing was reissued', async () => {
    let authenticated = false;
    await signInWithMfa({
      'GET /auth/me': () => (authenticated ? session() : UNAUTHENTICATED),
      'POST /auth/mfa/verify': () => {
        authenticated = true;
        return { body: { member: ADMIN_MEMBER } };
      },
    });

    expect(await screen.findByRole('navigation')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /save your recovery codes/i })).toBeNull();
  });

  it('stops to hand over a reissued set before letting anybody in', async () => {
    let authenticated = false;
    await signInWithMfa({
      'GET /auth/me': () => (authenticated ? session() : UNAUTHENTICATED),
      'POST /auth/mfa/verify': () => {
        authenticated = true;
        return { body: { member: ADMIN_MEMBER, recoveryCodes: FRESH_CODES } };
      },
    });

    expect(
      await screen.findByRole('heading', { name: /save your recovery codes/i }),
    ).toBeInTheDocument();
    for (const code of FRESH_CODES) expect(screen.getByText(code)).toBeInTheDocument();
    // Why they are on screen at all — nobody asked for these.
    expect(screen.getByText(/were reset/i)).toBeInTheDocument();
    // The session exists already, but the app must not appear behind the one
    // screen these codes will ever be on.
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('enters the app once the member says they have kept them', async () => {
    let authenticated = false;
    await signInWithMfa({
      'GET /auth/me': () => (authenticated ? session() : UNAUTHENTICATED),
      'POST /auth/mfa/verify': () => {
        authenticated = true;
        return { body: { member: ADMIN_MEMBER, recoveryCodes: FRESH_CODES } };
      },
    });

    await screen.findByRole('heading', { name: /save your recovery codes/i });
    const kept = screen.getByRole('checkbox', { name: /saved these somewhere safe/i });
    // The way out admits you have them: there is no second chance to look.
    expect(screen.getByRole('button', { name: /continue to inventory/i })).toBeDisabled();

    await userEvent.click(kept);
    await userEvent.click(screen.getByRole('button', { name: /continue to inventory/i }));

    expect(await screen.findByRole('navigation')).toBeInTheDocument();
  });
});

describe('enrolling an authenticator', () => {
  /** The state that puts the enrolment screen up: required, not yet enrolled. */
  const MUST_ENROL = {
    body: { member: ADMIN_MEMBER, mustEnrolMfa: true, permissions: [] },
  };

  it('shows the first set of codes, and only then opens the app', async () => {
    const api = renderApp(
      {
        'GET /meta': { body: READY_META },
        'GET /auth/me': MUST_ENROL,
        'POST /me/mfa/enroll': {
          body: { secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/x' },
        },
        'POST /me/mfa/confirm': { body: { recoveryCodes: FRESH_CODES } },
      },
      '/dashboard',
    );

    await screen.findByRole('heading', { name: /set up two-factor authentication/i });
    await userEvent.type(screen.getByLabelText(/code from the app/i), '123456');
    await userEvent.click(screen.getByRole('button', { name: /confirm and finish/i }));

    expect(
      await screen.findByRole('heading', { name: /save your recovery codes/i }),
    ).toBeInTheDocument();
    for (const code of FRESH_CODES) expect(screen.getByText(code)).toBeInTheDocument();
    // A first set is not a reissue, so the sentence that explains one is absent.
    expect(screen.queryByText(/were reset/i)).toBeNull();
    await waitFor(() => expect(api.called('POST /me/mfa/confirm')).toBeDefined());
  });
});
