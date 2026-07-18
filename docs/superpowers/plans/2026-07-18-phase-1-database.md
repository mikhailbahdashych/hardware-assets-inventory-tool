# Phase 1: Database Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** All 8 TypeORM entities, a single env-driven data-source used by CLI and runtime, an Init migration (reviewed SQL incl. partial unique indexes) plus a SeedAssetTypes migration, migrations auto-run on boot, Joi-validated config, terminus DB health check, and a schema e2e suite proving the whole thing against `inventory_test` — with CI running e2e against a real Postgres service container.

**Architecture:** Entities live in their future module directories (`modules/<name>/entities/`). One `data-source.ts` exports `dataSourceOptions` (explicit entity+migration arrays, no globs) consumed by both the TypeORM CLI and `TypeOrmModule.forRootAsync` (which adds `migrationsRun: true`). snake_case naming comes from a small local `SnakeNamingStrategy` (no community dep — TypeORM 1.x compat under our control); table names are explicit in each `@Entity('table_name')`.

**Tech Stack:** TypeORM 1.1.x (pin exact; `legacy` 0.3 NOT used), @nestjs/typeorm ^11.0.1 (v11.0.0 is broken with TypeORM 1.x — registers removed `Connection`), pg, dotenv (TypeORM 1.x no longer auto-loads .env), @nestjs/config + joi, @nestjs/terminus.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-18-inventory-app-design.md`. Branch: `feat/phase-1-database`. Working dir: `/Users/mikhail.bahdashych/Projects/software-inventory-tool`.
- **Node:** every node/npm/npx command MUST first run `export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"`.
- **Never enable `synchronize`.** Schema changes exist ONLY as migrations. `migrationsRun: true` at runtime; CLI never auto-runs.
- **TypeORM 1.x conventions:** null/undefined in where-clauses THROW — always use `IsNull()`; `nullable: false` relations produce INNER JOINs; partial indexes via `@Index({ where })`.
- Local dev DB: reads root `.env` (this machine: `POSTGRES_PORT=5433`, db container already running healthy). Test DB: `inventory_test` on the same server. The API workspace has cwd `apps/api` when run via npm workspace scripts — `.env` is at `../../.env` relative to that.
- Column naming: DB snake_case, TS camelCase (via SnakeNamingStrategy). Table names explicit and plural in `@Entity()`.
- uuid PKs must default to `gen_random_uuid()` (PG ≥13 built-in). If a generated migration emits `uuid_generate_v4()`/`uuid-ossp`, rewrite it to `gen_random_uuid()` during migration review.
- Commits: conventional style + trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; commit per task. Do NOT push.
- Do not build anything from later phases (no auth logic, no DTOs, no controllers beyond health, no seed:demo CLI).
- Enum VALUES come from `@inventory/shared` (`UserRole`, `AssetStatus`, `AuditAction`) — never redeclare them.

---

### Task 1: Config module with Joi validation

**Files:**
- Create: `apps/api/src/config/configuration.ts`, `apps/api/src/config/validation.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/package.json` (deps), `tsconfig.base.json` (moduleResolution modernization)
- Test: `apps/api/src/config/validation.spec.ts`

**Interfaces:**
- Consumes: root `.env` contract (Phase 0).
- Produces: global `ConfigModule` with validated env; `configuration()` factory returning `{ port, database: { host, port, name, user, password }, jwt: { accessSecret, refreshSecret, accessTtl, refreshTtl }, encryptionKey, cookieSecure, mfaEnforceAll, swaggerEnabled }` — later tasks/phases read config via these exact paths (e.g. `config.get('database.host')`).

- [ ] **Step 1: Install deps** (from repo root): `npm i -w @inventory/api @nestjs/config joi`

- [ ] **Step 2: Modernize base tsconfig** — in `tsconfig.base.json` change `"module": "commonjs", "moduleResolution": "node"` to `"module": "node16", "moduleResolution": "node16"`. Then `npm run build -w @inventory/shared && npm run build -w @inventory/api && npm run test` — shared is plain CJS with `main`/`types`, expect zero fallout; if shared emit breaks, set `"type": "commonjs"` explicitly in `packages/shared/package.json`.

- [ ] **Step 3: Write the failing validation test** — `apps/api/src/config/validation.spec.ts`:

