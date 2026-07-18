# Phase 0: Repo Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working npm-workspaces monorepo where `npm run db:up && npm run dev` boots a NestJS API (health endpoint at :3000) and an Angular+Material app (:4200, proxying `/api`), with a shared types package, dev Postgres compose, lint/test/build scripts, and CI.

**Architecture:** Three workspaces — `apps/api` (NestJS 11, CLI-scaffolded), `apps/web` (Angular 22 + Material, CLI-scaffolded), `packages/shared` (`@inventory/shared`, CJS lib of enums/consts/types built first). CLI-generated configs stay app-local (idiomatic for downstream devs); the root owns prettier, orchestration scripts, compose, and CI.

**Tech Stack:** Node 24 LTS (24.18.0 local via nvm), npm workspaces, NestJS 11.1.x, Angular 22.0.x + Angular Material 22, TypeScript (CLI-pinned per app), Jest + supertest (api), Vitest/jsdom (web, Angular 22 CLI default), postgres:17-alpine via Docker Compose, GitHub Actions.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-18-inventory-app-design.md` — this plan implements its "Phase 0" scope only.
- **Node:** every shell command that runs node/npm/npx MUST use Node 24: `export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"` first (Angular 22 rejects the machine-default Node 23).
- Working directory: `/Users/mikhail.bahdashych/Projects/software-inventory-tool` (branch `feat/phase-0-scaffold`).
- Package names: `@inventory/shared`, `@inventory/api`, `@inventory/web`. Workspaces: `["apps/*", "packages/*"]`.
- API global prefix `api/v1`; API port `3000` (env `PORT`); web dev port `4200`; health route `GET /api/v1/health` → `200 {"status":"ok"}`.
- Postgres dev defaults: user/password/db `inventory`, port 5432, plus `inventory_test` DB created by init script.
- Never enable TypeORM `synchronize` (not used in this phase at all — no DB code in Phase 0; health is DB-free until Phase 1).
- Commits: conventional-commit style, each ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` on its own line; commit at the end of every task.
- Do not push and do not add a git remote — local commits only.
- Do not create files the spec assigns to later phases (no Dockerfiles, no prod compose, no TypeORM config, no auth code).

---

### Task 1: Root workspace skeleton

**Files:**

- Create: `package.json`, `.gitignore`, `.editorconfig`, `.prettierrc.json`, `.prettierignore`, `LICENSE`, `tsconfig.base.json`, `.env.example`
- Modify: none

**Interfaces:**

- Produces: root `package.json` with `workspaces: ["apps/*", "packages/*"]` and devDep `concurrently` (used by Task 5 scripts); `tsconfig.base.json` (extended by `packages/shared` in Task 2 and `apps/api` in Task 3); `.env.example` env-var contract for all later phases.

- [ ] **Step 1: Write root package.json**

```json
{
  "name": "software-inventory-tool",
  "version": "0.1.0",
  "private": true,
  "description": "Open-source, self-hosted IT asset inventory. Angular + NestJS + PostgreSQL, deployable with a single docker compose up.",
  "license": "MIT",
  "engines": {
    "node": "^22.22.0 || ^24.15.0 || >=26.0.0"
  },
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "format": "prettier --write .",
    "format:check": "prettier --check ."
  },
  "devDependencies": {
    "concurrently": "^9.1.2",
    "prettier": "^3.6.0"
  }
}
```

(Orchestration scripts `dev`/`db:up`/`build`/`lint`/`test` are added in Task 5 once their targets exist.)

- [ ] **Step 2: Write .gitignore**

```gitignore
node_modules/
dist/
coverage/
.angular/
.env
*.log
.DS_Store
```

- [ ] **Step 3: Write .editorconfig**

```ini
root = true

[*]
charset = utf-8
indent_style = space
indent_size = 2
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
```

- [ ] **Step 4: Write .prettierrc.json and .prettierignore**

`.prettierrc.json`:

```json
{
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100
}
```

`.prettierignore`:

```
dist/
coverage/
.angular/
package-lock.json
```

- [ ] **Step 5: Write LICENSE (MIT)**

```
MIT License

