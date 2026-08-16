# e2e — Playwright

End-to-end tests against the **real production artifact**: the Playwright `webServer` builds both workspaces and starts the API serving the built SPA from one process — exactly how the Docker image runs. Viewport is fixed at 1440×900 (the design is desktop-only), chromium only.

```bash
npm run e2e          # from the repo root
```

## How the instance is managed

- Each run wipes `e2e/.data` and starts a fresh server, so the suite always begins at first-run setup. `reuseExistingServer` is off for the same reason — a reused server is already initialized and the setup test would fail.
- One instance means one workspace, so tests run **serially in declaration order** (`workers: 1`): the first test performs setup and creates the admin account that later tests sign in with. Keep the whole journey in one spec file; a new file is only correct if it is independent of that account.
- Browser contexts are per-test, so every test starts signed out even though the server state carries over.
- `NODE_ENV=production` is set deliberately: it activates the origin guard, so the suite proves the CSRF stance works with real browser requests.

## Conventions

- Select by role and accessible name (`getByRole('button', { name: 'Sign in', exact: true })`); never by hashed CSS-module class names.
- The dev-only `/kitchen-sink` route does not exist in production builds — e2e covers real app routes only.
- Assert theme/no-flash behavior on `<html data-theme>` immediately after `reload()`: it proves the inline script in `index.html` ran before hydration.
- First run needs browsers: `npx playwright install chromium`.
