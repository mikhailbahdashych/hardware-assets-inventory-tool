# apps/api — Fastify + SQLite

REST API under `/api/v1`, one process, one SQLite file. In production it also serves the built SPA (`WEB_DIST`); in dev, Vite serves the frontend and proxies `/api` here (port 3000).

## Architecture

- `src/app.ts` — `buildApp({config, db, sqlite, now?})` factory. Everything is injected (including the clock) — this is the testability seam. `src/index.ts` is the only place that touches the real environment: migrate → seed → listen.
- Cross-cutting concerns are plain `register*(app, deps)` functions in `src/plugins/` (no fastify-plugin encapsulation games): error envelope, origin guard, session resolution, static SPA.
- A module is a file in `src/modules/` (`registerXRoutes(app, deps)`); when it outgrows a file, it becomes a folder with `routes.ts` + `service.ts`. Routes stay thin; anything transactional lives in `src/services/`.
- Shared zod schemas from `@inventory/shared` validate every body/param via `fastify-type-provider-zod` — never hand-roll validation.

## Non-negotiable rules

- **Every mutation writes its audit event in the same transaction** (`writeAudit` from `src/services/audit.ts`, which accepts `DbOrTx`). A mutation without its audit row must be impossible.
- **Tokens are never stored raw**: sessions and invite/reset tokens store `sha256(raw)` (`src/lib/tokens.ts`). No signing secrets exist anywhere.
- **RBAC**: guard mutating routes with `requireAction('<action>')` from `src/plugins/rbac.ts`; the action list lives in `packages/shared/src/rbac.ts`. Reads are open to all authenticated roles.
- **Uniform auth responses**: login failures return the identical envelope for wrong password / unknown email / inactive member, and a dummy argon2 verify keeps timing flat. `forgot-password` always answers 204.
- **CSRF stance**: no tokens — same-origin only (no CORS anywhere), `SameSite=Lax` cookies, plus the origin guard rejecting foreign `Origin`/`Referer` on mutations. The guard is skipped in `NODE_ENV=development` (the Vite proxy forwards the browser's :5173 origin). Never register CORS.
- Errors: throw `AppError(status, code, message)` from `src/lib/errors.ts` (or a helper). The error handler renders the `{ error: { code, message, fields? } }` envelope; zod failures become 422 `validation`.

## Database

- Schema in `src/db/schema.ts` (see conventions in the root CLAUDE.md). After changing it: `npm run db:generate -w apps/api` writes SQL into `src/migrations/` — check it in, **never edit a merged migration**. Migrations run at every boot (that is the upgrade story).
- The `assignments` table is the only truth for who holds an asset: at most one active row per asset (partial unique index). Asset `status='assigned'` ⇔ an active assignment exists — maintained only inside single transactions in the assignment service (arrives PR 5).
- Boot seed (`src/db/seed.ts`) is idempotent and only creates default custom-field defs; org settings come from the `/setup` flow.

## Testing

Integration-first: `test/helpers.ts` `buildTestApp()` gives a real app on a `:memory:` database with real migrations — use `app.inject`, never mock the DB. Assert audit rows via drizzle. Unit-test pure services (tag generation, validators) directly. TDD: failing test first, always.
