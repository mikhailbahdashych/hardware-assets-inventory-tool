# Software Inventory Tool — Design Specification

Date: 2026-07-18
Status: Approved

## Purpose

An open-source (MIT), self-hosted IT asset inventory application. Companies find it on GitHub and deploy it inside their own infrastructure — typically a security engineer deploying under a company VPN on an internal company domain, behind the company's reverse proxy. It tracks hardware assets (computers, devices — not furniture): what exists, who holds it, and the full ownership history.

A distinguishing goal is **claudification**: the repo ships with CLAUDE.md files and Claude Code skills so downstream users can safely customize their instance with Claude Code — while manual development without Claude stays a first-class, documented path.

## Settled Decisions

- **Deploy (prod):** Docker Compose with three services: `web` (nginx serving the built Angular app, proxying `/api` → api), `api` (NestJS), `db` (postgres:17-alpine). Frontend and backend are **separate images**. Only `web` publishes a host port (`WEB_PORT`, default 8080); api/db stay on the internal compose network. Images on GHCR (`…-api`, `…-web`). End-user UX: `git clone → cp .env.example .env → docker compose up -d`.
- **Dev mode (first-class):** `npm run db:up` (compose Postgres only) + `npm run dev` (NestJS hot reload :3000 + Angular dev server :4200 with `/api` proxy). Documented in `docs/DEVELOPMENT.md`; README offers three paths: *Deploy it / Develop it / Customize it with Claude*.
- **Database:** PostgreSQL only. TypeORM (1.x line), explicit migrations (never `synchronize`), auto-run on boot.
- **Auth v1:** Local accounts, admin-managed. First-run setup creates the initial admin; admins create users with one-time temp passwords + forced change at first login. Roles: **Admin / Manager / Viewer**. Passport + JWT (15m access + 7d rotating refresh, httpOnly cookies, argon2id). OIDC pluggable later (`provider` column reserved).
- **MFA in v1 (TOTP):** authenticator-app TOTP + single-use recovery codes. Admins control per-user enforcement, see status, and can reset MFA; optional instance-wide `MFA_ENFORCE_ALL` env toggle. Secrets encrypted at rest (AES-256-GCM with `APP_ENCRYPTION_KEY`).
- **Domain:** App **Users** (logins) separate from **Employees** (asset holders; most never log in). Ownership history = append-only Assignment ledger.
- **v1 extras:** CSV import/export, audit log. **v2 (extension points only):** custom fields, locations/sites, OIDC/SSO, SMTP invites, i18n.
- **Frontend:** Angular standalone components, signals + services (no NgRx), Angular Material, typed reactive forms.
- **Versions at scaffold time (2026-07-18):** Angular 22.0.x, NestJS 11.1.x, TypeORM 1.1.x (`latest`; 0.3 is `legacy`), Node 24 LTS (Angular 22 requires `^22.22.3 || ^24.15.0 || >=26`), Postgres 17. Pin via lockfile; upgrade Angular core+Material together.

## Monorepo Layout

npm workspaces: `apps/api` (NestJS), `apps/web` (Angular), `packages/shared` (`@inventory/shared` — enums, API contract types, status label/color maps; zero runtime deps; built first).

```
/                        # README, LICENSE(MIT), CLAUDE.md, package.json (workspaces),
│                        # tsconfig.base.json, eslint flat config, .prettierrc, .env.example,
│                        # docker-compose.yml (prod: web+api+db), docker-compose.dev.yml (postgres only + inventory_test init)
├── .github/workflows/   # ci.yml (lint→test→build→docker build both images), release.yml (tag→buildx amd64+arm64→GHCR, both images)
├── docs/                # ARCHITECTURE.md, DEPLOYMENT.md, DEVELOPMENT.md, superpowers/specs/
├── .claude/skills/      # 7 shipped skills (see Claudification)
├── packages/shared/src/ # enums.ts, api-types.ts, status.ts
├── apps/api/            # NestJS + apps/api/Dockerfile (multi-stage, non-root, HEALTHCHECK)
└── apps/web/            # Angular + apps/web/Dockerfile (node build → nginx:alpine) + nginx.conf
```

Root scripts: `dev`, `db:up`/`db:down`, `build` (shared→api→web), `test`, `test:e2e`, `lint`, `migration:generate|run|revert`, `seed:demo`.

