# Add a page

Worked example: a **Locations** section — a nav entry, a server-paged list and a detail page. The reference that exists is **Employees**: `apps/web/src/features/employees/EmployeesPage.tsx` on the web side, `apps/api/src/modules/employees.ts` and `services/employees.ts` on the API. Open them beside this file; every step below is a shape they already have.

---

## 1. The API — `apps/api/src/modules/locations.ts` + `services/locations.ts`

Thin routes in the module, anything transactional in the service, and `registerLocationRoutes(app, deps)` wired into `apps/api/src/app.ts` beside the others.

```ts
typed.get(
  '/api/v1/locations',
  { schema: { querystring: listQuery }, preValidation: requireAuth },
  async (request) => listLocations(deps.db, request.query),
);

typed.post(
  '/api/v1/locations',
  { schema: { body: locationCreateInput }, preValidation: requireAction('locations.create') },
  async (request) => ({ location: await createLocation(deps, request.member!, request.body) }),
);
```

- **Every guard is a `preValidation`**, so an anonymous caller meets 401 before the schema ever reads their body. Reads take `requireAuth`; anything that changes data takes `requireAction('<action>')`, declared in `packages/shared/src/rbac.ts` — [`add-permission-action.md`](add-permission-action.md) is that change end to end. `test/internal-surface-fence.test.ts` knocks on the new routes by itself.
- **A list that can grow is paged on the server.** `listQuery` from `src/lib/search.ts` validates `q`, `limit` (default 50, max 200) and `offset`; the service answers the page plus `total`, which counts the rows behind the search and nothing else:

  ```ts
  export const LOCATION_SEARCH_FIELDS = [locations.name, locations.site];

  export async function listLocations(db: Db, query: ListQuery) {
    const search = containsAny(query.q, LOCATION_SEARCH_FIELDS);
    const rows = await db
      .select()
      .from(locations)
      .where(search)
      .orderBy(asc(locations.name), asc(locations.id)) // total: id breaks every tie
      .limit(query.limit)
      .offset(query.offset);
    const [total] = await db.select({ value: count() }).from(locations).where(search);
    // A count query always answers one row; the ! says so.
    return { locations: rows.map(serializeLocation), total: total!.value };
  }
  ```

  Search goes through `contains` / `containsAny`, never a raw `LIKE` (it behaves differently on the two engines). The order must be total, or a row repeats or vanishes at a page boundary. A small list nobody scrolls — API tokens — may skip paging, deliberately.

- **Every mutation writes its audit event in the same transaction** (`writeAudit`), and every audited action needs a renderer in `packages/shared/src/audit-render.ts`; its test asserts each one renders something other than its slug.

## 2. Reading it — `apps/web/src/api/queries.ts`

The key goes into `queryKeys` **first**, and it carries every parameter, so each page and search is its own cache entry under one prefix:

```ts
locations: (params: ListParams) => ['locations', params] as const,

export function useLocations(params: ListParams) {
  return useQuery({
    queryKey: queryKeys.locations(params),
    queryFn: () => apiFetch<LocationsPayload>(`/locations?${listParams(params)}`),
    placeholderData: (previous) => previous, // the table stays up while the next page loads
  });
}
```

`LocationsPayload` and `Location` go in `apps/web/src/types/api.ts`. Writes go in `api/mutations.ts` and invalidate through `invalidateInventory` or `invalidateAdmin` in `api/invalidate.ts` — add `['locations']` (and `['location']` for the detail page) to the prefix list there rather than hand-picking keys in a mutation.

## 3. The page — `apps/web/src/features/locations/LocationsPage.tsx`

Follow `EmployeesPage.tsx` line for line. What it does, and why each piece is there:

