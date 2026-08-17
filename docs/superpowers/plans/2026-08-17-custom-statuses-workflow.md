# Custom Statuses & Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Asset statuses and their transition graph become admin-editable data (Jira-style workflow) with a matrix editor and a live hand-rolled SVG diagram, while the seeded default reproduces today's behavior exactly.

**Architecture:** Two new tables (`asset_statuses`, `asset_status_transitions`) seeded idempotently at boot with today's six statuses and a full transition mesh. A workflow service owns every invariant; the assets/assignments services switch their status rules from the shared enum to DB checks. The web gains a `['workflow']` query every status consumer reads, plus a `/workflow` admin page. The old enum exports stay in `packages/shared` until the web has migrated (Phase B), so every commit stays green across workspaces.

**Tech Stack:** Existing only — Drizzle/better-sqlite3, Fastify 5 + zod 4, React 19 + TanStack Query, hand-rolled primitives. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-17-custom-statuses-workflow-design.md` — read it first; it carries the approved decisions and invariants this plan implements.

## Global Constraints

- **Read the CLAUDE.md nearest to every file you touch** (root, `packages/shared`, `apps/api`, `apps/web`, `e2e`). They are binding: types in `types/` folders (never at point of use), `??` only as a documented rule, `noUncheckedIndexedAccess` answered by guards not assertions, audit events in the same transaction, `@/` alias imports across directories.
- **TDD**: every behavior lands as failing test → implement → pass → commit. Run the workspace's tests (`npm test -w apps/api` etc.) before every commit.
- **Every commit green**: `npm run typecheck` and `npm run lint` must pass across ALL workspaces at every commit. That is why Phase A only *adds* to `packages/shared` and Phase B ends by deleting the dead exports.
- Semantic colors are the six `sv` keys only; UI copy in sentence case; slugs are `snake_case`.
- Commit messages follow the repo's `feat(api):`/`feat(web):`/`docs:` style, ending with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Never merge, never push to `main`. Work stays on `feat/custom-statuses-workflow`.
- Caps: 20 statuses max, 400 transitions max in the PUT payload.

---

## Phase A — shared vocabulary + API (Agent 1)

### Task 1: Shared workflow vocabulary (additive only)

**Files:**
- Create: `packages/shared/src/types/workflow.ts`
- Modify: `packages/shared/src/enums.ts` (add; delete NOTHING yet)
- Modify: `packages/shared/src/index.ts` (re-export)
- Test: `packages/shared/src/enums.test.ts` (extend)

**Interfaces (Produces):**

```ts
// types/workflow.ts — interface for object shapes, per convention
export interface WorkflowStatus {
  id: string;            // the slug, immutable
  label: string;
  color: SemanticColor;
  isSystem: boolean;     // true only for 'assigned'
  assignableFrom: boolean;
  checkinTarget: boolean;
  sortOrder: number;
}
export interface WorkflowTransition {
  from: string;
  to: string;
}
export interface WorkflowPayload {
  statuses: WorkflowStatus[];
  transitions: WorkflowTransition[];
}
```

```ts
// enums.ts — the one slug the code may reference by name, and the seed list
export const ASSIGNED_STATUS = 'assigned';
export const MAX_ASSET_STATUSES = 20;

/** Boot-seed definition AND the legacy label fallback for old audit events.
 *  Array order is the seeded sort order. */