`.env.example`: `POSTGRES_*` (shared by api + db), `PORT=3000`, `WEB_PORT=8080`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `APP_ENCRYPTION_KEY` (32-byte hex, MFA secret encryption), `ACCESS_TOKEN_TTL=15m`, `REFRESH_TOKEN_TTL=7d`, `COOKIE_SECURE=false`, `MFA_ENFORCE_ALL=false`, `SWAGGER_ENABLED=true`. Config validated at boot (Joi) — fail fast on missing secrets.

**nginx.conf (web image):** `try_files $uri /index.html` SPA fallback; `location /api/ { proxy_pass http://api:3000; }` + `X-Forwarded-*` headers (browser sees one origin → cookies just work, no CORS anywhere); `client_max_body_size 10m` (CSV uploads); no-cache for index.html, immutable cache for hashed assets; gzip.

## Backend (apps/api)

REST under `/api/v1`, OpenAPI at `/api/docs` (env-gated). Modules: `auth` (incl. MFA), `users`, `employees`, `asset-types`, `assets`, `assignments`, `csv`, `audit`, `health` (+ `database/`, `common/`, `cli/` with `reset-admin-password`, `reset-mfa <email>`, `seed-demo`). No static serving — nginx owns the frontend.

### Cross-cutting rules

- Single TypeORM `data-source.ts` (explicit entity+migration arrays, no globs) used by CLI and runtime. `migrationsRun: true`, snake_case naming strategy, `retryAttempts: 10`.
- **No soft deletes.** `is_active` flags; hard DELETE only when nothing references the row, else `409`.
- **Status columns are varchar + `@IsEnum`, NOT PG enums** — keeps the `add-asset-status` skill migration-free.
- Global guard order: `JwtAuthGuard` (`@Public()`) → `RolesGuard` (`@Roles()`) → `MustChangePasswordGuard` → `MfaEnrollmentGuard` (if `mfaEnforced && !mfaEnabled`, only MFA-setup/me/logout/change-password reachable).
- Roles: Viewer = read + export; Manager = + write assets/employees/assignments/import; Admin = + deletes, asset types, users, MFA admin, audit log.

### Entities

(uuid PKs via `gen_random_uuid()`, `timestamptz` timestamps; `audit_logs` bigserial)

- `users` — email (unique, lowercased), password_hash (nullable, argon2id, excluded from serialization), provider (default `'local'`), display_name, role, is_active, must_change_password, mfa_enabled, mfa_enforced, mfa_secret (encrypted, nullable), mfa_verified_at, last_login_at. Invariant: cannot deactivate/demote last active admin.
- `mfa_recovery_codes` — user FK CASCADE, code_hash, used_at NULL.
- `refresh_tokens` — user FK, token_hash (sha256, unique), expires_at, revoked_at, replaced_by_id (reuse ⇒ revoke family), ip/user_agent.
- `employees` — first/last name, email (partial unique WHERE NOT NULL), employee_number (partial unique; CSV match key), department, title, notes, is_active.
- `asset_types` — name (unique on lower), description, icon (Material icon name), is_active. Seeded via migration (Laptop, Desktop, Monitor, Phone, Tablet, Peripheral, Server, Network Device, Software License, Other).
- `assets` — asset_tag (**unique**), serial_number (indexed, non-unique; dupes = UI/import warning), name, manufacturer, model_number, type FK RESTRICT, status varchar (`available|assigned|in_repair|retired|lost`; `assigned` only ever set by checkout), purchase_date (date), purchase_price numeric(12,2), purchase_currency, supplier, warranty_expires_at (date), notes.
- `assignments` — append-only ledger: asset FK RESTRICT, employee FK RESTRICT, assigned_at, returned_at (NULL = current holder), assigned_by/checked_in_by (user FKs SET NULL), checkout/checkin notes. **Partial unique index `(asset_id) WHERE returned_at IS NULL`**; checkout/checkin transactional with `SELECT … FOR UPDATE`.
- `audit_logs` — append-only: actor FK SET NULL + denormalized actor_email, action (`create|update|delete|checkout|checkin|import|export|login|login_failed|login_mfa_failed|logout|setup|password_change|mfa_setup|mfa_reset|mfa_disabled`), entity_type/entity_id, before/after jsonb (redacted: passwordHash, tokenHash, mfaSecret), metadata jsonb (ip, userAgent, import/export details).

### Auth & MFA flows

