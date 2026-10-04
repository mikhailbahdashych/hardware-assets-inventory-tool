# packages/shared — the single source of truth

Plain TypeScript imported by both apps as `@inventory/shared`, as source — no build step. Domain vocabulary lives here; both apps follow.

## Files

- `src/enums.ts` — every enum as a slug array + `…_LABELS` (exact design copy) + `…_COLORS` (an `sv` key). Also the vocabularies that are not member actions: `AUDIT_ACTOR_KINDS` (`member | token | system`), `API_SCOPES` with `API_SCOPE_LABELS` / `API_SCOPE_DESCRIPTIONS`, `TOKEN_TTL_OPTIONS` and `LOG_RETENTION_OPTIONS`, the warranty lead-time bounds. And `DEFAULT_ASSET_STATUSES` (what a fresh instance is seeded with, and the audit renderer's fallback) plus `ASSIGNED_STATUS`, the one status slug either app may name.
- `src/rbac.ts` — `ACTIONS` (everything mutating or admin-only), `ACTION_LABELS`, `ACTION_GROUPS` (the matrix's five bands, partitioning `ACTIONS` exactly — a test pins it), `DEFAULT_ROLES` (the seed), `ADMIN_ROLE` (the one role id either app may name) and `can(permissions, action)` — the one question API guards and UI affordances both ask, over the resolved grant set.
- `src/attachments.ts` — the file policy: `ATTACHMENT_EXTENSIONS`, `isAllowedAttachment` (case-insensitive), `ATTACHMENT_ACCEPT` (derived for a file input) and the upload-quota bounds. **SVG is deliberately absent.**
- `src/audit-render.ts` — the **one** renderer turning `{action, params}` into a sentence, for the per-asset trail, the activity log and the CSV export alike. Every audited action needs a renderer (a test refuses one that renders its own slug), and a sentence can only say what its `params` carry — audit what the sentence needs.
- `src/notification-render.ts` — `renderNotification`, the inbox's equivalent: one renderer per notification kind, `param()` throwing when a writer left a required param out. See [`docs/recipes/add-notification-kind.md`](../../docs/recipes/add-notification-kind.md).
- `src/csv.ts` — `toCsv`/`csvField`, RFC 4180 quoting (asset names contain commas and `"`).
- `src/money.ts` — `parsePriceToCents`, the single reader of typed money ("€ 2,340.00", "1.299,00"), used by the asset form and the CSV import validator. Integer arithmetic on the digits; never multiply a float by 100.
- `src/slug.ts` — `slugify`, shared by `statusSlug` and `roleSlug` so the derivation is one rule.
- `src/schemas/` — the zod contracts. A field change starts here and ripples: schema → migration → API → forms/tables → CSV → export.
  - `common.ts` holds the shared builders: `email` (lowercased), `nullableText(max)`, `nullableDate` (blank means NULL). Build new fields from them.
  - **A create gives optional fields `.default(null)`; a patch leaves them `.optional()`** — absent means "leave alone", explicit `null` means "clear it", and services rely on it (`if (!(field in patch)) continue`).
  - `workflow.ts` / `roles.ts` — the status and role contracts and `statusSlug` / `roleSlug`, which derive a permanent id once.
  - `import.ts` — the CSV vocabulary the template, the wizard's auto-matcher and the validator agree on, and `matchEnumValue` (labels or slugs, over a compile-time map or a workspace's own `{value, label}[]`). Parsing is not here: the browser parses and sends canonical rows.
- `src/types/` — the named shapes both apps import, re-exported through `src/index.ts`: `ApiErrorEnvelope` (the one error envelope), `AuditParams`, `WorkflowPayload`, `RolesPayload`, `NotificationsPayload`, … Zod-inferred types stay beside their schemas.

## The enum pattern

```ts
export const ASSET_CATEGORIES = [...] as const;       // slugs, stored as-is
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];
export const ASSET_CATEGORY_LABELS: Record<AssetCategory, string> = {...};  // exact UI copy
export const EMPLOYEE_STATUS_COLORS: Record<EmployeeStatus, SemanticColor> = {...}; // where there is a colour
```

- **No CHECK constraints** on enum columns, deliberately: a new value is code-only, and the `Record` types force every map to stay complete. `enums.test.ts` pins the copy and colours — update it with intent.
- **A value the product decides is an enum; a value a workspace decides is a table.** Statuses and roles crossed that line and are rows, edited in the app. Which _actions_ exist stays compiled in (a route needs something to be guarded with); which roles hold them does not. `ADMIN_ROLE` and `ASSIGNED_STATUS` stay named because they are the rows a workspace cannot edit.
- `TOKEN_TTL_OPTIONS` and `LOG_RETENTION_OPTIONS` are numbers with `null` meaning a choice (Unlimited, Forever), their label maps keyed by `` `${…}` `` so `null` is checked too.
- **`API_SCOPES` is not `ACTIONS` and must not become it**: a member's reads are open, a token's must be granted by name. Members, roles, settings and two-factor are absent on purpose.
- **Not everything with a few values is an enum.** If the code never branches on it (the warranty lead time), it is a bounded number with a message, not a label map.

## Rules

- **Never let an app define its own copy** of a label, colour or permission — import it from here.
- **The `??`s here are domain rules, each commented**: an unknown status, role, action or notification kind renders as itself (a log that hides events is worse than an ugly one). Anywhere a value should have been there, throw.
- `sv` keys are one of `ok|acc|warn|err|info|neut`.
- **Relative imports only** — this package is consumed as raw source, so a `@/` would resolve against the consumer. **Nothing here imports from the apps.**
- **zod is the one runtime dependency**, declared here and pinned to the range `apps/api` uses (`^4.4.3`), so hoisting cannot pick a version nobody chose. A second one ships in both apps — say why in the PR.
