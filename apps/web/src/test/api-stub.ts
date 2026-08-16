import { vi } from 'vitest';

export type StubResponse = { status?: number; body?: unknown };
export type StubHandler = StubResponse | ((body: unknown) => StubResponse);
/** Keyed by "METHOD /path", e.g. "POST /auth/login". */
export type StubRoutes = Record<string, StubHandler>;

export type ApiStub = {
  calls: { method: string; path: string; body: unknown }[];
  called: (key: string) => { method: string; path: string; body: unknown } | undefined;
};

/** Stubs global fetch with a small route table so tests exercise the real API client. */
export function stubApi(routes: StubRoutes): ApiStub {
  const calls: ApiStub['calls'] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = (init.method ?? 'GET').toUpperCase();
      const path = url.replace('/api/v1', '');
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ method, path, body });

      const handler = routes[`${method} ${path}`];
      if (!handler) {
        return new Response(
          JSON.stringify({ error: { code: 'not_found', message: 'Not found.' } }),
          {
            status: 404,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      const { status = 200, body: responseBody } =
        typeof handler === 'function' ? handler(body) : handler;
      return new Response(responseBody === undefined ? null : JSON.stringify(responseBody), {
        status,
        headers: responseBody === undefined ? {} : { 'content-type': 'application/json' },
      });
    }),
  );

  return {
    calls,
    called: (key) => {
      const [method, path] = key.split(' ');
      return calls.find((call) => call.method === method && call.path === path);
    },
  };
}

export const ADMIN_MEMBER = {
  id: 'member-1',
  email: 'tomasz@acme.io',
  displayName: 'Tomasz Kowalski',
  role: 'admin',
  status: 'active',
  employeeId: null,
  lastActiveAt: null,
  theme: 'light',
  density: 'comfortable',
  widgets: {},
};

export const READY_META = { needsSetup: false, version: '0.1.0', orgName: 'Acme Corp' };
