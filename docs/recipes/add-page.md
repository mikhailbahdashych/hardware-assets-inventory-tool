# Add a page

Worked example: a **Locations** section with its own nav entry, list page and detail page.

---

## 1. The route — `apps/web/src/routes.tsx`

Inside the signed-in `<Route element={<AppShell …>}>` block:

```tsx
<Route path="/locations" element={<LocationsPage permissions={permissions} />} />
<Route path="/locations/:id" element={<LocationDetailPage permissions={permissions} />} />
```

`routes.tsx` holds the whole map and its guards, and picks one of three route sets from instance and session state. A page not everybody may open goes behind `can(permissions, '…')` the way `/activity`, `/workflow`, `/roles` and `/admin` do — never behind a hidden nav item alone, which hides the door without locking it. `permissions` is the set `/auth/me` resolved for this request; nothing downstream knows what a role is called.

## 2. The nav entry — `apps/web/src/components/app/nav.ts`

```ts
{ label: 'Locations', to: '/locations', icon: 'mapPin' },
```

and add `locations: 'Locations'` to the breadcrumb map below it. `requires: '<action>'` on the entry hides it from anybody whose role does not grant that action; `gapBefore: true` is the design's 10px separation, which only Admin has.

If the icon does not exist yet, add its path to `components/ui/Icon.tsx` in the same Feather style at stroke 1.7. Do not add an icon library.

## 3. The page — `apps/web/src/features/locations/LocationsPage.tsx`

```tsx
export function LocationsPage({ permissions }: LocationsPageProps) {
  const locations = useLocations();
  return (
    <PageContainer maxWidth={1160}>
      <ListToolbar title="Locations" permissions={permissions}>
        {can(permissions, 'locations.create') && <Button icon="plus" …>Add location</Button>}
      </ListToolbar>
      {/* SearchInput, DataTable, EmptyState — see AssetsPage */}
    </PageContainer>
  );
}
```

`PageContainer` carries the design's padding and max width: 1160 for lists, 1060 for detail and admin, 960 for members. `DataTable` builds its `grid-template-columns` from the `width` on each column — copy the shape from the nearest existing list rather than inventing widths. `AssetsPage.tsx`'s `COLUMNS` is the reference: a `minmax(210px, 1.6fr)` first column that can breathe, then fixed pixel widths for everything a person scans down.

**Filters belong in the URL** (`useSearchParams` + `setParam` from `@/lib/searchParams`), so a filtered view is a link and the back button works.

## 4. Reading data — `apps/web/src/api/queries.ts`

Add the key to `queryKeys` **first**, then the hook:

```ts
locations: ['locations'] as const,

export function useLocations() {
  return useQuery({
    queryKey: queryKeys.locations,
    queryFn: async () => (await apiFetch<{ locations: Location[] }>('/locations')).locations,
  });
}
```

Writes go in `api/mutations.ts` and invalidate through `invalidateInventory` (or `invalidateAdmin`) rather than hand-picking keys — see the note in `api/invalidate.ts` for why.

## 5. The API side

A module in `apps/api/src/modules/locations.ts` with thin routes, a service in `apps/api/src/services/locations.ts` holding anything transactional, and `registerLocationRoutes(app, deps)` wired into `apps/api/src/app.ts`.

Guard every mutating route with `requireAction('<action>')`, and declare that action in `packages/shared/src/rbac.ts` — the same list the UI's `can()` reads, which is what keeps the button and the endpoint from disagreeing. [`add-permission-action.md`](add-permission-action.md) is that change end to end; which _roles_ hold the action is workspace data, edited on **Roles**, so there is nothing to migrate.

**Every mutation writes its audit event in the same transaction** (`writeAudit`), and every audited action needs a renderer in `packages/shared/src/audit-render.ts`. The test there asserts each one renders something other than its own slug.

## 6. Tests

- `apps/api/test/locations.test.ts` — `buildTestApp()` and `app.inject`, covering the happy path, the permission guard and the delete guard.
- `apps/web/src/features/locations/locations.test.tsx` — drive the real client through `src/test/api-stub.ts`, as the other features do.
- `apps/web/src/components/app/nav.test.ts` — the section is active on its detail page too.

## The step people forget

**The command palette.** It searches assets and employees; a new section is not in it until you say so. `apps/web/src/components/app/palette.ts` is pure data — add a group in `paletteGroups`, and an entry to `ACTIONS` if there is a modal worth opening. It is the difference between a page people navigate to and a page people find.
