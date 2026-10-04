# apps/api — Fastify + SQLite (or PostgreSQL)

REST API under `/api/v1`, one process over one SQLite file — or one PostgreSQL server, when `DATABASE_URL` says so. In production it also serves the built SPA (`WEB_DIST`); in dev, Vite serves the frontend and proxies `/api/` here (port 3000).

## Rules at a glance

Each links to the section that gives the reason. Break one only on purpose.

- Every query is awaited; nothing inside a transaction touches `deps.db`; the `WriteGate` stays — [Every query is a promise](#every-query-is-a-promise-and-one-gate-keeps-them-in-line).
- Queries are dialect-neutral, `LIKE` only through `lib/search.ts` — [Two engines, one boundary](#two-engines-one-boundary).
- A schema change generates both migration folders; `0000_init` + `0001` + `0002` is the baseline, never squashed again — [Migrations](#migrations-and-the-pre-squash-bridge).
- The index is the truth, the pre-check is the courtesy — [A duplicate has two doors](#a-duplicate-has-two-doors).
- `status='assigned'` ⇔ exactly one open assignment, and anything spent once is a compare-and-set — [The one invariant](#the-one-invariant), [Two-factor](#two-factor-authentication).
- Guards are `preValidation` on both surfaces, `bodyLimit` routes authorize at `onRequest`, `requireAction` composes `requireAuth` — [Guards](#guards).
- Nobody below admin acts on an admin or mints one; the last admin is backstopped — [Members, roles and the admin shield](#members-roles-and-the-admin-shield).
- Every mutation writes its audit row inside the mutation's own transaction — a mutation without its audit row must be impossible; `actor_kind` is stored, not derived — [The audit log](#an-audit-row-says-what-kind-of-actor-wrote-it).
- `??` is a column's meaning or a bug — [Non-negotiable rules](#non-negotiable-rules).
- **Adding a route?** Name the action the UI offers on the server ([add-permission-action](../../docs/recipes/add-permission-action.md)); a pre-sign-in route goes in the internal fence's `DELIBERATELY_OPEN` with its reason; a secret in the path or query goes in `SECRET_PATH_PREFIXES` / `SECRET_QUERY_KEYS`; a public route is `documented()` + `requireScope` ([add-api-scope-or-public-route](../../docs/recipes/add-api-scope-or-public-route.md)).

## Architecture

- `src/app.ts` — `buildApp({config, db, client, now?})`. Everything is injected, the clock included: that is the testability seam. `src/index.ts` is the only file that touches the real environment: migrate → seed → listen.
- `src/plugins/` — cross-cutting concerns as plain `register*(app, deps)` functions (error envelope, origin guard, session, static SPA); no fastify-plugin encapsulation games.
- `src/modules/` — one file per area (`registerXRoutes(app, deps)`), thin routes. Anything transactional lives in `src/services/`.
- Shared zod schemas from `@inventory/shared` validate every body and param via `fastify-type-provider-zod` — never hand-roll validation.
- `src/types/` holds every named shape (`Config`, `Db`/`Tx`/`DbOrTx`, `AppDeps`, `Actor`/`AuditEntry`, `AttachmentStorage`, `NotifyInput`, `JobResult`, …). An options object is a named interface; an `as { … }` cast is a type not yet named. **Nothing in `src/types/` imports from services, plugins or modules** — the arrow points one way, so a type never drags runtime code along.
- A drizzle row type (`$inferSelect`) moves to `src/types/` once a second module names it (`MemberRow`, `AssignmentRow`); one only its own service mentions stays beside the query.
- **Imports:** crossing a directory uses the `@/` alias (`@/db/schema.js`); same-directory imports stay relative; both keep the `.js` suffix (ESM). The alias lives in `tsconfig.json` and is mirrored in `vitest.config.ts` — change both. `packages/shared` stays relative, because it is consumed as raw source and a `@/` there would resolve against the consumer.

## Every query is a promise, and one gate keeps them in line

- **Every service is `async` and every route awaits one.** The transaction idiom is `await deps.db.transaction(async (tx) => { … })`, everywhere; `tx` is what everything inside takes, `writeAudit` included.
- **Nothing inside a transaction callback may touch `deps.db`.** Both drivers give a transaction its own connection, so the outer handle cannot see the uncommitted rows — and on SQLite the gate below would make it wait for the transaction it is part of, forever.
- **The `WriteGate` in `db/client.ts` is load-bearing on SQLite.** One file has one writer, and `@libsql/client` opens a fresh connection per `transaction()`: two overlapping transactions race for the write lock, the loser blocks the event loop until the busy timeout, then fails `SQLITE_BUSY`. The gate queues statements and holds a transaction from BEGIN to COMMIT. Only `test/concurrency.test.ts` (eight transactions at once) would notice it gone — `app.inject` happens to serialize every other test, but the scheduler and the CLIs have nothing arranging that for them.
- **Pragmas:** `journal_mode = WAL` is in the file header; `foreign_keys` is on per connection; `busy_timeout` is the client's `timeout`, because a per-connection pragma would not survive the churn. `synchronous` runs at SQLite's default FULL — stricter, so the safe direction.
- **A forgotten `await` is this codebase's characteristic bug.** Drizzle's builders are thenables: `db.insert(…).run();` compiles, returns a truthy object and never runs; `{ assets: listAssets(db) }` serializes to `{}`. eslint runs `no-floating-promises`, `no-misused-promises` and `await-thenable` with the type checker for exactly this, but cannot see a promise handed to an `any` or an object literal (a template span, `reply.send()`) — read the line back.

## Two engines, one boundary

`DATABASE_URL` is the whole choice: set, the rows live in PostgreSQL; absent, in the SQLite file under `DATA_DIR`. There is no mode and no second code path in any service — `db/` is the only directory that knows.

- **One schema, written twice.** `db/schema.sqlite.ts` and `db/schema.pg.ts`; `test/schema-parity.test.ts` pins table names and, per column, names, JS types, nullability, defaults, uniqueness and index names. Timestamps and `YYYY-MM-DD` dates stay `text` on both, because they are compared lexicographically and a pg `date` would hand services a `Date` on one engine only. Money is integer cents, ids are text.
- **`db/schema.ts` is the boundary — what you import, never what you edit.** It picks a set at module load and re-exports the pg tables cast to the SQLite types — sound because parity pins the rows identical and drizzle dispatches on the objects, not the types. `db/client.ts` and `db/migrate.ts` make the matching casts; those three are all. The engine is read from the environment once (`db/engine.ts`), because tables are module-scope constants; outside `db/`, ask `config.engine`.
- **No `WriteGate` on PostgreSQL.** It has MVCC and a lock manager; serializing would throw the engine away. What the gate also did — closing the gap between a uniqueness pre-check and its insert — the index and `lib/unique.ts` do there.
- **Write dialect-neutral queries.** `.all()`, `.get()` and `.run()` exist only on SQLite and throw on pg — await the builder, take `[0]` for one row. Counts come back from node-postgres as strings: use drizzle's `count()` or `.mapWith(Number)`, never a bare `sql<number>`. A delete's row count differs by driver, so count `.returning()`.
- **`LIKE` goes through `src/lib/search.ts`, and nowhere else.** SQLite's `LIKE` is ASCII-case-insensitive, PostgreSQL's is case-sensitive, and `ILIKE` does not exist on SQLite. `contains(column, q)` lowers **both** sides in SQL (`lower(col) LIKE lower(?)`) and escapes `%`, `_` and `\` in the needle. Never lower one side in JS: SQLite's `lower()` folds ASCII only, so a non-ASCII capital ("Łukasz") would then miss even typed exactly. Non-ASCII case-folding on SQLite is a known limit.
- **`npm run test:pg` runs the whole api suite on PostgreSQL** (`docker run -d --name inventory-pg -e POSTGRES_PASSWORD=test -p 5433:5432 postgres:17` matches its default URL); CI runs it as `api-tests-postgres`. Both engines must be green at the same count — a test that passes on one only is a dialect bug.

## Migrations and the pre-squash bridge

- After editing both schemas: `npm run db:generate -w apps/api` (→ `src/migrations/`) **and** `npm run db:generate:pg -w apps/api` (→ `src/migrations-pg/`). Check both in, read the SQL, never edit a merged migration. Migrations run at every boot, through the engine's migrator — that is the upgrade story.
- **drizzle-kit drops `ON DELETE` on a SQLite `ADD COLUMN`.** It emits `REFERENCES` and stops, so SQLite defaults to NO ACTION (the first `actor_api_token_id` migration made revoking a token fail with `SQLITE_CONSTRAINT_FOREIGNKEY`). Generate a nullable FK column on SQLite and read the SQL before trusting it.
- **v0.3.0 squashed the history while v0.1.0 and v0.2.0 were installed, and `bridgePreSquash` in `db/migrate.ts` makes that survivable.** A journal whose every hash is a pre-squash migration (`src/migrations-presquash/`, `src/migrations-pg-presquash/` — kept for this, never generated into) is finished with them, checked for every table `0000_init` creates, and stamped with `0000_init`'s row, so the ordinary migrator continues at `0001`. An unknown hash throws `UpgradeRefused` before touching anything. `test/upgrade-bridge.test.ts` runs it on both engines.
- **`0000_init` + `0001_mfa_last_step` + `0002_one_member_per_employee` is the baseline; never squash it again while the bridge exists.** The bridge stamps `0000_init` on a bridged database; fold `0001` or `0002` into it and that database is recorded as having them while never getting the `mfa_last_step` column, the `members_one_per_employee` index, or `0002`'s unlink of duplicate links. Teaching the bridge that delta would just be `0001` and `0002` again, hand-maintained outside the migrator — so the files stay.
- **Boot seed** (`src/db/seed.ts`) is idempotent: the default custom fields, and — only where the table is empty — the default workflow and roles. Empty-table guarded, because a workspace that edited its workflow deleted rows on purpose. Org settings come from `/setup`.

## Lists are paged on the server

Assets, Employees and Members take the inbox's shape, validated by `listQuery` in `src/lib/search.ts`:

| Rule                                                                         | Why                                                                                                                                |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `q`, `limit` (default 50, max 200), `offset`                                 | No upper bound on an adopting company. Assets also take `status` and `assignable`.                                                 |
| Rows under `assets` / `employees` / `members`, plus `total`                  | The payload grew rather than changed shape.                                                                                        |
| `total` counts only the rows behind the page's filter                        | It is what the pager divides; a search-wide number under a pill offers pages with no rows.                                         |
| `statusCounts` ignores the status filter                                     | Switching a pill must not move the other pills (the audit log's `typeCounts` rule). A status with nothing is absent, read as zero. |
| The order is total (`desc(at), desc(id)`)                                    | Two rows in one millisecond would otherwise swap across a page boundary — one lost, one repeated.                                  |
| Search fields are exported (`ASSET_SEARCH_FIELDS`, `EMPLOYEE_SEARCH_FIELDS`) | `GET /search` (the palette) must match the same columns as the lists.                                                              |

`GET /search` is open to any member, capped at four per group, and answers narrow rows — no serials, no email addresses.

## A duplicate has two doors

The pre-checks a person meets — asset tag, employee email, member email — cost one select and name the field before anything is written. **They are the courtesy; the index is the truth.** On SQLite the check runs inside a `BEGIN IMMEDIATE` holding the write lock; on PostgreSQL two transactions read the same gap and only the index catches the second.

- `translateUniqueViolation` (`src/lib/unique.ts`, called from `plugins/error-handler.ts` so every write gets it) turns a violation into the same answer the pre-check gives, sharing `DUPLICATE_ASSET_TAG` / `DUPLICATE_EMPLOYEE_EMAIL` / `DUPLICATE_MEMBER_EMAIL`. It keys each constraint twice — SQLite prints the columns, PostgreSQL `23505` names the index — and walks the `cause` chain, because drizzle wraps the driver's error.
- **The open-ownership index answers 409 `asset_unavailable`**, and **`members_one_per_employee`** (partial on `employee_id IS NOT NULL`) answers 409 `employee_linked`: losing a race is a conflict, not a 500. `requireUnlinkedEmployee` is the courtesy for the second.
- **Every other constraint is left alone** — the dedupe key, role and status labels, the custom-field key are invariants nobody typed at a form, and a 422 would hide a real bug.

## Inventory endpoints

- `GET /assets` returns one page, each row's `currentHolder` read by a LEFT JOIN on the open assignment — no denormalized holder column to go stale.
- `POST /assets` as `assigned` is a **handover** and goes through `handOver` (`services/assignments.ts`) exactly as assign does: it needs `assets.assign` beside `assets.create` (`assignments:write` beside `assets:write` on the public surface), an active holder, and opens the record, audits and notifies in one transaction.
- `PATCH /assets/:id` diffs against the stored row: unchanged fields write nothing, a status move is audited as `asset.status_changed`. Moves into or out of `assigned` are 409 `status_locked`; any other move needs an edge in the workflow (`transitionAllowed`) or is 409 `transition_not_allowed`. Creating is not a transition — which keeps import insert-only.
- **One door, two grants**: a status that actually moves needs `assets.change_status`, any other key `assets.edit`. `requireAnyAction` refuses a caller with neither; the handler asks for `assets.edit`; the service asks for `assets.change_status` against the row it read, because the edit form resends an unchanged status on every save. `assets:write` covers both publicly.
- `POST /assets/:id/assign` needs a status with `assignable_from`, no open record and an **active** employee (the 409 names the labels the workspace allows); `/checkin` needs an open record, a return date on or after checkout, and a `checkin_target` status. The outcome is derived (`deriveOutcome`), not asked for.
- Deletes are guarded, not cascading: an asset with a holder is 409 `asset_assigned`, a person holding something 409 `employee_holds_assets` — check it in first, which is also the record you want. Deleting a person keeps their history: `employee_id` goes NULL and `holder_name_snapshot` keeps the name.
- `GET /assets/:id` returns the asset, custom values, history, attachments and last 20 events; `GET /employees/:id` returns the person with `holdings` and `history` already split.

## The one invariant

`assets.status = 'assigned'` ⇔ an open ownership row exists, and never two. Only `openAssignment` and `closeAssignment` (`services/assignments.ts`) change that pairing, writing both tables inside the caller's transaction; `handOver` is the only place a new pairing starts. The partial unique index on `(asset_id) WHERE returned_at IS NULL` is the structural backstop.

Two writes that start from a row somebody read are **compare-and-set**, because PostgreSQL under READ COMMITTED lets two transactions read the same row: `closeAssignment` closes `WHERE returned_at IS NULL` (the loser gets 409 `asset_not_assigned`), and an edit's status move writes `WHERE status = <what it read>` (`writeAssetRow`, loser 409 `asset_changed`). Two racing assigns are settled by the open-ownership index instead (409 `asset_unavailable`). `test/stale-writes.test.ts` races them on both engines.

`test/assignments.test.ts` asserts the invariant after **every step** of a seeded random sequence of assigns, check-ins, edits, deletes and creates. A new operation that touches assets or assignments joins that sequence.

## Uploads

Files are stored under a name **we** generate; the uploaded filename is a label, never a path or key. Downloads always send `content-disposition: attachment` and `nosniff`, so a file never runs as a page in the app's origin. The policy lives in `services/attachments.ts`, the vocabulary in `packages/shared/src/attachments.ts`:

| Rule           | What                                                                                                                                                 | Why                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Type allowlist | `ATTACHMENT_EXTENSIONS`, on the sanitized extension, case-insensitive; 422 `file_type_not_allowed`. **No SVG.**                                      | The picker's `accept` is derived from it, but drag-and-drop walks past `accept`; a scriptable format is not invited. |
| Quota          | `org_settings.upload_quota_mb` (2048 default); `SUM(size_bytes)` + the file, checked inside the recording transaction; 413 `storage_quota_exceeded`. | Race-free on SQLite; on PostgreSQL concurrent uploads may overshoot by what is in flight — a budget, not a boundary. |
| Checksum       | `attachments.sha256`, computed as the bytes stream, carried into the export. NULL = uploaded before checksums.                                       | What makes the export's attachment rows worth having after a restore.                                                |
| Orphan sweep   | Nightly: stored objects no `stored_name` names, older than 24 h, removed and counted in `MaintenanceResult`.                                         | The grace period keeps it from racing an upload whose transaction has not landed.                                    |

Both refusals drain the stream and remove what they wrote. 10 MB a file, one file a request; no per-asset cap.

**Where the bytes go is a seam.** `AttachmentStorage` (`types/storage.ts`) is put/stream/remove/list; `makeStorage` (`services/storage.ts`) picks the volume under `DATA_DIR/uploads`, or an S3 bucket exactly when `S3_BUCKET` is set — credentials from the AWS default chain, never an env file. Nothing above `deps.storage` knows which it got. Downloads always **proxy through the app**, so the session check and headers apply (presigned URLs are a deliberate cut). The S3 listing is **paginated** (1000 keys a page). Uploads are buffered, bounded by the 10 MB limit. `test/s3-stub.ts` injects the `S3Client`.

## Members, roles and the admin shield

- **Reading the member list is open to every role**; changing an account needs `members.manage`. The list sends `serializeMemberSummary`, never `serializeMember` (a person's prefs are nobody else's business).
- **Nobody may change or remove their own account** (409 `self_role_change` / `self_delete`), nor change the role they hold (409 `own_role` — PATCH, DELETE or their own matrix column, which is diffed rather than refused because it arrives on every save). That is what stops a `roles.manage` holder promoting themselves.
- **Nobody below admin acts on an admin — or mints one.** `assertAdminActor` (`services/members.ts`) shields every door that targets an admin (password set, reset link, resend-invite, role change, removal, both MFA resets) and every way of creating one: inviting as admin, promoting to admin, and **deleting a role with `migrateTo: 'admin'`** (`services/roles.ts`). `members.manage` and `roles.manage` are grantable, and without the shield a custom role is a ladder over the accounts that could revoke it. The web draws no row menu on an admin's row for a viewer below admin.
- **The last admin cannot be demoted or removed**: `assertNotLastAdmin` refuses to take the last **active** admin (409 `last_admin`). Unreachable over HTTP today, because the self-rule fires first; it is the backstop for the day somebody relaxes that, and `test/last-admin.test.ts` calls the services directly so it stays tested.
- **Invite and reset links are returned once, in full**; only the hash is stored. A new one retires the previous unconsumed one of its purpose. A reset link for an invited member is 409 `not_active`; for **your own** account it is 409 `self_reset_link`, like setting your own password (`self_password_set`) — both would skip the current password the self-service change requires.
- **API tokens are admin-only by role, deliberately.** `modules/api-tokens.ts` checks `role === ADMIN_ROLE` (403 `admin_only`) rather than a grantable `tokens.manage`: a custom role that could mint an `assets:write` token would hold workspace power through a credential no session check ever sees again. The raw token is `invt_` + 32 random bytes, stored as `sha256(raw)`; revoking is deleting. `resolveApiToken` hashes, refuses expiry, and writes `last_used_at` at most once a minute.
- **Roles are rows; actions are compiled in.** `ACTIONS` (shared) is what a route may be guarded with; `roles` + `role_permissions` say who holds each. **Admin stores no rows**: `resolvePermissions` answers `ACTIONS` for it, so a future action is already its own, and it can be neither edited nor deleted (409 `system_role`). Permissions resolve on every request in `plugins/session.ts`, so a grant lands on the next request and `/auth/me` hands the web the very set the guard reads.
- **Deleting a role or status in use needs `migrateTo`** (409 `role_in_use` / `status_in_use`). Move, delete and **one** summary audit event happen in one transaction. A role or status id is its slug, derived once from the label (`roleSlug`, `statusSlug` in shared) — renaming is safe because rows carry the id. Audit params snapshot **labels**, not slugs, so a renamed or deleted role or status never rewrites history.

## The workflow

`asset_statuses` and `asset_status_transitions` are what an asset may be and where it may go; `services/workflow.ts` owns every rule. `GET /workflow` is open to any member; writes need `workflow.manage`.

- **The services ask, they do not decide**: `requireStatus`, `transitionAllowed` and `assignableStatuses` are the whole interface. `assets.status` has no FK and no CHECK, which is why the service is load-bearing.
- **`assigned` is a system status**: never deleted, never in the transitions table, its flags never set — that keeps the one invariant true. And a workspace never loses its last `assignable_from` or `checkin_target` status (409 `workflow_needs_assignable` / `workflow_needs_checkin_target`), tested directly in `test/workflow.test.ts`.

## Guards

- **`requireAction` composes `requireAuth`.** In `plugins/rbac.ts`: `requireSession` is "signed in"; `requireAuth` adds "and done with setup", two-factor enrolment included; `requireAction(x)` calls `requireAuth`, then checks the grant; `requireAnyAction(a, b)` does the same for a door two grants share. Beside them: the api-tokens admin-only guard (`modules/api-tokens.ts`) and `requireScope` on the public surface. A copy of a guard's body once left every write open to a password-only session. **Never re-implement a guard's body; call the one below it.** Enrolment and `/auth/me` use `requireSession`, because enrolment must be reachable from the state it exits.
- **Every guard is `preValidation`, on both surfaces.** A `preHandler` runs after schema validation, so an anonymous caller posting junk would read back the 422 field errors — the shape of a door they cannot open — and the refusal would be indistinguishable from an unguarded route's, so no sweep could tell them apart. No guard needs the body: they read what `plugins/session.ts` resolved at `onRequest`. Anonymous → 401, no grant → 403, only someone the door would open sees a 422 (`test/security.test.ts`).
- **A route that raises `bodyLimit` authorizes at `onRequest`**, because the body is read and parsed before `preValidation` and a larger body is a larger pre-auth cost. `/import/validate` and `/import/commit` (10 MiB) are the two; `test/import.test.ts` sends malformed JSON of import size and expects 401/403.
- **`test/internal-surface-fence.test.ts`** knocks on every `/api/v1` door anonymously with a junk body and requires 401 `unauthorized` — the session guard's refusal, not merely any 401 — with no `fields`. The routes reachable before sign-in (meta, healthz, setup, login, logout, the MFA verify, reset-password, accept-invite, the invitation preview) are in its `DELIBERATELY_OPEN` with a reason each; the map may not name an unregistered route.
- **The server must name the action the UI offers.** A permission only a button reads is a checkbox no door reads — `assets.change_status` once sat on the Roles page while `PATCH /assets/:id` asked only for `assets.edit`. Checklist: [`docs/recipes/add-permission-action.md`](../../docs/recipes/add-permission-action.md).
- Reads are open to every authenticated member; a route with no action named is a route nothing guards.

## The public surface

`/api/public/v1` (`src/modules/public.ts`) is a curated API for server-to-server callers — a promise, where `/api/v1` is the SPA's private contract. [`docs/recipes/add-api-scope-or-public-route.md`](../../docs/recipes/add-api-scope-or-public-route.md) is the checklist.

- **Bearer only, which makes it CSRF-immune.** `plugins/bearer.ts` resolves `Authorization: Bearer invt_…` into `request.apiToken` for URLs under `/api/public/` only. It **attaches and never refuses**; `requireScope('<scope>')` is the guard. No cookie is ever consulted there, and a Bearer grants nothing on `/api/v1` (`test/public-api.test.ts` tests both directions).
- **Two refusals that say no more than they must**: anything wrong with the token is 401 `invalid_token`, one sentence; a valid token without the scope is 403 `missing_scope`, naming only the scope the door wants — a credential's reach must not be readable by poking at doors.
- **Scopes, not actions** (`API_SCOPES`): a member's reads are open, a token's must be granted by name. Members, roles, settings, MFA, setup and the danger zone are absent — accounts stay humans-only.
- **Thin handlers; schemas lifted, never copied.** Each route calls its internal twin's service and serializer with the same zod schema (hence `assetListQuery` in `lib/search.ts`).
- **The token is the actor.** Handlers pass `{id: null, displayName: token.name, apiTokenId}`; `auditActor` makes it the token variant, the self-checks are null-safe, and `assertAdminActor` reads a null id as not-an-admin.
- **`test/public-surface-fence.test.ts` fences the set of doors**: because the plugin attaches rather than refuses, a route without `requireScope` is simply open. The test parses `printRoutes` and requires every route under `/api/public/` to answer anonymous 401 `invalid_token`. Its `DELIBERATELY_OPEN` holds the manual, open because an integrator reads it before holding a token (the spec leaks shapes, not data) — `openapi.json` and the swagger-ui subtree, eight entries written out (one is the `*` key `printRoutes` reports for `/api/public/docs/static/*`) so an upgrade that adds a route asks somebody to look.
- **The manual is generated.** `registerPublicRoutes` registers `@fastify/swagger`, the routes, then the two doors, inside its own encapsulation context, so swagger's `onRoute` hook sees this surface only. It is **awaited** in `app.ts` so the context loads before the SPA catch-all. `jsonSchemaTransform` turns the request schemas into the document; responses are prose (`returns`), because a response schema would serialize through and drop what it forgot. Deletes declare `204: noBody`.
- **`documented(scope, tag, summary, returns, schema)`** produces a route's guard and its manual entry from one naming of the scope. `test/openapi.test.ts` requires a tag, summary, security and a real scope on every operation, and prose that names only real body fields. The SPA's `/api-docs` reads the scope pill out of that "Requires the `…` scope." sentence — reword it and that page changes too.
- `registeredRoutes`/`publicRoutes` live in `test/helpers.ts` so both fences ask about the same set. The docs page carries no CSP (it is swagger-ui's page, not the SPA, and holds no session). These routes carry no rate limit (`global: false`); add one per route if ever needed.

## An audit row says what kind of actor wrote it

- **Every mutation writes its audit event in the same transaction** (`writeAudit`, which takes `DbOrTx`). A mutation without its row must be impossible.
- Three actor columns: `actor_name` (the snapshot a line reads), the nullable FKs `actor_member_id` / `actor_api_token_id` (identity, while the row exists), and `actor_kind` — `member` | `token` | `system` (`AUDIT_ACTOR_KINDS`).
- **`actor_kind` is stored, not derived.** Both FKs are `ON DELETE SET NULL`, so a kind worked out from "which id is set" would turn a removed member's or revoked token's history into the system's. NULL means written before the column existed; `actorKindOf` reads that off `actor_member_id`, and `actorWhere` mirrors it in SQL so the filter does not hide pre-column history.
- **An entry's actor is a variant** (`member` / `token` / `system`), built only by `auditActor(actor)` in `services/audit.ts`; an `Actor` with neither id throws. The sweep in `test/public-api.test.ts` drives every mutating public route and requires every row written to name the token.
- `GET /audit` pages and filters by `type` and `actorKind`: `total` obeys both, `typeCounts` obeys only `actorKind`. `GET /audit/export` renders through the same shared renderer and adds an Actor kind column.

## Reading and moving the whole workspace

`src/modules/data.ts`: the dashboard, the CSV import round trip, the export.

- `GET /dashboard` answers all five widgets in one request. Status and category counts carry their zeros; `statusCounts` is built from `asset_statuses`, so the web names no status. The warranty window is a fixed 90 days, deliberately not `warrantyLeadDays` (the horizon for the inbox notice). **Recent activity obeys `audit.view`**: without it `recentActivity` is `null` — absent by permission, never `[]`, which would claim nothing happened.
- **`planImport` (`services/import-validator.ts`) is pure** and decides issues, counts and rows at once. `/import/commit` re-runs it inside the transaction, so a client cannot skip the dry run. Any error refuses the file; add a rule there with a case in its `it.each` table. An Assigned row goes through `openAssignment`; an unknown assignee is a **warning** that imports the row as Available, an offboarding one an error. Employees match by email and never have `status` touched — an import does not bring anyone back from offboarding.
- `GET /export` is a **reporting format, not a backup**: no password hashes, sessions, tokens or bytes. `docs/backup-restore.md` covers restores per engine and storage.
- **`POST /workspace/delete`** needs the org name typed exactly, unlinks uploads and re-seeds the defaults — what a fresh container has. It writes **no audit event**: there is no log left to hold one. Tables are emptied, never dropped, so no restart is needed.
- **The wipe empties every table children-first, so it never depends on which cascades are enabled** — which is why `mfa_recovery_codes` has its own line though it would cascade from `members`. **Every credential table goes**: a raw API token cannot be recalled, so deleting its row is the only revocation (`api_tokens` goes after `audit_events`, which points at it, and before `members`); `seed:demo --reset` runs the same `emptyWorkspace`. Add a table, add it to that list.

## The inbox

- **`notifications` is one row per recipient member**: `kind` + `params` (a snapshot), rendered by `renderNotification` in shared, so the API sends no prose. `notifyLinkedMember` reaches the member linked to an employee (no link, no notice); `notifyActionHolders` reaches every active member whose role grants an action.
- **A notice from a mutation is written in its transaction**, so a rollback cannot leave one behind.
- **The unique `(member_id, dedupe_key)` index stops repeats**; jobs insert with `onConflictDoNothing`, so a re-run is idempotent. `warranty:{assetId}:{warrantyUntil}` re-arms when the date is corrected; `return:{assignmentId}:{date}:{due|overdue}` sends one heads-up three days out and one once overdue — never daily. The row is the key's only memory, so the prune keeps a keyed row past 90 days while a job could still ask for its key — warranty date not yet passed and unchanged, assignment still open on that date — and `GET /notifications` hides anything past 90 days, so such a row is memory, not reading. A condition that stays true (still overdue, a 365-day lead) is said once; the row goes when its subject is finished.
- `services/jobs.ts` holds the three jobs as functions of `(deps, now)`; `scheduler.ts` only decides the clock (local `TZ`; "today" is UTC). A missed run is skipped, not queued.
- **Maintenance is the only job that removes**: expired sessions and tokens, audit events past retention, inbox rows past 90 days whose key no job can still ask for, orphaned uploads. Add a sweep, add a count to `MaintenanceResult`.
- `GET /notifications` pages like the audit log over the last 90 days (counts cover all of them, not the page); `POST /notifications/read` marks all read. Each member reads only their own.
- [`docs/recipes/add-notification-kind.md`](../../docs/recipes/add-notification-kind.md) is the checklist for a new kind.

## Two-factor authentication

`org_settings.mfa_required` is one switch for the whole workspace; a member has a confirmed authenticator or does not.

- **`src/lib/totp.ts` is hand-written** over `node:crypto` because RFC 6238 publishes test vectors — `src/lib/totp.test.ts` runs all six. Keep them if you ever swap it for a library.
- **A secret is confirmed only by a live code**; asking again before confirming returns the same secret, so a reload after scanning does not replace it. A reset or switching the requirement off clears it.
- **Login is two steps when enrolled**: the password step mints a 5-minute `mfa_challenge` token and no session; `POST /auth/mfa/verify` mints the session. A reset link ends the same way (`mfaChallenge` in `modules/auth.ts`): the link proves an admin vouched for its holder, not that they hold the phone. One input takes an authenticator or a recovery code.
- **Anything spent once is spent by one conditional UPDATE**, so two racing requests cannot both win on either engine: the TOTP step (`acceptTotp` claims `members.mfa_last_step` where `IS NULL OR < step` — monotonic, so an earlier code in the skew window is refused too), a recovery code (`used_at IS NULL` + `.returning()`), and the challenge (`consumeToken`, which answers whether this call spent it). Every path that accepts a code goes through `acceptTotp` inside the transaction the code buys. The step belongs to the secret: `resetMemberMfa` and `wipeAllMfa` clear it with the secret, and recovery codes neither read nor move it. A spent code is refused word for word as a wrong one.
- **Recovery codes are ten, single-use, hashed**, readable once. Outside enrolment, the only way a new set is made is at the next two-factor sign-in after the last one is spent (`replenishRecoveryCodes`); a used code keeps its row with `used_at` set, which is the whole flag. `POST /members/:id/mfa/reset-codes` arms that and keeps every session, unlike `/mfa/reset`, which takes the factor away and so ends them. `mfa_enrolment_required` is a 409: a state to fix, not a permission.
- **Turning the requirement off wipes every secret and recovery code** in the same transaction — a disabled factor that kept its secrets would come back with authenticators nobody remembers.
- **A `members.manage` holder resets it** (`/members/:id/mfa/reset` and `/mfa/reset-codes`; an admin's, only an admin, through the shield). There is no self-service door, because a reset a stolen password could reach is no second factor; resetting your own from the Members page is allowed.
- **Break glass:** `node dist/db/mfa-reset-cli.js <email>` (`src/db/mfa-reset-cli.ts`) for the last admin without phone or codes. It opens its own handle — on SQLite, run it with the server stopped or let the busy timeout queue it. It grants nothing shell access did not already.

## HTTP hardening

- **CSRF stance:** no tokens — same-origin only, no CORS anywhere, `SameSite=Lax` cookies, and the origin guard rejecting any mutation whose `Origin`/`Referer` is not `APP_URL`'s origin **exactly**. Never the request's `Host` (the caller writes it). A wrong `APP_URL` is a 403 naming the expected origin. Passes: `NODE_ENV=development`, safe methods, and a request with neither header (curl). Never register CORS.
- **The CSP is read off the build.** `plugins/static-spa.ts` hashes every inline `<script>` in the `index.html` it serves into `script-src`, so the pre-paint theme script is allowed by being what it is. `img-src` and `font-src` allow `data:` (the enrolment QR; fonts Vite inlines); `style-src` keeps `'unsafe-inline'` for React's style attributes. The header rides on the HTML document only. Development never sees it (Vite serves its own HTML), while e2e runs the production build and walks every journey under it. **Add a CDN, a data URI, an iframe or an `eval` and you are changing this file too** — and the way you find out is a broken screen with a violation in the console.
- **`X-Content-Type-Options: nosniff` rides on every response**, from one `onSend` hook in `app.ts`.
- **The SPA fallback's guard is `/api/`, with the slash.** `isApiRequest` decides whether an unmatched GET is a page or an API 404; a bare `/api` prefix swallowed the client routes `/api-tokens` and `/api-docs` on reload. `apps/web/vite.config.ts`'s proxy key has the same rule; `test/static-spa.test.ts` pins this half. Never widen either.
- **Sign-in counts failures, not requests.** `failureLimit` (`lib/failure-limit.ts`) charges an attempt and refunds it on a 200: ten wrong answers per address in 15 minutes lock it out, an office behind one NAT signing in does not. The password step and the code step keep separate counts. `@fastify/rate-limit` cannot give an attempt back, which is why those two routes do not use it; token routes do (a success spends the token anyway); `POST /me/password` is limited per member.
- **Uniform auth answers:** a wrong password, unknown email and inactive member get one envelope, and a dummy argon2 verify keeps the timing flat.

## Two log systems

They share nothing: never put a domain event in pino or an HTTP detail in the activity log.

- **The activity log** (`audit_events` → `/activity`) is the product: written in the mutation's transaction, rendered by the shared renderer, exportable, pruned on retention. _Who did what to this asset._
- **pino** is operations: requests, lifecycle, scheduler ticks, the 500 path — **stdout only**, never the database or UI. _Is this instance healthy._ Every boot logs `database and storage engaged` (`logBoot`, `services/boot.ts`) naming the engine and its store (`describeStore` in `db/client.ts` — never credentials), the storage driver and migrations applied. `pino-pretty` is a dev-only formatter.
- **Nothing secret reaches stdout.** `src/lib/logging.ts` runs every URL through `redactSensitiveUrl` (`GET /auth/invite/:token` carries a raw token, and a log line would otherwise be the one place it outlives the response that created it) and redacts cookie and authorization headers; `test/logging.test.ts` checks a real request. **A route with a secret in its path or query goes into `SECRET_PATH_PREFIXES` / `SECRET_QUERY_KEYS`.**

## Behaviours that look like bugs and are not

- **Tag numbering restarts with a new prefix.** `computeNextTag` counts only the current prefix: a new prefix is a new series.
- **History keeps a name snapshot.** `holder_name_snapshot` is NOT NULL and survives the employee's deletion.
- **There is no `POST /auth/forgot-password`.** Recovery is an admin issuing a link or setting a password (`POST /members/:id/password`, which kills pending links); a member changes their own at `POST /me/password` (current password in, other sessions out).
- **The employee form is two requests**, so a failed invitation still leaves the person on file.

## Non-negotiable rules

- **Tokens are never stored raw**: sessions, invite/reset and API tokens store `sha256(raw)` (`src/lib/tokens.ts`). No signing secrets exist.
- **RBAC** lives in `packages/shared/src/rbac.ts`; guard mutating routes with `requireAction` from `src/plugins/rbac.ts` (see [Guards](#guards)).
- **Errors:** throw `AppError(status, code, message)` (`src/lib/errors.ts`). The handler renders `{ error: { code, message, fields? } }` (`ApiErrorEnvelope`) through one `envelope()` helper. Zod failures are 422 `validation`, field names read off `instancePath`.
- **A `??` is a column's meaning or a bug in hiding.** Keep it for a nullable column, patch semantics, a `Map` miss that is a genuine zero, the dummy hash in `auth.ts` and `origin ?? referer` — each with a comment. Never to cover an invariant: `getSettings` throws 500 `not_initialized` rather than inventing defaults, `auditTypeOf` throws on an unknown type. Better still, tighten the type until the `??` disappears.
- **Indexing under `noUncheckedIndexedAccess`:** prefer a shape that carries the guarantee (select by id, not `[0]` of a list); where the proof is outside the type, `!` plus a comment naming it (`runReturnReminders`' `expectedReturnDate!`, proved by its `isNotNull`).

## The demo seed

`npm run seed:demo` (`src/db/demo.ts`, data in `src/db/demo-data.ts`), pinned by `test/demo-seed.test.ts`:

- **Dated from the clock** — every date is a day offset from `deps.now()`, so a warranty always expires next week.
- **Through the real services** — `openAssignment`/`closeAssignment` and `writeAudit`, so the demo obeys the one invariant. Order: employees → members → events. It also mints and uses one API token through the real resolver; the raw value is dropped.
- **Deterministic** — the same clock gives the same workspace.
- **The curations run last and outside the main transaction** (`curateWorkflow`, `curateRoles`): each service opens its own transaction, which inside another would wait on the gate forever, and the history replays under the default full mesh. `curateRoles` saves **every** role's grants (the endpoint replaces the set). **Anything added to `demo-data.ts` that moves an asset goes before them**: several of those moves are illegal on the curated graph.
- **Refuses a non-empty workspace** unless `--reset`, which runs `emptyWorkspace` — never expose that to a route. The image ships `dist/db/seed-demo-cli.js` (honours `DEMO_PASSWORD`) for a scheduled public-demo reset.

## Testing

Integration-first: `buildTestApp()` (`test/helpers.ts`) gives a real app with real migrations on a **throwaway database** — use `app.inject`, never mock the DB. On SQLite that is a file per test (not `:memory:`, which libsql gives each connection empty); under `test:pg` a database per test, created and dropped. `close()` is idempotent. Assert audit rows via drizzle. TDD: failing test first, always.

Tests are async all the way down: a throwing service is `await expect(fn(…)).rejects.toThrow(…)` (the sync form passes on any promise), and `expect(await listRoles(db))`, not `expect(listRoles(db))`.
