# Add an email

Two kinds, and the difference decides everything else:

- **Transactional** — somebody pressed a button. It cannot repeat, so it is not deduped.
- **Scheduled** — a clock fired. It _can_ repeat, so it goes through `notification_log`.

Worked example of each: "an asset you hold was retired" (transactional) and "assets nobody has touched in a year" (scheduled).

---

## Both kinds start with a template

`apps/api/src/services/mail-templates.ts`, as a pure function returning `{ subject, text, html }`:

```ts
export function staleAssetsEmail(input: StaleAssetsMail): MailContent {
  const intro = `${input.assets.length} devices in the ${input.orgName} inventory have not moved in a year.`;
  return {
    subject: `Untouched devices: ${input.assets.length}`,
    text: `${intro}\n\n${lines.join('\n')}\n\nOpen the inventory:${linkLine(input.url)}`,
    html: layout(
      input.orgName,
      para(intro) + list(lines) + button(input.url, 'Open the inventory'),
    ),
  };
}
```

Its input shape goes in `apps/api/src/types/mail-templates.ts`. Three rules the tests enforce for every template:

- **Plain text first.** It is the version that always arrives readable, and the URL must appear in it as text — nothing is clickable there.
- **Name the workspace** in the subject or the text. Somebody may hold devices from two of these.
- **No unfilled slot.** The table-driven test in `mail-templates.test.ts` fails on `undefined`, `null` or `${` anywhere in the output. Add your template to the `ALL` array and it is covered.

## Transactional: send it from the route

`apps/api/src/services/transactional.ts`:

```ts
export async function sendRetiredMail(deps, log, input) {
  const settings = getSettings(deps.db);
  await deliver(deps, log, input.to, retiredEmail({ ...input, orgName: settings.orgName }));
}
```

`deliver` does two things that matter: it returns immediately when `deps.mailer` is null, and it **never throws**. A broken relay must not fail the request that triggered it — the device really was retired, and the email is the part that did not happen. It is logged.

Call it from the route **after** the transaction, never inside one: a message cannot be rolled back.

Gate it on a settings toggle only if there is one. Invitations use `emailInvites`; an admin-issued reset link deliberately has no switch, because handing somebody back their own account is not a notification a workspace turns off.

## Scheduled: a job and a dedupe key

`apps/api/src/services/jobs.ts`, as a plain function of `(deps, now)` — node-cron decides only the clock, which is what makes the rule testable:

```ts
export async function runStaleScan(deps: AppDeps, now: Date): Promise<JobResult> {
  const settings = getSettings(deps.db);
  if (!deps.mailer || !emailEnabled(settings, 'emailStaleAssets')) return { sent: 0, skipped: 1 };
  // …query, build content…
  return { sent, skipped };
}
```

Send through `sendOnce`, and **choose the dedupe key carefully — it is the whole design**:

| Key                             | Behaviour                                     |
| ------------------------------- | --------------------------------------------- |
| `stale:{assetId}`               | once ever                                     |
| `stale:{assetId}:{lastMovedAt}` | again if the asset moves and goes quiet again |
| `stale:{isoWeek}`               | once a week, whatever the list contains       |

The warranty scan keys on the asset **and its warranty date**, so correcting a wrong date re-arms the alert instead of swallowing it. Return reminders key on the day, so they repeat daily while an item is out.

Then register it in `apps/api/src/services/scheduler.ts` with a cron expression.

## The settings switch

A new toggle is a column: add it to `orgSettings` in `apps/api/src/db/schema.ts`, run `npm run db:generate -w apps/api`, add it to `settingsPatchInput` and the `EDITABLE` list in `services/settings.ts`, then to `EMAIL_TOGGLES` in `apps/web/src/features/admin/SettingsPanel.tsx` and to the `EmailToggleKey` union above it.

## Tests — `apps/api/test/jobs.test.ts`

`buildTestApp({ SMTP_HOST: 'smtp.acme.io' }, () => FIXED_DATE)` gives a recording mailer and a frozen clock; `ctx.sent` is every message. Cover four things:

1. it sends what it should;
2. running twice sends once;
3. the settings toggle silences it;
4. **an instance with no SMTP does nothing at all** — `buildTestApp()` with no host, which is a supported way to run this app rather than an edge case.

## The step people forget

**The log row is written after the send, on purpose.** That makes delivery at-least-once: a crash between sending and recording sends a duplicate on the next run. Writing first would make it at-most-once, and lose the message forever. A duplicate warranty alert is a nuisance; a missing one is the feature not working. Do not "fix" the order.
