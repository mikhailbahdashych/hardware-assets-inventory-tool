import { QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from './App';
import { AppRoutes } from './routes';
import { ADMIN_MEMBER, READY_META, stubApi, type StubRoutes } from './test/api-stub';

function renderApp(routes: StubRoutes, initialPath = '/') {
  const api = stubApi(routes);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <AppProviders queryClient={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <AppRoutes />
      </MemoryRouter>
    </AppProviders>,
  );
  return api;
}

const UNAUTHENTICATED = {
  status: 401,
  body: { error: { code: 'unauthorized', message: 'Sign in to continue.' } },
};

afterEach(() => {
  vi.unstubAllGlobals();
  // Theme lives on <html> and in localStorage, both of which outlive a render.
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.density;
});

describe('first-run setup', () => {
  it('sends every visitor to setup while the instance is uninitialized', async () => {
    renderApp(
      {
        'GET /meta': { body: { needsSetup: true, version: '0.1.0' } },
        'GET /auth/me': UNAUTHENTICATED,
      },
      '/assets',
    );
    expect(await screen.findByRole('heading', { name: /set up inventory/i })).toBeInTheDocument();
  });

  it('creates the organization and lands on the dashboard', async () => {
    const api = renderApp(
      {
        'GET /meta': { body: { needsSetup: true, version: '0.1.0' } },
        'GET /auth/me': UNAUTHENTICATED,
        'POST /setup': { body: { member: ADMIN_MEMBER } },
      },
      '/setup',
    );

    await screen.findByRole('heading', { name: /set up inventory/i });
    await userEvent.type(screen.getByLabelText(/organization name/i), 'Acme Corp');
    await userEvent.type(screen.getByLabelText(/your name/i), 'Tomasz Kowalski');
    await userEvent.type(screen.getByLabelText(/email/i), 'tomasz@acme.io');
    await userEvent.type(screen.getByLabelText(/password/i), 'correct-horse-battery');
    await userEvent.click(screen.getByRole('button', { name: /create workspace/i }));

    await waitFor(() => expect(api.called('POST /setup')).toBeDefined());
    expect(api.called('POST /setup')!.body).toEqual({
      orgName: 'Acme Corp',
      name: 'Tomasz Kowalski',
      email: 'tomasz@acme.io',
      password: 'correct-horse-battery',
    });
  });

  it('keeps the setup screen unreachable once initialized', async () => {
    renderApp({ 'GET /meta': { body: READY_META }, 'GET /auth/me': UNAUTHENTICATED }, '/setup');
    expect(
      await screen.findByRole('heading', { name: /sign in to inventory/i }),
    ).toBeInTheDocument();
  });
});

describe('login', () => {
  it('redirects unauthenticated visitors from protected routes', async () => {
    renderApp({ 'GET /meta': { body: READY_META }, 'GET /auth/me': UNAUTHENTICATED }, '/assets');
    expect(
      await screen.findByRole('heading', { name: /sign in to inventory/i }),
    ).toBeInTheDocument();
  });

  it('names the organization on the sign-in screen', async () => {
    renderApp({ 'GET /meta': { body: READY_META }, 'GET /auth/me': UNAUTHENTICATED }, '/login');
    expect(await screen.findByText(/acme corp/i)).toBeInTheDocument();
  });

  it('does not offer SSO yet', async () => {
    renderApp({ 'GET /meta': { body: READY_META }, 'GET /auth/me': UNAUTHENTICATED }, '/login');
    await screen.findByRole('heading', { name: /sign in to inventory/i });
    expect(screen.queryByText(/continue with sso/i)).toBeNull();
  });

  it('signs in and shows the dashboard', async () => {
    let authenticated = false;
    const api = renderApp(
      {
        'GET /meta': { body: READY_META },
        'GET /auth/me': () =>
          authenticated ? { body: { member: ADMIN_MEMBER } } : UNAUTHENTICATED,
        'POST /auth/login': () => {
          authenticated = true;
          return { body: { member: ADMIN_MEMBER } };
        },
      },
      '/login',
    );

    await screen.findByRole('heading', { name: /sign in to inventory/i });
    await userEvent.type(screen.getByLabelText(/email/i), 'tomasz@acme.io');
    await userEvent.type(screen.getByLabelText(/password/i), 'correct-horse-battery');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => expect(api.called('POST /auth/login')).toBeDefined());
    expect(await screen.findByRole('navigation')).toBeInTheDocument();
  });

  it('shows the server message when the credentials are wrong', async () => {
    renderApp(
      {
        'GET /meta': { body: READY_META },
        'GET /auth/me': UNAUTHENTICATED,
        'POST /auth/login': {
          status: 401,
          body: { error: { code: 'invalid_credentials', message: 'Incorrect email or password.' } },
        },
      },
      '/login',
    );

    await screen.findByRole('heading', { name: /sign in to inventory/i });
    await userEvent.type(screen.getByLabelText(/email/i), 'tomasz@acme.io');
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(await screen.findByText('Incorrect email or password.')).toBeInTheDocument();
  });
});