```typescript
import { validationSchema } from './validation';

const validEnv = {
  POSTGRES_DB: 'inventory',
  POSTGRES_USER: 'inventory',
  POSTGRES_PASSWORD: 'x',
  JWT_ACCESS_SECRET: 'secret-a',
  JWT_REFRESH_SECRET: 'secret-b',
  APP_ENCRYPTION_KEY: 'secret-c',
};

describe('env validation schema', () => {
  it('accepts a valid env and applies defaults', () => {
    const { error, value } = validationSchema.validate(validEnv, { allowUnknown: true });
    expect(error).toBeUndefined();
    expect(value.POSTGRES_HOST).toBe('localhost');
    expect(value.POSTGRES_PORT).toBe(5432);
    expect(value.PORT).toBe(3000);
    expect(value.COOKIE_SECURE).toBe(false);
    expect(value.MFA_ENFORCE_ALL).toBe(false);
    expect(value.SWAGGER_ENABLED).toBe(true);
  });

  it.each(['POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'APP_ENCRYPTION_KEY'])(
    'rejects env missing %s',
    (key) => {
      const env: Record<string, string> = { ...validEnv };
      delete env[key];
      const { error } = validationSchema.validate(env, { allowUnknown: true });
      expect(error?.message).toContain(key);
    },
  );
});
```

- [ ] **Step 4: Run it, expect FAIL** (`npm run test -w @inventory/api`) — module not found.

- [ ] **Step 5: Implement** —

`apps/api/src/config/validation.ts`:
```typescript
import * as Joi from 'joi';

export const validationSchema = Joi.object({
  POSTGRES_HOST: Joi.string().default('localhost'),
  POSTGRES_PORT: Joi.number().port().default(5432),
  POSTGRES_DB: Joi.string().required(),
  POSTGRES_USER: Joi.string().required(),
  POSTGRES_PASSWORD: Joi.string().required(),
  PORT: Joi.number().port().default(3000),
  JWT_ACCESS_SECRET: Joi.string().min(8).required(),
  JWT_REFRESH_SECRET: Joi.string().min(8).required(),
  APP_ENCRYPTION_KEY: Joi.string().min(8).required(),
  ACCESS_TOKEN_TTL: Joi.string().default('15m'),
  REFRESH_TOKEN_TTL: Joi.string().default('7d'),
  COOKIE_SECURE: Joi.boolean().default(false),
  MFA_ENFORCE_ALL: Joi.boolean().default(false),
  SWAGGER_ENABLED: Joi.boolean().default(true),
});
```

`apps/api/src/config/configuration.ts`:
```typescript
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
  mfaEnforceAll: process.env.MFA_ENFORCE_ALL === 'true',
  swaggerEnabled: process.env.SWAGGER_ENABLED !== 'false',
});
```

`apps/api/src/app.module.ts` (full replacement):
```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { validationSchema } from './config/validation';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
      envFilePath: ['.env', '../../.env'],
    }),
    HealthModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 6: Run tests + e2e, expect PASS.** Note: the existing health e2e boots AppModule — it now requires env. Running from `apps/api`, `envFilePath: ['../../.env']` finds the root `.env` (exists on this machine). Verify `npm run test -w @inventory/api && npm run test:e2e -w @inventory/api` both green, plus `npm run lint`.

- [ ] **Step 7: Commit** — `feat(api): validated env configuration (Joi + @nestjs/config)`

---

### Task 2: SnakeNamingStrategy (TDD)

**Files:**
- Create: `apps/api/src/database/snake-naming.strategy.ts`
- Modify: `apps/api/package.json` (deps)
- Test: `apps/api/src/database/snake-naming.strategy.spec.ts`

**Interfaces:**
- Produces: `export class SnakeNamingStrategy extends DefaultNamingStrategy implements NamingStrategyInterface` — used by Task 5's data-source. Column `mfaEnabled` → `mfa_enabled`; join column `assetType` + `id` → `asset_type_id`.

- [ ] **Step 1: Install DB deps** (from repo root): `npm i -w @inventory/api typeorm@1.1.0 @nestjs/typeorm@^11.0.1 pg dotenv` — verify afterwards with `npm ls typeorm @nestjs/typeorm -w @inventory/api` that typeorm resolved to exactly 1.1.0 and @nestjs/typeorm to ≥11.0.1.

- [ ] **Step 2: Write the failing test** — `apps/api/src/database/snake-naming.strategy.spec.ts`:

```typescript
import { SnakeNamingStrategy } from './snake-naming.strategy';

