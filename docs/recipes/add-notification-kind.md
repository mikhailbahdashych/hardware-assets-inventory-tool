# Add a notification kind

Worked example: **`return.escalated`** — when a return is a week overdue, tell whoever may check assets in, so a holder with no member account (who hears nothing today) is still chased. It is scheduled and operational; the hand-over notice, `assignment.received`, is the precedent for a notice written by a mutation, and step 3 covers both.

There is no email: a notice is a row in `notifications`, one per recipient member, rendered into a sentence by the browser. `apps/api/CLAUDE.md`, "The inbox", is the background.

---

## 1. The sentence — `packages/shared/src/notification-render.ts`

A kind is a dotted string (`area.event`) and a key in `RENDERERS`; its params are a flat `NotificationParams` record. There is no per-kind params type — **the renderer's `param()` calls are the contract**, and each one throws, naming the kind and the key, when a writer left it out:

```ts
'return.escalated': (n) =>
  `${tagged(n)} is a week overdue from ${String(param(n, 'holderName'))} (due ${day(param(n, 'date'))})`,
```

- **Params are a snapshot**, like an audit event's: the asset's name and tag and the holder's name as they were, never an id to look up later. A renamed asset must not rewrite what a notice said.
- Reuse `tagged()` for the asset ("AST-0007 · iPad") and `day()` for a date, so every notice reads alike and none depends on the browser's locale.
- An unknown kind renders as its own slug, deliberately — an inbox that hid rows would be worse than an ugly one — so a kind you later remove still shows in old inboxes.
- `packages/shared/src/notification-render.test.ts`: add the sentence to "renders every kind", and a missing-param case beside the others.

## 2. Who hears it — `apps/api/src/services/notifications.ts`

Two audiences, one function each. Choose by what the notice is about, never by a role name:

| Audience        | Call                                             | Reaches                                                                                                                                  |
| --------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Personal**    | `notifyLinkedMember(db, employeeId, input, now)` | The member account linked to that employee. No link, no row — employees do not sign in.                                                  |
| **Operational** | `notifyActionHolders(db, action, input, now)`    | Every **active** member whose role grants the action (Admin always), so a role a workspace invents inherits the audience with the grant. |

`return.escalated` is operational: `notifyActionHolders(db, 'assets.checkin', …)`.

## 3. Where it is written

### From a mutation — inside its transaction

Call it with `tx`, beside `writeAudit`, as `handOver` in `services/assignments.ts` does for `assignment.received`. A notice written outside the transaction can claim something a rollback undid, and nothing inside a transaction may touch `deps.db`. No `dedupeKey`: every such event is its own notice (NULL keys may repeat).

### From a schedule — a job

1. **The job** — a plain function of `(deps, now)` in `apps/api/src/services/jobs.ts`, returning a `JobResult`, so every rule is testable with a fixed date. "Today" is `dayOf(now)` (UTC). Read the switch first (step 4) and return `skipped()` when it is off.
2. **The dedupe key** — required. The unique `(member_id, dedupe_key)` index plus `notify`'s `onConflictDoNothing` is what makes a re-run (or a restart) write nothing new. Key on the subject **and on the fact that should re-arm it**: `escalate:{assignmentId}:{expectedReturnDate}` notifies once, and again only if the date is changed. Compare `warranty:{assetId}:{warrantyUntil}` and `return:{assignmentId}:{date}:{due|overdue}`.
3. **The schedule** — an entry in `SCHEDULE` and a `task(…)` in `apps/api/src/services/scheduler.ts`. Times are the container's `TZ`; a missed run is skipped, not queued.
4. **The prune** — `runMaintenance` deletes every inbox row older than 90 days, whatever its kind, and **a deleted row frees its key**. A condition that stays true longer than that notifies again once its row is pruned. Keep the key's window inside 90 days, or put something in the key that changes.
5. **Tests** — `apps/api/test/jobs.test.ts`, with fixed dates: who receives it and who does not, a second run writes nothing, a changed fact re-arms it, the switch turns it off.

## 4. The Settings switch — if a workspace should be able to turn it off

Reuse an existing switch only when it honestly means the same thing; `returnReminders` is described as reminding _holders_, so `return.escalated` gets its own. A new one is:

- A boolean column on `org_settings` in `apps/api/src/db/schema.sqlite.ts` **and** `schema.pg.ts`, default `true`, then both migrations (`npm run db:generate -w apps/api` and `db:generate:pg`).
- The key in `settingsPatchInput` (`packages/shared/src/schemas/settings.ts`) and in `EDITABLE` in `apps/api/src/services/settings.ts`, which is what audits a change to it.
- On the web: `OrgSettings` in `apps/web/src/types/api.ts`, the draft and its key loop in `features/admin/settingsDraft.ts`, the `NotificationToggleKey` union in `features/admin/types/settingsPanel.ts`, and a row in `NOTIFICATION_TOGGLES` in `SettingsPanel.tsx` — its description says who hears it.

## What updates itself

The bell's unread count, the `/notifications` page and its paging all render through `renderNotification`, so a new kind needs no component. Inventory writes already refresh the inbox (`['notifications']` is in `INVENTORY_PREFIXES` in `apps/web/src/api/invalidate.ts`); a notice written by an admin-side mutation needs that prefix in `ADMIN_PREFIXES` too.

## The step people forget

**The dedupe key on a scheduled kind.** Without one every run writes the notice again — a fresh row in every recipient's inbox every morning — and nothing fails: the job's own test passes on the first run. Write the "second run writes nothing" test before the job.
