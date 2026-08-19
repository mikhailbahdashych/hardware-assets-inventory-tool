# apps/web — React SPA

React 19 + Vite + TypeScript, react-router (declarative `BrowserRouter` mode), TanStack Query for server state. No Tailwind, no component libraries: the design is token-based and the primitives are hand-rolled, which is what keeps every screen built from the same 25 values.

## Design system rules

- `src/styles/tokens.css` defines all 25 CSS custom properties for both themes plus density. **It is the palette — never invent or tweak a value.** `/kitchen-sink` renders every one of them with its resolved colour, so "is there already a token for this?" is a question you answer by looking.
- Theme/density ride on `<html data-theme data-density>`. An inline script in `index.html` applies them from localStorage before first paint (no flash). `ThemeProvider` owns local state; for signed-in members `useThemeControls()` also persists changes to the server, and `useAdoptMemberPrefs()` adopts the member's stored values when their session loads. Preferences follow the person across browsers.
- **Density**: `--rp` is table-row vertical padding (12px ↔ 7px). Only data-table row types consume it — nothing else changes with density.
- **Semantic colors**: components take an `sv` key (`ok|acc|warn|err|info|neut`) from `@inventory/shared` maps and style via `var(--{sv})` / `var(--{sv}-bg)`. `Pill` shows the pattern.
- Typography: UI font Instrument Sans, mono JetBrains Mono (`var(--font-sans)` / `var(--font-mono)`), self-hosted via @fontsource — never add a font CDN (the app runs on-prem). Mono is for identifiers: asset tags, serials, hostnames, kbd hints, log timestamps.
- Icons: `components/ui/Icon.tsx` holds the design's Feather-style path inventory (stroke 1.7). Add new icons there in the same style; don't add an icon library.
- **The command palette does the keyboard work its own footer promises.** It says "↑↓ navigate · ↵ open · esc close", so it does all three. `components/app/palette.ts` is the pure half — grouping, the four-per-group cap, filtering by permission — so the list can be tested without a keyboard; `CommandPalette.tsx` is one flat roving index over it, wrapping at both ends, with the highlight returning to the top as the results change under it.
- **Anything that floats over a table is portalled to the body.** `Menu` (the design's `···` overflow) and `Dropdown` position themselves from the trigger's own rect for a reason: a `DataTable` cell clips its overflow — that clip is what gives the other cells their ellipsis — and the card around it clips to its border radius. A popover rendered in place is a popover the row eats, and no z-index fixes it.
- **`Dropdown` is the app's only select.** A native `<select>` draws the _operating system's_ menu — grey on macOS, square on Windows — inside a design that specifies neither, and no CSS reaches inside it. So the primitive is the ARIA select-only combobox: a button that looks exactly like `Input`, owning a portalled `role="listbox"`. It does the keyboard work a native select does — Enter/Space/↑/↓ to open, arrows that stop at the ends rather than wrapping, Home/End, type-ahead on the first letter, Esc to close and return focus — because a person who never touches the mouse should not notice the swap. Values are `string` unions; the label is what appears on screen, so **tests match options by label** through `src/test/dropdown.ts` (`choose`) and e2e through `e2e/helpers/dropdown.ts`. `userEvent.selectOptions` and Playwright's `selectOption` drive a native element and will not work.

## Structure

- **`types/` folders, one per area** — `components/ui/types/`, `components/app/types/`, `providers/types/`, `lib/types/`, and one inside every `features/<area>/`. No type is written at its point of use: a component's props are `AvatarProps` in `components/ui/types/avatar.ts`, one file per component, named in camelCase after it. Function parameter objects, `createContext` values and anything behind an `as { … }` go the same way. `interface` for object shapes, `type` for unions.
  - The **workspace-level `src/types/`** keeps what crosses areas: `api.ts` is the wire module (each entity the API returns, plus `ApiRequest` and `OrgMeta`), and `theme.ts`, `table.ts`, `filters.ts`, `modals.ts`, `import.ts` hold the rest.
  - **A file imports its own type module directly** — `import type { AvatarProps } from './types/avatar'` — never the folder's `index.ts`. The barrel is there for _other_ areas. That rule is what keeps `Icon.tsx → types/index.ts → types/button.ts → Icon.tsx` from being an import cycle, and each barrel says so at the top.
  - **A type derived from a value stays with that value.** `IconName` is `keyof typeof ICONS` and `WidgetKey` reads a local `as const` array; moving either would drag the value into a type module or invert the dependency. Both carry a comment saying so. Everything else moves.
- `api/` — `client.ts` (fetch wrapper; see below), `queries.ts` (**the query-key catalog** + read hooks), `mutations.ts` (write hooks and their cache updates).
- `components/ui/` — primitives (Button, Pill, DataTable, Modal, …), one component + one CSS module + one `types/` module each, exported from `index.ts`. Interactive primitives have behavior tests in `primitives.test.tsx`. The one CSS module with no component beside it is `FormModal.module.css`, shared by the seven feature modals so their fields, hints and footers line up — it is a stylesheet, not a missing component.
- `components/app/` — shell chrome: `AppShell`, `Sidebar`, `Topbar`, `PageContainer`, `nav.ts` (pure section/breadcrumb logic), `useThemeControls.ts`.
- `features/<area>/` — pages and feature modals per area (auth, dashboard, assets, employees, members, admin, import, workflow). `members/CopyLinkModal.tsx` is shared with the employee form, which can invite the person it just created; inviting is a members concern, so the form borrows it rather than growing a second way to show a one-time link. `admin/` holds **two pages, not one with tabs**: `ActivityLogPage` (`/activity`) is for reading what happened, `AdminPage` (`/admin`) for changing how the workspace behaves. Both are admin-only, and their old tab URLs (`/admin/activity`, `/admin/settings`) still redirect — `/admin/activity?type=auth` was a shareable link, so `LegacyActivityRedirect` carries the query string across.
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
- `routes.tsx` picks one of three route sets from instance + session state: uninitialized → setup only; signed out → auth screens only; signed in → the shell. **Gating asks `can(me.permissions, action)`**, never a role: `/auth/me` carries the set the API resolved for this request, and `requireAction` reads the very same set on the server — so a button and the door behind it cannot disagree. Every gated page and every affordance takes a `permissions: Action[]` prop from the session; nothing downstream knows what a role is called.
- Auth screens share `features/auth/AuthLayout.tsx` (the design's 360px column, its own theme toggle, version footer) and `AuthField`. Server errors render via `FormError`; 422 field messages land under their inputs through `fieldErrors()`.
- **Recovery codes have one screen, reached from two places.** `RecoveryCodesScreen` is the last step of enrolment _and_ the interruption in a sign-in that found none left and minted ten; only the sentence explaining an unasked-for set differs. Both are the one moment those codes exist, which is why `useMfaConfirm` and `useMfaVerify` deliberately leave `/auth/me` alone while it is up: the routes render from that query, so refreshing it would swap the screen for the app and take the codes with it. The button that admits you have kept them is what asks — a full navigation from enrolment, `useRefreshSession()` from the login page.
- **A column can be an affordance too.** The Members page draws its Two-factor column (enrolled pill, "N of 10 codes left", em dash for nobody enrolled) only for a viewer holding `members.manage`. The payload is the same for everybody — reads are open by philosophy — so the gate is what is _drawn_, exactly like the row menu beside it. Its widths came out of the other columns: that page is 960 wide and `DataTable` clips its overflow, so a column that does not fit takes the `···` off the edge rather than scrolling.

## Reviewing visual work

Run `npm run dev` and open `http://localhost:5173/kitchen-sink` (dev-only route, excluded from production builds). **That page is the design system**: surface tokens with their resolved values, the six semantic pairs, the type scale, the whole icon inventory, and every primitive including its disabled and error states.

Walk it in **both themes and both densities** before calling UI work done. It cannot go stale, because it renders the same components the app does — which is also why a new primitive is not finished until it has a section there.

## When email does not exist

`/meta` reports `smtpConfigured`, and `components/app/NotifyCheckbox.tsx` is the one control that reads it: disabled, with the reason where the switch is, rather than hidden. Somebody wondering why nobody got an email should find the answer where they went looking for the switch. The Settings page's four notification toggles do the same thing inline.

## The import wizard

`features/import/` is five steps over one modal. The file is read in the browser (`parseCsv.ts`, papaparse) and the **mapping step turns it into canonical rows**, so the API never sees CSV and never has to know what a particular spreadsheet called its columns. The auto-matcher and the column list live in `@inventory/shared` — the same ones the template endpoint serves.

Errors block the import and name their row and column; warnings say what will happen and let it through. "Row 3" counts the header as line 1, which is what a spreadsheet shows.

## The settings form has a Save button, and the design does not

A deliberate departure from the original design, which draws none. Saving each control as you leave it means a stray keystroke in "Company name" renames the workspace for everybody with no way back, and a half-considered thought becomes policy.

`settingsDraft.ts` is the shape of it: the whole form is one `SettingsDraft` in local state, and `changedSettings(stored, draft)` returns only the fields that differ. **That diff is also the dirty check** — `Object.keys(patch).length > 0` is what enables Save — so the button and the payload can never disagree about whether there is anything to save. `SettingsForm` is keyed on `settings.updatedAt`, so a successful save (or anyone else's) re-seeds every field from the row rather than leaving stale text on screen.

The lead-time field holds _text_, because `""` and `"4x"` are things a person can type; unparseable text is still counted as a change and sent as `-1` so the schema names what is wrong under the field, instead of Save going quiet and leaving somebody clicking a dead button.

## Roles come from the server, and `/roles` is where they are edited

**No component may name a role but `admin`** (`ADMIN_ROLE`, the system row). The vocabulary is `useRoles()` — query key `['roles']`, the `RolesPayload` the API serves — and `lib/roles.ts` is how it is read: `roleMap` for lookups, `roleInfo` for a pill (falling back to `{label: id, color: 'neut'}` for an account whose role has since been deleted), and `leastPrivileged` for the one default the app still has to pick — the invitation's starting role, which is the row granting the fewest actions rather than the slug `viewer`. The members list, the invite cards, the change-role modal, the employee form's invite dropdown and the sidebar's own footer all read it, so a role a workspace invents appears everywhere on the next refetch.

`features/roles/` is the admin page behind that data (flat `/roles`, `requires: 'roles.manage'`, gated in `routes.tsx` like `/workflow`), and it is the workflow page's twin:

- **The roles card** is one row per role — pill, description, how many people hold it, reorder arrows, edit and delete. The system role has no edit or delete at all; the role _you_ hold has both, disabled, with "ask another admin" in the label. Two different rules, and the API refuses on both.
- **The permissions matrix** is the same dirty-diff pattern applied to a grid: `rolesDraft.ts` keeps every checked box as a `Set<'role:action'>`, the diff against the stored set is the dirty check, and Save PUTs every grant. `PermissionsCard` is keyed on the stored grants, so anybody's save re-seeds the draft. Rows come from `ACTION_GROUPS`, one band per area; the Admin column is ticked and locked throughout, because its set is `ACTIONS` by definition.
- Which _actions_ exist is still compile-time (`ACTIONS`, `ACTION_LABELS`, `ACTION_GROUPS` in `@inventory/shared`); which roles hold them is not. Adding an action is a code change; adding a role is not.

## Statuses come from the server, and `/workflow` is where they are edited

**No component may name a status but `assigned`.** The vocabulary is `useWorkflow()` — query key `['workflow']`, the `WorkflowPayload` the API serves — and `lib/workflow.ts` is how it is read: `statusMap` for lookups, `statusInfo` for a pill (falling back to `{label: id, color: 'neut'}`, which is for _historical_ data only — an asset carrying a status an admin deleted), `allowedTargets` for the Change-status modal's options and `checkinTargets` for the check-in destinations. Filter pills, the dashboard tiles, both asset forms, the import wizard and the detail page's primary action all read it, so removing a transition removes it from the UI on the next refetch rather than leaving a choice the API would refuse. `src/test/api-stub.ts` answers `GET /api/v1/workflow` with the default workflow by default, which is why existing tests still speak of Available and In repair.

`features/workflow/` is the admin page behind that data (flat `/workflow`, `requires: 'workflow.manage'`, gated in `routes.tsx` like `/activity`):

- **The statuses card** puts the two behaviour flags on the rows rather than in the form, because that is where they can be read down a column — which statuses can be handed out, which a return may land in. `StatusFormModal` owns label and colour only; a new status starts inert.
- **The matrix** is the settings form's dirty-diff pattern applied to a graph: `workflowDraft.ts` keeps the whole thing as a `Set<'from→to'>`, the diff against the stored set is the dirty check, and Save PUTs the entire graph. `MatrixCard` is keyed on the stored edges, so anybody's save re-seeds the draft instead of leaving stale boxes on screen.
- **`WorkflowDiagram`** is hand-rolled SVG — at most twenty nodes on an ellipse, quadratic edges bowed so A→B and B→A separate — fed the **draft**, so a box you just unchecked leaves the picture before you decide to save it. Colours are `var(--{sv})`/`var(--{sv}-bg)` only, which is what makes both themes free. `data-node` / `data-edge` / `data-kind` exist for the tests: assert the graph, never the geometry.

## Testing

Vitest + Testing Library (jsdom). `vitest.setup.ts` registers cleanup and a localStorage shim (Node's experimental global shadows jsdom's). Write the failing test first.

- Component tests assert behavior via roles/attributes (`data-variant`, `aria-current`), never CSS class names.
- Route, guard and data-flow tests live in `src/app.test.tsx` and drive the real API client against `src/test/api-stub.ts` (a small `"METHOD /path"` route table over stubbed `fetch`). Prefer it over mocking hooks — it exercises the client, the query cache and the routing together. Feature journeys use the same helper from their own feature folder. A route key may carry a query string to answer one exact request; the bare path is the fallback, and `api.called(...)`/`api.calledAll(...)` report each call's `search` so filter behavior is assertable.
- Theme state outlives a render: reset `localStorage` and the `<html>` dataset in `afterEach` for any test that touches it.

## Adding a primitive

1. Look at `/kitchen-sink` first — the sizes, radii and colours a new primitive needs are almost always already on that page, in a neighbour that solves half the problem.
2. Test first for any behavior; static markup is covered by the kitchen sink.
3. Component + CSS module in `components/ui/`, its props in `components/ui/types/`, export from `index.ts`, **add a kitchen-sink section** — that last step is what keeps the reference honest.