describe('SnakeNamingStrategy', () => {
  const s = new SnakeNamingStrategy();

  it('snake_cases column names from property names', () => {
    expect(s.columnName('mfaEnabled', '', [])).toBe('mfa_enabled');
    expect(s.columnName('createdAt', '', [])).toBe('created_at');
    expect(s.columnName('id', '', [])).toBe('id');
  });

  it('respects explicit custom column names', () => {
    expect(s.columnName('whatever', 'custom_name', [])).toBe('custom_name');
  });

  it('prefixes embedded columns', () => {
    expect(s.columnName('street', '', ['home', 'address'])).toBe('home_address_street');
  });

  it('snake_cases join columns as relation_referencedColumn', () => {
    expect(s.joinColumnName('assetType', 'id')).toBe('asset_type_id');
    expect(s.joinColumnName('assignedBy', 'id')).toBe('assigned_by_id');
  });

  it('snake_cases relation constraint parts', () => {
    expect(s.relationName('assetType')).toBe('asset_type');
  });
});
```

- [ ] **Step 3: Run, expect FAIL** (module not found).

- [ ] **Step 4: Implement** — `apps/api/src/database/snake-naming.strategy.ts`:

```typescript
import { DefaultNamingStrategy, NamingStrategyInterface } from 'typeorm';

const snakeCase = (name: string): string =>
  name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/([A-Z])([A-Z][a-z])/g, '$1_$2').toLowerCase();

/**
 * DB identifiers are snake_case while TS properties stay camelCase.
 * Table names are NOT derived here — every entity declares its table
 * explicitly via @Entity('table_name').
 */
export class SnakeNamingStrategy extends DefaultNamingStrategy implements NamingStrategyInterface {
  override columnName(propertyName: string, customName: string, embeddedPrefixes: string[]): string {
    const prefix = embeddedPrefixes.map(snakeCase).join('_');
    const base = customName || snakeCase(propertyName);
    return prefix ? `${prefix}_${base}` : base;
  }

  override relationName(propertyName: string): string {
    return snakeCase(propertyName);
  }

  override joinColumnName(relationName: string, referencedColumnName: string): string {
    return `${snakeCase(relationName)}_${snakeCase(referencedColumnName)}`;
  }

  override joinTableColumnName(tableName: string, propertyName: string, columnName?: string): string {
    return `${snakeCase(tableName)}_${columnName || snakeCase(propertyName)}`;
  }
}
```

If TypeORM 1.x's `DefaultNamingStrategy` method signatures differ from these (compile error will say so), adapt the override signatures to the installed version's `NamingStrategyInterface` — the test expectations stay the same; document any signature drift in your report.

- [ ] **Step 5: Run, expect PASS**; run `npm run lint && npm run build -w @inventory/api`.

- [ ] **Step 6: Commit** — `feat(api): local SnakeNamingStrategy for snake_case DB identifiers`

---

### Task 3: Identity entities (User, RefreshToken, MfaRecoveryCode)

**Files:**
- Create: `apps/api/src/modules/users/entities/user.entity.ts`, `apps/api/src/modules/auth/entities/refresh-token.entity.ts`, `apps/api/src/modules/auth/entities/mfa-recovery-code.entity.ts`
- Modify: `apps/api/package.json` (add `"@inventory/shared": "0.1.0"` to dependencies, then root `npm install`)
- Test: compile-level only this task (`npm run build -w @inventory/api`); schema proven in Task 6.

**Interfaces:**
- Consumes: `UserRole` from `@inventory/shared`.
- Produces (exact class/property names later phases use): `User { id, email, passwordHash, provider, displayName, role, isActive, mustChangePassword, mfaEnabled, mfaEnforced, mfaSecret, mfaVerifiedAt, lastLoginAt, createdAt, updatedAt }`; `RefreshToken { id, user, userId, tokenHash, expiresAt, revokedAt, replacedById, ip, userAgent, createdAt }`; `MfaRecoveryCode { id, user, userId, codeHash, usedAt, createdAt }`.

- [ ] **Step 1: user.entity.ts**

```typescript
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { UserRole } from '@inventory/shared';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('uq_users_email', { unique: true })
  @Column({ type: 'varchar', length: 255 })
  email: string;

  /** argon2id hash; NULL reserved for future OIDC-provisioned accounts. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  passwordHash: string | null;

  /** 'local' today; OIDC extension point. */
  @Column({ type: 'varchar', length: 20, default: 'local' })
  provider: string;

  @Column({ type: 'varchar', length: 120 })
  displayName: string;

  @Column({ type: 'varchar', length: 16 })
  role: UserRole;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'boolean', default: false })
  mustChangePassword: boolean;

  @Column({ type: 'boolean', default: false })
  mfaEnabled: boolean;

  @Column({ type: 'boolean', default: false })
  mfaEnforced: boolean;

  /** AES-256-GCM-encrypted TOTP secret (never stored in plaintext). */
  @Column({ type: 'text', nullable: true })
  mfaSecret: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  mfaVerifiedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
```

- [ ] **Step 2: refresh-token.entity.ts**

```typescript
import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Index('ix_refresh_tokens_user_id')
  @Column({ type: 'uuid' })
  userId: string;

  /** sha256 of the opaque token; the raw value only ever lives in the cookie. */
  @Index('uq_refresh_tokens_token_hash', { unique: true })
  @Column({ type: 'varchar', length: 64 })
  tokenHash: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  /** Rotation chain; presenting a replaced token means reuse → revoke the family. */
  @Column({ type: 'uuid', nullable: true })
  replacedById: string | null;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ip: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  userAgent: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
