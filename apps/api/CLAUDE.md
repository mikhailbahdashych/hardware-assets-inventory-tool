# apps/api — Fastify + SQLite

REST API under `/api/v1`, one process, one SQLite file. In production it also serves the built SPA (`WEB_DIST`); in dev, Vite serves the frontend and proxies `/api` here (port 3000).

## Architecture

- `src/app.ts` — `buildApp({config, db, sqlite, now?})` factory. Everything is injected (including the clock) — this is the testability seam. `src/index.ts` is the only place that touches the real environment: migrate → seed → listen.
- Cross-cutting concerns are plain `register*(app, deps)` functions in `src/plugins/` (no fastify-plugin encapsulation games): error envelope, origin guard, session resolution, static SPA.
- A module is a file in `src/modules/` (`registerXRoutes(app, deps)`); when it outgrows a file, it becomes a folder with `routes.ts` + `service.ts`. Routes stay thin; anything transactional lives in `src/services/`.
- Shared zod schemas from `@inventory/shared` validate every body/param via `fastify-type-provider-zod` — never hand-roll validation.
- `src/types/` holds every named shape: `config.ts` (`Config`, `SmtpConfig`, `SmtpAuth`), `db.ts` (`Db`, `Tx`, `DbOrTx`, `DbHandle`), `app.ts` (`AppDeps`, `BuildAppOptions`), `audit.ts` (`Actor`, `AuditEntry`), `auth.ts` (`TokenPurpose`), `members.ts` (`MemberRow`, `MemberSummary`, `LinkedEmployee`, `InviteResult`, `InviteLink`, `ResetLink`), `admin.ts` (`AuditItem`, `AuditPage`, `AuditQuery`), `jobs.ts` (`JobResult`, `MaintenanceResult`, `SchedulerHandle`), plus the parameter objects for the assignment, asset, attachment and error paths. A function that takes an options object takes a named interface and returns one too, not a literal; an `as { … }` cast is a type that has not been named yet.
- **Nothing in `src/types/` imports from `src/services/`, `src/plugins/` or `src/modules/`** — the arrow points one way, so a type can never drag a service's runtime code into whatever imports it. `config.ts` is the shape and `src/config.ts` is the reader that produces it, in that order.
- **A drizzle row type (`typeof table.$inferSelect`) goes in `src/types/` once more than one module names it** — `MemberRow`, `AssignmentRow` and `OrgSettingsRow` are all read by files that never query their table. One that only its own service ever mentions stays beside the query (`AssetRow`, `AttachmentRow`): the table is the source of truth either way, and moving it early only adds a hop. A row type read off a select expression rather than a table has no module-scope name to move — `DueRow` in `services/jobs.ts` says so in a comment.
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
- **You may not change or remove your own account** (409 `self_role_change` / `self_delete`), and **the workspace may not lose its last admin** (409 `last_admin`). The first rule is what a caller actually meets: `members.manage` is admin-only and nobody may act on themselves, so the target is never the last admin and the second guard never fires over HTTP. It is there anyway, in `assertNotLastAdmin`, because the property it protects must not depend on the first rule staying exactly as it is — relax the self-rule, or give `members.manage` to another role, and it becomes the thing standing between an edit and a workspace nobody can administer. Only **active** admins count toward it: an invited admin has no password and cannot sign in.
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

## Email, and running without it

- **`config.smtp` is null without a host, and `deps.mailer` is null with it.** Null rather than a no-op object on purpose: the compiler then makes every send site say what it does without email, and every one has an answer — invitations and resets put the link in the response.
- **Delivery never fails a request.** `deliver` in `src/services/transactional.ts` catches and logs; the operation that triggered the message still succeeded, because it did. The copyable link is the contract, the message is the convenience.
- **Mail is sent after a transaction, never inside one.** A message cannot be rolled back.
- `src/services/jobs.ts` holds the four scheduled jobs as plain functions of `(deps, now)`; `scheduler.ts` decides only the clock. That is what makes every rule testable with a fixed date, and why a missed run is skipped rather than queued.
- **`notification_log` is what stops a repeat, and the row is written _after_ a successful send.** At-least-once on purpose: a crash between the two sends a duplicate next run, where writing first would lose the message forever. Choose the dedupe key carefully — it is the whole design (`warranty:{assetId}:{date}` re-arms when the date is corrected; `return:{employeeId}:{day}` repeats daily while an item is out).
- Templates in `src/services/mail-templates.ts` are pure and plain-text first. The table-driven test fails on any unfilled slot and on a message that does not name the workspace.

