# packages/shared — the single source of truth

Plain TypeScript imported by both apps as `@inventory/shared` (TS source directly — no build step). **zod is the one runtime dependency**, declared in this package's own `package.json` because `src/schemas/` imports it; nothing else may be added without a reason that survives being the same dependency in both apps. Domain vocabulary lives here; both apps follow.

## Files

- `src/enums.ts` — every enum as a slug array + `…_LABELS` (exact design copy) + `…_COLORS` (semantic color key `sv`). **Asset statuses are the exception and are no longer an enum**: they are rows in `asset_statuses`, edited on the Workflow page. What is left here is `DEFAULT_ASSET_STATUSES` (the workflow a fresh instance is seeded with, and the label map the audit renderer falls back to for events written before that), `ASSIGNED_STATUS` — the one status slug either app may name, because assign and check-in are its only doors — and `MAX_ASSET_STATUSES`.
- `src/schemas/workflow.ts` — the contracts for that table: `statusCreateSchema`, `statusPatchSchema`, `transitionsPutSchema`, `statusOrderSchema`, and `statusSlug(label)`, which derives a status's permanent id from the words an admin typed once. `src/types/workflow.ts` holds `WorkflowStatus`/`WorkflowTransition`/`WorkflowPayload`, the shapes `GET /api/v1/workflow` sends and every status consumer in the web reads.
- `src/rbac.ts` — `can(role, action)` over a `MIN_ROLE` map with rank `viewer < manager < admin`. Reads are open to all roles; every mutating or admin-only action must be declared here. API guards and UI affordances both call `can()` — one truth.
- `src/schemas/` — zod entity schemas. Field changes start here and ripple: schema → DB migration → API → forms/tables → CSV mapping → export.
  - `common.ts` holds the field builders every entity shares: `email` (lowercased at the boundary), `nullableText(max)` and `nullableDate` (blank means NULL, so `""` never reaches a column). Build new fields from these rather than re-deriving the blank-handling.
  - Creates and patches are deliberately different shapes: a create gives optional fields `.default(null)`, a patch leaves them `.optional()` so **absent means "leave alone" and explicit `null` means "clear it"**. API services rely on that distinction — `if (!(field in patch)) continue`. `settings.ts` is where it earns its keep: `logRetentionMonths: null` is the Settings page's "Forever", a value, while an absent key means the admin did not touch that control.
  - `members.ts` holds the invite/patch/workspace-delete contracts. An invite's `sendEmail` is the design's checkbox; the endpoint returns the link either way, because an instance with no SMTP still has to be able to add people.
- `src/audit-render.ts` — the **one** renderer turning stored `{action, params}` events into sentences, used by the per-asset trail, the activity log and the CSV export so they cannot drift. Adding an audited action means adding a renderer here; the test asserts every action in the registry renders something other than its own slug. A renderer can only say what its `params` carry: `member.joined` read "A member joined the workspace" for a whole PR because the endpoint never passed the name it had just learned. When you add an action, look at what the sentence needs and audit that.
- `src/csv.ts` — `toCsv`/`csvField`, RFC 4180 quoting. Asset names really do contain commas and inch marks (`MacBook Pro 14"`), so a row can tear in half; the activity-log export and the import templates both go through it.
- `src/schemas/import.ts` — the CSV vocabulary three places have to agree on: the canonical columns, the templates the API serves, the auto-matcher in the wizard's mapping step, and `matchEnumValue`, which reads both the label a spreadsheet shows ("In repair") and the slug the database stores — over a compile-time label map _or_ a runtime `{value, label}[]`, which is how a workspace's own statuses reach the same matcher. A template is built from the same column list the validator reads, so a downloaded template can never be one the app rejects. **Parsing is not here** — the browser does it with papaparse and sends canonical rows, so the API needs no CSV parser at all.
- `src/types/` — the named shapes both apps import, re-exported through `src/index.ts`. `api.ts` holds `ApiErrorBody`/`ApiErrorEnvelope`, the one error envelope the API sends and the web client parses; `audit.ts` holds `AuditParams` and `RenderableAuditEvent`; `assignments.ts` holds `OutcomeInput`; `money.ts` holds `PriceParse`. **Relative imports only, here as everywhere in this package** — it is consumed as raw TypeScript, so a `@/` would resolve against whichever bundler is consuming it. Zod-inferred types stay in `src/schemas/`: the schema is the truth and a hand-written twin would drift. Use `interface` for object shapes, `type` where the shape is a union (`PriceParse` has two arms carrying different fields on purpose).
- `src/money.ts` — `parsePriceToCents` is the single reader of human-typed money ("€ 2,340.00", "1.299,00"), used by the asset form now and the CSV importer later. It does integer arithmetic on the digit strings, so rounding is exact; never multiply a parsed float by 100.

## The enum pattern (follow it for every new value)

```ts
export const ASSET_CATEGORIES = [...] as const;       // slugs, stored in DB as-is
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];
export const ASSET_CATEGORY_LABELS: Record<AssetCategory, string> = {...};  // exact UI copy
export const ROLE_COLORS: Record<Role, SemanticColor> = {...};              // where there is a colour
```

The DB has **no CHECK constraints** on enum columns (deliberate): adding a category or a role is a code-only change — extend the array + every map, and TypeScript's `Record` types force each one to stay complete. Tests in `enums.test.ts` pin the label copy and color maps to the design; update them together with intent.

**Asset statuses went one step further, from code to data.** They outgrew this pattern the moment a workspace wanted its own — so they became rows with a transition graph beside them, and the vocabulary an admin edits at runtime is no longer something either app can compile against. That is the line: a value the _product_ decides is an enum here; a value a _workspace_ decides is a table with a service guarding it.

One option list is numbers rather than slugs — `LOG_RETENTION_OPTIONS` (12/24/`null` = Forever). It follows the same pattern with a keyed label map; `LOG_RETENTION_LABELS` is keyed by `` `${LogRetention}` `` so `null` becomes the string `"null"` and the compiler still checks completeness. Its column is a plain integer, so widening the list is a code-only change too.

**Not everything with a few sensible values is an enum.** The warranty lead time was one — 30/60/90 in a dropdown — and it is now `MIN_WARRANTY_LEAD_DAYS`/`MAX_WARRANTY_LEAD_DAYS` with a plain number field behind it. The test for the difference is whether the code ever _branches_ on the value: a role decides what may happen next, so its set is closed and shared; a lead time is only compared to a date, so fixing it to three choices told admins their policy was wrong. A bounded number needs bounds and their message, not a label map.

## Rules

- Never let an app define its own copy of a label, color, or permission — import from here.
- The `??`s in this package are domain rules, not fallbacks, and each says so: an unlabelled status, role or field name renders as itself (a log that hides events is worse than an ugly one — the same reasoning as the unknown-action fallback in `audit-render.ts`, which is deliberate and must stay), and an amount written with fewer than three decimals has no third digit to round on. Anywhere a value _should_ have been there, throw instead.
- `sv` keys must be one of `ok|acc|warn|err|info|neut` (they resolve to `--{sv}`/`--{sv}-bg` CSS tokens).
- **zod is the only runtime dependency, and it is declared here.** It is pinned to the same range `apps/api` uses (`^4.4.3`); npm-workspace hoisting would otherwise let this package resolve a version nobody chose. Adding a second dependency means both apps carry it too — say why in the PR. And **nothing here may import from the apps**: the arrow only ever points inwards, which is what lets `apps/web` consume this as raw source.
