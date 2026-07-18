export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  database: {
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
    name: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessTtl: process.env.ACCESS_TOKEN_TTL ?? '15m',
    refreshTtl: process.env.REFRESH_TOKEN_TTL ?? '7d',
  },
  encryptionKey: process.env.APP_ENCRYPTION_KEY,
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  /** Internal test escape hatch — not part of the documented .env contract. */
  throttleDisabled: process.env.THROTTLE_DISABLED === 'true',
  mfaEnforceAll: process.env.MFA_ENFORCE_ALL === 'true',
  swaggerEnabled: process.env.SWAGGER_ENABLED !== 'false',
});
