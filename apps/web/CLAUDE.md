# apps/web — React SPA

React 19 + Vite + TypeScript, react-router (declarative `BrowserRouter` mode), TanStack Query for server state. No Tailwind, no component libraries: the design handoff is token-based and primitives are hand-rolled for pixel fidelity.

## Design system rules

- `src/styles/tokens.css` defines all 25 CSS custom properties for both themes plus density. It mirrors `docs/design-handoff/` **exactly** — never invent or tweak token values.
- Theme/density ride on `<html data-theme data-density>`. An inline script in `index.html` applies them from localStorage before first paint (no flash). `ThemeProvider` owns local state; for signed-in members `useThemeControls()` also persists changes to the server, and `useAdoptMemberPrefs()` adopts the member's stored values when their session loads. Preferences follow the person across browsers.
- **Density**: `--rp` is table-row vertical padding (12px ↔ 7px). Only data-table row types consume it — nothing else changes with density.
- **Semantic colors**: components take an `sv` key (`ok|acc|warn|err|info|neut`) from `@inventory/shared` maps and style via `var(--{sv})` / `var(--{sv}-bg)`. `Pill` shows the pattern.
- Typography: UI font Instrument Sans, mono JetBrains Mono (`var(--font-sans)` / `var(--font-mono)`), self-hosted via @fontsource — never add a font CDN (the app runs on-prem). Mono is for identifiers: asset tags, serials, hostnames, kbd hints, log timestamps.
- Icons: `components/ui/Icon.tsx` holds the design's Feather-style path inventory (stroke 1.7). Add new icons there in the same style; don't add an icon library.
- **The command palette does the keyboard work the design promises.** Its footer says "↑↓ navigate · ↵ open · esc close" and the prototype implements none of it. `components/app/palette.ts` is the pure half — grouping, the four-per-group cap, role filtering — so the list can be tested without a keyboard; `CommandPalette.tsx` is one flat roving index over it, wrapping at both ends, with the highlight returning to the top as the results change under it.
- **Anything that floats over a table is portalled to the body.** `Menu` (the design's `···` overflow) and `Dropdown` position themselves from the trigger's own rect for a reason: a `DataTable` cell clips its overflow — that clip is what gives the other cells their ellipsis — and the card around it clips to its border radius. A popover rendered in place is a popover the row eats, and no z-index fixes it.
- **`Dropdown` is the app's only select.** A native `<select>` draws the _operating system's_ menu — grey on macOS, square on Windows — inside a design that specifies neither, and no CSS reaches inside it. So the primitive is the ARIA select-only combobox: a button that looks exactly like `Input`, owning a portalled `role="listbox"`. It does the keyboard work a native select does — Enter/Space/↑/↓ to open, arrows that stop at the ends rather than wrapping, Home/End, type-ahead on the first letter, Esc to close and return focus — because a person who never touches the mouse should not notice the swap. Values are `string` unions; the label is what appears on screen, so **tests match options by label** through `src/test/dropdown.ts` (`choose`) and e2e through `e2e/helpers/dropdown.ts`. `userEvent.selectOptions` and Playwright's `selectOption` drive a native element and will not work.

## Structure

- `types/` — every named shape the app reuses. `api.ts` is the wire module (each entity the API returns, plus `ApiRequest` and `OrgMeta`); `theme.ts`, `table.ts` and `filters.ts` hold the rest. Add a shape here as soon as a second file needs it, or as soon as you catch yourself writing `as { … }`. **Prop shapes stay inline in their component** — they belong to one file, and hoisting them only makes the component harder to read. `interface` for object shapes, `type` for unions.
- `api/` — `client.ts` (fetch wrapper; see below), `queries.ts` (**the query-key catalog** + read hooks), `mutations.ts` (write hooks and their cache updates).
- `components/ui/` — primitives (Button, Pill, DataTable, Modal, …), one component + one CSS module each, exported from `index.ts`. Interactive primitives have behavior tests in `primitives.test.tsx`.
- `components/app/` — shell chrome: `AppShell`, `Sidebar`, `Topbar`, `PageContainer`, `nav.ts` (pure section/breadcrumb logic), `useThemeControls.ts`.
- `features/<area>/` — pages and feature modals per area (auth, dashboard, assets, employees, members, admin, import). `members/CopyLinkModal.tsx` is shared with the employee form, which can invite the person it just created; inviting is a members concern, so the form borrows it rather than growing a second way to show a one-time link. `admin/` holds **two pages, not one with tabs**: `ActivityLogPage` (`/activity`) is for reading what happened, `AdminPage` (`/admin`) for changing how the workspace behaves. Both are admin-only, and their old tab URLs (`/admin/activity`, `/admin/settings`) still redirect — `/admin/activity?type=auth` was a shareable link, so `LegacyActivityRedirect` carries the query string across.
- `providers/` — ThemeProvider, ToastProvider, ModalProvider. Hooks live next to their provider.
  **ModalProvider owns the six app-level modals** (palette, new asset, add employee, invite member, import, widgets) and `components/app/ModalHost.tsx` renders whichever is open, mounted once in the shell. They live there because the command palette opens four of them from anywhere and two are reachable from more than one screen; without an owner they would be the same boolean declared three times. Anything carrying a **subject** — assign, check in, change status, edit — stays local state on the page that knows the subject.
- `lib/` — `format.ts` (dates, relative time, durations, currency, initials) and `avatar.ts` (stable hash → 9-color palette). Reuse these; never re-implement formatting inline.
- `routes.tsx` — the whole route map and its guards. `App.tsx` only wires providers.

**Imports:** anything that crosses a directory uses the `@/` alias for `src/` (`@/components/app/PageContainer`, `@/lib/format`) — never `../../`. Same-directory imports stay relative (`./AssetFormModal`, `./filters`, `./Assets.module.css`); the alias would only add noise. CSS modules and `import type` follow the same rule, and `@inventory/shared` is a package import, not an alias. Keep the grouping: external packages, then `@inventory/shared`, then `@/` app imports, then `./` neighbours, styles last.

The alias is declared in **three** places that must agree, or you get a green typecheck and a red build: `tsconfig.json` (`paths`), `vite.config.ts` (`resolve.alias`), and Vitest — which reads the same `vite.config.ts`, so its `test` block needs no separate entry. Add a fourth resolver (Storybook, a bundler) and you must teach it the alias too. `apps/api` uses the same `@/` convention, but its Vitest does not share a Vite config, so it mirrors the alias in `apps/api/vitest.config.ts`.

## The three ways a request can fail

`client.ts` tells them apart instead of flattening them into one error, and never fabricates a code or a message:

- **The body is the envelope** (`{ error: { code, message, fields? } }`, the `ApiErrorEnvelope` interface in `@inventory/shared`) → `ApiError` carrying the server's own words. 422 field messages reach the form through `fieldErrors()`.
- **No body at all** — a proxy, a gateway, a dropped connection, never this API answering → `HttpError`, whose code and message are read off the response (`http_502`). It extends `ApiError`, so `instanceof` checks still work.
- **A body that is not the envelope**, or a 2xx whose body is not JSON → `MalformedApiResponse`, quoting what actually arrived. That is the API breaking its own contract; the throw is the bug report.

## Indexing, under `noUncheckedIndexedAccess`

`array[i]` is `T | undefined`. Prefer removing the doubt over asserting it away: `Dropzone` hands its caller a single `File` rather than a `FileList` because every caller wanted the first one, and the palette reads `rows[active]` into one `activeRow` and checks it, because that index is maintained by hand across renders and ↵ on nothing should do nothing. The one assertion in this workspace is `avatar.ts`, where a hash modulo the palette length is provably in range and a fallback colour would hide a real mistake.

## When a `??` is legitimate here

Keep it when absence is the answer: a nullable column becoming an empty form input, `searchParams.get('q') ?? ''` (no parameter means no filter), `?? '—'` where the design specifies an em dash, `query.data ?? []` (a list that has not arrived has no rows), an optional prop's default. Say why in a comment.

Remove it when a value should have been there. `meta.data?.orgName ?? 'Inventory'` was the example: `orgName` is a NOT NULL column written by `/setup`, so the fallback quietly renamed the workspace whenever `/meta` misbehaved. Reads of it go through `orgMeta()` in `api/queries.ts`, which throws and names the missing field. Best of all, remove it by tightening a type — `AssignModal`'s props became a union discriminated on `mode` and four fallbacks went with it.

## Data and auth

- Reads go through hooks in `api/queries.ts`; add the key to `queryKeys` first. Writes live in `api/mutations.ts` and go through one of the two coarse invalidators in `api/invalidate.ts`: `invalidateInventory` for assets/employees/assignments, `invalidateAdmin` for members, settings, the activity log and `/meta`. Do not hand-pick keys in a mutation: a write rarely touches only the record you were looking at, and naming subjects is how checking an asset in stopped refreshing the holder's page.
- **Deleting the workspace is the one write that invalidates everything** (`queryClient.invalidateQueries()`), so `/meta` speaks again and the router lands on `/setup`. Not `clear()` — it empties the mutation cache too and drops the mutation's own callbacks mid-flight — and not `removeQueries()`, which leaves live observers holding their last result, so nothing refetches and the app keeps showing a workspace that no longer exists.
- `useMe()` resolves to the member or `null`; a 401 is an expected signed-out state, not an error.
- `routes.tsx` picks one of three route sets from instance + session state: uninitialized → setup only; signed out → auth screens only; signed in → the shell. Role gating uses shared `can()` (Admin section is admins-only), so permissions never drift from the API.
- Auth screens share `features/auth/AuthLayout.tsx` (the design's 360px column, its own theme toggle, version footer) and `AuthField`. Server errors render via `FormError`; 422 field messages land under their inputs through `fieldErrors()`.

## Reviewing visual work

Run `npm run dev` and open `http://localhost:5173/kitchen-sink` (dev-only route, excluded from production builds). Compare against the prototype in `docs/design-handoff/` side-by-side, in **both themes and both densities**, before calling UI work done.

## When email does not exist

`/meta` reports `smtpConfigured`, and `components/app/NotifyCheckbox.tsx` is the one control that reads it: disabled, with the reason where the switch is, rather than hidden. Somebody wondering why nobody got an email should find the answer where they went looking for the switch. The Settings page's four notification toggles do the same thing inline.

## The import wizard

`features/import/` is five steps over one modal. The file is read in the browser (`parseCsv.ts`, papaparse) and the **mapping step turns it into canonical rows**, so the API never sees CSV and never has to know what a particular spreadsheet called its columns. The auto-matcher and the column list live in `@inventory/shared` — the same ones the template endpoint serves.

Errors block the import and name their row and column; warnings say what will happen and let it through. "Row 3" counts the header as line 1, which is what a spreadsheet shows.

## The settings form has a Save button, and the design does not

A deliberate departure, recorded in `docs/PROJECT_STATUS.md` §8. The prototype saves each control as you leave it, which means a stray keystroke in "Company name" renames the workspace for everybody with no way back, and a half-considered thought becomes policy.

`settingsDraft.ts` is the shape of it: the whole form is one `SettingsDraft` in local state, and `changedSettings(stored, draft)` returns only the fields that differ. **That diff is also the dirty check** — `Object.keys(patch).length > 0` is what enables Save — so the button and the payload can never disagree about whether there is anything to save. `SettingsForm` is keyed on `settings.updatedAt`, so a successful save (or anyone else's) re-seeds every field from the row rather than leaving stale text on screen.

The lead-time field holds _text_, because `""` and `"4x"` are things a person can type; unparseable text is still counted as a change and sent as `-1` so the schema names what is wrong under the field, instead of Save going quiet and leaving somebody clicking a dead button.

## Testing

Vitest + Testing Library (jsdom). `vitest.setup.ts` registers cleanup and a localStorage shim (Node's experimental global shadows jsdom's). Write the failing test first.

- Component tests assert behavior via roles/attributes (`data-variant`, `aria-current`), never CSS class names.
- Route, guard and data-flow tests live in `src/app.test.tsx` and drive the real API client against `src/test/api-stub.ts` (a small `"METHOD /path"` route table over stubbed `fetch`). Prefer it over mocking hooks — it exercises the client, the query cache and the routing together. Feature journeys use the same helper from their own feature folder. A route key may carry a query string to answer one exact request; the bare path is the fallback, and `api.called(...)`/`api.calledAll(...)` report each call's `search` so filter behavior is assertable.
- Theme state outlives a render: reset `localStorage` and the `<html>` dataset in `afterEach` for any test that touches it.

## Adding a primitive

1. Check the prototype for exact styles (inline `style="…"` attributes are the spec).
2. Test first for any behavior; static markup is covered by the kitchen sink.
3. Component + CSS module in `components/ui/`, export from `index.ts`, add a kitchen-sink section.
