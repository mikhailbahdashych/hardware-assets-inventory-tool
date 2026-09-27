import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '@/types/config.js';
import { describeStore } from '@/db/client.js';
import { uploadsDir } from './storage.js';

/**
 * The one line an operator reads in `docker logs` to learn what this boot
 * engaged: which database (the SQLite directory, or the Postgres host and
 * database — never the credentials in DATABASE_URL), where uploads go (the
 * volume, or the bucket), and how many migrations it just applied. Operations,
 * so pino, never the activity log.
 */
export function logBoot(log: FastifyBaseLogger, config: Config, migrationsApplied: number): void {
  const storage =
    config.s3Bucket === undefined
      ? { storage: 'local', uploads: uploadsDir(config) }
      : { storage: 's3', bucket: config.s3Bucket, region: config.s3Region };
  log.info(
    { engine: config.engine, database: describeStore(config), ...storage, migrationsApplied },
    'database and storage engaged',
  );
}
