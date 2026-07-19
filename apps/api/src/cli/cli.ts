/**
 * Operational escape hatches, run inside the api container / dev checkout:
 *
 *   npm run cli -- reset-mfa <email>
 *
 * reset-mfa clears a user's TOTP secret, recovery codes, and enabled flag
 * (enforcement flags are left untouched — an enforced user re-enrolls at
 * next login). The action is audit-logged with metadata { cli: true }.
 */
import { IsNull } from 'typeorm';
import { AuditAction } from '@inventory/shared';
import dataSource from '../database/data-source';
import { User } from '../modules/users/entities/user.entity';
import { RefreshToken } from '../modules/auth/entities/refresh-token.entity';
import { MfaRecoveryCode } from '../modules/auth/entities/mfa-recovery-code.entity';
import { AuditLog } from '../modules/audit/entities/audit-log.entity';

async function resetMfa(email: string): Promise<void> {
  const users = dataSource.getRepository(User);
  const user = await users.findOne({ where: { email: email.toLowerCase() } });
  if (!user) throw new Error(`no user with email ${email}`);

  user.mfaSecret = null;
  user.mfaEnabled = false;
  user.mfaVerifiedAt = null;
  user.mfaLastUsedStep = null;
  await users.save(user);
  await dataSource.getRepository(MfaRecoveryCode).delete({ userId: user.id });
  // Compromise-driven resets must not leave live sessions behind.
  await dataSource
    .getRepository(RefreshToken)
    .update({ userId: user.id, revokedAt: IsNull() }, { revokedAt: new Date() });

  await dataSource.getRepository(AuditLog).save(
    dataSource.getRepository(AuditLog).create({
      actorId: null,
      actorEmail: null,
      action: AuditAction.MFA_RESET,
      entityType: 'User',
      entityId: user.id,
      metadata: { cli: true, targetEmail: user.email },
    }),
  );

  console.log(`MFA reset for ${user.email}.`);
  if (user.mfaEnforced) console.log('MFA is enforced — they will re-enroll at next login.');
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  await dataSource.initialize();
  try {
    switch (command) {
      case 'reset-mfa': {
        if (!args[0]) throw new Error('usage: cli reset-mfa <email>');
        await resetMfa(args[0]);
        break;
      }
      default:
        throw new Error(`unknown command "${command ?? ''}" — available: reset-mfa <email>`);
    }
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
