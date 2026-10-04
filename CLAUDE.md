# Hardware Assets Inventory Tool

Self-hosted hardware asset inventory for IT teams ("Inventory" in the UI): assets, the employees who hold them, the members who sign in, and the full ownership history. One Docker container with SQLite on a single `/data` volume — or, with `DATABASE_URL` set, the same container against PostgreSQL.

This repo is built to be customized by asking Claude Code. Every area has its own CLAUDE.md — read the one closest to the code you are changing — and [`docs/recipes/`](docs/recipes/README.md) has a checklist per common change, each naming every file and the step people forget.

> **Changing the UI?** Run `npm run dev` and open **`http://localhost:5173/kitchen-sink`**: the colour tokens with their resolved values, the type scale, every icon and every primitive in every state, in both themes and densities. It renders the same components the app does, so it cannot go stale. If a screen needs a colour, size or control that is not on that page, question the need first.

## Repo map

- `apps/web` — React 19 + Vite SPA: design system, pages, modals. See `apps/web/CLAUDE.md`.
- `apps/api` — Fastify over SQLite or PostgreSQL (Drizzle, async end to end). REST under `/api/v1` with sessions, RBAC and the audit log; serves the built SPA in production. A second, curated surface at `/api/public/v1` answers server-to-server callers holding a scoped API token — Bearer only, cookies refused, audited as the token. See `apps/api/CLAUDE.md`.
- `packages/shared` — **the single source of truth** for enums, label/colour maps, RBAC and zod schemas. Change domain vocabulary here first. See `packages/shared/CLAUDE.md`.
- `e2e` — Playwright against the production build. See `e2e/CLAUDE.md`.
- `infrastructure` — flat Terraform for the AWS deployment (VPC, EC2, RDS PostgreSQL, S3), one responsibility per `.tf` file; it produces `DATABASE_URL`, `S3_BUCKET`, `S3_REGION`, `APP_URL` and `trust_proxy` and stops — the domain, proxy and TLS are the operator's edge. `terraform fmt` and `validate` run in CI. See `infrastructure/README.md` and `docs/recipes/change-infrastructure.md`.

## Commands

```bash
npm install          # once, at the root (npm workspaces)
npm run dev          # api on :3000 + web on http://localhost:5173 (/api proxied)
npm run seed:demo    # a demo workspace (-- --reset replaces one)
npm test             # unit + integration, all workspaces (npm run test:pg: the api suite on PostgreSQL)
npm run e2e          # Playwright against the production build
npm run lint && npm run typecheck && npm run format:check
npm run build        # production build
```

- **A fresh clone starts empty, at `/setup`.** `npm run seed:demo` makes a fictional company with one login per role, and refuses a workspace that has data unless given `--reset`.
- **Dev data lives in `./data`** — `dev` and `seed:demo` both default `DATA_DIR` there, and must agree. Delete it to start over. A database from before v0.3.0 is brought forward at boot by the migration bridge (`apps/api/CLAUDE.md`, "Migrations").
- **No Node toolchain?** `docker-compose.dev.yml` runs the same two processes with the checkout bind-mounted — also the Windows answer, since the npm scripts set env vars inline. See [`docs/development.md`](docs/development.md). `docker-compose.yml` is the deployment, not this.
- In dev the API binds `127.0.0.1` and Vite `localhost`: an un-set-up workspace is not something to offer the local network.

## Non-negotiable conventions

- **TypeScript everywhere, strict.** No new languages, no state-management or component libraries — primitives are hand-rolled for design fidelity.
- **Every named type lives in a `types/` folder**, one per area beside the code it serves (`apps/web/src/components/ui/types/`, `apps/api/src/types/`, …) plus `apps/web/src/types/` for wire shapes. Props, parameter objects, context values and anything behind an `as` are named there. `interface` for object shapes, `type` for unions and mapped types.
  - **A file imports its own type module directly** (`./types/avatar`), never the folder's `index.ts` barrel — the barrel is for other areas, and this is what keeps `Icon.tsx → types/index.ts → types/button.ts → Icon.tsx` from being a cycle.
  - **A type derived from a value stays with the value** (`z.infer` by its schema, `$inferSelect` by its table, `keyof typeof` by its map), with a comment saying so.
