# e2e — Playwright

End-to-end tests against the **real production artifact**: the Playwright `webServer` builds both workspaces and starts the API serving the built SPA from one process — exactly how the Docker image runs. Viewport is fixed at 1440×900 (the design is desktop-only), chromium only.

```bash
npm run e2e          # from the repo root
```

## How the instance is managed

- Each run wipes `e2e/.data` and starts a fresh server, so the suite always begins at first-run setup. `reuseExistingServer` is off for the same reason — a reused server is already initialized and the setup test would fail.
- One instance means one workspace, so tests run **serially in declaration order** (`workers: 1`): the first test performs setup and creates the admin account that later tests sign in with. Spec files then run in path order, so `auth.spec.ts` bootstraps the instance and every later spec signs in through `helpers/session.ts`. A spec that must run first has to sort before `auth`.
- Later specs also inherit the _data_ earlier ones created: `inventory.spec.ts` adds an employee, then registers an asset to that person, then reads it back. Add to the end of a journey rather than assuming an empty instance.
- **`zz-workspace-delete.spec.ts` empties the instance, so its `zz-` prefix is load-bearing.** Anything sorting after it would find a workspace waiting to be set up. Give new specs ordinary names and they stay safe.
- Uploading a file is `setInputFiles` on the input's accessible name (`getByLabel('CSV file')`), never a click on the dropzone: the visible zone opens a native picker Playwright cannot drive.
- A second role needs a second browser context: `members.spec.ts` invites a viewer and accepts the invitation in `browser.newContext()`, which is also the only honest way to test read-only access — the invite endpoint is the only way to create a non-admin.
- Browser contexts are per-test, so every test starts signed out even though the server state carries over.
- `NODE_ENV=production` is set deliberately: it activates the origin guard, so the suite proves the CSRF stance works with real browser requests.

## Conventions

- Select by role and accessible name (`getByRole('button', { name: 'Sign in', exact: true })`); never by hashed CSS-module class names.
- Dropdowns are the app's own, not native `<select>`, so `selectOption` does nothing. Use `helpers/dropdown.ts` (`choose(page, scope, field, label)`) and match the option by its **label** — the value never reaches the DOM. The listbox is portalled to `<body>`, so it is looked up on the `page` even when the trigger is inside a dialog.
- The dev-only `/kitchen-sink` route does not exist in production builds — e2e covers real app routes only.
- Assert theme/no-flash behavior on `<html data-theme>` immediately after `reload()`: it proves the inline script in `index.html` ran before hydration.
- First run needs browsers: `npx playwright install chromium`.