| Piece                                                   | Why                                                                                                                           |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `?q=` in the URL via `setParam` (`@/lib/searchParams`)  | A filtered view is a link, and Back works.                                                                                    |
| `useDebouncedValue(query)`                              | One request when the typing stops, not one per keystroke.                                                                     |
| `usePage(debounced)`                                    | Back to page one when the **settled** search changes; `clampTo(total, size)` steps back from a page the list no longer fills. |
| `usePageSize('locations', LIST_PAGE)`                   | Rows per page is the reader's, kept per list in `localStorage` (safely: blocked storage means the default).                   |
| `ListToolbar`, `SearchInput`, `DataTable`, `Pagination` | The design's list, its footer count from `total`, and the pager with its "Rows per page" selector.                            |

Then the three states, in this order — the rule in `apps/web/CLAUDE.md`, "A query has three states":

```tsx
{locations.isError ? (
  <Card padding={false}>
    <ErrorState error={locations.error} onRetry={() => void locations.refetch()}>
      The location list could not be loaded.
    </ErrorState>
  </Card>
) : !locations.isSuccess ? (
  <Spinner size={18} />
) : (
  <>
    <DataTable rows={locations.data.locations} footer={`${locations.data.total} locations`} … />
    <Pagination page={page} pageCount={pageCount} onChange={setPage} rowsPerPage={…} />
  </>
)}
```

`isSuccess`, not `isPending`, is what makes `data` defined in the last branch — so there is nothing to coalesce, and `locations.data ?? []` there is a bug. Columns get a `width` each; every `fr` column takes a `minmax(<px>, …)` floor so a narrow window scrolls the table rather than squeezing a column to nothing, and a row-actions column carries `sticky: 'end'`. `PageContainer` widths: 1060 for most pages (Employees included), 1160 for the assets list, 960 for Members, 760 for the inbox.

## 4. The route — `apps/web/src/routes.tsx`

Inside the signed-in shell block:

```tsx
<Route path="/locations" element={<LocationsPage permissions={permissions} />} />
<Route path="/locations/:id" element={<LocationDetailPage permissions={permissions} />} />
```

A page not everybody may open is gated **here**, the way `/workflow` is — `can(permissions, 'locations.manage') ? <LocationsPage …/> : <Navigate to="/dashboard" replace />`. A hidden nav item hides the door without locking it. `permissions` is the set `/auth/me` resolved; nothing downstream knows what a role is called.

## 5. The nav entry — `apps/web/src/components/app/nav.ts`

The sidebar is two named landmarks. Inventory work goes in `INVENTORY_ITEMS`; managing the workspace goes in `WORKSPACE_ITEMS`:

```ts
{ label: 'Locations', to: '/locations', icon: 'mapPin', requires: 'locations.view', keywords: ['sites'] },
```

`requires` hides it from anybody whose role lacks the action (or `adminOnly: true`, for the one page gated on the role itself — never both). Add `locations: 'Locations'` to `SECTION_LABELS` in the same file for the breadcrumb. A missing icon goes into `components/ui/Icon.tsx` in the same Feather style at stroke 1.7 — no icon library.

**The command palette follows by itself**: its Pages group is the sidebar's items through the same permission filter, and `keywords` are the other words it finds the page by. A palette **command** — "New location", opening a modal — is an `ActionDefinition` in `components/app/palette.ts`, with its own `requires`.

## 6. Tests

- `apps/api/test/locations.test.ts` — `buildTestApp()` and `app.inject`: the happy path, `total` under a search, the 403 for a role without the action, and the delete guard.
- `apps/web/src/features/locations/locations.test.tsx` — the real client against `src/test/api-stub.ts`: the rows, the error state when the stub answers 500, and a second page.
- `apps/web/src/components/app/nav.test.ts` — the item appears for the right permissions, and the section stays active on its detail page.

## The step people forget

**The invalidation prefix.** A list whose key is not in `api/invalidate.ts` keeps showing what it showed before the write — the mutation succeeds, the toast says so, and the table disagrees until a reload. Add the prefix with the page, not after the first bug report.
