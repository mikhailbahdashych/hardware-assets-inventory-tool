import { eq } from 'drizzle-orm';
import { loadConfig } from '@/config.js';
import { createDb } from '@/db/client.js';
import { members } from '@/db/schema.js';
import { resetMemberMfa } from '@/services/mfa.js';
import { writeAudit } from '@/services/audit.js';

/**
 * Break glass: clear one member's second factor from the command line.
 *
 * Admins reset each other from the Members page, which covers a lost phone.
 * This covers the case that has no answer inside the app — the last admin
 * losing both their authenticator and their recovery codes, with nobody left
 * who can help them. It talks to the database directly, so it works when
 * nobody can sign in at all.
 *
 *   docker compose exec inventory node apps/api/dist/db/mfa-reset-cli.js ada@acme.io
 *   npm run mfa:reset -w apps/api -- ada@acme.io
 *
 * Running it needs shell access to the instance, which is already
 * root-equivalent over a SQLite file — this grants nothing that was not
 * already available with a hex editor, it just makes it survivable.
 */
async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    process.stderr.write(
      '\n  Which account? Pass the email address of the member to reset.\n\n' +
        '    node apps/api/dist/db/mfa-reset-cli.js ada@acme.io\n\n',
    );
    process.exit(1);
  }

  const config = loadConfig();
  const { db, client } = await createDb(config);
  try {
    const [member] = await db.select().from(members).where(eq(members.email, email));
    if (!member) {
      process.stderr.write(`\n  No member with the email ${email} in ${config.dataDir}.\n\n`);
      process.exit(1);
    }

    if (!member.mfaSecret && !member.mfaConfirmedAt) {
      process.stdout.write(`\n  ${email} has no authenticator set up. Nothing to do.\n\n`);
      return;
    }

    const now = new Date();
    await db.transaction(async (tx) => {
      await resetMemberMfa(tx, member.id, now);
      // Attributed to the account it happened to, because the operator at a
      // shell has no member id — and an unexplained reset in the log is worse
      // than one that names the account and says where it came from.
      await writeAudit(
        tx,
        {
          type: 'auth',
          action: 'member.mfa_reset',
          actorMemberId: member.id,
          actorName: member.displayName,
          memberId: member.id,
          params: { memberName: member.displayName, viaCli: true },
        },
        now,
      );
    });

    process.stdout.write(
      `\n  Two-factor authentication cleared for ${email}.\n` +
        `  They sign in with their password, and set up an authenticator again\n` +
        `  on the next request if this workspace still requires one.\n\n`,
    );
  } finally {
    await client.close();
  }
}

await main();
