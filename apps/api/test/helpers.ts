import { fileURLToPath } from 'node:url';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDb, type Db } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../src/migrations', import.meta.url));

export type TestApp = {
  app: FastifyInstance;
  db: Db;
  close: () => Promise<void>;
};

export async function buildTestApp(env: Record<string, string> = {}): Promise<TestApp> {
  const { db, sqlite } = createDb(':memory:');
  runMigrations(db, MIGRATIONS_DIR);
  seed(db);
  const config = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', ...env });
  const app = await buildApp({ config, db, sqlite });
  return {
    app,
    db,
    close: async () => {
      await app.close();
      sqlite.close();
    },
  };
}

export const SETUP_BODY = {
  orgName: 'Acme Corp',
  name: 'Tomasz Kowalski',
  email: 'tomasz@acme.io',
  password: 'correct-horse-battery',
};

/** Runs first-run setup and returns the admin's session cookie header value. */
export async function setupOrg(app: FastifyInstance): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/setup', body: SETUP_BODY });
  if (res.statusCode !== 200) throw new Error(`setup failed: ${res.statusCode} ${res.body}`);
  return sessionCookie(res);
}

export function sessionCookie(res: { cookies: { name: string; value: string }[] }): string {
  const cookie = res.cookies.find((c) => c.name === 'inv_session');
  if (!cookie) throw new Error('no inv_session cookie in response');
  return `inv_session=${cookie.value}`;
}

export function inject(app: FastifyInstance, options: InjectOptions & { cookie?: string }) {
  const { cookie, ...rest } = options;
  return app.inject({
    ...rest,
    headers: { ...(cookie ? { cookie } : {}), ...(rest.headers ?? {}) },
  });
}
