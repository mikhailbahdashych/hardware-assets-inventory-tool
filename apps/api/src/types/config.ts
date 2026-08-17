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

export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  host: string;
  dataDir: string;
  appUrl: string;
  cookieSecure: boolean;
  logLevel: string;
  /** Absolute path to the built SPA; when set (and existing) the API serves it. */
  webDist?: string;
  smtp: SmtpConfig | null;
}
