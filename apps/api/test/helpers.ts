import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from '@/app.js';
import type { AppDeps } from '@/types/app.js';
import type { MailMessage, Mailer } from '@/types/mail.js';
import { loadConfig } from '@/config.js';
import { createDb } from '@/db/client.js';
import type { Db } from '@/types/db.js';
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
  /** The same deps the app got — scheduled jobs take these directly. */
  deps: AppDeps;
  /** Every message the fake mailer accepted, in order. Empty without SMTP. */
  sent: MailMessage[];
  /** Where uploaded files land for this test; removed on close. */
  uploadsDir: string;
  close: () => Promise<void>;
};

/**
 * A real app on a throwaway database with the real migrations. Pass `now` to
 * pin the clock — anything that counts days from today needs a fixed one.
 *
 * A file rather than `:memory:`, because libsql hands each transaction its own
 * connection and every connection to `:memory:` is its own empty database —
 * the first commit would leave the next query looking at a schema-less one.
 * The directory goes on close, so it is throwaway either way.
 */
export async function buildTestApp(
  env: Record<string, string> = {},
  now?: () => Date,
  logDestination?: NodeJS.WritableStream,
): Promise<TestApp> {
  // A throwaway data directory per test: the database and any uploads must
  // never touch the repo.
  const dataDir = mkdtempSync(join(tmpdir(), 'inventory-test-'));
  const { db, client } = await createDb(join(dataDir, 'inventory.db'));
  await runMigrations(db, MIGRATIONS_DIR);
  await seed(db);
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATA_DIR: dataDir,
    ...env,
  });
  // A recording mailer exactly when the config says this instance can send,
  // so "no SMTP" is a state the tests exercise rather than a branch they mock.
  const sent: MailMessage[] = [];
  const mailer: Mailer | null = config.smtp
    ? {
        send: async (message) => {
          sent.push(message);
        },
      }
    : null;

  const app = await buildApp({ config, db, client, now, mailer, logDestination });
  return {
    app,
    db,
    deps: { config, db, client, now: now ?? (() => new Date()), mailer },
    sent,
    uploadsDir: join(dataDir, 'uploads'),
    close: async () => {
      await app.close();
      client.close();
      rmSync(dataDir, { recursive: true, force: true });
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
 * A signed-in member holding the given role, without paying for an argon2 hash
 * — RBAC tests only need the session, never the password. A plain string
 * rather than a `Role`: roles are rows a workspace makes up now, and a test
 * that wants somebody holding one has to be able to say so.
 */
export async function memberCookie(db: Db, role: string): Promise<string> {
  const id = newId();
  const at = nowIso();
  await db
    .insert(members)
    .values({
      id,
      email: `${role}-${id.slice(0, 8)}@acme.io`,
      displayName: `${role[0]!.toUpperCase()}${role.slice(1)} Person`,
      passwordHash: 'not-used',
      role,
      status: 'active',
      createdAt: at,
      updatedAt: at,
    })
    .run();
  return `inv_session=${(await createSession(db, id)).raw}`;
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
