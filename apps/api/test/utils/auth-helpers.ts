import * as argon2 from 'argon2';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '@inventory/shared';
import { User } from '../../src/modules/users/entities/user.entity';
import { CryptoService } from '../../src/modules/auth/crypto.service';
import { TotpService } from '../../src/modules/auth/totp.service';

export interface TestUserSpec {
  email: string;
  password: string;
  role: UserRole;
  displayName?: string;
  mustChangePassword?: boolean;
  isActive?: boolean;
}

/**
 * Enrolls a user in MFA directly (bypassing the API): generates a TOTP
 * secret, stores it encrypted, flips the flag. Returns the RAW base32
 * secret so tests can compute real codes.
 */
export async function enableMfaDirectly(
  app: INestApplication,
  ds: DataSource,
  email: string,
): Promise<string> {
  const secret = app.get(TotpService).generateSecret();
  const encrypted = app.get(CryptoService).encrypt(secret);
  await ds
    .getRepository(User)
    .update({ email: email.toLowerCase() }, { mfaSecret: encrypted, mfaEnabled: true });
  return secret;
}

/** Inserts a user directly (bypassing the API) for e2e scenarios. */
export async function createUser(ds: DataSource, spec: TestUserSpec): Promise<User> {
  const repo = ds.getRepository(User);
  return repo.save(
    repo.create({
      email: spec.email.toLowerCase(),
      passwordHash: await argon2.hash(spec.password, { type: argon2.argon2id }),
      displayName: spec.displayName ?? spec.email.split('@')[0],
      role: spec.role,
      mustChangePassword: spec.mustChangePassword ?? false,
      isActive: spec.isActive ?? true,
    }),
  );
}