```

- [ ] **Step 3: mfa-recovery-code.entity.ts**

```typescript
import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('mfa_recovery_codes')
export class MfaRecoveryCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Index('ix_mfa_recovery_codes_user_id')
  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 64 })
  codeHash: string;

  @Column({ type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
```

- [ ] **Step 4:** Add `"@inventory/shared": "0.1.0"` to `apps/api/package.json` dependencies; root `npm install`; `npm run build -w @inventory/api && npm run lint && npm run test -w @inventory/api` all green (entities compile; no runtime wiring yet).

- [ ] **Step 5: Commit** — `feat(api): User, RefreshToken, MfaRecoveryCode entities`

---

### Task 4: Domain entities (Employee, AssetType, Asset, Assignment, AuditLog)

**Files:**
- Create: `apps/api/src/modules/employees/entities/employee.entity.ts`, `apps/api/src/modules/asset-types/entities/asset-type.entity.ts`, `apps/api/src/modules/assets/entities/asset.entity.ts`, `apps/api/src/modules/assignments/entities/assignment.entity.ts`, `apps/api/src/modules/audit/entities/audit-log.entity.ts`
- Test: compile-level (`npm run build -w @inventory/api`); schema proven in Task 6.

**Interfaces:**
- Consumes: `AssetStatus`, `AuditAction` from `@inventory/shared`; `User` entity (Task 3).
- Produces: `Employee { id, firstName, lastName, email, employeeNumber, department, title, notes, isActive, createdAt, updatedAt }`; `AssetType { id, name, description, icon, isActive, createdAt, updatedAt }`; `Asset { id, assetTag, serialNumber, name, manufacturer, modelNumber, assetType, assetTypeId, status, purchaseDate, purchasePrice, purchaseCurrency, supplier, warrantyExpiresAt, notes, createdAt, updatedAt }`; `Assignment { id, asset, assetId, employee, employeeId, assignedAt, returnedAt, assignedBy, assignedById, checkedInBy, checkedInById, checkoutNote, checkinNote, createdAt }`; `AuditLog { id, actor, actorId, actorEmail, action, entityType, entityId, before, after, metadata, createdAt }`.

- [ ] **Step 1: employee.entity.ts**

```typescript
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('employees')
@Index('ix_employees_name', ['lastName', 'firstName'])
export class Employee {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  firstName: string;

  @Column({ type: 'varchar', length: 100 })
  lastName: string;

  /** Optional; unique only where present (partial unique index). */
  @Index('uq_employees_email', { unique: true, where: '"email" IS NOT NULL' })
  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  /** External HR identifier; CSV import match key; unique where present. */
  @Index('uq_employees_employee_number', { unique: true, where: '"employee_number" IS NOT NULL' })
  @Column({ type: 'varchar', length: 64, nullable: true })
  employeeNumber: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  department: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  title: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  /** Offboarded people stay for assignment history. */
  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
```

- [ ] **Step 2: asset-type.entity.ts**

```typescript
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Uniqueness is case-insensitive via a hand-written expression index
 * (uq_asset_types_name_lower on lower(name)) added in the Init migration —
 * TypeORM decorators cannot express expression indexes.
 */
@Entity('asset_types')
export class AssetType {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  /** Material icon name, e.g. 'laptop_mac'. */
  @Column({ type: 'varchar', length: 40, nullable: true })
  icon: string | null;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
```

- [ ] **Step 3: asset.entity.ts**

```typescript
import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { AssetStatus } from '@inventory/shared';
import { AssetType } from '../../asset-types/entities/asset-type.entity';

@Entity('assets')
export class Asset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('uq_assets_asset_tag', { unique: true })
  @Column({ type: 'varchar', length: 64 })
  assetTag: string;

  /** Deliberately NOT unique — real-world serials are messy; duplicates surface as UI/import warnings. */
  @Index('ix_assets_serial_number')
  @Column({ type: 'varchar', length: 128, nullable: true })
  serialNumber: string | null;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  manufacturer: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  modelNumber: string | null;

  @ManyToOne(() => AssetType, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'asset_type_id' })
  assetType: AssetType;

  @Index('ix_assets_asset_type_id')
  @Column({ type: 'uuid' })
  assetTypeId: string;

  /** varchar by design (not a PG enum) so adding statuses needs no migration; 'assigned' is only ever set by checkout. */
  @Index('ix_assets_status')
  @Column({ type: 'varchar', length: 16, default: AssetStatus.AVAILABLE })
  status: AssetStatus;

  @Column({ type: 'date', nullable: true })
  purchaseDate: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  purchasePrice: string | null;

  @Column({ type: 'varchar', length: 3, nullable: true })
  purchaseCurrency: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  supplier: string | null;

  @Column({ type: 'date', nullable: true })
  warrantyExpiresAt: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
```

- [ ] **Step 4: assignment.entity.ts**

```typescript
import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Employee } from '../../employees/entities/employee.entity';
import { Asset } from '../../assets/entities/asset.entity';

/**
 * Append-only checkout/checkin ledger. returnedAt IS NULL = current holder.
 * The partial unique index is the race-condition backstop: at most one open
 * assignment per asset, enforced by the database itself.
 */
@Entity('assignments')
@Index('uq_assignments_open_asset', ['assetId'], { unique: true, where: '"returned_at" IS NULL' })
@Index('ix_assignments_employee', ['employeeId', 'returnedAt'])
export class Assignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Asset, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'asset_id' })
  asset: Asset;

  @Column({ type: 'uuid' })
  assetId: string;

  @ManyToOne(() => Employee, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'employee_id' })
  employee: Employee;

  @Column({ type: 'uuid' })
  employeeId: string;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  assignedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  returnedAt: Date | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assigned_by_id' })
  assignedBy: User | null;

  @Column({ type: 'uuid', nullable: true })
  assignedById: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'checked_in_by_id' })
  checkedInBy: User | null;

  @Column({ type: 'uuid', nullable: true })
  checkedInById: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  checkoutNote: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  checkinNote: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