- Cookies: `sit_access` (JWT, SameSite=Lax, path=/) + `sit_refresh` (opaque 256-bit, SameSite=Strict, path=/api/v1/auth). Same-origin in dev (Angular proxy) and prod (nginx) — no CORS.
- Login: `POST /auth/login` (throttled 5/min/IP) → if MFA active: `{mfaRequired: true, ticket}` (5-min purpose-scoped JWT) → `POST /auth/login/mfa` {ticket, code} (TOTP ±1 step or recovery code, throttled) → cookies issued.
- Enrollment (self): `POST /auth/mfa/setup` → otpauth:// URI (FE renders QR) → `POST /auth/mfa/verify` {code} → activates, returns 10 recovery codes **once**. `DELETE /auth/mfa` (self-disable; blocked when enforced; requires current code).
- Admin MFA: `POST /users/:id/mfa/reset` (clears secret+codes; if enforced, user re-enrolls at next login), `mfaEnforced` via users PATCH. `MFA_ENFORCE_ALL=true` treats every user as enforced.
- Refresh rotation with reuse detection (reuse ⇒ revoke token family) and a 30s grace window for multi-tab races.

### Other key endpoints

`GET /auth/setup-status` + `POST /auth/setup` (public; only while user count == 0, transactional), `POST /users/:id/reset-password` (temp password shown once), `GET /assets/stats`, `POST /assignments` (checkout) + `POST /assignments/:id/checkin` (target status), `POST /import/preview|commit` (stateless; per-row ok/warning/error; `skipInvalid`), `GET /import/template`, `GET /export/assets.csv|assignments.csv` (streamed), `GET /audit` (admin, filtered), `GET /health` (terminus; container HEALTHCHECK).

### Audit capture

`@Audited({entity, action})` + global interceptor (prefetches before-state via entity registry; after-state = handler return). Composite ops (checkout/checkin/import/export/auth/MFA events) call `AuditService.log()` explicitly. **Route-reflection e2e test fails if a mutating route is neither `@Audited` nor allowlisted.**

## Frontend (apps/web)

Standalone components, lazy routes, signal stores, Material M3 dense tables. `core/` (auth store with single-flight refresh mutex; guards: auth/role/setup/must-change-password/mfa-enrollment/login-redirect; 401→refresh→retry interceptor; shell with role-filtered nav), `features/` (auth incl. mfa-setup page (QR) + mfa step on login, dashboard, assets, employees, assignments, import, admin/{users, asset-types, audit}), `shared/` (confirm-dialog, empty-state, page-header, debounced search-input, `*appHasRole`).

Routes: `/setup`, `/login` (password step → code step), `/change-password`, `/mfa-setup`, then shell: `/dashboard`, `/assets(/new|/:id|/:id/edit)`, `/employees(…)`, `/assignments` (Open|History), `/import` (4-step wizard: file→mapping→preview→results), `/admin/users` (MFA status column + enforce toggle + reset action + temp-password dialog), `/admin/asset-types`, `/admin/audit` (before/after diff dialog). Checkout/checkin = dialogs on asset detail; detail shows history timeline. No generic table abstraction — explicit MatTable per page for easy downstream edits.

## Claudification (first-class deliverable)

CLAUDE.md: root (project map, commands, golden rules), `apps/api/`, `apps/web/`, `packages/shared/`. Skills in `.claude/skills/<name>/SKILL.md`:

| Skill | Teaches |
|---|---|
| `add-entity-field` | Column end-to-end: entity→migration→DTO→shared types→form/table/CSV→tests (worked example: `Assignment.expectedReturnAt`, deliberately absent from v1) |
| `add-asset-status` | Extend status enum + labels/colors/transitions — no migration |
| `add-api-endpoint` | Route + DTO validation + `@Roles` + swagger + audit + e2e template |
| `add-frontend-page` | Lazy page + nav item + api service + Material scaffold + test |
| `build-custom-report` | Filtered query + streamed CSV endpoint + UI trigger |
| `database-migrations` | Generate/review/run/revert safely (referenced by other skills) |
| `troubleshoot-deployment` | Compose/nginx logs, healthchecks, VPN/reverse-proxy + COOKIE_SECURE, backup/restore, `reset-admin-password`/`reset-mfa` runbooks |

Plus `docs/ARCHITECTURE.md` (diagram, ERD, auth/MFA/audit flows, deliberate decisions, v2 extension points), `docs/DEPLOYMENT.md` (env table, VPN/internal-domain + TLS/internal CA guidance, backups, upgrades), `docs/DEVELOPMENT.md` (manual dev workflow), shipped `.claude/settings.json` allowlisting safe commands. Every skill dogfooded in a scratch branch before shipping.

