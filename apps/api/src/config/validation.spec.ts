import { validationSchema } from './validation';

const validEnv = {
  POSTGRES_DB: 'inventory',
  POSTGRES_USER: 'inventory',
  POSTGRES_PASSWORD: 'x',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  APP_ENCRYPTION_KEY: 'c0ffee'.repeat(10) + 'c0ff', // 64 hex chars
};

describe('env validation schema', () => {
  it('accepts a valid env and applies defaults', () => {
    const result = validationSchema.validate(validEnv, { allowUnknown: true });
    const value = result.value as Record<string, unknown>;
    expect(result.error).toBeUndefined();
    expect(value.POSTGRES_HOST).toBe('localhost');
    expect(value.POSTGRES_PORT).toBe(5432);
    expect(value.PORT).toBe(3000);
    expect(value.COOKIE_SECURE).toBe(false);
    expect(value.MFA_ENFORCE_ALL).toBe(false);
    expect(value.SWAGGER_ENABLED).toBe(true);
  });

  it('rejects short JWT secrets and non-hex encryption keys', () => {
    expect(
      validationSchema.validate(
        { ...validEnv, JWT_ACCESS_SECRET: 'too-short' },
        { allowUnknown: true },
      ).error?.message,
    ).toContain('JWT_ACCESS_SECRET');
    expect(
      validationSchema.validate(
        { ...validEnv, APP_ENCRYPTION_KEY: 'z'.repeat(64) },
        { allowUnknown: true },
      ).error?.message,
    ).toContain('APP_ENCRYPTION_KEY');
  });

  it.each([
    'POSTGRES_DB',
    'POSTGRES_USER',
    'POSTGRES_PASSWORD',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'APP_ENCRYPTION_KEY',
  ])('rejects env missing %s', (key) => {
    const env: Record<string, string> = { ...validEnv };
    delete env[key];
    const { error } = validationSchema.validate(env, { allowUnknown: true });
    expect(error?.message).toContain(key);
  });
});
