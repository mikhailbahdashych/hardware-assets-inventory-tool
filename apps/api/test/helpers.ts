import { fileURLToPath } from 'node:url';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { Role } from '@inventory/shared';
import { buildApp } from '@/app.js';
import { loadConfig } from '@/config.js';
import { createDb, type Db } from '@/db/client.js';
import { runMigrations } from '@/db/migrate.js';
import { seed } from '@/db/seed.js';
import { members } from '@/db/schema.js';
import { nowIso } from '@/lib/dates.js';
import { newId } from '@/lib/ids.js';
import { createSession } from '@/services/sessions.js';

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

/**
 * A signed-in member of the given role, without paying for an argon2 hash —
 * RBAC tests only need the session, never the password.
 */
export function memberCookie(db: Db, role: Role): string {
  const id = newId();
  const at = nowIso();
  db.insert(members)
    .values({
      id,
      email: `${role}-${id.slice(0, 8)}@acme.io`,
      displayName: `${role[0].toUpperCase()}${role.slice(1)} Person`,
      passwordHash: 'not-used',
      role,
      status: 'active',
      createdAt: at,
      updatedAt: at,
    })
    .run();
  return `inv_session=${createSession(db, id).raw}`;
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
