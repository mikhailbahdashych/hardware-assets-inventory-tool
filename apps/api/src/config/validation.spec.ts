import { validationSchema } from './validation';

const validEnv = {
  POSTGRES_DB: 'inventory',
  POSTGRES_USER: 'inventory',
  POSTGRES_PASSWORD: 'x',
  JWT_ACCESS_SECRET: 'secret-a',
  JWT_REFRESH_SECRET: 'secret-b',
  APP_ENCRYPTION_KEY: 'secret-c',
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