## Implementation Phases

0. **Scaffold** — workspaces, lint/prettier, shared stub, NestJS `/health`, Angular shell + proxy + Material, dev compose, `.env.example`, CI (lint+build).
1. **Database core** — all 8 entities, data-source, Init + SeedAssetTypes migrations, boot wiring, config validation, empty-diff CI check.
2. **Auth slice (password)** — setup/login/refresh/logout/me/change-password, guards, throttling, auth audit events; FE auth pages, store, guards, interceptor, shell.
3. **MFA slice** — TOTP setup/verify/disable, login second step, recovery codes, encryption, `MfaEnrollmentGuard`, `MFA_ENFORCE_ALL`, `reset-mfa` CLI; FE mfa-setup (QR) + login code step.
4. **Users admin slice** — users CRUD, temp passwords, last-admin invariant, MFA admin controls; `/admin/users` UI.
5. **Employees slice** — CRUD API (search/filter/pagination, guarded delete); list/form/detail UI.
6. **Asset types + Assets slice** — types admin UI (seeded); assets CRUD with filters + current-holder join; list/form/detail + status chips.
7. **Assignments slice (MVP moment)** — transactional checkout/checkin, history APIs; dialogs, timelines, `/assignments`, dashboard, `seed:demo`.
8. **Audit slice** — interceptor + registry + redaction; annotate all routes; `/admin/audit` UI + diff dialog; route-coverage test.
9. **CSV slice** — streamed exports, template download, import wizard.
10. **Production packaging** — both Dockerfiles + nginx.conf; prod compose; release.yml (buildx amd64+arm64 → GHCR); DEPLOYMENT.md; README quickstart; CI compose smoke test.
11. **Claudification** — all CLAUDE.md + 7 skills + docs; dogfood each skill.
12. **(Optional) Playwright smoke** — setup+login(+MFA), create asset, assign+history.

## Top Risks → Mitigations

1. TypeORM CLI/runtime config drift → single data-source.ts, explicit arrays, CI empty-diff check.
2. TypeORM 1.x novelty (recently `latest`) → verify migration/DataSource APIs against current docs in Phase 1; pin exact version.
3. Boot-migration failures / crash loops → transactional migrations, healthcheck `start_period`, advisory lock, manual runbook.
4. Secure cookies dropped on plain-HTTP VPN intranets → `COOKIE_SECURE` default false + loud DEPLOYMENT.md TLS/internal-CA guidance + `trust proxy` so audit IPs are real.
5. nginx proxy misconfig → SPA fallback `try_files`, `/api/` proxy_pass, `client_max_body_size` for CSV, e2e smoke asserting API JSON 404 through nginx.
6. Multi-tab refresh race → FE single-flight mutex + 30s backend grace on just-rotated tokens.
7. MFA lockout & key loss → recovery codes, `reset-mfa` CLI runbook; docs warn `APP_ENCRYPTION_KEY` change invalidates all MFA secrets; TOTP ±1 step window.
8. Audit gaps / secret leakage → route-reflection coverage test + central redaction list (incl. mfaSecret) with test.
9. CSV edge cases → battle-tested parser, BOM/delimiter sniffing, 5 MB limit, preview-first, fixture suite.
10. argon2 native module on Alpine/arm64 → buildx both arches, toolchain fallback (or bookworm-slim), per-arch smoke in CI.
11. Angular/Material lock-step majors → same-major scaffold, `npm ci`, upgrade-together rule in CLAUDE.md.

## Verification

- Per phase: Jest unit + supertest e2e against real Postgres (`inventory_test`); FE component specs; CI green before next phase.
- Dev-mode proof: clean checkout → `npm install && npm run db:up && npm run dev` → app usable at :4200 with hot reload, per DEVELOPMENT.md verbatim.
- Prod-mode proof: clean checkout → `cp .env.example .env && docker compose up -d` → browser :8080 → setup admin → enable MFA → create asset → assign → history visible → `docker compose down && up -d` → data + login persist.
- Claudification proof: fresh Claude Code session performs a customization using only shipped skills.

## Out of Scope (v2 extension points documented in ARCHITECTURE.md)

Custom fields per asset type, locations/sites, OIDC/SSO (provider column ready), SMTP invites, i18n, WebAuthn/passkeys, software-license tracking beyond the seeded asset type.