Copyright (c) 2026 Mikhail Bahdashych

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 6: Write tsconfig.base.json** (extended by node-side packages: shared + api. `apps/web` keeps the Angular CLI's own tsconfig untouched — the CLI owns those settings and `ng update` expects them.)

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2023",
    "module": "commonjs",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 7: Write .env.example** (full contract from the spec; later phases consume these — do not rename)

```bash
# ── Database ──────────────────────────────────────────────
# Used by both the API and the Postgres container.
POSTGRES_HOST=localhost          # inside docker compose (prod): db
POSTGRES_PORT=5432
POSTGRES_DB=inventory
POSTGRES_USER=inventory
POSTGRES_PASSWORD=change-me

# ── API ───────────────────────────────────────────────────
PORT=3000
# Generate secrets with: openssl rand -hex 32
JWT_ACCESS_SECRET=change-me
JWT_REFRESH_SECRET=change-me
# 32-byte hex key encrypting MFA TOTP secrets at rest. Changing it later
# invalidates all enrolled MFA — admins would need to reset MFA for everyone.
APP_ENCRYPTION_KEY=change-me
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL=7d
# Set true when serving over HTTPS (recommended behind your reverse proxy).
COOKIE_SECURE=false
# Treat every user as MFA-enforced regardless of per-user flags.
MFA_ENFORCE_ALL=false
# OpenAPI docs at /api/docs (disable in hardened deployments).
SWAGGER_ENABLED=true

# ── Web (prod compose only) ──────────────────────────────
WEB_PORT=8080
```

- [ ] **Step 8: Verify install works**

Run:

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
npm install && npx prettier --check .env.example >/dev/null 2>&1; node -e "console.log(require('./package.json').workspaces)"
```

Expected: install succeeds creating `package-lock.json`; prints `[ 'apps/*', 'packages/*' ]`.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "chore: root workspace skeleton (workspaces, prettier, editorconfig, MIT license, env contract)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: packages/shared (@inventory/shared)

**Files:**

- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`, `packages/shared/src/enums.ts`, `packages/shared/src/status.ts`, `packages/shared/src/api-types.ts`

**Interfaces:**

- Consumes: root `tsconfig.base.json` (Task 1).
- Produces: package `@inventory/shared` with `main: dist/index.js`, `types: dist/index.d.ts`, script `build` (tsc). Exports (exact names later tasks/phases rely on): `APP_NAME: string`; enums `UserRole { ADMIN='admin', MANAGER='manager', VIEWER='viewer' }`, `AssetStatus { AVAILABLE='available', ASSIGNED='assigned', IN_REPAIR='in_repair', RETIRED='retired', LOST='lost' }`, `AuditAction` (create|update|delete|checkout|checkin|import|export|login|login_failed|login_mfa_failed|logout|setup|password_change|mfa_setup|mfa_reset|mfa_disabled — UPPER_SNAKE keys, lower_snake values); `ASSET_STATUS_LABELS: Record<AssetStatus,string>`; `ASSET_STATUS_COLORS: Record<AssetStatus,string>`; `MANUAL_STATUS_TARGETS: readonly AssetStatus[]`; interface `Paginated<T> { items: T[]; total: number; page: number; pageSize: number }`.

- [ ] **Step 1: Write package.json**

```json
{
  "name": "@inventory/shared",
  "version": "0.1.0",
  "private": true,
  "description": "Shared enums, constants and API contract types for the software inventory tool.",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "clean": "rm -rf dist"
  },
  "devDependencies": {
    "typescript": "^5.9.0"
  }
}
```

- [ ] **Step 2: Write tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Write src/enums.ts**

```typescript
export enum UserRole {
  ADMIN = 'admin',
  MANAGER = 'manager',
  VIEWER = 'viewer',
}

export enum AssetStatus {
  AVAILABLE = 'available',
  ASSIGNED = 'assigned',
  IN_REPAIR = 'in_repair',
  RETIRED = 'retired',
  LOST = 'lost',
}

export enum AuditAction {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  CHECKOUT = 'checkout',
  CHECKIN = 'checkin',
  IMPORT = 'import',
  EXPORT = 'export',
  LOGIN = 'login',
  LOGIN_FAILED = 'login_failed',
  LOGIN_MFA_FAILED = 'login_mfa_failed',
  LOGOUT = 'logout',
  SETUP = 'setup',
  PASSWORD_CHANGE = 'password_change',
  MFA_SETUP = 'mfa_setup',
  MFA_RESET = 'mfa_reset',
  MFA_DISABLED = 'mfa_disabled',
}
```

- [ ] **Step 4: Write src/status.ts**

```typescript
import { AssetStatus } from './enums';

/** Human-readable labels for asset statuses (used by web tables/chips and CSV export). */
export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  [AssetStatus.AVAILABLE]: 'Available',
  [AssetStatus.ASSIGNED]: 'Assigned',
  [AssetStatus.IN_REPAIR]: 'In repair',
  [AssetStatus.RETIRED]: 'Retired',
  [AssetStatus.LOST]: 'Lost',
};

/** Material-palette-ish hex colors for status chips. */
export const ASSET_STATUS_COLORS: Record<AssetStatus, string> = {
  [AssetStatus.AVAILABLE]: '#2e7d32',
  [AssetStatus.ASSIGNED]: '#1565c0',
  [AssetStatus.IN_REPAIR]: '#ef6c00',
  [AssetStatus.RETIRED]: '#616161',
  [AssetStatus.LOST]: '#c62828',
};

/**
 * Statuses a user may set directly on an asset.
 * ASSIGNED is excluded: it is only ever set by the checkout flow.
 */
export const MANUAL_STATUS_TARGETS: readonly AssetStatus[] = [
  AssetStatus.AVAILABLE,
  AssetStatus.IN_REPAIR,
  AssetStatus.RETIRED,
  AssetStatus.LOST,
];
```

- [ ] **Step 5: Write src/api-types.ts**

```typescript
/** Standard paginated list envelope returned by every list endpoint. */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
```

- [ ] **Step 6: Write src/index.ts**

```typescript
export const APP_NAME = 'Software Inventory';

export * from './enums';
export * from './status';
export * from './api-types';
```

- [ ] **Step 7: Build and verify exports**

Run:

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
npm install && npm run build -w @inventory/shared && node -e "const s=require('./packages/shared/dist/index.js'); console.log(s.APP_NAME, s.UserRole.ADMIN, s.ASSET_STATUS_LABELS.in_repair)"
```

Expected: prints `Software Inventory admin In repair`.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(shared): @inventory/shared package with enums, status maps, API types

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: NestJS API scaffold with health endpoint (TDD)

**Files:**

- Create (via CLI, then modify): `apps/api/*` (nest scaffold: `package.json`, `tsconfig*.json`, `nest-cli.json`, `eslint.config.mjs`, `src/main.ts`, `src/app.module.ts`, `test/jest-e2e.json`)
- Create: `apps/api/src/modules/health/health.controller.ts`, `apps/api/src/modules/health/health.module.ts`
- Test: `apps/api/test/health.e2e-spec.ts`, `apps/api/src/modules/health/health.controller.spec.ts`
- Delete: nest-generated `src/app.controller.ts`, `src/app.controller.spec.ts`, `src/app.service.ts`, `test/app.e2e-spec.ts`, `apps/api/.prettierrc` (root owns prettier), `apps/api/.gitignore` (root owns it)

**Interfaces:**

- Consumes: root workspace install (Task 1).
- Produces: workspace `@inventory/api` with scripts `start:dev`, `build`, `lint`, `test`, `test:e2e` (nest defaults); app listens on `process.env.PORT ?? 3000` with global prefix `api/v1`; `GET /api/v1/health` → `200 {"status":"ok"}` (Task 5 dev script and CI depend on this exact route/shape; Phase 1 will extend the controller with terminus DB checks).

- [ ] **Step 1: Scaffold with Nest CLI**

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
mkdir -p apps && cd apps && npx -y @nestjs/cli@11 new api --skip-git --skip-install --package-manager npm --language TypeScript
```

Expected: `apps/api` created with src/, test/, configs.

- [ ] **Step 2: Align package identity and clean duplicates**

In `apps/api/package.json`: set `"name": "@inventory/api"`, `"version": "0.1.0"`, add `"private": true`. Delete files owned by root: `apps/api/.prettierrc`, `apps/api/.gitignore`. Then from repo root run `npm install` (hoists deps, updates root lockfile).
Expected: single root `package-lock.json`; `apps/api/node_modules` absent or minimal (npm may create per-workspace bin links — fine); no `apps/api/package-lock.json`.

- [ ] **Step 3: Write the failing e2e test** — `apps/api/test/health.e2e-spec.ts` (replaces deleted `app.e2e-spec.ts`)

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';

describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health returns ok', () => {
    return request(app.getHttpServer()).get('/api/v1/health').expect(200).expect({ status: 'ok' });
  });
});
```

- [ ] **Step 4: Run e2e to verify it fails**

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
npm run test:e2e -w @inventory/api
```

Expected: FAIL (404 — no health route; or module compile error since app.controller was deleted — fix module in next step).

- [ ] **Step 5: Implement health module + rewire AppModule + main.ts**

`apps/api/src/modules/health/health.controller.ts`:

```typescript
import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check(): { status: string } {
    return { status: 'ok' };
  }
}
```

`apps/api/src/modules/health/health.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
})
export class HealthModule {}
```

`apps/api/src/app.module.ts` (full replacement):

```typescript
import { Module } from '@nestjs/common';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [HealthModule],
})
export class AppModule {}
```

`apps/api/src/main.ts` (full replacement):

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
```

`apps/api/src/modules/health/health.controller.spec.ts` (unit — replaces deleted app.controller.spec):

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('returns status ok', () => {
    expect(controller.check()).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 6: Run unit + e2e to verify they pass**

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
npm run test -w @inventory/api && npm run test:e2e -w @inventory/api
```

Expected: both PASS.

- [ ] **Step 7: Lint and boot check**

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
npm run lint -w @inventory/api && npm run build -w @inventory/api
(npm run start:dev -w @inventory/api &) ; sleep 8 ; curl -sf http://localhost:3000/api/v1/health ; kill %1 2>/dev/null || pkill -f "nest start"
```

Expected: lint+build clean; curl prints `{"status":"ok"}`.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(api): NestJS scaffold with /api/v1/health endpoint

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Angular web scaffold with Material, proxy, shared wiring

**Files:**

- Create (via CLI, then modify): `apps/web/*` (ng scaffold: `package.json`, `angular.json`, `tsconfig*.json`, `src/*`)
- Create: `apps/web/proxy.conf.json`
- Modify: `apps/web/src/app/app.ts` + `app.html` (minimal toolbar shell using `APP_NAME` from `@inventory/shared`), `apps/web/src/app/app.spec.ts` (smoke test), `apps/web/angular.json` (proxy + allowedCommonJsDependencies), `apps/web/package.json` (name, `test:ci` script)
- Delete: `apps/web/.gitignore` (root owns it; keep `.editorconfig` deletion too if generated)

**Interfaces:**

- Consumes: `@inventory/shared` exports `APP_NAME` (Task 2).
- Produces: workspace `@inventory/web` with scripts `start` (ng serve, proxy built-in via angular.json), `build`, `test`, `test:ci` (headless, no-watch), `lint` (angular-eslint). Dev server on :4200 proxies `/api` → `http://localhost:3000` (Task 5 dev flow depends on this).

- [ ] **Step 1: Scaffold with Angular CLI**

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd apps && npx -y @angular/cli@22 new web --skip-git --skip-install --style=scss --ssr=false --defaults
```

Expected: `apps/web` created (standalone app, zoneless per v22 defaults). Inspect `apps/web/package.json` afterward to confirm generated script names before wiring root scripts.

- [ ] **Step 2: Align identity, install, add Material and eslint**

In `apps/web/package.json`: set `"name": "@inventory/web"`, `"version": "0.1.0"`; add script `"test:ci": "ng test --watch=false --browsers=ChromeHeadless"`. Delete `apps/web/.gitignore`. From repo root: `npm install`. Then:

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd apps/web && npx ng add @angular/material --skip-confirmation --defaults && npx ng add @angular/eslint --skip-confirmation
```

Expected: Material theme wired into `angular.json`/styles, `lint` script appears. If `ng add` balks in the workspace layout, fallback: `npm i -w @inventory/web @angular/material @angular/cdk` + manually add a prebuilt theme to `src/styles.scss` (`@use '@angular/material' as mat;` prebuilt azure-blue include per Material 22 docs) and `npm i -D -w @inventory/web angular-eslint @eslint/js typescript-eslint eslint` with the standard `ng lint` flat config.

- [ ] **Step 3: Proxy config**

`apps/web/proxy.conf.json`:

```json
{
  "/api": {
    "target": "http://localhost:3000",
    "secure": false
  }
}
```

In `apps/web/angular.json` under `projects.web.architect.serve.options` add:

```json
"proxyConfig": "proxy.conf.json"
```

(create the `options` object if absent). Also under `projects.web.architect.build.options` add:

```json
"allowedCommonJsDependencies": ["@inventory/shared"]
```

- [ ] **Step 4: Write the failing smoke spec** — replace `apps/web/src/app/app.spec.ts` content entirely:

```typescript
import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { APP_NAME } from '@inventory/shared';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
    }).compileComponents();
  });

  it('renders the app name in the toolbar', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('mat-toolbar')?.textContent).toContain(APP_NAME);
  });
});
```

(If the generated root component uses different file/class names — e.g. `app.component.ts` / `AppComponent` — keep the generated names and adjust imports here accordingly; v22 `ng new` generates `app.ts` with class `App`.)

- [ ] **Step 5: Run test to verify it fails**

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
npm run test:ci -w @inventory/web
```

Expected: FAIL (no mat-toolbar rendered).

- [ ] **Step 6: Implement minimal shell**

`apps/web/src/app/app.ts` (full replacement, keeping generated class name):

```typescript
import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { APP_NAME } from '@inventory/shared';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, MatToolbarModule],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly appName = APP_NAME;
}
```

`apps/web/src/app/app.html` (full replacement):

```html
<mat-toolbar color="primary">{{ appName }}</mat-toolbar> <router-outlet />
```

Ensure `@inventory/shared` is declared as a dependency of the web app: in `apps/web/package.json` `dependencies` add `"@inventory/shared": "0.1.0"`, then root `npm install` (npm links the workspace). Build shared first if `dist/` missing: `npm run build -w @inventory/shared`.

- [ ] **Step 7: Run test to verify it passes, then lint + build + serve check**

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
npm run test:ci -w @inventory/web && npm run lint -w @inventory/web && npm run build -w @inventory/web
```

Expected: all PASS/clean. Serve+proxy is verified end-to-end in Task 5.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(web): Angular 22 scaffold with Material, API proxy, shared-package wiring

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Dev Postgres compose + root orchestration scripts

**Files:**

- Create: `docker-compose.dev.yml`, `docker/postgres-init/01-create-test-db.sql`
- Modify: root `package.json` (scripts)

**Interfaces:**

- Consumes: `@inventory/api` `start:dev` (Task 3), `@inventory/web` `start` (Task 4), `.env.example` var names (Task 1).
- Produces: root scripts `dev`, `db:up`, `db:down`, `build`, `lint`, `test`, `test:e2e` (CI in Task 6 and every later phase call these); dev DB `inventory` + test DB `inventory_test` on localhost:5432.

- [ ] **Step 1: Write docker-compose.dev.yml**

```yaml
# Development-only: runs Postgres. The API and web apps run on your host via `npm run dev`.
services:
  db:
    image: postgres:17-alpine
    ports:
      - '5432:5432'
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-inventory}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-inventory}
      POSTGRES_DB: ${POSTGRES_DB:-inventory}
    volumes:
      - pgdata-dev:/var/lib/postgresql/data
      - ./docker/postgres-init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U $${POSTGRES_USER:-inventory}']
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  pgdata-dev:
```

- [ ] **Step 2: Write docker/postgres-init/01-create-test-db.sql**

```sql
-- Runs only on first initialization of the data volume.
-- Creates the throwaway database used by API e2e tests.
CREATE DATABASE inventory_test;
```

- [ ] **Step 3: Wire root scripts** — in root `package.json` replace the `scripts` object with:

```json
{
  "dev": "concurrently -n api,web -c blue,green \"npm run start:dev -w @inventory/api\" \"npm run start -w @inventory/web\"",
  "db:up": "docker compose -f docker-compose.dev.yml up -d --wait",
  "db:down": "docker compose -f docker-compose.dev.yml down",
  "build": "npm run build -w @inventory/shared && npm run build -w @inventory/api && npm run build -w @inventory/web",
  "lint": "npm run lint -w @inventory/api && npm run lint -w @inventory/web",
  "test": "npm run test -w @inventory/api && npm run test:ci -w @inventory/web",
  "test:e2e": "npm run test:e2e -w @inventory/api",
  "format": "prettier --write .",
  "format:check": "prettier --check ."
}
```

- [ ] **Step 4: Verify db:up creates both databases**

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
npm run db:up && docker compose -f docker-compose.dev.yml exec db psql -U inventory -c '\l' | grep -E 'inventory(_test)?'
```

Expected: `--wait` returns once healthy; output lists both `inventory` and `inventory_test`.

- [ ] **Step 5: Verify full dev flow (API direct + through web proxy)**

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
(npm run dev > /tmp/dev.log 2>&1 &) ; sleep 45
curl -sf http://localhost:3000/api/v1/health && curl -sf http://localhost:4200/api/v1/health
pkill -f "nest start" ; pkill -f "ng serve"
```

Expected: both curls print `{"status":"ok"}` — the second proves the Angular dev proxy forwards `/api` to the API.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: dev Postgres compose with test DB and root dev/build/lint/test scripts

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: CI workflow

**Files:**

- Create: `.github/workflows/ci.yml`

**Interfaces:**

- Consumes: root scripts (Task 5), health tests (Task 3), web tests (Task 4).
- Produces: CI contract every later phase extends (lint → test → build). No Docker build yet (no Dockerfiles until Phase 10). No push happens in this phase; the workflow is validated by running the identical commands locally.

- [ ] **Step 1: Write .github/workflows/ci.yml**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm

      - name: Install
        run: npm ci

      - name: Build shared package
        run: npm run build -w @inventory/shared

      - name: Lint
        run: npm run lint

      - name: API unit tests
        run: npm run test -w @inventory/api

      - name: API e2e tests
        run: npm run test:e2e

      - name: Web tests (headless)
        run: npm run test:ci -w @inventory/web

      - name: Build all
        run: npm run build
```

- [ ] **Step 2: Verify the exact CI command sequence locally**

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
npm ci && npm run build -w @inventory/shared && npm run lint && npm run test -w @inventory/api && npm run test:e2e && npm run test:ci -w @inventory/web && npm run build
```

Expected: every step exits 0 (this is the same sequence CI runs; `npm ci` also proves the committed lockfile is complete).

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "ci: lint, test, build workflow on Node 24

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Root CLAUDE.md seed + README skeleton

**Files:**

- Create: `CLAUDE.md`
- Modify: `README.md`

**Interfaces:**

- Consumes: everything above (documents real, working commands only).
- Produces: root `CLAUDE.md` (expanded in later phases; Phase 11 finalizes claudification), README with the three-path structure (Deploy path stays "coming soon" until Phase 10).

- [ ] **Step 1: Write CLAUDE.md**

```markdown
# Software Inventory Tool

Open-source, self-hosted IT asset inventory. Angular 22 + Angular Material frontend, NestJS 11 backend, PostgreSQL 17. npm-workspaces monorepo.

## Layout

- `apps/api` — NestJS backend (`@inventory/api`). REST under `/api/v1`.
- `apps/web` — Angular frontend (`@inventory/web`). Dev server proxies `/api` → localhost:3000.
- `packages/shared` — `@inventory/shared`: enums, status maps, API contract types. Built first; both apps import it.
- `docs/superpowers/specs/` — approved design spec (read this before large changes).
- `docs/superpowers/plans/` — implementation plans per phase.

## Commands (run from repo root)

- `npm run db:up` / `npm run db:down` — dev Postgres via docker compose (db `inventory`, test db `inventory_test`, user/pass `inventory`).
- `npm run dev` — API (:3000, hot reload) + web (:4200, proxy) concurrently.
- `npm run test` / `npm run test:e2e` — unit tests / API e2e.
- `npm run lint`, `npm run build`, `npm run format`.

## Golden rules

- Node 24 LTS recommended (Angular 22 rejects Node 23; use `nvm use 24`).
- Never enable TypeORM `synchronize`. Every schema change is an explicit migration (from Phase 1 on).
- Shared enums/types/constants live ONLY in `packages/shared` — never duplicate them in an app. Rebuild after editing: `npm run build -w @inventory/shared`.
- Angular core + Material are upgraded together (`ng update @angular/core @angular/cli @angular/material`).
- App-local CLI configs (eslint, tsconfig, jest/vitest) belong to their app; root owns prettier, compose, and orchestration scripts.
```

- [ ] **Step 2: Write README.md** (full replacement of the stub)

````markdown
# Software Inventory Tool

Open-source, self-hosted IT asset inventory. Track hardware assets (laptops, phones, monitors, servers…), who holds them, and the full ownership history — deployed entirely inside your own infrastructure.

**Status: early development.** The stack below works; features are landing phase by phase.

- Backend: NestJS 11 + PostgreSQL 17 (TypeORM, REST under `/api/v1`)
- Frontend: Angular 22 + Angular Material
- Auth (planned per spec): local accounts, roles (admin/manager/viewer), TOTP MFA
- Deploy target: Docker Compose (separate web/api/db containers) behind your VPN/reverse proxy

## Deploy it

Coming with the production packaging phase: `git clone → cp .env.example .env → docker compose up -d`.

## Develop it

Prerequisites: Node 24 LTS, npm 10+, Docker.

```bash
npm install
npm run db:up     # Postgres 17 in Docker (localhost:5432, user/pass/db: inventory)
npm run dev       # API on :3000, web on :4200 (proxies /api to the API)
```
````

Open http://localhost:4200. Tests: `npm run test` and `npm run test:e2e`. Lint: `npm run lint`.

## Customize it with Claude Code

This repo is built to be modified with [Claude Code](https://claude.com/claude-code): `CLAUDE.md` files describe the architecture and conventions, and `.claude/skills/` (shipping in a later phase) will contain step-by-step skills for common customizations (add a field, add a status, build a report…). Open the repo in Claude Code and ask for what you want.

## Design

The approved design spec lives at [`docs/superpowers/specs/2026-07-18-inventory-app-design.md`](docs/superpowers/specs/2026-07-18-inventory-app-design.md).

## License

[MIT](LICENSE)

````

- [ ] **Step 3: Verify docs commands are honest**

Run: `git status --short` (expect only CLAUDE.md + README.md changed) and re-run `npm run lint` once more to confirm repo still green.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "docs: root CLAUDE.md and README with dev quickstart

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
````

---

## Self-review notes

- Spec coverage (Phase 0 scope): workspaces ✓ (T1), lint/prettier ✓ (T1 root prettier; app-local eslint T3/T4 — deliberate deviation from "root eslint flat config": CLI-native per-app configs are what `ng update`/`nest` expect and what downstream users know; root `npm run lint` still lints everything), shared stub ✓ (T2), NestJS `/health` ✓ (T3), Angular shell + proxy + Material ✓ (T4), dev compose + test DB ✓ (T5), `.env.example` ✓ (T1), CI lint+build ✓ (T6, also runs tests). README/CLAUDE.md seed ✓ (T7).
- Version facts verified 2026-07-18: `@nestjs/cli` 11.0.24, `@angular/cli` 22.0.7, Material 22.0.5, Node 24.18.0 via nvm (Angular engines `^22.22.3 || ^24.15.0 || >=26`), TypeORM `latest` = 1.1.0 (not used until Phase 1).
- CLI-generated file names may drift from this plan (e.g. `app.ts` vs `app.component.ts`): keep generated names, adapt the shown diffs — noted inline in T4.
- No placeholders; all code complete; no later-phase files created.

```

```
