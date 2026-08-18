# Granular permissions: roles as workspace data

Approved 2026-08-18. The statuses playbook (PR #27) applied to RBAC: the three
compiled-in roles become rows an admin edits, each carrying its own set of
granted actions. A fresh or upgraded instance behaves exactly as today.

## Decisions (user-approved)

1. **Permissions govern actions only.** Every signed-in member still reads
   every page; the checkboxes are the existing action slugs. No page-visibility
   gating. (The Activity log, Workflow, Admin and Roles pages remain gated the
   way they are today — by the action that makes them useful, `audit.view`,
   `workflow.manage`, `settings.manage`, `roles.manage` — that is an action
   gate, not a new concept.)
2. **Only Admin is locked.** `admin` is the system role: always every
   permission, including actions added in future versions; never renamed,
   edited, deleted, or reordered away from the top. Manager and Viewer are
   ordinary seeded rows — rename, recolor, describe, regrant, delete-with-migrate.
3. **You may not edit or delete the role you currently hold.** Same family as
   "nobody may change or remove their own account". Closes quiet
   self-promotion by anyone granted `roles.manage`.
4. **Roles is its own sidebar item**, beside Workflow, visible with
   `roles.manage`.

## Vocabulary split

The **product** decides which actions exist: `ACTIONS` stays a compile-time
list in `packages/shared/src/rbac.ts`, joined by `ACTION_LABELS` (UI copy per
action) and `ACTION_GROUPS` (area groupings for the matrix: Assets, Employees,
People, Data, Administration). The **workspace** decides who may do them:
`roles` + `role_permissions` tables. This is the enum-vs-table line already
drawn in `packages/shared/CLAUDE.md`.

New action: **`roles.manage`** (seeded to Admin via the system rule below).

## Data model

```
roles             id TEXT PK (slug from label, like statusSlug)
                  label, description (nullable), color (sv), is_system INT,
                  sort_order INT, created_at, updated_at
role_permissions  role_id TEXT (cascade on delete), action TEXT,
                  PK (role_id, action)
```

`members.role` already stores `admin|manager|viewer` as plain text — it becomes
a loose reference to `roles.id`, validated in services (no FK rebuild, no CHECK
— consistent with the repo rule).

**Seed** (idempotent at boot, exactly like `seedWorkflow`): `DEFAULT_ROLES` in
shared — admin (system, color acc, "Full access — settings, members, activity
log"), manager (info, today's grants: assets.create/edit/assign/checkin/
change_status/manage_attachments, employees.create/edit, import.run), viewer
(neut, empty grant set — reads are open, so this is today's viewer exactly).
Existing members' `role` values already match the seeded ids: zero data
rewrite, zero behavior change on upgrade.

**The system role stores no permission rows.** Its permission set is `ACTIONS`
by definition (`resolvePermissions` says so in one place). That is what makes
"including future actions" true without boot-time reconciliation.

`MAX_ROLES = 10`. Labels unique case-insensitively; ids collide like status
slugs do.

## Invariants and guards (all in the roles service, all tested)

- System role: PATCH/DELETE/permission changes → 409 `system_role`. Reorder
  keeps it wherever the permutation puts it (it is pinned first in the seed
  but reordering it is harmless; simplest is to allow it in the permutation
  like any row).
- Own role: PATCH/DELETE/permission changes touching the caller's role → 409
  `own_role`.
- Delete in use: 409 `role_in_use` with member count; `?migrateTo=` migrates
  every member (any status — invited included) and deletes in one transaction,
  one summary audit event `{label, migratedToLabel, memberCount}`. `migrateTo`
  may be any other role including admin (explicit choice), never the deleted
  role itself, and must exist.
- Last-admin guard in the members service: unchanged in spirit, now anchored
  to `ADMIN_ROLE` from shared (the way `ASSIGNED_STATUS` is). Role migration
  cannot strand the workspace: deleting a role never touches admin members.
- Invites and role changes validate the role id against the table; audit
  params snapshot the role **label** at write time (rename never rewrites
  history). Legacy fallback: `DEFAULT_ROLES` labels for events written before
  this feature.
- Permissions resolve per request (auth plugin attaches the set), so a grant
  or revocation takes effect on the member's next request — no session
  invalidation machinery.

## API (`/api/v1`)

- `GET /roles` — requireAuth, any role. `{ roles: [{ id, label, description,
  color, isSystem, sortOrder, memberCount, permissions: Action[] }] }`. Feeds
  pills, invite cards, the matrix, delete modal.
- `POST /roles` — `roles.manage`. `{label, description?, color}` → 201
  `{role}`. New roles start with **no permissions**; grants happen in the
  matrix.
- `PATCH /roles/:id` — label/description/color only.
- `PUT /roles/permissions` — the whole grant set for every non-system role,
  idempotent, mirroring `PUT /workflow/transitions`: `{grants: [{role,
  action}]}`. Server rejects grants naming the system role or unknown
  roles/actions; changes touching the caller's own role → 409 `own_role`
  (compare against stored — an unchanged own-role column is fine to submit).
  Audit `{added, removed}` counts.
- `POST /roles/order` — full permutation, like statuses.
- `DELETE /roles/:id?migrateTo=` — 204; see guards.
- `/auth/me` gains `permissions: Action[]` (resolved server-side). Wire shapes
  live in `packages/shared/src/types/roles.ts` (`WorkspaceRole`,
  `RolesPayload`), like `types/workflow.ts`.

## Shared changes (green-commit phasing)

Phase A adds: `ADMIN_ROLE`, `MAX_ROLES`, `DEFAULT_ROLES` (seed + legacy label
fallback), `ACTION_LABELS`, `ACTION_GROUPS`, `roleSlug` (share the slugifier
with `statusSlug`), `schemas/roles.ts` (create/patch/permissions-put/order),
`types/roles.ts`, `can(permissions, action)` overload-or-replacement. Old
exports (`ROLES`, `Role`, `ROLE_LABELS/COLORS/DESCRIPTIONS`, `MIN_ROLE`
rank-based `can`) stay until the web migrates; **deleted at the end of Phase
B** so every commit compiles across workspaces.

`can()` final shape: `can(permissions: readonly Action[], action: Action)` —
the name and call sites survive, the first argument changes from role to the
resolved set.

## Web

- **RolesPage** (`features/roles/`, shaped like WorkflowPage):
  - **RolesCard** — one row per role: pill (color+label), description,
    member count, reorder arrows, edit/delete icons. System role: no
    edit/delete; own role: disabled with tooltip/hint.
  - **PermissionsCard** — matrix: action rows grouped by `ACTION_GROUPS`
    (group header rows), one column per role. Checkbox per cell. Admin column
    checked and disabled throughout; own-role column disabled with a hint.
    Local draft `Set<'role:action'>`, dirty-diff against stored, Save/Discard
    — the exact `workflowDraft.ts` pattern. Keyed on the stored grant set so
    another admin's save re-seeds the draft.
  - **RoleFormModal** — label, description, color, live slug hint (create
    only).
  - **DeleteRoleModal** — plain delete → 409 reveals migrate Dropdown +
    "Move and delete", like DeleteStatusModal.
- **Members page / invite / change-role** — role pills, invite RoleCards and
  ChangeRoleModal read `GET /roles` instead of the shared maps; descriptions
  come from the row.
- **Sidebar** — "Roles" item (requires `roles.manage`) beside Workflow; nav
  filtering, route guards, and the palette switch from `can(role, …)` to
  `can(me.permissions, …)` mechanically.
- Icon: reuse an existing one if it reads (`shieldCheck` is taken by Members)
  — add one Feather path if needed, kitchen-sink inventory updated.

## Audit

New actions + renderer entries: `role.created` {label}, `role.updated` {label,
changedFields}, `role.deleted` {label, migratedToLabel?, memberCount},
`role.permissions_changed` {added, removed}, `role.reordered`. Type mapping:
`role.*` → auth (they are access-control events, beside `member.*`).

## Export

`GET /export` (export-all JSON) gains `roles` + `rolePermissions` sections.

## Demo workspace

`seed:demo` curates a fourth role — **Auditor** (color warn, "Reads the books:
activity log and exports", grants `audit.view` + `export.run`) — and one
member holding it, printed with the other logins. Applied after the main
seed transaction like `curateWorkflow`.

## Testing

TDD throughout. API: service invariants (system/own/in-use/migrate/cap/
collisions/permutation), route guards (403 without `roles.manage`, member with
a custom role exercising granted vs ungranted actions), me-payload, invite
validation, audit params. Web: RolesPage draft/dirty/save, gating by
permissions array, dynamic invite cards. Shared: schema tables, DEFAULT_ROLES
completeness, ACTION_LABELS/GROUPS cover every action (compile-time via
Record, plus a test that groups partition ACTIONS exactly). e2e: create role →
grant in matrix → change a member's role → their affordances and a direct API
call both obey; delete-with-migrate.

## Deliberate cuts (documented, not built)

Multiple roles per member · page-visibility gating · per-record permissions ·
role cloning/duplication · permission for reads · API tokens.

## Cleanup contract

Screenshots into `media/` + README feature bullet and captions; new recipe
`docs/recipes/add-permission-action.md` (the code-side change adopters make);
touch any recipe that still narrates the old role enum; this spec and its plan
are deleted in the branch's final commit; `docs/PROJECT_STATUS.md` updated
locally, never committed.
