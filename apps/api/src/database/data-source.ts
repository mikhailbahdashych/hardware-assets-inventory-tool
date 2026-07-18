import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { DataSource, DataSourceOptions } from 'typeorm';
import { SnakeNamingStrategy } from './snake-naming.strategy';
import { User } from '../modules/users/entities/user.entity';
import { RefreshToken } from '../modules/auth/entities/refresh-token.entity';
import { MfaRecoveryCode } from '../modules/auth/entities/mfa-recovery-code.entity';
import { Employee } from '../modules/employees/entities/employee.entity';
import { AssetType } from '../modules/asset-types/entities/asset-type.entity';
import { Asset } from '../modules/assets/entities/asset.entity';
import { Assignment } from '../modules/assignments/entities/assignment.entity';
import { AuditLog } from '../modules/audit/entities/audit-log.entity';

// TypeORM 1.x does not auto-load .env. The API's cwd is apps/api under npm
// workspace scripts; the repo root .env is two levels up. Real env vars
// (docker/CI) always win — dotenv never overrides existing values.
loadEnv({ path: resolve(process.cwd(), '../../.env') });

/** Explicit list — glob patterns break after build and hide wiring mistakes. */
export const entities = [
  User,
  RefreshToken,
  MfaRecoveryCode,
  Employee,
  AssetType,
  Asset,
  Assignment,
  AuditLog,
];

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
  // No fallbacks for credentials/database: a missing .env must fail loud
  // (the runtime has Joi for this; the bare CLI path gets it from pg errors).
  database: process.env.POSTGRES_DB,
  username: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  entities,
  // Path-anchored to this file's own directory so it works from both src (CLI
  // via ts-node) and dist (runtime) — the one deliberate glob: migration files
  // are append-only and name-ordered.
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  namingStrategy: new SnakeNamingStrategy(),
  // gen_random_uuid() is built into PG >= 13 — pgcrypto keeps the generator
  // emitting it (instead of uuid-ossp's uuid_generate_v4).
  uuidExtension: 'pgcrypto',
  synchronize: false,
};

export default new DataSource(dataSourceOptions);
