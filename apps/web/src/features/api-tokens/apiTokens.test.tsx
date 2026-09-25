import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_MEMBER,
  ADMIN_ROUTES,
  API_TOKENS,
  AUDITOR_ROLE,
  DB_DOWN,
  EVERY_ACTION,
  EXPIRED_TOKEN,
  LIVE_TOKEN,
  MANAGER_ACTIONS,
  ROLES,
  session,
  UNLIMITED_TOKEN,
  type StubRoutes,
} from '@/test/api-stub';
import { renderApp, resetAppState } from '@/test/render';
import { choose } from '@/test/dropdown';

afterEach(() => {
  vi.unstubAllGlobals();
  resetAppState();
});

/** The tokens answer from a list the test can push to, so a mint really lands. */
function workspace(tokens: unknown[] = [...API_TOKENS]): StubRoutes {
  return {
    ...ADMIN_ROUTES,
    'GET /api-tokens': () => ({ body: { apiTokens: tokens } }),
    'POST /api-tokens': (body) => {
      const input = body as { name: string; scopes: string[]; expiresInDays: number | null };
      const apiToken = {
        id: 'token-new',
        name: input.name,
        scopes: input.scopes,
        expiresAt: input.expiresInDays === null ? null : '2099-01-01T00:00:00.000Z',
        createdByName: 'Tomasz Kowalski',
        createdAt: '2026-08-20T09:00:00.000Z',
        lastUsedAt: null,
      };
      tokens.unshift(apiToken);
      return { status: 201, body: { token: 'invt_the-only-copy-there-is', apiToken } };
    },
    'DELETE /api-tokens/token-1': { status: 204 },
  };
}

/** One token's row, found by its name. */
const rowFor = async (name: string): Promise<HTMLElement> =>
  (await screen.findByText(name)).closest('[role="row"]') as HTMLElement;

const openPalette = async () => {
  await screen.findByRole('navigation', { name: 'Inventory' });
  await userEvent.keyboard('{Meta>}k{/Meta}');
  return screen.findByRole('dialog');
};

describe('reaching the API tokens page', () => {
  it('sits in the workspace half of the sidebar, marked current', async () => {
    renderApp(workspace(), '/api-tokens');
    const nav = await screen.findByRole('navigation', { name: 'Workspace' });
    expect(within(nav).getByRole('link', { name: 'API tokens' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(await screen.findByRole('heading', { name: 'API tokens' })).toBeInTheDocument();
  });

  it('is in the command palette, for the admins who never scroll the sidebar', async () => {
    renderApp(workspace(), '/dashboard');
    const dialog = await openPalette();
    expect(within(dialog).getByRole('option', { name: /API tokens/ })).toBeInTheDocument();
  });

  it('is hidden from a manager, and out of reach even by URL', async () => {
    renderApp(
      {
        ...workspace(),
        'GET /auth/me': session({ ...ADMIN_MEMBER, role: 'manager' }, MANAGER_ACTIONS),
      },
      '/api-tokens',
    );
    const nav = await screen.findByRole('navigation', { name: 'Workspace' });
    expect(within(nav).queryByRole('link', { name: 'API tokens' })).toBeNull();
    // The door is locked, not merely hidden.
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'API tokens' })).toBeNull();
  });

  it('stays shut for a role holding every action there is', async () => {
    // The sharp edge: minting a token is not a permission a workspace can
    // grant itself, so even a role with every action is not admin enough.
    renderApp(
      {
        ...workspace(),
        'GET /auth/me': session({ ...ADMIN_MEMBER, role: 'auditor' }, EVERY_ACTION),
        'GET /roles': { body: { roles: [...ROLES.roles, AUDITOR_ROLE] } },
      },
      '/api-tokens',
    );
    const nav = await screen.findByRole('navigation', { name: 'Workspace' });
    expect(within(nav).queryByRole('link', { name: 'API tokens' })).toBeNull();
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();

    await userEvent.keyboard('{Meta>}k{/Meta}');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('option', { name: /API tokens/ })).toBeNull();
  });
});

