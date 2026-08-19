# e2e — Playwright

End-to-end tests against the **real production artifact**: the Playwright `webServer` builds both workspaces and starts the API serving the built SPA from one process — exactly how the Docker image runs. Viewport is fixed at 1440×900 (the design is desktop-only), chromium only.

```bash
npm run e2e          # from the repo root
```

## How the instance is managed

- Each run wipes `e2e/.data` and starts a fresh server, so the suite always begins at first-run setup. `reuseExistingServer` is off for the same reason — a reused server is already initialized and the setup test would fail.
- One instance means one workspace, so tests run **serially in declaration order** (`workers: 1`): the first test performs setup and creates the admin account that later tests sign in with. Spec files then run in path order, so `auth.spec.ts` bootstraps the instance and every later spec signs in through `helpers/session.ts`. A spec that must run first has to sort before `auth`.
- Later specs also inherit the _data_ earlier ones created: `inventory.spec.ts` adds an employee, then registers an asset to that person, then reads it back. Add to the end of a journey rather than assuming an empty instance.
- **`zz-workspace-delete.spec.ts` empties the instance, so its `zz-` prefix is load-bearing.** Anything sorting after it would find a workspace waiting to be set up.
- **A spec that writes a lot of activity has to sort late too.** `two-factor.spec.ts` signs in three times, enrols and changes two settings, and the dashboard's recent-activity widget is five rows deep — sorting before `overview.spec.ts` pushed the check-in that spec asserts on off the bottom of it. That is the general rule behind both names: what a spec _leaves behind_ decides where it may sit, and an ordinary name is safe only for a spec that leaves nothing.
- Uploading a file is `setInputFiles` on the input's accessible name (`getByLabel('CSV file')`), never a click on the dropzone: the visible zone opens a native picker Playwright cannot drive.
- A second role needs a second browser context: `members.spec.ts` invites a viewer and accepts the invitation in `browser.newContext()`, which is also the only honest way to test read-only access — the invite endpoint is the only way to create a non-admin. `roles.spec.ts` then promotes that same person and signs her in again, because one member carried across specs is what makes "her permissions changed" a thing the suite can observe.
- **A permission is only proven when the API agrees.** A missing button is a hidden door; `page.request.post(…)` from the signed-in context is the lock. Playwright's request context shares the page's cookies and sends no `Origin`, which the origin guard passes deliberately — so the guard under test is the RBAC one. Send a body the schema accepts: validation runs before the route's `preHandler`, so an empty one answers 422 and proves nothing.
- Browser contexts are per-test, so every test starts signed out even though the server state carries over.
- `NODE_ENV=production` is set deliberately: it activates the origin guard, so the suite proves the CSRF stance works with real browser requests.

## Conventions

- Select by role and accessible name (`getByRole('button', { name: 'Sign in', exact: true })`); never by hashed CSS-module class names.
- Dropdowns are the app's own, not native `<select>`, so `selectOption` does nothing. Use `helpers/dropdown.ts` (`choose(page, scope, field, label)`) and match the option by its **label** — the value never reaches the DOM. The listbox is portalled to `<body>`, so it is looked up on the `page` even when the trigger is inside a dialog. An option that carries a description has both in its accessible name ("Blue info") while the closed field shows only the label; that is what `choose`'s fifth argument is for.
- The dev-only `/kitchen-sink` route does not exist in production builds — e2e covers real app routes only.
- Assert theme/no-flash behavior on `<html data-theme>` immediately after `reload()`: it proves the inline script in `index.html` ran before hydration.
- First run needs browsers: `npx playwright install chromium`.
