# packages/shared — the single source of truth

Plain TypeScript (no runtime deps yet) imported by both apps as `@inventory/shared` (TS source directly — no build step). Domain vocabulary lives here; both apps follow.

## Files

- `src/enums.ts` — every enum as a slug array + `…_LABELS` (exact design copy) + `…_COLORS` (semantic color key `sv`). Also `canDirectlyTransition` (Change-status rules: `assigned` is never entered/left directly — that's assign/check-in).
- `src/rbac.ts` — `can(role, action)` over a `MIN_ROLE` map with rank `viewer < manager < admin`. Reads are open to all roles; every mutating or admin-only action must be declared here. API guards and UI affordances both call `can()` — one truth.
- `src/schemas/` — zod entity schemas. Field changes start here and ripple: schema → DB migration → API → forms/tables → CSV mapping → export.
  - `common.ts` holds the field builders every entity shares: `email` (lowercased at the boundary), `nullableText(max)` and `nullableDate` (blank means NULL, so `""` never reaches a column). Build new fields from these rather than re-deriving the blank-handling.
  - Creates and patches are deliberately different shapes: a create gives optional fields `.default(null)`, a patch leaves them `.optional()` so **absent means "leave alone" and explicit `null` means "clear it"**. API services rely on that distinction — `if (!(field in patch)) continue`.
- `src/audit-render.ts` — the **one** renderer turning stored `{action, params}` events into sentences, used by the per-asset trail, the activity log and the CSV export so they cannot drift. Adding an audited action means adding a renderer here; the test asserts every action in the registry renders something other than its own slug.
- `src/types/` — the named shapes both apps import, re-exported through `src/index.ts`. `api.ts` holds `ApiErrorBody`/`ApiErrorEnvelope`, the one error envelope the API sends and the web client parses; `audit.ts` holds `AuditParams` and `RenderableAuditEvent`; `assignments.ts` holds `OutcomeInput`; `money.ts` holds `PriceParse`. **Relative imports only, here as everywhere in this package** — it is consumed as raw TypeScript, so a `@/` would resolve against whichever bundler is consuming it. Zod-inferred types stay in `src/schemas/`: the schema is the truth and a hand-written twin would drift. Use `interface` for object shapes, `type` where the shape is a union (`PriceParse` has two arms carrying different fields on purpose).
- `src/money.ts` — `parsePriceToCents` is the single reader of human-typed money ("€ 2,340.00", "1.299,00"), used by the asset form now and the CSV importer later. It does integer arithmetic on the digit strings, so rounding is exact; never multiply a parsed float by 100.

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
- The three `??` in this package are domain rules, not fallbacks, and each says so: an unlabelled status or field name renders as itself (a log that hides events is worse than an ugly one — the same reasoning as the unknown-action fallback in `audit-render.ts`, which is deliberate and must stay), and an amount written with fewer than three decimals has no third digit to round on. Anywhere a value _should_ have been there, throw instead.
- `sv` keys must be one of `ok|acc|warn|err|info|neut` (they resolve to `--{sv}`/`--{sv}-bg` CSS tokens).
- Keep this package dependency-free until zod arrives (PR 2); nothing here may import from the apps.