describe('the token list', () => {
  it('names each token, what it may reach, and when it was last used', async () => {
    renderApp(workspace(), '/api-tokens');

    const row = await rowFor(LIVE_TOKEN.name);
    expect(row).toHaveTextContent('Read assets');
    expect(row).toHaveTextContent('Write assets');
    expect(row).toHaveTextContent('Mar 1, 2099');
  });

  it('marks an expired token rather than hiding it, and em-dashes what is absent', async () => {
    renderApp(workspace(), '/api-tokens');

    // An expired token stays listed until somebody revokes it: a call that
    // stopped working should be diagnosable from this page.
    expect(await rowFor(EXPIRED_TOKEN.name)).toHaveTextContent('Expired');
    // Unlimited is the design's em dash, and so is a token nobody has used.
    const unlimited = await rowFor(UNLIMITED_TOKEN.name);
    expect(within(unlimited).getAllByText('—')).toHaveLength(2);
  });

  it('says so in the app’s voice when a workspace has minted none', async () => {
    renderApp(workspace([]), '/api-tokens');
    expect(await screen.findByText(/no api tokens yet/i)).toBeInTheDocument();
  });

  it('points at the reference this instance is already serving', async () => {
    renderApp(workspace(), '/api-tokens');
    expect(await screen.findByRole('link', { name: /api reference/i })).toHaveAttribute(
      'href',
      '/api/public/docs',
    );
  });
});

describe('minting a token', () => {
  const openForm = async () => {
    await userEvent.click(await screen.findByRole('button', { name: /new token/i }));
    return screen.findByRole('dialog');
  };

  it('asks for a name and at least one scope before it will submit', async () => {
    renderApp(workspace(), '/api-tokens');
    const dialog = await openForm();
    const create = within(dialog).getByRole('button', { name: /create token/i });

    expect(create).toBeDisabled();
    await userEvent.type(within(dialog).getByRole('textbox', { name: /name/i }), 'CI pipeline');
    // A named token that may do nothing is still not a token.
    expect(create).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /read assets/i }));
    expect(create).toBeEnabled();
  });

  it('posts the scopes and the expiry that were picked, and shows the raw once', async () => {
    const api = renderApp(workspace(), '/api-tokens');
    const dialog = await openForm();

    await userEvent.type(within(dialog).getByRole('textbox', { name: /name/i }), 'CI pipeline');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /read assets/i }));
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /write assets/i }));
    await choose(within(dialog), /expires/i, '180 days');
    await userEvent.click(within(dialog).getByRole('button', { name: /create token/i }));

    await waitFor(() => expect(api.called('POST /api-tokens')).toBeDefined());
    expect(api.called('POST /api-tokens')!.body).toEqual({
      name: 'CI pipeline',
      scopes: ['assets:read', 'assets:write'],
      expiresInDays: 180,
    });

    // The one moment the raw value exists outside somebody's deployment.
    const shown = await screen.findByDisplayValue('invt_the-only-copy-there-is');
    expect(shown).toBeInTheDocument();
    expect(screen.getByText(/only here/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    // The list knows the row; nothing in the app knows the secret any more.
    expect(await rowFor('CI pipeline')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('invt_the-only-copy-there-is')).toBeNull();
  });
});

describe('revoking a token', () => {
  it('asks twice, because the calls using it stop the moment it goes', async () => {
    const api = renderApp(workspace(), '/api-tokens');

    await userEvent.click(
      within(await rowFor(LIVE_TOKEN.name)).getByRole('button', {
        name: `Actions for ${LIVE_TOKEN.name}`,
      }),
    );
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Revoke' }));
    expect(api.called('DELETE /api-tokens/token-1')).toBeUndefined();

    await userEvent.click(
      within(await rowFor(LIVE_TOKEN.name)).getByRole('button', { name: /revoke for good/i }),
    );
    await waitFor(() => expect(api.called('DELETE /api-tokens/token-1')).toBeDefined());
  });
});

describe('a read that failed', () => {
  it('says so in the server’s own words instead of a workspace with no integrations', async () => {
    renderApp({ ...ADMIN_ROUTES, 'GET /api-tokens': DB_DOWN }, '/api-tokens');

    const panel = await screen.findByRole('alert');
    expect(within(panel).getByText(/the api tokens could not be loaded/i)).toBeInTheDocument();
    expect(within(panel).getByText('The database is unavailable.')).toBeInTheDocument();
    // The lie: a failed read drawn as a workspace that has minted nothing —
    // an invitation to mint a second credential for a system that has one.
    expect(screen.queryByText(/no api tokens yet/i)).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('reads the list again when the panel’s retry is pressed', async () => {
    let attempts = 0;
    const api = renderApp(
      {
        ...ADMIN_ROUTES,
        'GET /api-tokens': () =>
          attempts++ === 0 ? DB_DOWN : { body: { apiTokens: [LIVE_TOKEN] } },
      },
      '/api-tokens',
    );

    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText(LIVE_TOKEN.name)).toBeInTheDocument();
    expect(api.calledAll('GET /api-tokens')).toHaveLength(2);
  });

  it('still says there are none when the workspace genuinely has none', async () => {
    renderApp(workspace([]), '/api-tokens');

    expect(await screen.findByText(/no api tokens yet/i)).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
