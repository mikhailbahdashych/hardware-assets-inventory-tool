# Add a dashboard widget

Worked example: **Assets by location**, a card people can turn off like the other five.

---

## 1. The data — `apps/api/src/services/dashboard.ts`

The whole dashboard is **one request**: the widgets read the same few tables, and toggling one off should not change how many round trips the page makes. Add your numbers to `dashboardPayload` rather than adding an endpoint.

```ts
// beside the other reads in dashboardPayload
const locationRows = await db
  .select({ location: assets.location, count: count() })
  .from(assets)
  .groupBy(assets.location);

return {
  // …
  locationCounts: locationRows,
};
```

Two rules from `apps/api/CLAUDE.md` ("Two engines, one boundary") that this query would otherwise break on PostgreSQL:

- **Await the builder; never end on `.all()`, `.get()` or `.run()`.** Those terminals exist only on the SQLite driver — on PostgreSQL they compile and then throw.
- **Count with drizzle's `count()`, not a raw `` sql<number>`count(*)` ``.** node-postgres hands a raw count back as a string, so the widget would add `"3"` to `"4"`; `count()` (already imported in `dashboard.ts`) maps it to a number on both engines.

And keep the `await` on every read: a builder without one is a truthy object that never ran, and no lint rule sees it inside an object literal.

Add the shape to `DashboardPayload` in `apps/api/src/types/dashboard.ts` and mirror it in `apps/web/src/types/api.ts`.

**Carry the zeros** where the design draws a fixed set of rows — the status tiles and the category bars both do, because an empty status is information and a widget that reshapes as data changes is hard to read.

## 2. The widget registry — `apps/web/src/features/dashboard/widgets.ts`

```ts
{ key: 'locations', label: 'Assets by location', description: 'Where the fleet lives' },
```

That entry in `DASHBOARD_WIDGETS` gives you the row in the Customize modal and the visibility check. `isWidgetVisible` treats a key nobody has touched as **visible**, so the stored map records only what somebody switched off — which is why a widget added in a later release appears for everyone instead of hiding until they go and find it.

## 3. The card — `apps/web/src/features/dashboard/DashboardPage.tsx`

Write a component beside the others and place it in the layout:

```tsx
{
  shows('locations') && <LocationBars data={dashboard.data} />;
}
```

The two columns are `1.35fr 1fr`; the left holds the wide cards and the right the lists. Cards use `styles.card`, a `<h2 className={styles.cardTitle}>` and the row patterns already in `Dashboard.module.css` — the design's paddings live there and should not be re-derived.

Anything that is a proportion gets `role="meter"` with `aria-valuenow`, like the category bars: it makes the value readable rather than only visible, and it is what the tests assert against.

## 4. Empty state

Say what an empty widget means, in a sentence:

```tsx
{
  data.locationCounts.length === 0 && <p className={styles.blank}>No locations recorded yet.</p>;
}
```

A card that renders nothing looks broken; a card that says why does not.

## 5. Tests — `apps/web/src/features/dashboard/dashboard.test.tsx`

Add the numbers to `DASHBOARD` in `src/test/api-stub.ts`, then assert the card renders, that hiding it through the Customize modal `PATCH /me/prefs` with the right key, and that it comes back.

Find the card by **heading**, not by text: the Customize modal lists the same names, and `getByText` would match the toggle instead.

## The step people forget

**Check it wrapped.** The status tiles are `repeat(auto-fill, minmax(148px, 1fr))` in `Dashboard.module.css`, because a workspace can add statuses on the Workflow page — so nothing on the dashboard has a fixed number of tracks. Look at the page at 1440×900 with eight statuses before shipping, in both themes.

And if the widget shows something a role may not read, gate it twice: the API answers `null` for it (as `recentActivity` does without `audit.view`), and `CustomizeWidgetsModal.tsx` stops offering its toggle.
