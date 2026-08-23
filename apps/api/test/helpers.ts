import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { S3Client } from '@aws-sdk/client-s3';
import type { FastifyInstance, InjectOptions } from 'fastify';
import pg from 'pg';
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
import { makeStorage } from '@/services/storage.js';

/** Where both migration folders sit; `runMigrations` picks the one for the engine. */
export const MIGRATIONS_ROOT = fileURLToPath(new URL('../src', import.meta.url));

/**
 * The Postgres server the suite runs against, or undefined for SQLite. Read
 * from the environment at launch because `db/schema.ts` reads the same variable
 * to choose its tables — running one test file on the other engine is not a
 * thing, and this is the same switch as `npm run test:pg`.
 */
const PG_SERVER_URL = process.env.DATABASE_URL;

/**
 * A database of this test's own on the server `DATABASE_URL` names, migrated
 * from empty. Vitest runs files in parallel and several tests inside one file
 * build several workspaces, so sharing one database would have them deleting
 * each other's rows — where SQLite gets isolation for free from a throwaway
 * file, Postgres needs a throwaway database.
 */
async function createTestDatabase(serverUrl: string): Promise<string> {
  const name = `inv_test_${randomBytes(8).toString('hex')}`;
  const admin = new pg.Client({ connectionString: serverUrl });
  await admin.connect();
  try {
    // An identifier cannot be a bound parameter, which is why the name is
    // generated here rather than taken from anywhere.
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

/** Gives the database back. The pool is closed by then; other sessions are not. */
async function dropTestDatabase(serverUrl: string, databaseUrl: string): Promise<void> {
  const name = new URL(databaseUrl).pathname.slice(1);
  const admin = new pg.Client({ connectionString: serverUrl });
  await admin.connect();
  try {
    // DROP DATABASE refuses while anything is connected, and a pool that has
    // just been ended can still be releasing sockets.
    await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1', [
      name,
    ]);
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
  } finally {
    await admin.end();
  }
}

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
 * On SQLite that is a file rather than `:memory:`, because libsql hands each
 * transaction its own connection and every connection to `:memory:` is its own
 * empty database — the first commit would leave the next query looking at a
 * schema-less one. On Postgres it is a database of this test's own, created and
 * dropped around it. Both go on close.
 */
export async function buildTestApp(
  env: Record<string, string> = {},
  now?: () => Date,
  logDestination?: NodeJS.WritableStream,
  s3?: S3Client,
): Promise<TestApp> {
  // A throwaway data directory per test: the SQLite file and any uploads must
  // never touch the repo. Uploads land here on either engine.
  const dataDir = mkdtempSync(join(tmpdir(), 'inventory-test-'));
  const databaseUrl = PG_SERVER_URL ? await createTestDatabase(PG_SERVER_URL) : undefined;
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATA_DIR: dataDir,
    ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
    ...env,
  });
  const { db, client } = await createDb(config);
  await runMigrations(db, MIGRATIONS_ROOT);
  await seed(db);
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

  // Built here rather than inside the app, because the scheduled jobs below
  // take the same deps and the sweep has to look where the uploads went. `s3`
  // is only consulted when the env named a bucket — that choice is the seam's,
  // not the test's.
  const storage = makeStorage(config, s3);
  const app = await buildApp({ config, db, client, now, storage, mailer, logDestination });
  // Every suite closes in `afterEach`, which also runs after the pure unit
  // tests that never built an app and are looking at the previous one. Closing
  // twice was free on libsql and throws on a pg pool, so the second call does
  // nothing rather than every one of those files learning to reset a variable.
  let closed = false;
  return {
    app,
    db,
    deps: { config, db, client, storage, now: now ?? (() => new Date()), mailer },
    sent,
    uploadsDir: join(dataDir, 'uploads'),
    close: async () => {
      if (closed) return;
      closed = true;
      await app.close();
      await client.close();
      if (PG_SERVER_URL && databaseUrl) await dropTestDatabase(PG_SERVER_URL, databaseUrl);
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
  await db.insert(members).values({
    id,
    email: `${role}-${id.slice(0, 8)}@acme.io`,
    displayName: `${role[0]!.toUpperCase()}${role.slice(1)} Person`,
    passwordHash: 'not-used',
    role,
    status: 'active',
    createdAt: at,
    updatedAt: at,
  });
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
