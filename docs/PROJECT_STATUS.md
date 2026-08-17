# Project status and handoff

**Read this first when picking the project up.** It records where the build stands, what every earlier decision was, and exactly what the next piece of work is. Update it at the end of each PR.

_Last updated: 2026-08-16, after PR 5 (assignment lifecycle)._

---

## 1. What this product is

**Inventory** — an open-source, self-hosted hardware asset inventory for IT teams: track devices, who holds them, and the full ownership history. Any-size company should be able to run it under their own domain with minimal ops effort.

Two first-class goals, equally binding:

1. **Faithful to the design handoff.** `docs/design-handoff/` holds the interactive HTML prototype that is the visual source of truth. Its inline `style="…"` attributes are the spec. Recreate, don't reinterpret.
2. **Customizable by asking Claude Code.** CLAUDE.md files across the repo explain the patterns so an adopting team changes the product through Claude Code instead of reading source. `docs/recipes/` (arrives in PR 8) will hold end-to-end checklists.

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

| PR  | Branch                           | Scope                                                                | State                                                                                         |
| --- | -------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1   | `feat/01-scaffold-design-system` | Monorepo scaffold, design tokens, primitive library, CLAUDE.md set   | **Merged** — [#6](https://github.com/mikhailbahdashych/hardware-assets-inventory-tool/pull/6) |
| 2   | `feat/02-api-core`               | DB schema + migrations, sessions, auth flows, RBAC, audit plumbing   | **Merged** — [#7](https://github.com/mikhailbahdashych/hardware-assets-inventory-tool/pull/7) |
| 3   | `feat/03-auth-ui-shell`          | API client, auth screens, app shell, routing/guards, preference sync | **Merged** — [#8](https://github.com/mikhailbahdashych/hardware-assets-inventory-tool/pull/8) |
| 4   | `feat/04-assets-employees`       | Asset + employee CRUD, list pages, form modals, detail pages         | **Open** — see the PR list; branched from `main`                                              |
| 5–8 | not started                      | see §6                                                               | —                                                                                             |

PRs 1–3 are merged, so PR 4 branches from `main` rather than stacking. To start PR 5: `git checkout feat/04-assets-employees && git checkout -b feat/05-assignments` (it stacks on 4 until 4 merges).

The app now does the whole job it exists for: set up an instance, add people, register devices, hand them out, take them back, and read the full ownership history of any asset or person. What is left is the surrounding product — members and invites (PR 6), the dashboard, command palette and CSV import (PR 7), and email, cron, Docker and the release (PR 8).

## 4. What exists today

### `packages/shared` — the single source of truth

Domain enums as slugs with exact design labels and semantic color maps (`ok|acc|warn|err|info|neut`), `canDirectlyTransition` (Change-status rules), `can(role, action)` RBAC, and zod schemas for the auth payloads. **The database has no CHECK constraints on enum columns on purpose**, so adding a status or category is a code-only change here.

### `apps/api` — Fastify + SQLite (Drizzle)

- Full schema for all 12 tables with one migration checked in (`src/migrations/0000_init.sql`). Migrations run at boot; pulling a newer image and restarting _is_ the upgrade procedure.
- `buildApp({config, db, sqlite, now})` factory — everything injected, including the clock. This is the testability seam.
- Sessions and invite/reset tokens store only `sha256(raw)`; no signing secret exists anywhere. Sliding 30-day sessions, `last_active_at` throttled to one write per five minutes.
- Live endpoints: `/meta`, `/healthz`, `/setup`, `/auth/{login,logout,forgot-password,reset-password,invite/:token,accept-invite,me}`, `/me/prefs`, `/assets` (+ `/next-tag`, `/:id`), `/employees` (+ `/:id`), `/custom-fields`.
- `openAssignment` in `src/services/assignments.ts` is the **only** code path that pairs `status='assigned'` with a new ownership row; PR 5's assign endpoint calls the same function. Deletes are guarded (409) rather than cascading; a deleted person keeps their name on past ownership records.
- Security: origin-guard CSRF stance (same-origin only, no CORS anywhere — **skipped when `NODE_ENV=development`** because the Vite proxy forwards the :5173 origin), per-route rate limits, uniform-timing login, one `{error:{code,message,fields?}}` envelope.
- **Every mutation writes its audit event inside the same transaction.** Keep it that way.

### `apps/web` — React SPA

- Design tokens mirroring the handoff exactly; ~26 hand-rolled primitives with behavior tests; the Feather-style icon inventory; fonts self-hosted (no CDN — the app runs on-prem).
- API client with typed `ApiError`, TanStack Query key catalog, session mutation hooks.
- Auth screens (setup, login, forgot, reset, accept-invite) on the design's 360px column; app shell (sidebar + topbar); routing with three route sets chosen by instance and session state; role gating via shared `can()`.
- Asset and employee lists on the design's exact grid templates, with live filters kept in the URL (`/assets?status=&q=`), status pills counting the whole inventory, footer counts and empty states. One form modal serves create and edit for each entity; detail pages show the record, its custom fields and its current holder.
- `api/invalidate.ts` — `invalidateInventory(queryClient, subject)` is the single cache-invalidation path every inventory write goes through. Extend it rather than invalidating ad hoc inside a mutation.
- Theme/density persist per member on the server and are adopted at sign-in; the inline script in `index.html` applies them before first paint (no flash).
- **`/kitchen-sink`** (dev-only route) renders every primitive for side-by-side review with the prototype.

### `e2e` — Playwright

Runs the real production artifact: built API serving the built SPA, fresh data directory per run, `NODE_ENV=production` so the origin guard is genuinely exercised. Serial (`workers: 1`) because one instance means one workspace — the first test does setup, later tests sign in with that account.

### Verification status

136 unit/integration tests, 9 e2e tests, lint and typecheck clean. CI (`.github/workflows/ci.yml`) runs lint → format check → typecheck → unit tests → build → e2e.

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

### PR 6 — Members, invites UI, admin _(next up)_

Members page with the role/linked-employee/last-active columns and the overflow menu (resend invite, copy reset link, change role, remove; last-admin and self guards); invite modal with the radio role cards and a copyable link that works whether or not SMTP exists; activity log with type chips, "Load more" and CSV export; settings page including the danger zone with type-to-confirm. **Add the viewer/read-only e2e journey here** — it was deferred from PR 3 because creating a non-admin account needs the invite endpoint.

### PR 7 — Dashboard, ⌘K palette, CSV import, export

Five dashboard widgets with per-member visibility, KPI click-through to a filtered asset list; the command palette (client-side over cached lists, **with the ↑↓/↵/esc keyboard navigation the prototype promises but never implemented**); the CSV import wizard including the column-mapping step the design promises, a dry-run validation report, and one shared pure validator used by both `/import/validate` and `/import/commit`; JSON export-all.

### PR 8 — Email, cron, Docker, release, docs

Mailer and seven templates, cron jobs with `notification_log` idempotency, multi-stage Dockerfile + compose + healthcheck, ghcr release workflow, README with screenshots and the env table, `docs/backup-restore.md`, and the `docs/recipes/` set (add-asset-field, add-asset-status, add-page, add-dashboard-widget, add-email, rebrand).

## 7. Known gaps and deliberate deferrals

- **`POST /auth/forgot-password` is intentionally inert**: it always answers 204 and does not yet issue a token or send mail. Email infrastructure lands in PR 8; the admin-issued "copy reset link" recovery path lands in PR 6. Never hand a reset link to an anonymous requester.
- `pruneExpiredSessions` and `revokeMemberSessions` exist and are tested, but nothing schedules the pruning yet — the cron job arrives in PR 8.
- The topbar search button shows a "coming with the command palette" toast; ⌘K is deliberately **not** registered yet, so the browser shortcut isn't stolen for nothing. PR 7 replaces both.
- Dashboard, Members and Admin are still labelled placeholders; Assets and Employees are real.
- **The "Import CSV" button on both list toolbars shows a toast** — the wizard is PR 7. It stays visible because the toolbar's shape is part of the design; the "Manage fields" and "Edit fields" links are _omitted_ rather than made inert, because a dead link inside a form is worse than a missing one. Both arrive with their modals.
- The asset detail page has no contextual primary action (Assign / Check in / Change status) and no ownership timeline, attachments or per-asset audit trail — all PR 5. Its "Current holder" card is real, read from the open ownership record.
- Employee holdings on the detail page are derived client-side from the asset list's `currentHolder`, so no extra endpoint exists yet. When PR 5 adds history, give the employee endpoint its own holdings payload and drop the derivation.
- Custom-field _values_ can be set from the asset form and read on the detail page, but the definitions themselves cannot be managed yet (`GET /custom-fields` is the only endpoint) — PR 5.
- The origin guard is disabled in development on purpose (the Vite dev proxy forwards the browser's :5173 origin). E2E runs in production mode so the guard is still covered.
- Post-v1 and explicitly out of scope for now: OIDC SSO, Postgres, API tokens, pagination beyond ~10k assets, a category-management UI.

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
- **`POST /assets/:id/status` was dropped from the plan** in favour of `PATCH /assets/:id` with a `status` field, guarded by `canDirectlyTransition`. One endpoint, one diff, one place the rule lives; PR 5's Change-status modal is then pure UI over it.
- **The employee create form has no "Also invite as a member" section yet.** Inviting needs the member endpoints, which are PR 6; the checkbox arrives with them rather than sitting there inert.
