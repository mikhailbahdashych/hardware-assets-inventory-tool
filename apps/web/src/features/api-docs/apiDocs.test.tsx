import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_MEMBER,
  ADMIN_ROUTES,
  AUDITOR_ROLE,
  DB_DOWN,
  EVERY_ACTION,
  MANAGER_ACTIONS,
  OPENAPI_SPEC,
  ROLES,
  session,
  type StubResponse,
  type StubRoutes,
} from '@/test/api-stub';
import { renderApp, resetAppState } from '@/test/render';
import type { HttpMethod, OpenApiDocument } from '@/types/openapi';

afterEach(() => {
  vi.unstubAllGlobals();
  resetAppState();
});

const SPEC_ROUTE = 'GET /api/public/openapi.json';

/** An admin's workspace, serving whichever document the test hands it. */
function workspace(spec: OpenApiDocument = OPENAPI_SPEC): StubRoutes {
  return { ...ADMIN_ROUTES, [SPEC_ROUTE]: { body: spec } };
}

/** Every operation a document declares, walked the way the format defines it. */
function operationsOf(spec: OpenApiDocument) {
  return Object.entries(spec.paths).flatMap(([path, item]) =>
    Object.entries(item).map(([method, operation]) => ({
      method: method as HttpMethod,
      path,
      summary: operation.summary!,
    })),
  );
}

/** One operation's card, found by the method and path that make it unique. */
const card = (method: string, path: string) =>
  screen.findByRole('article', { name: `${method.toUpperCase()} ${path}` });

describe('reaching the API reference', () => {
  it('is reached from the API tokens page, not from the sidebar', async () => {
    renderApp(workspace(), '/api-tokens');
    const nav = await screen.findByRole('navigation', { name: 'Workspace' });
    // The sidebar stays the workspace's pages; the reference is what the
    // tokens page reads out to, so that is where its door is.
    expect(within(nav).queryByRole('link', { name: 'API reference' })).toBeNull();

    const summary = await screen.findByText(/credentials for the systems/i);
    await userEvent.click(within(summary).getByRole('link', { name: 'API reference' }));
    expect(await screen.findByRole('heading', { name: 'API reference' })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'API reference' })).toBeNull();
  });

  it('is in the command palette', async () => {
    renderApp(workspace(), '/dashboard');
    await screen.findByRole('navigation', { name: 'Inventory' });
    await userEvent.keyboard('{Meta>}k{/Meta}');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('option', { name: /API reference/ })).toBeInTheDocument();
  });

  it('is out of reach of a manager, even by URL', async () => {
    renderApp(
      {
        ...workspace(),
        'GET /auth/me': session({ ...ADMIN_MEMBER, role: 'manager' }, MANAGER_ACTIONS),
      },
      '/api-docs',
    );
    // The door is locked, not merely unlinked.
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'API reference' })).toBeNull();
  });

  it('stays shut for a role holding every action there is, like the tokens it documents', async () => {
    renderApp(
      {
        ...workspace(),
        'GET /auth/me': session({ ...ADMIN_MEMBER, role: 'auditor' }, EVERY_ACTION),
        'GET /roles': { body: { roles: [...ROLES.roles, AUDITOR_ROLE] } },
      },
      '/api-docs',
    );
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'API reference' })).toBeNull();

    await userEvent.keyboard('{Meta>}k{/Meta}');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('option', { name: /API reference/ })).toBeNull();
  });
});

describe('every operation the document declares is on the page', () => {
  // The fence. The page renders the live document rather than a copy of it,
  // so the property worth holding is that nothing in `paths` goes missing.
  it('draws each one with its method, its path and its summary', async () => {
    renderApp(workspace(), '/api-docs');

    const expected = operationsOf(OPENAPI_SPEC);
    expect(expected).toHaveLength(16);
    for (const { method, path, summary } of expected) {
      const article = await card(method, path);
      expect(within(article).getByText(method.toUpperCase())).toBeVisible();
      expect(within(article).getByText(path)).toBeVisible();
      expect(within(article).getByRole('heading', { name: summary })).toBeVisible();
    }
    // And nothing the document does not declare.
    expect(screen.getAllByRole('article')).toHaveLength(expected.length);
  });

  it('draws a route the surface gains tomorrow, with no change here', async () => {
    const tomorrow: OpenApiDocument = {
      ...OPENAPI_SPEC,
      paths: {
        ...OPENAPI_SPEC.paths,
        '/api/public/v1/locations': {
          get: { summary: 'List locations', tags: ['locations'], responses: {} },
          put: { summary: 'Replace the locations', tags: ['locations'], responses: {} },
        },
        // No tag at all is still an operation somebody can call.
        '/api/public/v1/ping': { get: { summary: 'Ping', responses: {} } },
      },
    };
    renderApp(workspace(tomorrow), '/api-docs');

    for (const { method, path, summary } of operationsOf(tomorrow)) {
      expect(
        within(await card(method, path)).getByRole('heading', { name: summary }),
      ).toBeVisible();
    }
    expect(screen.getAllByRole('article')).toHaveLength(19);
  });

  it('groups them under the document’s tags, in the document’s order', async () => {
    renderApp(workspace(), '/api-docs');
    await card('get', '/api/public/v1/assets');

    const sections = screen.getAllByRole('region');
    expect(sections.map((section) => section.getAttribute('aria-label'))).toEqual(
      OPENAPI_SPEC.tags!.map((tag) => tag.name),
    );
    const assets = within(sections[0]!).getAllByRole('article');
    expect(assets).toHaveLength(7);
  });
});

