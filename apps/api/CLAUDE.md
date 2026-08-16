# apps/api — Fastify + SQLite

REST API under `/api/v1`, one process, one SQLite file. In production it also serves the built SPA (`WEB_DIST`); in dev, Vite serves the frontend and proxies `/api` here (port 3000).

## Architecture

- `src/app.ts` — `buildApp({config, db, sqlite, now?})` factory. Everything is injected (including the clock) — this is the testability seam. `src/index.ts` is the only place that touches the real environment: migrate → seed → listen.
- Cross-cutting concerns are plain `register*(app, deps)` functions in `src/plugins/` (no fastify-plugin encapsulation games): error envelope, origin guard, session resolution, static SPA.
- A module is a file in `src/modules/` (`registerXRoutes(app, deps)`); when it outgrows a file, it becomes a folder with `routes.ts` + `service.ts`. Routes stay thin; anything transactional lives in `src/services/`.
- Shared zod schemas from `@inventory/shared` validate every body/param via `fastify-type-provider-zod` — never hand-roll validation.
- **Imports:** anything crossing a directory uses the `@/` alias for `src/` (`@/db/schema.js`, `@/lib/errors.js`); same-directory imports stay relative. Keep the explicit `.js` suffix on both forms — this is ESM. The alias lives in `tsconfig.json` (`paths`), which `tsc`, `tsup`/esbuild and `tsx` all read, plus `vitest.config.ts`, which does not — mirror any change in both. `packages/shared` deliberately stays on relative imports: it is consumed as raw TypeScript source, so a `@/` there would resolve against the _consumer's_ alias and break the web build.

## Inventory endpoints

- `GET /assets` returns the whole list with each asset's `currentHolder`, read through a LEFT JOIN on the open assignment — there is no denormalized holder column, so it is never stale. Newest first; the client filters and counts locally.
- `POST /assets` may start an asset out as `assigned`, which opens its first ownership record in the same transaction via `openAssignment` (`src/services/assignments.ts`). **That function is the only place allowed to pair `status='assigned'` with a new assignment row** — the assign and check-in endpoints will call it too.
- `PATCH /assets/:id` diffs against the stored row: unchanged fields write no audit event, and a status move is audited separately as `asset.status_changed`. It refuses (409 `status_locked`) any move into or out of `assigned` — `canDirectlyTransition` in `@inventory/shared` is the rule.
- Uniqueness (asset tag, employee email) is checked **inside** the transaction and raised as a 422 with a `fields` entry, so the form can point at the offending input. better-sqlite3 is synchronous on one connection, so that check cannot race; the UNIQUE indexes remain the backstop.
- Deletes are guarded, not cascading surprises: an asset with a holder is 409 `asset_assigned`, a person still holding something is 409 `employee_holds_assets`. Deleting a person keeps their history — `assignments.employee_id` goes NULL and `holder_name_snapshot` carries the name.

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
