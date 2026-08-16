import { QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AppProviders } from '@/App';
import { AppRoutes } from '@/routes';
import { stubApi, type StubRoutes } from './api-stub';

/**
 * Renders the whole app — providers, router and guards — against a stubbed
 * fetch, so tests exercise the real API client, query cache and routing
 * together instead of mocked hooks.
 */
export function renderApp(routes: StubRoutes, initialPath = '/') {
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

export const UNAUTHENTICATED = {
  status: 401,
  body: { error: { code: 'unauthorized', message: 'Sign in to continue.' } },
};

/** Resets the state that outlives a render: theme lives on <html> and in localStorage. */
export function resetAppState(): void {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.density;
}
