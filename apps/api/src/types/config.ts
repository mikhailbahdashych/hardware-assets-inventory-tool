// What `loadConfig()` (src/config.ts) produces: the whole environment, read
// once, in one shape. Zero-config by design — every value has a self-hosting
// default, and an instance with no SMTP at all is a supported way to run this.

/**
 * SMTP credentials. Half a credential is no credential, so this is either both
 * fields or `null` — a relay on a private network often wants neither.
 */
export interface SmtpAuth {
  user: string;
  pass: string;
}

/** Where mail goes. `null` on `Config.smtp` means "this instance sends none". */
export interface SmtpConfig {
  host: string;
  port: number;
  /** Implicit TLS (port 465). STARTTLS on 587 is negotiated, not this flag. */
  secure: boolean;
  /** Relays on a private network often need none. */
  auth: SmtpAuth | null;
  from: string;
}

/**
 * Which database this instance runs on. Not a setting anybody chooses by name:
 * it is derived from whether `DATABASE_URL` is present, so a deployment picks
 * an engine by pointing at one.
 */
export type Engine = 'sqlite' | 'postgres';

export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  host: string;
  /**
   * The one directory to back up: the SQLite file lives in it and uploaded
   * attachments always do, on either engine.
   */
  dataDir: string;
  /** A `postgres://` connection string, or undefined for the SQLite file. */
  databaseUrl?: string;
  /** `postgres` exactly when `databaseUrl` is set. */
  engine: Engine;
  appUrl: string;
  cookieSecure: boolean;
  logLevel: string;
  /** What Fastify should believe about `X-Forwarded-For`; `false` unless set. */
  trustProxy: boolean | number | string[];
  /** Absolute path to the built SPA; when set (and existing) the API serves it. */
  webDist?: string;
  smtp: SmtpConfig | null;
}