describe('one operation, in full', () => {
  const ASSIGN = '/api/public/v1/assets/{id}/assign';

  it('tables its parameters and its body’s fields', async () => {
    renderApp(workspace(), '/api-docs');
    const article = await card('post', ASSIGN);

    const parameters = within(article).getByRole('table', { name: 'Parameters' });
    const id = within(parameters).getByRole('row', { name: /^id/ });
    expect(id).toHaveTextContent('path');
    expect(id).toHaveTextContent('string');
    expect(id).toHaveTextContent(/required/i);

    const body = within(article).getByRole('table', { name: 'Request body' });
    const checkout = within(body).getByRole('row', { name: /^checkoutDate/ });
    expect(checkout).toHaveTextContent(/required/i);
    expect(checkout).toHaveTextContent('^\\d{4}-\\d{2}-\\d{2}$');
    const notes = within(body).getByRole('row', { name: /^notes/ });
    expect(notes).toHaveTextContent('string | null');
    expect(notes).toHaveTextContent('length ≤ 1000');
    expect(notes).not.toHaveTextContent(/required/i);
  });

  it('shows the request a caller sends, derived from the schema', async () => {
    renderApp(workspace(), '/api-docs');
    const article = await card('post', ASSIGN);

    const example = within(article).getByLabelText('Example request');
    expect(example).toHaveTextContent(`POST ${ASSIGN}`);
    expect(example).toHaveTextContent('Authorization: Bearer <token>');
    expect(example).toHaveTextContent('"checkoutDate": "2026-01-15"');
  });

  it('lists the responses the document declares, and nothing it does not', async () => {
    renderApp(workspace(), '/api-docs');
    const article = await card('delete', '/api/public/v1/assets/{id}');

    // The generator's placeholder, drawn as written: this page quotes the
    // document rather than improving on it.
    const responses = within(article).getByRole('list', { name: 'Responses' });
    expect(within(responses).getAllByRole('listitem')).toHaveLength(1);
    expect(responses).toHaveTextContent('200');
    expect(responses).toHaveTextContent('Default Response');
  });

  it('names the scope it needs, in the words the token form uses', async () => {
    renderApp(workspace(), '/api-docs');
    expect(await card('get', '/api/public/v1/assets')).toHaveTextContent('Read assets');
    expect(await card('post', ASSIGN)).toHaveTextContent('Assign and check in');
    // The description's own sentence stays, code and all.
    expect(
      within(await card('get', '/api/public/v1/audit')).getByText('audit:read'),
    ).toBeInTheDocument();
  });

  it('can be linked to on its own', async () => {
    renderApp(workspace(), '/api-docs');
    const article = await card('post', ASSIGN);
    const link = within(article).getByRole('link', { name: 'Hand an asset to somebody' });
    expect(link).toHaveAttribute('href', `#${article.id}`);
    expect(article.id).toBe('post-api-public-v1-assets-id-assign');
  });
});

describe('the preamble', () => {
  it('says where to call, how to authenticate, and where to try a call', async () => {
    renderApp(workspace(), '/api-docs');
    await card('get', '/api/public/v1/assets');

    expect(screen.getByText('Inventory public API')).toBeInTheDocument();
    expect(screen.getByText(window.location.origin)).toBeInTheDocument();
    expect(screen.getByText('Authorization: Bearer <token>', { selector: 'code' })).toBeVisible();
    expect(screen.getByRole('link', { name: /interactive reference/i })).toHaveAttribute(
      'href',
      '/api/public/docs',
    );
    expect(screen.getByRole('link', { name: 'openapi.json' })).toHaveAttribute(
      'href',
      '/api/public/openapi.json',
    );
  });
});

describe('the three states', () => {
  it('waits for the document with a spinner, not an empty reference', async () => {
    let answer: (response: StubResponse) => void = () => {};
    renderApp(
      {
        ...workspace(),
        [SPEC_ROUTE]: () =>
          new Promise<StubResponse>((resolve) => {
            answer = resolve;
          }),
      },
      '/api-docs',
    );

    await screen.findByRole('heading', { name: 'API reference' });
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.queryByRole('article')).toBeNull();

    answer({ body: OPENAPI_SPEC });
    expect(await card('get', '/api/public/v1/assets')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull();
  });

  it('says the document could not be loaded, in the server’s own words', async () => {
    renderApp({ ...ADMIN_ROUTES, [SPEC_ROUTE]: DB_DOWN }, '/api-docs');

    const panel = await screen.findByRole('alert');
    expect(
      within(panel).getByText('The API documentation could not be loaded.'),
    ).toBeInTheDocument();
    expect(within(panel).getByText('The database is unavailable.')).toBeInTheDocument();
    // A failed read is not a surface with no endpoints.
    expect(screen.queryByRole('article')).toBeNull();
  });

  it('reads the document again when the panel’s retry is pressed', async () => {
    let attempts = 0;
    const api = renderApp(
      {
        ...ADMIN_ROUTES,
        [SPEC_ROUTE]: () => (attempts++ === 0 ? DB_DOWN : { body: OPENAPI_SPEC }),
      },
      '/api-docs',
    );

    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await card('get', '/api/public/v1/assets')).toBeInTheDocument();
    expect(api.calledAll(SPEC_ROUTE)).toHaveLength(2);
  });
});
