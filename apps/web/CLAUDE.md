# apps/web — React SPA

React 19 + Vite + TypeScript, react-router (declarative `BrowserRouter`), TanStack Query for server state. No Tailwind, no component libraries: the design is token-based and the primitives are hand-rolled, which keeps every screen built from the same 27 tokens.

## Design system rules

- **`src/styles/tokens.css` is the palette — never invent or tweak a value.** It defines 27 custom properties: 25 per theme (colours, shadows, and `--rp`, the one density swaps) plus the two font stacks. `/kitchen-sink` renders each with its resolved value, so "is there a token for this?" is answered by looking.
- **Theme and density** ride on `<html data-theme data-density>`, applied before first paint by an inline script in `index.html`. `ThemeProvider` owns local state; for a signed-in member `useThemeControls()` persists changes and `useAdoptMemberPrefs()` adopts the stored ones, so preferences follow the person. Density changes `--rp` (table-row padding, 12px ↔ 7px) and nothing else.
- **Semantic colours:** components take an `sv` key (`ok|acc|warn|err|info|neut`) from the shared maps and style via `var(--{sv})` / `var(--{sv}-bg)` — `Pill` shows the pattern. Never a hard-coded status colour.
- **Type:** Instrument Sans and JetBrains Mono (`var(--font-sans)` / `var(--font-mono)`), self-hosted via @fontsource — never a font CDN (the app runs on-prem). Mono is for identifiers: tags, serials, hostnames, kbd hints, timestamps.
- **Icons:** `components/ui/Icon.tsx`, Feather-style paths at stroke 1.7. Add icons there; no icon library.
- **`Dropdown` is the app's only select.** A native `<select>` draws the operating system's menu, which no CSS reaches. `Dropdown` is the ARIA select-only combobox — a button styled as `Input` owning a portalled `role="listbox"` — with the keyboard of a native select (Enter/Space/↑/↓ open, arrows stop at the ends, Home/End, type-ahead, Esc returns focus). Values are `string` unions and the label is what appears on screen, so **tests match options by label**: `choose` in `src/test/dropdown.ts`, and `e2e/helpers/dropdown.ts`; `selectOptions`/`selectOption` drive a native element and do nothing here.
- **Anything that floats over a table is portalled to the body** and positioned from its trigger's rect — `Menu` and `Dropdown`. A `DataTable` cell clips its overflow (that is what gives the ellipsis) and the card clips to its radius, so a popover rendered in place is one the row eats; no z-index fixes it.
- **`DataTable` scrolls sideways rather than clipping.** A row's minimum is the px floor of its column template — a cell's text never widens the table (`contain: inline-size`; long values ellipsise) — so every `fr` column takes a `minmax(<px>, …)` floor or it can be squeezed to nothing. A row-actions column carries `sticky: 'end'` and stays pinned to the right edge while the rest scrolls under it, because that menu is often the row's only door.

## Focus and the keyboard

- **`Menu` is the ARIA menu button**, because row menus hold the only way to change a role or revoke a token. Opening focuses the first item; ↑/↓ move and stop at the ends; Home/End jump; Enter/Space choose; Escape closes and returns focus to the trigger; Tab closes on the way out. Choosing returns focus to the trigger **before** the item runs, so a dialog it opens remembers the trigger.
- **`Modal` takes focus in and gives it back.** It remembers what had focus when it rendered, focuses the card unless a field inside is `autoFocus`, keeps Tab inside (`aria-modal` promises nothing behind is reachable), and returns focus on close — to the trigger, if that is still in the page. It closes on an Escape nobody inside answered: an open `Dropdown` or `Menu` `preventDefault`s its own.
- **⌘K never opens over a dialog** (`AppShell.tsx`): the palette would replace the modal, and a half-filled form is not something a shortcut may throw away.
- **The command palette does what its footer promises** (↑↓, ↵, esc). `CommandPalette.tsx` reads assets and people from `GET /search` (`useSearch`, debounced, four per group) and walks the rows as one flat list; `components/app/palette.ts` is the pure half that groups them: **Pages** are the sidebar's own items through the same permission filter (`navSectionsFor`), matched on label and `keywords`; **Actions** are `ActionDefinition`s, each with `requires` or `adminOnly`.
- **An armed two-step confirm** ("Revoke" → "Revoke for good") takes focus, disarms on Escape or blur, and hands focus somewhere sensible when it goes.