## The one invariant

`assets.status = 'assigned'` ⇔ an open ownership row exists, and never two. Only `openAssignment` and `closeAssignment` (`src/services/assignments.ts`) may change that pairing — they each write both tables together, inside the caller's transaction. The partial unique index on `(asset_id) WHERE returned_at IS NULL` is the structural backstop.

`test/assignments.test.ts` asserts it after **every step** of a seeded random sequence of assigns, check-ins, status edits, deletes and creates. If you add an operation that touches assets or assignments, add it to that sequence — a new operation that breaks the pairing should fail there, not in production.

## Behaviors that look like bugs and are not

Each of these was a decision. Change one only on purpose.

- **Asset-tag numbering restarts when the prefix changes.** `computeNextTag` counts only tags under the _current_ prefix, so switching `AST` → `INV` gives `INV-0001`, not `INV-0224`. A team changing prefix is starting a new series; continuing the old count under a new name is the stranger behaviour, and it is what makes the numbering explainable.
- **The last admin cannot be demoted or removed**, by two rules at once. Nobody may change or remove _their own_ account (409 `self_role_change` / `self_delete`), which is the one a caller meets; underneath it `assertNotLastAdmin` refuses to take the last active admin (409 `last_admin`) whoever is asking. The second is unreachable over HTTP today and is meant to be — it is the backstop for the day somebody relaxes the first, and `test/last-admin.test.ts` calls the services directly so it is tested code rather than scenery.
- **Ownership history keeps a name snapshot.** `holder_name_snapshot` is NOT NULL and a deleted employee sets `employee_id` to NULL without touching it, so a past holding still says who held it. History that rewrites itself when someone leaves is not history.
- **Deletes are guarded, not cascading.** An asset somebody is holding, or a person holding something, answers 409. The fix is to check the thing in first, which is also the record you want.
- **`POST /auth/forgot-password` always answers 204 and issues nothing.** Handing a reset link to whoever asked for it is the thing being avoided; recovery is an admin issuing one from the Members page. This is not an unfinished endpoint.
- **The employee form is two requests, not one.** Creating a person and inviting them are separate calls, so a failed invitation still leaves the person on file to be invited from Members. Making the pair atomic would throw away typed-in work to preserve a tidiness nobody asked for.

## Non-negotiable rules

