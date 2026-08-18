# Granular Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Roles become admin-editable workspace data — a `roles` table with a
per-role grant set over the existing action vocabulary, a locked system Admin,
and a Roles page with a permissions matrix.

**Architecture:** The statuses playbook (PR #27) applied to RBAC. The action
list stays compile-time in shared; who may perform each action becomes rows.
Permissions resolve per request into a set the API guard and the web
affordances both read. Three phases, one Opus agent each: A = shared + API
(additive in shared), B = web + deletion of the dead role-enum exports, C =
e2e + demo + docs + screenshots. Every commit green across all workspaces.

**Tech Stack:** Existing only — Fastify 5 + Drizzle + better-sqlite3, zod 4,
React 19 + TanStack Query 5, Playwright. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-18-granular-permissions-design.md`
— read it first; it holds the approved decisions this plan argues from.

## Global Constraints

- TDD: failing test first, watch it fail, implement, watch it pass — every task.
- Repo conventions from the CLAUDE.md files bind every task: named types in
  `types/` folders, no point-of-use type literals, `??` only as a documented
  rule, no DB CHECK constraints, semantic colors via `sv` keys, audit label
  snapshots, relative imports inside `packages/shared`.
- **Prior art is the workflow feature.** Before writing a file, read its
  twin: `apps/api/src/services/workflow.ts`, `apps/api/src/modules/workflow.ts`,
  `apps/api/src/db/seed.ts` (seedWorkflow), `packages/shared/src/schemas/workflow.ts`,
  `apps/web/src/features/workflow/*` (WorkflowPage, workflowDraft, modals, CSS).
  Mirror shape, naming, and comment voice.
- Phase A must not break the web build: `ROLES`, `Role`, `ROLE_LABELS`,
  `ROLE_COLORS`, `ROLE_DESCRIPTIONS`, and the role-ranked `can()` stay
  exported until Task 14 deletes them.
- Gates per phase end: `npm run lint && npm run typecheck && npm test` (and
  `npm run build` at phase end). e2e runs in Phase C.
- Commit after every task, message in the repo's voice (read `git log
  --oneline -30` first).

---

## Phase A — shared vocabulary + API (Agent 1)

### Task 1: Shared role vocabulary

**Files:**
- Modify: `packages/shared/src/rbac.ts`
- Modify: `packages/shared/src/index.ts` (re-exports)
- Test: `packages/shared/src/rbac.test.ts` (or the package's existing test layout)

**Interfaces (produces):**
```ts
// rbac.ts — all additive; MIN_ROLE and the old can() stay until Task 14.
export const ADMIN_ROLE = 'admin';
export const MAX_ROLES = 10;
// 'roles.manage': 'admin' is ADDED to MIN_ROLE so ACTIONS includes it and the
// old can() keeps typechecking while both permission models coexist.
export interface DefaultRole {
  id: string; label: string; description: string;
  color: SemanticColor; isSystem: boolean; grants: readonly Action[];
}
export const DEFAULT_ROLES: readonly DefaultRole[]; // admin, manager, viewer
export const ACTION_LABELS: Record<Action, string>;
export interface ActionGroup { label: string; actions: readonly Action[] }
export const ACTION_GROUPS: readonly ActionGroup[];
```

- `DEFAULT_ROLES`: admin (acc, "Full access — settings, members, activity log",
  isSystem true, grants: [] — the system role's set is ACTIONS by definition,
  never stored), manager (info, "Create and edit assets, employees and
  assignments", grants: assets.create, assets.edit, assets.assign,
  assets.checkin, assets.change_status, assets.manage_attachments,
  employees.create, employees.edit, import.run), viewer (neut, "Read-only
  access to all pages", grants: []). Copy label/description text exactly from
  the current `ROLE_DESCRIPTIONS` in enums.ts.
- `ACTION_LABELS`: human copy per action — Assets: "Create assets", "Edit
  assets", "Assign assets", "Check assets in", "Change asset status",
  "Manage attachments", "Delete assets"; Employees: "Add employees", "Edit
  employees", "Delete employees"; People: "Manage members and invites";
  Data: "Run CSV imports", "Export all data"; Administration: "Manage custom
  fields", "Edit the workflow", "Manage roles and permissions",
  "Workspace settings", "View the activity log", "Delete the workspace".
- `ACTION_GROUPS`: Assets / Employees / People / Data / Administration, in
  that order, partitioning ACTIONS exactly.

**Steps:**
- [ ] Failing tests: `ACTION_GROUPS` actions concatenated equal ACTIONS as a
  set with no duplicates; every DEFAULT_ROLES grant is a known Action;
  admin is the only `isSystem` row and its grants are empty; manager's grant
  list equals exactly the actions whose MIN_ROLE is 'manager' (pins the
  zero-behavior-change promise); MAX_ROLES is 10.
- [ ] Run, watch fail. Implement. Run, watch pass.
- [ ] Commit.

### Task 2: Role schemas + slug

**Files:**
- Create: `packages/shared/src/schemas/roles.ts`
- Create: `packages/shared/src/types/roles.ts`
- Modify: `packages/shared/src/schemas/workflow.ts` (extract the slugifier),
  `packages/shared/src/index.ts`
- Test: beside the workflow schema tests

**Interfaces (produces):**
```ts
// schemas/roles.ts
export const roleCreateSchema;   // { label, description (blank→null, cap like other one-liners), color: SemanticColor }
export const rolePatchSchema;    // all of the above optional — absent means "leave alone"
export const permissionsPutSchema; // { grants: {role: string, action: z.enum(ACTIONS)}[] } max 400
export const roleOrderSchema;    // { order: string[] } min 1
export function roleSlug(label: string): string; // same derivation as statusSlug
// types/roles.ts
export interface WorkspaceRole { id; label; description: string | null;
  color: SemanticColor; isSystem: boolean; sortOrder: number;
  memberCount: number; permissions: Action[] }
export interface RolesPayload { roles: WorkspaceRole[] }
```

- Extract the slug derivation shared by `statusSlug` and `roleSlug` into one
  helper (keep both named exports — the web's live slug hints use them).
  Mirror `statusCreateSchema`'s label bounds and color validation exactly.

**Steps:**
- [ ] Failing tests: accept/reject tables per schema (empty label, unknown
  color, unknown action in grants, >400 grants, empty order); `roleSlug`
  matches `statusSlug` behavior on the same inputs ("Read only" →
  `read_only`).
- [ ] Run/fail → implement → run/pass → commit.

### Task 3: Tables + migration + boot seed

**Files:**
- Modify: `apps/api/src/db/schema.ts` (tables `roles`, `role_permissions` per
  the spec's data-model block), `apps/api/src/db/seed.ts` (add `seedRoles`
  beside `seedWorkflow`, called from the same boot path)
- Create: generated migration under `apps/api/src/migrations/` (use the same
  drizzle-kit command the workflow feature used — check `apps/api/package.json`
  scripts and the workflow migration file's shape)
- Test: beside the seed tests

**Interfaces (produces):** `seedRoles(db)` — inserts `DEFAULT_ROLES` (+
manager's grant rows) only when `roles` is empty. Admin gets **no**
`role_permissions` rows.

**Steps:**
- [ ] Failing tests: fresh DB seeds exactly 3 roles in sortOrder admin(0),
  manager(1), viewer(2); running twice inserts nothing new; admin has zero
  permission rows; manager's rows equal DEFAULT_ROLES' manager grants;
  a DB that already has any role row (e.g. a custom one) is left untouched.
- [ ] Generate migration, check it in. Run/fail → implement → run/pass → commit.

### Task 4: Roles service — the invariants

**Files:**
- Create: `apps/api/src/services/roles.ts`
- Create: `apps/api/src/types/roles.ts` (service-side named shapes)
- Test: `apps/api/test/roles.service.test.ts` (match the workflow service
  test file's location/naming)

**Interfaces (produces):**
```ts
export function listRoles(db): WorkspaceRole[];        // memberCount joined; system role's permissions = [...ACTIONS]
export function resolvePermissions(db, roleId: string): ReadonlySet<Action>;
  // system → all ACTIONS; unknown roleId → empty set (fail-closed; the
  // delete-with-migrate guarantee is what makes this unreachable — say so in
  // a comment). Ordinary role → its stored grants.
export function requireRole(db, id: string): RoleRow;  // 404-throwing, like requireStatus
export function createRole(deps, actor, input): WorkspaceRole;   // cap MAX_ROLES, case-insensitive label + slug collision → 409 label_taken
export function updateRole(deps, actor, id, patch): WorkspaceRole; // system → 409 system_role; actor's own role → 409 own_role; no-op writes nothing
export function replacePermissions(deps, actor, grants): {added: number; removed: number};
export function reorderRoles(deps, actor, order): void; // full-permutation check like reorderStatuses
export function deleteRole(deps, actor, id, migrateTo?: string): void;
```

Guard order and messages (state each in its own test):
- `updateRole`/`deleteRole`: system → 409 `system_role` ("The Admin role is
  what keeps the workspace recoverable — it cannot be changed."), own → 409
  `own_role` ("You cannot change the role you hold — ask another admin.").
- `replacePermissions`: reject grants naming the system role or unknown
  roles; dedupe pairs; diff against stored — if the caller's own role's set
  would change → 409 `own_role`; write only the diff; audit
  `role.permissions_changed` {added, removed}; return counts.
- `deleteRole`: own → 409 `own_role`; system → 409 `system_role`; members
  holding it (any status) and no migrateTo → 409 `role_in_use`, message
  carrying the count ("3 members hold this role."); migrateTo must exist and
  differ from id; migrate every member + delete role (+ cascade grants) in
  ONE transaction; single audit event `role.deleted` {label,
  migratedToLabel?, memberCount}.
- `createRole`: 409 `role_limit` at MAX_ROLES; description blank→null;
  sortOrder appends at the end; audits `role.created` {label}.
- `updateRole` audits `role.updated` {label, changedFields}; reorder audits
  `role.reordered` (mirror whatever the statuses reorder audits — check the
  registry).

**Steps:**
- [ ] Failing tests for every bullet above, plus: listRoles memberCount counts
  invited members too; resolvePermissions on admin returns all ACTIONS
  (including roles.manage); on viewer returns empty.
- [ ] Run/fail → implement → run/pass → commit.

### Task 5: Roles module (routes)

**Files:**
- Create: `apps/api/src/modules/roles.ts` (register beside `modules/workflow.ts`
  — find where modules are wired and follow)
- Test: `apps/api/test/roles.routes.test.ts`

Routes (mirror `modules/workflow.ts` exactly in style):
- `GET /api/v1/roles` — requireAuth → `RolesPayload`.
- `POST /api/v1/roles` — requireAction('roles.manage'), body roleCreateSchema
  → 201 `{role}`.
- `PATCH /api/v1/roles/:id` — rolePatchSchema → `{role}`.
- `PUT /api/v1/roles/permissions` — permissionsPutSchema → `{added, removed}`.
- `POST /api/v1/roles/order` — roleOrderSchema → 204.
- `DELETE /api/v1/roles/:id?migrateTo=` → 204.

**Steps:**
- [ ] Failing route tests: viewer gets 403 on every mutation; GET works for
  every role; each error code surfaces with its envelope; 201/204 shapes.
- [ ] Run/fail → implement → run/pass → commit.

### Task 6: Permission resolution in the request path

**Files:**
- Modify: `apps/api/src/plugins/rbac.ts` (requireAction), the session/auth
  plugin that attaches `request.member`, the fastify request type declaration
  (find where `request.member` is declared), `/auth/me` handler
- Test: extend the rbac/auth plugin tests

**Interfaces (produces):** `request.permissions: ReadonlySet<Action>`
attached whenever `request.member` is (via `resolvePermissions`). `requireAction(action)` becomes
`request.permissions.has(action)` — the shared role-ranked `can()` is no
longer imported by the API after this task. `/auth/me` response gains
`permissions: Action[]` (sorted, from the set).

**Steps:**
- [ ] Failing tests: a member holding a custom role granted only
  `assets.create` can POST /assets (201) but gets 403 on DELETE
  /assets/:id and 403 on GET /audit; revoking the grant (replacePermissions)
  takes effect on the very next request with the same session cookie;
  /auth/me for the demo admin lists every action, for viewer lists none.
- [ ] Run/fail → implement → run/pass → commit.

### Task 7: Members flows against the roles table

**Files:**
- Modify: `apps/api/src/services/members.ts` (invite + role change validate
  via `requireRole`; last-admin guard anchored to `ADMIN_ROLE` import; audit
  params snapshot the role **label**), `apps/api/src/services/setup.ts` (or
  wherever the first admin is created — use `ADMIN_ROLE`), the
  `GET /auth/invite/:token` handler (add `roleLabel` so the accept page can
  show a custom role's name without auth)
- Modify: `packages/shared/src/audit-render.ts` — `member.invited` /
  `member.role_changed` render the label they are handed; legacy events
  carry slugs, so the renderer maps a value matching a DEFAULT_ROLES id to
  its label and renders anything else as-is (that "as-is" is the documented
  fallback rule, same reasoning as unknown actions).
- Test: members service/route tests + audit-render tests

**Steps:**
- [ ] Failing tests: inviting with an unknown role id → 422/404 (match the
  existing invalid-input style); inviting with a custom role works and the
  audit sentence shows the custom label; changing the last admin's role
  still refuses (`last_admin`); legacy event with params.role 'manager'
  still renders "Manager"; invite lookup returns roleLabel.
- [ ] Run/fail → implement → run/pass → commit.

### Task 8: Audit registry + export-all

**Files:**
- Modify: `packages/shared/src/audit-render.ts` (+ its action registry):
  `role.created`, `role.updated`, `role.deleted`, `role.permissions_changed`,
  `role.reordered` — all type `auth`. Sentences in the app's voice, e.g.
  "Created the role Auditor", "Renamed the role Auditor", "Deleted the role
  Auditor — 3 members moved to Viewer", "Changed permissions — 2 granted,
  1 revoked", "Reordered the roles".
- Modify: the export-all service (`GET /export`) to include `roles` and
  `rolePermissions` arrays.
- Test: audit renderer goldens + export test

**Steps:**
- [ ] Failing tests: every `role.*` action renders a sentence (registry
  completeness test already sweeps — extend its fixtures); export payload
  contains the seeded roles and manager grants.
- [ ] Run/fail → implement → run/pass → commit.
- [ ] **Phase A gate:** `npm run lint && npm run typecheck && npm test &&
  npm run build` — all green. Update `apps/api/CLAUDE.md` and
  `packages/shared/CLAUDE.md` where they narrate roles as an enum. Commit.

---

## Phase B — web (Agent 2)

### Task 9: API layer + wire types

**Files:**
- Modify: `apps/web/src/api/queries.ts` (`useRoles` under key `['roles']`),
  `apps/web/src/api/mutations.ts` (useCreateRole, useUpdateRole,
  useDeleteRole — takes `{id, migrateTo?}`, useSaveRolePermissions,
  useReorderRoles), the invalidation helper (mutations invalidate `['roles']`
  and `['members']`; me/permissions freshness rides the existing
  refetch-on-focus), `apps/web/src/types/api.ts` (me payload gains
  `permissions`)
- Test: beside the existing api-layer tests if any; otherwise covered by
  Task 11/12 component tests

**Steps:**
- [ ] Mirror how `useWorkflow` + workflow mutations are written (error
  envelope parsing, toast-ready messages). Implement, typecheck, commit.

### Task 10: The roles draft

**Files:**
- Create: `apps/web/src/features/roles/rolesDraft.ts`
- Test: `apps/web/src/features/roles/rolesDraft.test.ts`

**Interfaces (produces):**
```ts
export function draftKey(role: string, action: string): string; // 'role:action'
export function draftFromRoles(roles: WorkspaceRole[]): Set<string>; // non-system only
export function grantsFromDraft(draft: Set<string>): {role: string; action: Action}[];
export function draftChanged(stored: Set<string>, draft: Set<string>): boolean;
```

**Steps:**
- [ ] Failing tests mirroring `workflowDraft.test`: round-trip, system role
  excluded from draftFromRoles, changed detection both directions.
- [ ] Run/fail → implement → run/pass → commit.

### Task 11: RolesPage — RolesCard + PermissionsCard

**Files:**
- Create: `apps/web/src/features/roles/RolesPage.tsx`,
  `apps/web/src/features/roles/Roles.module.css`,
  `apps/web/src/features/roles/types/rolesPage.ts` (+ `types/index.ts` barrel)
- Modify: `apps/web/src/routes.tsx` (route `/roles`, guarded by
  `roles.manage` like `/workflow`), `apps/web/src/components/app/nav.ts`
  (item Roles after Workflow, `requires: 'roles.manage'`, breadcrumb label),
  icon set if a new glyph is needed (Feather `key` reads well; follow the
  Icon pattern and the kitchen-sink inventory picks it up)
- Test: `apps/web/src/features/roles/RolesPage.test.tsx`

Layout (read `WorkflowPage.tsx` first — same card anatomy, same
`--rp`/token discipline, matrix scroll container rule from
`Workflow.module.css`):
- **RolesCard**: DataTable — Pill (color, dot) + description column +
  member count ("3 members") + reorder arrows + edit/delete icon buttons.
  System role: no edit/delete. Caller's own role: icons disabled, hint via
  aria-label ("Ask another admin"). "Add role" button (hidden ≥ MAX_ROLES?
  no — let the server's 409 speak; the button stays).
- **PermissionsCard**: DataTable rows = actions inside ACTION_GROUPS group
  header rows (a full-width unselectable row per group, styled muted);
  columns = roles in sortOrder. Cell = centered Checkbox,
  `aria-label` "\${role.label}: \${ACTION_LABELS[action]}". Admin column
  checked + disabled everywhere; own-role column disabled. Draft +
  dirty-diff + Save/Discard exactly like MatrixCard, keyed on the stored
  grant set. Save → `useSaveRolePermissions`, toast "Permissions saved.".

**Steps:**
- [ ] Failing component tests: renders all groups and every action row;
  admin cells disabled-checked; own column disabled; toggling a cell flips
  dirty state and Save sends grantsFromDraft; Discard restores.
- [ ] Run/fail → implement → run/pass → commit.

### Task 12: Role modals

**Files:**
- Create: `apps/web/src/features/roles/RoleFormModal.tsx`,
  `apps/web/src/features/roles/DeleteRoleModal.tsx` (+ their `types/` files)
- Test: component tests beside them

- RoleFormModal mirrors StatusFormModal: label + description + color with
  live pill preview and (create only) live slug hint via `roleSlug`;
  create-mode footnote "New roles start with no permissions — grant them in
  the matrix below."
- DeleteRoleModal mirrors DeleteStatusModal: plain DELETE first; a 409
  `role_in_use` reveals the migrate Dropdown (destinations: every other
  role, admin included) + "Move and delete".

**Steps:**
- [ ] Failing tests: create posts label/description/color; 409 reveal flow;
  migrate sends `migrateTo`.
- [ ] Run/fail → implement → run/pass → commit.

### Task 13: Members surfaces go dynamic

**Files:**
- Modify: `apps/web/src/features/members/RoleCards.tsx` (+ types) — cards
  from `useRoles` (label, description from rows; keep the visual design),
  `InviteMemberModal.tsx`, `ChangeRoleModal.tsx`, `MembersPage.tsx` (role
  pill label+color from the roles payload — build a `Map<string, WorkspaceRole>`),
  `AcceptInvitePage.tsx` (use `roleLabel` from the invite lookup)
- Test: update the members feature tests

**Steps:**
- [ ] Failing tests: invite modal lists a custom role with its description;
  members page renders a custom role's pill color; accept page shows the
  label.
- [ ] Run/fail → implement → run/pass → commit.

### Task 14: The flip — can(permissions) and the dead exports

**Files:**
- Modify: `packages/shared/src/rbac.ts` — `can` becomes
  `can(permissions: readonly Action[], action: Action): boolean`; delete
  `MIN_ROLE` (its data now lives only in DEFAULT_ROLES), delete the rank
  machinery.
- Modify: `packages/shared/src/enums.ts` — delete `ROLES`, `Role`,
  `ROLE_LABELS`, `ROLE_COLORS`, `ROLE_DESCRIPTIONS`.
- Modify: every `can(` call site in `apps/web` (routes.tsx, nav.ts →
  `navItemsFor(permissions: Action[])`, palette.ts, ~15 components) to pass
  `me.permissions`; chase the compiler until `npm run typecheck` is clean.
  `member.role` stays on wire types as a plain `string` (it is a role id).
- Test: rbac tests rewritten for the new signature; nav/palette tests pass
  permission arrays.

**Steps:**
- [ ] Rewrite rbac tests first (fail), flip the signature, delete exports,
  chase compiler across all three workspaces, run everything.
- [ ] **Phase B gate:** lint, typecheck, unit tests, build — all green.
  Update `apps/web/CLAUDE.md` where it narrates role-based gating. Commit.

---

## Phase C — e2e, demo, docs, screenshots (Agent 3)

### Task 15: e2e journey

**Files:**
- Create: `e2e/tests/roles.spec.ts` (read `e2e/CLAUDE.md` and the workflow
  e2e spec first — helpers, provisioning, selector discipline)

Journey (one spec, several tests): admin opens /roles → creates role
"Auditor" (color, description) → grants `audit.view` + `export.run` in the
matrix → Save → changes an existing non-admin member to Auditor → that
member's session sees the Activity log nav item and can open /activity, but
gets no Add-asset affordance and a direct `POST /api/v1/assets` via request
context returns 403 → delete-with-migrate round trip on a disposable role.
Assert server truth via API calls where the UI would be flaky, like the
workflow spec does.

**Steps:**
- [ ] Write the spec, run `npm run e2e` (full suite), fix until green, commit.

### Task 16: Demo workspace curates a role

**Files:**
- Modify: `apps/api/src/db/demo-data.ts` / `demo.ts` (follow `curateWorkflow`
  — the curation runs AFTER the main transaction; better-sqlite3 cannot nest
  BEGIN)

Auditor role (warn, "Reads the books: activity log and exports", grants
audit.view + export.run) + one demo member holding it, printed with the
other logins; audit events flow through the real service so the log tells
the story; update the printed summary counts and any test pinning them.

**Steps:**
- [ ] Failing test on the demo seed (role exists, member holds it, grants
  exact). Implement, `npm run seed:demo -- --reset` sanity locally, commit.

### Task 17: Recipes + README + screenshots

**Files:**
- Create: `docs/recipes/add-permission-action.md` — the checklist for adding
  a new action slug: MIN_ROLE is gone, so: add to ACTIONS' source map,
  ACTION_LABELS, its ACTION_GROUPS group, grant it in DEFAULT_ROLES where
  the defaults should have it, `requireAction` on the route, `can()` on the
  affordance, audit renderer if it writes events, and the tests that pin
  group partitioning. Name every file. Follow the voice of the existing
  recipes.
- Modify: any recipe/CLAUDE.md still narrating the role enum (grep for
  ROLE_LABELS/Role); `README.md` — feature bullet + screenshots with
  captions, demo summary counts if they changed.
- Screenshots (ONLY once every gate above is green): `npm run seed:demo --
  --reset`, run dev, Chrome DevTools MCP at 1440×900 light theme —
  `media/roles.png` (the Roles page: cards + matrix) and
  `media/roles-invite.png` (invite modal showing the Auditor card). Match
  the style of the existing eight shots (fresh demo data, sidebar visible).
- [ ] **Phase C gate:** full `npm run lint && npm run typecheck && npm test
  && npm run build && npm run e2e`. Commit.

### Task 18: Final sweep (done by the orchestrator, not the agent)

Chrome DevTools walk of every flow in both themes and densities;
`docs/superpowers/` deleted in the final commit; PROJECT_STATUS updated
locally; PR opened — never merged.