```

- [ ] **Step 5: audit-log.entity.ts**

```typescript
import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { AuditAction } from '@inventory/shared';
import { User } from '../../users/entities/user.entity';

/** Append-only. No update/delete API will ever exist for this table. */
@Entity('audit_logs')
@Index('ix_audit_logs_entity', ['entityType', 'entityId'])
export class AuditLog {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actor_id' })
  actor: User | null;

  @Column({ type: 'uuid', nullable: true })
  actorId: string | null;

  /** Denormalized so history survives account changes/deletion. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  actorEmail: string | null;

  @Column({ type: 'varchar', length: 20 })
  action: AuditAction;

  @Column({ type: 'varchar', length: 32, nullable: true })
  entityType: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  entityId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  before: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  after: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Index('ix_audit_logs_created_at')
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
```

- [ ] **Step 6:** `npm run build -w @inventory/api && npm run lint && npm run test -w @inventory/api` green.

- [ ] **Step 7: Commit** — `feat(api): Employee, AssetType, Asset, Assignment, AuditLog entities`

---

### Task 5: Data-source, migrations, boot wiring, terminus health

**Files:**
- Create: `apps/api/src/database/data-source.ts`, `apps/api/src/database/database.module.ts`, `apps/api/src/database/migrations/<ts>-Init.ts` (generated then reviewed), `apps/api/src/database/migrations/<ts>-SeedAssetTypes.ts` (hand-written)
- Modify: `apps/api/src/app.module.ts` (import DatabaseModule), `apps/api/src/modules/health/health.{module,controller}.ts` (+ spec), `apps/api/test/health.e2e-spec.ts`, `apps/api/package.json` (scripts + @nestjs/terminus), root `package.json` (migration passthrough scripts)

**Interfaces:**
- Consumes: all 8 entities, SnakeNamingStrategy, config env names.
- Produces: `dataSourceOptions: DataSourceOptions` + default-export `new DataSource(dataSourceOptions)`; workspace scripts `migration:generate -- <path>`, `migration:run`, `migration:revert`, `migration:check`; root passthroughs of the same names; health endpoint keeps `GET /api/v1/health` → 200 with `body.status === 'ok'` but now includes a real DB ping (terminus response shape).

- [ ] **Step 1: Install** `npm i -w @inventory/api @nestjs/terminus`

- [ ] **Step 2: data-source.ts**

```typescript
import 'dotenv/config';
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

/** Explicit lists — glob patterns break after build and hide wiring mistakes. */
export const entities = [User, RefreshToken, MfaRecoveryCode, Employee, AssetType, Asset, Assignment, AuditLog];

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
  database: process.env.POSTGRES_DB ?? 'inventory',
  username: process.env.POSTGRES_USER ?? 'inventory',
  password: process.env.POSTGRES_PASSWORD ?? 'inventory',
  entities,
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  namingStrategy: new SnakeNamingStrategy(),
  synchronize: false,
};

