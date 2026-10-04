# Add an API scope or a public route

Worked example: a token that may read **Locations** — a `locations:read` scope and `GET /api/public/v1/locations`. Skip step 1 when an existing scope already covers the route.

`/api/public/v1` is the surface other systems build against, so it is a promise in a way `/api/v1` is not: the internal API is the SPA's private contract and changes with a screen. Add the internal route first ([`add-page.md`](add-page.md) step 1); the public one is a second door onto the **same** service. `apps/api/CLAUDE.md`, "The public surface", is the reasoning behind every rule below.

---

## 1. The scope — `packages/shared/src/enums.ts`

Three edits, and the `Record` types refuse to compile until all three are there:

```ts
export const API_SCOPES = [
  // …
  'locations:read',
] as const;

export const API_SCOPE_LABELS: Record<ApiScope, string> = {
  // …
  'locations:read': 'Read locations',
};

export const API_SCOPE_DESCRIPTIONS: Record<ApiScope, string> = {
  // …
  'locations:read': 'List and read locations.',
};
```

- **Coarse `area:verb` pairs, and reads are named too.** A member's reads are open and only their mutations are declared (`ACTIONS`); a token has no such baseline, so every read it may perform is granted by name. Scopes are deliberately not `ACTIONS`.
- **Never an account or security area.** Members, roles, settings and two-factor stay humans-only whatever a token holds; `packages/shared/src/enums.test.ts` refuses those areas, and pins the list itself — add the new scope to its expectation.
- The token form (`ApiTokenFormModal.tsx`) files a scope under "Reading" or "Changing things" by its `:read` suffix, and `POST /api-tokens` accepts it through `z.enum(API_SCOPES)` — nothing to change there. **An existing token never gains a scope**: there is no edit, so an integration that needs it is given a new token.

## 2. The route — `apps/api/src/modules/public.ts`

Inside `registerV1`, under a `// ---- locations:read ----` banner like the others:

```ts
typed.get(
  `${V1}/locations`,
  documented(
    'locations:read',
    'locations',
    'List locations',
    'One page of locations, by name. Answers `{locations, total}`.',
    { querystring: listQuery },
  ),
  async (request) => listLocations(deps.db, request.query),
);
```

- **`documented(scope, tag, summary, returns, schema)` is the only way to declare one.** It returns the schema with its manual entry and `preValidation: requireScope(scope)` from a single naming of the scope, so the sentence an integrator reads ("Requires the `locations:read` scope.") and the door they meet cannot disagree. A route registered without it is simply open — the Bearer plugin attaches a token and never refuses.
- **A new area needs a tag.** Add `{ name: 'locations', description: … }` to `TAGS`; `PublicTag` is derived from that array, so `documented` will not accept a tag that is missing from it. `/api-docs` titles the section from the slug.
- **Schemas are lifted, never copied.** Import the exact zod schema the internal route validates with — from `@inventory/shared`, or from the service or `lib/` module that owns it. If the internal route declares one inline, move it somewhere both can import (that is why `assetListQuery` lives in `lib/search.ts`). A forked schema is two answers to one request.
- **Thin handler, same service, same serializer** as the internal twin. A public route that computes anything of its own is a second implementation of the product.
- **`returns` is prose, and names only what is true.** There are no response schemas on purpose — fastify would serialize _through_ one and drop whatever it forgot. Name only fields the body really has. A delete answers 204 and declares `response: { 204: noBody }`, so the manual does not claim a 200.
- **A mutation passes `actorOf(request)`** to the service: an actor with `id: null`, the token's name, and its `apiTokenId`. That is what makes every audit row it writes — side effects included — read as the token, with `actor_kind = 'token'`. Never build an actor by hand.
- **A rule that crosses scopes** is checked in the handler with `missingScope(…)`, the way creating an asset as `assigned` needs `assignments:write` beside `assets:write`.

## 3. The API tests

- `apps/api/test/public-api.test.ts` — the happy path with a token holding the scope, 403 `missing_scope` for a token without it (add the route to the `closed` list in "keeps each area behind its own scope"), and for a mutation, **add the call to the `calls` list in "attributes every row a mutating route writes"**.
- Nothing to add, and both will fail if step 2 was skipped: `public-surface-fence.test.ts` requires every route under `/api/public/` to answer an anonymous caller 401 `invalid_token`, and `openapi.test.ts` requires every operation to carry a tag, a summary, the Bearer requirement and a sentence naming a real scope, and its prose to name only real body fields. Both read the registered route table, so a new route is in their expectation the day it exists.

## 4. The web

**Recapture `apps/web/src/test/openapi.json`.** With `npm run dev` up:

```bash
curl -s localhost:5173/api/public/openapi.json > apps/web/src/test/openapi.json
npx prettier --write apps/web/src/test/openapi.json
```

`apiDocs.test.tsx` renders every operation in that file, so the capture is what the API reference page is tested against. Never edit it by hand.

The rest updates itself: `/api-docs` renders the live document — the new section, its scope pill in `API_SCOPE_LABELS` words, an example request derived from the zod schema — and `e2e/tests/overview.spec.ts` walks the live document too, so a stale capture cannot hide a missing route. The token form shows the new checkbox.

## The step people forget

**The attribution sweep is a list somebody types.** The fence and the OpenAPI test discover routes on their own; the test proving that a token's writes are logged as the token does not. A mutating public route missing from its `calls` list is a route whose audit rows nobody checks — and a service that drops `apiTokenId` on the way to `writeAudit` writes rows claiming the token's name with nobody behind them.
