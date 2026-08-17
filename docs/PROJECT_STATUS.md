# Project status and handoff

**Read this first when picking the project up.** It records where the build stands, what every earlier decision was, and exactly what the next piece of work is. Update it at the end of each PR.

_Last updated: 2026-08-17, after the `noUncheckedIndexedAccess` cleanup. The planned build is complete._

---

## 1. What this product is

**Inventory** — an open-source, self-hosted hardware asset inventory for IT teams: track devices, who holds them, and the full ownership history. Any-size company should be able to run it under their own domain with minimal ops effort.

Two first-class goals, equally binding:

1. **Faithful to the design handoff.** `docs/design-handoff/` holds the interactive HTML prototype that is the visual source of truth. Its inline `style="…"` attributes are the spec. Recreate, don't reinterpret.
2. **Customizable by asking Claude Code.** CLAUDE.md files across the repo explain the patterns so an adopting team changes the product through Claude Code instead of reading source. [`docs/recipes/`](recipes/) holds end-to-end checklists for the changes teams actually make.

## 2. Locked decisions — do not revisit without the owner

| Decision | Choice                                                                   | Why                                                                                                   |
| -------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Database | **SQLite first**, single container, zero-config                          | "Easily self-hosted" — backup is copying a folder. Schema stays portable for a later Postgres option. |
| Auth v1  | **Email/password + invites + forgot-password**. No SSO                   | OIDC is a documented post-v1 phase; the design's SSO button is deliberately not rendered.             |
| License  | **MIT**                                                                  | Maximum adoption; corporate legal teams pass it without friction.                                     |
| Naming   | UI wordmark **"Inventory"**; repo title "Hardware Assets Inventory Tool" | Matches the design; repo stays descriptive.                                                           |
| Workflow | **Sequential stacked PRs; the owner merges every one**                   | Never merge a PR yourself. Never push to `main`.                                                      |
| Method   | **TDD** — failing test first, watch it fail, then implement              | Applies to behavior, not config files.                                                                |

The full approved plan lives at `~/.claude/plans/hello-there-i-want-valiant-sunbeam.md` (outside the repo). This file is the in-repo summary of it.

## 3. Where the work stands