export default new DataSource(dataSourceOptions);
```

(Note: the migrations glob is path-anchored to this file's own directory, which survives both ts and dist execution — this is the one deliberate exception to "no globs", because migration files are append-only and name-ordered. If TypeORM 1.x's CLI requires an explicit array instead, switch to importing each migration class and note it.)

- [ ] **Step 3: database.module.ts**

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { dataSourceOptions } from './data-source';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      ...dataSourceOptions,
      autoLoadEntities: false,
      migrationsRun: true,
      retryAttempts: 10,
      retryDelay: 3000,
    }),
  ],
})
export class DatabaseModule {}
```

Import `DatabaseModule` in `AppModule` (after ConfigModule).

- [ ] **Step 4: Wire migration scripts.** In `apps/api/package.json` add scripts (verify the exact CLI invocation empirically — TypeORM 1.x may or may not still ship `typeorm-ts-node-commonjs`; if it's gone, use `tsx ./node_modules/typeorm/cli.js` after `npm i -D -w @inventory/api tsx`, or ts-node equivalent — document what worked):

```json
"typeorm": "typeorm-ts-node-commonjs -d src/database/data-source.ts",
"migration:generate": "npm run typeorm -- migration:generate",
"migration:run": "npm run typeorm -- migration:run",
"migration:revert": "npm run typeorm -- migration:revert",
"migration:check": "npm run typeorm -- migration:generate --check --dryrun src/database/migrations/Check || echo verified"
```

For `migration:check`: the goal is a command that exits 0 when entities and migrations are in sync and nonzero otherwise. TypeORM's generate exits nonzero with "No changes in database schema were found" when in sync — so the working form may be an inverted check like `npm run typeorm -- migration:generate /tmp/Check && (echo 'SCHEMA DRIFT — uncommitted entity changes' && rm -f /tmp/Check*.ts && exit 1) || echo 'schema in sync'`. Verify empirically against the running dev DB and wire whatever form actually works, documenting it. Add root passthroughs in root `package.json`: `"migration:generate": "npm run migration:generate -w @inventory/api --"`, same for `run`/`revert`/`check`.

- [ ] **Step 5: Generate the Init migration** against the dev DB (running, migrations table empty): `npm run migration:generate -- src/database/migrations/Init`. **Then REVIEW the generated SQL** (this is a hard gate, not a formality):
  - uuid defaults are `gen_random_uuid()` — if `uuid_generate_v4()`/`uuid-ossp` appears, rewrite defaults and remove the extension.
  - Partial unique indexes present with their WHERE clauses: `uq_assignments_open_asset` ON assignments(asset_id) WHERE returned_at IS NULL; `uq_employees_email` / `uq_employees_employee_number` WHERE … IS NOT NULL.
  - All FKs have the specified ON DELETE behavior (CASCADE ×2 user-child tables, RESTRICT ×3, SET NULL ×3).
  - All identifiers snake_case; audit_logs.id is BIGSERIAL (or bigint + identity); jsonb columns are jsonb.
  - **Hand-add** to the migration's `up()` (and mirror in `down()`): `CREATE UNIQUE INDEX "uq_asset_types_name_lower" ON "asset_types" (lower("name"))`.

- [ ] **Step 6: Hand-write SeedAssetTypes migration** — `apps/api/src/database/migrations/<ts>-SeedAssetTypes.ts` (use a real timestamp later than Init's):

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

const TYPES: Array<[name: string, icon: string]> = [
  ['Laptop', 'laptop_mac'],
  ['Desktop', 'desktop_windows'],
  ['Monitor', 'monitor'],
  ['Phone', 'smartphone'],
  ['Tablet', 'tablet_mac'],
  ['Peripheral', 'keyboard'],
  ['Server', 'dns'],
  ['Network Device', 'router'],
  ['Software License', 'key'],
  ['Other', 'devices_other'],
];

export class SeedAssetTypes<TS> implements MigrationInterface {
  name = 'SeedAssetTypes<TS>';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [name, icon] of TYPES) {
      await queryRunner.query(
        `INSERT INTO "asset_types" ("name", "icon") VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [name, icon],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "asset_types" WHERE "name" = ANY($1)`, [TYPES.map(([n]) => n)]);
  }
}
```

(Replace `<TS>` with the actual timestamp in both class name and `name` property, matching TypeORM's file-naming convention `<timestamp>-SeedAssetTypes.ts`.)

- [ ] **Step 7: Run migrations against dev DB** — `npm run migration:run`; verify with `docker compose -f docker-compose.dev.yml exec db psql -U inventory -d inventory -c '\d assignments'` that the partial unique index exists, and `SELECT count(*) FROM asset_types` returns 10. Then `npm run migration:check` (or the verified form) reports in-sync.

- [ ] **Step 8: Terminus health.** Update health module/controller:

```typescript
// health.module.ts
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
})
export class HealthModule {}
```

```typescript
// health.controller.ts
import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([() => this.db.pingCheck('database')]);
  }
}
```

Update `health.controller.spec.ts` to mock `HealthCheckService`/`TypeOrmHealthIndicator` (assert `check()` delegates to `health.check` with one indicator) and update `test/health.e2e-spec.ts` to assert `200` with `res.body.status === 'ok'` and `res.body.info.database.status === 'up'` (drop the exact-body `.expect({status:'ok'})`).

- [ ] **Step 9:** Full suite green: `npm run test -w @inventory/api && npm run test:e2e -w @inventory/api && npm run lint && npm run build -w @inventory/api`. NOTE: e2e now needs the DB up (uses root .env → dev DB). Boot check: `npm run start:dev` briefly → log shows migrations already applied, health returns ok with database up; kill robustly (pkill 'nest start', verify port 3000 freed).

- [ ] **Step 10: Commit** — `feat(api): TypeORM data-source, Init+Seed migrations, boot wiring, DB health check`

---

### Task 6: Schema e2e suite + CI Postgres service

**Files:**
- Create: `apps/api/test/utils/configure-app.ts`, `apps/api/test/utils/test-db.ts`, `apps/api/test/schema.e2e-spec.ts`, `apps/api/test/setup-e2e.ts`
- Modify: `apps/api/test/jest-e2e.json` (setupFiles + maxWorkers), `apps/api/test/health.e2e-spec.ts` (use configureApp), `.github/workflows/ci.yml` (postgres service, env, timeout, concurrency)

**Interfaces:**
- Consumes: data-source, migrations, entities.
- Produces: `configureApp(app: INestApplication): INestApplication` (sets global prefix `api/v1`; every future e2e spec uses it); `test/setup-e2e.ts` forcing `process.env.POSTGRES_DB = 'inventory_test'` before anything loads; schema assertions that gate every future entity change.

- [ ] **Step 1: setup + utils**

`apps/api/test/setup-e2e.ts`:
```typescript
// Forces every e2e run onto the throwaway test database BEFORE any module
// (including data-source.ts) reads process.env.
process.env.POSTGRES_DB = 'inventory_test';
```

`apps/api/test/utils/configure-app.ts`:
```typescript
import { INestApplication } from '@nestjs/common';

