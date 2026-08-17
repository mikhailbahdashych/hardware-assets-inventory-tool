# Custom asset statuses and workflow

Approved 2026-08-17. One workspace-wide workflow: admins define the asset
statuses (label, one of the six semantic colors, behavior flags) and the
transition graph between them, Jira-style, with a live diagram. The API
enforces the graph strictly. The seeded default reproduces today's behavior
exactly, so an upgraded instance changes nothing until an admin edits.

## Decisions (user-approved)

- **One workflow for the whole workspace.** No per-category workflows in v1;
  the schema leaves room (a later `workflows` table + FK is an additive
  migration).
- **Permissive default, strict enforcement.** The seed connects every
  non-assigned status to every other (full mesh). The API rejects any direct
  move not on the graph — removing an edge genuinely forbids the move.
- **Matrix editor + live diagram.** Transitions are edited as a from→to
  checkbox grid; a hand-rolled SVG diagram redraws live from the draft.
  No graph/component libraries.
- **Behavior flags, not Jira categories.** Each status carries
  `assignableFrom` ("an asset in this status can be handed out"; today
  `available`, `ordered`) and `checkinTarget` ("the check-in modal offers
  this"; today `available`, `in_repair`, `retired`). `assigned` is a locked
  system status: only assign/check-in enter or leave it, which is what keeps
  `status = 'assigned'` ⇔ open ownership row true.

## Data model

Two tables (drizzle, `apps/api/src/db/schema.ts`; migration via
`drizzle-kit generate`, checked in):

```ts
asset_statuses:
  id            TEXT PK        // the slug; immutable after creation
  label         TEXT NOT NULL UNIQUE   // uniqueness also checked case-insensitively in the service
  color         TEXT NOT NULL  // one of ok|acc|warn|err|info|neut; statuses may share a color
  is_system     INTEGER NOT NULL DEFAULT 0  // true only for 'assigned'
  assignable_from INTEGER NOT NULL DEFAULT 0
  checkin_target  INTEGER NOT NULL DEFAULT 0
  sort_order    INTEGER NOT NULL  // drives pills, tiles, selects, matrix order
  created_at / updated_at TEXT NOT NULL

asset_status_transitions:
  from_status   TEXT NOT NULL REFERENCES asset_statuses ON DELETE CASCADE
  to_status     TEXT NOT NULL REFERENCES asset_statuses ON DELETE CASCADE
  PRIMARY KEY (from_status, to_status)
```

`assets.status` stays plain TEXT with no FK/CHECK — the app-level philosophy
is unchanged; validation lives in the services against the table.

**Boot seed** (in `apps/api/src/db/seed.ts`, same idempotent pattern as
custom-field defs, guarded by `asset_statuses` being empty): the six current
statuses with today's labels/colors, `assigned` as system, flags per the
Decisions section, `sort_order` in today's enum order — plus the full mesh
among the five non-assigned statuses (5×4 = 20 edges). The canonical default
list lives in `packages/shared` as `DEFAULT_ASSET_STATUSES` (slug, label,
color, flags), which is also what the audit renderer's legacy fallback map
derives from.

**Caps:** at most 20 statuses (the matrix and the dashboard must stay
readable); transitions payload capped in zod at 400 edges.

## Invariants (guarded in the workflow service, tested like last-admin)

1. `assigned` cannot be deleted, cannot appear in the transitions table, and
   its flags cannot be set. Its label and color may be edited.
2. No operation may leave the workspace with zero `assignable_from` statuses
   or zero `checkin_target` statuses (409 — assign/check-in would become
   impossible).
3. Deleting a status that assets currently carry requires `migrateTo`
   (an existing non-assigned status ≠ the one being deleted). One
   transaction: `UPDATE assets SET status = migrateTo WHERE status = X`,
   delete the row (edges cascade), one summary audit event carrying the
   asset count — not one event per asset.
4. Slug generation: label → lowercase, non-alphanumeric runs → `_`, trimmed.
   Empty result or collision with an existing slug → 422 on `label`.
5. Self-edges and edges touching `assigned` are rejected on PUT.

## API (`/api/v1/workflow`, new module `apps/api/src/modules/workflow.ts`)

New RBAC action in `packages/shared/src/rbac.ts`: `workflow.manage: 'admin'`.

- `GET /workflow` — any authenticated role. `{ statuses: WorkflowStatus[],
  transitions: {from, to}[] }`, statuses ordered by `sort_order`.
- `POST /workflow/statuses` — admin. `{label, color, assignableFrom,
  checkinTarget}` → 201 with the created status; `sort_order` = max + 1.
- `PATCH /workflow/statuses/:id` — admin. Any of label/color/flags; flags on
  `assigned` rejected.
- `DELETE /workflow/statuses/:id?migrateTo=` — admin. 409 `status_in_use`
  (message carries the count) when in use and no `migrateTo` given.
- `PUT /workflow/transitions` — admin. `{transitions: [{from, to}]}` replaces
  the whole graph (what the matrix's Save naturally sends). Validates every
  endpoint exists; dedupes.
- `PUT /workflow/statuses/order` — admin. `{ids: [...]}`, must be a
  permutation of the current set.

Zod contracts in `packages/shared/src/schemas/workflow.ts`; shared
`WorkflowStatus` interface in `packages/shared/src/types/workflow.ts`.

## Enforcement changes

- `packages/shared/src/enums.ts`: `canDirectlyTransition` and
  `CHECKIN_NEW_STATUSES`/labels are **deleted**. `ASSET_STATUSES` and its two
  maps are replaced by `DEFAULT_ASSET_STATUSES` (seed + legacy audit
  fallback). The `AssetStatus` type dissolves — status is `string` in wire
  shapes. A shared `ASSIGNED_STATUS = 'assigned'` constant is the one slug
  both apps may reference by name (plus `in_repair` in outcome derivation,
  see below).
- `packages/shared/src/schemas/assets.ts` / `assignments.ts`:
  `z.enum(...)` for status/newStatus becomes `z.string().min(1)`; existence
  and legality are service-side checks against the table. The
  "assigned requires assignedToEmployeeId" refine stays (slug constant).
- `apps/api/src/services/assets.ts`: create validates the status exists
  (422 on `status`); update replaces `canDirectlyTransition` with a DB
  check — moves touching `assigned` keep 409 `status_locked`; a missing edge
  is 409 `transition_not_allowed` with "The workflow does not allow
  {fromLabel} → {toLabel}." **Creating an asset is not a transition** — any
  existing status is a legal starting point (today's behavior; keeps CSV
  import insert-only).
- `apps/api/src/services/assignments.ts`: `ASSIGNABLE_FROM` becomes a query
  on `assignable_from = 1`; the 409 message lists the actual assignable
  labels. Check-in validates `newStatus` is an existing `checkin_target`
  (422). Outcome derivation keeps its one special case pinned to the
  `in_repair` slug; custom destinations derive `returned`.
- `apps/api/src/services/dashboard.ts`: `statusCounts` becomes an ordered
  array `{id, label, color, count}[]` built from the table (zero-filled), so
  the web renders tiles without any enum.
- Import: `matchEnumValue` in `packages/shared/src/schemas/import.ts`
  generalizes to accept a runtime `{value, label}[]` vocabulary; the
  validator receives the status list (API passes it from the DB, the wizard
  from the workflow query). Template examples read the live list.

## Audit

New actions (type `system`), rendered in `audit-render.ts`:
`workflow.status_created` {label}, `workflow.status_updated` {label,
changedFields}, `workflow.status_deleted` {label, migratedToLabel?,
assetCount}, `workflow.transitions_updated` {added, removed},
`workflow.statuses_reordered` {}.

`asset.status_changed` (and check-in's params) now snapshot **labels** at
write time — same philosophy as `holder_name_snapshot`; a renamed or deleted
status never rewrites history. The renderer's `status()` helper stays purely
as a fallback that maps pre-change slugs through the default labels and
renders anything else as itself.

## Web

- New query key `['workflow']` + `useWorkflow()`; `lib/workflow.ts` with
  `statusMap(statuses)` and a lookup that falls back to
  `{label: slug, color: 'neut'}` (render-something rule, historical data
  only).
- Switch to data-driven: AssetsPage filter pills (sort order, counts as
  today), `filters.ts` (status becomes `string`), AssetFormModal's status
  Dropdown (assigned stays in it, still toggling the holder fields),
  ChangeStatusModal (options = edges from the current status; a "The
  workflow allows no moves from {label}" empty state), CheckInModal
  (destinations from `checkinTarget` — the "Return to stock" special copy is
  retired, labels speak for themselves), AssetDetailPage (assign affordance
  from `assignableFrom`), DashboardPage (tiles from the payload array; grid
  `repeat(6, 1fr)` → `repeat(auto-fill, minmax(148px, 1fr))` so a seventh
  tile wraps), import wizard, KitchenSink (semantic-color pill row instead of
  the status enum).
- **New page `/workflow`** (flat route like `/activity`, sidebar item
  "Workflow" in the admin section, `requires: 'workflow.manage'`, a new icon
  in the Feather style):
  - **Statuses card** — one row per status: pill preview, label, color (the
    six sv options with swatches), the two flag toggles, up/down reorder,
    delete. Add/edit via a small dual-mode StatusFormModal.
    Delete-in-use opens a modal showing the count and a migrate-to Dropdown.
  - **Workflow card** — the from→to checkbox matrix (assigned excluded,
    diagonal disabled) as a draft with the settings-form dirty-diff pattern
    and a Save button (PUT whole graph).
  - **WorkflowDiagram** — hand-rolled SVG beside the matrix, redrawing live
    from the draft: nodes on a circle in sort order (rounded rects using
    `var(--{sv})` / `var(--{sv}-bg)`), curved directed edges with arrowheads
    (A→B and B→A offset so they don't overlap), `assigned` drawn in the same
    circle with dashed edges — from each `assignableFrom` status into it, out
    of it to each `checkinTarget` — plus a legend: solid = Change status,
    dashed = Assign / Check in. Tokens only; both themes.

## Demo seed

The demo workspace gets a curated graph plus one custom status —
`in_imaging` "In imaging" (`info`, check-in target) — applied through the
real workflow service so the audit log shows the change. Curated edges
(illustrative, exact list in the plan): ordered→in_imaging/available,
in_imaging→available, available→in_repair/retired/lost_stolen,
in_repair→available/retired, lost_stolen→available/retired, retired→(none).

## Testing

TDD throughout. Shared: schema accept/reject tables, slug generation,
renderer goldens for the new actions. API: every invariant above, the
enforcement paths (assign from a non-assignable status, check-in to a
non-target, a move with no edge, the mesh seed keeping every pre-existing
test's moves legal), endpoint role guards, delete-with-migrate in one
transaction. Web: matrix dirty-diff, modal option filtering, diagram smoke
test (node/edge counts, not pixel positions), workflow page role gating.
E2e: admin adds "On loan", removes Available→Retired, saves; the
Change-status modal obeys both; the new pill and dashboard tile appear.

## Docs

- `docs/recipes/add-asset-status.md` → renamed `add-enum-value.md`, reworked
  around categories (still code-only), with a pointer that statuses moved to
  the Workflow page. README reference updated.
- README: feature bullet + Workflow-page screenshot (captured during final
  browser verification).
- CLAUDE.md updates: root (the enum convention now excepts statuses), shared
  (enums.ts section), api (workflow module + invariants), web (workflow page
  + query).

## Out of scope (YAGNI)

Per-category workflows, transition conditions/validators, status
descriptions, drag-and-drop graph editing, initial-status designation,
colors beyond the six tokens.
