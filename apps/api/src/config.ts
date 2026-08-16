import { z } from 'zod';

// Zero-config by design: every value has a sensible self-hosting default.
// SMTP settings arrive with the notifications PR.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATA_DIR: z.string().default('./data'),
  APP_URL: z.url().default('http://localhost:3000'),
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  LOG_LEVEL: z.string().default('info'),
  WEB_DIST: z.string().optional(),
});

export type Config = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  host: string;
  dataDir: string;
  appUrl: string;
  cookieSecure: boolean;
  logLevel: string;
  /** Absolute path to the built SPA; when set (and existing) the API serves it. */
  webDist?: string;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = envSchema.parse(env);
  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    host: parsed.HOST,
    dataDir: parsed.DATA_DIR,
    appUrl: parsed.APP_URL,
    cookieSecure:
      parsed.COOKIE_SECURE !== undefined
        ? parsed.COOKIE_SECURE === 'true'
        : parsed.APP_URL.startsWith('https://'),
    logLevel: parsed.LOG_LEVEL,
    webDist: parsed.WEB_DIST,
  };
}
