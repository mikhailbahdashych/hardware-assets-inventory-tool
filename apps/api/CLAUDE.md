# apps/api — Fastify + SQLite

REST API under `/api/v1`, one process, one SQLite file. In production it also serves the built SPA (`WEB_DIST`); in dev, Vite serves the frontend and proxies `/api` here (port 3000).

## Architecture

- `src/app.ts` — `buildApp({config, db, sqlite, now?})` factory. Everything is injected (including the clock) — this is the testability seam. `src/index.ts` is the only place that touches the real environment: migrate → seed → listen.
- Cross-cutting concerns are plain `register*(app, deps)` functions in `src/plugins/` (no fastify-plugin encapsulation games): error envelope, origin guard, session resolution, static SPA.
- A module is a file in `src/modules/` (`registerXRoutes(app, deps)`); when it outgrows a file, it becomes a folder with `routes.ts` + `service.ts`. Routes stay thin; anything transactional lives in `src/services/`.
- Shared zod schemas from `@inventory/shared` validate every body/param via `fastify-type-provider-zod` — never hand-roll validation.
- `src/types/` holds every named shape: `db.ts` (`Db`, `Tx`, `DbOrTx`, `DbHandle`), `app.ts` (`AppDeps`, `BuildAppOptions`), `audit.ts` (`Actor`, `AuditEntry`), `members.ts` (`MemberSummary`, `LinkedEmployee`, `InviteResult`), `admin.ts` (`AuditItem`, `AuditPage`, `AuditQuery`), plus the parameter objects for the assignment, asset, attachment and error paths. A function that takes an options object takes a named interface, not a literal; an `as { … }` cast is a type that has not been named yet. Drizzle row types (`typeof table.$inferSelect`) deliberately stay beside the service that queries them — the table is the source of truth.
- **Imports:** anything crossing a directory uses the `@/` alias for `src/` (`@/db/schema.js`, `@/lib/errors.js`); same-directory imports stay relative. Keep the explicit `.js` suffix on both forms — this is ESM. The alias lives in `tsconfig.json` (`paths`), which `tsc`, `tsup`/esbuild and `tsx` all read, plus `vitest.config.ts`, which does not — mirror any change in both. `packages/shared` deliberately stays on relative imports: it is consumed as raw TypeScript source, so a `@/` there would resolve against the _consumer's_ alias and break the web build.

## Inventory endpoints

- `GET /assets` returns the whole list with each asset's `currentHolder`, read through a LEFT JOIN on the open assignment — there is no denormalized holder column, so it is never stale. Newest first; the client filters and counts locally.
- `POST /assets` may start an asset out as `assigned`, which opens its first ownership record in the same transaction via `openAssignment` (`src/services/assignments.ts`). **That function is the only place allowed to pair `status='assigned'` with a new assignment row** — the assign and check-in endpoints call it too.
- `PATCH /assets/:id` diffs against the stored row: unchanged fields write no audit event, and a status move is audited separately as `asset.status_changed`. It refuses (409 `status_locked`) any move into or out of `assigned` — `canDirectlyTransition` in `@inventory/shared` is the rule.
- Uniqueness (asset tag, employee email) is checked **inside** the transaction and raised as a 422 with a `fields` entry, so the form can point at the offending input. better-sqlite3 is synchronous on one connection, so that check cannot race; the UNIQUE indexes remain the backstop.
- Deletes are guarded, not cascading surprises: an asset with a holder is 409 `asset_assigned`, a person still holding something is 409 `employee_holds_assets`. Deleting a person keeps their history — `assignments.employee_id` goes NULL and `holder_name_snapshot` carries the name.
- `POST /assets/:id/assign` and `/checkin` are the ownership operations. Assign requires an available-or-ordered asset with no open record and an **active** employee; check-in requires an open record and a return date at or after the checkout. The check-in outcome is derived, not asked for (`deriveOutcome` in `@inventory/shared`).
- `GET /assets/:id` returns the asset, its custom-field values, its ownership history, its attachments and its last 20 audit events. `GET /employees/:id` returns the person plus `holdings` and `history`, already split.
- Attachments stream to `DATA_DIR/uploads` under a name **we** generate; the uploaded filename is a label, never a path. Downloads always send `content-disposition: attachment` and `nosniff`, so an uploaded file can never run as a page in the app's origin.

