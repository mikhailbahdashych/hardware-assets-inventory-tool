# Hardware Assets Inventory Tool

Self-hosted hardware asset inventory for IT teams ("Inventory" in the UI): assets, employees who hold them, members who sign in, and the full ownership history. Ships as one Docker container with SQLite on a single `/data` volume.

This repo is built to be customized by asking Claude Code. Every area has its own CLAUDE.md with patterns and recipes — read the one closest to the code you're changing.

> **Continuing the build?** Read [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md) first — it records what is done, what the next PR is, and the decisions already locked in. Update it at the end of each PR.

## Repo map

- `apps/web` — React 19 + Vite SPA. Design system, pages, modals. See `apps/web/CLAUDE.md`.
- `apps/api` — Fastify API + SQLite (Drizzle). REST under `/api/v1`, sessions + RBAC + audit log, serves the built SPA in production. See `apps/api/CLAUDE.md`.
- `packages/shared` — **single source of truth** for enums, label/color maps, RBAC and zod schemas. Both apps import it; change domain vocabulary here first. See `packages/shared/CLAUDE.md`.
- `e2e` — Playwright tests against the production build. See `e2e/CLAUDE.md`.
- `docs/design-handoff/` — the interactive HTML design prototype. **Visual source of truth**; open it in a browser and compare side-by-side when building UI.

## Commands

```bash
npm install          # once, at the root (npm workspaces)
npm run dev          # api on :3000 + web on http://localhost:5173 (dev-only /kitchen-sink; /api proxied)
npm test             # unit tests, all workspaces
npm run e2e          # Playwright against the production build
npm run lint         # ESLint
npm run typecheck    # tsc across workspaces
npm run build        # production build
npm run format       # Prettier
```

## Non-negotiable conventions

- **TypeScript everywhere, strict.** No new languages, no state-management or component libraries — primitives are hand-rolled for design fidelity.
- **Enums are slugs** (`in_repair`, `lost_stolen`) defined in `packages/shared/src/enums.ts` with label and semantic-color maps beside them. The database has **no CHECK constraints** on enums, so adding a value is a code-only change.
- **Semantic colors:** every status/role/type maps to `sv ∈ {ok, acc, warn, err, info, neut}` and renders via CSS vars `--{sv}` / `--{sv}-bg`. Never hardcode a status color.
- **Dates**: date-only values are `YYYY-MM-DD` strings; timestamps are ISO-8601 UTC. **Money is integer cents** — `parsePriceToCents` in `packages/shared/src/money.ts` is the only place a typed decimal becomes cents. Emails are lowercased before storage.
- **Who holds an asset lives in `assignments`, never on the asset.** `assets.status = 'assigned'` ⇔ an open ownership row exists, enforced by a partial unique index and maintained only inside the assignment service.
- **TDD**: write the failing test first, watch it fail, then implement. Config files are exempt; behavior is not.
- Work happens in sequential PRs; the repo owner merges every PR. Never merge.

## Where things are decided

- Product/visual spec: `docs/design-handoff/README.md` (+ the prototype HTML next to it).
- Design tokens: `apps/web/src/styles/tokens.css` — mirrors the handoff exactly; don't invent values.
- Permissions: `packages/shared/src/rbac.ts` (`can(role, action)`) — used by API guards and UI affordances alike.