/** Mirrors main.ts bootstrap configuration — keep the two in sync. */
export function configureApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix('api/v1');
  return app;
}
```

`apps/api/test/utils/test-db.ts`:
```typescript
import { Client } from 'pg';

/** Drops and recreates the public schema of inventory_test for a clean slate. */
export async function resetTestDatabase(): Promise<void> {
  const client = new Client({
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
    database: 'inventory_test',
    user: process.env.POSTGRES_USER ?? 'inventory',
    password: process.env.POSTGRES_PASSWORD ?? 'inventory',
  });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await client.end();
}
```

In `apps/api/test/jest-e2e.json` add `"setupFiles": ["<rootDir>/setup-e2e.ts"], "maxWorkers": 1` (rootDir there is the `test` dir; adjust the path to match the file's actual jest rootDir — verify by running). Note maxWorkers may need to live in the CLI flag or config root depending on jest version — verify e2e still runs single-process.

- [ ] **Step 2: Write schema.e2e-spec.ts** (failing first — migrations haven't run against a fresh inventory_test):

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module';
import { configureApp } from './utils/configure-app';
import { resetTestDatabase } from './utils/test-db';

describe('Database schema (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;

  beforeAll(async () => {
    await resetTestDatabase();
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleFixture.createNestApplication());
    await app.init(); // migrationsRun: true applies all migrations here
    ds = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  it('created all 8 tables plus the migrations table', async () => {
    const rows: Array<{ table_name: string }> = await ds.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
    );
    const names = rows.map((r) => r.table_name);
    for (const t of ['users', 'refresh_tokens', 'mfa_recovery_codes', 'employees', 'asset_types', 'assets', 'assignments', 'audit_logs', 'migrations']) {
      expect(names).toContain(t);
    }
  });

  it('enforces at most one open assignment per asset (partial unique index)', async () => {
    const [{ indexdef }] = await ds.query(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_assignments_open_asset'`,
    );
    expect(indexdef).toContain('UNIQUE');
    expect(indexdef.toLowerCase()).toContain('returned_at is null');
  });

  it('has partial unique indexes on employees email and employee_number', async () => {
    const rows: Array<{ indexname: string; indexdef: string }> = await ds.query(
      `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'employees' AND indexname LIKE 'uq_%'`,
    );
    const byName = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef.toLowerCase()]));
    expect(byName['uq_employees_email']).toContain('is not null');
    expect(byName['uq_employees_employee_number']).toContain('is not null');
  });

  it('enforces case-insensitive asset type names', async () => {
    const [{ indexdef }] = await ds.query(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_asset_types_name_lower'`,
    );
    expect(indexdef).toContain('UNIQUE');
    expect(indexdef.toLowerCase()).toContain('lower');
  });

  it('seeded exactly 10 asset types', async () => {
    const [{ count }] = await ds.query(`SELECT count(*)::int AS count FROM asset_types`);
    expect(count).toBe(10);
  });

  it('uses gen_random_uuid() defaults, not uuid-ossp', async () => {
    const rows: Array<{ column_default: string | null }> = await ds.query(
      `SELECT column_default FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'id'`,
    );
    expect(rows[0].column_default).toContain('gen_random_uuid');
  });

  it('open-assignment uniqueness actually blocks a second open row', async () => {
    await ds.query(`INSERT INTO asset_types (name) VALUES ('TmpType') ON CONFLICT DO NOTHING`);
    const [{ id: typeId }] = await ds.query(`SELECT id FROM asset_types WHERE name = 'TmpType'`);
    const [{ id: assetId }] = await ds.query(
      `INSERT INTO assets (asset_tag, name, asset_type_id) VALUES ('T-1', 'Test', $1) RETURNING id`,
      [typeId],
    );
    const [{ id: empId }] = await ds.query(
      `INSERT INTO employees (first_name, last_name) VALUES ('A', 'B') RETURNING id`,
    );
    await ds.query(`INSERT INTO assignments (asset_id, employee_id) VALUES ($1, $2)`, [assetId, empId]);
    await expect(
      ds.query(`INSERT INTO assignments (asset_id, employee_id) VALUES ($1, $2)`, [assetId, empId]),
    ).rejects.toThrow(/uq_assignments_open_asset|duplicate key/);
  });
});
```

Also refactor `test/health.e2e-spec.ts` to use `configureApp` (replacing its inline `setGlobalPrefix`).

- [ ] **Step 3: Run e2e — expect schema spec to PASS against inventory_test** (health spec also passes; both run serially). `npm run test:e2e -w @inventory/api`.

- [ ] **Step 4: CI update** — `.github/workflows/ci.yml`: add to the `build-and-test` job:

```yaml
    timeout-minutes: 15
    services:
      postgres:
        image: postgres:17-alpine
        env:
          POSTGRES_USER: inventory
          POSTGRES_PASSWORD: inventory
          POSTGRES_DB: inventory_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U inventory"
          --health-interval 5s
          --health-timeout 3s
          --health-retries 10
    env:
      POSTGRES_HOST: localhost
      POSTGRES_PORT: '5432'
      POSTGRES_DB: inventory_test
      POSTGRES_USER: inventory
      POSTGRES_PASSWORD: inventory
      JWT_ACCESS_SECRET: ci-only-secret
      JWT_REFRESH_SECRET: ci-only-secret
      APP_ENCRYPTION_KEY: ci-only-secret