describe('app shell', () => {
  const authenticatedRoutes = (member = ADMIN_MEMBER): StubRoutes => ({
    'GET /meta': { body: READY_META },
    'GET /auth/me': { body: { member } },
  });

  it('shows the organization wordmark, the current member and the section nav', async () => {
    renderApp(authenticatedRoutes(), '/dashboard');
    expect(await screen.findByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('Tomasz Kowalski')).toBeInTheDocument();
    expect(screen.getByText('Admin', { selector: 'div' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation');
    expect(nav).toHaveTextContent('Dashboard');
    expect(nav).toHaveTextContent('Assets');
    expect(nav).toHaveTextContent('Employees');
    expect(nav).toHaveTextContent('Members');
  });

  it('marks the current section in the sidebar', async () => {
    renderApp(authenticatedRoutes(), '/assets');
    const assets = await screen.findByRole('link', { name: 'Assets' });
    expect(assets).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Employees' })).not.toHaveAttribute('aria-current');
  });

  it('hides Admin from non-admins and keeps the page out of reach', async () => {
    renderApp(authenticatedRoutes({ ...ADMIN_MEMBER, role: 'viewer' }), '/admin');
    await screen.findByRole('navigation');
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull();
    await waitFor(() =>
      expect(screen.getByText('Dashboard', { selector: 'h1' })).toBeInTheDocument(),
    );
  });

  it('signs out and returns to the login screen', async () => {
    let authenticated = true;
    const api = renderApp(
      {
        'GET /meta': { body: READY_META },
        'GET /auth/me': () =>
          authenticated ? { body: { member: ADMIN_MEMBER } } : UNAUTHENTICATED,
        'POST /auth/logout': () => {
          authenticated = false;
          return { status: 204 };
        },
      },
      '/dashboard',
    );

    await userEvent.click(await screen.findByRole('button', { name: /sign out/i }));
    await waitFor(() => expect(api.called('POST /auth/logout')).toBeDefined());
    expect(
      await screen.findByRole('heading', { name: /sign in to inventory/i }),
    ).toBeInTheDocument();
  });

  it('persists a theme change to the signed-in member', async () => {
    const api = renderApp(authenticatedRoutes(), '/dashboard');
    await userEvent.click(await screen.findByRole('button', { name: /toggle theme/i }));
    await waitFor(() => expect(api.called('PATCH /me/prefs')).toBeDefined());
    expect(api.called('PATCH /me/prefs')!.body).toEqual({ theme: 'dark' });
  });

  it('adopts the member preferences stored on the server', async () => {
    renderApp(
      authenticatedRoutes({ ...ADMIN_MEMBER, theme: 'dark', density: 'compact' }),
      '/dashboard',
    );
    await screen.findByRole('navigation');
    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('dark');
      expect(document.documentElement.dataset.density).toBe('compact');
    });
  });
});