| PR  | Branch                           | Scope                                                                | State                                                                                           |
| --- | -------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | `feat/01-scaffold-design-system` | Monorepo scaffold, design tokens, primitive library, CLAUDE.md set   | **Merged** — [#6](https://github.com/mikhailbahdashych/hardware-assets-inventory-tool/pull/6)   |
| 2   | `feat/02-api-core`               | DB schema + migrations, sessions, auth flows, RBAC, audit plumbing   | **Merged** — [#7](https://github.com/mikhailbahdashych/hardware-assets-inventory-tool/pull/7)   |
| 3   | `feat/03-auth-ui-shell`          | API client, auth screens, app shell, routing/guards, preference sync | **Merged** — [#8](https://github.com/mikhailbahdashych/hardware-assets-inventory-tool/pull/8)   |
| 4   | `feat/04-assets-employees`       | Asset + employee CRUD, list pages, form modals, detail pages         | **Merged** — [#10](https://github.com/mikhailbahdashych/hardware-assets-inventory-tool/pull/10) |
| 5   | `feat/05-assignments`            | Assign, check in, ownership timeline, attachments, custom fields     | **Merged** — [#11](https://github.com/mikhailbahdashych/hardware-assets-inventory-tool/pull/11) |
| —   | `chore/interfaces-and-fallbacks` | A `types/` folder per workspace; fallbacks that were hiding bugs     | **Merged** — [#12](https://github.com/mikhailbahdashych/hardware-assets-inventory-tool/pull/12) |
| 6   | `feat/06-members-admin`          | Members, invites, the activity log, settings, the danger zone        | **Open** — branched from `main`                                                                 |
| 7–8 | not started                      | see §6                                                               | —                                                                                               |

Everything up to PR 5 is merged, so PR 6 branches from `main` rather than stacking. To start PR 7: `git checkout feat/06-members-admin && git checkout -b feat/07-dashboard-palette-import` (it stacks on 6 until 6 merges).

The app is a complete product: set up an instance, add people, register devices, hand them out, take them back, read the full ownership history, invite colleagues at three permission levels, audit and configure the workspace, import a spreadsheet, and run the whole thing from one container with or without email.

## 4. What exists today

### `packages/shared` — the single source of truth

Domain enums as slugs with exact design labels and semantic color maps (`ok|acc|warn|err|info|neut`), `canDirectlyTransition` (Change-status rules), `can(role, action)` RBAC, and zod schemas for the auth payloads. **The database has no CHECK constraints on enum columns on purpose**, so adding a status or category is a code-only change here.

### `apps/api` — Fastify + SQLite (Drizzle)

- Full schema for all 12 tables with one migration checked in (`src/migrations/0000_init.sql`). Migrations run at boot; pulling a newer image and restarting _is_ the upgrade procedure.
- `buildApp({config, db, sqlite, now})` factory — everything injected, including the clock. This is the testability seam.
- Sessions and invite/reset tokens store only `sha256(raw)`; no signing secret exists anywhere. Sliding 30-day sessions, `last_active_at` throttled to one write per five minutes.
- Live endpoints: `/meta`, `/healthz`, `/setup`, `/auth/{login,logout,forgot-password,reset-password,invite/:token,accept-invite,me}`, `/me/prefs`, `/assets` (+ `/next-tag`, `/:id`, `/:id/{assign,checkin,attachments}`), `/employees` (+ `/:id`), `/custom-fields`, `/members` (+ `/invites`, `/:id`, `/:id/{resend-invite,reset-link}`), `/audit` (+ `/export`), `/settings`, `/workspace/delete`, `/dashboard`, `/import/{template,validate,commit}`, `/export`.
- **`planImport` is pure and decides everything at once** — the issues, the counts and the rows to write. Validate shows its report; commit re-runs it inside the transaction, so the dry run cannot be skipped and the summary a person approved is exactly the work done.
- **Nobody may change or remove their own account** (409 `self_role_change` / `self_delete`). That pair is also the last-admin guard: the caller is always an active admin, so acting on anybody else leaves at least one — a separate last-admin check would be unreachable, and there deliberately isn't one.
- Invite and reset links come back in full from the response and nowhere else (only the token hash is stored). Issuing one retires the previous unconsumed token of the same purpose.
- `openAssignment` in `src/services/assignments.ts` is the **only** code path that pairs `status='assigned'` with a new ownership row; the create, assign and check-in endpoints all call it. Deletes are guarded (409) rather than cascading; a deleted person keeps their name on past ownership records.
- Security: origin-guard CSRF stance (same-origin only, no CORS anywhere — **skipped when `NODE_ENV=development`** because the Vite proxy forwards the :5173 origin), per-route rate limits, uniform-timing login, one `{error:{code,message,fields?}}` envelope.
- **Every mutation writes its audit event inside the same transaction.** Keep it that way.

### `apps/web` — React SPA

- Design tokens mirroring the handoff exactly; ~26 hand-rolled primitives with behavior tests; the Feather-style icon inventory; fonts self-hosted (no CDN — the app runs on-prem).
- API client with typed `ApiError`, TanStack Query key catalog, session mutation hooks.
- Auth screens (setup, login, forgot, reset, accept-invite) on the design's 360px column; app shell (sidebar + topbar); routing with three route sets chosen by instance and session state; role gating via shared `can()`.
- Asset and employee lists on the design's exact grid templates, with live filters kept in the URL (`/assets?status=&q=`), status pills counting the whole inventory, footer counts and empty states. One form modal serves create and edit for each entity; detail pages show the record, its custom fields, its current holder, its ownership timeline, its attachments and its audit trail.
- Members page with the overflow menu (resend invitation, copy reset link, change role, remove), the invite modal on the design's radio cards, and one modal that shows every one-time link as selectable text with a Copy button — the Clipboard API needs a secure context, which plain http is not.
- Admin is two URLs (`/admin/activity`, `/admin/settings`): the activity log with counted filter pills, "Load more", a CSV export link, and the settings cards, which save on change (selects, switches) or on blur (text) because the design draws no Save button.
- Dashboard with five per-member widgets, KPI tiles that link into a filtered asset list, the ⌘K command palette with real keyboard navigation, and the five-step CSV import wizard including the column-mapping step.
- `providers/ModalProvider.tsx` owns the six app-level modals; `components/app/ModalHost.tsx` renders whichever is open. Modals carrying a subject stay local to the page that knows the subject.
- `api/invalidate.ts` — `invalidateInventory` and `invalidateAdmin` are the two cache-invalidation paths every write goes through. Extend one rather than invalidating ad hoc inside a mutation.
- Theme/density persist per member on the server and are adopted at sign-in; the inline script in `index.html` applies them before first paint (no flash).
- **`/kitchen-sink`** (dev-only route) renders every primitive for side-by-side review with the prototype.

### `e2e` — Playwright

Runs the real production artifact: built API serving the built SPA, fresh data directory per run, `NODE_ENV=production` so the origin guard is genuinely exercised. Serial (`workers: 1`) because one instance means one workspace — the first test does setup, later tests sign in with that account.

### Delivery

- **Docker**: multi-stage `node:22-bookworm-slim`, one process serving the API and the built SPA, SQLite on `/data`. Two details are load-bearing: `--ignore-scripts` on both installs (better-sqlite3 and @node-rs/argon2 ship their binaries, and npm's automatic `node-gyp rebuild` would need Python in the image to redo them), and an entrypoint that starts as root only long enough to take ownership of `/data` before dropping to `node` — a bind mount carries the _host_ directory's ownership, so an image that simply ran as `node` fails its first mkdir on somebody's very first start. SIGTERM closes the server and the SQLite handle.
- **Release**: `git tag vX.Y.Z && git push --tags` → `.github/workflows/release.yml` builds amd64 + arm64 and publishes to ghcr.
- **Docs**: `README.md` (quick start, env table, security, deployment), `docs/backup-restore.md`, and `docs/recipes/` — six checklists written to be handed to Claude Code.

### Verification status

556 unit/integration tests (242 api + 216 web + 98 shared), 37 e2e tests, lint, format and typecheck clean. CI runs lint → format check → typecheck → unit tests → build → e2e, plus a second job that **builds the image, starts it, sets a workspace up, restarts the container and reads it back** — a Dockerfile that only compiles is a Dockerfile nobody has tried.

## 5. How to work in this repo

```bash
npm install                      # once, at the root (npm workspaces)
npm run dev                      # api :3000 + web :5173 (Vite proxies /api)
npm test                         # unit + API integration, all workspaces
npm run e2e                      # Playwright (first run: npx playwright install chromium)
npm run lint && npm run typecheck && npm run format
npm run db:generate -w apps/api  # after editing src/db/schema.ts
```

Rules that keep the codebase coherent:

- **TDD.** Write the failing test, run it, confirm it fails for the right reason, then implement.
- **Verify before claiming.** Run lint, typecheck, unit tests, e2e, and — for UI work — a real browser pass against `docs/design-handoff/` in both themes and both densities.
- **Domain vocabulary changes start in `packages/shared`**, then ripple: schema → migration → API → forms/tables → CSV → export.
- **Update the CLAUDE.md files** for any area whose patterns you change, and update this file at the end of each PR.
- Each PR: branch from the previous one, commit in logical groups, push, open a PR with a verification section, **and stop**. The owner merges.

### Environment quirks worth knowing

- Local Node is 26; the Docker image will pin 22. Native modules (`better-sqlite3`, `@node-rs/argon2`) are verified working on both.
- Vitest runs with globals disabled. `apps/web/vitest.setup.ts` registers Testing Library cleanup **and a localStorage shim** — Node's experimental `localStorage` global shadows jsdom's.
- Web route/guard tests drive the real API client against `src/test/api-stub.ts` (a `"METHOD /path"` route table over stubbed `fetch`). Prefer that over mocking hooks.

## 6. What comes next

Nothing is scheduled. The eight-PR plan is delivered; §7 lists what was deliberately left out and the follow-ups worth picking up.

## 7. Known gaps, deliberate omissions, and follow-ups

- **`POST /auth/forgot-password` is permanently inert**: it always answers 204 and issues nothing. This is not a gap — handing a reset link to whoever asked for it is the thing to avoid. The recovery path is an admin issuing one from the Members page, which now emails it as well as showing it.
- **The Settings page has no Save button**, because the design draws none: selects and switches save on change, text fields on blur and only when the value actually changed. If a Save button is ever wanted, that is a design change, not a bug fix.
- **The prototype's SSO line in the demo log** ("Signed in via SSO") has no counterpart: there is no SSO in v1, so no event says there is.
- The origin guard is disabled in development on purpose (the Vite dev proxy forwards the browser's :5173 origin). E2E runs in production mode so the guard is still covered.
- Post-v1 and explicitly out of scope: OIDC SSO, Postgres, API tokens, pagination beyond ~10k assets, a category-management UI. The README says so too, so nobody goes looking.

### Worth picking up next

1. **A demo seed.** `npm run seed:demo` was in the plan and never built; a prototype-like dataset would make the kitchen-sink and screenshot passes repeatable.
2. **Screenshots in the README.** It describes the product without showing it.
3. **`docker exec` lands as root**, because the image has no `USER` — the entrypoint drops privileges itself. The app process is uid 1000; only an exec session is not. Anyone with daemon access is already root-equivalent, so this is untidy rather than unsafe.
4. **A retention prune for `notification_log`.** Nothing removes those rows, and they accumulate one per sent message forever. Harmless at this scale, untidy at any other.

## 8. Deviations from the prototype, and why

The prototype is a design artifact, not an app: several behaviors it advertises were never implemented in it, and a few details would be bugs if copied. Decisions already made and shipped:

- **Avatar colors hash the entity id** instead of using array position, which recolored everyone when a person was inserted mid-list.
- **First-run setup screen** doesn't exist in the handoff; self-hosting requires it, so it reuses the login layout exactly.
- **Ownership history snapshots holder names** — the design shows a past holder who no longer exists in the employee list.
- **Members link to employees optionally** (per the handoff README), rather than sharing an identity as the prototype's demo data does.
- **The Change-status button misroutes to Assign** in the prototype, which cannot work — an asset in repair has no holder to change. It has its own small modal, offering only the moves `canDirectlyTransition` allows.
- **The ownership timeline's "In stock" spells and "Added to inventory" origin are derived at read time**, not stored as rows, so the database holds only what actually happened. `apps/web/src/features/assets/timeline.ts` composes them.
- **Custom fields are managed by label, keyed by slug.** Renaming a field never moves the key its values hang off; deleting one takes its values, which the modal says out loud before it does it.
- **Keyboard navigation, role gating, edit forms, validation, toasts and empty states** are promised by the design but absent from the prototype; each is scheduled in the PR that owns its screens.
- **The employee list gained the filter input the asset list has.** The design draws no filter row there, but the same live filter is the difference between a usable list and scrolling past two hundred people; it is styled identically and adds nothing new to the language.
- **Date fields are native `type="date"` inputs**, not the design's free-text fields with `"Aug 16, 2026"` placeholders. Dates are stored as `YYYY-MM-DD`, and a native picker guarantees that without inventing a date parser. This is the one place a browser's own chrome shows through.
- **The asset form renders every custom-field definition**, checkbox for booleans and an input for the rest; the design's modal shows only its two boolean fields. Custom fields exist to be defined by the adopting team, so a form that silently supported only booleans would be a trap.
- **No currency select in the asset form.** The design has none either: an asset stores a currency only when it differs from the organization default, which `/meta` now reports so the UI can render every other price.
- **`POST /assets/:id/status` was dropped from the plan** in favour of `PATCH /assets/:id` with a `status` field, guarded by `canDirectlyTransition`. One endpoint, one diff, one place the rule lives; the Change-status modal is pure UI over it.
- **The employee form's "Also invite as a member" section is two requests, not one.** The plan put an optional `invite` block on `POST /employees`; instead the form creates the record and then invites, so a failed invitation leaves the person on file to be invited from the Members page. Rolling the record back to keep the pair atomic would throw away typed-in work.
- **An invited member's row borrows the linked employee's name**, or the email's local part when there is no link. There is no real name until the invitation is accepted, and inventing one would put a fiction in a table people read.
- **A separate last-admin guard was left unwritten.** Refusing to change or remove _your own_ account already guarantees it: every caller is an active admin, so acting on somebody else always leaves at least one. A `last_admin` branch would be unreachable code claiming to protect something.
- **The dashboard's category bars are sorted biggest-first, and keep their zeros.** The prototype sorts too but drops empty categories; keeping them means the widget does not reshape as a category empties, and "0 desktops" is information.
- **The palette's right-hand hint names an asset's category rather than repeating "Asset".** The group header above already says which kind of thing these are, so the prototype's per-row label is redundant where the category is not.
- **CSV parsing happens in the browser, not the API.** The mapping step turns a file into canonical rows, so the server needs no CSV parser and no knowledge of what a spreadsheet called its columns — and the validator it runs cannot be skipped by posting straight to commit.
- **Numbering restarts when the asset-tag prefix changes.** `computeNextTag` only counts tags under the current prefix, so switching AST → INV starts at INV-0001. A team changing prefix is starting a new series; continuing the old count under a new name would be the stranger behaviour.
