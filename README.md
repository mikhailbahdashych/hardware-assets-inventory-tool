# Hardware Assets Inventory Tool

**Inventory** is an open-source, self-hosted hardware asset inventory for IT teams: track devices, who holds them, and the full ownership history — under your own domain, with minimal ops effort.

> Status: under active development. The first release is being built in sequential PRs; see the repo's pull requests for progress.

## Highlights (planned v1)

- Assets with statuses (Available / Assigned / In repair / Ordered / Retired / Lost/Stolen), custom fields, and attachments
- Employees and full ownership history — every holder, every hand-off, forever
- Members with roles (Admin / Manager / Viewer) and invite-based onboarding
- Dashboard (status KPIs, categories, warranty expirations, pending returns), ⌘K command palette
- CSV import with column mapping, JSON export, audit log with retention
- Single Docker container, SQLite on one volume — backup is copying a folder
- Light + dark themes, quiet Linear-adjacent design
- CLAUDE.md files + customization recipes throughout, so your team can adapt it by asking [Claude Code](https://claude.com/claude-code)

## Development

Requires Node ≥ 22.

```bash
npm install
npm run dev        # web app on http://localhost:5173
npm test           # unit tests across workspaces
npm run e2e        # Playwright end-to-end tests
```

Monorepo layout: `apps/web` (React SPA) · `apps/api` (Fastify, arrives in PR 2) · `packages/shared` (single source of truth for enums, schemas, RBAC) · `e2e` (Playwright).

The UI design lives in `docs/design-handoff/` — an interactive HTML prototype that is the visual source of truth.

## License

[MIT](LICENSE)
