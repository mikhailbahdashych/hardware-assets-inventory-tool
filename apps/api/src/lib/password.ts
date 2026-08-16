import { hash, verify } from '@node-rs/argon2';

export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// Verified against unknown emails too, so login timing does not reveal
// whether an account exists.
export const DUMMY_HASH_PROMISE = hash('dummy-password-for-uniform-timing');
