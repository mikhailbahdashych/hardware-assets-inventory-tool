// What `loadConfig()` (src/config.ts) produces: the whole environment, read
// once, in one shape. Zero-config by design — every value has a self-hosting
// default, and an instance with nothing set at all is a supported way to run.

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
  trustProxy: boolean | string[];
  /** Absolute path to the built SPA; when set (and existing) the API serves it. */
  webDist?: string;
  /**
   * The bucket attachments live in, or undefined for the uploads directory
   * under `dataDir`. Named exactly like `databaseUrl`: a deployment picks where
   * its files go by naming the thing they go into.
   */
  s3Bucket?: string;
  s3Region?: string;
  /** A MinIO-compatible store's own endpoint. AWS is addressed by region. */
  s3Endpoint?: string;
  /** Path-style addressing, for stores that have no virtual-host names. */
  s3ForcePathStyle: boolean;
}