export const DEFAULT_ASSET_STATUSES = [
  { id: 'available',  label: 'Available',   color: 'ok',   isSystem: false, assignableFrom: true,  checkinTarget: true  },
  { id: 'assigned',   label: 'Assigned',    color: 'acc',  isSystem: true,  assignableFrom: false, checkinTarget: false },
  { id: 'in_repair',  label: 'In repair',   color: 'warn', isSystem: false, assignableFrom: false, checkinTarget: true  },
  { id: 'ordered',    label: 'Ordered',     color: 'info', isSystem: false, assignableFrom: true,  checkinTarget: false },
  { id: 'retired',    label: 'Retired',     color: 'neut', isSystem: false, assignableFrom: false, checkinTarget: false },
  { id: 'lost_stolen',label: 'Lost/Stolen', color: 'err',  isSystem: false, assignableFrom: false, checkinTarget: false },
] as const satisfies readonly (Omit<WorkflowStatus, 'sortOrder'>)[];
```

- [ ] Failing test in `enums.test.ts`: `DEFAULT_ASSET_STATUSES` ids/labels/colors equal today's `ASSET_STATUSES`/`ASSET_STATUS_LABELS`/`ASSET_STATUS_COLORS` entry-for-entry; exactly one `isSystem` entry and it is `'assigned'`; assignable set is `{available, ordered}`; check-in set is `{available, in_repair, retired}`.
- [ ] Implement; run `npm test -w packages/shared`; `npm run typecheck`.
- [ ] Commit: `feat(shared): workflow vocabulary — default statuses, flags, types`

### Task 2: zod contracts + slugify + RBAC action

**Files:**
- Create: `packages/shared/src/schemas/workflow.ts`
- Create: `packages/shared/src/schemas/workflow.test.ts`
- Modify: `packages/shared/src/rbac.ts` (`'workflow.manage': 'admin'`), `packages/shared/src/index.ts`
- Test: rbac matrix test file (find it beside `rbac.ts`) gains the new action.

**Interfaces (Produces):**

```ts
export const statusCreateSchema = z.object({
  label: z.string().trim().min(1, 'Give the status a name.').max(40),
  color: z.enum(SEMANTIC_COLORS),
  assignableFrom: z.boolean().default(false),
  checkinTarget: z.boolean().default(false),
});
export const statusPatchSchema = z.object({
  label: z.string().trim().min(1).max(40),
  color: z.enum(SEMANTIC_COLORS),
  assignableFrom: z.boolean(),
  checkinTarget: z.boolean(),
}).partial();
export const transitionsPutSchema = z.object({
  transitions: z.array(z.object({ from: z.string().min(1), to: z.string().min(1) })).max(400),
});
export const statusOrderSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(MAX_ASSET_STATUSES),
});
export type StatusCreateInput = z.infer<typeof statusCreateSchema>;   // beside schema, per convention
export type StatusPatchInput = z.infer<typeof statusPatchSchema>;
export type TransitionsPutInput = z.infer<typeof transitionsPutSchema>;

/** 'On loan!' → 'on_loan'; returns '' when nothing survives. */
export function statusSlug(label: string): string
```

- [ ] Failing tests: accept/reject table per schema (label too long, bad color, 401-edge counts) and `statusSlug` cases: `'On loan' → 'on_loan'`, `'Wiped & Ready' → 'wiped_ready'`, `'—' → ''`, `'In-Repair' → 'in_repair'`.
- [ ] Implement (slug: lowercase, `[^a-z0-9]+` runs → `_`, trim `_`); tests pass; commit `feat(shared): workflow schemas, statusSlug, workflow.manage action`.

### Task 3: Tables, migration, boot seed

**Files:**
- Modify: `apps/api/src/db/schema.ts` (two tables per the spec's DDL), `apps/api/src/db/seed.ts`
- Generate: migration via `npm run -w apps/api db:generate` (check `apps/api/package.json` for the exact script; drizzle-kit generate) — commit the SQL.
- Test: `apps/api/test/workflow-seed.test.ts`

**Interfaces (Produces):** `assetStatuses`, `assetStatusTransitions` drizzle tables; seed populates them when `asset_statuses` is empty: the six `DEFAULT_ASSET_STATUSES` rows (`sortOrder` = array index) plus the full mesh among the five non-assigned statuses (20 edges).

- [ ] Failing test: `buildTestApp()` (which migrates + seeds) yields 6 status rows ordered as the default list, exactly 20 transition rows, none touching `assigned`; running seed twice changes nothing.
- [ ] Implement; `npm test -w apps/api`; commit `feat(api): asset_statuses + transitions tables, seeded to today's behavior`.

### Task 4: Workflow service — every invariant

**Files:**
- Create: `apps/api/src/services/workflow.ts`, `apps/api/src/types/workflow.ts` (api-side named shapes)
- Test: `apps/api/test/workflow.test.ts` (service half)

**Interfaces (Produces):**

```ts
export function getWorkflow(db: DbOrTx): WorkflowPayload
export function createStatus(deps: AppDeps, actor: Actor, input: StatusCreateInput): WorkflowStatus
export function updateStatus(deps: AppDeps, actor: Actor, id: string, patch: StatusPatchInput): WorkflowStatus
export function deleteStatus(deps: AppDeps, actor: Actor, id: string, migrateTo?: string): void
export function replaceTransitions(deps: AppDeps, actor: Actor, input: TransitionsPutInput): WorkflowTransition[]
export function reorderStatuses(deps: AppDeps, actor: Actor, ids: string[]): WorkflowStatus[]
// For the other services (Task 6/7):
export function requireStatus(tx: DbOrTx, id: string, field?: string): AssetStatusRow  // 422 invalidFields when missing
export function transitionAllowed(tx: DbOrTx, from: string, to: string): boolean
export function assignableStatuses(tx: DbOrTx): AssetStatusRow[]
```