## Structure

- **`types/` folders, one per area** (`components/ui/types/`, `components/app/types/`, `providers/types/`, `lib/types/`, one in every `features/<area>/`). No type is declared at its point of use: a component's props are `AvatarProps` in `components/ui/types/avatar.ts` — one file per component, named in camelCase after it; parameter objects, context values and anything behind an `as` go the same way. `interface` for object shapes, `type` for unions.
  - **The workspace-level `src/types/`** holds what crosses areas: `api.ts` (every wire entity, `ApiRequest`, `OrgMeta`), `openapi.ts` (the public document as `/api-docs` reads it), `app.ts` (provider props), and `theme.ts`, `table.ts`, `filters.ts`, `modals.ts`, `import.ts`.
  - **A file imports its own type module directly** (`./types/avatar`), never the folder's `index.ts`; the barrel is for other areas. That is what keeps `Icon.tsx → types/index.ts → types/button.ts → Icon.tsx` from being a cycle.
  - **A type derived from a value stays with it** (`IconName` is `keyof typeof ICONS`, `WidgetKey` reads `DASHBOARD_WIDGETS`), with a comment saying so.
- `api/` — `client.ts` (fetch wrapper), `queries.ts` (**the query-key catalog** + read hooks), `mutations.ts`, `invalidate.ts`.
- `components/ui/` — primitives, one component + CSS module + `types/` module each, exported from `index.ts`, behaviour-tested in `primitives.test.tsx`. `FormModal.module.css` is a shared stylesheet, not a missing component: the feature modals (and the custom-fields add form) line up through it.
- `components/app/` — the shell: `AppShell`, `Sidebar`, `Topbar`, `PageContainer`, `nav.ts`, `palette.ts`, `ModalHost.tsx`. **The sidebar is two named `<nav>` landmarks** — "Inventory" (`INVENTORY_ITEMS`) on top, "Workspace" (`WORKSPACE_ITEMS`: Members, Activity log, Workflow, Custom fields, Roles, API tokens, Admin) pinned to the bottom — an owner-sanctioned departure from the design's single nav, so managing the workspace sits by the person doing it. Queries name the landmark; absence checks stay page-wide.
- `features/<area>/` — pages and feature modals. `members/CopyLinkModal.tsx` is the one screen for a value shown once (invite links, reset links, a new API token). `admin/` holds **two pages, not one with tabs** (reading what happened vs changing how the workspace behaves): `ActivityLogPage` (`/activity`, `audit.view`) and `AdminPage` (`/admin`, `settings.manage`); `/admin/activity` and `/admin/settings` redirect, `LegacyActivityRedirect` (in `routes.tsx`) keeping the query string.
- `providers/` — Theme, Toast, Modal. **`ModalProvider` owns the seven app-level modals** (palette, new asset, add employee, invite member, import, widgets, change password), rendered by `ModalHost`, because the palette opens five of them from anywhere and several are reachable from more than one screen. A modal with a **subject** (assign, check in, change status, edit) stays local to the page that knows it.
- `lib/` — `format.ts` (dates, durations, currency, file sizes), `avatar.ts`, `roles.ts`, `workflow.ts`, `usePage`, `usePageSize`, `useDebouncedValue`. Reuse; never re-implement formatting inline.
- `routes.tsx` — the whole route map and its guards; `App.tsx` only wires providers.

**Imports:** crossing a directory uses the `@/` alias — never `../../`; same-directory imports stay relative. Order: packages, `@inventory/shared`, `@/`, `./`, styles last. The alias is declared in `tsconfig.json` and `vite.config.ts` (which Vitest reads) — keep them in step, or the typecheck passes and the build fails.