- **Every mutation writes its audit event in the same transaction** (`writeAudit` from `src/services/audit.ts`, which accepts `DbOrTx`). A mutation without its audit row must be impossible.
- **Tokens are never stored raw**: sessions and invite/reset tokens store `sha256(raw)` (`src/lib/tokens.ts`). No signing secrets exist anywhere.
- **RBAC**: guard mutating routes with `requireAction('<action>')` from `src/plugins/rbac.ts`; the action list lives in `packages/shared/src/rbac.ts`. Reads are open to all authenticated roles.
- **Uniform auth responses**: login failures return the identical envelope for wrong password / unknown email / inactive member, and a dummy argon2 verify keeps timing flat. `forgot-password` always answers 204.
- **CSRF stance**: no tokens — same-origin only (no CORS anywhere), `SameSite=Lax` cookies, plus the origin guard rejecting foreign `Origin`/`Referer` on mutations. The guard is skipped in `NODE_ENV=development` (the Vite proxy forwards the browser's :5173 origin). Never register CORS.
- Errors: throw `AppError(status, code, message)` from `src/lib/errors.ts` (or a helper). The error handler renders the `{ error: { code, message, fields? } }` envelope — typed as `ApiErrorEnvelope` in `@inventory/shared`, the same interface the web client parses — and builds it through one local `envelope()` helper so no route can invent a second shape. Zod failures become 422 `validation`.
- **A `??` here is a column's meaning or it is a bug in hiding.** Keep it for a nullable column (`expectedReturnDate ?? null`), for patch semantics (a present-but-empty field means "clear it"), for an audit line naming a record as it is _after_ an edit, for a `Map` miss that is a genuine zero, and for the deliberate ones in `auth.ts` (the dummy argon2 hash keeps login timing flat) and `origin-guard.ts` (`origin ?? referer` — either header answers the same question). Every one of those says so in a comment.
  Do **not** use it to cover an invariant. `settings?.assetTagPrefix ?? 'AST'` numbered assets under a prefix nobody chose whenever the org-settings row was missing; every caller is behind a session and a session implies setup ran, so it throws 500 `not_initialized` now (`getSettings` in `src/services/settings.ts` is that throw, shared by every admin path). Same for the invite endpoint's `orgName`. And prefer removing the guard by tightening the type: `activeAssignment()` returns `null` rather than `undefined`, which deleted five `?? null` at once — and in `services/audit-log.ts`, `auditTypeOf` throws on a stored type outside `AUDIT_TYPES` instead of letting an event render under a colour that does not exist.

## Indexing, under `noUncheckedIndexedAccess`

`array[i]` is `T | undefined`, and the fix is almost never an assertion. `runReturnReminders` groups rows into a `Map<string, [DueRow, ...DueRow[]]>` — a non-empty tuple, because that is what the construction guarantees — so the first row reads without a check. `/setup` selects the member it just inserted **by id** rather than taking `all()[0]`, which was only correct while the table had exactly one row; a miss is now a named 500 rather than a silent wrong answer. In tests, `!` is the normal answer: a wrong one fails the test.

## Database

- Schema in `src/db/schema.ts` (see conventions in the root CLAUDE.md). After changing it: `npm run db:generate -w apps/api` writes SQL into `src/migrations/` — check it in, **never edit a merged migration**. Migrations run at every boot (that is the upgrade story).
- The `assignments` table is the only truth for who holds an asset: at most one active row per asset (partial unique index). Asset `status='assigned'` ⇔ an active assignment exists — maintained only inside single transactions in the assignment service (arrives PR 5).
- Boot seed (`src/db/seed.ts`) is idempotent and only creates default custom-field defs; org settings come from the `/setup` flow. It runs on every start, so it must stay cheap and repeatable.

## Two-factor authentication

TOTP only, and the shape of it is two facts: `org_settings.mfa_required` is true or false for the whole workspace, and a member either has a confirmed authenticator or does not.

- **`src/lib/totp.ts`** is hand-written over `node:crypto` rather than a package, because it is an HMAC over a counter and **RFC 6238 publishes test vectors** — `totp.test.ts` runs all six, which is what makes it verifiable rather than trusted. Do not swap it for a library without keeping those vectors.
- **A secret is written at the start of enrolment and confirmed only when a live code proves the authenticator has it.** Until then the member is not enrolled, so an abandoned enrolment leaves nothing to be locked out by.
- **Login is two steps when a member is enrolled.** The password step creates no session at all — it returns a 5-minute `mfa_challenge` token (an `auth_tokens` row like every other, hashed), and `POST /auth/mfa/verify` is what mints the session. One input takes either an authenticator code or a recovery code; the server decides by what matches, because asking somebody to declare which they are holding is a choice they should not have to make.
- **Recovery codes are ten, single-use, hashed.** They exist in readable form exactly once, in the response that created them — same rule as invite and reset tokens. `mfa_enrolment_required` is a 409, not a 403, because it describes a state to fix rather than a permission you lack.
- **`requireSession` vs `requireAuth`.** The first is "signed in"; the second is "signed in and done with setup" and is what almost every route wants. Enrolment and `/auth/me` use the first, because enrolment has to be reachable from inside the state it exits. Putting the check in the guard rather than each route means a new endpoint is covered by default — forgetting produces a locked door, not an open one.
- **Turning the requirement off wipes every secret and recovery code**, in the same transaction as the setting. A disabled second factor that kept its secrets would come back on with authenticators nobody remembers adding.
- **Only admins reset it**, and deliberately there is no self-service equivalent: a member who could reset their own second factor has a second factor that a stolen password gets past. Unlike role changes, resetting _your own_ is allowed — locking yourself out is not a way to leave the workspace without an admin.
- **The break-glass path is `src/db/mfa-reset-cli.ts`** (`node dist/db/mfa-reset-cli.js <email>`), for the last admin losing both phone and codes. It needs shell access, which is already root-equivalent over a SQLite file — it grants nothing a hex editor did not, it just makes it survivable.

## Two log systems, and which is which

They answer different questions and share nothing. Do not put a domain event in one or an HTTP detail in the other.

- **The activity log** (`audit_events` → `/activity`) is the product. A row is written **inside the same transaction** as the mutation it describes, by `writeAudit`, and rendered to a sentence by the one shared renderer in `@inventory/shared`. It is admin-visible in the UI, exportable as CSV, and pruned on the retention setting. It answers _who did what to this asset_.
- **pino** (Fastify's logger) is operations. Request and response lines, server lifecycle, scheduler ticks, and the 500 path in `plugins/error-handler.ts`. It goes to **stdout only** — never the database, never the UI — and is read with `docker logs`. It answers _is this instance healthy, what threw, how slow was that_.

`pino-pretty` is not a third thing: it is a formatter, enabled only when `NODE_ENV=development`, so the output is readable while you work. Production emits JSON.

**Nothing secret may reach stdout.** `src/lib/logging.ts` is where that is enforced: the `req` serializer runs every URL through `redactSensitiveUrl`, because `GET /auth/invite/:token` carries a **raw** token in its path and the database deliberately stores only `sha256(raw)` — a log line would otherwise be the one place a raw token outlives the response that created it. `redact` covers the cookie and authorization headers as well, which Fastify does not log today but would carry the session if anything ever did. `test/logging.test.ts` drives a real request through a captured stream and fails if either appears. **Add a route with a secret in its path or query and you must add it to `SECRET_PATH_PREFIXES` / `SECRET_QUERY_KEYS`.**

## The demo seed

`npm run seed:demo` (`src/db/demo.ts`, dataset in `src/db/demo-data.ts`) fills an instance with a fictional company so every screen has something on it. Three properties are what make it worth maintaining, and each is pinned by a test in `test/demo-seed.test.ts`:

- **It dates itself from the clock.** Every date in the dataset is an offset in days, resolved against `deps.now()` when it runs — so a warranty always expires next week, a return is always due in a few days, and the dashboard is never a museum. Nothing is hardcoded to a calendar date, which is what stops the demo rotting.
- **It goes through the real services.** Ownership is opened and closed by `openAssignment`/`closeAssignment`, and every event by `writeAudit`. The demo is subject to the one invariant rather than a second way of writing rows around it — which is also why seeding order is employees → members → the events naming either: `audit_events.actor_member_id` is a real foreign key.
- **It is deterministic.** No randomness, so the same clock gives the same workspace and `--reset` restores rather than reshuffles.

It refuses a workspace that already holds anything unless `--reset` is passed, so it can never be the thing that ate a real inventory. `--reset` goes through `emptyWorkspace` — the same wipe the danger zone performs, minus the type-the-name guard. Do not expose that function to a route.

**For a hosted demo**, the seeder is built into the image (`dist/db/seed-demo-cli.js`, a second tsup entry) and reads `DEMO_PASSWORD`. Because it is deterministic and dated from the clock, a scheduled `node dist/db/seed-demo-cli.js --reset` inside the container restores a public instance to a known state and re-dates the whole story to that moment.

## Testing

Integration-first: `test/helpers.ts` `buildTestApp()` gives a real app on a `:memory:` database with real migrations — use `app.inject`, never mock the DB. Assert audit rows via drizzle. Unit-test pure services (tag generation, validators) directly. TDD: failing test first, always.
