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