## A query has three states, and a page draws all three

A read is **failing**, **not here yet**, or **done**. `query.data ?? []` once drew a failed fetch as an empty workspace ("Nobody can sign in yet") while the API answered 500. So a page branches in this order (`MembersPage` and `EmployeesPage` are the examples):

```tsx
const failure = members.isError ? members.error : roles.isError ? roles.error : null;

{failure !== null ? (
  <Card padding={false}>
    <ErrorState error={failure} onRetry={retry}>The member list could not be loaded.</ErrorState>
  </Card>
) : !members.isSuccess || !roles.isSuccess ? (
  <Spinner size={18} />
) : (
  …members.data.members…
)}
```

- **`isError` first**, then **`isSuccess`, never `isPending`** — `isPending` leaves TanStack's refetch-error result in the union, so `data` stays `T | undefined` and the `??` grows straight back; `isSuccess` is what makes `data` defined, so the last branch has nothing to coalesce. `data ?? []` there is a bug, and so is `?.` on a read already branched on.
- **A page's failure is the failure of any query it reads** — not "required" versus "secondary", which would be a judgement per page — and Retry refetches all of them. A slug fallback like `roleInfo`'s is for historical data, not for a query that did not answer. If a query's failure would change nothing on screen, the page did not need it. A failed refetch replaces the rows too.
- **A page that edits a five-minute cache reads it again on arrival**: `/roles`, `/workflow` and `/custom-fields` call `useRoles('always')`, `useWorkflow('always')`, `useCustomFields('always')` (the hook's `refetchOnMount`). Every screen fills those caches first, so without a fetch there would be no failure to draw.
- **`ErrorState`** names what failed in the page's words; its second line is never ours — the server's sentence (`ApiError`), the status read off a bodiless response (`HttpError`, plus the "server is unreachable or still starting" hint), or what arrived (`MalformedApiResponse`). An `ApiError` gets no hint: second-guessing a sentence the API deliberately sent is how a guess starts. `AppErrorBoundary` is the other thing: a throw nothing recovers from. It tells `MetaUnanswered` (the router's throw when `/meta` fails — its own class because a refused `fetch` rejects with a bare `TypeError`, as a renderer's bug does) from a screen that could not be drawn.
- **A detail page that does not exist** says so, with nothing to retry.

`client.ts` tells four failures apart and never fabricates a code: the envelope → `ApiError` (422 field messages via `fieldErrors()`); no body → `HttpError` (which extends `ApiError`); nothing answered at all → `ServerUnreachable` (an `HttpError` with status 0, keeping the browser's "Failed to fetch" as its `cause`); a body that is not the envelope → `MalformedApiResponse`.

## Data and auth

- Reads are hooks in `api/queries.ts`; add the key to `queryKeys` first. Writes go through one of two coarse invalidators in `api/invalidate.ts`, by **key prefix**: `invalidateInventory` for assets, employees, assignments and search (plus the dashboard, inbox, activity log and members they touch); `invalidateAdmin` for members, roles, settings, the activity log, `/meta`, API tokens and the session itself. Never hand-pick keys in a mutation: a write rarely touches only the record on screen.
- **Paged lists — nothing here filters an array.** Assets, Employees and Members are searched and paged on the server (the activity log and inbox page the same way). [`docs/recipes/add-page.md`](../../docs/recipes/add-page.md) is the checklist:

  | Piece                                     | Rule                                                                                                                                      |
  | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
  | The key                                   | Carries every parameter (`['assets', params]`), still under the prefix the invalidators use.                                              |
  | `usePage(debounced)`                      | Back to page one when the **settled** search or a filter changes; `clampTo(total, size)` steps back from a page the list no longer fills. |
  | `usePageSize(surface, fallback)`          | Rows per page is the reader's, in `localStorage` under `inv.rowsPerPage.<surface>`; blocked storage or a removed size falls back.         |
  | `useDebouncedValue`                       | One request when the typing stops.                                                                                                        |
  | `placeholderData: (previous) => previous` | The table stays on screen while the next page loads.                                                                                      |
  | `Pagination` + `total`                    | The footer count and `pageCount`. On Assets `total` narrows with the pill; the pills read `statusCounts`, and "All" sums them.            |
  | `?q=` / `?status=` in the URL             | A filtered view is still a link; only the matching moved to the server.                                                                   |

- **A picker picks from a page.** `AssignModal` searches server-side (`PICKER_PAGE`, `assignable: true`). The two employee **dropdowns** ask for `DROPDOWN_LIMIT`, the endpoint's ceiling — a known limit: give the control a search field before raising it.
- **Deleting the workspace invalidates everything** (`invalidateQueries()`), so `/meta` speaks again and the router lands on `/setup` — not `clear()` (drops the mutation's own callbacks) nor `removeQueries()` (leaves observers holding a dead workspace).
- `useMe()` resolves to the member or `null`; a 401 is a signed-out state, not an error. `routes.tsx` picks one of three route sets: uninitialized → setup; signed out → auth screens; signed in → the shell.
- **Gating asks `can(me.permissions, action)`, never a role.** `/auth/me` carries the set `requireAction` reads on the server, so a button and its door cannot disagree. Every gated page takes `permissions: Action[]`. A page is gated in `routes.tsx` (`<Navigate to="/dashboard" replace />`) — a hidden nav item hides the door without locking it.
- **No component may name a role but `admin`, or a status but `assigned`.** Roles come from `useRoles()` through `lib/roles.ts` (`roleInfo`, `offerableRoles`, `leastPrivileged` for the invitation's default); statuses from `useWorkflow()` through `lib/workflow.ts` (`statusInfo`, `allowedTargets`, `checkinTargets`). So a role a workspace invents appears everywhere on the next refetch, and removing a transition removes it from the UI rather than leaving a choice the API would refuse. Their slug fallbacks are for historical data only. `src/test/api-stub.ts` serves the default workflow, which is why tests still say Available.
- **API tokens are the one role gate**: `isAdmin(role)` in `lib/roles.ts` is the only comparison with `ADMIN_ROLE`; `nav.ts` and `palette.ts` declare it as `adminOnly: true` (never beside `requires`), and `routes.tsx` gates `/api-tokens` and `/api-docs` with it. The API's reason: a grantable `tokens.manage` would rebuild the ladder the admin shield closed.
- Auth screens share `features/auth/AuthLayout.tsx` (the 360px column, its own theme toggle) and `AuthField`; server errors render through `FormError`.
- **A field error and a hint are announced, not only painted.** `Field` clones its control with `aria-describedby` (and `aria-invalid` for an error); `Input`, `Textarea` and `Dropdown` forward both.
- **Recovery codes have one screen** (`RecoveryCodesScreen`) for enrolment and for a sign-in that minted a fresh set. `useMfaConfirm`/`useMfaVerify` leave `/auth/me` alone while it is up — refreshing it would swap the screen for the app and take the codes with it. The button that admits you kept them is what moves on: a full reload from enrolment, `useRefreshSession()` from the login page.
- **A column can be an affordance**: the Members page draws its Two-factor column only for `members.manage`.

## Feature notes

- **Settings has a Save button** (the design has none): saving per control lets a stray keystroke rename the workspace. `settingsDraft.ts` keeps one draft; `changedSettings(stored, draft)` is both the payload and the dirty check. The form is keyed on `updatedAt`. Number fields hold text, and unparseable text is sent as `-1` so the schema names the error.
- **`/workflow` and `/roles`** are twins: each keeps a dirty-diff draft (the transition matrix as `Set<'from→to'>`, the permissions matrix as `Set<'role:action'>`), saves it whole, and is keyed on the stored set so anyone's save re-seeds it. `WorkflowDiagram` is hand-rolled SVG fed the **draft**; tests assert `data-node`/`data-edge`, never geometry. On Roles, the system role has no edit or delete at all and its column is ticked and locked; the role you hold has both buttons, disabled (two rules, both refused by the API too).
- **`/custom-fields`** edits the definitions — a page, not the modal it once was on one asset, because it changes every asset; the asset page's custom-values card is read-only and links there.
- **`/api-tokens`** has no pager (a handful of integrations), keeps an expired token's row with an "Expired" pill, revokes in two steps, and ends minting on `CopyLinkModal` — the raw value exists in that one response.
- **`/api-docs` renders the live document** (`GET /api/public/openapi.json` via `publicApiFetch`) in the app's styles; nothing on it is hand-written about a route. No sidebar item, by the owner's call: it is reached from API tokens and the palette, and carries a `BackLink`. `spec.ts` groups by tag, `METHOD_COLORS` is the one method→`sv` map, `scopeOf` reads the scope out of the "Requires the `…` scope." sentence, and `exampleFromSchema.ts` derives examples. Prose is backticks, not markdown: `withCode` (`prose.tsx`) splits on the backtick — reach for a markdown renderer only when the document carries more. `apiDocs.test.tsx` renders every operation in the captured `src/test/openapi.json` — recapture it with `curl` when the public surface changes; `e2e/tests/overview.spec.ts` walks the live one.
- **`/api-tokens` and `/api-docs` begin with the API's four letters**, so both "API namespace" checks use `/api/` with the slash — a bare `/api` once served a reload of these pages the JSON 404 and proxied them to the API in dev (`plugins/static-spa.ts`, `vite.config.ts`), pinned by `apps/api/test/static-spa.test.ts` and `src/devProxy.test.ts`. Name a new `/api`-adjacent page in both tests.
- **The activity log** draws an API pill when `actorKind` is `token`; "Who acted" rides the URL as `?actorKind=` beside `?type=`, and the export carries both.
- **The inbox**: the bell counts unread in its accessible name; `/notifications` pages like the activity log and renders through `renderNotification`. Reading is the "Mark all read" button — a glance is not reading.
- **The import wizard** parses the CSV in the browser (`parseCsv.ts`) and maps it to canonical rows; the API never sees CSV, and the auto-matcher and column list live in `@inventory/shared`. Errors block the import and name their row and column; warnings say what will happen and let it through. "Row 3" counts the header as row 1, as a spreadsheet does.

## Reviewing visual work

Run `npm run dev` and open `http://localhost:5173/kitchen-sink` (dev-only, excluded from production builds). **That page is the design system**: tokens with resolved values, the semantic pairs, the type scale, every icon and every primitive in every state. Walk it in **both themes and both densities** before calling UI work done.

## Indexing and `??`

- **`noUncheckedIndexedAccess`**: remove the doubt rather than assert it (`Dropzone` hands over one `File`; the palette checks `rows[active]`). An assertion names its proof in a comment (`avatar.ts`'s hash modulo the palette length).
- **A `??` is for absence that is the answer** — a nullable column to an empty input, `searchParams.get('q') ?? ''`, the design's `?? '—'`, an optional prop's default — with a comment. Never for a value that should have been there: `orgMeta()` throws naming the missing field rather than renaming the workspace. Best, tighten the type (`AssignModal`'s props discriminate on `mode`).

## Testing

Vitest + Testing Library (jsdom); `vitest.setup.ts` registers cleanup and a localStorage shim. Failing test first.

- Assert behaviour through roles and attributes (`data-variant`, `aria-current`), never CSS class names.
- Route, guard and data-flow tests drive the real client against `src/test/api-stub.ts` (a `"METHOD /path"` table over stubbed `fetch`; a key may carry a query string) — prefer it to mocking hooks. `api.called(...)` reports each call's `search`.
- Reset `localStorage` and the `<html>` dataset in `afterEach` for any test that touches theme state.

## Adding a primitive

1. Look at `/kitchen-sink` first — a neighbour usually solves half the problem.
2. Test first for any behaviour.
3. Component + CSS module in `components/ui/`, props in `components/ui/types/`, export from `index.ts`, and **a kitchen-sink section** — that is what keeps the reference honest.
