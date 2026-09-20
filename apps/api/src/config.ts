import { resolve } from 'node:path';
import { z } from 'zod';
import type { Config } from '@/types/config.js';

// Zero-config by design: every value has a sensible self-hosting default.
// There is no mail configuration to get wrong — invitations and resets are
// copyable links, and notifications live in the in-app inbox.
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
  // Present means the bucket, absent means the uploads directory under
  // DATA_DIR — the only way an instance picks where attachments live. The rest
  // describe how to reach it: a region for AWS, an endpoint and path-style
  // addressing for the MinIO-compatible stores that have neither.
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z
    .url()
    .refine((value) => /^https?:\/\//i.test(value), 'S3_ENDPOINT must be an http(s) URL')
    .optional(),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).optional(),
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
    s3Bucket: parsed.S3_BUCKET,
    s3Region: parsed.S3_REGION,
    s3Endpoint: parsed.S3_ENDPOINT,
    s3ForcePathStyle: parsed.S3_FORCE_PATH_STYLE === 'true',
  };
}

/**
 * `true`, `false`, or a comma-separated list of trusted addresses, CIDRs or
 * proxy-addr presets (`loopback`, `uniquelocal`) — never a hop count. fastify
 * 5.12.1 disabled the numeric form (GHSA-3m5p-2c4r-xxw2: a hop count cannot
 * verify the connecting address) and now compiles it to "trust nothing",
 * silently — so a number is refused here, at boot, with the migration in the
 * message, instead of running with rate limits that share one bucket.
 */
function readTrustProxy(value: string | undefined): boolean | string[] {
  if (value === undefined || value === '' || value === 'false') return false;
  if (value === 'true') return true;
  if (/^\d+$/.test(value.trim())) {
    throw new Error(
      `TRUST_PROXY=${value.trim()} is a hop count, which fastify no longer supports ` +
        '(GHSA-3m5p-2c4r-xxw2 — a hop count cannot verify the connecting address). ' +
        'Name the proxy instead: its address or CIDR (TRUST_PROXY=10.0.0.0/16), or ' +
        'TRUST_PROXY=loopback,uniquelocal for a proxy on the same host. ' +
        'docs/deployment.md has the details.',
    );
  }
  return value.split(',').map((entry) => entry.trim());
}
