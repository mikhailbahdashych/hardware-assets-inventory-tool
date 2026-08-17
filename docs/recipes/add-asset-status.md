# Add an enum value

Worked example: an asset status `on_loan`. The same steps add a category, a role, a check-in condition or an assignment outcome — every enum in this app is built the same way.

**There is no migration.** Enum columns are `TEXT` with no `CHECK` constraint, deliberately, so adding a value is a code-only change. That decision is what makes this recipe five minutes long.

---

## 1. The value and its two maps — `packages/shared/src/enums.ts`

```ts
export const ASSET_STATUSES = [
  'available',
  'assigned',
  'in_repair',
  'ordered',
  'retired',
  'lost_stolen',
  'on_loan',
] as const;

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  // …
  on_loan: 'On loan',
};

export const ASSET_STATUS_COLORS: Record<AssetStatus, SemanticColor> = {
  // …
  on_loan: 'info',
};
```

Add the slug to the array and TypeScript's `Record` types make both maps fail to compile until they are complete. That is the guard rail — you cannot add a status that has no label or no colour.

The colour must be one of `ok | acc | warn | err | info | neut`. Never a hex value: those resolve to `--{sv}` and `--{sv}-bg`, which is what makes it work in both themes.

## 2. Where it may be reached from

`canDirectlyTransition(from, to)` in the same file decides what the Change-status modal offers. The rule today is that `assigned` is never entered or left directly — that is what assign and check-in are for. A new status is reachable from everything else automatically; if it needs its own rule, this is the one place to write it.

If it should also be a **check-in destination**, add it to `CHECKIN_NEW_STATUSES` and `CHECKIN_NEW_STATUS_LABELS`.

## 3. Update the tests that pin the vocabulary

`packages/shared/src/enums.test.ts` asserts the label copy and colour of every value against the design. Add yours with intent — the test exists so a label never changes by accident.

## 4. What updates itself

Nothing else is required. Specifically:

- **The assets list filter pills** are built from `ASSET_STATUSES`, so the new pill and its count appear.
- **The dashboard's KPI tiles** are too — six becomes seven, and the grid is `repeat(6, 1fr)` in `Dashboard.module.css`, so that number needs changing.
- **The form's status select**, the detail page's pill, the audit renderer's sentences and the CSV importer all read the same maps.
- **The importer accepts both** `On loan` and `on_loan`, in any casing, because `matchEnumValue` reads labels and slugs alike.

## 5. Check the two places a count is hardcoded

```bash
rg 'repeat\(6' apps/web/src        # the dashboard's KPI grid
rg 'toHaveLength\(6\)|length\).toBe\(6\)' apps/web/src apps/api
```

The design draws six tiles. A seventh status means deciding what the row looks like — that is a design question, not a code one, so answer it before shipping.

## The step people forget

**Existing rows keep their old value, and that is the point.** Removing a status from the array does not remove it from the database: assets still carry the slug, and the UI renders it as itself rather than vanishing (see the `status()` helper in `audit-render.ts`). If you are _replacing_ a status rather than adding one, write a migration that updates the rows — the enum change alone leaves data nothing can label.