## Members and the admin surfaces

- **Reading the member list is open to every role** (it is a normal page in the design); everything that changes an account needs `members.manage`. `serializeMemberSummary` is what the list sends — deliberately not `serializeMember`, which carries the signed-in person's theme, density and widget layout and is nobody else's business.
- **You may not change or remove your own account** (409 `self_role_change` / `self_delete`). That pair _is_ the last-admin guard: every caller is an active admin, so removing or demoting somebody else always leaves at least one. A separate last-admin check would be unreachable code, so there isn't one — don't add it back without a path that reaches it.
- **Invite and reset links are returned once, in full**, from `POST /members/invites`, `/:id/resend-invite` and `/:id/reset-link`. Only the token hash is stored, so the response is the only chance to show it; the UI never assumes an email went out. Issuing a new token retires the previous unconsumed one of the same purpose, so a leaked link dies when an admin resends. A reset link for an invited member is a 409 (`not_active`) — resend the invite instead.
- An invited member has no name yet, so `displayName` borrows the linked employee's or falls back to the email's local part. Accepting the invite replaces it.
- `GET /audit` pages with `limit`/`offset` and returns `typeCounts` over the **whole** log, not the page, so switching filter pills never moves the other numbers. `GET /audit/export` renders the same rows through the same shared renderer, so screen and file cannot disagree.
- `PATCH /settings` diffs against the stored row and audits `system.settings_updated` with the fields that actually changed; an unchanged submit writes nothing at all. `getSettings` throws 500 `not_initialized` rather than inventing defaults — every caller is behind an admin session, which implies setup ran.
- `POST /workspace/delete` requires the organization name typed back exactly, then empties every table in child-first order, unlinks the uploads and re-seeds the default custom fields — leaving precisely what a fresh container starts with. It writes no audit event because there is no log left to hold one. Tables are emptied, never dropped: the schema and its migrations stay, so restarting is not part of the procedure.

## Reading and moving the whole workspace

`src/modules/data.ts` holds the three routes that describe everything rather than one record: the dashboard, the CSV import round trip and the export-all file.

- `GET /dashboard` answers all five widgets in one request — they read the same few tables, and hiding a widget should not change how many round trips the page makes. Status and category counts carry their zeros, because the design draws six tiles and five bars whatever the inventory holds. The warranty window is a fixed 90 days and deliberately **not** the `warrantyLeadDays` setting: that one is about when email goes out, and this is a place to look.
- **`planImport` (`src/services/import-validator.ts`) is pure and decides everything at once**: the issues, the counts, and the rows to write. `/import/validate` shows its report, `/import/commit` re-runs it inside the transaction — so a client cannot post straight to commit to skip the dry run, and the summary a person approved is exactly the work that happens. Any error at all refuses the whole file. Add a rule there, not in the writer, and give it a case in the `it.each` table beside it.
- An imported row that arrives Assigned goes through `openAssignment` like every other handover, so the one invariant holds for bulk loads too. An unknown assignee is a **warning** that imports the row as Available (the design says so); an offboarding one is an error.
- Employees are matched by email and updated in place, keeping the id that assignments and member links hang off, and never touching `status` — an import is not a way to bring somebody back from offboarding.
- `GET /export` is a **reporting format, not a backup**, and the code says so: no password hashes, no sessions or tokens, no attachment bytes. Restoring means replacing the `/data` directory.

## The one invariant

