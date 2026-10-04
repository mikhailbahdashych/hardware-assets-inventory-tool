# Add a field to assets

Worked example: a `macAddress` column, visible on the form, the detail page, the CSV import and the export.

**First ask whether it should be a custom field instead.** The **Custom fields** page (`/custom-fields`, in the sidebar's Workspace half) adds a text, yes/no, date or number field with no code at all, and it appears on every asset form immediately. Do this recipe only when the field needs to be _queryable_, appear in the assets **table**, or take part in validation — a MAC address that must be unique, say, rather than one somebody types into a note.

---

## 1. The wire contract — `packages/shared/src/schemas/assets.ts`

Both the create and the patch shape, because they differ on purpose:

```ts
export const assetCreateInput = z.object({
  // …
  macAddress: nullableText(17).default(null), // absent means NULL
});

export const assetPatchInput = z.object({
  // …
  macAddress: nullableText(17).optional(), // absent means "leave alone"
});
```

`nullableText` from `./common.js` trims and turns `""` into `null`, so a blank input never reaches a column as an empty string. That distinction between `.default(null)` and `.optional()` is what lets a patch tell "don't touch this" apart from "clear it" — the API relies on it.

## 2. The column — `apps/api/src/db/schema.sqlite.ts` **and** `schema.pg.ts`

One logical schema, written twice — `schema.ts` is what services import, not what you edit, and `test/schema-parity.test.ts` fails if you change one and forget the other.

```ts
export const assets = sqliteTable('assets', {
  // …
  macAddress: text('mac_address'),
});
```

Then generate **both** migrations and check them in:

```bash
npm run db:generate -w apps/api      # → src/migrations/
npm run db:generate:pg -w apps/api   # → src/migrations-pg/
```

Read the SQL each wrote. Never edit a migration that has been merged — add another.

## 3. The service — `apps/api/src/services/assets.ts`

Add the field to the `EDITABLE` list. That one array drives the diffing, so the field is written, and an edit to it produces an `asset.updated` audit event naming it — nothing else to do.

Add it to the `tx.insert(assets).values({…})` in `createAsset` too.

## 4. Its name in the log — `packages/shared/src/audit-render.ts`

`FIELD_LABELS` maps a column to the words the form uses. Without an entry, `macAddress` is humanized to "mac address", which is fine here; add one when the automatic version reads badly (`employeeCode` → "employee ID").

## 5. The form — `apps/web/src/features/assets/AssetFormModal.tsx`

Add it to `AssetFormState` (`features/assets/types/assetFormModal.ts`), `EMPTY` and `fromAsset`, render a `<Field>` with an `<Input>`, and include it in the object passed to `create.mutate` / `update.mutate`. Follow `serialNumber` — it is the same shape of field.

## 6. The wire type — `apps/web/src/types/api.ts`

Add `macAddress: string | null` to `Asset`. The compiler will now point at anything that destructures an asset and has not been told.

## 7. Where it shows

- **Detail page** (`AssetDetailPage.tsx`): a `KeyValueRow` in the Details card. Use `?? '—'` — the design's em dash for an empty cell is a rule, and a comment saying so keeps it from looking like a rescue.
- **Table** (`AssetsPage.tsx`): only if it earns a column. The grid template comes from the design; adding a column means deciding what shrinks.
- **Search** happens on the server: add the column to `ASSET_SEARCH_FIELDS` in `apps/api/src/services/assets.ts`, if people would search by it. The assets list and the command palette's `GET /search` both read that one array, so they cannot disagree about what "found" means. Serial number is the precedent.

## 8. CSV — `packages/shared/src/schemas/import.ts`

Add `column('mac_address')` to `ASSET_IMPORT_COLUMNS`, and a cell in the same position to each row `assetTemplateRows` returns, so the template stays valid. Then read it in `apps/api/src/services/import-validator.ts`:

```ts
macAddress: orNull(cell(row, 'mac_address')),
```

and add it to `PlannedAsset` in `apps/api/src/types/import.ts` and to the insert in `services/import.ts`.

The export needs nothing: `workspaceExport` selects whole rows, so a new column is in it the moment the schema has it.

## 9. The public API — nothing to write, three things to check

`/api/public/v1` takes the same `assetCreateInput` / `assetPatchInput` and answers through the same `serializeAsset`, which spreads the whole row — so the field is on the public surface, and in its OpenAPI document, the moment steps 1–3 land. That surface is a promise to integrators rather than the SPA's private contract, so mean it:

- If a route's prose in `apps/api/src/modules/public.ts` names body fields, keep it true — `apps/api/test/openapi.test.ts` fails when the prose names a field the body does not have.
- **Recapture `apps/web/src/test/openapi.json`** from a dev server (`curl -s localhost:5173/api/public/openapi.json`, then prettier — see `OPENAPI_SPEC` in `src/test/api-stub.ts`), so the API reference page's tests run against the document as it now is.
- `apps/api/test/public-api.test.ts` — add the field to a create through a token if it carries a rule (uniqueness, a format) the integration should meet.

## 10. Tests

Add cases where the existing ones live, which is also how you find anything missed:

- `packages/shared/src/schemas/assets.test.ts` — create vs patch semantics.
- `apps/api/test/assets.test.ts` — it round-trips, and an edit audits it.
- `apps/api/src/services/import-validator.test.ts` — a row carrying it plans correctly.
- `apps/web/src/features/assets/assets.test.tsx` — it reaches the API from the form.

## The step people forget

**The CSV template.** `csvTemplate()` builds it from the same column list the validator reads, so the header row updates itself — but the example rows in `assetTemplateRows` are literal, and a row with the wrong number of cells makes a template that fails its own import. The test in `packages/shared/src/schemas/import.test.ts` catches it.