- **`noUncheckedIndexedAccess` is on.** Answer `T | undefined` with a tighter type or a real guard — a `Map<string, [Row, ...Row[]]>` says "never empty" better than a check, and selecting a row by id beats taking `all()[0]`. Where the proof is beyond the compiler, a `!` with a comment naming it — never a `??`, because a wrong assertion throws where a `??` invents a value. In tests `!` is normal.
- **A `??` must be a rule, not a rescue.** Coalesce only what is absent by design — a nullable column, a missing query parameter, the design's em dash, an optional parameter's default — and say why in a comment. When a value should have been there, throw and name what was wrong — inventing one lets a bug run in disguise and reach a screenshot. The same goes for `?.` and `||`. Best: tighten the type until the `??` disappears.
- **Enums are slugs** in `packages/shared/src/enums.ts` with label and semantic-colour maps beside them; the database has **no CHECK constraints**, so a new value is code-only. **Statuses and roles are the exceptions** — rows a workspace edits on the Workflow and Roles pages. A value the product decides is an enum; a value a workspace decides is a table.
- **Semantic colours:** every status/role/type maps to `sv ∈ {ok, acc, warn, err, info, neut}` and renders via `--{sv}` / `--{sv}-bg`. Never hard-code one.
- **Dates** are `YYYY-MM-DD` strings and must be a real calendar day — `2026-02-30` is refused everywhere (API, public API, import) through `requiredDate` / `nullableDate` / `isCalendarDate` in `packages/shared/src/schemas/common.ts`. Timestamps are ISO-8601 UTC. **Money is integer cents**, and `parsePriceToCents` (`packages/shared/src/money.ts`) is the only way typed money becomes cents. Emails are lowercased before storage.
- **Who holds an asset lives in `assignments`, never on the asset.** `assets.status = 'assigned'` ⇔ an open ownership row exists — a partial unique index, maintained only inside the assignment service.
- **The API is async end to end.** Drizzle's builders are thenables, so a forgotten `await` compiles and never runs; eslint's promise rules catch most cases and `apps/api/CLAUDE.md` says what they cannot see.
- **`DATABASE_URL` chooses the engine — the only choice there is.** One logical schema in `schema.sqlite.ts` and `schema.pg.ts`, kept identical by a parity test, so **a schema change generates both migration folders**. `db/` is the only directory that knows there are two engines.
- **Members sign in; employees hold assets.** Two tables, optionally linked, at most one member per employee. Nobody may change or remove their own account (which also keeps an admin), and nobody below admin acts on an admin account or mints one (which keeps a `members.manage` grant from being a ladder).
- **A CSV file is parsed in the browser** and sent as canonical rows; `packages/shared/src/schemas/import.ts` owns the vocabulary.
- **Two-factor is a workspace switch, not a personal setting.** `org_settings.mfa_required` turns it on for everybody; a `members.manage` holder resets a member's (an admin's, only an admin) and there is no self-service door; turning it off wipes every secret and code; `apps/api/src/db/mfa-reset-cli.ts` is the break-glass path. TOTP is hand-written against RFC 6238's test vectors — keep them.
- **A raw token exists once, in the response that created it.** Sessions, invite/reset links and API tokens are stored as `sha256(raw)`, which is why the UI shows every link as copyable text.
- **There is no email — notices land in an in-app inbox**, one row per recipient, rendered by `renderNotification` in shared and deduplicated by `(member_id, dedupe_key)`. Invitations and resets are copyable links, so nothing waits on deliverability.
- **TDD**: the failing test first, watched failing, then the code. Config is exempt; behaviour is not.
- **Work happens in sequential PRs; the repo owner merges every one. Never merge.**
- **Ship = tag.** `git tag vX.Y.Z && git push --tags` builds and publishes the image; an upgrade is a pull and a restart, because migrations run at boot and are idempotent.

## Where things are decided

- Visual spec: **`/kitchen-sink`** (dev server), rendered by `apps/web/src/features/dev/KitchenSink.tsx`.
- Design tokens: `apps/web/src/styles/tokens.css` — 27 custom properties (25 per theme plus the two font stacks). Don't invent values; pick from these.
- Permissions: `packages/shared/src/rbac.ts` (`can(permissions, action)`), read by API guards and UI affordances alike.
- Common changes: `docs/recipes/`.
