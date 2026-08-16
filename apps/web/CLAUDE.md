# apps/web — React SPA

React 19 + Vite + TypeScript, react-router (declarative `BrowserRouter` mode), TanStack Query for server state. No Tailwind, no component libraries: the design handoff is token-based and primitives are hand-rolled for pixel fidelity.

## Design system rules

- `src/styles/tokens.css` defines all 25 CSS custom properties for both themes plus density. It mirrors `docs/design-handoff/` **exactly** — never invent or tweak token values.
- Theme/density ride on `<html data-theme data-density>`. An inline script in `index.html` applies them from localStorage before first paint (no flash). `ThemeProvider` owns local state; for signed-in members `useThemeControls()` also persists changes to the server, and `useAdoptMemberPrefs()` adopts the member's stored values when their session loads. Preferences follow the person across browsers.
- **Density**: `--rp` is table-row vertical padding (12px ↔ 7px). Only data-table row types consume it — nothing else changes with density.
- **Semantic colors**: components take an `sv` key (`ok|acc|warn|err|info|neut`) from `@inventory/shared` maps and style via `var(--{sv})` / `var(--{sv}-bg)`. `Pill` shows the pattern.
- Typography: UI font Instrument Sans, mono JetBrains Mono (`var(--font-sans)` / `var(--font-mono)`), self-hosted via @fontsource — never add a font CDN (the app runs on-prem). Mono is for identifiers: asset tags, serials, hostnames, kbd hints, log timestamps.
- Icons: `components/ui/Icon.tsx` holds the design's Feather-style path inventory (stroke 1.7). Add new icons there in the same style; don't add an icon library.

## Structure

- `types/` — every named shape the app reuses. `api.ts` is the wire module (each entity the API returns, plus `ApiRequest` and `OrgMeta`); `theme.ts`, `table.ts` and `filters.ts` hold the rest. Add a shape here as soon as a second file needs it, or as soon as you catch yourself writing `as { … }`. **Prop shapes stay inline in their component** — they belong to one file, and hoisting them only makes the component harder to read. `interface` for object shapes, `type` for unions.
- `api/` — `client.ts` (fetch wrapper; see below), `queries.ts` (**the query-key catalog** + read hooks), `mutations.ts` (write hooks and their cache updates).
- `components/ui/` — primitives (Button, Pill, DataTable, Modal, …), one component + one CSS module each, exported from `index.ts`. Interactive primitives have behavior tests in `primitives.test.tsx`.
- `components/app/` — shell chrome: `AppShell`, `Sidebar`, `Topbar`, `PageContainer`, `nav.ts` (pure section/breadcrumb logic), `useThemeControls.ts`.
- `features/<area>/` — pages and feature modals per area (auth, dashboard, assets, employees, members, admin, import).
- `providers/` — ThemeProvider, ToastProvider (and later ModalProvider). Hooks live next to their provider.
- `lib/` — `format.ts` (dates, relative time, durations, currency, initials) and `avatar.ts` (stable hash → 9-color palette). Reuse these; never re-implement formatting inline.
- `routes.tsx` — the whole route map and its guards. `App.tsx` only wires providers.

**Imports:** anything that crosses a directory uses the `@/` alias for `src/` (`@/components/app/PageContainer`, `@/lib/format`) — never `../../`. Same-directory imports stay relative (`./AssetFormModal`, `./filters`, `./Assets.module.css`); the alias would only add noise. CSS modules and `import type` follow the same rule, and `@inventory/shared` is a package import, not an alias. Keep the grouping: external packages, then `@inventory/shared`, then `@/` app imports, then `./` neighbours, styles last.

The alias is declared in **three** places that must agree, or you get a green typecheck and a red build: `tsconfig.json` (`paths`), `vite.config.ts` (`resolve.alias`), and Vitest — which reads the same `vite.config.ts`, so its `test` block needs no separate entry. Add a fourth resolver (Storybook, a bundler) and you must teach it the alias too. `apps/api` uses the same `@/` convention, but its Vitest does not share a Vite config, so it mirrors the alias in `apps/api/vitest.config.ts`.

## The three ways a request can fail

`client.ts` tells them apart instead of flattening them into one error, and never fabricates a code or a message:

- **The body is the envelope** (`{ error: { code, message, fields? } }`, the `ApiErrorEnvelope` interface in `@inventory/shared`) → `ApiError` carrying the server's own words. 422 field messages reach the form through `fieldErrors()`.
- **No body at all** — a proxy, a gateway, a dropped connection, never this API answering → `HttpError`, whose code and message are read off the response (`http_502`). It extends `ApiError`, so `instanceof` checks still work.
- **A body that is not the envelope**, or a 2xx whose body is not JSON → `MalformedApiResponse`, quoting what actually arrived. That is the API breaking its own contract; the throw is the bug report.

## When a `??` is legitimate here

Keep it when absence is the answer: a nullable column becoming an empty form input, `searchParams.get('q') ?? ''` (no parameter means no filter), `?? '—'` where the design specifies an em dash, `query.data ?? []` (a list that has not arrived has no rows), an optional prop's default. Say why in a comment.

Remove it when a value should have been there. `meta.data?.orgName ?? 'Inventory'` was the example: `orgName` is a NOT NULL column written by `/setup`, so the fallback quietly renamed the workspace whenever `/meta` misbehaved. Reads of it go through `orgMeta()` in `api/queries.ts`, which throws and names the missing field. Best of all, remove it by tightening a type — `AssignModal`'s props became a union discriminated on `mode` and four fallbacks went with it.

## Data and auth

- Reads go through hooks in `api/queries.ts`; add the key to `queryKeys` first. Writes live in `api/mutations.ts` and go through `invalidateInventory` in `api/invalidate.ts` — one coarse refresh of every inventory surface. Do not hand-pick keys in a mutation: a write rarely touches only the record you were looking at, and naming subjects is how checking an asset in stopped refreshing the holder's page.
- `useMe()` resolves to the member or `null`; a 401 is an expected signed-out state, not an error.
- `routes.tsx` picks one of three route sets from instance + session state: uninitialized → setup only; signed out → auth screens only; signed in → the shell. Role gating uses shared `can()` (Admin section is admins-only), so permissions never drift from the API.
- Auth screens share `features/auth/AuthLayout.tsx` (the design's 360px column, its own theme toggle, version footer) and `AuthField`. Server errors render via `FormError`; 422 field messages land under their inputs through `fieldErrors()`.

## Reviewing visual work

Run `npm run dev` and open `http://localhost:5173/kitchen-sink` (dev-only route, excluded from production builds). Compare against the prototype in `docs/design-handoff/` side-by-side, in **both themes and both densities**, before calling UI work done.

## Testing

Vitest + Testing Library (jsdom). `vitest.setup.ts` registers cleanup and a localStorage shim (Node's experimental global shadows jsdom's). Write the failing test first.

- Component tests assert behavior via roles/attributes (`data-variant`, `aria-current`), never CSS class names.
- Route, guard and data-flow tests live in `src/app.test.tsx` and drive the real API client against `src/test/api-stub.ts` (a small `"METHOD /path"` route table over stubbed `fetch`). Prefer it over mocking hooks — it exercises the client, the query cache and the routing together.
- Theme state outlives a render: reset `localStorage` and the `<html>` dataset in `afterEach` for any test that touches it.

## Adding a primitive

1. Check the prototype for exact styles (inline `style="…"` attributes are the spec).
2. Test first for any behavior; static markup is covered by the kitchen sink.
3. Component + CSS module in `components/ui/`, export from `index.ts`, add a kitchen-sink section.
