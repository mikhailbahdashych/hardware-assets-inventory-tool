import { EntityManager, IsNull } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { MfaRecoveryCode } from './entities/mfa-recovery-code.entity';

/**
 * Clears a user's MFA enrollment (secret, flag, verification, replay stamp,
 * recovery codes) and revokes every live session — resets are usually
 * compromise-driven, so nothing may survive. Enforcement flags are left
 * untouched: an enforced user re-enrolls at next login.
 *
 * Shared by the CLI escape hatch and the admin reset endpoint; callers own
 * the audit entry (different actors/metadata).
 */
export async function resetUserMfa(manager: EntityManager, user: User): Promise<void> {
  user.mfaSecret = null;
  user.mfaEnabled = false;
  user.mfaVerifiedAt = null;
  user.mfaLastUsedStep = null;
  await manager.save(user);
  await manager.delete(MfaRecoveryCode, { userId: user.id });
  await manager.update(
    RefreshToken,
    { userId: user.id, revokedAt: IsNull() },
    { revokedAt: new Date() },
  );
}