```

and at workflow top level add:

```yaml
concurrency:
  group: ci-${{ github.ref }}
  cancel-when: null
```

Correction: use the standard form `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }`. Keep existing steps; the "API e2e tests" step now exercises the real DB. Local verification of CI parity: run the full local sequence (`npm ci && npm run build -w @inventory/shared && npm run lint && npm run test -w @inventory/api && npm run test:e2e && npm run test:ci -w @inventory/web && npm run build`) with the dev DB up — every step exit 0.

- [ ] **Step 5: Commit** — `feat(api): schema e2e suite against inventory_test; CI Postgres service + hardening`

---

## Self-review notes

- Spec coverage (Phase 1 scope): 8 entities ✓ (T3-T4), data-source explicit arrays ✓ (T5 — migrations use one path-anchored glob, justified inline), Init + SeedAssetTypes ✓ (T5), boot wiring migrationsRun ✓ (T5), config validation ✓ (T1), snake_case ✓ (T2), empty-diff/in-sync check ✓ (T5 script + CI parity), schema tests ✓ (T6), terminus health ✓ (T5), CI service container + Phase-0 deferred hardening (timeout, concurrency) ✓ (T6).
- Deferred-from-Phase-0 items consumed here: @inventory/shared api dep (T3), configureApp helper (T6), moduleResolution modernization (T1), CI timeout/concurrency (T6).
- Known-unknowns with in-task resolution instructions: TypeORM 1.x CLI TS loading (T5 Step 4), DefaultNamingStrategy signatures (T2 Step 4), jest maxWorkers placement (T6 Step 1), migration generate check semantics (T5 Step 4).
- Date columns use TS `string` type (TypeORM returns date as string for 'date' columns); numeric uses string to avoid float precision loss — both deliberate.
- No auth/DTO/controller code — Phase 2 owns that.
