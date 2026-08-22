import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '@/config.js';
import { createDb, describeStore } from '@/db/client.js';
import { runMigrations } from '@/db/migrate.js';
import { seed } from '@/db/seed.js';
import { seedDemo } from '@/db/demo.js';
import { AppError } from '@/lib/errors.js';
import { makeStorage, uploadsDir } from '@/services/storage.js';

/**
 * `npm run seed:demo` — fills this instance with a workspace worth looking at.
 *
 * It talks to the database directly rather than to a running server, so it
 * works before anything is up and inside a container that only has the built
 * output. The same command serves both cases the demo has: a developer who
 * wants the app to have something in it, and a hosted demo restoring itself.
 *
 *   npm run seed:demo                 # refuses a workspace that has data
 *   npm run seed:demo -- --reset      # empties it first, which is destructive
 *   DEMO_PASSWORD=… npm run seed:demo # otherwise the default below
 */
const DEFAULT_PASSWORD = 'demo-password';

async function main(): Promise<void> {
  const reset = process.argv.includes('--reset');
  const password = process.env.DEMO_PASSWORD ?? DEFAULT_PASSWORD;
  const config = loadConfig();

  mkdirSync(config.dataDir, { recursive: true });
  // Same as the server's boot: nothing to make on an instance whose uploads
  // live in a bucket.
  if (config.s3Bucket === undefined) mkdirSync(uploadsDir(config), { recursive: true });

  const { db, client } = await createDb(config);
  try {
    // The same two steps the server takes at boot, so this works against a
    // data directory that has never had a server pointed at it.
    await runMigrations(db, fileURLToPath(new URL('..', import.meta.url)));
    await seed(db);

    const result = await seedDemo(
      // `--reset` empties the workspace, attachments included, so this needs
      // the same storage the server would have used to write them.
      { config, db, client, storage: makeStorage(config), now: () => new Date(), mailer: null },
      { password, reset },
    );

    const width = Math.max(...result.signIn.map((account) => account.email.length));
    process.stdout.write(
      // Absolute, because `./data` is relative to whichever workspace npm
      // ran this in — which is not where somebody at the repo root looks.
      `\n  ${result.orgName} is ready in ${describeStore(config)}\n\n` +
        `  ${result.counts.assets} assets · ${result.counts.employees} employees · ` +
        `${result.counts.assignments} ownership records · ${result.counts.auditEvents} logged events\n\n` +
        result.signIn
          .map(
            (account) => `  ${account.email.padEnd(width)}  ${account.password}  (${account.role})`,
          )
          .join('\n') +
        // Not "now run npm run dev" — the same binary runs inside the image,
        // where that would be the wrong advice.
        `\n\n  Every account shares that password.\n\n`,
    );
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  // A workspace that already has data is the guard doing its job, not a crash:
  // say what to do about it instead of printing a stack trace at somebody.
  if (error instanceof AppError) {
    process.stderr.write(`\n  ${error.message}\n\n`);
    process.exit(1);
  }
  throw error;
});
