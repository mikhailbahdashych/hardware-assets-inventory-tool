/** Case-insensitive boolean env parsing ('true'/'TRUE'/'True' all count). */
const bool = (value: string | undefined): boolean => String(value).toLowerCase() === 'true';

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
  cookieSecure: bool(process.env.COOKIE_SECURE),
  /** Enable when running behind a reverse proxy so req.ip is the real client. */
  trustProxy: bool(process.env.TRUST_PROXY),
  mfaEnforceAll: bool(process.env.MFA_ENFORCE_ALL),
  swaggerEnabled: process.env.SWAGGER_ENABLED !== 'false',
  /** Internal test escape hatch — ignored in production builds. */
  throttleDisabled: bool(process.env.THROTTLE_DISABLED),
});
