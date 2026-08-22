# Add a dashboard widget

Worked example: **Assets by location**, a card people can turn off like the other five.

---

## 1. The data — `apps/api/src/services/dashboard.ts`

The whole dashboard is **one request**: the widgets read the same few tables, and toggling one off should not change how many round trips the page makes. Add your numbers to `dashboardPayload` rather than adding an endpoint.

```ts
locationCounts: await db
  .select({ location: assets.location, count: sql<number>`count(*)` })
  .from(assets)
  .groupBy(assets.location)
  .all(),
```

**Keep the `await`.** Drizzle's builders are thenables, so a query without one still compiles and still hands the widget a truthy object — it just never ran. `no-floating-promises` catches the statement form; an object property like this one is caught by nothing but the eye, which is why it is written down here.

Add the shape to `DashboardPayload` in `apps/api/src/types/dashboard.ts` and mirror it in `apps/web/src/types/api.ts`.

**Carry the zeros** where the design draws a fixed set of rows — the status tiles and the category bars both do, because an empty status is information and a widget that reshapes as data changes is hard to read.

## 2. The widget registry — `apps/web/src/features/dashboard/widgets.ts`

```ts
{ key: 'locations', label: 'Assets by location', description: 'Where the fleet lives' },
```

That single entry gives you the row in the Customize modal and the visibility check. `isWidgetVisible` treats a key nobody has touched as **visible**, so the stored map records only what somebody switched off — which is why a widget added in a later release appears for everyone instead of hiding until they go and find it.

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

**The KPI grid no longer counts.** It was `repeat(6, 1fr)` — one column per asset status — until a workspace could invent a seventh status from the Workflow page, so `Dashboard.module.css` says `repeat(auto-fill, minmax(148px, 1fr))` and the row wraps on its own. A tile you add joins that flow rather than a fixed track, which means the thing to check is what it looks like _wrapped_: eight tiles at 1440×900, the width the app is designed for, before shipping.
