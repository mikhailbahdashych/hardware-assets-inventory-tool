# Add an enum value

> **Asset statuses moved to Admin → Workflow.** They are rows in `asset_statuses` now, added and renamed by an admin in the running app — no code, no deploy. This recipe is for the enums that stayed in code.

Worked example: an asset category `tablets`. The same steps add a role, a check-in condition, an audit type or an assignment outcome — every enum left in this app is built the same way.

**There is no migration.** Enum columns are `TEXT` with no `CHECK` constraint, deliberately, so adding a value is a code-only change. That decision is what makes this recipe five minutes long.

---

## 1. The value and its label map — `packages/shared/src/enums.ts`

```ts
export const ASSET_CATEGORIES = [
  'laptops',
  'desktops',
  'monitors',
  'phones',
  'peripherals',
  'tablets',
] as const;

export const ASSET_CATEGORY_LABELS: Record<AssetCategory, string> = {
  // …
  tablets: 'Tablets',
};
```

Add the slug to the array and TypeScript's `Record` types make every map fail to compile until it is complete. That is the guard rail — you cannot add a value that has no label.

Some enums carry a **semantic colour** map as well (roles, employee statuses, audit types). The colour must be one of `ok | acc | warn | err | info | neut`. Never a hex value: those resolve to `--{sv}` and `--{sv}-bg`, which is what makes it work in both themes.

## 2. Update the test that pins the vocabulary

`packages/shared/src/enums.test.ts` asserts the label copy — and, where there is one, the colour — of every value against the design. Add yours with intent: the test exists so a label never changes by accident.

## 3. What updates itself

Nothing else is required for a category. Specifically:

- **The asset form's category select** maps `ASSET_CATEGORIES`, so the new option appears.
- **The dashboard's "Assets by category" bars** are built from the same array on the API side (`apps/api/src/services/dashboard.ts`), zero-filled, so an empty category still draws its row.
- **The list, the detail page, the employee's holdings and the command palette** all label it through `ASSET_CATEGORY_LABELS`.
- **The importer accepts both** `Tablets` and `tablets`, in any casing, because `matchEnumValue` reads labels and slugs alike — and the CSV template's example row is generated from the same list.
- **The zod schemas** in `packages/shared/src/schemas/assets.ts` are `z.enum(ASSET_CATEGORIES)`, so the API accepts the new value the moment it is in the array.

## 4. Check for a hardcoded count

```bash
rg 'toHaveLength\(5\)|length\).toBe\(5\)' apps packages   # for categories; use your own enum's size
rg 'repeat\(5' apps/web/src
```

A test or a CSS grid that spells out how many there are is the one thing that does not follow the array. (The dashboard's status tiles used to be one of these; they are `repeat(auto-fill, minmax(148px, 1fr))` now, because a workspace can invent an eighth status at four o'clock on a Friday.)

## The step people forget

**Existing rows keep their old value, and that is the point.** Removing a value from the array does not remove it from the database: assets still carry the slug, and the UI renders what it can rather than crashing. If you are _replacing_ a value rather than adding one, write a migration that updates the rows — the enum change alone leaves data nothing can label.

## What this recipe is not for

**A new asset status.** Sign in as an admin, open **Workflow**, and add it there: label, colour, whether assets can be handed out of it, whether a check-in may land in it, and which moves the transition matrix allows. `packages/shared/src/enums.ts` still holds `DEFAULT_ASSET_STATUSES`, but that is only the workflow a **fresh** instance is seeded with plus the label fallback for audit events written before any of this existed — editing it changes nothing on a workspace that already exists.