Guards (each is a test): create beyond `MAX_ASSET_STATUSES` → 409 `too_many_statuses`; duplicate label case-insensitive or slug collision → 422 on `label`; `assigned` delete → 409 `system_status`; `assigned` flag patch → 422; deleting/patching away the last `assignableFrom` → 409 `workflow_needs_assignable`; last `checkinTarget` → 409 `workflow_needs_checkin_target`; delete in use without `migrateTo` → 409 `status_in_use` (message carries count); with `migrateTo` → assets updated + row gone + edges cascaded in ONE transaction, one `workflow.status_deleted` audit event with `{label, migratedToLabel, assetCount}`; `migrateTo` = `assigned`/missing/self → 422; transitions PUT with unknown endpoint, self-edge, or `assigned` edge → 422; dedupe silently; reorder ids not a permutation → 422. Every mutation writes its audit event in the same transaction (actions per spec, type `system`).

- [ ] Write the failing service tests (mirror the style of `apps/api/test/last-admin.test.ts` — direct service calls where HTTP can't reach the guard).
- [ ] Implement; tests pass; commit `feat(api): workflow service with status/transition invariants`.

### Task 5: Workflow module + audit renderers

**Files:**
- Create: `apps/api/src/modules/workflow.ts`; register in `apps/api/src/app.ts`
- Modify: `packages/shared/src/audit-render.ts` (+ its test)
- Test: `apps/api/test/workflow.test.ts` (endpoint half)

Routes (mirror `apps/api/src/modules/custom-fields.ts` for guard style): `GET /api/v1/workflow` behind `requireAuth` (any role); `POST /workflow/statuses`, `PATCH /workflow/statuses/:id`, `DELETE /workflow/statuses/:id` (accepts `?migrateTo=`), `PUT /workflow/transitions`, `PUT /workflow/statuses/order` behind `requireAction('workflow.manage')`.

- [ ] Failing endpoint tests: viewer GETs the workflow (200); manager POST → 403; admin full CRUD round-trip; DELETE in-use returns 409 then succeeds with `migrateTo` and the asset rows moved; audit renderer goldens — every `workflow.*` action renders a sentence (assert exact copy you write in the renderer, e.g. `created asset status "On loan"`).
- [ ] Implement; commit `feat(api): /api/v1/workflow endpoints + audit sentences`.

### Task 6: Enforcement — assets service

**Files:**
- Modify: `apps/api/src/services/assets.ts` (createAsset status existence; updateAsset transition check), `packages/shared/src/schemas/assets.ts` (`status: z.enum(ASSET_STATUSES)` → `z.string().min(1)` in create AND patch; keep the assigned/holder refine via `ASSIGNED_STATUS`)
- Test: extend the existing assets service/endpoint test file (find `assets` under `apps/api/test/`)

Behavior: create with a status not in the table → 422 on `status`. Update: moves touching `assigned` keep 409 `status_locked` (existing message); missing edge → 409 `transition_not_allowed`, message `The workflow does not allow {fromLabel} → {toLabel}.`; edge present → succeeds. The seeded mesh must keep every pre-existing test green.

- [ ] Failing tests: unknown status create 422; delete the `available→retired` edge directly in the DB, then PATCH → 409 `transition_not_allowed`; with the edge intact → 200.
- [ ] Implement using `requireStatus`/`transitionAllowed`; full api suite green; commit `feat(api): the workflow graph now gates direct status moves`.

### Task 7: Enforcement — assignments service + label snapshots

**Files:**
- Modify: `apps/api/src/services/assignments.ts` (drop `ASSIGNABLE_FROM`; check-in target validation; snapshot labels into audit params), `apps/api/src/services/assets.ts` (status_changed params carry labels), `packages/shared/src/schemas/assignments.ts` (`newStatus: z.string().min(1)`; outcome derivation keeps `in_repair` special case), `packages/shared/src/audit-render.ts` (`status()` helper documented as legacy fallback: `DEFAULT_ASSET_STATUSES` label lookup, else render as-is)
- Test: extend existing assignments tests + audit renderer test

Behavior: assign allowed iff current status row has `assignable_from` — 409 message lists the actual assignable labels, e.g. `Only an asset that is Available or Ordered can be handed out.`; check-in `newStatus` must be an existing `checkin_target` → else 422 on `newStatus`. All new `asset.status_changed`/check-in audit params store **labels** (`{from: 'Available', to: 'In repair'}`); old events with slugs still render via the fallback.

- [ ] Failing tests: assign from `in_repair` → 409 with the dynamic message; check-in to `ordered` (not a target) → 422; flip `in_repair.checkin_target` off in DB → check-in to it 422; a status_changed event's stored params carry labels; a legacy event with slug params still renders `Available`.
- [ ] Implement; commit `feat(api): assignable/check-in flags enforced; audit snapshots labels`.

### Task 8: Dashboard + import go data-driven

**Files:**
- Modify: `apps/api/src/services/dashboard.ts`, `apps/api/src/types/dashboard.ts` (`statusCounts: StatusCount[]` where `interface StatusCount {id; label; color: SemanticColor; count}`), `packages/shared/src/schemas/import.ts` (`matchEnumValue` generalized to a `readonly {value, label}[]` vocabulary — keep the old signature working via an overload or migrate its callers in this task), `apps/api/src/services/import-validator.ts` (validator receives `statuses: WorkflowStatus[]` from the route; status cell matched against label/slug case-insensitively), the import/template routes (pass the DB list; template example rows read it)
- Test: dashboard test (ordered array, zero-filled, custom status appears), import validator tests (unknown status errors with row/column; `In repair` and `in_repair` both match; a custom status's label matches)

- [ ] Failing tests first; implement; full `npm test -w apps/api` + `npm test -w packages/shared`; commit `feat(api): dashboard tiles and CSV vocabulary from the statuses table`.

**Phase A exit:** `npm run typecheck && npm run lint && npm test` all green (web untouched, still compiling against the intact legacy exports). The live web app is expected to mis-render the dashboard (payload shape changed) until Phase B — that is fine mid-branch; note it in the handoff.

---

## Phase B — web (Agent 2)

### Task 9: Workflow query + lib + api-stub

**Files:**
- Modify: `apps/web/src/api/queries.ts` (key `workflow: ['workflow']`, `useWorkflow()` returning `WorkflowPayload`), `apps/web/src/types/api.ts` (asset `status: string`; dashboard `statusCounts: StatusCount[]` — mirror the api shape), `apps/web/src/test/api-stub.ts` (default `GET /api/v1/workflow` route serving `DEFAULT_ASSET_STATUSES` + full mesh so every existing test keeps its vocabulary)
- Create: `apps/web/src/lib/workflow.ts` + `apps/web/src/lib/types/workflow.ts`

```ts
export function statusMap(statuses: WorkflowStatus[]): Map<string, WorkflowStatus>
/** Historical-only fallback: a slug no live asset carries. */
export function statusInfo(map: Map<string, WorkflowStatus>, id: string): { label: string; color: SemanticColor }
export function allowedTargets(payload: WorkflowPayload, from: string): WorkflowStatus[]  // sorted by sortOrder
export function checkinTargets(statuses: WorkflowStatus[]): WorkflowStatus[]
```

- [ ] Failing tests for the four helpers (including the `{label: id, color: 'neut'}` fallback); implement; commit `feat(web): workflow query and lookup helpers`.

### Task 10: Every status consumer reads the query

**Files (Modify):** `features/assets/filters.ts` (+test — status becomes `string`), `AssetsPage.tsx` (pills from `useWorkflow`, sort order), `AssetFormModal.tsx` (status Dropdown from the query; `ASSIGNED_STATUS` still toggles the holder fields), `ChangeStatusModal.tsx` (options = `allowedTargets`; empty state text `The workflow allows no moves from {label}.`; toast uses the target's label), `CheckInModal` (destinations from `checkinTargets` — the "Return to stock" copy retires), `AssetDetailPage.tsx` (assign button shown iff current status `assignableFrom`; pills via `statusInfo`), `DashboardPage.tsx` + `Dashboard.module.css` (tiles map the array; grid `repeat(auto-fill, minmax(148px, 1fr))`), `components/app/palette.ts`/`CommandPalette` if they label statuses, `features/dev/KitchenSink.tsx` (pill row shows the six semantic colors, not the status enum), employee holdings/import wizard status touchpoints (`grep -rn "ASSET_STATUS" apps/web/src` and migrate every hit).

- [ ] Update each consumer test-first (the existing test files already cover these components — change the assertions with intent). The import wizard passes `useWorkflow` statuses into the shared validator.
- [ ] `npm test -w apps/web`; commit `feat(web): status pills, forms and dashboard read the workflow`.

### Task 11: /workflow page — statuses card

**Files:**
- Create: `apps/web/src/features/workflow/WorkflowPage.tsx`, `StatusFormModal.tsx` (dual-mode create/edit, mirror `AssetFormModal`'s mode pattern), `DeleteStatusModal.tsx` (in-use count + migrate-to Dropdown), `Workflow.module.css`, `features/workflow/types/*`, tests `features/workflow/workflow.test.tsx`
- Modify: `apps/web/src/api/mutations.ts` (`useCreateStatus`, `useUpdateStatus`, `useDeleteStatus`, `useReorderStatuses` — invalidate `['workflow']` + `invalidateInventory`), `routes.tsx` (flat `/workflow`, admin-gated like `/activity`), `components/app/nav.ts` (+test: item "Workflow", `requires: 'workflow.manage'`, between Activity log and Admin), `components/ui/Icon.tsx` (one new Feather-style path, stroke 1.7 — a small three-node branch glyph)

Rows: pill preview (label in its color), the two flag toggles (`ToggleSwitch`), color Dropdown (six options, each label prefixed by a swatch), up/down `IconButton`s driving `useReorderStatuses` with the full id list, delete. The `assigned` row: flags disabled with a hint, no delete.

- [ ] Test-first: page renders statuses in order; viewer/manager never see the route (mirror how `/admin` gating is tested in `app.test.tsx`); create modal posts and the new row appears; delete-in-use shows the count and sends `migrateTo`.
- [ ] Commit `feat(web): the Workflow page — statuses card`.

### Task 12: Transition matrix + draft

**Files:**
- Create: `apps/web/src/features/workflow/workflowDraft.ts` + `workflowDraft.test.ts`, matrix section in `WorkflowPage.tsx`
- Modify: `apps/web/src/api/mutations.ts` (`useSaveTransitions` → PUT whole graph)

```ts
export function draftKey(from: string, to: string): string            // `${from}→${to}`
export function draftFromTransitions(transitions: WorkflowTransition[]): Set<string>
export function transitionsFromDraft(draft: Set<string>): WorkflowTransition[]
export function draftChanged(stored: Set<string>, draft: Set<string>): boolean
```

Matrix: rows/columns = non-assigned statuses in sort order, checkbox per cell, diagonal disabled; Save enabled by `draftChanged` (the settings-form pattern: the diff is the dirty check); saving PUTs and re-seeds the draft from the fresh query.

- [ ] Test-first: draft round-trips; unchecking marks dirty; Save sends exactly the checked set; re-render after save is clean.
- [ ] Commit `feat(web): transition matrix with draft/diff save`.

### Task 13: WorkflowDiagram (SVG)

**Files:**
- Create: `apps/web/src/features/workflow/WorkflowDiagram.tsx`, `features/workflow/types/workflowDiagram.ts`, test `WorkflowDiagram.test.tsx`
- Modify: `WorkflowPage.tsx` (diagram beside the matrix, fed the DRAFT so it redraws live), `KitchenSink.tsx` (a section rendering the diagram with the default workflow)

Props `{ statuses: WorkflowStatus[]; transitions: WorkflowTransition[] }`. Nodes on a circle in sort order (rounded rects ~112×30, fill `var(--{sv}-bg)`, stroke+text `var(--{sv})`); direct edges as quadratic curves with a perpendicular control-point offset so A→B and B→A separate, `marker-end` arrowhead; `assigned` sits in the circle with dashed edges (in from every `assignableFrom`, out to every `checkinTarget`); legend beneath: solid = Change status, dashed = Assign / Check in. Stamp `data-node={id}` and `data-edge={from}→{to}` + `data-kind="direct|assign|checkin"` for tests. Tokens only — both themes come free.

- [ ] Test-first (smoke, not pixels): default workflow renders 6 nodes, 20 direct edges, 2 dashed assign edges, 3 dashed check-in edges; removing a transition from props removes its `data-edge`.
- [ ] Commit `feat(web): live workflow diagram`.

### Task 14: Delete the dead shared exports

**Files:**
- Modify: `packages/shared/src/enums.ts` (delete `ASSET_STATUSES`, `AssetStatus`, `ASSET_STATUS_LABELS`, `ASSET_STATUS_COLORS`, `canDirectlyTransition`, `CHECKIN_NEW_STATUSES`, `CHECKIN_NEW_STATUS_LABELS`; update the header comment — statuses are data now), `enums.test.ts`, `index.ts`, and every straggling importer (`grep -rn "ASSET_STATUSES\|canDirectlyTransition\|CHECKIN_NEW_STATUS\|AssetStatus" apps packages` must end empty outside `DEFAULT_ASSET_STATUSES` usages).
- [ ] Run the FULL gate: `npm run typecheck && npm run lint && npm test` — all workspaces. Commit `refactor(shared): the status enum is gone; the table is the truth`.

**Phase B exit:** full unit gate green; `npm run build` succeeds.

---

## Phase C — e2e, demo, docs (Agent 3)

### Task 15: E2e journey

**Files:** Create `e2e/tests/workflow.spec.ts` (read `e2e/CLAUDE.md` + neighbouring specs for server/seed/login helpers; Dropdowns via `e2e/helpers/dropdown.ts`).

Journey (one spec, admin session): open `/workflow` → add status `On loan` (color Info) → row appears → uncheck `Available→Retired` in the matrix → Save → diagram loses the edge (`data-edge` gone) → open an Available asset → Change status offers On loan, does NOT offer Retired → move it to On loan → toast → `/assets?status=on_loan` shows it → dashboard shows an On loan tile. Then `npm run e2e` — whole suite, not just the new spec.

- [ ] Commit `test(e2e): the workflow round trip`.

### Task 16: Demo seed shows the feature

**Files:** Modify `apps/api/src/db/demo.ts` / `demo-data.ts` (+ their tests).

As the LAST demo step (history must replay under the seeded mesh first), through the real workflow service as the demo admin actor: create `In imaging` (`info`, `checkinTarget: true`), then replace the graph with exactly: `ordered→in_imaging, ordered→available, in_imaging→available, available→in_repair, available→retired, available→lost_stolen, in_repair→available, in_repair→retired, lost_stolen→available, lost_stolen→retired`. Retired keeps no outgoing edges. Update the demo test counts (statuses 7, the audit log gains the workflow events).

- [ ] Commit `feat(api): the demo workspace ships a curated workflow`.

### Task 17: Docs

**Files:** `git mv docs/recipes/add-asset-status.md docs/recipes/add-enum-value.md` and rework around the category example, opening with "Asset statuses moved to Admin → Workflow — this recipe is for the enums that stayed in code". Update every reference (`grep -rn "add-asset-status" .` → README + root CLAUDE.md). README: feature bullet under "What it does" ("**Custom statuses & workflow** — …"), and drop the "category-management UI"-adjacent claim that statuses are code-only if present (the screenshot for this section lands in Task 18). CLAUDE.md updates: root (enum convention now excepts statuses), `packages/shared` (enums section), `apps/api` (workflow module + invariants paragraph), `apps/web` (workflow page/query paragraph). Do NOT touch `docs/PROJECT_STATUS.md` (the operator does that).

- [ ] Commit `docs: statuses are workflow data now`.

### Task 18: Workflow screenshots into the README

Only after Tasks 15–17 are green — a screenshot of a broken feature is worse than none.

**Files:** Create `media/workflow.png` (and optionally `media/workflow-change-status.png`); Modify `README.md`.

Match the existing media set exactly: 1440×900 viewport, light theme, the demo workspace. `npm run seed:demo -- --reset`, run the app, sign in as the demo admin (the seed prints the logins), open `/workflow` — the curated demo graph from Task 16 is what makes this page worth photographing (seven statuses including "In imaging", a real graph in the diagram, not the full mesh). Capture with the Playwright MCP browser tools (or Chrome DevTools MCP). Keep files in the existing size range (~120–150 KB PNG); re-shoot rather than ship a blurry or half-loaded frame, and check the image yourself before committing — read it back and look at it.

README: place the image beside the workflow feature bullet from Task 17, in the established voice — meaningful alt text in the brackets, an italic one-line caption under it that says something true and specific (what the reader is looking at and why it matters), not marketing. A second screenshot (the Change-status modal offering only what the graph allows) is welcome if it earns its caption; skip it if it reads as filler.

- [ ] Commit `docs: show the workflow page`.

---

## Final verification (operator, not agents)

Full gate (`npm test`, `npm run e2e`, lint, typecheck, build), a live browser walk of `/workflow` in both themes via Chrome DevTools MCP (add/edit/delete-with-migrate, matrix save, diagram redraw, change-status obeying the graph), a review of the Task 18 screenshots, PROJECT_STATUS update, PR #25.
