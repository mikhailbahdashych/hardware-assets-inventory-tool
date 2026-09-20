import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DASHBOARD_ROUTES, READY_META } from '@/test/api-stub';
import { renderApp, resetAppState, UNAUTHENTICATED } from '@/test/render';

afterEach(() => {
  vi.unstubAllGlobals();
  resetAppState();
  document.title = 'Inventory';
});

describe('the browser tab', () => {
  it('names the page and the workspace inside the shell', async () => {
    renderApp(DASHBOARD_ROUTES, '/members');
    await waitFor(() => expect(document.title).toBe('Members · Acme Corp'));
  });

  it('names an auth screen by its own heading', async () => {
    renderApp({ 'GET /meta': { body: READY_META }, 'GET /auth/me': UNAUTHENTICATED }, '/login');
    await waitFor(() => expect(document.title).toBe('Sign in to Inventory'));
  });
});

describe('the sidebar', () => {
  it('keeps the inventory on top and workspace management at the bottom', async () => {
    renderApp(DASHBOARD_ROUTES, '/dashboard');
    const inventory = await screen.findByRole('navigation', { name: 'Inventory' });
    const workspace = await screen.findByRole('navigation', { name: 'Workspace' });
    expect(within(inventory).getByRole('link', { name: 'Assets' })).toBeInTheDocument();
    expect(within(workspace).getByRole('link', { name: 'Members' })).toBeInTheDocument();
    expect(within(workspace).getByRole('link', { name: 'Admin' })).toBeInTheDocument();
    expect(within(inventory).queryByRole('link', { name: 'Members' })).toBeNull();
  });
});
