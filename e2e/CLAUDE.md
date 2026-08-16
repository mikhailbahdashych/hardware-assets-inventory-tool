# e2e — Playwright

End-to-end tests against the **production build**: the Playwright `webServer` builds the web app and serves it with `vite preview` on port 4173. Viewport is fixed at 1440×900 (the design is desktop-only), chromium only.

```bash
npm run e2e          # from the repo root
```

- Selectors: prefer roles and accessible names (`getByRole('button', { name: 'New asset' })`); primitives expose `data-variant` / `aria-*` where roles aren't enough. Never select by hashed CSS-module class names.
- The dev-only `/kitchen-sink` route does not exist in production builds — e2e covers real app routes only.
- When the API lands (PR 2+), each worker gets its own server + temp `DATA_DIR`; seeding happens through API helpers in `helpers/`.
- First run needs browsers: `npx playwright install chromium`.
