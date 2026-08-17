# Hardware Assets Inventory Tool

Self-hosted hardware asset inventory for IT teams ("Inventory" in the UI): assets, employees who hold them, members who sign in, and the full ownership history. Ships as one Docker container with SQLite on a single `/data` volume.

This repo is built to be customized by asking Claude Code. Every area has its own CLAUDE.md with patterns and recipes — read the one closest to the code you're changing.

> **Changing the UI?** Run `npm run dev` and open **`http://localhost:5173/kitchen-sink`**. That page is the design system: the colour tokens with their resolved values, the type scale, the whole icon inventory, and every primitive in every state it ships with — in both themes and both densities. It is the visual specification, and it cannot go stale, because it renders the same components the app does. If a screen needs a colour, a size or a control that is not on that page, question the need before adding one.

## Repo map

- `apps/web` — React 19 + Vite SPA. Design system, pages, modals. See `apps/web/CLAUDE.md`.
- `apps/api` — Fastify API + SQLite (Drizzle). REST under `/api/v1`, sessions + RBAC + audit log, serves the built SPA in production. See `apps/api/CLAUDE.md`.
- `packages/shared` — **single source of truth** for enums, label/color maps, RBAC and zod schemas. Both apps import it; change domain vocabulary here first. See `packages/shared/CLAUDE.md`.
- `e2e` — Playwright tests against the production build. See `e2e/CLAUDE.md`.
- `apps/web/src/features/dev/KitchenSink.tsx` → **`/kitchen-sink`** (dev-only route). The design system, rendered. **Visual source of truth**; open it beside whatever you are building.

## Commands

```bash
npm install          # once, at the root (npm workspaces)
npm run dev          # api on :3000 + web on http://localhost:5173 (dev-only /kitchen-sink; /api proxied)
npm run seed:demo    # fill this instance with a demo workspace (add -- --reset to replace one)
npm test             # unit tests, all workspaces
npm run e2e          # Playwright against the production build
npm run lint         # ESLint
npm run typecheck    # tsc across workspaces
npm run build        # production build
npm run format       # Prettier
```

**A fresh clone starts empty**, at `/setup`. `npm run seed:demo` is the shortcut: a fictional company, its people, 26 devices and four months of history, so every screen has something on it. It prints the logins — one per role — and refuses to touch a workspace that already has data unless you pass `--reset`.

**Two ways to run it, documented in [`docs/development.md`](docs/development.md).** The commands above are the native one. The other needs only Docker:

```bash
docker compose -f docker-compose.dev.yml run --rm app npm run seed:demo
docker compose -f docker-compose.dev.yml up          # → http://localhost:5173
```

Same two processes, same ports, your checkout bind-mounted so hot reload still works. It exists because contributing should not require a Node toolchain — and because the npm scripts set env vars inline, which `cmd.exe` cannot parse, so it is also the Windows answer. Don't confuse it with `docker-compose.yml`, which is the deployment: the built image, no toolchain, no source.

**Dev data lives in `./data` at the repo root** — `apps/api`'s `dev` and `seed:demo` scripts both default `DATA_DIR` to it, and they have to agree or the seed lands somewhere the server never reads. Delete the directory to start over. In dev the API binds `127.0.0.1` and Vite binds `localhost`: both are reached through the proxy, and a dev box handing an un-set-up workspace to the local network is not a feature.

## Non-negotiable conventions

- **TypeScript everywhere, strict.** No new languages, no state-management or component libraries — primitives are hand-rolled for design fidelity.
- **No type is declared at its point of use — every named shape lives in a `types/` folder.** There is one per area, beside the code it serves: `apps/web/src/components/ui/types/`, `apps/web/src/features/assets/types/`, `apps/api/src/types/`, and so on, plus the workspace-level `apps/web/src/types/` for wire shapes that cross areas. A component's props are `AvatarProps` in `types/avatar.ts`, not an anonymous literal in the signature; so are function parameter objects, `createContext` values and the thing behind an `as` cast. Use `interface` for object shapes and `type` for unions, intersections and mapped types.
  - **A file imports its own type module directly** (`./types/avatar`), never the folder's `index.ts` barrel. The barrel is for other areas. That one rule is what stops `Icon.tsx → types/index.ts → types/button.ts → Icon.tsx` from becoming an import cycle.
  - **Types derived from a value stay with that value**, because moving them would drag the value along or invert the dependency: `z.infer` beside its schema, drizzle `$inferSelect` beside its table, `keyof typeof` beside the map it reads (`IconName`, `Action`, `WidgetKey`). Each says so in a comment where it sits.
