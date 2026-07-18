import * as argon2 from 'argon2';
import { DataSource } from 'typeorm';
import { UserRole } from '@inventory/shared';
import { User } from '../../src/modules/users/entities/user.entity';

export interface TestUserSpec {
  email: string;
  password: string;
  role: UserRole;
  displayName?: string;
  mustChangePassword?: boolean;
  isActive?: boolean;
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
