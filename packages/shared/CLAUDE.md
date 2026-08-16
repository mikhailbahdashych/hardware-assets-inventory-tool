# packages/shared — the single source of truth

Plain TypeScript (no runtime deps yet) imported by both apps as `@inventory/shared` (TS source directly — no build step). Domain vocabulary lives here; both apps follow.

## Files

- `src/enums.ts` — every enum as a slug array + `…_LABELS` (exact design copy) + `…_COLORS` (semantic color key `sv`). Also `canDirectlyTransition` (Change-status rules: `assigned` is never entered/left directly — that's assign/check-in).
- `src/rbac.ts` — `can(role, action)` over a `MIN_ROLE` map with rank `viewer < manager < admin`. Reads are open to all roles; every mutating or admin-only action must be declared here. API guards and UI affordances both call `can()` — one truth.
- `src/schemas/` — zod entity schemas (arrive in PR 2). Field changes start here and ripple: schema → DB migration → API → forms/tables → CSV mapping → export.

## The enum pattern (follow it for every new value)

```ts
export const ASSET_STATUSES = [...] as const;         // slugs, stored in DB as-is
export type AssetStatus = (typeof ASSET_STATUSES)[number];
export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {...};  // exact UI copy
export const ASSET_STATUS_COLORS: Record<AssetStatus, SemanticColor> = {...};
```

The DB has **no CHECK constraints** on enum columns (deliberate): adding a status or category is a code-only change — extend the array + both maps, and TypeScript's `Record` types force every map to stay complete. Tests in `enums.test.ts` pin the label copy and color maps to the design; update them together with intent.

## Rules

- Never let an app define its own copy of a label, color, or permission — import from here.
- `sv` keys must be one of `ok|acc|warn|err|info|neut` (they resolve to `--{sv}`/`--{sv}-bg` CSS tokens).
- Keep this package dependency-free until zod arrives (PR 2); nothing here may import from the apps.