- **`noUncheckedIndexedAccess` is on**, so `array[i]` is `T | undefined`. Answer it by tightening the type or writing a real guard — a `Map<string, [Row, ...Row[]]>` says "never empty" better than a check, and selecting a row by id beats taking `all()[0]`. Where the invariant is genuinely beyond the compiler (a modulo is in range; `split` never returns an empty array), state it with a **non-null assertion and a comment naming the proof** — never a `??`, which would invent a value where a wrong assertion throws. In tests `!` is the normal answer: a wrong one fails the test, which is what the test is for.
- **A `??` must be a rule, not a rescue.** Coalescing is for values that are genuinely absent by design — a nullable column, a missing query parameter, the design's em dash for an empty cell, an optional parameter's default. It is never for a value that _should_ have been there: inventing one lets a bug run in disguise and reach a screenshot. When a contract is broken, throw and name what was wrong. The same applies to `?.` and `||`. Every `??` that stays says in a comment (or a named helper) why it is the rule; if it needs no explanation, it probably needs deleting. Best of all is when the guard exists only because a type is too loose — tighten the type and the `??` disappears.
- **Enums are slugs** (`in_repair`, `lost_stolen`) defined in `packages/shared/src/enums.ts` with label and semantic-color maps beside them. The database has **no CHECK constraints** on enums, so adding a value is a code-only change.
- **Semantic colors:** every status/role/type maps to `sv ∈ {ok, acc, warn, err, info, neut}` and renders via CSS vars `--{sv}` / `--{sv}-bg`. Never hardcode a status color.
- **Dates**: date-only values are `YYYY-MM-DD` strings; timestamps are ISO-8601 UTC. **Money is integer cents** — `parsePriceToCents` in `packages/shared/src/money.ts` is the only place a typed decimal becomes cents. Emails are lowercased before storage.
- **Who holds an asset lives in `assignments`, never on the asset.** `assets.status = 'assigned'` ⇔ an open ownership row exists, enforced by a partial unique index and maintained only inside the assignment service.
- **Members sign in; employees hold assets.** Two tables, optionally linked, never fused — the same person can be both, and most people are only one. Nobody may change or remove their own account, which is also what guarantees the workspace keeps an admin.
- **A CSV file is parsed in the browser and sent as canonical rows.** The API has no CSV parser and never learns what a particular spreadsheet called its columns; `packages/shared/src/schemas/import.ts` owns the vocabulary all three sides agree on.
- **A raw token exists once, in the response that created it.** Sessions and invite/reset tokens are stored as `sha256(raw)`, so an invitation or reset link is shown to the admin who made it and never recoverable afterwards. That is why the UI displays every link as readable text rather than assuming an email carried it.
- **TDD**: write the failing test first, watch it fail, then implement. Config files are exempt; behavior is not.
- Work happens in sequential PRs; the repo owner merges every PR. Never merge.

- **Email is optional, and that is a feature.** No `SMTP_HOST` means `deps.mailer` is null, and every path that would send has a link-based one that works instead. Delivery never fails the request that triggered it.
- **Ship = tag.** `git tag vX.Y.Z && git push --tags` builds and publishes the image; upgrading an instance is pulling it and restarting, because migrations run at boot and are idempotent.

## Where things are decided

- Visual spec: **`/kitchen-sink`** (dev server) — tokens, type scale, icons, every primitive in every state.
- Design tokens: `apps/web/src/styles/tokens.css` — the 25 custom properties everything else is built from; don't invent values, pick from these.
- Permissions: `packages/shared/src/rbac.ts` (`can(role, action)`) — used by API guards and UI affordances alike.
- How to make a common change: `docs/recipes/` — a checklist per change, each naming every file and the step people forget.
