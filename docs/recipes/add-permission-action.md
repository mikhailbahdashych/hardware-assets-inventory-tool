# Add a permission action

Worked example: `locations.create`, the permission a new Locations section would need.

> **Roles moved to the Roles page.** Which _roles_ a workspace has, and which actions each one is granted, is data — rows in `roles` and `role_permissions`, edited by an admin in the running app. This recipe is the other half: which _actions exist_ is a product decision, compiled in, and that is what you are adding.

**There is no migration**, and there is nothing to grant. An action is a string in an array with three maps around it; a workspace decides who holds it by ticking a box on **Roles**. The one role that needs no ticking is Admin: it is the system role and its permission set is `ACTIONS` by definition, so an action added today is already its own — that is `resolvePermissions` in `apps/api/src/services/roles.ts`, one line, and the reason this recipe has no reconciliation step.

---

## 1. The action — `packages/shared/src/rbac.ts`

Four edits in one file, and TypeScript will not let you stop after the first.

```ts
export const ACTIONS = [
  // …
  'locations.create',
] as const;

export const ACTION_LABELS: Record<Action, string> = {
  // …
  'locations.create': 'Create locations',
};

export const ACTION_GROUPS = [
  // …
  { label: 'Assets', actions: ['assets.create', …, 'locations.create'] },
] as const satisfies readonly ActionGroup[];
```

`Action` is `(typeof ACTIONS)[number]`, so the `Record` types fail to compile until the label is there. `ACTION_GROUPS` is what the permissions matrix draws its bands from — a checkbox in no group is a permission nobody can grant. Put the action under one of the five bands the matrix already draws (Assets, Employees, People, Data, Administration); a sixth is allowed, but the test in the next step names them and their order, so add it there in the same breath. **The label is the row's whole copy**: write what a person does, not what the endpoint is called.

Then the seed, if the roles a _fresh_ instance starts with should have it:

```ts
export const DEFAULT_ROLES = [
  // …
  { id: 'manager', /* … */ grants: ['assets.create', …, 'locations.create'] },
];
```

Admin's `grants` array stays empty on purpose — see above. And editing `DEFAULT_ROLES` changes nothing on a workspace that already exists: `apps/api/src/db/seed.ts` only seeds the roles table when it is empty, because a workspace that has edited its roles deleted rows on purpose.

## 2. The test that pins the partition — `packages/shared/src/rbac.test.ts`

It asserts that `ACTION_GROUPS` partitions `ACTIONS` exactly — every action in one group, none in two — that `ACTION_LABELS` labels each one as something other than its slug, and that the bands are the five the matrix draws, in order. It will fail the moment you add the slug and pass again when the group has it; that failure _is_ the reminder, so run it before you go looking for the next file. `DEFAULT_ROLES` has its own tests there too, including one that refuses a grant this build does not declare.

`packages/shared/src/audit-render.test.ts` is the other one to watch if the action writes events (step 5).

## 3. The door — `apps/api/src/modules/<area>.ts`

```ts
typed.post(
  '/api/v1/locations',
  { schema: { body: locationCreateInput }, preHandler: requireAction('locations.create') },
  async (request) => ({ location: createLocation(deps, request.member!, request.body) }),
);
```

`requireAction` composes `requireAuth`, so it also carries the two-factor enrolment gate — never re-implement a guard's body, call the one below it. **A route with no action named on it is a route nothing guards**: reads are deliberately open to every authenticated member, so anything that mutates or is admin-only must name one.

The permission set is resolved per request in `apps/api/src/plugins/session.ts`, which is why a grant an admin made a second ago lands on the member's very next request with no session machinery involved.

## 4. The affordance — `apps/web`

```tsx
{can(permissions, 'locations.create') && <Button icon="plus" …>Add location</Button>}
```

Every gated page takes a `permissions: Action[]` prop threaded from the session in `routes.tsx`; `/auth/me` carries the set the API resolved, and `requireAction` reads that same set on the server — which is what keeps a button and the door behind it from disagreeing. Nothing in the web may name a role but `admin`.

If the action gates a whole page, guard the **route** in `apps/web/src/routes.tsx` (`can(permissions, 'locations.manage') ? <LocationsPage …/> : <Navigate to="/dashboard" replace />`) and add `requires: 'locations.manage'` to the entry in `apps/web/src/components/app/nav.ts`. A hidden nav item hides the door without locking it.

The command palette filters its entries by permission too — `apps/web/src/components/app/palette.ts`.

## 5. The sentence, if it writes events — `packages/shared/src/audit-render.ts`

Every mutation writes its audit event in the same transaction, and every audited action needs a renderer here. Look at what the sentence needs and audit _that_: a renderer can only say what its `params` carry.

## What updates itself

- **The permissions matrix on `/roles`** draws one row per action, from `ACTION_GROUPS` and `ACTION_LABELS`. No component change, no column, no migration.
- **The Admin column** is ticked and disabled for the new row the moment it exists.
- **Every existing role** starts without it, which is the safe direction. An admin ticks the boxes they mean and presses Save.

## The step people forget

**Nobody has the new permission except Admin.** Adding an action to `ACTIONS` widens what _can_ be granted, not what is: existing roles are rows, and rows do not grow a column. If a workspace's Managers should be able to do the new thing, an admin has to tick it on **Roles** — and if the feature ships to instances that upgrade rather than start fresh, say so in the release notes, because `DEFAULT_ROLES` will not reach them.

## What this recipe is not for

**A new role.** Sign in as an admin, open **Roles**, and add it there: name, colour, description, then the boxes it may tick. `packages/shared/src/rbac.ts` still holds `DEFAULT_ROLES`, but that is only the roles a **fresh** instance is seeded with plus the label fallback for audit events written before any of this existed.
