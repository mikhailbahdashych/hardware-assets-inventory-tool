import { resolve } from 'node:path';
import { z } from 'zod';
import type { Config, SmtpConfig } from '@/types/config.js';

// Zero-config by design: every value has a sensible self-hosting default, and
// an instance with no SMTP at all is a supported way to run this — invitations
// and password resets are copyable links either way.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATA_DIR: z.string().default('./data'),
  // Present means Postgres, absent means the SQLite file — the only way an
  // instance picks an engine. The scheme is checked rather than assumed: a
  // `mysql://` or a `file:` here is a deployment that thinks it is running on
  // something this app cannot talk to, and finding that out at the first query
  // is worse than finding it out at boot.
  DATABASE_URL: z
    .string()
    .refine(
      (value) => /^postgres(ql)?:\/\//i.test(value),
      'DATABASE_URL must be a postgres:// or postgresql:// URL',
    )
    .optional(),
  // http(s) only: APP_URL is the base of every invitation and reset link, and
  // z.url() alone would happily accept `javascript:` — which is a scheme that
  // executes when somebody clicks the link in their email.
  APP_URL: z
    .url()
    .refine((value) => /^https?:\/\//i.test(value), 'APP_URL must be an http(s) URL')
    .default('http://localhost:3000'),
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  LOG_LEVEL: z.string().default('info'),
  /**
   * Whether an upstream proxy's `X-Forwarded-For` may be believed. Off by
   * default, because trusting that header when nothing sets it lets any client
   * claim any address — and rate limits are keyed on the result.
   */
  TRUST_PROXY: z.string().optional(),
  WEB_DIST: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z.enum(['true', 'false']).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('Inventory <inventory@localhost>'),
});

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = envSchema.parse(env);
  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    host: parsed.HOST,
    dataDir: parsed.DATA_DIR,
    databaseUrl: parsed.DATABASE_URL,
    engine: parsed.DATABASE_URL ? 'postgres' : 'sqlite',
    appUrl: parsed.APP_URL,
    cookieSecure:
      parsed.COOKIE_SECURE !== undefined
        ? parsed.COOKIE_SECURE === 'true'
        : parsed.APP_URL.startsWith('https://'),
    logLevel: parsed.LOG_LEVEL,
    trustProxy: readTrustProxy(parsed.TRUST_PROXY),
    // fastify-static needs an absolute root.
    webDist: parsed.WEB_DIST ? resolve(parsed.WEB_DIST) : undefined,
    smtp: readSmtp(parsed),
  };
}

/**
 * `true`, `false`, a hop count, or a comma-separated list of trusted addresses
 * — the shapes Fastify accepts, so an operator can name their proxy's subnet
 * rather than trusting whatever arrives.
 */
function readTrustProxy(value: string | undefined): boolean | number | string[] {
  if (value === undefined || value === '' || value === 'false') return false;
  if (value === 'true') return true;
  const hops = Number(value);
  if (Number.isInteger(hops) && hops > 0) return hops;
  return value.split(',').map((entry) => entry.trim());
}

/**
 * A host is what makes an instance able to send at all — the rest have
 * defaults. No host is not a misconfiguration: the invite and reset flows are
 * built around copyable links precisely so a workspace can run without email.
 */
function readSmtp(parsed: z.infer<typeof envSchema>): SmtpConfig | null {
  if (!parsed.SMTP_HOST) return null;
  return {
    host: parsed.SMTP_HOST,
    port: parsed.SMTP_PORT,
    // Port 465 is implicit TLS; 587 negotiates STARTTLS and must not set this.
    secure:
      parsed.SMTP_SECURE !== undefined ? parsed.SMTP_SECURE === 'true' : parsed.SMTP_PORT === 465,
    // Half a credential is no credential — a relay that wanted one will say so.
    auth:
      parsed.SMTP_USER && parsed.SMTP_PASS
        ? { user: parsed.SMTP_USER, pass: parsed.SMTP_PASS }
        : null,
    from: parsed.SMTP_FROM,
  };
}
