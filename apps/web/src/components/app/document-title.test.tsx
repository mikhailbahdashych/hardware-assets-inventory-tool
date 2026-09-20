import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DASHBOARD_ROUTES, READY_META } from '@/test/api-stub';
import { renderApp, resetAppState, UNAUTHENTICATED } from '@/test/render';

afterEach(() => {
  vi.unstubAllGlobals();
  resetAppState();
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