`assets.status = 'assigned'` ⇔ an open ownership row exists, and never two. Only `openAssignment` and `closeAssignment` (`src/services/assignments.ts`) may change that pairing — they each write both tables together, inside the caller's transaction. The partial unique index on `(asset_id) WHERE returned_at IS NULL` is the structural backstop.

`test/assignments.test.ts` asserts it after **every step** of a seeded random sequence of assigns, check-ins, status edits, deletes and creates. If you add an operation that touches assets or assignments, add it to that sequence — a new operation that breaks the pairing should fail there, not in production.

## Non-negotiable rules

- **Every mutation writes its audit event in the same transaction** (`writeAudit` from `src/services/audit.ts`, which accepts `DbOrTx`). A mutation without its audit row must be impossible.
- **Tokens are never stored raw**: sessions and invite/reset tokens store `sha256(raw)` (`src/lib/tokens.ts`). No signing secrets exist anywhere.
- **RBAC**: guard mutating routes with `requireAction('<action>')` from `src/plugins/rbac.ts`; the action list lives in `packages/shared/src/rbac.ts`. Reads are open to all authenticated roles.
- **Uniform auth responses**: login failures return the identical envelope for wrong password / unknown email / inactive member, and a dummy argon2 verify keeps timing flat. `forgot-password` always answers 204.
- **CSRF stance**: no tokens — same-origin only (no CORS anywhere), `SameSite=Lax` cookies, plus the origin guard rejecting foreign `Origin`/`Referer` on mutations. The guard is skipped in `NODE_ENV=development` (the Vite proxy forwards the browser's :5173 origin). Never register CORS.
- Errors: throw `AppError(status, code, message)` from `src/lib/errors.ts` (or a helper). The error handler renders the `{ error: { code, message, fields? } }` envelope — typed as `ApiErrorEnvelope` in `@inventory/shared`, the same interface the web client parses — and builds it through one local `envelope()` helper so no route can invent a second shape. Zod failures become 422 `validation`.
- **A `??` here is a column's meaning or it is a bug in hiding.** Keep it for a nullable column (`expectedReturnDate ?? null`), for patch semantics (a present-but-empty field means "clear it"), for an audit line naming a record as it is _after_ an edit, for a `Map` miss that is a genuine zero, and for the deliberate ones in `auth.ts` (the dummy argon2 hash keeps login timing flat) and `origin-guard.ts` (`origin ?? referer` — either header answers the same question). Every one of those says so in a comment.
  Do **not** use it to cover an invariant. `settings?.assetTagPrefix ?? 'AST'` numbered assets under a prefix nobody chose whenever the org-settings row was missing; every caller is behind a session and a session implies setup ran, so it throws 500 `not_initialized` now (`getSettings` in `src/services/settings.ts` is that throw, shared by every admin path). Same for the invite endpoint's `orgName`. And prefer removing the guard by tightening the type: `activeAssignment()` returns `null` rather than `undefined`, which deleted five `?? null` at once — and in `services/audit-log.ts`, `auditTypeOf` throws on a stored type outside `AUDIT_TYPES` instead of letting an event render under a colour that does not exist.

## Database

- Schema in `src/db/schema.ts` (see conventions in the root CLAUDE.md). After changing it: `npm run db:generate -w apps/api` writes SQL into `src/migrations/` — check it in, **never edit a merged migration**. Migrations run at every boot (that is the upgrade story).
- The `assignments` table is the only truth for who holds an asset: at most one active row per asset (partial unique index). Asset `status='assigned'` ⇔ an active assignment exists — maintained only inside single transactions in the assignment service (arrives PR 5).
- Boot seed (`src/db/seed.ts`) is idempotent and only creates default custom-field defs; org settings come from the `/setup` flow.

## Testing

Integration-first: `test/helpers.ts` `buildTestApp()` gives a real app on a `:memory:` database with real migrations — use `app.inject`, never mock the DB. Assert audit rows via drizzle. Unit-test pure services (tag generation, validators) directly. TDD: failing test first, always.
